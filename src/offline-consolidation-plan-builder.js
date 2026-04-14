import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
  createOfflineBatchWorkUnit,
} from "./batch-plan.js";
import {
  createIdleWindowSuggestion,
  createRuntimePhase,
  evaluateIdleWindowAuthorization,
} from "./runtime-phase.js";

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

const normalizeOptionalBoolean = (value, label, defaultValue = null) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }

  return value;
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

const OFFLINE_BATCH_API_FIELD_NAMES = freezeRecordList([
  "limit",
  "workUnits",
  "workUnitId",
  "orderedWorkUnitIds",
  "capacityUsage",
  "capacityCost",
  "overwriteTargets",
  "overwriteNamespace",
  "identityScopeKey",
  "dispatchWorkUnit",
  "maxAgentsPerBatch",
  "maxWorkUnitsPerBatch",
  "maxOverwriteTargetsPerBatch",
  "maxOverwriteTargetsPerWorkUnit",
  "maxIdentityScopesPerBatch",
]);

const assertSeparateFromOfflineBatchApi = (value, label) => {
  if (!isPlainObject(value)) {
    return;
  }

  for (const fieldName of OFFLINE_BATCH_API_FIELD_NAMES) {
    if (containsOwnValue(value, fieldName)) {
      throw new TypeError(
        `${label} must remain separate from shared batch-plan API via ${fieldName}`,
      );
    }
  }
};

const assertAllowedFieldNames = (value, allowedFieldNames, label) => {
  if (!isPlainObject(value)) {
    return;
  }

  const unexpectedKey = Object.keys(value).find(
    (fieldName) => !allowedFieldNames.includes(fieldName),
  );

  if (unexpectedKey) {
    throw new TypeError(
      `${label} contains unsupported field "${unexpectedKey}"`,
    );
  }
};

const normalizeStringEnum = (value, label, allowedValues) => {
  const normalizedValue = normalizeNonEmptyToken(value, label);

  if (!allowedValues.includes(normalizedValue)) {
    throw new TypeError(`${label} must be one of ${allowedValues.join(", ")}`);
  }

  return normalizedValue;
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

  if (normalizeRequiredString(value, label) !== expectedValue) {
    throw new TypeError(`${label} must be ${expectedValue}`);
  }

  return expectedValue;
};

const normalizeNonEmptyStringList = (value, label) => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  const normalizedValues = value.map((entry, index) =>
    normalizeRequiredString(entry, `${label}[${index}]`),
  );

  if (normalizedValues.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }

  return createUniqueStringList(normalizedValues);
};

const normalizeEnumList = (value, label, allowedValues) =>
  createUniqueStringList(
    normalizeNonEmptyStringList(value, label).map((entry, index) =>
      normalizeStringEnum(entry, `${label}[${index}]`, allowedValues),
    ),
  );

const normalizePriorityMemoryId = (value, label) => {
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

const normalizePriorityMemoryIds = (value, label) => {
  if (value === undefined || value === null) {
    return freezeRecordList([]);
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return createUniqueStringList(
    value.map((entry, index) =>
      normalizePriorityMemoryId(entry, `${label}[${index}]`),
    ),
  );
};

const normalizeRuntimePhase = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return freezeDeep(
      typeof value === "string" ? createRuntimePhase(value) : createRuntimePhase(
        value.value ?? value.phase ?? value.name,
        value,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid runtime phase";
    throw new TypeError(`${label} is invalid: ${message}`);
  }
};

const normalizeInactivitySuggestion = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  try {
    return freezeDeep(createIdleWindowSuggestion(value));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid inactivity suggestion";
    throw new TypeError(`${label} is invalid: ${message}`);
  }
};

const normalizeNullableContextString = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
};

const createOfflineConsolidationBatchPlanGateError = (
  message,
  stage,
  reasonCode,
  details = {},
) => {
  const error = new TypeError(message);

  error.name = "OfflineConsolidationBatchPlanGateError";
  error.offlineConsolidationBatchPlanGate = freezeDeep({
    stage,
    reasonCode,
    blockedReason:
      typeof details.blockedReason === "string" ? details.blockedReason : null,
    request: details.request ?? null,
  });

  return error;
};

const isOfflineConsolidationBatchPlanGateError = (error) =>
  error instanceof Error &&
  isPlainObject(error.offlineConsolidationBatchPlanGate) &&
  typeof error.offlineConsolidationBatchPlanGate.stage === "string" &&
  typeof error.offlineConsolidationBatchPlanGate.reasonCode === "string";

const wrapOfflineConsolidationBatchPlanGateError = (
  error,
  stage,
  reasonCode,
  details = {},
) => {
  if (isOfflineConsolidationBatchPlanGateError(error)) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : "unexpected offline consolidation batch-plan validation failure";

  return createOfflineConsolidationBatchPlanGateError(
    message,
    stage,
    reasonCode,
    details,
  );
};

const createOfflineConsolidationBatchPlanRequestContext = (options) => {
  if (!isPlainObject(options)) {
    return freezeDeep({
      requestId: null,
      agentId: null,
      planId: null,
    });
  }

  const requestInput = isPlainObject(options.request) ? options.request : options;

  return freezeDeep({
    requestId: normalizeNullableContextString(requestInput.requestId),
    agentId: normalizeNullableContextString(requestInput.agentId),
    planId: normalizeNullableContextString(options.planId),
  });
};

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS = freezeDeep([
  "idle",
  "sleep",
]);

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES = freezeDeep([
  "conservative",
  "balanced",
  "extended",
]);

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE =
  freezeDeep(["young", "old"]);

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES = freezeDeep([
  "young-working-memory",
  "young-short-term-memory",
  "old-long-term-memory",
  "old-archived-memory",
]);

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS = freezeDeep([
  "mask-stale-young-memory",
  "archive-stale-memory",
  "promote-stable-young-memory",
  "reinforce-old-memory",
  "review-superseded-memory",
  "preserve-learned-traits",
]);

const OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS = freezeDeep([
  "independent",
  "team-idle",
]);

const OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_ALLOWED_FIELDS =
  freezeRecordList([
    "requestId",
    "version",
    "agentId",
    "presetId",
    "preset",
    "presetCatalog",
    "presetCatalogId",
    "presetVersion",
    "runtimeWindow",
    "runtimePhase",
    "inactivitySuggestion",
    "teamIdle",
    "coordinationHint",
    "priorityMemoryIds",
    "batchProfileId",
    "contractLayer",
    "outputPlanApi",
    "authorizationModel",
    "heuristicsPolicy",
    "teamCoordinationPolicy",
    "scope",
    "immutableIdentityPolicy",
    "learnedTraitPolicy",
    "allowIdentityPromotion",
    "workingLoopIsolation",
    "numericThroughputBenchmarkRequired",
    "metadata",
  ]);

export const DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID =
  "idle-balanced-consolidation";

