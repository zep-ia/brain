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

const freezeRecordList = (records) => Object.freeze([...records]);

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

const normalizeNonEmptyToken = (value, label) =>
  normalizeRequiredString(value, label).toLowerCase();

const normalizePositiveInteger = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return numericValue;
};

const normalizeNullablePositiveInteger = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizePositiveInteger(value, label);
};

const normalizeNonNegativeInteger = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }

  return numericValue;
};

const normalizeBooleanConstant = (value, expectedValue, label) => {
  if (value === undefined || value === null) {
    return expectedValue;
  }

  if (typeof value !== "boolean" || value !== expectedValue) {
    throw new TypeError(`${label} must be ${expectedValue}`);
  }

  return expectedValue;
};

const normalizeStringConstant = (value, expectedValue, label) => {
  if (value === undefined || value === null) {
    return expectedValue;
  }

  if (value !== expectedValue) {
    throw new TypeError(`${label} must be ${expectedValue}`);
  }

  return expectedValue;
};

const createUniqueStringList = (values) => freezeRecordList([...new Set(values)]);

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

const normalizeMetadata = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep(cloneValueDeep(value));
};

const containsOwnValue = (value, fieldName) =>
  isPlainObject(value) &&
  Object.prototype.hasOwnProperty.call(value, fieldName) &&
  value[fieldName] !== undefined &&
  value[fieldName] !== null;

const assertNoExecutorLogic = (value, label) => {
  if (!isPlainObject(value)) {
    return;
  }

  for (const fieldName of ["executor", "execute", "handler", "runner", "dispatch"]) {
    if (containsOwnValue(value, fieldName)) {
      throw new TypeError(
        `${label} must not embed executor logic via ${fieldName}`,
      );
    }
  }
};

const normalizeOrderingStrategy = (value, label) => {
  const normalizedValue = normalizeNonEmptyToken(
    value ?? DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
    label,
  );

  if (!OFFLINE_BATCH_ORDERING_STRATEGIES.includes(normalizedValue)) {
    throw new TypeError(
      `${label} must be one of ${OFFLINE_BATCH_ORDERING_STRATEGIES.join(", ")}`,
    );
  }

  return normalizedValue;
};

