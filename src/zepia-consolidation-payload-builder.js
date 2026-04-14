import { ingestZepiaToolCallTracking } from "./zepia-tool-call-tracking.js";

const ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_ID =
  "agent_brain_zepia_consolidation_memory_snapshot";
const ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_VERSION = "1.0.0";
const ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_PROVENANCE_FIELD =
  "zepiaConsolidationPayload";
const ZEPIA_CONSOLIDATION_MEMORY_DELTA_OPERATIONS = Object.freeze([
  "added",
  "updated",
  "deleted",
]);

const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cloneValueDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneValueDeep);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneValueDeep(nestedValue),
      ]),
    );
  }

  return value;
};

const normalizeRequiredString = (value, label) => {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeOptionalString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredString(value, label);
};

const normalizeMemoryId = (value, label) => {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new TypeError(`${label} must be a string, number, or bigint`);
  }

  const normalizedValue = String(value).trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeTimestampToIsoString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${label} must be a valid Date`);
    }

    return value.toISOString();
  }

  if (typeof value === "number") {
    const normalizedDate = new Date(value);

    if (Number.isNaN(normalizedDate.getTime())) {
      throw new TypeError(`${label} must be a valid timestamp`);
    }

    return normalizedDate.toISOString();
  }

  if (typeof value === "string") {
    const normalizedValue = normalizeRequiredString(value, label);
    const normalizedDate = new Date(normalizedValue);

    if (Number.isNaN(normalizedDate.getTime())) {
      throw new TypeError(`${label} must be a valid ISO timestamp`);
    }

    return normalizedDate.toISOString();
  }

  throw new TypeError(`${label} must be a string, number, or Date`);
};

const sortObjectKeysDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysDeep);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortObjectKeysDeep(value[key])]),
    );
  }

  return value;
};

const createStableFingerprint = (value) =>
  JSON.stringify(sortObjectKeysDeep(cloneValueDeep(value)));

const normalizeBoolean = (value, label, defaultValue = false) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }

  return value;
};

const normalizeMemoryEntityInput = (value, index, agentId) => {
  if (!isPlainObject(value)) {
    throw new TypeError(
      `Zepia consolidation payload memoryEntities[${index}] must be an object`,
    );
  }

  const label = `Zepia consolidation payload memoryEntities[${index}]`;
  const normalizedAgentId = normalizeRequiredString(
    value.agentId ?? value.record?.agentId ?? agentId,
    `${label}.agentId`,
  );

  if (normalizedAgentId !== agentId) {
    throw new Error(
      `${label}.agentId must stay inside agent "${agentId}", received "${normalizedAgentId}"`,
    );
  }

  const memoryId = normalizeMemoryId(
    value.memoryId ?? value.id ?? value.record?.memoryId,
    `${label}.memoryId`,
  );
  const deleted = normalizeBoolean(
    value.deleted ?? value.operation === "deleted",
    `${label}.deleted`,
  );
  const entity = freezeDeep({
    ...cloneValueDeep(value),
    agentId: normalizedAgentId,
    memoryId,
    deleted,
  });

  return freezeDeep({
    memoryId,
    deleted,
    entity,
    fingerprint: createStableFingerprint(entity),
  });
};

const resolveMemoryEntityInputList = (input) => {
  const hasMemoryEntities = Object.hasOwn(input, "memoryEntities");
  const hasMemories = Object.hasOwn(input, "memories");

  if (hasMemoryEntities && hasMemories && input.memoryEntities !== input.memories) {
    throw new TypeError(
      "Zepia consolidation payload input must provide either memoryEntities or memories, not both.",
    );
  }

  const source = hasMemoryEntities ? input.memoryEntities : input.memories;

  if (source === undefined || source === null) {
    return [];
  }

  if (!Array.isArray(source)) {
    throw new TypeError(
      "Zepia consolidation payload input memoryEntities must be an array",
    );
  }

  return source;
};

const createDeletedMemoryEntityTombstone = (agentId, memoryId) =>
  freezeDeep({
    agentId,
    memoryId,
    deleted: true,
  });

const createMemorySnapshotDescriptor = (descriptor, label) =>
  freezeDeep({
    memoryId: normalizeMemoryId(descriptor?.memoryId, `${label}.memoryId`),
    fingerprint: normalizeRequiredString(
      descriptor?.fingerprint,
      `${label}.fingerprint`,
    ),
  });

const normalizeMemoryCheckpointSnapshot = (value, agentId, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const snapshotAgentId = normalizeRequiredString(value.agentId, `${label}.agentId`);

  if (snapshotAgentId !== agentId) {
    throw new Error(
      `${label}.agentId must stay inside agent "${agentId}", received "${snapshotAgentId}"`,
    );
  }

  const schemaId = normalizeRequiredString(value.schemaId, `${label}.schemaId`);
  const schemaVersion = normalizeRequiredString(
    value.schemaVersion,
    `${label}.schemaVersion`,
  );

  if (schemaId !== ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_ID) {
    throw new Error(
      `${label}.schemaId must be "${ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_ID}".`,
    );
  }

  if (schemaVersion !== ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `${label}.schemaVersion must be "${ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_VERSION}".`,
    );
  }

  if (!Array.isArray(value.memories)) {
    throw new TypeError(`${label}.memories must be an array`);
  }

  const descriptors = value.memories.map((descriptor, index) =>
    createMemorySnapshotDescriptor(
      descriptor,
      `${label}.memories[${index}]`,
    ),
  );
  const descriptorIndex = new Map();

  descriptors.forEach((descriptor, index) => {
    if (descriptorIndex.has(descriptor.memoryId)) {
      throw new Error(
        `${label}.memories[${index}].memoryId duplicates "${descriptor.memoryId}"`,
      );
    }

    descriptorIndex.set(descriptor.memoryId, descriptor);
  });

  return freezeDeep({
    schemaId,
    schemaVersion,
    agentId: snapshotAgentId,
    memories: freezeDeep(
      [...descriptorIndex.values()].sort((left, right) =>
        left.memoryId.localeCompare(right.memoryId),
      ),
    ),
  });
};

const normalizeCheckpointShape = (value, agentId) => {
  if (value === undefined || value === null) {
    return freezeDeep({
      checkpointFound: false,
      checkpoint: null,
      snapshot: null,
    });
  }

  if (!isPlainObject(value)) {
    throw new TypeError("Zepia consolidation payload checkpoint input must be an object");
  }

  const checkpointValue =
    value.checkpoint === undefined ? value : value.checkpoint;

  if (checkpointValue === null) {
    return freezeDeep({
      checkpointFound: Boolean(value.found),
      checkpoint: null,
      snapshot: null,
    });
  }

  if (!isPlainObject(checkpointValue)) {
    throw new TypeError(
      "Zepia consolidation payload checkpoint input must include a checkpoint object when provided.",
    );
  }

  const checkpointAgentId = normalizeRequiredString(
    checkpointValue.agentId,
    "Zepia consolidation payload checkpoint.agentId",
  );

  if (checkpointAgentId !== agentId) {
    throw new Error(
      `Zepia consolidation payload checkpoint.agentId must stay inside agent "${agentId}", received "${checkpointAgentId}"`,
    );
  }

  const provenance =
    checkpointValue.provenance === undefined || checkpointValue.provenance === null
      ? {}
      : isPlainObject(checkpointValue.provenance)
        ? checkpointValue.provenance
        : (() => {
            throw new TypeError(
              "Zepia consolidation payload checkpoint.provenance must be an object when provided.",
            );
          })();
  const snapshot = normalizeMemoryCheckpointSnapshot(
    provenance[ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_PROVENANCE_FIELD],
    agentId,
    `Zepia consolidation payload checkpoint.provenance.${ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_PROVENANCE_FIELD}`,
  );

  return freezeDeep({
    checkpointFound: value.found === undefined ? true : Boolean(value.found),
    checkpoint: freezeDeep(cloneValueDeep(checkpointValue)),
    snapshot,
  });
};

const indexMemoryEntitiesById = (entities, label) => {
  const entityIndex = new Map();

  entities.forEach((entity, index) => {
    const existing = entityIndex.get(entity.memoryId);

    if (!existing) {
      entityIndex.set(entity.memoryId, entity);
      return;
    }

    if (existing.fingerprint === entity.fingerprint) {
      return;
    }

    throw new Error(
      `${label}[${index}] duplicates memoryId "${entity.memoryId}" with a different payload.`,
    );
  });

  return entityIndex;
};

const createMemoryDeltaRecord = ({
  operation,
  memoryId,
  previousFingerprint = null,
  currentFingerprint = null,
  entity,
}) =>
  freezeDeep({
    operation,
    memoryId,
    previousFingerprint:
      previousFingerprint === null
        ? null
        : normalizeRequiredString(
            previousFingerprint,
            "Zepia consolidation payload memory delta previousFingerprint",
          ),
    currentFingerprint:
      currentFingerprint === null
        ? null
        : normalizeRequiredString(
            currentFingerprint,
            "Zepia consolidation payload memory delta currentFingerprint",
          ),
    entity,
  });

const sortMemoryDeltaRecords = (records) =>
  [...records].sort(
    (left, right) =>
      ZEPIA_CONSOLIDATION_MEMORY_DELTA_OPERATIONS.indexOf(left.operation) -
        ZEPIA_CONSOLIDATION_MEMORY_DELTA_OPERATIONS.indexOf(right.operation) ||
      left.memoryId.localeCompare(right.memoryId),
  );

const createNextCheckpointSnapshot = (agentId, currentEntities) =>
  freezeDeep({
    schemaId: ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_ID,
    schemaVersion: ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    agentId,
    memories: freezeDeep(
      [...currentEntities.values()]
        .filter((entity) => !entity.deleted)
        .map((entity) =>
          createMemorySnapshotDescriptor(
            {
              memoryId: entity.memoryId,
              fingerprint: entity.fingerprint,
            },
            `Zepia consolidation payload checkpoint snapshot for "${entity.memoryId}"`,
          ),
        )
        .sort((left, right) => left.memoryId.localeCompare(right.memoryId)),
    ),
  });

export const buildZepiaConsolidationPayload = (input = {}) => {
  if (!isPlainObject(input)) {
    throw new TypeError("Zepia consolidation payload input must be an object");
  }

  const agentId = normalizeRequiredString(
    input.agentId,
    "Zepia consolidation payload agentId",
  );
  const sessionId = normalizeOptionalString(
    input.sessionId,
    "Zepia consolidation payload sessionId",
  );
  const idleSince = normalizeTimestampToIsoString(
    input.idleSince,
    "Zepia consolidation payload idleSince",
  );
  const checkpointState = normalizeCheckpointShape(input.checkpoint, agentId);
  const currentEntities = resolveMemoryEntityInputList(input).map((entity, index) =>
    normalizeMemoryEntityInput(entity, index, agentId),
  );
  const currentEntityIndex = indexMemoryEntitiesById(
    currentEntities,
    "Zepia consolidation payload memoryEntities",
  );
  const previousSnapshotIndex = new Map(
    (checkpointState.snapshot?.memories ?? []).map((descriptor) => [
      descriptor.memoryId,
      descriptor,
    ]),
  );
  const explicitDeleteIds = new Set(
    [...currentEntityIndex.values()]
      .filter((entity) => entity.deleted)
      .map((entity) => entity.memoryId),
  );
  const currentActiveEntities = new Map(
    [...currentEntityIndex.values()]
      .filter((entity) => !entity.deleted)
      .map((entity) => [entity.memoryId, entity]),
  );
  const memoryRecords = [];

  currentActiveEntities.forEach((entity, memoryId) => {
    const previousDescriptor = previousSnapshotIndex.get(memoryId) ?? null;

    if (previousDescriptor === null) {
      memoryRecords.push(
        createMemoryDeltaRecord({
          operation: "added",
          memoryId,
          currentFingerprint: entity.fingerprint,
          entity: entity.entity,
        }),
      );
      return;
    }

    if (previousDescriptor.fingerprint !== entity.fingerprint) {
      memoryRecords.push(
        createMemoryDeltaRecord({
          operation: "updated",
          memoryId,
          previousFingerprint: previousDescriptor.fingerprint,
          currentFingerprint: entity.fingerprint,
          entity: entity.entity,
        }),
      );
    }
  });

  explicitDeleteIds.forEach((memoryId) => {
    const entity = currentEntityIndex.get(memoryId);
    const previousDescriptor = previousSnapshotIndex.get(memoryId) ?? null;

    memoryRecords.push(
      createMemoryDeltaRecord({
        operation: "deleted",
        memoryId,
        previousFingerprint: previousDescriptor?.fingerprint ?? null,
        currentFingerprint: entity?.fingerprint ?? null,
        entity:
          entity?.entity ?? createDeletedMemoryEntityTombstone(agentId, memoryId),
      }),
    );
  });

  previousSnapshotIndex.forEach((descriptor, memoryId) => {
    if (
      currentActiveEntities.has(memoryId) ||
      explicitDeleteIds.has(memoryId)
    ) {
      return;
    }

    memoryRecords.push(
      createMemoryDeltaRecord({
        operation: "deleted",
        memoryId,
        previousFingerprint: descriptor.fingerprint,
        entity: createDeletedMemoryEntityTombstone(agentId, memoryId),
      }),
    );
  });

  const sortedMemoryRecords = freezeDeep(sortMemoryDeltaRecords(memoryRecords));
  const nextCheckpointSnapshot = createNextCheckpointSnapshot(
    agentId,
    currentEntityIndex,
  );
  const checkpointProvenance = freezeDeep({
    ...(checkpointState.checkpoint?.provenance
      ? cloneValueDeep(checkpointState.checkpoint.provenance)
      : {}),
    [ZEPIA_CONSOLIDATION_MEMORY_SNAPSHOT_PROVENANCE_FIELD]:
      nextCheckpointSnapshot,
  });
  const toolCallTracking = ingestZepiaToolCallTracking({
    agentId,
    sessionId,
    toolCalls: input.toolCalls ?? [],
    toolWeights: input.toolWeights,
    toolWeightConfigPath: input.toolWeightConfigPath,
    defaultToolWeight: input.defaultToolWeight,
  });
  const unchangedCount =
    currentActiveEntities.size -
    sortedMemoryRecords.filter((record) => record.operation !== "deleted").length;

  return freezeDeep({
    agentId,
    sessionId,
    idleSince,
    checkpointFound: checkpointState.checkpointFound,
    checkpoint: checkpointState.checkpoint,
    memories: sortedMemoryRecords,
    toolCallTracking,
    checkpointSnapshot: nextCheckpointSnapshot,
    checkpointProvenance,
    summary: freezeDeep({
      checkpointMemoryCount: previousSnapshotIndex.size,
      currentMemoryCount: currentActiveEntities.size,
      unchangedCount,
      emittedMemoryCount: sortedMemoryRecords.length,
      addedCount: sortedMemoryRecords.filter(
        (record) => record.operation === "added",
      ).length,
      updatedCount: sortedMemoryRecords.filter(
        (record) => record.operation === "updated",
      ).length,
      deletedCount: sortedMemoryRecords.filter(
        (record) => record.operation === "deleted",
      ).length,
    }),
  });
};