export const createOfflineConsolidationPlanBuilderPreset = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "offline consolidation plan-builder preset options must be an object",
    );
  }

  assertNoExecutorLogic(options, "offline consolidation plan-builder preset");
  assertSeparateFromOfflineBatchApi(
    options,
    "offline consolidation plan-builder preset",
  );

  return freezeDeep({
    presetId: normalizeRequiredString(options.presetId, "presetId"),
    version: normalizeRequiredString(options.version ?? "1.0.0", "version"),
    displayName: normalizeRequiredString(options.displayName, "displayName"),
    description: normalizeRequiredString(options.description, "description"),
    runtimeWindow: normalizeStringEnum(
      options.runtimeWindow ?? "idle",
      "runtimeWindow",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
    ),
    intensity: normalizeStringEnum(
      options.intensity ?? "balanced",
      "intensity",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES,
    ),
    generationCoverage: normalizeEnumList(
      options.generationCoverage ?? ["young"],
      "generationCoverage",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE,
    ),
    candidateSources: normalizeEnumList(
      options.candidateSources ?? ["young-short-term-memory"],
      "candidateSources",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES,
    ),
    planningGoals: normalizeEnumList(
      options.planningGoals ?? ["promote-stable-young-memory"],
      "planningGoals",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS,
    ),
    batchProfileId: normalizeRequiredString(
      options.batchProfileId ?? DEFAULT_B200_OFFLINE_BATCH_LIMIT.limitId,
      "batchProfileId",
    ),
    contractLayer: "plan-builder",
    outputPlanApi: "offline-batch-plan",
    authorizationModel: "runtime-phase-only",
    heuristicsPolicy: "suggest-only",
    teamCoordinationPolicy: "batch-only",
    scope: "agent-scoped",
    immutableIdentityPolicy: "runtime-invariants-only",
    learnedTraitPolicy: "long-term-memory-only",
    allowIdentityPromotion: false,
    workingLoopIsolation: "offline-decoupled",
    numericThroughputBenchmarkRequired: false,
    notes: normalizeOptionalString(options.notes, "notes"),
  });
};

const DEFAULT_PLAN_BUILDER_PRESET_DEFINITIONS = freezeDeep([
  {
    presetId: "idle-young-triage",
    displayName: "Idle Young Triage",
    description:
      "Short idle-window preset that limits planning to young-generation cleanup and lightweight promotion opportunities.",
    runtimeWindow: "idle",
    intensity: "conservative",
    generationCoverage: ["young"],
    candidateSources: ["young-working-memory", "young-short-term-memory"],
    planningGoals: [
      "mask-stale-young-memory",
      "promote-stable-young-memory",
      "preserve-learned-traits",
    ],
  },
  {
    presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
    displayName: "Idle Balanced Consolidation",
    description:
      "Standard idle-window preset that balances young-generation cleanup with selective old-generation reinforcement planning.",
    runtimeWindow: "idle",
    intensity: "balanced",
    generationCoverage: ["young", "old"],
    candidateSources: [
      "young-working-memory",
      "young-short-term-memory",
      "old-long-term-memory",
    ],
    planningGoals: [
      "mask-stale-young-memory",
      "archive-stale-memory",
      "promote-stable-young-memory",
      "reinforce-old-memory",
      "preserve-learned-traits",
    ],
  },
  {
    presetId: "sleep-extended-maintenance",
    displayName: "Sleep Extended Maintenance",
    description:
      "Sleep-window preset for the deepest offline maintenance sweep across young and old generations, including archival review.",
    runtimeWindow: "sleep",
    intensity: "extended",
    generationCoverage: ["young", "old"],
    candidateSources: [
      "young-working-memory",
      "young-short-term-memory",
      "old-long-term-memory",
      "old-archived-memory",
    ],
    planningGoals: [
      "mask-stale-young-memory",
      "archive-stale-memory",
      "promote-stable-young-memory",
      "reinforce-old-memory",
      "review-superseded-memory",
      "preserve-learned-traits",
    ],
  },
]);

export const createOfflineConsolidationPlanBuilderPresetCatalog = (
  options = {},
) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "offline consolidation plan-builder preset catalog options must be an object",
    );
  }

  assertNoExecutorLogic(
    options,
    "offline consolidation plan-builder preset catalog",
  );
  assertSeparateFromOfflineBatchApi(
    options,
    "offline consolidation plan-builder preset catalog",
  );

  const presetDefinitions =
    options.presets === undefined || options.presets === null
      ? DEFAULT_PLAN_BUILDER_PRESET_DEFINITIONS
      : Array.isArray(options.presets)
        ? options.presets
        : isPlainObject(options.presets) && Array.isArray(options.presetIds)
          ? options.presetIds.map((presetId, index) => {
              const normalizedPresetId = normalizeRequiredString(
                presetId,
                `presetIds[${index}]`,
              );
              const preset = options.presets[normalizedPresetId];

              if (!preset) {
                throw new TypeError(
                  `presetIds[${index}] does not resolve to a configured preset`,
                );
              }

              return preset;
            })
          : null;

  if (!Array.isArray(presetDefinitions)) {
    throw new TypeError("presets must be an array or a preset catalog index");
  }

  const presets = presetDefinitions.map((preset) =>
    createOfflineConsolidationPlanBuilderPreset({
      ...preset,
      version: preset?.version ?? options.version ?? "1.0.0",
    }),
  );
  const presetIdCounts = presets.reduce((counts, preset) => {
    counts.set(preset.presetId, (counts.get(preset.presetId) ?? 0) + 1);
    return counts;
  }, new Map());

  presets.forEach((preset) => {
    if ((presetIdCounts.get(preset.presetId) ?? 0) > 1) {
      throw new TypeError(`duplicate presetId is not allowed: ${preset.presetId}`);
    }
  });

  const defaultPresetId = normalizeRequiredString(
    options.defaultPresetId ?? presets[0]?.presetId,
    "defaultPresetId",
  );
  const presetIndex = freezeDeep(
    Object.fromEntries(presets.map((preset) => [preset.presetId, preset])),
  );

  if (!Object.prototype.hasOwnProperty.call(presetIndex, defaultPresetId)) {
    throw new TypeError(
      `defaultPresetId must match one of the configured presets: ${defaultPresetId}`,
    );
  }

  return freezeDeep({
    catalogId: normalizeRequiredString(
      options.catalogId ?? "offline-consolidation-plan-builder-presets",
      "catalogId",
    ),
    version: normalizeRequiredString(options.version ?? "1.0.0", "version"),
    defaultPresetId,
    presetIds: freezeRecordList(presets.map((preset) => preset.presetId)),
    presetCount: presets.length,
    presets: presetIndex,
    contractLayer: "plan-builder",
    outputPlanApi: "offline-batch-plan",
    workingLoopIsolation: "offline-decoupled",
    numericThroughputBenchmarkRequired: false,
  });
};

