import { readFileSync } from "node:fs";

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

const normalizeNonNegativeInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }

  return value;
};

const normalizeNonNegativeNumber = (value, label) => {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return normalizedValue;
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

const createStableMemoryReferenceId = (agentId, memoryId) =>
  `${agentId}:${memoryId}`;

const createCanonicalPairId = (sourceId, targetId) =>
  [sourceId, targetId].sort((left, right) => left.localeCompare(right)).join("<->");

const createCoReferenceEdgeId = (toolCallId, fromId, toId) =>
  `${toolCallId}|${fromId}->${toId}`;

const DEFAULT_ZEPIA_TOOL_CALL_EDGE_WEIGHT = 1;

const createUniqueSortedReferences = (references) =>
  freezeDeep(
    [...new Map(references.map((reference) => [reference.stableId, reference])).values()].sort(
      (left, right) => left.stableId.localeCompare(right.stableId),
    ),
  );

const normalizeToolWeightRecord = (value, label) => {
  if (value === undefined || value === null) {
    return freezeDeep({});
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep(
    Object.fromEntries(
      Object.entries(value)
        .map(([toolName, weight]) => [
          normalizeRequiredString(toolName, `${label} tool name`),
          normalizeNonNegativeNumber(weight, `${label}.${toolName}`),
        ])
        .sort(([leftToolName], [rightToolName]) =>
          leftToolName.localeCompare(rightToolName),
        ),
    ),
  );
};

const normalizeToolWeightConfigurationDocument = (
  value,
  label,
  configPath = null,
) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const source =
    isPlainObject(value.consolidationConfig) ? value.consolidationConfig : value;

  return freezeDeep({
    configPath,
    defaultToolWeight:
      source.defaultToolWeight === undefined
        ? DEFAULT_ZEPIA_TOOL_CALL_EDGE_WEIGHT
        : normalizeNonNegativeNumber(
            source.defaultToolWeight,
            `${label}.defaultToolWeight`,
          ),
    toolWeights: normalizeToolWeightRecord(
      source.toolWeights,
      `${label}.toolWeights`,
    ),
  });
};

const loadToolWeightConfiguration = (configPath) => {
  const normalizedPath = normalizeRequiredString(
    configPath,
    "Zepia tool call tracking toolWeightConfigPath",
  );
  let rawConfig;

  try {
    rawConfig = readFileSync(normalizedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read Zepia tool weight config "${normalizedPath}": ${error.message}`,
    );
  }

  let parsedConfig;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    throw new TypeError(
      `Zepia tool weight config "${normalizedPath}" must be valid JSON`,
    );
  }

  return normalizeToolWeightConfigurationDocument(
    parsedConfig,
    `Zepia tool weight config "${normalizedPath}"`,
    normalizedPath,
  );
};

const resolveToolWeightConfiguration = (input) => {
  const toolWeightConfigPath = normalizeOptionalString(
    input.toolWeightConfigPath,
    "Zepia tool call tracking toolWeightConfigPath",
  );
  const fileConfiguration =
    toolWeightConfigPath === null
      ? normalizeToolWeightConfigurationDocument(
          {},
          "Zepia tool call tracking tool weight defaults",
        )
      : loadToolWeightConfiguration(toolWeightConfigPath);
  const inlineToolWeights = normalizeToolWeightRecord(
    input.toolWeights,
    "Zepia tool call tracking toolWeights",
  );

  return freezeDeep({
    configPath: fileConfiguration.configPath,
    defaultToolWeight:
      input.defaultToolWeight === undefined
        ? fileConfiguration.defaultToolWeight
        : normalizeNonNegativeNumber(
            input.defaultToolWeight,
            "Zepia tool call tracking defaultToolWeight",
          ),
    toolWeights: freezeDeep({
      ...fileConfiguration.toolWeights,
      ...inlineToolWeights,
    }),
  });
};

const resolveToolWeight = (toolName, configuration) =>
  Object.hasOwn(configuration.toolWeights, toolName)
    ? configuration.toolWeights[toolName]
    : configuration.defaultToolWeight;

const normalizeMemoryReference = (value, label, fallbackAgentId = null) => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    if (fallbackAgentId === null) {
      throw new TypeError(
        `${label} requires an agentId when memory references are passed as bare ids`,
      );
    }

    const memoryId = normalizeMemoryId(value, `${label}.memoryId`);

    return freezeDeep({
      agentId: fallbackAgentId,
      memoryId,
      stableId: createStableMemoryReferenceId(fallbackAgentId, memoryId),
    });
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a memory id or an object`);
  }

  const agentId =
    value.agentId === undefined || value.agentId === null
      ? fallbackAgentId
      : normalizeRequiredString(value.agentId, `${label}.agentId`);

  if (agentId === null) {
    throw new TypeError(`${label}.agentId must be provided`);
  }

  const memoryId = normalizeMemoryId(
    value.memoryId ?? value.id,
    `${label}.memoryId`,
  );

  return freezeDeep({
    agentId,
    memoryId,
    stableId: createStableMemoryReferenceId(agentId, memoryId),
  });
};

const normalizeMemoryReferenceList = (value, label, fallbackAgentId = null) => {
  if (value === undefined || value === null) {
    return freezeDeep([]);
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return createUniqueSortedReferences(
    value.map((reference, index) =>
      normalizeMemoryReference(reference, `${label}[${index}]`, fallbackAgentId),
    ),
  );
};

const normalizeRolePartitionedReferences = (
  value,
  label,
  fallbackAgentId = null,
) => {
  if (value === undefined || value === null) {
    return freezeDeep({
      sources: [],
      targets: [],
    });
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  const sources = [];
  const targets = [];

  value.forEach((reference, index) => {
    if (!isPlainObject(reference)) {
      throw new TypeError(`${label}[${index}] must be an object`);
    }

    const role = normalizeRequiredString(
      reference.role,
      `${label}[${index}].role`,
    ).toLowerCase();
    const normalizedReference = normalizeMemoryReference(
      reference,
      `${label}[${index}]`,
      fallbackAgentId,
    );

    if (role === "source") {
      sources.push(normalizedReference);
      return;
    }

    if (role === "target") {
      targets.push(normalizedReference);
      return;
    }

    throw new TypeError(
      `${label}[${index}].role must be "source" or "target"`,
    );
  });

  return freezeDeep({
    sources: createUniqueSortedReferences(sources),
    targets: createUniqueSortedReferences(targets),
  });
};

const collectSourceReferences = (entry, label, fallbackAgentId) => {
  const groupedReferences = normalizeRolePartitionedReferences(
    entry.references,
    `${label}.references`,
    fallbackAgentId,
  );

  return createUniqueSortedReferences([
    ...groupedReferences.sources,
    ...normalizeMemoryReferenceList(
      entry.sources,
      `${label}.sources`,
      fallbackAgentId,
    ),
    ...(entry.source === undefined
      ? []
      : [
          normalizeMemoryReference(
            entry.source,
            `${label}.source`,
            fallbackAgentId,
          ),
        ]),
    ...(entry.sourceMemoryId === undefined
      ? []
      : [
          normalizeMemoryReference(
            entry.sourceMemoryId,
            `${label}.sourceMemoryId`,
            fallbackAgentId,
          ),
        ]),
    ...normalizeMemoryReferenceList(
      entry.sourceMemoryIds,
      `${label}.sourceMemoryIds`,
      fallbackAgentId,
    ),
    ...(entry.memoryId === undefined
      ? []
      : [
          normalizeMemoryReference(
            entry.memoryId,
            `${label}.memoryId`,
            fallbackAgentId,
          ),
        ]),
  ]);
};

const collectTargetReferences = (entry, label, fallbackAgentId) => {
  const groupedReferences = normalizeRolePartitionedReferences(
    entry.references,
    `${label}.references`,
    fallbackAgentId,
  );

  return createUniqueSortedReferences([
    ...groupedReferences.targets,
    ...normalizeMemoryReferenceList(
      entry.targets,
      `${label}.targets`,
      fallbackAgentId,
    ),
    ...(entry.target === undefined
      ? []
      : [
          normalizeMemoryReference(
            entry.target,
            `${label}.target`,
            fallbackAgentId,
          ),
        ]),
    ...(entry.targetMemoryId === undefined
      ? []
      : [
          normalizeMemoryReference(
            entry.targetMemoryId,
            `${label}.targetMemoryId`,
            fallbackAgentId,
          ),
        ]),
    ...normalizeMemoryReferenceList(
      entry.targetMemoryIds,
      `${label}.targetMemoryIds`,
      fallbackAgentId,
    ),
    ...normalizeMemoryReferenceList(
      entry.referencedMemoryIds,
      `${label}.referencedMemoryIds`,
      fallbackAgentId,
    ),
  ]);
};

const normalizeProvenance = (value, label) => {
  if (value === undefined || value === null) {
    return freezeDeep({
      source: "zepia-explicit-tool-call-tracking",
    });
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep({
    source: "zepia-explicit-tool-call-tracking",
    ...value,
  });
};

const normalizeToolName = (entry, label) =>
  normalizeRequiredString(
    entry.toolName ?? entry.tool ?? entry.toolCall?.tool,
    `${label}.toolName`,
  );

const normalizeToolCallId = (entry, label, batchSessionId = null) => {
  const explicitToolCallId =
    entry.toolCallId ?? entry.trackingId ?? entry.stepId ?? null;

  if (explicitToolCallId !== null) {
    return normalizeMemoryId(explicitToolCallId, `${label}.toolCallId`);
  }

  if (entry.stepIndex !== undefined && entry.stepIndex !== null) {
    const loopId =
      entry.toolLoopId ?? entry.loopId ?? entry.traceId ?? batchSessionId;

    if (loopId === null || loopId === undefined) {
      throw new TypeError(
        `${label}.toolCallId is required when no toolLoopId/loopId/traceId/sessionId is available`,
      );
    }

    const normalizedLoopId = normalizeRequiredString(
      String(loopId),
      `${label}.toolLoopId`,
    );
    const normalizedStepIndex = normalizeNonNegativeInteger(
      entry.stepIndex,
      `${label}.stepIndex`,
    );

    return `${normalizedLoopId}:${normalizedStepIndex}`;
  }

  throw new TypeError(
    `${label}.toolCallId is required when no stable step identifier is available`,
  );
};

const normalizeCalledAt = (entry, label) =>
  normalizeTimestampToIsoString(
    entry.calledAt ?? entry.observedAt ?? entry.timestamp,
    `${label}.calledAt`,
  );

const assertAgentBoundary = (agentId, references, label) => {
  references.forEach((reference, index) => {
    if (reference.agentId !== agentId) {
      throw new Error(
        `${label}[${index}] must stay inside agent "${agentId}", received "${reference.agentId}"`,
      );
    }
  });
};

const createCoReferenceEdges = (linkCandidates, toolWeightConfiguration) => {
  const edgeIndex = new Map();

  linkCandidates.forEach((candidate) => {
    const edgeWeight = resolveToolWeight(
      candidate.toolName,
      toolWeightConfiguration,
    );

    [
      {
        fromId: candidate.sourceId,
        toId: candidate.targetId,
        fromMemoryId: candidate.sourceMemoryId,
        toMemoryId: candidate.targetMemoryId,
      },
      {
        fromId: candidate.targetId,
        toId: candidate.sourceId,
        fromMemoryId: candidate.targetMemoryId,
        toMemoryId: candidate.sourceMemoryId,
      },
    ].forEach(({ fromId, toId, fromMemoryId, toMemoryId }) => {
      if (fromId === toId) {
        return;
      }

      const edgeId = createCoReferenceEdgeId(candidate.toolCallId, fromId, toId);
      const existingEdge = edgeIndex.get(edgeId);

      if (existingEdge) {
        existingEdge.candidateIds.add(candidate.candidateId);
        return;
      }

      edgeIndex.set(edgeId, {
        edgeId,
        pairId: candidate.pairId,
        relation: candidate.relation,
        agentId: candidate.agentId,
        toolCallId: candidate.toolCallId,
        toolName: candidate.toolName,
        calledAt: candidate.calledAt,
        fromId,
        toId,
        fromMemoryId,
        toMemoryId,
        edgeWeight,
        provenance: candidate.provenance,
        candidateIds: new Set([candidate.candidateId]),
      });
    });
  });

  return freezeDeep(
    [...edgeIndex.values()].map((edge) =>
      freezeDeep({
        edgeId: edge.edgeId,
        pairId: edge.pairId,
        relation: edge.relation,
        agentId: edge.agentId,
        toolCallId: edge.toolCallId,
        toolName: edge.toolName,
        calledAt: edge.calledAt,
        fromId: edge.fromId,
        toId: edge.toId,
        fromMemoryId: edge.fromMemoryId,
        toMemoryId: edge.toMemoryId,
        edgeWeight: edge.edgeWeight,
        provenance: edge.provenance,
        candidateIds: freezeDeep(
          [...edge.candidateIds].sort((left, right) => left.localeCompare(right)),
        ),
      }),
    ),
  );
};

const normalizeToolCallEntry = (entry, index, options = {}) => {
  if (!isPlainObject(entry)) {
    throw new TypeError(`Zepia tool call tracking toolCalls[${index}] must be an object`);
  }

  const label = `Zepia tool call tracking toolCalls[${index}]`;
  const explicitAgentId =
    entry.agentId === undefined || entry.agentId === null
      ? null
      : normalizeRequiredString(entry.agentId, `${label}.agentId`);
  const fallbackAgentId = explicitAgentId ?? options.batchAgentId ?? null;
  const toolCallId = normalizeToolCallId(entry, label, options.sessionId ?? null);
  const toolName = normalizeToolName(entry, label);
  const calledAt = normalizeCalledAt(entry, label);
  const sourceReferences = collectSourceReferences(entry, label, fallbackAgentId);
  const targetReferences = collectTargetReferences(entry, label, fallbackAgentId);

  const agentIdCandidates = new Set([
    ...(fallbackAgentId === null ? [] : [fallbackAgentId]),
    ...sourceReferences.map((reference) => reference.agentId),
    ...targetReferences.map((reference) => reference.agentId),
  ]);

  if (agentIdCandidates.size === 0) {
    throw new TypeError(
      `${label}.agentId is required when no source or target reference provides it`,
    );
  }

  if (agentIdCandidates.size > 1) {
    throw new Error(`${label} must stay inside one agent boundary`);
  }

  const [agentId] = [...agentIdCandidates];
  assertAgentBoundary(agentId, sourceReferences, `${label}.sources`);
  assertAgentBoundary(agentId, targetReferences, `${label}.targets`);

  if (targetReferences.length > 0 && sourceReferences.length === 0) {
    throw new Error(
      `${label} must include at least one source memory reference when targets are present`,
    );
  }

  const provenance = normalizeProvenance(entry.provenance, `${label}.provenance`);
  const linkCandidates = [];
  const candidateKeys = new Set();

  sourceReferences.forEach((sourceReference) => {
    targetReferences.forEach((targetReference) => {
      if (sourceReference.stableId === targetReference.stableId) {
        return;
      }

      const candidateKey = `${sourceReference.stableId}->${targetReference.stableId}`;

      if (candidateKeys.has(candidateKey)) {
        return;
      }

      candidateKeys.add(candidateKey);
      linkCandidates.push({
        candidateId: `${toolCallId}|${candidateKey}`,
        pairId: createCanonicalPairId(
          sourceReference.stableId,
          targetReference.stableId,
        ),
        relation: "tool_call_co_reference",
        agentId,
        toolCallId,
        toolName,
        calledAt,
        sourceId: sourceReference.stableId,
        targetId: targetReference.stableId,
        sourceMemoryId: sourceReference.memoryId,
        targetMemoryId: targetReference.memoryId,
        provenance,
      });
    });
  });

  linkCandidates.sort(
    (left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.targetId.localeCompare(right.targetId),
  );
  const coReferenceEdges = createCoReferenceEdges(
    linkCandidates,
    options.toolWeightConfiguration,
  );

  return freezeDeep({
    agentId,
    toolCallId,
    toolName,
    calledAt,
    sourceIds: freezeDeep(sourceReferences.map((reference) => reference.stableId)),
    targetIds: freezeDeep(targetReferences.map((reference) => reference.stableId)),
    sourceMemoryIds: freezeDeep(
      sourceReferences.map((reference) => reference.memoryId),
    ),
    targetMemoryIds: freezeDeep(
      targetReferences.map((reference) => reference.memoryId),
    ),
    provenance,
    linkCandidateCount: linkCandidates.length,
    linkCandidates: freezeDeep(linkCandidates),
    coReferenceEdgeCount: coReferenceEdges.length,
    coReferenceEdges,
  });
};

export const ingestZepiaToolCallTracking = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("Zepia tool call tracking input must be an object");
  }

  const toolWeightConfiguration = resolveToolWeightConfiguration(input);
  const sessionId = normalizeOptionalString(input.sessionId, "Zepia tool call tracking sessionId");
  const batchAgentId =
    input.agentId === undefined || input.agentId === null
      ? null
      : normalizeRequiredString(input.agentId, "Zepia tool call tracking agentId");
  const toolCalls = input.toolCalls;

  if (!Array.isArray(toolCalls)) {
    throw new TypeError("Zepia tool call tracking toolCalls must be an array");
  }

  if (toolCalls.length === 0 && batchAgentId === null) {
    throw new TypeError(
      "Zepia tool call tracking agentId is required when toolCalls is empty",
    );
  }

  const normalizedToolCalls = toolCalls.map((entry, index) =>
    normalizeToolCallEntry(entry, index, {
      batchAgentId,
      sessionId,
      toolWeightConfiguration,
    }),
  );
  const agentIdCandidates = new Set([
    ...(batchAgentId === null ? [] : [batchAgentId]),
    ...normalizedToolCalls.map((toolCall) => toolCall.agentId),
  ]);

  if (agentIdCandidates.size > 1) {
    throw new Error("Zepia tool call tracking batch must stay inside one agent boundary");
  }

  const [agentId] = [...agentIdCandidates];
  const toolCallIdSet = new Set();

  normalizedToolCalls.forEach((toolCall, index) => {
    if (toolCallIdSet.has(toolCall.toolCallId)) {
      throw new Error(
        `Zepia tool call tracking toolCalls[${index}].toolCallId must be unique`,
      );
    }

    toolCallIdSet.add(toolCall.toolCallId);
  });

  const linkCandidates = freezeDeep(
    normalizedToolCalls.flatMap((toolCall) => toolCall.linkCandidates),
  );
  const coReferenceEdges = createCoReferenceEdges(
    linkCandidates,
    toolWeightConfiguration,
  );

  return freezeDeep({
    agentId,
    sessionId,
    toolCallCount: normalizedToolCalls.length,
    linkCandidateCount: linkCandidates.length,
    coReferenceEdgeCount: coReferenceEdges.length,
    toolCallIds: freezeDeep(normalizedToolCalls.map((toolCall) => toolCall.toolCallId)),
    toolCalls: freezeDeep(normalizedToolCalls),
    linkCandidates,
    coReferenceEdges,
  });
};