const normalizeOverwriteTargetId = (value, label) => {
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

const normalizeOverwriteTarget = (value, label) => {
  if (isPlainObject(value)) {
    const targetIdInput =
      value.targetId ??
      value.memoryId ??
      value.archiveId ??
      value.recordId ??
      value.key;
    const targetId = normalizeOverwriteTargetId(targetIdInput, `${label}.targetId`);
    const scope = normalizeOptionalString(
      value.scope ?? value.kind,
      `${label}.scope`,
    );

    return scope ? `${normalizeNonEmptyToken(scope, `${label}.scope`)}:${targetId}` : targetId;
  }

  return normalizeOverwriteTargetId(value, label);
};

const normalizeOverwriteTargets = (value, label) => {
  if (value === undefined || value === null) {
    return freezeRecordList([]);
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return createUniqueStringList(
    value.map((entry, index) => normalizeOverwriteTarget(entry, `${label}[${index}]`)),
  );
};

const normalizeRuntimePhaseValue = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeNonEmptyToken(value, label);
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a string or object`);
  }

  return normalizeNonEmptyToken(
    value.value ?? value.phase ?? value.name,
    `${label}.value`,
  );
};

const sortWorkUnits = (workUnits) =>
  [...workUnits].sort((left, right) => {
    if (left.order.priority !== right.order.priority) {
      return right.order.priority - left.order.priority;
    }

    if (left.order.sequence !== right.order.sequence) {
      return left.order.sequence - right.order.sequence;
    }

    if (left.order.sortKey !== right.order.sortKey) {
      return left.order.sortKey.localeCompare(right.order.sortKey);
    }

    return left.workUnitId.localeCompare(right.workUnitId);
  });

const inferCoordinationSignal = (coordinationSignal, workUnits) => {
  if (coordinationSignal !== undefined && coordinationSignal !== null) {
    return normalizeNonEmptyToken(coordinationSignal, "coordinationSignal");
  }

  const uniqueSignals = createUniqueStringList(
    workUnits.map((workUnit) => workUnit.coordinationSignal),
  );

  if (uniqueSignals.length === 1) {
    return uniqueSignals[0];
  }

  return uniqueSignals.length === 0 ? "independent" : "mixed";
};

export {
  normalizeBatchPlanExpression,
  parseBatchPlanExpression,
  tokenizeBatchPlanExpression,
} from "./batch-plan-expression.js";

export const OFFLINE_BATCH_ORDERING_STRATEGIES = freezeDeep([
  "priority-descending-then-sequence",
  "sequence-only",
]);

export const DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY =
  "priority-descending-then-sequence";

export const createOfflineBatchLimit = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("offline batch limit options must be an object");
  }

  assertNoExecutorLogic(options, "offline batch limit");

  return freezeDeep({
    limitId: normalizeRequiredString(
      options.limitId ?? "offline-batch-limit",
      "limitId",
    ),
    targetProfile: normalizeNonEmptyToken(
      options.targetProfile ?? options.profile ?? "generic-offline",
      "targetProfile",
    ),
    acceleratorClass: normalizeNonEmptyToken(
      options.acceleratorClass ?? "generic-offline",
      "acceleratorClass",
    ),
    orderingStrategy: normalizeOrderingStrategy(
      options.orderingStrategy,
      "orderingStrategy",
    ),
    maxAgentsPerBatch: normalizeNullablePositiveInteger(
      options.maxAgentsPerBatch,
      "maxAgentsPerBatch",
    ),
    maxWorkUnitsPerBatch: normalizeNullablePositiveInteger(
      options.maxWorkUnitsPerBatch,
      "maxWorkUnitsPerBatch",
    ),
    maxOverwriteTargetsPerBatch: normalizeNullablePositiveInteger(
      options.maxOverwriteTargetsPerBatch,
      "maxOverwriteTargetsPerBatch",
    ),
    maxOverwriteTargetsPerWorkUnit: normalizeNullablePositiveInteger(
      options.maxOverwriteTargetsPerWorkUnit,
      "maxOverwriteTargetsPerWorkUnit",
    ),
    maxIdentityScopesPerBatch: normalizeNullablePositiveInteger(
      options.maxIdentityScopesPerBatch,
      "maxIdentityScopesPerBatch",
    ),
    requiresRuntimeAuthorization: normalizeBooleanConstant(
      options.requiresRuntimeAuthorization,
      true,
      "requiresRuntimeAuthorization",
    ),
    heuristicsAuthorizeExecution: normalizeBooleanConstant(
      options.heuristicsAuthorizeExecution,
      false,
      "heuristicsAuthorizeExecution",
    ),
    teamIdleCoordinatesOnly: normalizeBooleanConstant(
      options.teamIdleCoordinatesOnly,
      true,
      "teamIdleCoordinatesOnly",
    ),
    identityIsolationMode: normalizeStringConstant(
      options.identityIsolationMode,
      "agent-scoped",
      "identityIsolationMode",
    ),
    requiresIndependentWrites: normalizeBooleanConstant(
      options.requiresIndependentWrites,
      true,
      "requiresIndependentWrites",
    ),
    executionMode: normalizeStringConstant(
      options.executionMode,
      "offline-plan-only",
      "executionMode",
    ),
    executorBinding: normalizeStringConstant(
      options.executorBinding,
      "external",
      "executorBinding",
    ),
    liveWorkingLoopCoupling: normalizeStringConstant(
      options.liveWorkingLoopCoupling,
      "offline-decoupled",
      "liveWorkingLoopCoupling",
    ),
    numericThroughputBenchmarkRequired: normalizeBooleanConstant(
      options.numericThroughputBenchmarkRequired,
      false,
      "numericThroughputBenchmarkRequired",
    ),
    notes: normalizeOptionalString(options.notes, "notes"),
  });
};

export const DEFAULT_B200_OFFLINE_BATCH_LIMIT = createOfflineBatchLimit({
  limitId: "b200-style-offline-batch-limit",
  targetProfile: "b200-style",
  acceleratorClass: "b200-style",
  notes:
    "Architecture-level batch limit profile for B200-style offline consolidation. Numeric throughput benchmarks remain intentionally unspecified in this iteration.",
});

export const createOfflineBatchWorkUnit = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("offline batch work unit options must be an object");
  }

  assertNoExecutorLogic(options, "offline batch work unit");

  const workUnitId = normalizeRequiredString(
    options.workUnitId ?? options.unitId,
    "workUnitId",
  );
  const agentId = normalizeRequiredString(options.agentId, "agentId");
  const sequence = normalizeNonNegativeInteger(
    options.order?.sequence ?? options.sequence ?? 0,
    "order.sequence",
  );
  const priority = normalizeNonNegativeInteger(
    options.order?.priority ?? options.priority ?? 0,
    "order.priority",
  );
  const sortKey =
    normalizeOptionalString(
      options.order?.sortKey ?? options.sortKey,
      "order.sortKey",
    ) ?? `${agentId}:${workUnitId}`;
  const overwriteTargets = normalizeOverwriteTargets(
    options.overwriteTargets,
    "overwriteTargets",
  );
  const overwriteTargetCount = overwriteTargets.length;

  return freezeDeep({
    workUnitId,
    batchId: normalizeOptionalString(options.batchId, "batchId"),
    agentId,
    operation: normalizeNonEmptyToken(
      options.operation ?? "offline-consolidation",
      "operation",
    ),
    coordinationSignal: normalizeNonEmptyToken(
      options.coordinationSignal ?? "independent",
      "coordinationSignal",
    ),
    executionMode: "offline-plan-only",
    executorBinding: "external",
    liveWorkingLoopCoupling: "offline-decoupled",
    identityIsolationMode: "agent-scoped",
    identityScopeKey: normalizeRequiredString(
      options.identityScopeKey ?? `agent:${agentId}`,
      "identityScopeKey",
    ),
    overwriteNamespace: normalizeRequiredString(
      options.overwriteNamespace ?? `agent:${agentId}`,
      "overwriteNamespace",
    ),
    overwriteTargets,
    overwriteTargetCount,
    runtimePhase: normalizeRuntimePhaseValue(
      options.runtimePhase,
      "runtimePhase",
    ),
    order: freezeDeep({
      priority,
      sequence,
      sortKey,
    }),
    capacityCost: freezeDeep({
      agentCount: 1,
      workUnitCount: 1,
      overwriteTargetCount,
      identityScopeCount: 1,
    }),
    requiresRuntimeAuthorization: true,
    metadata: normalizeMetadata(options.metadata, "metadata"),
  });
};

export const createOfflineBatchPlan = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("offline batch plan options must be an object");
  }

  assertNoExecutorLogic(options, "offline batch plan");

  const workUnitsInput = options.workUnits ?? [];

  if (!Array.isArray(workUnitsInput)) {
    throw new TypeError("workUnits must be an array");
  }

  const workUnits = sortWorkUnits(
    workUnitsInput.map((workUnit, index) =>
      createOfflineBatchWorkUnit({
        ...workUnit,
        sequence: workUnit?.sequence ?? workUnit?.order?.sequence ?? index,
      }),
    ),
  );
  const limit = createOfflineBatchLimit(
    options.limit ?? DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  );
  const agentIds = createUniqueStringList(
    workUnits.map((workUnit) => workUnit.agentId),
  );
  const identityScopeKeys = createUniqueStringList(
    workUnits.map((workUnit) => workUnit.identityScopeKey),
  );
  const overwriteTargetCount = workUnits.reduce(
    (runningTotal, workUnit) => runningTotal + workUnit.overwriteTargetCount,
    0,
  );
  const maxOverwriteTargetsPerWorkUnitObserved = workUnits.reduce(
    (maximum, workUnit) => Math.max(maximum, workUnit.overwriteTargetCount),
    0,
  );
  const capacityUsage = freezeDeep({
    agentCount: agentIds.length,
    workUnitCount: workUnits.length,
    overwriteTargetCount,
    identityScopeCount: identityScopeKeys.length,
    maxOverwriteTargetsPerWorkUnitObserved,
  });
  const capacityViolations = [];

  if (
    limit.maxAgentsPerBatch !== null &&
    capacityUsage.agentCount > limit.maxAgentsPerBatch
  ) {
    capacityViolations.push("max-agents-per-batch-exceeded");
  }

  if (
    limit.maxWorkUnitsPerBatch !== null &&
    capacityUsage.workUnitCount > limit.maxWorkUnitsPerBatch
  ) {
    capacityViolations.push("max-work-units-per-batch-exceeded");
  }

  if (
    limit.maxOverwriteTargetsPerBatch !== null &&
    capacityUsage.overwriteTargetCount > limit.maxOverwriteTargetsPerBatch
  ) {
    capacityViolations.push("max-overwrite-targets-per-batch-exceeded");
  }

  if (
    limit.maxOverwriteTargetsPerWorkUnit !== null &&
    capacityUsage.maxOverwriteTargetsPerWorkUnitObserved >
      limit.maxOverwriteTargetsPerWorkUnit
  ) {
    capacityViolations.push("max-overwrite-targets-per-work-unit-exceeded");
  }

  if (
    limit.maxIdentityScopesPerBatch !== null &&
    capacityUsage.identityScopeCount > limit.maxIdentityScopesPerBatch
  ) {
    capacityViolations.push("max-identity-scopes-per-batch-exceeded");
  }

  return freezeDeep({
    planId: normalizeRequiredString(options.planId, "planId"),
    coordinationSignal: inferCoordinationSignal(options.coordinationSignal, workUnits),
    executionMode: "offline-plan-only",
    executorBinding: "external",
    liveWorkingLoopCoupling: "offline-decoupled",
    limit,
    workUnits: freezeRecordList(workUnits),
    workUnitCount: workUnits.length,
    orderedWorkUnitIds: freezeRecordList(
      workUnits.map((workUnit) => workUnit.workUnitId),
    ),
    agentIds,
    agentCount: agentIds.length,
    capacityUsage,
    capacityViolations: freezeRecordList(capacityViolations),
    withinCapacity: capacityViolations.length === 0,
    requiresRuntimeAuthorization: true,
    heuristicsAuthorizeExecution: false,
    metadata: normalizeMetadata(options.metadata, "metadata"),
  });
};