export const DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG =
  createOfflineConsolidationPlanBuilderPresetCatalog({
    defaultPresetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  });

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS =
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.presetIds;

export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA = freezeDeep({
  schemaId: "agent_brain_offline_consolidation_request",
  version: "1.0.0",
  description:
    "Normalized caller-facing request contract for offline consolidation planning. It stays data-only, rejects unsafe execution overrides, and remains separate from the shared batch-plan API.",
  fields: {
    requestId: {
      type: "string",
      required: true,
    },
    version: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    presetCatalogId: {
      type: "string",
      required: true,
    },
    presetId: {
      type: "string",
      required: true,
    },
    presetVersion: {
      type: "string",
      required: true,
    },
    preset: {
      type: "object",
      required: true,
      description:
        "Resolved high-level preset describing runtime window, stage intensity, candidate sources, and planning goals.",
    },
    runtimeWindow: {
      type: "enum",
      required: true,
      values: OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
    },
    runtimePhase: {
      type: "object|null",
      required: true,
      description:
        "Caller-controlled runtime-phase envelope used later for authorization checks.",
    },
    inactivitySuggestion: {
      type: "object|null",
      required: true,
      description:
        "Advisory inactivity heuristic metadata retained for audit without authorizing consolidation.",
    },
    teamIdle: {
      type: "boolean",
      required: true,
    },
    coordinationHint: {
      type: "enum",
      required: true,
      values: OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
    },
    priorityMemoryIds: {
      type: "string[]",
      required: true,
    },
    batchProfileId: {
      type: "string",
      required: true,
    },
    contractLayer: {
      type: "string",
      required: true,
      const: "plan-builder",
    },
    outputPlanApi: {
      type: "string",
      required: true,
      const: "offline-batch-plan",
    },
    authorizationModel: {
      type: "string",
      required: true,
      const: "runtime-phase-only",
    },
    heuristicsPolicy: {
      type: "string",
      required: true,
      const: "suggest-only",
    },
    teamCoordinationPolicy: {
      type: "string",
      required: true,
      const: "batch-only",
    },
    scope: {
      type: "string",
      required: true,
      const: "agent-scoped",
    },
    immutableIdentityPolicy: {
      type: "string",
      required: true,
      const: "runtime-invariants-only",
    },
    learnedTraitPolicy: {
      type: "string",
      required: true,
      const: "long-term-memory-only",
    },
    allowIdentityPromotion: {
      type: "boolean",
      required: true,
      const: false,
    },
    workingLoopIsolation: {
      type: "string",
      required: true,
      const: "offline-decoupled",
    },
    numericThroughputBenchmarkRequired: {
      type: "boolean",
      required: true,
      const: false,
    },
    metadata: {
      type: "object|null",
      required: true,
    },
  },
});

export const OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS = freezeDeep([
  "young-generation-triage",
  "young-generation-promotion",
  "old-generation-reinforcement",
  "archived-memory-review",
  "learned-trait-preservation",
]);

export const OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS = freezeDeep({
  "young-generation-triage": "offline-consolidation-young-generation-triage",
  "young-generation-promotion":
    "offline-consolidation-young-generation-promotion",
  "old-generation-reinforcement":
    "offline-consolidation-old-generation-reinforcement",
  "archived-memory-review": "offline-consolidation-archived-memory-review",
  "learned-trait-preservation":
    "offline-consolidation-learned-trait-preservation",
});

const OFFLINE_CONSOLIDATION_BATCH_PLAN_IDLE_PHASES = freezeDeep([
  "idle",
  "rest",
  "break",
]);

const OFFLINE_CONSOLIDATION_BATCH_PLAN_PRIORITY_BY_INTENSITY = freezeDeep({
  conservative: 100,
  balanced: 200,
  extended: 300,
});

const OFFLINE_CONSOLIDATION_BATCH_PLAN_PRIORITY_BY_STAGE = freezeDeep({
  "young-generation-triage": 50,
  "young-generation-promotion": 40,
  "learned-trait-preservation": 30,
  "old-generation-reinforcement": 20,
  "archived-memory-review": 10,
});

const OFFLINE_CONSOLIDATION_BATCH_PLAN_REQUIRED_METADATA_FIELDS =
  freezeRecordList([
    "requestId",
    "requestVersion",
    "presetCatalogId",
    "presetId",
    "presetVersion",
    "runtimeWindow",
    "runtimePhase",
    "inactivitySuggestion",
    "authorization",
    "coordinationHint",
    "teamIdle",
    "intensity",
    "generationCoverage",
    "candidateSources",
    "planningGoals",
    "stageIds",
    "priorityMemoryIds",
    "batchProfileId",
    "authorizationModel",
    "heuristicsPolicy",
    "teamCoordinationPolicy",
    "immutableIdentityPolicy",
    "learnedTraitPolicy",
    "allowIdentityPromotion",
    "requestMetadata",
    "batchPlanMetadata",
  ]);

const OFFLINE_CONSOLIDATION_BATCH_PLAN_WORK_UNIT_REQUIRED_METADATA_FIELDS =
  freezeRecordList([
    "stageId",
    "requestId",
    "presetId",
    "presetVersion",
    "runtimeWindow",
    "intensity",
    "generationCoverage",
    "candidateSources",
    "planningGoals",
    "priorityMemoryIds",
    "authorization",
    "immutableIdentityPolicy",
    "learnedTraitPolicy",
    "allowIdentityPromotion",
    "requestMetadata",
  ]);

const filterRequestedEntries = (requestedEntries, allowedEntries) =>
  freezeRecordList(
    requestedEntries.filter((entry) => allowedEntries.includes(entry)),
  );

const deriveGenerationCoverageFromCandidateSources = (candidateSources) =>
  createUniqueStringList(
    candidateSources.map((candidateSource) =>
      candidateSource.startsWith("young-") ? "young" : "old",
    ),
  );

const calculateBatchPlanStagePriority = (intensity, stageId) =>
  OFFLINE_CONSOLIDATION_BATCH_PLAN_PRIORITY_BY_INTENSITY[intensity] +
  OFFLINE_CONSOLIDATION_BATCH_PLAN_PRIORITY_BY_STAGE[stageId];

