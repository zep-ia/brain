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

const normalizeOptionalString = (value, fallback, label) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  return normalizeRequiredString(value, label);
};

const normalizeStringList = (value, fallback, label) => {
  const input = value === undefined || value === null ? fallback : value;

  if (!Array.isArray(input)) {
    throw new TypeError(`${label} must be an array`);
  }

  return freezeDeep(
    [...new Set(input.map((entry, index) => normalizeRequiredString(entry, `${label}[${index}]`)))],
  );
};

const assertBooleanConstant = (value, expected, label) => {
  if (value === undefined || value === null) {
    return expected;
  }

  if (value !== expected) {
    throw new TypeError(`${label} must remain ${String(expected)}`);
  }

  return expected;
};

const assertStringConstant = (value, expected, label) => {
  const normalizedValue = normalizeOptionalString(value, expected, label);

  if (normalizedValue !== expected) {
    throw new TypeError(`${label} must remain ${expected}`);
  }

  return expected;
};

const normalizeAllowedString = (value, fallback, allowedValues, label, message) => {
  const normalizedValue = normalizeOptionalString(value, fallback, label);

  if (!allowedValues.includes(normalizedValue)) {
    throw new TypeError(message ?? `${label} must be one of: ${allowedValues.join(", ")}`);
  }

  return normalizedValue;
};

const normalizeAllowedStringList = (value, fallback, allowedValues, label, message) => {
  const normalizedValues = normalizeStringList(value, fallback, label);
  const invalidValues = normalizedValues.filter((entry) => !allowedValues.includes(entry));

  if (invalidValues.length > 0) {
    throw new TypeError(message ?? `${label} contains unsupported values: ${invalidValues.join(", ")}`);
  }

  return normalizedValues;
};

export const GEMMA4_B200_ELECTRIC_PLAN_SCHEMA_ID =
  "gemma4_b200_electric_consolidation_plan";

export const GEMMA4_B200_ELECTRIC_SAFE_RUNTIME_TRANSPORTS = freezeDeep([
  "rpc",
  "grpc",
  "connect-rpc",
  "http-rpc",
  "unix-socket-rpc",
]);

export const GEMMA4_B200_ELECTRIC_WORKER_OPERATIONS = freezeDeep([
  "embedding-generation",
  "memory-candidate-reranking",
  "hippocampus-summary-distillation",
  "near-duplicate-clustering",
  "stale-memory-detection",
  "contradiction-screening",
]);

export const createGemma4B200ElectricConsolidationPlan = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Gemma 4 B200 Electric plan options must be an object");
  }

  const runtimeBoundary = isPlainObject(options.runtimeBoundary)
    ? options.runtimeBoundary
    : {};
  const writePath = isPlainObject(options.writePath) ? options.writePath : {};
  const electric = isPlainObject(options.electric) ? options.electric : {};
  const workerPipeline = isPlainObject(options.workerPipeline)
    ? options.workerPipeline
    : {};
  const model = isPlainObject(options.model) ? options.model : {};
  const accelerator = isPlainObject(options.accelerator)
    ? options.accelerator
    : {};

  return freezeDeep({
    schemaId: GEMMA4_B200_ELECTRIC_PLAN_SCHEMA_ID,
    schemaVersion: "1.0.0",
    planId: normalizeOptionalString(
      options.planId,
      "gemma4-b200-electric-offline-consolidation",
      "planId",
    ),
    purpose:
      "Use Electric as the durable stream/read-sync plane while Gemma 4 on B200 handles offline hippocampus-style memory consolidation work.",
    runtimeBoundary: {
      transport: normalizeAllowedString(
        runtimeBoundary.transport,
        "rpc",
        GEMMA4_B200_ELECTRIC_SAFE_RUNTIME_TRANSPORTS,
        "runtimeBoundary.transport",
        "runtimeBoundary.transport must remain an RPC-safe transport",
      ),
      zepiaToBrainUsesRdma: assertBooleanConstant(
        runtimeBoundary.zepiaToBrainUsesRdma,
        false,
        "zepiaToBrainUsesRdma",
      ),
      authority: "caller-authorized-offline-window",
      authorizedRuntimePhases: freezeDeep(["idle", "rest", "break", "sleep"]),
    },
    electric: {
      role: "durable-stream-and-read-sync-plane",
      streamProtocol: "http-append-only-offset-stream",
      syncPrimitive: "postgres-shape-read-sync",
      streamIds: normalizeStringList(
        options.streamIds ?? electric.streamIds,
        ["agent-events"],
        "electric.streamIds",
      ),
      postgresTables: normalizeStringList(
        options.postgresTables ?? electric.postgresTables,
        [
          "agent_events",
          "tool_calls",
          "memory_candidates",
          "short_term_memory",
          "long_term_memory",
          "consolidation_jobs",
          "consolidation_runs",
          "stream_checkpoints",
        ],
        "electric.postgresTables",
      ),
    },
    model: {
      modelFamily: assertStringConstant(
        model.modelFamily,
        "gemma-4",
        "model.modelFamily",
      ),
      servingRole: "local-private-memory-intelligence",
      expectedCapabilities: freezeDeep([
        "embeddings",
        "reranking",
        "summarization",
        "classification",
        "semantic-deduplication",
      ]),
    },
    accelerator: {
      acceleratorClass: assertStringConstant(
        accelerator.acceleratorClass,
        "b200",
        "accelerator.acceleratorClass",
      ),
      placement: "offline-worker-pool",
      rdmaScope: "inside-brain-worker-pool-only",
    },
    identityIsolation: {
      mode: "agent-scoped",
      teamIdleMergesIdentity: false,
      overwriteNamespace: "agent-scoped",
      requiresIndependentWrites: true,
    },
    workerPipeline: {
      executionMode: "offline-plan-only",
      liveWorkingLoopCoupling: "offline-decoupled",
      operations: normalizeAllowedStringList(
        workerPipeline.operations,
        GEMMA4_B200_ELECTRIC_WORKER_OPERATIONS,
        GEMMA4_B200_ELECTRIC_WORKER_OPERATIONS,
        "workerPipeline.operations",
        "workerPipeline.operations must use supported offline operations",
      ),
    },
    checkpointPolicy: {
      cursorScope: "agentId+syncSource+streamId",
      advanceAfterDurableWrite: true,
      failedConsolidationAdvancesCheckpoint: false,
      replayPreference: "replay-is-safer-than-gap",
    },
    writePath: {
      electricOwnsWrites: assertBooleanConstant(
        writePath.electricOwnsWrites,
        false,
        "electricOwnsWrites",
      ),
      durableWriter: normalizeOptionalString(
        writePath.durableWriter,
        "brain-service-or-existing-backend",
        "writePath.durableWriter",
      ),
      syncAfterWrite: "postgres-logical-replication-to-electric-shapes",
    },
  });
};