const createBatchPlanStageOverwriteTargets = (
  stageId,
  candidateSources,
  planningGoals,
) => {
  const overwriteTargets = [];

  switch (stageId) {
    case "young-generation-triage":
      if (candidateSources.includes("young-working-memory")) {
        overwriteTargets.push("working-memory:young-generation-triage");
      }

      if (candidateSources.includes("young-short-term-memory")) {
        overwriteTargets.push("short-term-memory:young-generation-triage");
      }

      if (planningGoals.includes("archive-stale-memory")) {
        overwriteTargets.push("archived-memory:stale-young-memory");
      }

      break;
    case "young-generation-promotion":
      overwriteTargets.push(
        "long-term-memory:young-generation-promotion",
        "consolidation-journal:young-generation-promotion",
      );
      break;
    case "old-generation-reinforcement":
      overwriteTargets.push(
        "long-term-memory:old-generation-reinforcement",
        "consolidation-journal:old-generation-reinforcement",
      );
      break;
    case "archived-memory-review":
      overwriteTargets.push(
        "archived-memory:superseded-review",
        "consolidation-journal:archived-memory-review",
      );

      if (candidateSources.includes("old-long-term-memory")) {
        overwriteTargets.push("long-term-memory:superseded-review");
      }

      break;
    case "learned-trait-preservation":
      overwriteTargets.push(
        "long-term-memory:learned-trait-preservation",
        "consolidation-journal:learned-trait-preservation",
      );
      break;
    default:
      throw new TypeError(`unsupported offline consolidation stageId: ${stageId}`);
  }

  return createUniqueStringList(overwriteTargets);
};

const appendConcreteBatchPlanStage = (
  workUnits,
  request,
  planId,
  authorization,
  stageId,
  operation,
  candidateSources,
  planningGoals,
) => {
  if (candidateSources.length === 0 || planningGoals.length === 0) {
    return false;
  }

  const sequence = workUnits.length;
  const generationCoverage =
    deriveGenerationCoverageFromCandidateSources(candidateSources);

  if (generationCoverage.length === 0) {
    return false;
  }

  workUnits.push(
    createOfflineBatchWorkUnit({
      workUnitId: `${planId}/${stageId}`,
      batchId: planId,
      agentId: request.agentId,
      operation,
      coordinationSignal: request.coordinationHint,
      runtimePhase: authorization.runtimePhase,
      identityScopeKey: `agent:${request.agentId}`,
      overwriteNamespace: `agent:${request.agentId}`,
      overwriteTargets: createBatchPlanStageOverwriteTargets(
        stageId,
        candidateSources,
        planningGoals,
      ),
      priority: calculateBatchPlanStagePriority(request.preset.intensity, stageId),
      sequence,
      sortKey: `${String(sequence).padStart(2, "0")}:${stageId}`,
      metadata: {
        stageId,
        requestId: request.requestId,
        presetId: request.presetId,
        presetVersion: request.presetVersion,
        runtimeWindow: request.runtimeWindow,
        intensity: request.preset.intensity,
        generationCoverage,
        candidateSources,
        planningGoals,
        priorityMemoryIds: request.priorityMemoryIds,
        authorization,
        immutableIdentityPolicy: request.immutableIdentityPolicy,
        learnedTraitPolicy: request.learnedTraitPolicy,
        allowIdentityPromotion: request.allowIdentityPromotion,
        requestMetadata: request.metadata,
      },
    }),
  );

  return true;
};

const createConcreteBatchPlanWorkUnits = (request, planId, authorization) => {
  const workUnits = [];
  const candidateSources = request.preset.candidateSources;
  const planningGoals = request.preset.planningGoals;
  const generationCoverage = request.preset.generationCoverage;

  appendConcreteBatchPlanStage(
    workUnits,
    request,
    planId,
    authorization,
    "young-generation-triage",
    OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS["young-generation-triage"],
    generationCoverage.includes("young")
      ? filterRequestedEntries(candidateSources, [
          "young-working-memory",
          "young-short-term-memory",
        ])
      : freezeRecordList([]),
    filterRequestedEntries(planningGoals, [
      "mask-stale-young-memory",
      "archive-stale-memory",
    ]),
  );

  const learnedTraitPreservationRequested = planningGoals.includes(
    "preserve-learned-traits",
  );
  const promotionGoals = filterRequestedEntries(planningGoals, [
    "promote-stable-young-memory",
  ]);
  const reinforcementGoals = filterRequestedEntries(planningGoals, [
    "reinforce-old-memory",
  ]);

  const promotionCreated = appendConcreteBatchPlanStage(
    workUnits,
    request,
    planId,
    authorization,
    "young-generation-promotion",
    OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
      "young-generation-promotion"
    ],
    generationCoverage.includes("young")
      ? filterRequestedEntries(candidateSources, [
          "young-working-memory",
          "young-short-term-memory",
        ])
      : freezeRecordList([]),
    createUniqueStringList([
      ...promotionGoals,
      ...(promotionGoals.length > 0 && learnedTraitPreservationRequested
        ? ["preserve-learned-traits"]
        : []),
    ]),
  );

  const reinforcementCreated = appendConcreteBatchPlanStage(
    workUnits,
    request,
    planId,
    authorization,
    "old-generation-reinforcement",
    OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
      "old-generation-reinforcement"
    ],
    generationCoverage.includes("old")
      ? filterRequestedEntries(candidateSources, ["old-long-term-memory"])
      : freezeRecordList([]),
    createUniqueStringList([
      ...reinforcementGoals,
      ...(reinforcementGoals.length > 0 && learnedTraitPreservationRequested
        ? ["preserve-learned-traits"]
        : []),
    ]),
  );

  appendConcreteBatchPlanStage(
    workUnits,
    request,
    planId,
    authorization,
    "archived-memory-review",
    OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS["archived-memory-review"],
    generationCoverage.includes("old")
      ? filterRequestedEntries(candidateSources, [
          "old-archived-memory",
          "old-long-term-memory",
        ])
      : freezeRecordList([]),
    filterRequestedEntries(planningGoals, ["review-superseded-memory"]),
  );

  if (
    learnedTraitPreservationRequested &&
    !promotionCreated &&
    !reinforcementCreated
  ) {
    appendConcreteBatchPlanStage(
      workUnits,
      request,
      planId,
      authorization,
      "learned-trait-preservation",
      OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
        "learned-trait-preservation"
      ],
      filterRequestedEntries(candidateSources, [
        "young-short-term-memory",
        "old-long-term-memory",
      ]),
      freezeRecordList(["preserve-learned-traits"]),
    );
  }

  if (workUnits.length === 0) {
    throw new TypeError(
      `offline consolidation request ${request.requestId} did not resolve to any supported concrete batch-plan work units`,
    );
  }

  return freezeRecordList(workUnits);
};

const evaluateConcreteBatchPlanAuthorization = (request) =>
  freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: request.agentId,
      runtimePhase: request.runtimePhase,
      inactivitySuggestion: request.inactivitySuggestion,
      teamIdle: request.teamIdle,
    }),
  );

const assertConcreteBatchPlanRuntimeWindow = (request, authorization) => {
  if (!authorization.eligible) {
    throw new TypeError(
      `offline consolidation batch plan requires a caller-authorized idle or sleep runtime phase: ${authorization.blockedReason}`,
    );
  }

  if (
    request.runtimeWindow === "sleep" &&
    authorization.runtimePhase?.value !== "sleep"
  ) {
    throw new TypeError(
      "offline consolidation sleep runtimeWindow requires runtimePhase sleep",
    );
  }

  if (
    request.runtimeWindow === "idle" &&
    !OFFLINE_CONSOLIDATION_BATCH_PLAN_IDLE_PHASES.includes(
      authorization.runtimePhase?.value,
    )
  ) {
    throw new TypeError(
      "offline consolidation idle runtimeWindow requires runtimePhase idle, rest, or break",
    );
  }
};

const assertMetadataObject = (metadata, label) => {
  if (!isPlainObject(metadata)) {
    throw new TypeError(`${label} must be an object`);
  }
};

const assertRequiredMetadataFields = (metadata, requiredFields, label) => {
  const missingField = requiredFields.find(
    (fieldName) => !Object.prototype.hasOwnProperty.call(metadata, fieldName),
  );

  if (missingField) {
    throw new TypeError(`${label} must include ${missingField}`);
  }
};

const assertAuthorizedRuntimeWindowForValidation = (
  runtimeWindow,
  runtimePhase,
  label,
) => {
  const normalizedRuntimePhase = normalizeRuntimePhase(runtimePhase, label);

  if (!normalizedRuntimePhase) {
    throw new TypeError(`${label} must include a caller-authorized runtime phase`);
  }

  if (normalizedRuntimePhase.authority !== "caller") {
    throw new TypeError(`${label} must remain caller-controlled`);
  }

  if (
    runtimeWindow === "sleep" &&
    normalizedRuntimePhase.value !== "sleep"
  ) {
    throw new TypeError(`${label} must use runtimePhase sleep for sleep windows`);
  }

  if (
    runtimeWindow === "idle" &&
    !OFFLINE_CONSOLIDATION_BATCH_PLAN_IDLE_PHASES.includes(
      normalizedRuntimePhase.value,
    )
  ) {
    throw new TypeError(
      `${label} must use runtimePhase idle, rest, or break for idle windows`,
    );
  }

  return normalizedRuntimePhase;
};

const assertAuthorizationMetadata = (metadata, label) => {
  const authorization = metadata.authorization;

  assertMetadataObject(authorization, `${label}.authorization`);

  if (authorization.eligible !== true || authorization.opensConsolidation !== true) {
    throw new TypeError(`${label}.authorization must remain eligible`);
  }

  if (authorization.decisionSource !== "runtime-phase") {
    throw new TypeError(
      `${label}.authorization.decisionSource must remain runtime-phase`,
    );
  }

  if (authorization.requiresOfflineExecution !== true) {
    throw new TypeError(
      `${label}.authorization.requiresOfflineExecution must be true`,
    );
  }

  if (authorization.blockedReason !== null) {
    throw new TypeError(`${label}.authorization.blockedReason must be null`);
  }

  const authorizationRuntimePhase = assertAuthorizedRuntimeWindowForValidation(
    metadata.runtimeWindow,
    authorization.runtimePhase,
    `${label}.authorization.runtimePhase`,
  );

  const metadataRuntimePhase = assertAuthorizedRuntimeWindowForValidation(
    metadata.runtimeWindow,
    metadata.runtimePhase,
    `${label}.runtimePhase`,
  );

  if (authorizationRuntimePhase.value !== metadataRuntimePhase.value) {
    throw new TypeError(
      `${label}.authorization.runtimePhase must match ${label}.runtimePhase`,
    );
  }

  if (
    authorization.inactivitySuggestion !== null &&
    authorization.inactivitySuggestion !== undefined &&
    authorization.inactivitySuggestion.authorizesConsolidation !== false
  ) {
    throw new TypeError(
      `${label}.authorization.inactivitySuggestion must remain advisory`,
    );
  }

  return freezeDeep({
    authorizationRuntimePhase,
    metadataRuntimePhase,
  });
};

const assertPlanMetadataShape = (plan) => {
  const metadata = plan.metadata;

  assertMetadataObject(metadata, "offline consolidation batch plan metadata");
  assertRequiredMetadataFields(
    metadata,
    OFFLINE_CONSOLIDATION_BATCH_PLAN_REQUIRED_METADATA_FIELDS,
    "offline consolidation batch plan metadata",
  );

  const runtimeWindow = normalizeStringEnum(
    metadata.runtimeWindow,
    "offline consolidation batch plan metadata.runtimeWindow",
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
  );
  const coordinationHint = normalizeStringEnum(
    metadata.coordinationHint,
    "offline consolidation batch plan metadata.coordinationHint",
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
  );

  if (plan.coordinationSignal !== coordinationHint) {
    throw new TypeError(
      "offline consolidation batch plan coordinationSignal must match metadata.coordinationHint",
    );
  }

  if (metadata.teamIdle !== (coordinationHint === "team-idle")) {
    throw new TypeError(
      "offline consolidation batch plan metadata.teamIdle must match metadata.coordinationHint",
    );
  }

  if (
    normalizeStringConstant(
      metadata.authorizationModel,
      "runtime-phase-only",
      "offline consolidation batch plan metadata.authorizationModel",
    ) !== "runtime-phase-only"
  ) {
    throw new TypeError(
      "offline consolidation batch plan metadata.authorizationModel must remain runtime-phase-only",
    );
  }

  normalizeStringConstant(
    metadata.heuristicsPolicy,
    "suggest-only",
    "offline consolidation batch plan metadata.heuristicsPolicy",
  );
  normalizeStringConstant(
    metadata.teamCoordinationPolicy,
    "batch-only",
    "offline consolidation batch plan metadata.teamCoordinationPolicy",
  );
  normalizeStringConstant(
    metadata.immutableIdentityPolicy,
    "runtime-invariants-only",
    "offline consolidation batch plan metadata.immutableIdentityPolicy",
  );
  normalizeStringConstant(
    metadata.learnedTraitPolicy,
    "long-term-memory-only",
    "offline consolidation batch plan metadata.learnedTraitPolicy",
  );
  normalizeBooleanConstant(
    metadata.allowIdentityPromotion,
    false,
    "offline consolidation batch plan metadata.allowIdentityPromotion",
  );

  const stageIds = normalizeEnumList(
    metadata.stageIds,
    "offline consolidation batch plan metadata.stageIds",
    OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS,
  );

  if (stageIds.length !== plan.workUnits.length) {
    throw new TypeError(
      "offline consolidation batch plan metadata.stageIds must match workUnits",
    );
  }

  normalizeEnumList(
    metadata.generationCoverage,
    "offline consolidation batch plan metadata.generationCoverage",
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE,
  );
  normalizeEnumList(
    metadata.candidateSources,
    "offline consolidation batch plan metadata.candidateSources",
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES,
  );
  normalizeEnumList(
    metadata.planningGoals,
    "offline consolidation batch plan metadata.planningGoals",
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS,
  );

  if (!Array.isArray(metadata.priorityMemoryIds)) {
    throw new TypeError(
      "offline consolidation batch plan metadata.priorityMemoryIds must be an array",
    );
  }

  const authorization = assertAuthorizationMetadata(
    {
      ...metadata,
      runtimeWindow,
      coordinationHint,
    },
    "offline consolidation batch plan metadata",
  );

  return freezeDeep({
    metadata,
    runtimeWindow,
    coordinationHint,
    stageIds,
    authorizationRuntimePhase: authorization.authorizationRuntimePhase,
    metadataRuntimePhase: authorization.metadataRuntimePhase,
  });
};

const assertSafeConsolidationWorkUnit = (
  workUnit,
  index,
  planMetadataContext,
) => {
  const label = `offline consolidation batch plan workUnits[${index}]`;
  const metadata = workUnit.metadata;

  assertMetadataObject(metadata, `${label}.metadata`);
  assertRequiredMetadataFields(
    metadata,
    OFFLINE_CONSOLIDATION_BATCH_PLAN_WORK_UNIT_REQUIRED_METADATA_FIELDS,
    `${label}.metadata`,
  );

  const stageId = normalizeStringEnum(
    metadata.stageId,
    `${label}.metadata.stageId`,
    OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS,
  );
  const safeOperation =
    OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[stageId];

  if (workUnit.operation !== safeOperation) {
    throw new TypeError(
      `${label}.operation must remain ${safeOperation} for stage ${stageId}`,
    );
  }

  if (workUnit.agentId !== planMetadataContext.authorization.agentId) {
    throw new TypeError(`${label}.agentId must remain agent-scoped`);
  }

  if (workUnit.identityScopeKey !== `agent:${workUnit.agentId}`) {
    throw new TypeError(`${label}.identityScopeKey must remain agent-scoped`);
  }

  if (workUnit.overwriteNamespace !== `agent:${workUnit.agentId}`) {
    throw new TypeError(`${label}.overwriteNamespace must remain agent-scoped`);
  }

  if (workUnit.coordinationSignal !== planMetadataContext.coordinationHint) {
    throw new TypeError(
      `${label}.coordinationSignal must match plan metadata.coordinationHint`,
    );
  }

  if (
    normalizeStringConstant(
      metadata.requestId,
      planMetadataContext.metadata.requestId,
      `${label}.metadata.requestId`,
    ) !== planMetadataContext.metadata.requestId
  ) {
    throw new TypeError(
      `${label}.metadata.requestId must match plan metadata.requestId`,
    );
  }

  normalizeStringConstant(
    metadata.presetId,
    planMetadataContext.metadata.presetId,
    `${label}.metadata.presetId`,
  );
  normalizeStringConstant(
    metadata.presetVersion,
    planMetadataContext.metadata.presetVersion,
    `${label}.metadata.presetVersion`,
  );
  normalizeStringConstant(
    metadata.runtimeWindow,
    planMetadataContext.runtimeWindow,
    `${label}.metadata.runtimeWindow`,
  );
  normalizeStringConstant(
    metadata.intensity,
    planMetadataContext.metadata.intensity,
    `${label}.metadata.intensity`,
  );
  normalizeStringConstant(
    metadata.immutableIdentityPolicy,
    planMetadataContext.metadata.immutableIdentityPolicy,
    `${label}.metadata.immutableIdentityPolicy`,
  );
  normalizeStringConstant(
    metadata.learnedTraitPolicy,
    planMetadataContext.metadata.learnedTraitPolicy,
    `${label}.metadata.learnedTraitPolicy`,
  );
  normalizeBooleanConstant(
    metadata.allowIdentityPromotion,
    false,
    `${label}.metadata.allowIdentityPromotion`,
  );

  const candidateSources = normalizeEnumList(
    metadata.candidateSources,
    `${label}.metadata.candidateSources`,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES,
  );
  const planningGoals = normalizeEnumList(
    metadata.planningGoals,
    `${label}.metadata.planningGoals`,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS,
  );

  const expectedOverwriteTargets = createBatchPlanStageOverwriteTargets(
    stageId,
    candidateSources,
    planningGoals,
  );

  if (
    expectedOverwriteTargets.length !== workUnit.overwriteTargets.length ||
    expectedOverwriteTargets.some(
      (target, overwriteTargetIndex) =>
        workUnit.overwriteTargets[overwriteTargetIndex] !== target,
    )
  ) {
    throw new TypeError(
      `${label}.overwriteTargets must remain the safe overwrite set for stage ${stageId}`,
    );
  }

  if (workUnit.runtimePhase !== planMetadataContext.authorizationRuntimePhase.value) {
    throw new TypeError(
      `${label}.runtimePhase must match plan metadata authorization runtime phase`,
    );
  }

  if (!planMetadataContext.stageIds.includes(stageId)) {
    throw new TypeError(
      `${label}.metadata.stageId must be listed in plan metadata.stageIds`,
    );
  }

  assertAuthorizationMetadata(
    {
      ...metadata,
      runtimeWindow: planMetadataContext.runtimeWindow,
      runtimePhase: planMetadataContext.metadata.runtimePhase,
      authorization: metadata.authorization,
    },
    `${label}.metadata`,
  );
};

export const validateOfflineConsolidationBatchPlan = (plan) => {
  const normalizedPlan = createOfflineBatchPlan(plan);

  if (normalizedPlan.agentIds.length !== 1 || normalizedPlan.agentCount !== 1) {
    throw new TypeError(
      "offline consolidation batch plan outputs must remain scoped to exactly one agent",
    );
  }

  if (normalizedPlan.workUnits.length === 0) {
    throw new TypeError(
      "offline consolidation batch plan outputs must include at least one work unit",
    );
  }

  const planMetadataContext = assertPlanMetadataShape(normalizedPlan);

  normalizedPlan.workUnits.forEach((workUnit, index) => {
    assertSafeConsolidationWorkUnit(workUnit, index, {
      ...planMetadataContext,
      authorization: normalizedPlan.metadata.authorization,
    });
  });

  return true;
};

const resolveConcreteBatchLimit = (request, batchLimitInput) => {
  const limit = createOfflineBatchLimit(
    batchLimitInput ?? {
      ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
      limitId: request.batchProfileId,
    },
  );

  if (limit.limitId !== request.batchProfileId) {
    throw new TypeError(
      `batchLimit.limitId must match request.batchProfileId: ${request.batchProfileId}`,
    );
  }

  if (limit.targetProfile !== DEFAULT_B200_OFFLINE_BATCH_LIMIT.targetProfile) {
    throw new TypeError(
      `batchLimit.targetProfile must remain ${DEFAULT_B200_OFFLINE_BATCH_LIMIT.targetProfile}`,
    );
  }

  if (
    limit.acceleratorClass !== DEFAULT_B200_OFFLINE_BATCH_LIMIT.acceleratorClass
  ) {
    throw new TypeError(
      `batchLimit.acceleratorClass must remain ${DEFAULT_B200_OFFLINE_BATCH_LIMIT.acceleratorClass}`,
    );
  }

  return limit;
};

export const resolveOfflineConsolidationPlanBuilderPreset = (
  presetOrId,
  options = {},
) => {
  if (options !== undefined && options !== null && !isPlainObject(options)) {
    throw new TypeError(
      "offline consolidation plan-builder preset resolution options must be an object",
    );
  }

  const catalog = createOfflineConsolidationPlanBuilderPresetCatalog(
    options.catalog ?? DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG,
  );
  const presetInput =
    presetOrId === undefined || presetOrId === null
      ? catalog.defaultPresetId
      : presetOrId;

  if (typeof presetInput === "string") {
    const presetId = normalizeRequiredString(presetInput, "presetId");
    const resolvedPreset = catalog.presets[presetId];

    if (!resolvedPreset) {
      throw new TypeError(`unknown offline consolidation presetId: ${presetId}`);
    }

    return resolvedPreset;
  }

  return createOfflineConsolidationPlanBuilderPreset(presetInput);
};

export const createOfflineConsolidationPlanBuilderRequest = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "offline consolidation plan-builder request options must be an object",
    );
  }

  assertNoExecutorLogic(options, "offline consolidation plan-builder request");
  assertSeparateFromOfflineBatchApi(
    options,
    "offline consolidation plan-builder request",
  );
  assertAllowedFieldNames(
    options,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_ALLOWED_FIELDS,
    "offline consolidation plan-builder request",
  );

  const presetInput = options.preset ?? options.presetId;
  const catalog =
    options.presetCatalog === undefined || options.presetCatalog === null
      ? options.preset === undefined || options.preset === null
        ? DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG
        : null
      : createOfflineConsolidationPlanBuilderPresetCatalog(options.presetCatalog);
  const preset = resolveOfflineConsolidationPlanBuilderPreset(
    presetInput,
    {
      catalog:
        catalog ?? DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG,
    },
  );
  const requestId = normalizeRequiredString(options.requestId, "requestId");
  const version = normalizeRequiredString(options.version ?? "1.0.0", "version");
  const agentId = normalizeRequiredString(options.agentId, "agentId");
  const requestedPresetId = normalizeOptionalString(options.presetId, "presetId");
  const presetCatalogId = normalizeRequiredString(
    options.presetCatalogId ??
      catalog?.catalogId ??
      DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.catalogId,
    "presetCatalogId",
  );
  const teamIdle = normalizeOptionalBoolean(options.teamIdle, "teamIdle", false);
  const coordinationHint = teamIdle ? "team-idle" : "independent";
  const runtimeWindow =
    options.runtimeWindow === undefined || options.runtimeWindow === null
      ? preset.runtimeWindow
      : normalizeStringEnum(
          options.runtimeWindow,
          "runtimeWindow",
          OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
        );
  const presetVersion = normalizeRequiredString(
    options.presetVersion ?? preset.version,
    "presetVersion",
  );
  const batchProfileId = normalizeRequiredString(
    options.batchProfileId ?? preset.batchProfileId,
    "batchProfileId",
  );

  if (catalog !== null && presetCatalogId !== catalog.catalogId) {
    throw new TypeError(
      `presetCatalogId must match resolved preset catalog: ${catalog.catalogId}`,
    );
  }

  if (requestedPresetId !== null && requestedPresetId !== preset.presetId) {
    throw new TypeError(
      `presetId must match resolved preset.presetId: ${preset.presetId}`,
    );
  }

  if (presetVersion !== preset.version) {
    throw new TypeError(
      `presetVersion must match resolved preset.version: ${preset.version}`,
    );
  }

  if (runtimeWindow !== preset.runtimeWindow) {
    throw new TypeError(
      `runtimeWindow must match resolved preset.runtimeWindow: ${preset.runtimeWindow}`,
    );
  }

  if (batchProfileId !== preset.batchProfileId) {
    throw new TypeError(
      `batchProfileId must match resolved preset.batchProfileId: ${preset.batchProfileId}`,
    );
  }

  if (
    options.coordinationHint !== undefined &&
    options.coordinationHint !== null &&
    normalizeStringEnum(
      options.coordinationHint,
      "coordinationHint",
      OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
    ) !== coordinationHint
  ) {
    throw new TypeError(
      `coordinationHint must match teamIdle-derived value: ${coordinationHint}`,
    );
  }

  return freezeDeep({
    requestId,
    version,
    agentId,
    presetCatalogId,
    presetId: preset.presetId,
    presetVersion,
    preset,
    runtimeWindow,
    runtimePhase: normalizeRuntimePhase(options.runtimePhase, "runtimePhase"),
    inactivitySuggestion: normalizeInactivitySuggestion(
      options.inactivitySuggestion,
      "inactivitySuggestion",
    ),
    teamIdle,
    coordinationHint,
    priorityMemoryIds: normalizePriorityMemoryIds(
      options.priorityMemoryIds,
      "priorityMemoryIds",
    ),
    batchProfileId,
    contractLayer: normalizeStringConstant(
      options.contractLayer,
      "plan-builder",
      "contractLayer",
    ),
    outputPlanApi: normalizeStringConstant(
      options.outputPlanApi,
      "offline-batch-plan",
      "outputPlanApi",
    ),
    authorizationModel: normalizeStringConstant(
      options.authorizationModel,
      "runtime-phase-only",
      "authorizationModel",
    ),
    heuristicsPolicy: normalizeStringConstant(
      options.heuristicsPolicy,
      "suggest-only",
      "heuristicsPolicy",
    ),
    teamCoordinationPolicy: normalizeStringConstant(
      options.teamCoordinationPolicy,
      "batch-only",
      "teamCoordinationPolicy",
    ),
    scope: normalizeStringConstant(options.scope, "agent-scoped", "scope"),
    immutableIdentityPolicy: normalizeStringConstant(
      options.immutableIdentityPolicy,
      "runtime-invariants-only",
      "immutableIdentityPolicy",
    ),
    learnedTraitPolicy: normalizeStringConstant(
      options.learnedTraitPolicy,
      "long-term-memory-only",
      "learnedTraitPolicy",
    ),
    allowIdentityPromotion: normalizeBooleanConstant(
      options.allowIdentityPromotion,
      false,
      "allowIdentityPromotion",
    ),
    workingLoopIsolation: normalizeStringConstant(
      options.workingLoopIsolation,
      "offline-decoupled",
      "workingLoopIsolation",
    ),
    numericThroughputBenchmarkRequired: normalizeBooleanConstant(
      options.numericThroughputBenchmarkRequired,
      false,
      "numericThroughputBenchmarkRequired",
    ),
    metadata: normalizeMetadata(options.metadata, "metadata"),
  });
};

const normalizeOfflineConsolidationBatchPlanBuilderInput = (options = {}) => {
  if (!isPlainObject(options)) {
    throw createOfflineConsolidationBatchPlanGateError(
      "offline consolidation batch-plan builder options must be an object",
      "request-validation",
      "invalid-request",
    );
  }

  try {
    assertNoExecutorLogic(options, "offline consolidation batch-plan builder");
    assertSeparateFromOfflineBatchApi(
      options,
      "offline consolidation batch-plan builder",
    );

    const {
      request,
      planId: planIdInput,
      batchLimit,
      batchPlanMetadata,
      ...requestInput
    } = options;

    return freezeDeep({
      request: createOfflineConsolidationPlanBuilderRequest(request ?? requestInput),
      planIdInput,
      batchLimit,
      batchPlanMetadata: normalizeMetadata(
        batchPlanMetadata,
        "batchPlanMetadata",
      ),
    });
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "request-validation",
      "invalid-request",
    );
  }
};

const resolveOfflineConsolidationBatchPlanId = (planIdInput, request) => {
  try {
    return normalizeRequiredString(
      planIdInput ?? `offline-consolidation:${request.requestId}`,
      "planId",
    );
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "request-validation",
      "invalid-request",
      {
        request,
      },
    );
  }
};

const resolveAuthorizedConcreteBatchPlanWindow = (request) => {
  const authorization = evaluateConcreteBatchPlanAuthorization(request);

  try {
    assertConcreteBatchPlanRuntimeWindow(request, authorization);
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "runtime-authorization",
      authorization.blockedReason ?? "runtime-window-mismatch",
      {
        blockedReason: authorization.blockedReason,
        request,
      },
    );
  }

  return authorization;
};

const resolveValidatedConcreteBatchLimit = (request, batchLimitInput) => {
  try {
    return resolveConcreteBatchLimit(request, batchLimitInput);
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "batch-limit-validation",
      "invalid-batch-limit",
      {
        request,
      },
    );
  }
};

const resolveConcreteBatchPlanWorkUnits = (request, planId, authorization) => {
  try {
    return createConcreteBatchPlanWorkUnits(request, planId, authorization);
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "plan-translation",
      "invalid-plan-translation",
      {
        request,
      },
    );
  }
};

const materializeValidatedOfflineConsolidationBatchPlan = (options = {}) => {
  const normalizedInput = normalizeOfflineConsolidationBatchPlanBuilderInput(
    options,
  );
  const normalizedRequest = normalizedInput.request;
  const authorization = resolveAuthorizedConcreteBatchPlanWindow(
    normalizedRequest,
  );
  const planId = resolveOfflineConsolidationBatchPlanId(
    normalizedInput.planIdInput,
    normalizedRequest,
  );
  const limit = resolveValidatedConcreteBatchLimit(
    normalizedRequest,
    normalizedInput.batchLimit,
  );
  const workUnits = resolveConcreteBatchPlanWorkUnits(
    normalizedRequest,
    planId,
    authorization,
  );

  try {
    const plan = createOfflineBatchPlan({
      planId,
      coordinationSignal: normalizedRequest.coordinationHint,
      limit,
      workUnits,
      metadata: {
        requestId: normalizedRequest.requestId,
        requestVersion: normalizedRequest.version,
        presetCatalogId: normalizedRequest.presetCatalogId,
        presetId: normalizedRequest.presetId,
        presetVersion: normalizedRequest.presetVersion,
        runtimeWindow: normalizedRequest.runtimeWindow,
        runtimePhase: normalizedRequest.runtimePhase,
        inactivitySuggestion: normalizedRequest.inactivitySuggestion,
        authorization,
        coordinationHint: normalizedRequest.coordinationHint,
        teamIdle: normalizedRequest.teamIdle,
        intensity: normalizedRequest.preset.intensity,
        generationCoverage: normalizedRequest.preset.generationCoverage,
        candidateSources: normalizedRequest.preset.candidateSources,
        planningGoals: normalizedRequest.preset.planningGoals,
        stageIds: workUnits.map((workUnit) => workUnit.metadata?.stageId ?? null),
        priorityMemoryIds: normalizedRequest.priorityMemoryIds,
        batchProfileId: normalizedRequest.batchProfileId,
        authorizationModel: normalizedRequest.authorizationModel,
        heuristicsPolicy: normalizedRequest.heuristicsPolicy,
        teamCoordinationPolicy: normalizedRequest.teamCoordinationPolicy,
        immutableIdentityPolicy: normalizedRequest.immutableIdentityPolicy,
        learnedTraitPolicy: normalizedRequest.learnedTraitPolicy,
        allowIdentityPromotion: normalizedRequest.allowIdentityPromotion,
        requestMetadata: normalizedRequest.metadata,
        batchPlanMetadata: normalizedInput.batchPlanMetadata,
      },
    });

    validateOfflineConsolidationBatchPlan(plan);

    return freezeDeep({
      request: normalizedRequest,
      plan,
    });
  } catch (error) {
    throw wrapOfflineConsolidationBatchPlanGateError(
      error,
      "plan-validation",
      "invalid-batch-plan",
      {
        request: normalizedRequest,
      },
    );
  }
};

export const buildOfflineConsolidationBatchPlan = (options = {}) => {
  return materializeValidatedOfflineConsolidationBatchPlan(options).plan;
};

export const requestOfflineConsolidationBatchPlan = (options = {}) => {
  const requestContext = createOfflineConsolidationBatchPlanRequestContext(options);

  try {
    const validatedArtifacts = materializeValidatedOfflineConsolidationBatchPlan(
      options,
    );

    return freezeDeep({
      status: "validated",
      safeToExecute: true,
      request: validatedArtifacts.request,
      plan: validatedArtifacts.plan,
      rejection: null,
    });
  } catch (error) {
    const gateError = wrapOfflineConsolidationBatchPlanGateError(
      error,
      "internal-error",
      "unexpected-error",
    );
    const gateMetadata = gateError.offlineConsolidationBatchPlanGate;
    const normalizedRequest = gateMetadata.request ?? null;

    return freezeDeep({
      status: "rejected",
      safeToExecute: false,
      request: normalizedRequest,
      plan: null,
      rejection: {
        stage: gateMetadata.stage,
        reasonCode: gateMetadata.reasonCode,
        blockedReason: gateMetadata.blockedReason,
        message: gateError.message,
        requestId: normalizedRequest?.requestId ?? requestContext.requestId,
        agentId: normalizedRequest?.agentId ?? requestContext.agentId,
        planId:
          requestContext.planId ??
          (normalizedRequest
            ? `offline-consolidation:${normalizedRequest.requestId}`
            : null),
        runtimeWindow: normalizedRequest?.runtimeWindow ?? null,
      },
    });
  }
};
