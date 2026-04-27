import {
  RUNTIME_AUTHORIZED_IDLE_PHASES,
  createIdleWindowReconstructionBudget,
  evaluateIdleWindowAuthorization,
} from "./runtime-phase.js";
import {
  DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY,
  sanitizeHippocampusBoundaryPayload,
} from "./hippocampus-secret-policy.js";
import { evaluateWeightedPageRank } from "./pagerank.js";

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

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const YOUNG_GENERATION_MASKABLE_CONTENT_FIELDS = freezeDeep(["content", "summary", "detail"]);
const DEFAULT_YOUNG_GENERATION_ARCHIVED_INACTIVE_REASON =
  "archived-to-old-generation";

const cloneArray = (value) => (Array.isArray(value) ? [...value] : []);

const cloneObject = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }

  return { ...value };
};

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

const cloneObjectDeep = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }

  return cloneValueDeep(value);
};

const normalizeNullableString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
};

const normalizeStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const normalizeNumber = (value, minimum = 0, maximum = 1) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, numericValue));
};

const normalizeSignals = (signals) => {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(signals)
      .filter(([signalName]) => typeof signalName === "string" && signalName.length > 0)
      .map(([signalName, signalValue]) => [
        signalName,
        normalizeNumber(signalValue),
      ]),
  );
};

const calculateImportanceScore = (signals) => {
  const signalValues = Object.values(signals);

  if (signalValues.length === 0) {
    return 0;
  }

  const totalScore = signalValues.reduce(
    (runningTotal, signalValue) => runningTotal + signalValue,
    0,
  );

  return Number((totalScore / signalValues.length).toFixed(4));
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

const normalizeMemoryItemStableId = (value, label) =>
  normalizeRequiredString(value, label);

const normalizeOptionalString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredString(value, label);
};

const normalizeNonNegativeNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return numericValue;
};

const normalizeNonNegativeInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }

  return value;
};

const normalizeNullableNonNegativeInteger = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeNonNegativeInteger(value, label);
};

const normalizeStringList = (value, label) => {
  if (value === undefined || value === null) {
    return freezeDeep([]);
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return freezeDeep(
    value.map((entry, index) =>
      normalizeRequiredString(entry, `${label}[${index}]`),
    ),
  );
};

const createUniqueStringList = (values) => freezeDeep([...new Set(values)]);
const createSortedUniqueStringList = (values) =>
  freezeDeep(
    [...new Set(values)].sort((left, right) => left.localeCompare(right)),
  );

const normalizeLowercaseTokenList = (value, label) =>
  createUniqueStringList(
    normalizeStringList(value, label).map((entry) => entry.toLowerCase()),
  );

const normalizeWeightRecord = (weights, defaults, label) => {
  const mergedWeights = {
    ...defaults,
    ...(isPlainObject(weights) ? weights : {}),
  };
  const totalWeight = Object.entries(mergedWeights).reduce(
    (runningTotal, [weightName, weightValue]) =>
      runningTotal +
      normalizeNonNegativeNumber(weightValue, `${label}.${weightName}`),
    0,
  );

  if (totalWeight <= 0) {
    throw new TypeError(`${label} must contain at least one positive weight`);
  }

  return freezeDeep(
    Object.fromEntries(
      Object.entries(mergedWeights).map(([weightName, weightValue]) => [
        weightName,
        Number(
          (
            normalizeNonNegativeNumber(weightValue, `${label}.${weightName}`) /
            totalWeight
          ).toFixed(4),
        ),
      ]),
    ),
  );
};

const createMemoryReferenceKey = (memoryReference) =>
  `${memoryReference.agentId}:${memoryReference.memoryKind}:${memoryReference.memoryId}`;

const matchesMemoryReference = (entry, memoryReference) =>
  entry.memoryId === memoryReference.memoryId &&
  entry.memoryKind === memoryReference.memoryKind &&
  (memoryReference.agentId === undefined || entry.agentId === memoryReference.agentId);

const isRetrievalActiveYoungGenerationMemory = (memoryEnvelope) =>
  !Boolean(memoryEnvelope?.inactiveForRetrieval);

const createYoungGenerationMemoryReference = (agentId, memoryKind, memoryEnvelope) => ({
  agentId,
  memoryKind,
  memoryId: memoryEnvelope?.record?.memoryId,
});

const getRetrievalActiveYoungGenerationState = (graph) => {
  const workingMemory = cloneArray(graph.youngGeneration.workingMemory).filter(
    isRetrievalActiveYoungGenerationMemory,
  );
  const shortTermMemory = cloneArray(graph.youngGeneration.shortTermMemory).filter(
    isRetrievalActiveYoungGenerationMemory,
  );
  const activeMemoryReferences = new Set([
    ...workingMemory.map((memory) =>
      createMemoryReferenceKey(
        createYoungGenerationMemoryReference(
          graph.agentId,
          MEMORY_NODE_KINDS.workingMemory,
          memory,
        ),
      ),
    ),
    ...shortTermMemory.map((memory) =>
      createMemoryReferenceKey(
        createYoungGenerationMemoryReference(
          graph.agentId,
          MEMORY_NODE_KINDS.shortTermMemory,
          memory,
        ),
      ),
    ),
  ]);

  return {
    workingMemory,
    shortTermMemory,
    activeMemoryReferences,
  };
};

const isRetrievalActiveOldGenerationLongTermMemory = (memory) =>
  memory?.consolidationState?.status !== "superseded";

const YOUNG_GENERATION_MEMORY_ENVELOPE_FIELDS = freezeDeep([
  "record",
  "inactiveForRetrieval",
  "masking",
  "lifecycle",
]);

const isYoungGenerationMemoryEnvelope = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  "record" in value &&
  Object.keys(value).every((key) =>
    YOUNG_GENERATION_MEMORY_ENVELOPE_FIELDS.includes(key),
  );

const MEMORY_GRAPH_INSTANCE_TOKEN = Symbol("agent_brain_memory_graph_instance");
const MEMORY_GRAPH_RECONSTRUCTION_BUDGET_TOKEN = Symbol(
  "agent_brain_memory_graph_reconstruction_budget",
);
const MEMORY_GRAPH_RECONSTRUCTION_PROFILE_TOKEN = Symbol(
  "agent_brain_memory_graph_reconstruction_profile",
);
const MEMORY_GRAPH_RECONSTRUCTION_PHASES = freezeDeep([
  "resolve-target-memory-set",
  "materialize-graph",
  "validate-young-generation",
  "validate-old-generation",
  "freeze-graph",
]);

export const MEMORY_NODE_KINDS = freezeDeep({
  root: "agent_brain",
  youngGeneration: "young_generation",
  oldGeneration: "old_generation",
  workingMemory: "working_memory",
  shortTermMemory: "short_term_memory",
  importanceIndex: "importance_index",
  longTermMemory: "long_term_memory",
  archivedMemory: "archived_memory",
  memoryEvidence: "memory_evidence",
  consolidationRecord: "consolidation_record",
  immutableIdentity: "immutable_identity",
});

export const BRAIN_LIBRARY_NAME = "@zep/brain";

export const BRAIN_LIBRARY_MODULES = freezeDeep([
  "memory-graph",
  "consolidation",
  "batch-planning",
  "identity-guard",
]);

export const PROTECTED_IDENTITY_FIELDS = freezeDeep([
  "agentId",
  "persona",
  "role",
  "durableMission",
  "safetyConstraints",
  "ownership",
  "nonNegotiablePreferences",
  "runtimeInvariants",
  "protectedCoreFacts",
]);

export const LONG_TERM_MEMORY_CATEGORIES = freezeDeep([
  "semantic",
  "episodic",
  "procedural",
  "learned_trait",
  "observation",
]);

export const MEMORY_EVIDENCE_KINDS = freezeDeep([
  "conversation_excerpt",
  "tool_output",
  "document_excerpt",
  "runtime_trace",
  "human_feedback",
]);

export const CONSOLIDATION_OPERATIONS = freezeDeep([
  "promote",
  "reinforce",
  "supersede",
  "preserve",
]);

export const OLD_GENERATION_CONSOLIDATION_STATES = freezeDeep([
  "runtime_seeded",
  "promoted",
  "reinforced",
  "preserved",
  "superseded",
]);

export const ARCHIVED_MEMORY_SOURCE_GENERATIONS = freezeDeep([
  MEMORY_NODE_KINDS.youngGeneration,
  MEMORY_NODE_KINDS.oldGeneration,
]);

export const ARCHIVED_MEMORY_SOURCE_MEMORY_KINDS = freezeDeep([
  MEMORY_NODE_KINDS.workingMemory,
  MEMORY_NODE_KINDS.shortTermMemory,
  MEMORY_NODE_KINDS.longTermMemory,
]);

const GRAPH_STATE_RECONSTRUCTION_GENERATIONS = freezeDeep(["young", "old"]);
const GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA = freezeDeep({
  schemaId: "agent_brain_graph_state_reconstruction_metadata",
  version: "1.0.0",
});
const GRAPH_STATE_DELTA_STATUSES = freezeDeep([
  "unchanged",
  "added",
  "removed",
  "modified",
]);
const GRAPH_STATE_RECONSTRUCTION_MEMORY_KINDS_BY_GENERATION = freezeDeep({
  young: freezeDeep([
    MEMORY_NODE_KINDS.workingMemory,
    MEMORY_NODE_KINDS.shortTermMemory,
  ]),
  old: freezeDeep([
    MEMORY_NODE_KINDS.longTermMemory,
    MEMORY_NODE_KINDS.archivedMemory,
  ]),
});
const GRAPH_STATE_RECONSTRUCTION_MEMORY_KIND_SET = new Set(
  Object.values(GRAPH_STATE_RECONSTRUCTION_MEMORY_KINDS_BY_GENERATION).flat(),
);
const GRAPH_STATE_RECONSTRUCTION_GENERATION_SET = new Set(
  GRAPH_STATE_RECONSTRUCTION_GENERATIONS,
);
const GRAPH_STATE_DELTA_STATUS_SET = new Set(GRAPH_STATE_DELTA_STATUSES);

export const YOUNG_GENERATION_MEMORY_KINDS = freezeDeep([
  MEMORY_NODE_KINDS.workingMemory,
  MEMORY_NODE_KINDS.shortTermMemory,
]);

export const YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES = freezeDeep([
  "active",
  "inactive",
  "archived",
]);

export const CONSOLIDATION_SIGNAL_DIMENSIONS = freezeDeep([
  "importance",
  "stability",
]);

export const CONSOLIDATION_SIGNAL_GENERATIONS = freezeDeep([
  "youngGeneration",
  "oldGeneration",
]);

const CONSOLIDATION_PROMOTION_SIGNAL_PATHS = freezeDeep(
  CONSOLIDATION_SIGNAL_GENERATIONS.flatMap((generation) =>
    CONSOLIDATION_SIGNAL_DIMENSIONS.map(
      (dimension) => `${generation}.${dimension}`,
    ),
  ),
);

const CONSOLIDATION_PROMOTION_SIGNAL_PATH_SET = new Set(
  CONSOLIDATION_PROMOTION_SIGNAL_PATHS,
);

const CONSOLIDATION_PROMOTION_SIGNAL_WEIGHTS = freezeDeep({
  "youngGeneration.importance": "youngImportance",
  "youngGeneration.stability": "youngStability",
  "oldGeneration.importance": "oldImportance",
  "oldGeneration.stability": "oldStability",
});

const CONSOLIDATION_PROMOTION_SIGNAL_THRESHOLDS = freezeDeep({
  "youngGeneration.importance": "minimumYoungImportanceScore",
  "youngGeneration.stability": "minimumYoungStabilityScore",
  "oldGeneration.importance": "minimumOldImportanceScore",
  "oldGeneration.stability": "minimumOldStabilityScore",
});

const DEFAULT_CONSOLIDATION_PROMOTION_REQUIRED_SIGNALS = freezeDeep([
  "youngGeneration.importance",
  "youngGeneration.stability",
]);

const DEFAULT_CONSOLIDATION_PROMOTION_THRESHOLDS = freezeDeep({
  minimumPromotionScore: 0.65,
  minimumYoungImportanceScore: 0.6,
  minimumYoungStabilityScore: 0.55,
  minimumOldImportanceScore: 0,
  minimumOldStabilityScore: 0,
});

const DEFAULT_CONSOLIDATION_PROMOTION_WEIGHTS = freezeDeep({
  youngImportance: 0.35,
  youngStability: 0.35,
  oldImportance: 0.15,
  oldStability: 0.15,
});

export const OLD_GENERATION_NODE_KINDS = freezeDeep([
  MEMORY_NODE_KINDS.longTermMemory,
  MEMORY_NODE_KINDS.archivedMemory,
  MEMORY_NODE_KINDS.memoryEvidence,
  MEMORY_NODE_KINDS.consolidationRecord,
  MEMORY_NODE_KINDS.immutableIdentity,
]);

export const MEMORY_ITEM_IDENTITY_SCHEMA = freezeDeep({
  version: "1.0.0",
  stableIdField: "memoryId",
  mutable: false,
  regeneration: "forbidden",
  reassignment: "forbidden",
  description:
    "Canonical stable-memory identity contract shared by young- and old-generation memory items.",
  rules: freezeDeep([
    'Every memory item carries exactly one stable "memoryId" field.',
    "A memory item keeps the same memoryId across young-generation storage, old-generation promotion, archival metadata, and persistence round-trips.",
    "A memoryId must never be regenerated for an existing memory item.",
    "A memoryId must never be reassigned to represent a different memory item.",
  ]),
});

export const CONSOLIDATION_PIPELINE_ABORT_STAGES = freezeDeep([
  "planning",
  "deduplication",
  "rewrite",
  "serialization",
  "merge",
  "persistence",
]);

export const CONSOLIDATION_PIPELINE_ABORT_REASONS = freezeDeep([
  "canonical-id-mutation",
]);

export const CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT = freezeDeep({
  invariantId: "agent-scoped-canonical-id-preservation",
  version: "1.0.0",
  description:
    "Offline consolidation must preserve agent-scoped canonical agentId, memoryId, and derived nodeId values from source resolution through durable write.",
  protectedCanonicalFields: freezeDeep(["agentId", "memoryId", "nodeId"]),
  stages: CONSOLIDATION_PIPELINE_ABORT_STAGES,
  abortReason: CONSOLIDATION_PIPELINE_ABORT_REASONS[0],
  safeAction: "abort-offline-pipeline-before-write",
});

export const CONSOLIDATION_PIPELINE_ABORT_CONTRACT = freezeDeep({
  version: "1.0.0",
  invariantId: CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.invariantId,
  reasons: CONSOLIDATION_PIPELINE_ABORT_REASONS,
  stages: CONSOLIDATION_PIPELINE_ABORT_STAGES,
  safeAction: CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.safeAction,
});

const MEMORY_GRAPH_RECONSTRUCTION_DEFERRED_REASONS = freezeDeep([
  "idle-budget-exceeded",
]);

export class MemoryGraphReconstructionDeferredError extends Error {
  constructor(deferred) {
    super(deferred.message);
    this.name = "MemoryGraphReconstructionDeferredError";
    this.code = deferred.reason;
    this.deferred = deferred;
  }
}

export const isMemoryGraphReconstructionDeferredError = (value) =>
  value instanceof MemoryGraphReconstructionDeferredError ||
  (Boolean(value) &&
    typeof value === "object" &&
    value.name === "MemoryGraphReconstructionDeferredError" &&
    isPlainObject(value.deferred) &&
    value.deferred.status === "deferred" &&
    typeof value.deferred.reason === "string");

export class ConsolidationPipelineAbortError extends Error {
  constructor(abort) {
    super(abort.message);
    this.name = "ConsolidationPipelineAbortError";
    this.code = abort.reason;
    this.abort = abort;
  }
}

export const isConsolidationPipelineAbortError = (value) =>
  value instanceof ConsolidationPipelineAbortError ||
  (Boolean(value) &&
    typeof value === "object" &&
    value.name === "ConsolidationPipelineAbortError" &&
    isPlainObject(value.abort) &&
    value.abort.safe === true &&
    typeof value.abort.reason === "string");

class HippocampusBoundaryRejectionError extends Error {
  constructor(message, sanitizationResult) {
    super(message);
    this.name = "HippocampusBoundaryRejectionError";
    this.code = "hippocampus-boundary-rejected";
    this.sanitizationResult = sanitizationResult;
  }
}

const isHippocampusBoundaryRejectionError = (value) =>
  value instanceof HippocampusBoundaryRejectionError ||
  (Boolean(value) &&
    typeof value === "object" &&
    value.name === "HippocampusBoundaryRejectionError" &&
    value.code === "hippocampus-boundary-rejected" &&
    isPlainObject(value.sanitizationResult) &&
    Array.isArray(value.sanitizationResult.unredactablePaths));

class HippocampusBoundarySanitizationError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "HippocampusBoundarySanitizationError";
    this.code = "hippocampus-boundary-error";
    this.cause = cause;
  }
}

const isHippocampusBoundarySanitizationError = (value) =>
  value instanceof HippocampusBoundarySanitizationError ||
  (Boolean(value) &&
    typeof value === "object" &&
    value.name === "HippocampusBoundarySanitizationError" &&
    value.code === "hippocampus-boundary-error");

const isHippocampusBoundaryFailureError = (value) =>
  isHippocampusBoundaryRejectionError(value) ||
  isHippocampusBoundarySanitizationError(value);

const normalizeConsolidationPipelineAbortStage = (value, label) => {
  const stage = normalizeRequiredString(value, label);

  if (!CONSOLIDATION_PIPELINE_ABORT_STAGES.includes(stage)) {
    throw new TypeError(
      `${label} must be one of ${CONSOLIDATION_PIPELINE_ABORT_STAGES.join(", ")}`,
    );
  }

  return stage;
};

const createConsolidationPipelineAbort = ({
  stage,
  canonicalField,
  attemptedField,
  sourceMemoryId = null,
  agentId = null,
  expectedValue,
  actualValue,
  message,
}) =>
  freezeDeep({
    version: CONSOLIDATION_PIPELINE_ABORT_CONTRACT.version,
    invariantId: CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.invariantId,
    reason: CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.abortReason,
    stage: normalizeConsolidationPipelineAbortStage(
      stage,
      "consolidation pipeline abort stage",
    ),
    safe: true,
    safeAction: CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.safeAction,
    identityScope: "agent-scoped",
    canonicalField: normalizeRequiredString(
      canonicalField,
      "consolidation pipeline abort canonicalField",
    ),
    attemptedField: normalizeRequiredString(
      attemptedField,
      "consolidation pipeline abort attemptedField",
    ),
    sourceMemoryId:
      sourceMemoryId === null
        ? null
        : normalizeMemoryItemStableId(
            sourceMemoryId,
            "consolidation pipeline abort sourceMemoryId",
          ),
    agentId:
      agentId === null
        ? null
        : normalizeRequiredString(agentId, "consolidation pipeline abort agentId"),
    expectedValue: normalizeRequiredString(
      expectedValue,
      "consolidation pipeline abort expectedValue",
    ),
    actualValue: normalizeRequiredString(
      actualValue,
      "consolidation pipeline abort actualValue",
    ),
    message: normalizeRequiredString(
      message,
      "consolidation pipeline abort message",
    ),
  });

const throwConsolidationPipelineAbort = (details) => {
  throw new ConsolidationPipelineAbortError(
    createConsolidationPipelineAbort(details),
  );
};

const createMemoryStableIdFieldSchema = (description) =>
  freezeDeep({
    type: "string",
    required: true,
    mutable: MEMORY_ITEM_IDENTITY_SCHEMA.mutable,
    identityField: true,
    identityRole: "stable_memory_id",
    regeneration: MEMORY_ITEM_IDENTITY_SCHEMA.regeneration,
    reassignment: MEMORY_ITEM_IDENTITY_SCHEMA.reassignment,
    description,
  });

export const OLD_GENERATION_IDENTIFIER_SCHEMA = freezeDeep({
  version: "1.0.0",
  delimiter: "/",
  identityLocalId: "self",
  memoryItemStableIdField: MEMORY_ITEM_IDENTITY_SCHEMA.stableIdField,
  nodeIdPattern: "old/{agentId}/{nodeKind}/{localId}",
  edgeIdPattern: "old/{agentId}/edge/{relation}/{sourceNodeId}->{targetNodeId}",
  nodeKinds: {
    longTermMemory: {
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      localIdField: "memoryId",
      example: "old/agent-007/long_term_memory/ltm-1",
    },
    archivedMemory: {
      nodeKind: MEMORY_NODE_KINDS.archivedMemory,
      localIdField: "archiveId",
      example: "old/agent-007/archived_memory/archive-1",
    },
    memoryEvidence: {
      nodeKind: MEMORY_NODE_KINDS.memoryEvidence,
      localIdField: "evidenceId",
      example: "old/agent-007/memory_evidence/evidence-1",
    },
    consolidationRecord: {
      nodeKind: MEMORY_NODE_KINDS.consolidationRecord,
      localIdField: "recordId",
      example: "old/agent-007/consolidation_record/consolidation-1",
    },
    immutableIdentity: {
      nodeKind: MEMORY_NODE_KINDS.immutableIdentity,
      localIdField: "self",
      example: "old/agent-007/immutable_identity/self",
    },
  },
});

export const OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA = freezeDeep({
  type: "object",
  required: true,
  description:
    "Temporal metadata carried by old-generation nodes and edges for observation, stabilization, consolidation, and supersession history.",
  fields: {
    firstObservedAt: {
      type: "string|null",
      required: false,
    },
    lastObservedAt: {
      type: "string|null",
      required: false,
    },
    stabilizedAt: {
      type: "string|null",
      required: false,
    },
    consolidatedAt: {
      type: "string|null",
      required: false,
    },
    lastAccessedAt: {
      type: "string|null",
      required: false,
    },
    supersededAt: {
      type: "string|null",
      required: false,
    },
  },
});

export const OLD_GENERATION_SALIENCE_SCHEMA = freezeDeep({
  type: "object|null",
  required: false,
  description:
    "Optional durable salience summary retained after promotion so importance can stay decoupled from the live young-generation scoring loop.",
  fields: {
    score: {
      type: "number|null",
      required: false,
      min: 0,
      max: 1,
    },
    signals: {
      type: "record<number>",
      required: false,
    },
    signalCount: {
      type: "number",
      required: true,
      min: 0,
    },
    lastEvaluatedAt: {
      type: "string|null",
      required: false,
    },
    sourceEntryId: {
      type: "string|null",
      required: false,
    },
  },
});

export const OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA = freezeDeep({
  type: "object",
  required: true,
  description:
    "Durable consolidation-state metadata that records how an old-generation node or edge entered its current offline state without mutating immutable identity.",
  fields: {
    status: {
      type: "enum",
      required: true,
      values: OLD_GENERATION_CONSOLIDATION_STATES,
    },
    lastOperation: {
      type: "enum|null",
      required: false,
      values: CONSOLIDATION_OPERATIONS,
    },
    journalRecordId: {
      type: "string|null",
      required: false,
    },
    policyVersion: {
      type: "string|null",
      required: false,
    },
    sourceMemoryIds: {
      type: "string[]",
      required: false,
    },
    preservedIdentityFields: {
      type: "string[]",
      required: false,
    },
    protectedFromIdentityPromotion: {
      type: "boolean|null",
      required: false,
    },
  },
});

export const OLD_GENERATION_EDGE_FIELDS = freezeDeep({
  edgeId: {
    type: "string",
    required: true,
    description:
      "Canonical old-generation edge identifier using old/{agentId}/edge/{relation}/{sourceNodeId}->{targetNodeId}.",
  },
  agentId: {
    type: "string",
    required: true,
  },
  from: {
    type: "string",
    required: true,
  },
  to: {
    type: "string",
    required: true,
  },
  relation: {
    type: "string",
    required: true,
  },
  provenance: {
    type: "object",
    required: true,
  },
  temporalContext: OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
  salience: OLD_GENERATION_SALIENCE_SCHEMA,
  consolidationState: OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
});

export const IMMUTABLE_IDENTITY_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.immutableIdentity,
  description:
    "Agent-scoped immutable identity supplied by runtime invariants and protected core facts.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  allowLearnedTraits: false,
  fields: {
    nodeId: {
      type: "string",
      required: true,
      mutable: false,
      source: "runtime",
      description:
        "Canonical old-generation identity identifier using old/{agentId}/immutable_identity/self.",
    },
    agentId: {
      type: "string",
      required: true,
      mutable: false,
      source: "runtime",
    },
    persona: {
      type: "string",
      required: true,
      mutable: false,
      source: "runtime",
    },
    role: {
      type: "string",
      required: true,
      mutable: false,
      source: "runtime",
    },
    durableMission: {
      type: "string",
      required: true,
      mutable: false,
      source: "runtime",
    },
    safetyConstraints: {
      type: "string[]",
      required: true,
      mutable: false,
      source: "runtime",
    },
    ownership: {
      type: "string[]",
      required: true,
      mutable: false,
      source: "runtime",
    },
    nonNegotiablePreferences: {
      type: "string[]",
      required: true,
      mutable: false,
      source: "runtime",
    },
    runtimeInvariants: {
      type: "record",
      required: true,
      mutable: false,
      source: "runtime",
    },
    protectedCoreFacts: {
      type: "string[]",
      required: true,
      mutable: false,
      source: "runtime",
    },
    provenance: {
      type: "object",
      required: true,
      mutable: false,
      source: "runtime",
      description:
        "Runtime-authority provenance describing where immutable identity facts were asserted.",
    },
    temporalContext: {
      ...OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
      mutable: false,
      source: "runtime",
    },
    consolidationState: {
      ...OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
      mutable: false,
      source: "runtime",
    },
  },
});

export const LONG_TERM_MEMORY_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.longTermMemory,
  description:
    "Canonical durable memories stored in the old generation with evidence, confidence, and provenance.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: {
    nodeId: {
      type: "string",
      required: true,
      description:
        "Canonical old-generation memory identifier using old/{agentId}/long_term_memory/{memoryId}.",
    },
    agentId: {
      type: "string",
      required: true,
    },
    memoryId: createMemoryStableIdFieldSchema(
      "Canonical stable memory identifier. nodeId is derived from memoryId, and the memoryId itself must never be regenerated or reassigned.",
    ),
    category: {
      type: "enum",
      required: true,
      values: LONG_TERM_MEMORY_CATEGORIES,
    },
    content: {
      type: "string",
      required: true,
    },
    summary: {
      type: "string",
      required: true,
    },
    confidence: {
      type: "number",
      required: true,
      min: 0,
      max: 1,
    },
    provenance: {
      type: "object",
      required: true,
      description: "Audit trail for the learned memory.",
    },
    stabilizedAt: {
      type: "string",
      required: true,
      description: "Timestamp when offline consolidation stabilized this memory.",
    },
    temporalContext: OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
    salience: {
      ...OLD_GENERATION_SALIENCE_SCHEMA,
      required: true,
    },
    consolidationState: OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
    learnedTrait: {
      type: "object|null",
      required: false,
      description:
        "Optional learned trait payload retained in memory and barred from identity promotion.",
      fields: {
        label: {
          type: "string",
          required: true,
        },
        confidence: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
        provenance: {
          type: "object",
          required: true,
        },
        protectedFromIdentityPromotion: {
          type: "boolean",
          required: true,
          const: true,
        },
      },
    },
  },
});

export const LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS = freezeDeep([
  "memoryId",
  "category",
  "content",
  "summary",
]);

export const LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS = freezeDeep([
  "nodeId",
  "agentId",
  "confidence",
  "provenance",
  "stabilizedAt",
  "temporalContext",
  "salience",
  "consolidationState",
]);

export const LONG_TERM_MEMORY_RECORD_CONTRACT = freezeDeep({
  schemaId: "agent_brain_long_term_memory_entry",
  version: "1.0.0",
  nodeKind: MEMORY_NODE_KINDS.longTermMemory,
  requiredContentFields: LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
  requiredMetadataFields: LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
  optionalMetadataFields: freezeDeep(["learnedTrait"]),
  learnedTraitCategoryRequiresMetadata: true,
  learnedTraitsRemainProtectedFromIdentityPromotion: true,
});

export const DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX =
  "agent-brain/long-term-memory";

export const CONSOLIDATION_CHECKPOINT_REQUIRED_CURSOR_FIELDS = freezeDeep([
  "streamId",
  "cursorToken",
  "sequence",
  "eventId",
  "watermark",
]);

export const CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT = freezeDeep({
  schemaId: "agent_brain_consolidation_checkpoint",
  version: "1.0.0",
  recordType: "consolidation_checkpoint",
  requiredFields: freezeDeep([
    "agentId",
    "syncSource",
    "cursor",
    "consolidatedAt",
  ]),
  requiredCursorFields: CONSOLIDATION_CHECKPOINT_REQUIRED_CURSOR_FIELDS,
  requiresResumePosition: true,
});

export const DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX =
  "agent-brain/consolidation-checkpoints";

export const CONSOLIDATION_CHECKPOINT_SCHEMA = freezeDeep({
  schemaId: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.schemaId,
  version: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.version,
  description:
    "Versioned per-agent consolidation checkpoint contract for persisting the last successfully consolidated RPC sync position.",
  fields: {
    schemaId: {
      type: "string",
      required: true,
      const: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.schemaId,
    },
    schemaVersion: {
      type: "string",
      required: true,
      const: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.version,
    },
    recordType: {
      type: "string",
      required: true,
      const: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType,
    },
    checkpoint: {
      type: "object",
      required: true,
      requiredFields: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.requiredFields,
      description:
        "Agent-scoped checkpoint carrying the last successfully consolidated sync source and resume cursor state.",
      fields: {
        agentId: {
          type: "string",
          required: true,
        },
        syncSource: {
          type: "string",
          required: true,
        },
        cursor: {
          type: "object",
          required: true,
          requiredFields:
            CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.requiredCursorFields,
          fields: {
            streamId: {
              type: "string",
              required: true,
            },
            cursorToken: {
              type: "string|null",
              required: true,
            },
            sequence: {
              type: "number|null",
              required: true,
              min: 0,
            },
            eventId: {
              type: "string|null",
              required: true,
            },
            watermark: {
              type: "string|null",
              required: true,
            },
          },
        },
        consolidatedAt: {
          type: "string",
          required: true,
        },
        runtimePhase: {
          type: "string|null",
          required: false,
        },
        provenance: {
          type: "object",
          required: false,
        },
      },
    },
  },
});

export const LONG_TERM_MEMORY_PERSISTENCE_SCHEMA = freezeDeep({
  schemaId: LONG_TERM_MEMORY_RECORD_CONTRACT.schemaId,
  version: LONG_TERM_MEMORY_RECORD_CONTRACT.version,
  description:
    "Versioned per-entry persistence contract for serializing one long-term memory with explicit content and metadata sections.",
  fields: {
    schemaId: {
      type: "string",
      required: true,
      const: LONG_TERM_MEMORY_RECORD_CONTRACT.schemaId,
    },
    schemaVersion: {
      type: "string",
      required: true,
      const: LONG_TERM_MEMORY_RECORD_CONTRACT.version,
    },
    nodeKind: {
      type: "string",
      required: true,
      const: MEMORY_NODE_KINDS.longTermMemory,
    },
    content: {
      type: "object",
      required: true,
      requiredFields: LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
      description:
        "Durable memory content fields that define what the memory says, separate from persistence metadata.",
      fields: {
        memoryId: LONG_TERM_MEMORY_SCHEMA.fields.memoryId,
        category: LONG_TERM_MEMORY_SCHEMA.fields.category,
        content: LONG_TERM_MEMORY_SCHEMA.fields.content,
        summary: LONG_TERM_MEMORY_SCHEMA.fields.summary,
      },
    },
    metadata: {
      type: "object",
      required: true,
      requiredFields: LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
      description:
        "Durable persistence metadata required to preserve identity boundaries, provenance, timing, salience, and consolidation state.",
      fields: {
        nodeId: LONG_TERM_MEMORY_SCHEMA.fields.nodeId,
        agentId: LONG_TERM_MEMORY_SCHEMA.fields.agentId,
        confidence: LONG_TERM_MEMORY_SCHEMA.fields.confidence,
        provenance: LONG_TERM_MEMORY_SCHEMA.fields.provenance,
        stabilizedAt: LONG_TERM_MEMORY_SCHEMA.fields.stabilizedAt,
        temporalContext: LONG_TERM_MEMORY_SCHEMA.fields.temporalContext,
        salience: LONG_TERM_MEMORY_SCHEMA.fields.salience,
        consolidationState: LONG_TERM_MEMORY_SCHEMA.fields.consolidationState,
        learnedTrait: LONG_TERM_MEMORY_SCHEMA.fields.learnedTrait,
      },
    },
  },
});

export const LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA = freezeDeep({
  version: "1.0.0",
  description:
    "Deterministic logical-identity matching contract for long-term memory records across consolidation reruns.",
  exactMatchFields: freezeDeep([
    "agentId",
    "category",
    "content",
    "summary",
    "lineageMemoryIds",
    "learnedTraitLabel",
  ]),
  excludedMutableFields: freezeDeep([
    "confidence",
    "provenance",
    "stabilizedAt",
    "temporalContext",
    "salience",
    "consolidationState.status",
    "consolidationState.lastOperation",
    "consolidationState.journalRecordId",
    "consolidationState.policyVersion",
    "consolidationState.protectedFromIdentityPromotion",
  ]),
  notes: freezeDeep([
    "Stable memoryId remains the first-class exact match when present.",
    "When no exact stable-id match exists, deterministic logical identity compares agent scope, semantic category, canonical content, canonical summary, lineage memory ids, and learned-trait label.",
    "Logical-identity matches that point at a different stable memoryId are reported as conflicts instead of being merged automatically.",
  ]),
});

export const YOUNG_GENERATION_MASKED_CONTENT_SCHEMA = freezeDeep({
  type: "object|null",
  required: false,
  description:
    "Snapshot of the original text-like content that became retrieval-masked while the full underlying record remains preserved.",
  fields: {
    value: {
      type: "string|null",
      required: false,
    },
    sourceField: {
      type: "string|null",
      required: false,
    },
    capturedAt: {
      type: "string|null",
      required: false,
    },
  },
});

export const YOUNG_GENERATION_MASKING_AUDIT_SCHEMA = freezeDeep({
  type: "object|null",
  required: false,
  description:
    "Structured audit metadata for how a masking decision was evaluated, recorded, and attributed.",
  fields: {
    auditRecordId: {
      type: "string|null",
      required: false,
    },
    policyVersion: {
      type: "string|null",
      required: false,
    },
    runtimePhase: {
      type: "string|null",
      required: false,
    },
    sourceEvaluationAt: {
      type: "string|null",
      required: false,
    },
    sourceEvaluationMode: {
      type: "string|null",
      required: false,
    },
    recordedAt: {
      type: "string|null",
      required: false,
    },
    actor: {
      type: "string|null",
      required: false,
    },
    metadata: {
      type: "object|null",
      required: false,
    },
  },
});

export const YOUNG_GENERATION_MASKING_SCHEMA = freezeDeep({
  type: "object",
  required: true,
  description:
    "Non-destructive masking metadata for a young-generation memory that stays stored while retrieval is disabled.",
  fields: {
    isMasked: {
      type: "boolean",
      required: true,
    },
    maskedAt: {
      type: "string|null",
      required: false,
    },
    unmaskedAt: {
      type: "string|null",
      required: false,
    },
    maskUpdatedAt: {
      type: "string|null",
      required: false,
    },
    maskedBy: {
      type: "string|null",
      required: false,
    },
    reason: {
      type: "string|null",
      required: false,
      description:
        "Explicit masking reason that explains why retrieval was disabled without deleting the record.",
    },
    maskedOriginalContent: YOUNG_GENERATION_MASKED_CONTENT_SCHEMA,
    audit: YOUNG_GENERATION_MASKING_AUDIT_SCHEMA,
    provenance: {
      type: "object|null",
      required: false,
      description:
        "Legacy free-form provenance retained for backward compatibility alongside structured masking audit fields.",
    },
  },
});

export const YOUNG_GENERATION_ARCHIVE_LINKAGE_SCHEMA = freezeDeep({
  type: "object|null",
  required: false,
  description:
    "Optional archive linkage that points from a preserved young-generation snapshot to the durable archived-memory record created for it.",
  fields: {
    archiveId: {
      type: "string|null",
      required: false,
    },
    archiveNodeId: {
      type: "string|null",
      required: false,
    },
    archivedAt: {
      type: "string|null",
      required: false,
    },
  },
});

export const YOUNG_GENERATION_MEMORY_LIFECYCLE_SCHEMA = freezeDeep({
  type: "object",
  required: true,
  description:
    "Lifecycle metadata for a young-generation memory, including whether retrieval is active, inactive, or durably archived offline.",
  fields: {
    state: {
      type: "enum",
      required: true,
      values: YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES,
    },
    inactiveAt: {
      type: "string|null",
      required: false,
    },
    inactiveReason: {
      type: "string|null",
      required: false,
    },
    archiveLinkage: YOUNG_GENERATION_ARCHIVE_LINKAGE_SCHEMA,
  },
});

export const YOUNG_GENERATION_MEMORY_RECORD_SCHEMA = freezeDeep({
  type: "object",
  required: true,
  requiredFields: freezeDeep([MEMORY_ITEM_IDENTITY_SCHEMA.stableIdField]),
  description:
    "Preserved underlying memory record. It must carry the canonical stable memoryId while allowing caller-defined memory content fields.",
  fields: {
    memoryId: createMemoryStableIdFieldSchema(
      "Canonical stable memory identifier carried by every young-generation memory record. Assigned once, never regenerated, and never reassigned.",
    ),
  },
});

export const YOUNG_GENERATION_MEMORY_SCHEMA_FIELDS = freezeDeep({
  record: YOUNG_GENERATION_MEMORY_RECORD_SCHEMA,
  inactiveForRetrieval: {
    type: "boolean",
    required: true,
    description:
      "Explicit retrieval guard. True means the memory stays stored but is inactive for live retrieval.",
  },
  masking: YOUNG_GENERATION_MASKING_SCHEMA,
  lifecycle: YOUNG_GENERATION_MEMORY_LIFECYCLE_SCHEMA,
});

export const WORKING_MEMORY_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.workingMemory,
  description:
    "Working-memory envelope that preserves the underlying record while allowing non-destructive retrieval masking.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: YOUNG_GENERATION_MEMORY_SCHEMA_FIELDS,
});

export const SHORT_TERM_MEMORY_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.shortTermMemory,
  description:
    "Short-term-memory envelope that preserves the underlying record while allowing non-destructive retrieval masking.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: YOUNG_GENERATION_MEMORY_SCHEMA_FIELDS,
});

export const MEMORY_EVIDENCE_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.memoryEvidence,
  description:
    "Durable evidence artifact that supports a long-term memory claim inside the agent boundary.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: {
    nodeId: {
      type: "string",
      required: true,
      description:
        "Canonical old-generation evidence identifier using old/{agentId}/memory_evidence/{evidenceId}.",
    },
    evidenceId: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    kind: {
      type: "enum",
      required: true,
      values: MEMORY_EVIDENCE_KINDS,
    },
    source: {
      type: "string",
      required: true,
    },
    observedAt: {
      type: "string",
      required: true,
    },
    detail: {
      type: "string",
      required: true,
    },
    reference: {
      type: "string|null",
      required: false,
    },
    provenance: {
      type: "object",
      required: true,
    },
    temporalContext: OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
    salience: OLD_GENERATION_SALIENCE_SCHEMA,
    consolidationState: OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
  },
});

export const CONSOLIDATION_RECORD_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.consolidationRecord,
  description:
    "Offline consolidation audit artifact for promoted, reinforced, superseded, or preserved durable memories.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: {
    nodeId: {
      type: "string",
      required: true,
      description:
        "Canonical old-generation audit identifier using old/{agentId}/consolidation_record/{recordId}.",
    },
    recordId: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    operation: {
      type: "enum",
      required: true,
      values: CONSOLIDATION_OPERATIONS,
    },
    runtimePhase: {
      type: "string",
      required: true,
    },
    consolidatedAt: {
      type: "string",
      required: true,
    },
    sourceMemoryIds: {
      type: "string[]",
      required: true,
    },
    policyVersion: {
      type: "string",
      required: true,
    },
    preservedIdentityFields: {
      type: "string[]",
      required: false,
    },
    provenance: {
      type: "object",
      required: true,
    },
    temporalContext: OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
    salience: OLD_GENERATION_SALIENCE_SCHEMA,
    consolidationState: OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
  },
});

export const ARCHIVED_MEMORY_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.archivedMemory,
  description:
    "Durable archived-memory record that preserves a restore-safe snapshot plus stable source identity and provenance metadata.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: {
    nodeId: {
      type: "string",
      required: true,
      description:
        "Canonical archive identifier using old/{agentId}/archived_memory/{archiveId}.",
    },
    archiveId: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    originalGeneration: {
      type: "enum",
      required: true,
      values: ARCHIVED_MEMORY_SOURCE_GENERATIONS,
    },
    originalMemoryKind: {
      type: "enum",
      required: true,
      values: ARCHIVED_MEMORY_SOURCE_MEMORY_KINDS,
    },
    originalMemoryId: {
      type: "string",
      required: true,
      description:
        "Stable source memory identifier preserved from the archived memory item. It must not be regenerated or reassigned during archival.",
    },
    originalNodeId: {
      type: "string|null",
      required: false,
    },
    originalProvenance: {
      type: "object|null",
      required: false,
      description:
        "Stable source provenance captured from the archived memory before it left its original generation.",
    },
    archivalReason: {
      type: "string",
      required: true,
    },
    archivedAt: {
      type: "string",
      required: true,
    },
    lastRestoredAt: {
      type: "string|null",
      required: false,
    },
    snapshot: {
      type: "object",
      required: true,
      description:
        "Full preserved source-memory snapshot used for safe restore without inventing identity fields, including inactive lifecycle state and archive linkage for archived young-generation envelopes.",
    },
    provenance: {
      type: "object",
      required: true,
      description:
        "Archive-operation provenance that records how and why the memory was durably archived.",
    },
    temporalContext: OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA,
    consolidationState: OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA,
  },
});

export const OLD_GENERATION_EDGE_SCHEMA = freezeDeep({
  memoryAssociation: {
    relation: "long_term_memory_association",
    sourceNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    description:
      "Associates durable memories that should be recalled together without implying replacement.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
    idPattern: OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern,
    fields: OLD_GENERATION_EDGE_FIELDS,
  },
  supportedByEvidence: {
    relation: "long_term_memory_supported_by_evidence",
    sourceNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    description:
      "Links a durable memory to explicit evidence so confidence and provenance remain auditable.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
    idPattern: OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern,
    fields: OLD_GENERATION_EDGE_FIELDS,
  },
  createdByConsolidation: {
    relation: "long_term_memory_created_by_consolidation",
    sourceNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    description:
      "Links a durable memory to the offline consolidation record that wrote or refreshed it.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
    idPattern: OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern,
    fields: OLD_GENERATION_EDGE_FIELDS,
  },
  supersedes: {
    relation: "long_term_memory_supersedes",
    sourceNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    description:
      "Marks that one durable memory has replaced an older canonical memory without deleting audit history.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
    idPattern: OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern,
    fields: OLD_GENERATION_EDGE_FIELDS,
  },
});

export const OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS = freezeDeep(
  Object.fromEntries(
    Object.values(OLD_GENERATION_EDGE_SCHEMA).map((definition) => [
      definition.relation,
      {
        sourceNodeKind: definition.sourceNodeKind,
        targetNodeKind: definition.targetNodeKind,
      },
    ]),
  ),
);

export const OLD_GENERATION_GRAPH_INVARIANTS = freezeDeep([
  "old-generation node ids must be canonical, agent-scoped, and unique within one graph",
  "old-generation edges must use canonical ids, stay inside one agent boundary, and reference existing old-generation nodes",
  "immutable identity is isolated from all old-generation edges and never participates in durable relations",
  "learned traits remain in long-term memory and must keep identity-promotion protection enabled",
  "archived memories must preserve original generation, source identity, archival reason, and archive timing metadata",
  "supersedes edges cannot self-reference, cannot create cycles, and cannot assign multiple successors to the same historical memory",
]);

export const OLD_GENERATION_GRAPH_RULES = freezeDeep({
  version: "1.0.0",
  identityNodeKind: MEMORY_NODE_KINDS.immutableIdentity,
  allowedEdgeCombinations: OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
  invariants: OLD_GENERATION_GRAPH_INVARIANTS,
});

export const OLD_GENERATION_ACCESS_MODES = freezeDeep([
  "retrieval",
  "administrative",
]);

const YOUNG_GENERATION_ACCESS_MODES = freezeDeep([
  "retrieval",
  "inspection",
  "administrative",
]);

export const OLD_GENERATION_RELATIONSHIP_DIRECTIONS = freezeDeep([
  "outbound",
  "inbound",
  "both",
]);

const OLD_GENERATION_RELATIONS = new Set(
  Object.values(OLD_GENERATION_EDGE_SCHEMA).map(({ relation }) => relation),
);
const OLD_GENERATION_ACCESS_MODE_SET = new Set(OLD_GENERATION_ACCESS_MODES);
const YOUNG_GENERATION_ACCESS_MODE_SET = new Set(YOUNG_GENERATION_ACCESS_MODES);
const OLD_GENERATION_RELATIONSHIP_DIRECTION_SET = new Set(
  OLD_GENERATION_RELATIONSHIP_DIRECTIONS,
);

const OLD_GENERATION_NODE_KIND_SET = new Set(OLD_GENERATION_NODE_KINDS);

const OLD_GENERATION_NODE_KIND_TO_LABEL = freezeDeep({
  [MEMORY_NODE_KINDS.longTermMemory]: "long-term memory",
  [MEMORY_NODE_KINDS.archivedMemory]: "archived memory",
  [MEMORY_NODE_KINDS.memoryEvidence]: "memory evidence",
  [MEMORY_NODE_KINDS.consolidationRecord]: "consolidation record",
  [MEMORY_NODE_KINDS.immutableIdentity]: "immutable identity",
});

export const IMPORTANCE_INDEX_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.importanceIndex,
  description:
    "Hippocampus-like young-generation importance metadata keyed to memory ids rather than duplicating memory content.",
  agentScoped: true,
  mergeStrategy: "forbid_cross_agent_merge",
  fields: {
    entryId: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    memoryId: {
      type: "string",
      required: true,
    },
    memoryKind: {
      type: "enum",
      required: true,
      values: YOUNG_GENERATION_MEMORY_KINDS,
    },
    signals: {
      type: "record<number>",
      required: true,
      description:
        "Normalized importance signals stored separately from the referenced memory content.",
    },
    signalCount: {
      type: "number",
      required: true,
      min: 0,
    },
    importanceScore: {
      type: "number",
      required: true,
      min: 0,
      max: 1,
      description: "Derived aggregate score for batching, masking, and promotion decisions.",
    },
    lastUpdatedAt: {
      type: "string",
      required: true,
    },
    provenance: {
      type: "object|null",
      required: false,
      description: "Optional audit metadata for the most recent importance signal update.",
    },
  },
});

export const CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA = freezeDeep({
  description:
    "Explicit importance or stability signal capture retained separately from live and durable memory content.",
  fields: {
    score: {
      type: "number",
      required: true,
      min: 0,
      max: 1,
      description:
        "Aggregate score for the signal family. When omitted at input time it is derived from the normalized signal map.",
    },
    signals: {
      type: "record<number>",
      required: true,
      description:
        "Normalized, explicit signal values that explain why a promotion score was assigned.",
    },
    signalCount: {
      type: "number",
      required: true,
      min: 1,
    },
    capturedAt: {
      type: "string",
      required: true,
      description:
        "Timestamp describing when this signal bundle was captured from its source generation.",
    },
    sourceCollection: {
      type: "string|null",
      required: false,
      description:
        "Optional collection label such as importanceIndex, shortTermMemory, longTermMemory, or consolidationJournal.",
    },
    sourceRecordIds: {
      type: "string[]",
      required: false,
      description:
        "Optional record identifiers that contributed to the explicit signal bundle.",
    },
    provenance: {
      type: "object|null",
      required: false,
      description:
        "Optional capture provenance retained for offline audit and replay.",
    },
  },
});

export const CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA = freezeDeep({
  description:
    "Generation-scoped signal envelope that keeps importance and stability separate for policy evaluation.",
  fields: {
    importance: {
      type: "object|null",
      required: false,
      schema: CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA,
    },
    stability: {
      type: "object|null",
      required: false,
      schema: CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA,
    },
  },
});

export const CONSOLIDATION_PROMOTION_INPUT_SCHEMA = freezeDeep({
  schemaId: "agent_brain_consolidation_promotion_input",
  version: "1.0.0",
  description:
    "Caller-supplied promotion candidate contract carrying explicit young- and old-generation importance and stability captures for offline evaluation.",
  fields: {
    candidateId: {
      type: "string",
      required: true,
    },
    agentId: {
      type: "string",
      required: true,
    },
    sourceMemoryId: {
      type: "string",
      required: true,
    },
    sourceMemoryKind: {
      type: "enum",
      required: true,
      values: YOUNG_GENERATION_MEMORY_KINDS,
    },
    targetMemoryId: {
      type: "string|null",
      required: false,
    },
    targetNodeKind: {
      type: "string",
      required: true,
      const: MEMORY_NODE_KINDS.longTermMemory,
    },
    learnedTraitCandidate: {
      type: "boolean",
      required: false,
    },
    signals: {
      type: "object",
      required: true,
      fields: {
        youngGeneration: {
          type: "object",
          required: true,
          schema: CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA,
          requiredFields: ["importance", "stability"],
        },
        oldGeneration: {
          type: "object",
          required: false,
          schema: CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA,
        },
      },
    },
    provenance: {
      type: "object|null",
      required: false,
    },
  },
});

export const CONSOLIDATION_PROMOTION_POLICY_SCHEMA = freezeDeep({
  schemaId: "agent_brain_consolidation_promotion_policy",
  version: "1.0.0",
  description:
    "Reusable promotion policy for offline consolidation. Runtime-phase authorization remains a separate caller-controlled gate.",
  fields: {
    policyId: {
      type: "string",
      required: true,
    },
    version: {
      type: "string",
      required: true,
    },
    targetNodeKind: {
      type: "string",
      required: true,
      const: MEMORY_NODE_KINDS.longTermMemory,
    },
    requiresRuntimeAuthorization: {
      type: "boolean",
      required: true,
      const: true,
    },
    allowedRuntimePhases: {
      type: "enum[]",
      required: true,
      values: RUNTIME_AUTHORIZED_IDLE_PHASES,
    },
    inactivityHeuristicsAuthorize: {
      type: "boolean",
      required: true,
      const: false,
    },
    teamIdleCoordinatesOnly: {
      type: "boolean",
      required: true,
      const: true,
    },
    allowIdentityPromotion: {
      type: "boolean",
      required: true,
      const: false,
    },
    learnedTraitsTargetNodeKind: {
      type: "string",
      required: true,
      const: MEMORY_NODE_KINDS.longTermMemory,
    },
    protectedIdentityFields: {
      type: "string[]",
      required: true,
      values: PROTECTED_IDENTITY_FIELDS,
    },
    requiredSignals: {
      type: "enum[]",
      required: true,
      values: CONSOLIDATION_PROMOTION_SIGNAL_PATHS,
    },
    thresholds: {
      type: "object",
      required: true,
      fields: {
        minimumPromotionScore: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
        minimumYoungImportanceScore: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
        minimumYoungStabilityScore: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
        minimumOldImportanceScore: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
        minimumOldStabilityScore: {
          type: "number",
          required: true,
          min: 0,
          max: 1,
        },
      },
    },
    weights: {
      type: "object",
      required: true,
      fields: {
        youngImportance: {
          type: "number",
          required: true,
          min: 0,
        },
        youngStability: {
          type: "number",
          required: true,
          min: 0,
        },
        oldImportance: {
          type: "number",
          required: true,
          min: 0,
        },
        oldStability: {
          type: "number",
          required: true,
          min: 0,
        },
      },
    },
  },
});

export const YOUNG_GENERATION_EDGE_SCHEMA = freezeDeep({
  workingMemoryReference: {
    relation: "working_memory_reference",
    sourceNodeKind: MEMORY_NODE_KINDS.workingMemory,
    targetNodeKind: MEMORY_NODE_KINDS.workingMemory,
    description:
      "Links concurrent working-memory items that belong to the same agent and active task horizon.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: false,
  },
  workingToShortTermCapture: {
    relation: "working_to_short_term_capture",
    sourceNodeKind: MEMORY_NODE_KINDS.workingMemory,
    targetNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    description:
      "Captures a live working-memory outcome into short-term memory without leaving the young generation.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
  },
  importanceToWorkingMemory: {
    relation: "importance_to_working_memory",
    sourceNodeKind: MEMORY_NODE_KINDS.importanceIndex,
    targetNodeKind: MEMORY_NODE_KINDS.workingMemory,
    description:
      "Attaches importance metadata to a working-memory item without copying the item content.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
  },
  importanceToShortTermMemory: {
    relation: "importance_to_short_term_memory",
    sourceNodeKind: MEMORY_NODE_KINDS.importanceIndex,
    targetNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    description:
      "Attaches importance metadata to a short-term memory item for later offline consolidation.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
  },
  shortTermRecall: {
    relation: "short_term_recall",
    sourceNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.workingMemory,
    description:
      "Rehydrates a recent short-term episode back into working memory for the same agent.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: false,
  },
  shortTermAssociation: {
    relation: "short_term_association",
    sourceNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    targetNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    description:
      "Associates related short-term episodes so offline consolidation can reason over stability.",
    agentScoped: true,
    crossAgentAllowed: false,
    consolidationVisible: true,
  },
});

export const OLD_GENERATION_DOMAIN_SCHEMA = freezeDeep({
  nodeKind: MEMORY_NODE_KINDS.oldGeneration,
  description:
    "Dedicated old generation domain that combines durable long-term memories, archived memories, explicit evidence, consolidation audit history, and immutable identity.",
  fields: {
    longTermMemory: {
      type: "collection",
      required: true,
      itemNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    },
    archivedMemory: {
      type: "collection",
      required: true,
      itemNodeKind: MEMORY_NODE_KINDS.archivedMemory,
    },
    memoryEvidence: {
      type: "collection",
      required: true,
      itemNodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    },
    consolidationJournal: {
      type: "collection",
      required: true,
      itemNodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    },
    immutableIdentity: {
      type: "node",
      required: true,
      nodeKind: MEMORY_NODE_KINDS.immutableIdentity,
    },
  },
});

export const MEMORY_GRAPH_SCHEMA = freezeDeep({
  schemaId: "agent_brain_memory_graph",
  version: "0.1.0",
  rootNodeKind: MEMORY_NODE_KINDS.root,
  fields: {
    agentId: {
      type: "string",
      required: true,
    },
    youngGeneration: {
      type: "node",
      required: true,
      nodeKind: MEMORY_NODE_KINDS.youngGeneration,
    },
    oldGeneration: {
      type: "node",
      required: true,
      nodeKind: MEMORY_NODE_KINDS.oldGeneration,
    },
    edges: {
      type: "collection",
      required: true,
    },
  },
  edgeSchema: {
    youngGeneration: YOUNG_GENERATION_EDGE_SCHEMA,
    oldGeneration: OLD_GENERATION_EDGE_SCHEMA,
  },
  nodes: {
    youngGeneration: {
      nodeKind: MEMORY_NODE_KINDS.youngGeneration,
      description: "Transient young-generation memory structures.",
      fields: {
        workingMemory: {
          type: "collection",
          required: true,
          itemNodeKind: MEMORY_NODE_KINDS.workingMemory,
        },
        shortTermMemory: {
          type: "collection",
          required: true,
          itemNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
        importanceIndex: {
          type: "collection",
          required: true,
          itemNodeKind: MEMORY_NODE_KINDS.importanceIndex,
        },
      },
    },
    workingMemory: WORKING_MEMORY_SCHEMA,
    shortTermMemory: SHORT_TERM_MEMORY_SCHEMA,
    oldGeneration: OLD_GENERATION_DOMAIN_SCHEMA,
    importanceIndex: IMPORTANCE_INDEX_SCHEMA,
    longTermMemory: LONG_TERM_MEMORY_SCHEMA,
    archivedMemory: ARCHIVED_MEMORY_SCHEMA,
    memoryEvidence: MEMORY_EVIDENCE_SCHEMA,
    consolidationRecord: CONSOLIDATION_RECORD_SCHEMA,
    immutableIdentity: IMMUTABLE_IDENTITY_SCHEMA,
  },
});

export const YOUNG_GENERATION_GRAPH_STATE_SCHEMA = freezeDeep({
  schemaId: "agent_brain_young_generation_graph_state",
  version: "1.0.0",
  description:
    "Versioned public snapshot schema for persisting young-generation graph state and restoring it without internal-only APIs.",
  fields: {
    schemaId: {
      type: "string",
      required: true,
      description: "Snapshot schema identifier for compatibility checks.",
    },
    schemaVersion: {
      type: "string",
      required: true,
      description: "Snapshot schema version for compatibility checks.",
    },
    constructionMetadata: {
      type: "object",
      required: true,
      description:
        "Caller-visible metadata required to reconstruct and validate an in-progress young-generation snapshot.",
      fields: {
        agentId: {
          type: "string",
          required: true,
        },
        savedAt: {
          type: "string",
          required: true,
        },
        sourceGraphSchemaId: {
          type: "string",
          required: true,
        },
        sourceGraphSchemaVersion: {
          type: "string",
          required: true,
        },
        youngGenerationNodeKind: {
          type: "string",
          required: true,
        },
        workingMemoryNodeKind: {
          type: "string",
          required: true,
        },
        shortTermMemoryNodeKind: {
          type: "string",
          required: true,
        },
        importanceIndexNodeKind: {
          type: "string",
          required: true,
        },
        reconstructionMetadata: {
          type: "object",
          required: true,
          description:
            "Persisted young-generation memory descriptors used to classify subsequent graph-state deltas during reconstruction.",
          fields: {
            schemaId: {
              type: "string",
              required: true,
            },
            schemaVersion: {
              type: "string",
              required: true,
            },
            generation: {
              type: "string",
              required: true,
            },
            memories: {
              type: "collection",
              required: true,
              itemType: "object",
            },
          },
        },
      },
    },
    youngGeneration: {
      type: "node",
      required: true,
      nodeKind: MEMORY_NODE_KINDS.youngGeneration,
      description: "Persisted young-generation nodes and collections.",
    },
    edges: {
      type: "collection",
      required: true,
      description:
        "Only edges described by the public young-generation edge schema are included in the snapshot.",
    },
  },
  nodes: {
    youngGeneration: MEMORY_GRAPH_SCHEMA.nodes.youngGeneration,
    workingMemory: WORKING_MEMORY_SCHEMA,
    shortTermMemory: SHORT_TERM_MEMORY_SCHEMA,
    importanceIndex: IMPORTANCE_INDEX_SCHEMA,
  },
  edgeSchema: YOUNG_GENERATION_EDGE_SCHEMA,
});

export const OLD_GENERATION_GRAPH_STATE_SCHEMA = freezeDeep({
  schemaId: "agent_brain_old_generation_graph_state",
  version: "1.0.0",
  description:
    "Versioned public snapshot schema for persisting old-generation durable memory state and restoring it onto runtime-authoritative identity without internal-only APIs.",
  fields: {
    schemaId: {
      type: "string",
      required: true,
      description: "Snapshot schema identifier for compatibility checks.",
    },
    schemaVersion: {
      type: "string",
      required: true,
      description: "Snapshot schema version for compatibility checks.",
    },
    constructionMetadata: {
      type: "object",
      required: true,
      description:
        "Caller-visible metadata required to reconstruct and validate a durable old-generation snapshot.",
      fields: {
        agentId: {
          type: "string",
          required: true,
        },
        savedAt: {
          type: "string",
          required: true,
        },
        sourceGraphSchemaId: {
          type: "string",
          required: true,
        },
        sourceGraphSchemaVersion: {
          type: "string",
          required: true,
        },
        oldGenerationNodeKind: {
          type: "string",
          required: true,
        },
        longTermMemoryNodeKind: {
          type: "string",
          required: true,
        },
        archivedMemoryNodeKind: {
          type: "string",
          required: false,
        },
        memoryEvidenceNodeKind: {
          type: "string",
          required: true,
        },
        consolidationRecordNodeKind: {
          type: "string",
          required: true,
        },
        immutableIdentityNodeKind: {
          type: "string",
          required: true,
        },
        reconstructionMetadata: {
          type: "object",
          required: true,
          description:
            "Persisted old-generation memory descriptors used to classify subsequent graph-state deltas during reconstruction.",
          fields: {
            schemaId: {
              type: "string",
              required: true,
            },
            schemaVersion: {
              type: "string",
              required: true,
            },
            generation: {
              type: "string",
              required: true,
            },
            memories: {
              type: "collection",
              required: true,
              itemType: "object",
            },
          },
        },
      },
    },
    oldGeneration: {
      type: "node",
      required: true,
      nodeKind: MEMORY_NODE_KINDS.oldGeneration,
      description: "Persisted old-generation nodes and collections.",
    },
    edges: {
      type: "collection",
      required: true,
      description:
        "Only edges described by the public old-generation edge schema are included in the snapshot.",
    },
  },
  nodes: {
    oldGeneration: OLD_GENERATION_DOMAIN_SCHEMA,
    longTermMemory: LONG_TERM_MEMORY_SCHEMA,
    archivedMemory: ARCHIVED_MEMORY_SCHEMA,
    memoryEvidence: MEMORY_EVIDENCE_SCHEMA,
    consolidationRecord: CONSOLIDATION_RECORD_SCHEMA,
    immutableIdentity: IMMUTABLE_IDENTITY_SCHEMA,
  },
  edgeSchema: OLD_GENERATION_EDGE_SCHEMA,
});

const YOUNG_GENERATION_EDGE_RELATIONS = new Set(
  Object.values(YOUNG_GENERATION_EDGE_SCHEMA).map(({ relation }) => relation),
);

const YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA = new Map(
  Object.values(YOUNG_GENERATION_EDGE_SCHEMA).map((schema) => [schema.relation, schema]),
);
const IMPORTANCE_EDGE_RELATION_BY_MEMORY_KIND = freezeDeep({
  [MEMORY_NODE_KINDS.workingMemory]:
    YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
  [MEMORY_NODE_KINDS.shortTermMemory]:
    YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
});
const YOUNG_GENERATION_IMPORTANCE_EDGE_RELATIONS = new Set(
  Object.values(IMPORTANCE_EDGE_RELATION_BY_MEMORY_KIND),
);

const YOUNG_GENERATION_MASKED_CONTENT_FIELDS = Object.keys(
  YOUNG_GENERATION_MASKED_CONTENT_SCHEMA.fields,
);
const YOUNG_GENERATION_MASKING_AUDIT_FIELDS = Object.keys(
  YOUNG_GENERATION_MASKING_AUDIT_SCHEMA.fields,
);
const YOUNG_GENERATION_MASKING_FIELDS = Object.keys(YOUNG_GENERATION_MASKING_SCHEMA.fields);
const YOUNG_GENERATION_ARCHIVE_LINKAGE_FIELDS = Object.keys(
  YOUNG_GENERATION_ARCHIVE_LINKAGE_SCHEMA.fields,
);
const YOUNG_GENERATION_MEMORY_LIFECYCLE_FIELDS = Object.keys(
  YOUNG_GENERATION_MEMORY_LIFECYCLE_SCHEMA.fields,
);
const OLD_GENERATION_GRAPH_STATE_FIELDS = Object.keys(OLD_GENERATION_GRAPH_STATE_SCHEMA.fields);
const GRAPH_STATE_RECONSTRUCTION_METADATA_FIELDS = freezeDeep([
  "schemaId",
  "schemaVersion",
  "generation",
  "memories",
]);
const GRAPH_STATE_RECONSTRUCTION_MEMORY_DESCRIPTOR_FIELDS = freezeDeep([
  "memoryId",
  "memoryKind",
  "fingerprint",
]);
const OLD_GENERATION_GRAPH_STATE_CONSTRUCTION_METADATA_FIELDS = Object.keys(
  OLD_GENERATION_GRAPH_STATE_SCHEMA.fields.constructionMetadata.fields,
);
const OLD_GENERATION_DOMAIN_FIELDS = ["generation", ...Object.keys(OLD_GENERATION_DOMAIN_SCHEMA.fields)];
const OLD_GENERATION_EDGE_FIELD_KEYS = Object.keys(OLD_GENERATION_EDGE_FIELDS);
const IMMUTABLE_IDENTITY_FIELD_KEYS = Object.keys(IMMUTABLE_IDENTITY_SCHEMA.fields);
const LONG_TERM_MEMORY_FIELD_KEYS = Object.keys(LONG_TERM_MEMORY_SCHEMA.fields);
const LONG_TERM_MEMORY_PERSISTENCE_FIELD_KEYS = Object.keys(
  LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.fields,
);
const LONG_TERM_MEMORY_PERSISTENCE_CONTENT_FIELD_KEYS = Object.keys(
  LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.fields.content.fields,
);
const LONG_TERM_MEMORY_PERSISTENCE_METADATA_FIELD_KEYS = Object.keys(
  LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.fields.metadata.fields,
);
const ARCHIVED_MEMORY_FIELD_KEYS = Object.keys(ARCHIVED_MEMORY_SCHEMA.fields);
const MEMORY_EVIDENCE_FIELD_KEYS = Object.keys(MEMORY_EVIDENCE_SCHEMA.fields);
const CONSOLIDATION_RECORD_FIELD_KEYS = Object.keys(CONSOLIDATION_RECORD_SCHEMA.fields);

const cloneYoungGenerationEdges = (edges) =>
  cloneArray(edges).filter((edge) => YOUNG_GENERATION_EDGE_RELATIONS.has(edge?.relation));

const cloneNonYoungGenerationEdges = (edges) =>
  cloneArray(edges).filter((edge) => !YOUNG_GENERATION_EDGE_RELATIONS.has(edge?.relation));

const cloneOldGenerationEdges = (edges) =>
  cloneArray(edges).filter((edge) => OLD_GENERATION_RELATIONS.has(edge?.relation));

const cloneNonOldGenerationEdges = (edges) =>
  cloneArray(edges).filter((edge) => !OLD_GENERATION_RELATIONS.has(edge?.relation));

const createYoungGenerationSnapshotEdgeKey = ({ relation, from, to }) =>
  `${relation}:${from}->${to}`;

const createYoungGenerationSnapshotEdge = (edge) => ({
  from: edge?.from,
  to: edge?.to,
  relation: edge?.relation,
});

const createImportanceIndexSnapshotEdge = (entry) => ({
  from: entry.entryId,
  to: entry.memoryId,
  relation: IMPORTANCE_EDGE_RELATION_BY_MEMORY_KIND[entry.memoryKind],
});

const assertImportanceIndexSnapshotEdgesStayAligned = (
  edges,
  youngGeneration,
  labelPrefix,
) => {
  const canonicalEdgesByEntryId = new Map(
    cloneArray(youngGeneration.importanceIndex).map((entry) => [
      entry.entryId,
      createImportanceIndexSnapshotEdge(entry),
    ]),
  );

  cloneArray(edges).forEach((edge, index) => {
    if (!YOUNG_GENERATION_IMPORTANCE_EDGE_RELATIONS.has(edge?.relation)) {
      return;
    }

    const expectedEdge = canonicalEdgesByEntryId.get(edge.from);

    if (!expectedEdge) {
      throw new Error(
        `${labelPrefix}[${index}] must reference a persisted importanceIndex entry, received "${edge.from}".`,
      );
    }

    if (edge.relation !== expectedEdge.relation || edge.to !== expectedEdge.to) {
      throw new Error(
        `${labelPrefix}[${index}] must match importanceIndex entry "${edge.from}" -> "${expectedEdge.to}" via "${expectedEdge.relation}".`,
      );
    }
  });
};

const mergeMissingImportanceIndexSnapshotEdges = (edges, youngGeneration) => {
  const mergedEdges = cloneArray(edges);
  const edgeKeys = new Set(mergedEdges.map(createYoungGenerationSnapshotEdgeKey));

  cloneArray(youngGeneration.importanceIndex).forEach((entry) => {
    const canonicalEdge = createImportanceIndexSnapshotEdge(entry);
    const edgeKey = createYoungGenerationSnapshotEdgeKey(canonicalEdge);

    if (edgeKeys.has(edgeKey)) {
      return;
    }

    mergedEdges.push(canonicalEdge);
    edgeKeys.add(edgeKey);
  });

  return freezeDeep(mergedEdges);
};

const createYoungGenerationSnapshotEdges = (source, youngGeneration) => {
  const snapshotEdges = cloneYoungGenerationEdges(
    readGraphStateSourceValue(source, "getEdges", "edges"),
  ).map(createYoungGenerationSnapshotEdge);

  assertImportanceIndexSnapshotEdgesStayAligned(
    snapshotEdges,
    youngGeneration,
    "Young generation snapshot edges",
  );

  return mergeMissingImportanceIndexSnapshotEdges(snapshotEdges, youngGeneration);
};

const createGraphStateReconstructionFingerprint = (value) => JSON.stringify(value);

const reuseFrozenSnapshotValue = (snapshotValue, canonicalValue, areValuesEqual) =>
  Object.isFrozen(snapshotValue) && areValuesEqual(snapshotValue, canonicalValue)
    ? snapshotValue
    : canonicalValue;

const normalizeGraphStateReconstructionGeneration = (value, label) => {
  const generation = normalizeRequiredString(value, label);

  if (!GRAPH_STATE_RECONSTRUCTION_GENERATION_SET.has(generation)) {
    throw new Error(
      `${label} must be one of ${GRAPH_STATE_RECONSTRUCTION_GENERATIONS.join(", ")}.`,
    );
  }

  return generation;
};

const normalizeGraphStateReconstructionMemoryKind = (
  value,
  generation,
  label,
) => {
  const memoryKind = normalizeRequiredString(value, label);
  const allowedMemoryKinds =
    generation === undefined || generation === null
      ? null
      : GRAPH_STATE_RECONSTRUCTION_MEMORY_KINDS_BY_GENERATION[generation];

  if (allowedMemoryKinds) {
    if (!allowedMemoryKinds.includes(memoryKind)) {
      throw new Error(
        `${label} must be one of ${allowedMemoryKinds.join(", ")}.`,
      );
    }

    return memoryKind;
  }

  if (!GRAPH_STATE_RECONSTRUCTION_MEMORY_KIND_SET.has(memoryKind)) {
    throw new Error(
      `${label} must be one of ${[
        ...GRAPH_STATE_RECONSTRUCTION_MEMORY_KIND_SET,
      ].join(", ")}.`,
    );
  }

  return memoryKind;
};

const normalizeGraphStateDeltaStatus = (value, label) => {
  const status = normalizeRequiredString(value, label);

  if (!GRAPH_STATE_DELTA_STATUS_SET.has(status)) {
    throw new Error(`${label} must be one of ${GRAPH_STATE_DELTA_STATUSES.join(", ")}.`);
  }

  return status;
};

const createGraphStateReconstructionMemoryDescriptorKey = ({
  memoryId,
  memoryKind,
}) => `${memoryKind}:${memoryId}`;

const sortGraphStateReconstructionMemoryDescriptors = (descriptors) =>
  [...descriptors].sort(
    (left, right) =>
      left.memoryKind.localeCompare(right.memoryKind) ||
      left.memoryId.localeCompare(right.memoryId),
  );

const createGraphStateReconstructionMemoryDescriptor = (
  descriptor,
  generation,
  label = "Graph state reconstruction memory descriptor",
) =>
  freezeDeep({
    memoryId: normalizeMemoryItemStableId(descriptor?.memoryId, `${label}.memoryId`),
    memoryKind: normalizeGraphStateReconstructionMemoryKind(
      descriptor?.memoryKind,
      generation,
      `${label}.memoryKind`,
    ),
    fingerprint: normalizeRequiredString(
      descriptor?.fingerprint,
      `${label}.fingerprint`,
    ),
  });

const createGraphStateReconstructionMetadata = (generation, memoryDescriptors) =>
  freezeDeep({
    schemaId: GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.schemaId,
    schemaVersion: GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.version,
    generation: normalizeGraphStateReconstructionGeneration(
      generation,
      "Graph state reconstruction metadata.generation",
    ),
    memories: freezeDeep(
      sortGraphStateReconstructionMemoryDescriptors(memoryDescriptors).map(
        (descriptor, index) =>
          createGraphStateReconstructionMemoryDescriptor(
            descriptor,
            generation,
            `Graph state reconstruction metadata.memories[${index}]`,
          ),
      ),
    ),
  });

const createYoungGenerationGraphStateMemoryDescriptors = (youngGeneration) =>
  freezeDeep(
    sortGraphStateReconstructionMemoryDescriptors([
      ...cloneArray(youngGeneration?.workingMemory).map((memory, index) =>
        createGraphStateReconstructionMemoryDescriptor(
          {
            memoryId: memory?.record?.memoryId,
            memoryKind: MEMORY_NODE_KINDS.workingMemory,
            fingerprint: createGraphStateReconstructionFingerprint(memory),
          },
          "young",
          `Young generation graph state reconstruction workingMemory[${index}]`,
        ),
      ),
      ...cloneArray(youngGeneration?.shortTermMemory).map((memory, index) =>
        createGraphStateReconstructionMemoryDescriptor(
          {
            memoryId: memory?.record?.memoryId,
            memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
            fingerprint: createGraphStateReconstructionFingerprint(memory),
          },
          "young",
          `Young generation graph state reconstruction shortTermMemory[${index}]`,
        ),
      ),
    ]),
  );

const createOldGenerationGraphStateMemoryDescriptors = (oldGeneration) =>
  freezeDeep(
    sortGraphStateReconstructionMemoryDescriptors([
      ...cloneArray(oldGeneration?.longTermMemory).map((memory, index) =>
        createGraphStateReconstructionMemoryDescriptor(
          {
            memoryId: memory?.memoryId,
            memoryKind: MEMORY_NODE_KINDS.longTermMemory,
            fingerprint: createGraphStateReconstructionFingerprint(memory),
          },
          "old",
          `Old generation graph state reconstruction longTermMemory[${index}]`,
        ),
      ),
      ...cloneArray(oldGeneration?.archivedMemory).map((memory, index) =>
        createGraphStateReconstructionMemoryDescriptor(
          {
            memoryId: memory?.originalMemoryId,
            memoryKind: MEMORY_NODE_KINDS.archivedMemory,
            fingerprint: createGraphStateReconstructionFingerprint(memory),
          },
          "old",
          `Old generation graph state reconstruction archivedMemory[${index}]`,
        ),
      ),
    ]),
  );

const validateGraphStateReconstructionMetadata = (metadata, generation, label) => {
  if (!isPlainObject(metadata)) {
    throw new Error(`${label} must be an object.`);
  }

  const unexpectedKey = Object.keys(metadata).find(
    (key) => !GRAPH_STATE_RECONSTRUCTION_METADATA_FIELDS.includes(key),
  );

  if (unexpectedKey) {
    throw new Error(`${label} contains unsupported field "${unexpectedKey}".`);
  }

  const schemaId = normalizeRequiredString(metadata.schemaId, `${label}.schemaId`);
  const schemaVersion = normalizeRequiredString(
    metadata.schemaVersion,
    `${label}.schemaVersion`,
  );
  const metadataGeneration = normalizeGraphStateReconstructionGeneration(
    metadata.generation,
    `${label}.generation`,
  );

  if (schemaId !== GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.schemaId) {
    throw new Error(
      `${label}.schemaId must be "${GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.schemaId}".`,
    );
  }

  if (schemaVersion !== GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.version) {
    throw new Error(
      `${label}.schemaVersion must be "${GRAPH_STATE_RECONSTRUCTION_METADATA_SCHEMA.version}".`,
    );
  }

  if (metadataGeneration !== generation) {
    throw new Error(`${label}.generation must be "${generation}".`);
  }

  if (!Array.isArray(metadata.memories)) {
    throw new Error(`${label}.memories must be an array.`);
  }

  const descriptorKeys = new Set();
  const memories = sortGraphStateReconstructionMemoryDescriptors(
    metadata.memories.map((descriptor, index) => {
      if (!isPlainObject(descriptor)) {
        throw new Error(`${label}.memories[${index}] must be an object.`);
      }

      const unexpectedDescriptorKey = Object.keys(descriptor).find(
        (key) => !GRAPH_STATE_RECONSTRUCTION_MEMORY_DESCRIPTOR_FIELDS.includes(key),
      );

      if (unexpectedDescriptorKey) {
        throw new Error(
          `${label}.memories[${index}] contains unsupported field "${unexpectedDescriptorKey}".`,
        );
      }

      const canonicalDescriptor = createGraphStateReconstructionMemoryDescriptor(
        descriptor,
        generation,
        `${label}.memories[${index}]`,
      );
      const descriptorKey =
        createGraphStateReconstructionMemoryDescriptorKey(canonicalDescriptor);

      if (descriptorKeys.has(descriptorKey)) {
        throw new Error(
          `${label}.memories must be unique, duplicate "${descriptorKey}".`,
        );
      }

      descriptorKeys.add(descriptorKey);

      return canonicalDescriptor;
    }),
  );

  return freezeDeep({
    schemaId,
    schemaVersion,
    generation: metadataGeneration,
    memories: freezeDeep(memories),
  });
};

const normalizePersistedGraphStateReconstructionMetadata = (
  reconstructionMetadata,
  label = "memory graph persistedGraphStateReconstructionMetadata",
) => {
  if (reconstructionMetadata === undefined || reconstructionMetadata === null) {
    return null;
  }

  if (!isPlainObject(reconstructionMetadata)) {
    throw new TypeError(`${label} must be an object`);
  }

  return validateGraphStateReconstructionMetadata(
    reconstructionMetadata,
    normalizeGraphStateReconstructionGeneration(
      reconstructionMetadata.generation,
      `${label}.generation`,
    ),
    label,
  );
};

const normalizePersistedGraphStateReuseState = (
  reuseState,
  label = "memory graph persistedGraphStateReuseState",
) => {
  if (reuseState === undefined || reuseState === null) {
    return null;
  }

  if (!isPlainObject(reuseState)) {
    throw new TypeError(`${label} must be an object`);
  }

  const generation = normalizeGraphStateReconstructionGeneration(
    reuseState?.constructionMetadata?.reconstructionMetadata?.generation,
    `${label}.constructionMetadata.reconstructionMetadata.generation`,
  );

  if (generation === "young") {
    if (!isPlainObject(reuseState.youngGeneration) || !Array.isArray(reuseState.edges)) {
      throw new TypeError(
        `${label} must include youngGeneration and edges for young-generation reuse.`,
      );
    }

    return reuseState;
  }

  if (!isPlainObject(reuseState.oldGeneration) || !Array.isArray(reuseState.edges)) {
    throw new TypeError(
      `${label} must include oldGeneration and edges for old-generation reuse.`,
    );
  }

  return reuseState;
};

const createGraphStateDeltaClassification = ({
  referenceKey,
  memoryId,
  memoryKind,
  status,
  previousFingerprint = null,
  currentFingerprint = null,
}) =>
  freezeDeep({
    referenceKey: normalizeRequiredString(
      referenceKey,
      "Graph state delta classification.referenceKey",
    ),
    memoryId: normalizeMemoryItemStableId(
      memoryId,
      "Graph state delta classification.memoryId",
    ),
    memoryKind: normalizeGraphStateReconstructionMemoryKind(
      memoryKind,
      null,
      "Graph state delta classification.memoryKind",
    ),
    status: normalizeGraphStateDeltaStatus(
      status,
      "Graph state delta classification.status",
    ),
    previousFingerprint:
      previousFingerprint === null
        ? null
        : normalizeRequiredString(
            previousFingerprint,
            "Graph state delta classification.previousFingerprint",
          ),
    currentFingerprint:
      currentFingerprint === null
        ? null
        : normalizeRequiredString(
            currentFingerprint,
            "Graph state delta classification.currentFingerprint",
          ),
  });

const createGraphStateDeltaFromDescriptors = (
  currentDescriptors,
  persistedReconstructionMetadata,
) => {
  if (!persistedReconstructionMetadata) {
    return null;
  }

  const currentByKey = new Map(
    currentDescriptors.map((descriptor) => [
      createGraphStateReconstructionMemoryDescriptorKey(descriptor),
      descriptor,
    ]),
  );
  const previousByKey = new Map(
    persistedReconstructionMetadata.memories.map((descriptor) => [
      createGraphStateReconstructionMemoryDescriptorKey(descriptor),
      descriptor,
    ]),
  );
  const referenceKeys = createSortedUniqueStringList([
    ...currentByKey.keys(),
    ...previousByKey.keys(),
  ]);
  const memories = referenceKeys.map((referenceKey) => {
    const currentDescriptor = currentByKey.get(referenceKey) ?? null;
    const previousDescriptor = previousByKey.get(referenceKey) ?? null;

    if (currentDescriptor && previousDescriptor) {
      return createGraphStateDeltaClassification({
        referenceKey,
        memoryId: currentDescriptor.memoryId,
        memoryKind: currentDescriptor.memoryKind,
        status:
          currentDescriptor.fingerprint === previousDescriptor.fingerprint
            ? GRAPH_STATE_DELTA_STATUSES[0]
            : GRAPH_STATE_DELTA_STATUSES[3],
        previousFingerprint: previousDescriptor.fingerprint,
        currentFingerprint: currentDescriptor.fingerprint,
      });
    }

    if (currentDescriptor) {
      return createGraphStateDeltaClassification({
        referenceKey,
        memoryId: currentDescriptor.memoryId,
        memoryKind: currentDescriptor.memoryKind,
        status: GRAPH_STATE_DELTA_STATUSES[1],
        currentFingerprint: currentDescriptor.fingerprint,
      });
    }

    return createGraphStateDeltaClassification({
      referenceKey,
      memoryId: previousDescriptor.memoryId,
      memoryKind: previousDescriptor.memoryKind,
      status: GRAPH_STATE_DELTA_STATUSES[2],
      previousFingerprint: previousDescriptor.fingerprint,
    });
  });
  const summary = freezeDeep({
    persistedMemoryCount: persistedReconstructionMetadata.memories.length,
    currentMemoryCount: currentDescriptors.length,
    totalComparedCount: memories.length,
    unchangedCount: memories.filter(
      (entry) => entry.status === GRAPH_STATE_DELTA_STATUSES[0],
    ).length,
    addedCount: memories.filter(
      (entry) => entry.status === GRAPH_STATE_DELTA_STATUSES[1],
    ).length,
    removedCount: memories.filter(
      (entry) => entry.status === GRAPH_STATE_DELTA_STATUSES[2],
    ).length,
    modifiedCount: memories.filter(
      (entry) => entry.status === GRAPH_STATE_DELTA_STATUSES[3],
    ).length,
  });

  return freezeDeep({
    generation: persistedReconstructionMetadata.generation,
    summary: freezeDeep({
      ...summary,
      changedCount:
        summary.addedCount + summary.removedCount + summary.modifiedCount,
    }),
    memories: freezeDeep(memories),
  });
};

const createGraphStateDeltaFromGraph = (graph, persistedReconstructionMetadata) => {
  if (!persistedReconstructionMetadata) {
    return null;
  }

  return createGraphStateDeltaFromDescriptors(
    persistedReconstructionMetadata.generation === "young"
      ? createYoungGenerationGraphStateMemoryDescriptors(graph.youngGeneration)
      : createOldGenerationGraphStateMemoryDescriptors(graph.oldGeneration),
    persistedReconstructionMetadata,
  );
};

const createGraphStateDeltaFromRebuildOptions = (
  options,
  persistedReconstructionMetadata,
) => {
  if (!persistedReconstructionMetadata) {
    return null;
  }

  return createGraphStateDeltaFromDescriptors(
    persistedReconstructionMetadata.generation === "young"
      ? createYoungGenerationGraphStateMemoryDescriptors({
          workingMemory: options.workingMemory,
          shortTermMemory: options.shortTermMemory,
        })
      : createOldGenerationGraphStateMemoryDescriptors({
          longTermMemory: options.longTermMemory,
          archivedMemory: options.archivedMemory,
        }),
    persistedReconstructionMetadata,
  );
};

const createGraphStateReconstructionMetadataFromMemoryGraph = (graph, generation) =>
  createGraphStateReconstructionMetadata(
    generation,
    generation === "young"
      ? createYoungGenerationGraphStateMemoryDescriptors(graph?.youngGeneration)
      : createOldGenerationGraphStateMemoryDescriptors(graph?.oldGeneration),
  );

const createMemoryGraphGenerationStateDeltas = (graph, options) => {
  if (!graph?.youngGeneration || !graph?.oldGeneration) {
    return null;
  }

  return freezeDeep({
    young: createGraphStateDeltaFromDescriptors(
      createYoungGenerationGraphStateMemoryDescriptors({
        generation: "young",
        workingMemory: options.workingMemory,
        shortTermMemory: options.shortTermMemory,
        importanceIndex: options.importanceIndex,
      }),
      createGraphStateReconstructionMetadataFromMemoryGraph(graph, "young"),
    ),
    old: createGraphStateDeltaFromDescriptors(
      createOldGenerationGraphStateMemoryDescriptors({
        generation: "old",
        longTermMemory: options.longTermMemory,
        archivedMemory: options.archivedMemory,
        memoryEvidence: options.memoryEvidence,
        consolidationJournal: options.consolidationJournal,
        immutableIdentity: graph.oldGeneration.immutableIdentity,
      }),
      createGraphStateReconstructionMetadataFromMemoryGraph(graph, "old"),
    ),
  });
};

const readGraphStateSourceValue = (source, accessorName, fieldName) => {
  if (typeof source?.[accessorName] === "function") {
    return source[accessorName]();
  }

  return source?.[fieldName];
};

const markMemoryGraphInstance = (graph) => {
  Object.defineProperty(graph, MEMORY_GRAPH_INSTANCE_TOKEN, {
    value: true,
    enumerable: false,
  });

  return graph;
};

const attachMemoryGraphReconstructionBudget = (graph, reconstructionBudget) => {
  if (reconstructionBudget === undefined || reconstructionBudget === null) {
    return graph;
  }

  Object.defineProperty(graph, MEMORY_GRAPH_RECONSTRUCTION_BUDGET_TOKEN, {
    value: createIdleWindowReconstructionBudget(reconstructionBudget),
    enumerable: false,
  });

  return graph;
};

const attachMemoryGraphReconstructionProfileCarrier = (
  graph,
  reconstructionProfileCarrier,
) => {
  if (
    reconstructionProfileCarrier === undefined ||
    reconstructionProfileCarrier === null
  ) {
    return graph;
  }

  Object.defineProperty(graph, MEMORY_GRAPH_RECONSTRUCTION_PROFILE_TOKEN, {
    value: reconstructionProfileCarrier,
    enumerable: false,
  });

  return graph;
};

export const getMemoryGraphReconstructionBudget = (graph) =>
  graph?.[MEMORY_GRAPH_RECONSTRUCTION_BUDGET_TOKEN] ?? null;

export const getMemoryGraphReconstructionProfile = (graph) =>
  graph?.[MEMORY_GRAPH_RECONSTRUCTION_PROFILE_TOKEN] ?? null;

const readRuntimeImmutableIdentitySourceValue = (source) => {
  const explicitIdentity = readGraphStateSourceValue(
    source,
    "getImmutableIdentity",
    "immutableIdentity",
  );

  if (explicitIdentity !== undefined && explicitIdentity !== null) {
    return explicitIdentity;
  }

  if (source?.[MEMORY_GRAPH_INSTANCE_TOKEN]) {
    return source.oldGeneration?.immutableIdentity ?? null;
  }

  return null;
};

export const getMemoryGraphAgentId = (source) => {
  const agentId = readGraphStateSourceValue(source, "getAgentId", "agentId");

  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error(
      "Brain graph serialization requires a non-empty agentId from graph.agentId or graph.getAgentId().",
    );
  }

  return agentId;
};

export const getYoungGenerationConstructionState = (source) =>
  freezeDeep(
    createYoungGeneration(readGraphStateSourceValue(source, "getYoungGeneration", "youngGeneration")),
  );

export const getYoungGenerationSnapshotEdges = (source) => {
  const youngGeneration = getYoungGenerationConstructionState(source);

  return createYoungGenerationSnapshotEdges(source, youngGeneration);
};

export const getOldGenerationConstructionState = (source) => {
  const agentId = getMemoryGraphAgentId(source);
  const runtimeIdentity = createRuntimeImmutableIdentityFromSource(source, agentId);
  const oldGeneration = readGraphStateSourceValue(
    source,
    "getOldGeneration",
    "oldGeneration",
  );

  if (!oldGeneration || typeof oldGeneration !== "object") {
    throw new Error(
      "Old generation graph serialization requires graph.oldGeneration or graph.getOldGeneration().",
    );
  }

  if (!oldGeneration.immutableIdentity || typeof oldGeneration.immutableIdentity !== "object") {
    throw new Error(
      "Old generation graph serialization requires oldGeneration.immutableIdentity.",
    );
  }

  assertImmutableIdentityMatchesRuntimeAuthority(
    runtimeIdentity,
    oldGeneration.immutableIdentity,
    "Old generation graph serialization oldGeneration.immutableIdentity",
    "runtime immutable identity",
  );

  return freezeDeep(
    createOldGeneration(
      runtimeIdentity,
      oldGeneration,
    ),
  );
};

export const getOldGenerationSnapshotEdges = (source) => {
  const agentId = getMemoryGraphAgentId(source);

  return freezeDeep(
    cloneOldGenerationEdges(readGraphStateSourceValue(source, "getEdges", "edges")).map(
      (edge) =>
        createOldGenerationEdge({
          ...edge,
          agentId,
        }),
    ),
  );
};

const createYoungGenerationGraphStateConstructionMetadata = (
  agentId,
  youngGeneration,
) =>
  freezeDeep({
    agentId,
    savedAt: new Date().toISOString(),
    sourceGraphSchemaId: MEMORY_GRAPH_SCHEMA.schemaId,
    sourceGraphSchemaVersion: MEMORY_GRAPH_SCHEMA.version,
    youngGenerationNodeKind: MEMORY_NODE_KINDS.youngGeneration,
    workingMemoryNodeKind: MEMORY_NODE_KINDS.workingMemory,
    shortTermMemoryNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    importanceIndexNodeKind: MEMORY_NODE_KINDS.importanceIndex,
    reconstructionMetadata: createGraphStateReconstructionMetadata(
      "young",
      createYoungGenerationGraphStateMemoryDescriptors(youngGeneration),
    ),
  });

const createOldGenerationGraphStateConstructionMetadata = (
  agentId,
  oldGeneration,
) =>
  freezeDeep({
    agentId,
    savedAt: new Date().toISOString(),
    sourceGraphSchemaId: MEMORY_GRAPH_SCHEMA.schemaId,
    sourceGraphSchemaVersion: MEMORY_GRAPH_SCHEMA.version,
    oldGenerationNodeKind: MEMORY_NODE_KINDS.oldGeneration,
    longTermMemoryNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    archivedMemoryNodeKind: MEMORY_NODE_KINDS.archivedMemory,
    memoryEvidenceNodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    consolidationRecordNodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    immutableIdentityNodeKind: MEMORY_NODE_KINDS.immutableIdentity,
    reconstructionMetadata: createGraphStateReconstructionMetadata(
      "old",
      createOldGenerationGraphStateMemoryDescriptors(oldGeneration),
    ),
  });

const assertYoungGenerationSnapshotObject = (value, label) => {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
};

const assertYoungGenerationSnapshotArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
};

const assertYoungGenerationSnapshotString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
};

const assertYoungGenerationSnapshotBoolean = (value, label) => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
};

const assertYoungGenerationSnapshotNumber = (value, label, minimum = 0, maximum = 1) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  if (value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }

  return value;
};

const assertYoungGenerationSnapshotNullableString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }

  return value;
};

const assertYoungGenerationSnapshotNullableObject = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return cloneObject(assertYoungGenerationSnapshotObject(value, label));
};

const assertYoungGenerationSnapshotAllowedKeys = (value, allowedKeys, label) => {
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));

  if (unexpectedKey) {
    throw new Error(`${label} contains unsupported field "${unexpectedKey}".`);
  }
};

const areYoungGenerationSnapshotValuesEqual = (leftValue, rightValue) =>
  JSON.stringify(leftValue) === JSON.stringify(rightValue);

const validateYoungGenerationGraphStateConstructionMetadata = (graph, metadata) => {
  const snapshotMetadata = assertYoungGenerationSnapshotObject(
    metadata,
    "Young generation graph state constructionMetadata",
  );
  const canonicalMetadata = freezeDeep({
    agentId: assertYoungGenerationSnapshotString(
      snapshotMetadata.agentId,
      "Young generation graph state constructionMetadata.agentId",
    ),
    savedAt: assertYoungGenerationSnapshotString(
      snapshotMetadata.savedAt,
      "Young generation graph state constructionMetadata.savedAt",
    ),
    sourceGraphSchemaId: assertYoungGenerationSnapshotString(
      snapshotMetadata.sourceGraphSchemaId,
      "Young generation graph state constructionMetadata.sourceGraphSchemaId",
    ),
    sourceGraphSchemaVersion: assertYoungGenerationSnapshotString(
      snapshotMetadata.sourceGraphSchemaVersion,
      "Young generation graph state constructionMetadata.sourceGraphSchemaVersion",
    ),
    youngGenerationNodeKind: assertYoungGenerationSnapshotString(
      snapshotMetadata.youngGenerationNodeKind,
      "Young generation graph state constructionMetadata.youngGenerationNodeKind",
    ),
    workingMemoryNodeKind: assertYoungGenerationSnapshotString(
      snapshotMetadata.workingMemoryNodeKind,
      "Young generation graph state constructionMetadata.workingMemoryNodeKind",
    ),
    shortTermMemoryNodeKind: assertYoungGenerationSnapshotString(
      snapshotMetadata.shortTermMemoryNodeKind,
      "Young generation graph state constructionMetadata.shortTermMemoryNodeKind",
    ),
    importanceIndexNodeKind: assertYoungGenerationSnapshotString(
      snapshotMetadata.importanceIndexNodeKind,
      "Young generation graph state constructionMetadata.importanceIndexNodeKind",
    ),
    reconstructionMetadata: validateGraphStateReconstructionMetadata(
      snapshotMetadata.reconstructionMetadata,
      "young",
      "Young generation graph state constructionMetadata.reconstructionMetadata",
    ),
  });

  if (canonicalMetadata.agentId !== graph.agentId) {
    throw new Error(
      "Young generation graph state constructionMetadata.agentId must match the target graph agentId.",
    );
  }

  if (canonicalMetadata.sourceGraphSchemaId !== MEMORY_GRAPH_SCHEMA.schemaId) {
    throw new Error(
      `Young generation graph state sourceGraphSchemaId must be "${MEMORY_GRAPH_SCHEMA.schemaId}".`,
    );
  }

  if (canonicalMetadata.sourceGraphSchemaVersion !== MEMORY_GRAPH_SCHEMA.version) {
    throw new Error(
      `Young generation graph state sourceGraphSchemaVersion must be "${MEMORY_GRAPH_SCHEMA.version}".`,
    );
  }

  const expectedNodeKinds = {
    youngGenerationNodeKind: MEMORY_NODE_KINDS.youngGeneration,
    workingMemoryNodeKind: MEMORY_NODE_KINDS.workingMemory,
    shortTermMemoryNodeKind: MEMORY_NODE_KINDS.shortTermMemory,
    importanceIndexNodeKind: MEMORY_NODE_KINDS.importanceIndex,
  };

  Object.entries(expectedNodeKinds).forEach(([fieldName, expectedValue]) => {
    if (canonicalMetadata[fieldName] !== expectedValue) {
      throw new Error(`Young generation graph state ${fieldName} must be "${expectedValue}".`);
    }
  });

  return canonicalMetadata;
};

const validateYoungGenerationSnapshotMasking = (masking, label) => {
  const snapshotMasking = assertYoungGenerationSnapshotObject(masking, label);
  assertYoungGenerationSnapshotAllowedKeys(snapshotMasking, YOUNG_GENERATION_MASKING_FIELDS, label);

  const maskedOriginalContent =
    snapshotMasking.maskedOriginalContent === undefined || snapshotMasking.maskedOriginalContent === null
      ? null
      : (() => {
          const snapshotMaskedOriginalContent = assertYoungGenerationSnapshotObject(
            snapshotMasking.maskedOriginalContent,
            `${label}.maskedOriginalContent`,
          );
          assertYoungGenerationSnapshotAllowedKeys(
            snapshotMaskedOriginalContent,
            YOUNG_GENERATION_MASKED_CONTENT_FIELDS,
            `${label}.maskedOriginalContent`,
          );

          return freezeDeep({
            value: assertYoungGenerationSnapshotNullableString(
              snapshotMaskedOriginalContent.value,
              `${label}.maskedOriginalContent.value`,
            ),
            sourceField: assertYoungGenerationSnapshotNullableString(
              snapshotMaskedOriginalContent.sourceField,
              `${label}.maskedOriginalContent.sourceField`,
            ),
            capturedAt: assertYoungGenerationSnapshotNullableString(
              snapshotMaskedOriginalContent.capturedAt,
              `${label}.maskedOriginalContent.capturedAt`,
            ),
          });
        })();
  const audit =
    snapshotMasking.audit === undefined || snapshotMasking.audit === null
      ? null
      : (() => {
          const snapshotAudit = assertYoungGenerationSnapshotObject(
            snapshotMasking.audit,
            `${label}.audit`,
          );
          assertYoungGenerationSnapshotAllowedKeys(
            snapshotAudit,
            YOUNG_GENERATION_MASKING_AUDIT_FIELDS,
            `${label}.audit`,
          );

          return freezeDeep({
            auditRecordId: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.auditRecordId,
              `${label}.audit.auditRecordId`,
            ),
            policyVersion: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.policyVersion,
              `${label}.audit.policyVersion`,
            ),
            runtimePhase: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.runtimePhase,
              `${label}.audit.runtimePhase`,
            ),
            sourceEvaluationAt: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.sourceEvaluationAt,
              `${label}.audit.sourceEvaluationAt`,
            ),
            sourceEvaluationMode: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.sourceEvaluationMode,
              `${label}.audit.sourceEvaluationMode`,
            ),
            recordedAt: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.recordedAt,
              `${label}.audit.recordedAt`,
            ),
            actor: assertYoungGenerationSnapshotNullableString(
              snapshotAudit.actor,
              `${label}.audit.actor`,
            ),
            metadata: assertYoungGenerationSnapshotNullableObject(
              snapshotAudit.metadata,
              `${label}.audit.metadata`,
            ),
          });
        })();

  return freezeDeep({
    isMasked: assertYoungGenerationSnapshotBoolean(
      snapshotMasking.isMasked,
      `${label}.isMasked`,
    ),
    maskedAt: assertYoungGenerationSnapshotNullableString(
      snapshotMasking.maskedAt,
      `${label}.maskedAt`,
    ),
    unmaskedAt: assertYoungGenerationSnapshotNullableString(
      snapshotMasking.unmaskedAt,
      `${label}.unmaskedAt`,
    ),
    maskUpdatedAt: assertYoungGenerationSnapshotNullableString(
      snapshotMasking.maskUpdatedAt,
      `${label}.maskUpdatedAt`,
    ),
    maskedBy: assertYoungGenerationSnapshotNullableString(
      snapshotMasking.maskedBy,
      `${label}.maskedBy`,
    ),
    reason: assertYoungGenerationSnapshotNullableString(
      snapshotMasking.reason,
      `${label}.reason`,
    ),
    maskedOriginalContent,
    audit,
    provenance: assertYoungGenerationSnapshotNullableObject(
      snapshotMasking.provenance,
      `${label}.provenance`,
    ),
  });
};

const validateYoungGenerationSnapshotArchiveLinkage = (archiveLinkage, label) => {
  const snapshotArchiveLinkage = assertYoungGenerationSnapshotObject(
    archiveLinkage,
    label,
  );
  assertYoungGenerationSnapshotAllowedKeys(
    snapshotArchiveLinkage,
    YOUNG_GENERATION_ARCHIVE_LINKAGE_FIELDS,
    label,
  );

  return freezeDeep({
    archiveId: assertYoungGenerationSnapshotNullableString(
      snapshotArchiveLinkage.archiveId,
      `${label}.archiveId`,
    ),
    archiveNodeId: assertYoungGenerationSnapshotNullableString(
      snapshotArchiveLinkage.archiveNodeId,
      `${label}.archiveNodeId`,
    ),
    archivedAt: assertYoungGenerationSnapshotNullableString(
      snapshotArchiveLinkage.archivedAt,
      `${label}.archivedAt`,
    ),
  });
};

const validateYoungGenerationSnapshotLifecycle = (lifecycle, label) => {
  const snapshotLifecycle = assertYoungGenerationSnapshotObject(lifecycle, label);
  assertYoungGenerationSnapshotAllowedKeys(
    snapshotLifecycle,
    YOUNG_GENERATION_MEMORY_LIFECYCLE_FIELDS,
    label,
  );
  const state = snapshotLifecycle.state;

  if (
    typeof state !== "string" ||
    !YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES.includes(state)
  ) {
    throw new Error(
      `${label}.state must be one of ${YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES.join(", ")}.`,
    );
  }

  return freezeDeep({
    state,
    inactiveAt: assertYoungGenerationSnapshotNullableString(
      snapshotLifecycle.inactiveAt,
      `${label}.inactiveAt`,
    ),
    inactiveReason: assertYoungGenerationSnapshotNullableString(
      snapshotLifecycle.inactiveReason,
      `${label}.inactiveReason`,
    ),
    archiveLinkage:
      snapshotLifecycle.archiveLinkage === undefined ||
      snapshotLifecycle.archiveLinkage === null
        ? null
        : validateYoungGenerationSnapshotArchiveLinkage(
            snapshotLifecycle.archiveLinkage,
            `${label}.archiveLinkage`,
          ),
  });
};

const validateYoungGenerationSnapshotMemoryEnvelope = (memoryEnvelope, label) => {
  const snapshotMemoryEnvelope = assertYoungGenerationSnapshotObject(memoryEnvelope, label);
  assertYoungGenerationSnapshotAllowedKeys(
    snapshotMemoryEnvelope,
    YOUNG_GENERATION_MEMORY_ENVELOPE_FIELDS,
    label,
  );
  const record = assertYoungGenerationSnapshotObject(
    snapshotMemoryEnvelope.record,
    `${label}.record`,
  );
  const inactiveForRetrieval = assertYoungGenerationSnapshotBoolean(
    snapshotMemoryEnvelope.inactiveForRetrieval,
    `${label}.inactiveForRetrieval`,
  );
  const masking = validateYoungGenerationSnapshotMasking(
    snapshotMemoryEnvelope.masking,
    `${label}.masking`,
  );
  const lifecycle =
    snapshotMemoryEnvelope.lifecycle === undefined ||
    snapshotMemoryEnvelope.lifecycle === null
      ? null
      : validateYoungGenerationSnapshotLifecycle(
          snapshotMemoryEnvelope.lifecycle,
          `${label}.lifecycle`,
        );
  const restoredMemory = createYoungGenerationMemory({
    record: cloneObject(record),
    inactiveForRetrieval,
    masking,
    lifecycle,
  });

  if (
    restoredMemory.inactiveForRetrieval !== inactiveForRetrieval ||
    !areYoungGenerationSnapshotValuesEqual(restoredMemory.masking, masking) ||
    (lifecycle !== null &&
      !areYoungGenerationSnapshotValuesEqual(restoredMemory.lifecycle, lifecycle))
  ) {
    throw new Error(
      `${label} must keep inactiveForRetrieval, masking.isMasked, lifecycle state, and derived masking fields in sync.`,
    );
  }

  return reuseFrozenSnapshotValue(
    snapshotMemoryEnvelope,
    restoredMemory,
    areYoungGenerationSnapshotValuesEqual,
  );
};

const validateYoungGenerationSnapshotSignals = (signals, label) => {
  const snapshotSignals = assertYoungGenerationSnapshotObject(signals, label);
  const normalizedSignals = {};

  Object.entries(snapshotSignals).forEach(([signalName, signalValue]) => {
    if (typeof signalName !== "string" || signalName.length === 0) {
      throw new Error(`${label} signal names must be non-empty strings.`);
    }

    normalizedSignals[signalName] = assertYoungGenerationSnapshotNumber(
      signalValue,
      `${label}.${signalName}`,
    );
  });

  return normalizedSignals;
};

const createYoungGenerationSnapshotNodeIndex = (youngGeneration) => {
  const nodeIndex = {
    [MEMORY_NODE_KINDS.workingMemory]: new Set(),
    [MEMORY_NODE_KINDS.shortTermMemory]: new Set(),
    [MEMORY_NODE_KINDS.importanceIndex]: new Set(),
  };

  [
    {
      collection: youngGeneration.workingMemory,
      collectionLabel: "workingMemory",
      nodeKind: MEMORY_NODE_KINDS.workingMemory,
      idAccessor: (memoryEnvelope) => memoryEnvelope.record.memoryId,
      idLabel: "record.memoryId",
    },
    {
      collection: youngGeneration.shortTermMemory,
      collectionLabel: "shortTermMemory",
      nodeKind: MEMORY_NODE_KINDS.shortTermMemory,
      idAccessor: (memoryEnvelope) => memoryEnvelope.record.memoryId,
      idLabel: "record.memoryId",
    },
    {
      collection: youngGeneration.importanceIndex,
      collectionLabel: "importanceIndex",
      nodeKind: MEMORY_NODE_KINDS.importanceIndex,
      idAccessor: (entry) => entry.entryId,
      idLabel: "entryId",
    },
  ].forEach(({ collection, collectionLabel, nodeKind, idAccessor, idLabel }) => {
    collection.forEach((item, index) => {
      const itemId = idAccessor(item);

      if (typeof itemId !== "string" || itemId.length === 0) {
        return;
      }

      if (nodeIndex[nodeKind].has(itemId)) {
        throw new Error(
          `Young generation graph state ${collectionLabel}[${index}] ${idLabel} "${itemId}" must be unique within "${nodeKind}".`,
        );
      }

      nodeIndex[nodeKind].add(itemId);
    });
  });

  return nodeIndex;
};

const assertYoungGenerationSnapshotMemoryReference = (
  nodeIndex,
  memoryKind,
  memoryId,
  label,
) => {
  if (!nodeIndex[memoryKind]?.has(memoryId)) {
    throw new Error(
      `${label} must reference an existing "${memoryKind}" snapshot node, received "${memoryId}".`,
    );
  }
};

const validateYoungGenerationSnapshotImportanceEntry = (entry, label, agentId, nodeIndex) => {
  const snapshotEntry = assertYoungGenerationSnapshotObject(entry, label);
  const entryId = assertYoungGenerationSnapshotString(snapshotEntry.entryId, `${label}.entryId`);
  const entryAgentId = assertYoungGenerationSnapshotString(
    snapshotEntry.agentId,
    `${label}.agentId`,
  );
  const memoryId = assertYoungGenerationSnapshotString(
    snapshotEntry.memoryId,
    `${label}.memoryId`,
  );
  const memoryKind = assertYoungGenerationSnapshotString(
    snapshotEntry.memoryKind,
    `${label}.memoryKind`,
  );
  const signals = validateYoungGenerationSnapshotSignals(snapshotEntry.signals, `${label}.signals`);
  const signalCount = assertYoungGenerationSnapshotNumber(
    snapshotEntry.signalCount,
    `${label}.signalCount`,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const importanceScore = assertYoungGenerationSnapshotNumber(
    snapshotEntry.importanceScore,
    `${label}.importanceScore`,
  );
  const lastUpdatedAt = assertYoungGenerationSnapshotString(
    snapshotEntry.lastUpdatedAt,
    `${label}.lastUpdatedAt`,
  );
  const provenance = assertYoungGenerationSnapshotNullableObject(
    snapshotEntry.provenance,
    `${label}.provenance`,
  );

  if (entryAgentId !== agentId) {
    throw new Error(
      `${label}.agentId must match constructionMetadata.agentId "${agentId}".`,
    );
  }

  if (!YOUNG_GENERATION_MEMORY_KINDS.includes(memoryKind)) {
    throw new Error(
      `${label}.memoryKind "${memoryKind}" is not supported by the young-generation snapshot schema.`,
    );
  }

  assertYoungGenerationSnapshotMemoryReference(nodeIndex, memoryKind, memoryId, `${label}.memoryId`);

  const restoredEntry = createImportanceIndexEntry({
    entryId,
    agentId: entryAgentId,
    memoryId,
    memoryKind,
    signals,
    lastUpdatedAt,
    provenance,
  });

  if (restoredEntry.signalCount !== signalCount) {
    throw new Error(
      `${label}.signalCount must match the derived signal count ${restoredEntry.signalCount}.`,
    );
  }

  if (restoredEntry.importanceScore !== importanceScore) {
    throw new Error(
      `${label}.importanceScore must match the derived importance score ${restoredEntry.importanceScore}.`,
    );
  }

  return reuseFrozenSnapshotValue(
    snapshotEntry,
    restoredEntry,
    areYoungGenerationSnapshotValuesEqual,
  );
};

const validateYoungGenerationSnapshot = (youngGeneration, agentId) => {
  const snapshotYoungGeneration = assertYoungGenerationSnapshotObject(
    youngGeneration,
    "Young generation graph state youngGeneration",
  );

  if (snapshotYoungGeneration.generation !== "young") {
    throw new Error('Young generation graph state must declare generation "young".');
  }

  const workingMemory = assertYoungGenerationSnapshotArray(
    snapshotYoungGeneration.workingMemory,
    "Young generation graph state youngGeneration.workingMemory",
  ).map((memoryEnvelope, index) =>
    validateYoungGenerationSnapshotMemoryEnvelope(
      memoryEnvelope,
      `Young generation graph state youngGeneration.workingMemory[${index}]`,
    ),
  );
  const shortTermMemory = assertYoungGenerationSnapshotArray(
    snapshotYoungGeneration.shortTermMemory,
    "Young generation graph state youngGeneration.shortTermMemory",
  ).map((memoryEnvelope, index) =>
    validateYoungGenerationSnapshotMemoryEnvelope(
      memoryEnvelope,
      `Young generation graph state youngGeneration.shortTermMemory[${index}]`,
    ),
  );
  const provisionalYoungGeneration = freezeDeep({
    generation: "young",
    workingMemory,
    shortTermMemory,
    importanceIndex: [],
  });
  const nodeIndex = createYoungGenerationSnapshotNodeIndex(provisionalYoungGeneration);
  const importanceIndex = assertYoungGenerationSnapshotArray(
    snapshotYoungGeneration.importanceIndex,
    "Young generation graph state youngGeneration.importanceIndex",
  ).map((entry, index) =>
    validateYoungGenerationSnapshotImportanceEntry(
      entry,
      `Young generation graph state youngGeneration.importanceIndex[${index}]`,
      agentId,
      nodeIndex,
    ),
  );
  const restoredYoungGeneration = freezeDeep({
    generation: "young",
    workingMemory,
    shortTermMemory,
    importanceIndex,
  });

  return {
    youngGeneration: restoredYoungGeneration,
    nodeIndex: createYoungGenerationSnapshotNodeIndex(restoredYoungGeneration),
  };
};

const assertYoungGenerationSnapshotNodeReference = (nodeIndex, nodeId, nodeKind, label) => {
  if (!nodeIndex[nodeKind]?.has(nodeId)) {
    throw new Error(
      `${label} must reference an existing "${nodeKind}" snapshot node, received "${nodeId}".`,
    );
  }
};

const validateYoungGenerationSnapshotEdges = (edges, nodeIndex) => {
  const snapshotEdges = assertYoungGenerationSnapshotArray(
    edges,
    "Young generation graph state edges",
  );
  const edgeKeys = new Set();

  return freezeDeep(
    snapshotEdges.map((edge, index) => {
      const label = `Young generation graph state edges[${index}]`;
      const snapshotEdge = assertYoungGenerationSnapshotObject(edge, label);
      assertYoungGenerationSnapshotAllowedKeys(snapshotEdge, ["from", "to", "relation"], label);
      const from = assertYoungGenerationSnapshotString(snapshotEdge.from, `${label}.from`);
      const to = assertYoungGenerationSnapshotString(snapshotEdge.to, `${label}.to`);
      const relation = assertYoungGenerationSnapshotString(
        snapshotEdge.relation,
        `${label}.relation`,
      );
      const edgeSchema = YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA.get(relation);

      if (!edgeSchema || !YOUNG_GENERATION_EDGE_RELATIONS.has(relation)) {
        throw new Error(
          `Young generation graph state edge relation "${relation}" is not defined by the public young-generation edge schema.`,
        );
      }

      assertYoungGenerationSnapshotNodeReference(
        nodeIndex,
        from,
        edgeSchema.sourceNodeKind,
        `${label}.from`,
      );
      assertYoungGenerationSnapshotNodeReference(
        nodeIndex,
        to,
        edgeSchema.targetNodeKind,
        `${label}.to`,
      );

      const edgeKey = `${relation}:${from}->${to}`;
      if (edgeKeys.has(edgeKey)) {
        throw new Error(`Young generation graph state edges must be unique, duplicate "${edgeKey}".`);
      }

      edgeKeys.add(edgeKey);

      const restoredEdge = {
        from,
        to,
        relation,
      };

      return reuseFrozenSnapshotValue(
        snapshotEdge,
        restoredEdge,
        areYoungGenerationSnapshotValuesEqual,
      );
    }),
  );
};

const reconcileYoungGenerationSnapshotEdges = (edges, youngGeneration, labelPrefix) => {
  assertImportanceIndexSnapshotEdgesStayAligned(edges, youngGeneration, labelPrefix);

  return mergeMissingImportanceIndexSnapshotEdges(edges, youngGeneration);
};

const deserializeYoungGenerationGraphState = (graph, state) => {
  const snapshotState = assertYoungGenerationSnapshotObject(
    state,
    "Young generation graph state",
  );
  const schemaId = assertYoungGenerationSnapshotString(
    snapshotState.schemaId,
    "Young generation graph state schemaId",
  );
  const schemaVersion = assertYoungGenerationSnapshotString(
    snapshotState.schemaVersion,
    "Young generation graph state schemaVersion",
  );

  if (schemaId !== YOUNG_GENERATION_GRAPH_STATE_SCHEMA.schemaId) {
    throw new Error(
      `Young generation graph state schemaId must be "${YOUNG_GENERATION_GRAPH_STATE_SCHEMA.schemaId}".`,
    );
  }

  if (schemaVersion !== YOUNG_GENERATION_GRAPH_STATE_SCHEMA.version) {
    throw new Error(
      `Young generation graph state schemaVersion must be "${YOUNG_GENERATION_GRAPH_STATE_SCHEMA.version}".`,
    );
  }

  const constructionMetadata = validateYoungGenerationGraphStateConstructionMetadata(
    graph,
    snapshotState.constructionMetadata,
  );
  const { youngGeneration, nodeIndex } = validateYoungGenerationSnapshot(
    snapshotState.youngGeneration,
    constructionMetadata.agentId,
  );

  return freezeDeep({
    schemaId,
    schemaVersion,
    constructionMetadata,
    youngGeneration,
    edges: reconcileYoungGenerationSnapshotEdges(
      validateYoungGenerationSnapshotEdges(snapshotState.edges, nodeIndex),
      youngGeneration,
      "Young generation graph state edges",
    ),
  });
};

const assertOldGenerationSnapshotObject = (value, label) => {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
};

const assertOldGenerationSnapshotArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
};

const assertOldGenerationSnapshotString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
};

const assertOldGenerationSnapshotAllowedKeys = (value, allowedKeys, label) => {
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));

  if (unexpectedKey) {
    throw new Error(`${label} contains unsupported field "${unexpectedKey}".`);
  }
};

const areOldGenerationSnapshotValuesEqual = (leftValue, rightValue) =>
  JSON.stringify(leftValue) === JSON.stringify(rightValue);

const createRuntimeImmutableIdentityFromSource = (source, agentId) => {
  const identitySource = readRuntimeImmutableIdentitySourceValue(source);

  if (!identitySource || typeof identitySource !== "object") {
    throw new Error(
      "Old generation graph serialization requires runtime immutable identity from a concrete graph instance, source.immutableIdentity, or source.getImmutableIdentity().",
    );
  }

  return createImmutableIdentity({
    ...identitySource,
    agentId,
  });
};

const assertImmutableIdentityMatchesRuntimeAuthority = (
  runtimeIdentity,
  candidateIdentity,
  label,
  authorityLabel,
  comparedFieldNames = IMMUTABLE_IDENTITY_FIELD_KEYS,
) => {
  const normalizedCandidateIdentity = createImmutableIdentity({
    ...candidateIdentity,
    agentId: runtimeIdentity.agentId,
  });

  comparedFieldNames.forEach((fieldName) => {
    if (fieldName === "nodeId") {
      if (runtimeIdentity.nodeId !== normalizedCandidateIdentity.nodeId) {
        throw new Error(`${label}.nodeId must match the ${authorityLabel} nodeId.`);
      }

      return;
    }

    if (
      !areOldGenerationSnapshotValuesEqual(
        runtimeIdentity[fieldName],
        normalizedCandidateIdentity[fieldName],
      )
    ) {
      throw new Error(`${label}.${fieldName} must match the ${authorityLabel}.`);
    }
  });
};

const validateOldGenerationGraphStateConstructionMetadata = (graph, metadata) => {
  const snapshotMetadata = assertOldGenerationSnapshotObject(
    metadata,
    "Old generation graph state constructionMetadata",
  );
  assertOldGenerationSnapshotAllowedKeys(
    snapshotMetadata,
    OLD_GENERATION_GRAPH_STATE_CONSTRUCTION_METADATA_FIELDS,
    "Old generation graph state constructionMetadata",
  );

  const canonicalMetadata = freezeDeep({
    agentId: assertOldGenerationSnapshotString(
      snapshotMetadata.agentId,
      "Old generation graph state constructionMetadata.agentId",
    ),
    savedAt: assertOldGenerationSnapshotString(
      snapshotMetadata.savedAt,
      "Old generation graph state constructionMetadata.savedAt",
    ),
    sourceGraphSchemaId: assertOldGenerationSnapshotString(
      snapshotMetadata.sourceGraphSchemaId,
      "Old generation graph state constructionMetadata.sourceGraphSchemaId",
    ),
    sourceGraphSchemaVersion: assertOldGenerationSnapshotString(
      snapshotMetadata.sourceGraphSchemaVersion,
      "Old generation graph state constructionMetadata.sourceGraphSchemaVersion",
    ),
    oldGenerationNodeKind: assertOldGenerationSnapshotString(
      snapshotMetadata.oldGenerationNodeKind,
      "Old generation graph state constructionMetadata.oldGenerationNodeKind",
    ),
    longTermMemoryNodeKind: assertOldGenerationSnapshotString(
      snapshotMetadata.longTermMemoryNodeKind,
      "Old generation graph state constructionMetadata.longTermMemoryNodeKind",
    ),
    archivedMemoryNodeKind:
      snapshotMetadata.archivedMemoryNodeKind === undefined
        ? MEMORY_NODE_KINDS.archivedMemory
        : assertOldGenerationSnapshotString(
            snapshotMetadata.archivedMemoryNodeKind,
            "Old generation graph state constructionMetadata.archivedMemoryNodeKind",
          ),
    memoryEvidenceNodeKind: assertOldGenerationSnapshotString(
      snapshotMetadata.memoryEvidenceNodeKind,
      "Old generation graph state constructionMetadata.memoryEvidenceNodeKind",
    ),
    consolidationRecordNodeKind: assertOldGenerationSnapshotString(
      snapshotMetadata.consolidationRecordNodeKind,
      "Old generation graph state constructionMetadata.consolidationRecordNodeKind",
    ),
    immutableIdentityNodeKind: assertOldGenerationSnapshotString(
      snapshotMetadata.immutableIdentityNodeKind,
      "Old generation graph state constructionMetadata.immutableIdentityNodeKind",
    ),
    reconstructionMetadata: validateGraphStateReconstructionMetadata(
      snapshotMetadata.reconstructionMetadata,
      "old",
      "Old generation graph state constructionMetadata.reconstructionMetadata",
    ),
  });

  if (canonicalMetadata.agentId !== graph.agentId) {
    throw new Error(
      "Old generation graph state constructionMetadata.agentId must match the target graph agentId.",
    );
  }

  if (canonicalMetadata.sourceGraphSchemaId !== MEMORY_GRAPH_SCHEMA.schemaId) {
    throw new Error(
      `Old generation graph state sourceGraphSchemaId must be "${MEMORY_GRAPH_SCHEMA.schemaId}".`,
    );
  }

  if (canonicalMetadata.sourceGraphSchemaVersion !== MEMORY_GRAPH_SCHEMA.version) {
    throw new Error(
      `Old generation graph state sourceGraphSchemaVersion must be "${MEMORY_GRAPH_SCHEMA.version}".`,
    );
  }

  const expectedNodeKinds = {
    oldGenerationNodeKind: MEMORY_NODE_KINDS.oldGeneration,
    longTermMemoryNodeKind: MEMORY_NODE_KINDS.longTermMemory,
    archivedMemoryNodeKind: MEMORY_NODE_KINDS.archivedMemory,
    memoryEvidenceNodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    consolidationRecordNodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    immutableIdentityNodeKind: MEMORY_NODE_KINDS.immutableIdentity,
  };

  Object.entries(expectedNodeKinds).forEach(([fieldName, expectedValue]) => {
    if (canonicalMetadata[fieldName] !== expectedValue) {
      throw new Error(`Old generation graph state ${fieldName} must be "${expectedValue}".`);
    }
  });

  return canonicalMetadata;
};

const assertOldGenerationSnapshotIdentityCompatibility = (graph, snapshotIdentity) => {
  assertImmutableIdentityMatchesRuntimeAuthority(
    createImmutableIdentity(graph.oldGeneration.immutableIdentity),
    snapshotIdentity,
    "Old generation graph state immutableIdentity",
    "target graph runtime identity",
    ["nodeId", ...PROTECTED_IDENTITY_FIELDS],
  );
};

const validateOldGenerationSnapshot = (graph, oldGeneration, agentId) => {
  const snapshotOldGeneration = assertOldGenerationSnapshotObject(
    oldGeneration,
    "Old generation graph state oldGeneration",
  );
  assertOldGenerationSnapshotAllowedKeys(
    snapshotOldGeneration,
    OLD_GENERATION_DOMAIN_FIELDS,
    "Old generation graph state oldGeneration",
  );

  if (snapshotOldGeneration.generation !== "old") {
    throw new Error('Old generation graph state must declare generation "old".');
  }

  const snapshotIdentity = assertOldGenerationSnapshotObject(
    snapshotOldGeneration.immutableIdentity,
    "Old generation graph state oldGeneration.immutableIdentity",
  );
  assertOldGenerationSnapshotAllowedKeys(
    snapshotIdentity,
    IMMUTABLE_IDENTITY_FIELD_KEYS,
    "Old generation graph state oldGeneration.immutableIdentity",
  );

  const immutableIdentity = createImmutableIdentity(graph.oldGeneration.immutableIdentity);

  assertOldGenerationSnapshotIdentityCompatibility(graph, {
    ...snapshotIdentity,
    agentId,
  });

  return freezeDeep({
    generation: "old",
    longTermMemory: assertOldGenerationSnapshotArray(
      snapshotOldGeneration.longTermMemory,
      "Old generation graph state oldGeneration.longTermMemory",
    ).map((memory, index) => {
      const label = `Old generation graph state oldGeneration.longTermMemory[${index}]`;
      const snapshotMemory = assertOldGenerationSnapshotObject(memory, label);
      assertOldGenerationSnapshotAllowedKeys(snapshotMemory, LONG_TERM_MEMORY_FIELD_KEYS, label);

      const restoredMemory = createLongTermMemory({
        ...snapshotMemory,
        agentId,
      });

      return reuseFrozenSnapshotValue(
        snapshotMemory,
        restoredMemory,
        areOldGenerationSnapshotValuesEqual,
      );
    }),
    archivedMemory:
      snapshotOldGeneration.archivedMemory === undefined
        ? []
        : assertOldGenerationSnapshotArray(
            snapshotOldGeneration.archivedMemory,
            "Old generation graph state oldGeneration.archivedMemory",
          ).map((archivedMemory, index) => {
            const label = `Old generation graph state oldGeneration.archivedMemory[${index}]`;
            const snapshotArchivedMemory = assertOldGenerationSnapshotObject(
              archivedMemory,
              label,
            );
            assertOldGenerationSnapshotAllowedKeys(
              snapshotArchivedMemory,
              ARCHIVED_MEMORY_FIELD_KEYS,
              label,
            );

            const restoredArchivedMemory = createArchivedMemory({
              ...snapshotArchivedMemory,
              agentId,
            });

            return reuseFrozenSnapshotValue(
              snapshotArchivedMemory,
              restoredArchivedMemory,
              areOldGenerationSnapshotValuesEqual,
            );
          }),
    memoryEvidence: assertOldGenerationSnapshotArray(
      snapshotOldGeneration.memoryEvidence,
      "Old generation graph state oldGeneration.memoryEvidence",
    ).map((evidence, index) => {
      const label = `Old generation graph state oldGeneration.memoryEvidence[${index}]`;
      const snapshotEvidence = assertOldGenerationSnapshotObject(evidence, label);
      assertOldGenerationSnapshotAllowedKeys(
        snapshotEvidence,
        MEMORY_EVIDENCE_FIELD_KEYS,
        label,
      );

      const restoredEvidence = createMemoryEvidence({
        ...snapshotEvidence,
        agentId,
      });

      return reuseFrozenSnapshotValue(
        snapshotEvidence,
        restoredEvidence,
        areOldGenerationSnapshotValuesEqual,
      );
    }),
    consolidationJournal: assertOldGenerationSnapshotArray(
      snapshotOldGeneration.consolidationJournal,
      "Old generation graph state oldGeneration.consolidationJournal",
    ).map((record, index) => {
      const label = `Old generation graph state oldGeneration.consolidationJournal[${index}]`;
      const snapshotRecord = assertOldGenerationSnapshotObject(record, label);
      assertOldGenerationSnapshotAllowedKeys(
        snapshotRecord,
        CONSOLIDATION_RECORD_FIELD_KEYS,
        label,
      );

      const restoredRecord = createConsolidationRecord({
        ...snapshotRecord,
        agentId,
      });

      return reuseFrozenSnapshotValue(
        snapshotRecord,
        restoredRecord,
        areOldGenerationSnapshotValuesEqual,
      );
    }),
    immutableIdentity,
  });
};

const validateOldGenerationSnapshotEdges = (edges, agentId) => {
  const snapshotEdges = assertOldGenerationSnapshotArray(
    edges,
    "Old generation graph state edges",
  );
  const edgeIds = new Set();

  return freezeDeep(
    snapshotEdges.map((edge, index) => {
      const label = `Old generation graph state edges[${index}]`;
      const snapshotEdge = assertOldGenerationSnapshotObject(edge, label);
      assertOldGenerationSnapshotAllowedKeys(snapshotEdge, OLD_GENERATION_EDGE_FIELD_KEYS, label);
      const relation = assertOldGenerationSnapshotString(snapshotEdge.relation, `${label}.relation`);

      if (!OLD_GENERATION_RELATIONS.has(relation)) {
        throw new Error(
          `Old generation graph state edge relation "${relation}" is not defined by the public old-generation edge schema.`,
        );
      }

      const restoredEdge = createOldGenerationEdge({
        ...snapshotEdge,
        agentId,
      });

      if (edgeIds.has(restoredEdge.edgeId)) {
        throw new Error(
          `Old generation graph state edges must be unique, duplicate "${restoredEdge.edgeId}".`,
        );
      }

      edgeIds.add(restoredEdge.edgeId);
      return reuseFrozenSnapshotValue(
        snapshotEdge,
        restoredEdge,
        areOldGenerationSnapshotValuesEqual,
      );
    }),
  );
};

const deserializeOldGenerationGraphState = (graph, state) => {
  const snapshotState = assertOldGenerationSnapshotObject(
    state,
    "Old generation graph state",
  );
  assertOldGenerationSnapshotAllowedKeys(
    snapshotState,
    OLD_GENERATION_GRAPH_STATE_FIELDS,
    "Old generation graph state",
  );
  const schemaId = assertOldGenerationSnapshotString(
    snapshotState.schemaId,
    "Old generation graph state schemaId",
  );
  const schemaVersion = assertOldGenerationSnapshotString(
    snapshotState.schemaVersion,
    "Old generation graph state schemaVersion",
  );

  if (schemaId !== OLD_GENERATION_GRAPH_STATE_SCHEMA.schemaId) {
    throw new Error(
      `Old generation graph state schemaId must be "${OLD_GENERATION_GRAPH_STATE_SCHEMA.schemaId}".`,
    );
  }

  if (schemaVersion !== OLD_GENERATION_GRAPH_STATE_SCHEMA.version) {
    throw new Error(
      `Old generation graph state schemaVersion must be "${OLD_GENERATION_GRAPH_STATE_SCHEMA.version}".`,
    );
  }

  const constructionMetadata = validateOldGenerationGraphStateConstructionMetadata(
    graph,
    snapshotState.constructionMetadata,
  );

  return freezeDeep({
    schemaId,
    schemaVersion,
    constructionMetadata,
    oldGeneration: validateOldGenerationSnapshot(
      graph,
      snapshotState.oldGeneration,
      constructionMetadata.agentId,
    ),
    edges: validateOldGenerationSnapshotEdges(
      snapshotState.edges,
      constructionMetadata.agentId,
    ),
  });
};

const encodeIdentifierSegment = (value) => encodeURIComponent(String(value ?? ""));

const decodeIdentifierSegment = (value, label) => {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    throw new Error(`Invalid old-generation ${label} "${value}".`);
  }
};

const parseOldGenerationNodeId = (nodeId) => {
  if (typeof nodeId !== "string") {
    throw new Error("Old-generation nodeId must be a string.");
  }

  const parts = nodeId.split("/");
  if (parts.length !== 4 || parts[0] !== "old") {
    throw new Error(
      `Old-generation nodeId "${nodeId}" must match "${OLD_GENERATION_IDENTIFIER_SCHEMA.nodeIdPattern}".`,
    );
  }

  const agentId = decodeIdentifierSegment(parts[1], "node agentId");
  const nodeKind = decodeIdentifierSegment(parts[2], "node kind");
  const localId = decodeIdentifierSegment(parts[3], "node localId");

  if (!OLD_GENERATION_NODE_KIND_SET.has(nodeKind)) {
    throw new Error(`Old-generation nodeId "${nodeId}" uses unsupported node kind "${nodeKind}".`);
  }

  if (
    nodeKind === MEMORY_NODE_KINDS.immutableIdentity &&
    localId !== OLD_GENERATION_IDENTIFIER_SCHEMA.identityLocalId
  ) {
    throw new Error(
      `Old-generation immutable identity nodeId "${nodeId}" must use local id "${OLD_GENERATION_IDENTIFIER_SCHEMA.identityLocalId}".`,
    );
  }

  return freezeDeep({
    agentId,
    nodeKind,
    localId,
  });
};

const parseOldGenerationEdgeId = (edgeId) => {
  if (typeof edgeId !== "string") {
    throw new Error("Old-generation edgeId must be a string.");
  }

  const parts = edgeId.split("/");
  if (parts.length !== 5 || parts[0] !== "old" || parts[2] !== "edge") {
    throw new Error(
      `Old-generation edgeId "${edgeId}" must match "${OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern}".`,
    );
  }

  const agentId = decodeIdentifierSegment(parts[1], "edge agentId");
  const relation = decodeIdentifierSegment(parts[3], "edge relation");
  const endpointSegment = parts[4];
  const separatorIndex = endpointSegment.indexOf("->");

  if (separatorIndex <= 0) {
    throw new Error(
      `Old-generation edgeId "${edgeId}" must include encoded source and target node ids separated by "->".`,
    );
  }

  const from = decodeIdentifierSegment(
    endpointSegment.slice(0, separatorIndex),
    "edge source node id",
  );
  const to = decodeIdentifierSegment(
    endpointSegment.slice(separatorIndex + 2),
    "edge target node id",
  );

  if (!OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS[relation]) {
    throw new Error(`Old-generation edgeId "${edgeId}" uses unsupported relation "${relation}".`);
  }

  return freezeDeep({
    agentId,
    relation,
    from,
    to,
  });
};

export const createOldGenerationNodeId = (nodeKind, agentId, localId) =>
  `old/${encodeIdentifierSegment(agentId)}/${encodeIdentifierSegment(nodeKind)}/${encodeIdentifierSegment(localId)}`;

export const createOldGenerationEdgeId = ({ agentId, relation, from, to }) =>
  `old/${encodeIdentifierSegment(agentId)}/edge/${encodeIdentifierSegment(relation)}/${encodeIdentifierSegment(from)}->${encodeIdentifierSegment(to)}`;

const assertOldGenerationNodeId = ({
  nodeId,
  agentId,
  nodeKind,
  localId,
  entityLabel,
}) => {
  if (localId === undefined || localId === null || String(localId).length === 0) {
    throw new Error(`${entityLabel} must provide a local id for canonical old-generation node validation.`);
  }

  const parsedNodeId = parseOldGenerationNodeId(nodeId);

  if (parsedNodeId.agentId !== agentId) {
    throw new Error(
      `${entityLabel} nodeId "${nodeId}" must stay inside agent "${agentId}".`,
    );
  }

  if (parsedNodeId.nodeKind !== nodeKind) {
    throw new Error(
      `${entityLabel} nodeId "${nodeId}" must use node kind "${nodeKind}".`,
    );
  }

  if (parsedNodeId.localId !== String(localId)) {
    throw new Error(
      `${entityLabel} nodeId "${nodeId}" must encode local id "${localId}".`,
    );
  }

  return parsedNodeId;
};

const assertOldGenerationEdgeShape = (edge) => {
  const allowedCombination = OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS[edge.relation];

  if (!allowedCombination) {
    throw new Error(`Old-generation edge relation "${edge.relation}" is not supported.`);
  }

  const parsedFromNodeId = parseOldGenerationNodeId(edge.from);
  const parsedToNodeId = parseOldGenerationNodeId(edge.to);

  if (edge.agentId !== parsedFromNodeId.agentId || edge.agentId !== parsedToNodeId.agentId) {
    throw new Error(
      `Old-generation edge "${edge.relation}" must keep source, target, and edge agentId inside "${edge.agentId}".`,
    );
  }

  if (parsedFromNodeId.nodeKind !== allowedCombination.sourceNodeKind) {
    throw new Error(
      `Old-generation edge "${edge.relation}" source "${edge.from}" must be a "${allowedCombination.sourceNodeKind}" node.`,
    );
  }

  if (parsedToNodeId.nodeKind !== allowedCombination.targetNodeKind) {
    throw new Error(
      `Old-generation edge "${edge.relation}" target "${edge.to}" must be a "${allowedCombination.targetNodeKind}" node.`,
    );
  }

  const expectedEdgeId = createOldGenerationEdgeId(edge);
  if (edge.edgeId !== expectedEdgeId) {
    throw new Error(
      `Old-generation edge "${edge.relation}" must use canonical edgeId "${expectedEdgeId}".`,
    );
  }

  const parsedEdgeId = parseOldGenerationEdgeId(edge.edgeId);
  if (
    parsedEdgeId.agentId !== edge.agentId ||
    parsedEdgeId.relation !== edge.relation ||
    parsedEdgeId.from !== edge.from ||
    parsedEdgeId.to !== edge.to
  ) {
    throw new Error(
      `Old-generation edgeId "${edge.edgeId}" must encode the same agent, relation, source, and target as the edge payload.`,
    );
  }

  return freezeDeep({
    sourceNodeId: parsedFromNodeId,
    targetNodeId: parsedToNodeId,
    allowedCombination,
  });
};

const assertLongTermMemoryCategory = (category) => {
  if (!LONG_TERM_MEMORY_CATEGORIES.includes(category)) {
    throw new Error(`Old-generation long-term memory category "${category}" is not supported.`);
  }
};

const assertMemoryEvidenceKind = (kind) => {
  if (!MEMORY_EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`Old-generation memory evidence kind "${kind}" is not supported.`);
  }
};

const assertConsolidationOperation = (operation) => {
  if (!CONSOLIDATION_OPERATIONS.includes(operation)) {
    throw new Error(`Old-generation consolidation operation "${operation}" is not supported.`);
  }
};

const assertArchivedMemorySourceGeneration = (generation) => {
  if (!ARCHIVED_MEMORY_SOURCE_GENERATIONS.includes(generation)) {
    throw new Error(
      `Archived memory originalGeneration "${generation}" is not supported.`,
    );
  }
};

const assertArchivedMemorySourceMemoryKind = (memoryKind) => {
  if (!ARCHIVED_MEMORY_SOURCE_MEMORY_KINDS.includes(memoryKind)) {
    throw new Error(
      `Archived memory originalMemoryKind "${memoryKind}" is not supported.`,
    );
  }
};

const normalizeConsolidationOperation = (value) =>
  CONSOLIDATION_OPERATIONS.includes(value) ? value : null;

const normalizeOldGenerationConsolidationStatus = (value, fallback) =>
  OLD_GENERATION_CONSOLIDATION_STATES.includes(value) ? value : fallback;

export const createOldGenerationTemporalContext = (input = {}, fallback = {}) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalizedFallback =
    fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};

  return freezeDeep({
    firstObservedAt: normalizeNullableString(
      normalizedInput.firstObservedAt ?? normalizedFallback.firstObservedAt,
    ),
    lastObservedAt: normalizeNullableString(
      normalizedInput.lastObservedAt ?? normalizedFallback.lastObservedAt,
    ),
    stabilizedAt: normalizeNullableString(
      normalizedInput.stabilizedAt ?? normalizedFallback.stabilizedAt,
    ),
    consolidatedAt: normalizeNullableString(
      normalizedInput.consolidatedAt ?? normalizedFallback.consolidatedAt,
    ),
    lastAccessedAt: normalizeNullableString(
      normalizedInput.lastAccessedAt ?? normalizedFallback.lastAccessedAt,
    ),
    supersededAt: normalizeNullableString(
      normalizedInput.supersededAt ?? normalizedFallback.supersededAt,
    ),
  });
};

export const createOldGenerationSalience = (input = null, fallbackScore = null) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const signals = normalizeSignals(normalizedInput.signals);
  const explicitScore = normalizedInput.score;
  let score = null;

  if (explicitScore !== undefined && explicitScore !== null) {
    score = normalizeNumber(explicitScore);
  } else if (Object.keys(signals).length > 0) {
    score = calculateImportanceScore(signals);
  } else if (fallbackScore !== undefined && fallbackScore !== null) {
    score = normalizeNumber(fallbackScore);
  }

  if (input === null && fallbackScore === null && Object.keys(signals).length === 0) {
    return null;
  }

  return freezeDeep({
    score,
    signals,
    signalCount: Object.keys(signals).length,
    lastEvaluatedAt: normalizeNullableString(normalizedInput.lastEvaluatedAt),
    sourceEntryId: normalizeNullableString(normalizedInput.sourceEntryId),
  });
};

export const createOldGenerationConsolidationState = (input = null, defaults = {}) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalizedDefaults =
    defaults && typeof defaults === "object" && !Array.isArray(defaults) ? defaults : {};
  const inputProtectedFromIdentityPromotion =
    normalizedInput.protectedFromIdentityPromotion;
  const defaultProtectedFromIdentityPromotion =
    normalizedDefaults.protectedFromIdentityPromotion;

  return freezeDeep({
    status: normalizeOldGenerationConsolidationStatus(
      normalizedInput.status,
      normalizeOldGenerationConsolidationStatus(normalizedDefaults.status, "preserved"),
    ),
    lastOperation:
      normalizeConsolidationOperation(normalizedInput.lastOperation) ??
      normalizeConsolidationOperation(normalizedDefaults.lastOperation),
    journalRecordId: normalizeNullableString(
      normalizedInput.journalRecordId ?? normalizedDefaults.journalRecordId,
    ),
    policyVersion: normalizeNullableString(
      normalizedInput.policyVersion ?? normalizedDefaults.policyVersion,
    ),
    sourceMemoryIds: normalizeStringArray(
      normalizedInput.sourceMemoryIds ?? normalizedDefaults.sourceMemoryIds,
    ),
    preservedIdentityFields: normalizeStringArray(
      normalizedInput.preservedIdentityFields ??
        normalizedDefaults.preservedIdentityFields,
    ),
    protectedFromIdentityPromotion:
      inputProtectedFromIdentityPromotion === undefined
        ? defaultProtectedFromIdentityPromotion ?? null
        : inputProtectedFromIdentityPromotion === null
          ? null
          : Boolean(inputProtectedFromIdentityPromotion),
  });
};

const assertImmutableIdentityConsolidationState = (identity) => {
  if (identity.consolidationState.status !== "runtime_seeded") {
    throw new Error(
      'Immutable identity consolidationState.status must remain "runtime_seeded".',
    );
  }

  if (identity.consolidationState.lastOperation !== null) {
    throw new Error("Immutable identity cannot record an old-generation consolidation operation.");
  }

  if (identity.consolidationState.journalRecordId !== null) {
    throw new Error("Immutable identity cannot point at a consolidation journal record.");
  }

  if (identity.consolidationState.sourceMemoryIds.length > 0) {
    throw new Error("Immutable identity cannot inherit sourceMemoryIds from learned memories.");
  }
};

const assertLearnedTraitMemoryShape = (memory) => {
  const hasLearnedTraitPayload = Boolean(memory.learnedTrait);

  if (memory.category === "learned_trait" && !hasLearnedTraitPayload) {
    throw new Error(
      `Old-generation learned_trait memory "${memory.memoryId}" must include learnedTrait metadata.`,
    );
  }

  if (memory.category !== "learned_trait" && hasLearnedTraitPayload) {
    throw new Error(
      `Old-generation memory "${memory.memoryId}" can only include learnedTrait metadata when category is "learned_trait".`,
    );
  }

  if (
    hasLearnedTraitPayload &&
    memory.consolidationState.protectedFromIdentityPromotion !== true
  ) {
    throw new Error(
      `Old-generation learned_trait memory "${memory.memoryId}" must keep protectedFromIdentityPromotion set to true.`,
    );
  }
};

const deriveArchivedMemoryOriginalProvenance = (originalGeneration, snapshot) => {
  if (originalGeneration === MEMORY_NODE_KINDS.youngGeneration) {
    return normalizeOptionalClonedObject(snapshot?.record?.provenance);
  }

  return normalizeOptionalClonedObject(snapshot?.provenance);
};

const assertArchivedMemorySnapshotPreservesOriginalMemoryId = (archivedMemory) => {
  const archivedMemoryLabel = `Archived memory "${archivedMemory.archiveId}"`;
  const snapshotMemoryIdLabel =
    archivedMemory.originalGeneration === MEMORY_NODE_KINDS.youngGeneration
      ? `${archivedMemoryLabel} snapshot.record.memoryId`
      : `${archivedMemoryLabel} snapshot.memoryId`;
  const snapshotMemoryId = normalizeMemoryItemStableId(
    archivedMemory.originalGeneration === MEMORY_NODE_KINDS.youngGeneration
      ? archivedMemory.snapshot?.record?.memoryId
      : archivedMemory.snapshot?.memoryId,
    snapshotMemoryIdLabel,
  );

  if (snapshotMemoryId !== archivedMemory.originalMemoryId) {
    throw new Error(
      `${snapshotMemoryIdLabel} "${snapshotMemoryId}" must preserve originalMemoryId "${archivedMemory.originalMemoryId}". Offline compaction output cannot swap a memory's stable identity.`,
    );
  }

  const recoverySourceMemoryId = archivedMemory.snapshot?.recoveryContext?.sourceMemoryId;

  if (recoverySourceMemoryId === undefined || recoverySourceMemoryId === null) {
    return;
  }

  const normalizedRecoverySourceMemoryId = normalizeMemoryItemStableId(
    recoverySourceMemoryId,
    `${archivedMemoryLabel} snapshot.recoveryContext.sourceMemoryId`,
  );

  if (normalizedRecoverySourceMemoryId !== archivedMemory.originalMemoryId) {
    throw new Error(
      `${archivedMemoryLabel} snapshot.recoveryContext.sourceMemoryId "${normalizedRecoverySourceMemoryId}" must preserve originalMemoryId "${archivedMemory.originalMemoryId}". Offline compaction output cannot swap a memory's stable identity.`,
    );
  }
};

const assertArchivedMemoryShape = (archivedMemory) => {
  assertArchivedMemorySourceGeneration(archivedMemory.originalGeneration);
  assertArchivedMemorySourceMemoryKind(archivedMemory.originalMemoryKind);
  assertArchivedMemorySnapshotPreservesOriginalMemoryId(archivedMemory);

  if (archivedMemory.originalGeneration === MEMORY_NODE_KINDS.youngGeneration) {
    if (
      archivedMemory.originalMemoryKind !== MEMORY_NODE_KINDS.workingMemory &&
      archivedMemory.originalMemoryKind !== MEMORY_NODE_KINDS.shortTermMemory
    ) {
      throw new Error(
        `Archived memory "${archivedMemory.archiveId}" must use a young-generation memory kind when originalGeneration is "${MEMORY_NODE_KINDS.youngGeneration}".`,
      );
    }

    if (archivedMemory.originalNodeId !== null) {
      throw new Error(
        `Archived memory "${archivedMemory.archiveId}" cannot carry originalNodeId for young-generation source memories.`,
      );
    }

    return;
  }

  if (archivedMemory.originalMemoryKind !== MEMORY_NODE_KINDS.longTermMemory) {
    throw new Error(
      `Archived memory "${archivedMemory.archiveId}" must use "${MEMORY_NODE_KINDS.longTermMemory}" when originalGeneration is "${MEMORY_NODE_KINDS.oldGeneration}".`,
    );
  }

  if (archivedMemory.originalNodeId === null) {
    throw new Error(
      `Archived memory "${archivedMemory.archiveId}" must preserve originalNodeId for old-generation source memories.`,
    );
  }

  assertOldGenerationNodeId({
    nodeId: archivedMemory.originalNodeId,
    agentId: archivedMemory.agentId,
    nodeKind: MEMORY_NODE_KINDS.longTermMemory,
    localId: archivedMemory.originalMemoryId,
    entityLabel: `Archived memory "${archivedMemory.archiveId}" source`,
  });
};

export const createOldGenerationEdge = (input) => {
  const edge = freezeDeep({
    edgeId:
      input.edgeId ??
      createOldGenerationEdgeId({
        agentId: input.agentId,
        relation: input.relation,
        from: input.from,
        to: input.to,
      }),
    agentId: input.agentId,
    from: input.from,
    to: input.to,
    relation: input.relation,
    provenance: cloneObject(input.provenance),
    temporalContext: createOldGenerationTemporalContext(input.temporalContext),
    salience: createOldGenerationSalience(input.salience),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status:
          input.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation
            ? "superseded"
            : "preserved",
      },
    ),
  });

  const { sourceNodeId, targetNodeId } = assertOldGenerationEdgeShape(edge);

  if (edge.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation) {
    if (edge.from === edge.to) {
      throw new Error("Old-generation supersedes edges cannot point to the same memory node.");
    }

    if (edge.consolidationState.status !== "superseded") {
      throw new Error('Old-generation supersedes edges must use consolidationState.status "superseded".');
    }
  }

  if (
    edge.relation === OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation &&
    edge.consolidationState.journalRecordId !== null &&
    targetNodeId.localId !== edge.consolidationState.journalRecordId
  ) {
    throw new Error(
      `Old-generation createdByConsolidation edge "${edge.edgeId}" must target consolidation record "${edge.consolidationState.journalRecordId}".`,
    );
  }

  if (sourceNodeId.nodeKind === MEMORY_NODE_KINDS.immutableIdentity) {
    throw new Error("Immutable identity cannot be the source of an old-generation edge.");
  }

  if (targetNodeId.nodeKind === MEMORY_NODE_KINDS.immutableIdentity) {
    throw new Error("Immutable identity cannot be the target of an old-generation edge.");
  }

  return edge;
};

const createGraphEdge = (input, agentId) => {
  if (OLD_GENERATION_RELATIONS.has(input.relation)) {
    return createOldGenerationEdge({
      ...input,
      agentId: input.agentId ?? agentId,
    });
  }

  return freezeDeep({
    from: input.from,
    to: input.to,
    relation: input.relation,
  });
};

export const createImmutableIdentity = (input) => {
  const identity = freezeDeep({
    nodeId:
      input.nodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.immutableIdentity,
        input.agentId,
        OLD_GENERATION_IDENTIFIER_SCHEMA.identityLocalId,
      ),
    agentId: input.agentId,
    persona: input.persona,
    role: input.role,
    durableMission: input.durableMission,
    safetyConstraints: cloneArray(input.safetyConstraints),
    ownership: cloneArray(input.ownership),
    nonNegotiablePreferences: cloneArray(input.nonNegotiablePreferences),
    runtimeInvariants: cloneObjectDeep(input.runtimeInvariants),
    protectedCoreFacts: cloneArray(input.protectedCoreFacts),
    provenance:
      "provenance" in input
        ? cloneObjectDeep(input.provenance)
        : {
            source: "runtime_authority",
            observedAt: null,
            evidence: [],
            actor: null,
          },
    temporalContext: createOldGenerationTemporalContext(input.temporalContext),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status: "runtime_seeded",
        preservedIdentityFields: PROTECTED_IDENTITY_FIELDS,
      },
    ),
  });
  assertOldGenerationNodeId({
    nodeId: identity.nodeId,
    agentId: identity.agentId,
    nodeKind: MEMORY_NODE_KINDS.immutableIdentity,
    localId: OLD_GENERATION_IDENTIFIER_SCHEMA.identityLocalId,
    entityLabel: "Immutable identity",
  });
  assertImmutableIdentityConsolidationState(identity);
  return identity;
};

export const createLongTermMemory = (input) => {
  const memoryId = normalizeMemoryItemStableId(
    input.memoryId,
    "Long-term memory memoryId",
  );
  assertLongTermMemoryCategory(input.category);
  if (
    input.category === "learned_trait" &&
    input.consolidationState?.protectedFromIdentityPromotion === false
  ) {
    throw new Error(
      `Old-generation learned_trait memory "${input.memoryId}" cannot disable protectedFromIdentityPromotion.`,
    );
  }

  const learnedTrait = input.learnedTrait
    ? {
        label: input.learnedTrait.label,
        confidence: input.learnedTrait.confidence,
        provenance: cloneObject(input.learnedTrait.provenance),
        protectedFromIdentityPromotion: true,
      }
    : null;
  const nodeId =
    input.nodeId ??
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      input.agentId,
      memoryId,
    );
  const memory = freezeDeep({
    nodeId,
    agentId: input.agentId,
    memoryId,
    category: input.category,
    content: input.content,
    summary: input.summary ?? input.content,
    confidence: input.confidence,
    provenance: cloneObject(input.provenance),
    stabilizedAt: input.stabilizedAt,
    temporalContext: createOldGenerationTemporalContext(input.temporalContext, {
      firstObservedAt: input.provenance?.observedAt ?? null,
      lastObservedAt: input.provenance?.observedAt ?? null,
      stabilizedAt: input.stabilizedAt,
      consolidatedAt: input.stabilizedAt,
    }),
    salience: createOldGenerationSalience(input.salience, input.confidence),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status: "promoted",
        lastOperation: "promote",
        protectedFromIdentityPromotion: learnedTrait ? true : null,
      },
    ),
    learnedTrait,
  });
  assertOldGenerationNodeId({
    nodeId: memory.nodeId,
    agentId: memory.agentId,
    nodeKind: MEMORY_NODE_KINDS.longTermMemory,
    localId: memory.memoryId,
    entityLabel: `Old-generation long-term memory "${memory.memoryId}"`,
  });
  assertLearnedTraitMemoryShape(memory);
  return memory;
};

const LONG_TERM_MEMORY_PROMOTION_SOURCE_CONTENT_FIELDS = freezeDeep([
  "content",
  "summary",
  "detail",
]);

const LONG_TERM_MEMORY_PROMOTION_DEFAULT_CATEGORY_BY_MEMORY_KIND = freezeDeep({
  [MEMORY_NODE_KINDS.workingMemory]: "semantic",
  [MEMORY_NODE_KINDS.shortTermMemory]: "episodic",
});

const CONSOLIDATION_PROMOTION_SERIALIZABLE_SOURCE_COLLECTIONS = freezeDeep([
  "workingMemory",
  "shortTermMemory",
]);

const isLongTermMemoryPromotionSerializationInput = (value) =>
  isPlainObject(value) && "selection" in value && "memory" in value;

const isLongTermMemoryPromotionRewriteInput = (value) =>
  isPlainObject(value) &&
  "selection" in value &&
  "memory" in value &&
  "rewrittenEntry" in value;

const PROMOTION_SERIALIZATION_REPLACEMENT_RECORD_FIELDS = freezeDeep([
  "nodeId",
  "stabilizedAt",
  "temporalContext",
  "salience",
  "consolidationState",
  "learnedTrait",
]);

const assertPromotionSerializationSourceRecordIsNotReplacementRecord = (
  sourceRecord,
  label,
) => {
  const replacementFields =
    isPlainObject(sourceRecord)
      ? PROMOTION_SERIALIZATION_REPLACEMENT_RECORD_FIELDS.filter(
          (fieldName) =>
            Object.hasOwn(sourceRecord, fieldName) &&
            sourceRecord[fieldName] !== undefined &&
            sourceRecord[fieldName] !== null,
        )
      : [];

  if (replacementFields.length === 0) {
    return;
  }

  throw new Error(
    `${label}.memory must describe the source young-generation memory and cannot include durable replacement fields: ${replacementFields.join(", ")}. Update generation state through input.consolidationState instead of passing a replacement long-term memory record.`,
  );
};

const getPromotionSerializationSourceRecord = (memory, label) => {
  if (isYoungGenerationMemoryEnvelope(memory)) {
    const rehydratedSourceRecord = rehydrateYoungGenerationInspectionRecord(memory);
    let sourceRecord = null;

    try {
      sourceRecord = cloneObjectDeep(rehydratedSourceRecord);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HippocampusBoundarySanitizationError(
        `${label}.memory could not be prepared for hippocampus boundary sanitization: ${reason}`,
        error,
      );
    }

    assertPromotionSerializationSourceRecordIsNotReplacementRecord(
      sourceRecord,
      label,
    );
    return sourceRecord;
  }

  if (isPlainObject(memory)) {
    let sourceRecord = null;

    try {
      sourceRecord = cloneObjectDeep(memory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HippocampusBoundarySanitizationError(
        `${label}.memory could not be prepared for hippocampus boundary sanitization: ${reason}`,
        error,
      );
    }

    assertPromotionSerializationSourceRecordIsNotReplacementRecord(
      sourceRecord,
      label,
    );
    return sourceRecord;
  }

  throw new TypeError(
    `${label}.memory must be a memory record or young-generation memory envelope`,
  );
};

const sanitizeHippocampusBoundaryPayloadResult = (
  payload,
  direction,
  label = "Hippocampus boundary payload",
) => {
  try {
    return sanitizeHippocampusBoundaryPayload(payload, {
      direction,
      policy: DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY,
    });
  } catch (error) {
    if (isHippocampusBoundaryFailureError(error)) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new HippocampusBoundarySanitizationError(
      `${label} could not be sanitized at the hippocampus boundary: ${reason}`,
      error,
    );
  }
};

const sanitizeHippocampusBoundaryPayloadValue = (payload, direction, label) =>
  sanitizeHippocampusBoundaryPayloadResult(
    payload,
    direction,
    label,
  ).sanitizedPayload;

const getSanitizedPromotionSerializationSourceRecord = (memory, label) =>
  sanitizeHippocampusBoundaryPayloadValue(
    getPromotionSerializationSourceRecord(memory, label),
    "input",
    `${label}.memory`,
  );

const sanitizeSerializedLongTermMemoryEntryResult = (
  entry,
  label = "Long-term memory serialized entry",
) => sanitizeHippocampusBoundaryPayloadResult(entry, "output", label);

const assertNoUnredactableSerializedLongTermMemorySecrets = (
  sanitizationResult,
  label,
) => {
  if (!sanitizationResult.hasUnredactableSecrets) {
    return;
  }

  throw new HippocampusBoundaryRejectionError(
    `${label} contains unredactable secrets in immutable boundary fields (${sanitizationResult.unredactablePaths.join(", ")}). ` +
      "The hippocampus boundary sanitizer cannot redact canonical identity fields, so the durable long-term write was aborted.",
    sanitizationResult,
  );
};

const sanitizeSerializedLongTermMemoryEntry = (
  entry,
  label = "Long-term memory serialized entry",
) => {
  const sanitizationResult = sanitizeSerializedLongTermMemoryEntryResult(
    entry,
    label,
  );
  assertNoUnredactableSerializedLongTermMemorySecrets(
    sanitizationResult,
    label,
  );

  return sanitizationResult.sanitizedPayload;
};

const getPromotionSerializationContentField = (record, fieldName) =>
  typeof record?.[fieldName] === "string" && record[fieldName].trim().length > 0
    ? record[fieldName]
    : null;

const assertConsolidationTargetMemoryIdPreservesSourceMemoryId = (
  sourceMemoryId,
  targetMemoryId,
  labelPrefix,
  {
    stage = "planning",
    agentId = null,
    attemptedField = "targetMemoryId",
  } = {},
) => {
  const normalizedSourceMemoryId = normalizeMemoryItemStableId(
    sourceMemoryId,
    `${labelPrefix}.sourceMemoryId`,
  );
  const normalizedTargetMemoryId =
    targetMemoryId === null || targetMemoryId === undefined
      ? null
      : normalizeMemoryItemStableId(
          targetMemoryId,
          `${labelPrefix}.targetMemoryId`,
        );

  if (
    normalizedTargetMemoryId !== null &&
    normalizedTargetMemoryId !== normalizedSourceMemoryId
  ) {
    throwConsolidationPipelineAbort({
      stage,
      canonicalField: "memoryId",
      attemptedField,
      sourceMemoryId: normalizedSourceMemoryId,
      agentId,
      expectedValue: normalizedSourceMemoryId,
      actualValue: normalizedTargetMemoryId,
      message: `${labelPrefix} cannot rewrite source memoryId "${normalizedSourceMemoryId}" to ${attemptedField} "${normalizedTargetMemoryId}". Consolidation output must preserve the original stable memoryId.`,
    });
  }

  return normalizedTargetMemoryId;
};

const assertConsolidationOutputMemoryIdPreservesSourceMemoryId = (
  sourceMemoryId,
  outputMemoryId,
  labelPrefix,
  {
    stage = "serialization",
    agentId = null,
    attemptedField = "output memoryId",
  } = {},
) => {
  const normalizedSourceMemoryId = normalizeMemoryItemStableId(
    sourceMemoryId,
    `${labelPrefix}.sourceMemoryId`,
  );
  const normalizedOutputMemoryId = normalizeMemoryItemStableId(
    outputMemoryId,
    `${labelPrefix}.memoryId`,
  );

  if (normalizedOutputMemoryId !== normalizedSourceMemoryId) {
    throwConsolidationPipelineAbort({
      stage,
      canonicalField: "memoryId",
      attemptedField,
      sourceMemoryId: normalizedSourceMemoryId,
      agentId,
      expectedValue: normalizedSourceMemoryId,
      actualValue: normalizedOutputMemoryId,
      message: `${labelPrefix} cannot rewrite source memoryId "${normalizedSourceMemoryId}" to ${attemptedField} "${normalizedOutputMemoryId}". Consolidation output must preserve the original stable memoryId.`,
    });
  }

  return normalizedOutputMemoryId;
};

const assertConsolidationOutputNodeIdPreservesCanonicalIdentity = (
  { agentId, sourceMemoryId, outputMemoryId },
  outputNodeId,
  labelPrefix,
  {
    stage = "planning",
    attemptedField = "outputNodeId",
  } = {},
) => {
  const normalizedAgentId = normalizeRequiredString(
    agentId,
    `${labelPrefix}.agentId`,
  );
  const normalizedSourceMemoryId = normalizeMemoryItemStableId(
    sourceMemoryId,
    `${labelPrefix}.sourceMemoryId`,
  );
  const normalizedOutputMemoryId = normalizeMemoryItemStableId(
    outputMemoryId,
    `${labelPrefix}.outputMemoryId`,
  );
  const normalizedOutputNodeId = normalizeRequiredString(
    outputNodeId,
    `${labelPrefix}.outputNodeId`,
  );
  const expectedOutputNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    normalizedAgentId,
    normalizedOutputMemoryId,
  );

  if (normalizedOutputNodeId !== expectedOutputNodeId) {
    throwConsolidationPipelineAbort({
      stage,
      canonicalField: "nodeId",
      attemptedField,
      sourceMemoryId: normalizedSourceMemoryId,
      agentId: normalizedAgentId,
      expectedValue: expectedOutputNodeId,
      actualValue: normalizedOutputNodeId,
      message: `${labelPrefix} must preserve canonical outputNodeId "${expectedOutputNodeId}" instead of "${normalizedOutputNodeId}". Consolidation output must preserve the original agent-scoped durable node identity.`,
    });
  }

  return normalizedOutputNodeId;
};

const createConsolidationPromotionOutputIdentity = (
  { agentId, sourceMemoryId },
  labelPrefix,
  { outputMemoryId = sourceMemoryId, outputNodeId } = {},
  { stage = "planning" } = {},
) => {
  const normalizedAgentId = normalizeRequiredString(
    agentId,
    `${labelPrefix}.agentId`,
  );
  const normalizedOutputMemoryId =
    assertConsolidationOutputMemoryIdPreservesSourceMemoryId(
      sourceMemoryId,
      outputMemoryId,
      labelPrefix,
      {
        stage,
        agentId: normalizedAgentId,
        attemptedField: "output memoryId",
      },
    );
  const normalizedOutputNodeId = normalizeRequiredString(
    outputNodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        normalizedAgentId,
        normalizedOutputMemoryId,
      ),
    `${labelPrefix}.outputNodeId`,
  );
  assertConsolidationOutputNodeIdPreservesCanonicalIdentity(
    {
      agentId: normalizedAgentId,
      sourceMemoryId,
      outputMemoryId: normalizedOutputMemoryId,
    },
    normalizedOutputNodeId,
    labelPrefix,
    {
      stage,
      attemptedField: "outputNodeId",
    },
  );

  return freezeDeep({
    outputMemoryId: normalizedOutputMemoryId,
    outputNodeId: normalizedOutputNodeId,
  });
};

const assertConsolidationDeduplicationPreservesCanonicalIdentity = (
  {
    agentId,
    sourceMemoryId,
    deduplicatedMemoryId = null,
    deduplicatedNodeId = null,
  },
  labelPrefix,
  {
    attemptedMemoryField = "deduplicatedMemoryId",
    attemptedNodeField = "deduplicatedNodeId",
  } = {},
) => {
  const outputIdentity = createConsolidationPromotionOutputIdentity(
    { agentId, sourceMemoryId },
    labelPrefix,
    {},
    {
      stage: "deduplication",
    },
  );
  const normalizedDeduplicatedMemoryId =
    deduplicatedMemoryId === null || deduplicatedMemoryId === undefined
      ? null
      : normalizeMemoryItemStableId(
          deduplicatedMemoryId,
          `${labelPrefix}.deduplicatedMemoryId`,
        );
  const normalizedDeduplicatedNodeId =
    deduplicatedNodeId === null || deduplicatedNodeId === undefined
      ? null
      : normalizeRequiredString(
          deduplicatedNodeId,
          `${labelPrefix}.deduplicatedNodeId`,
        );

  if (
    normalizedDeduplicatedMemoryId !== null &&
    normalizedDeduplicatedMemoryId !== outputIdentity.outputMemoryId
  ) {
    throwConsolidationPipelineAbort({
      stage: "deduplication",
      canonicalField: "memoryId",
      attemptedField: attemptedMemoryField,
      sourceMemoryId,
      agentId,
      expectedValue: outputIdentity.outputMemoryId,
      actualValue: normalizedDeduplicatedMemoryId,
      message:
        `${labelPrefix} cannot remap canonical memoryId ` +
        `"${outputIdentity.outputMemoryId}" to deduplication winner ` +
        `"${normalizedDeduplicatedMemoryId}". Offline winner/loser remaps ` +
        "must preserve the original stable memoryId.",
    });
  }

  if (
    normalizedDeduplicatedNodeId !== null &&
    normalizedDeduplicatedNodeId !== outputIdentity.outputNodeId
  ) {
    throwConsolidationPipelineAbort({
      stage: "deduplication",
      canonicalField: "nodeId",
      attemptedField: attemptedNodeField,
      sourceMemoryId,
      agentId,
      expectedValue: outputIdentity.outputNodeId,
      actualValue: normalizedDeduplicatedNodeId,
      message:
        `${labelPrefix} cannot collapse the canonical nodeId ` +
        `"${outputIdentity.outputNodeId}" into deduplication target ` +
        `"${normalizedDeduplicatedNodeId}". Offline record collapse must ` +
        "preserve the agent-scoped canonical durable node identity.",
    });
  }

  return outputIdentity;
};

const createPromotionSerializationProvenance = ({
  inputProvenance,
  sourceRecord,
  selection,
}) => {
  const recordProvenance = isPlainObject(sourceRecord?.provenance)
    ? cloneObjectDeep(sourceRecord.provenance)
    : {};
  const overrideProvenance = isPlainObject(inputProvenance)
    ? cloneObjectDeep(inputProvenance)
    : {};
  const observedAt = normalizeDateLikeToIsoString(
    overrideProvenance.observedAt ??
      recordProvenance.observedAt ??
      sourceRecord?.observedAt ??
      sourceRecord?.createdAt ??
      sourceRecord?.updatedAt ??
      sourceRecord?.lastUpdatedAt ??
      selection.evaluation.evaluatedAt,
    "Long-term memory promotion serialization input.provenance.observedAt",
  );

  return freezeDeep({
    ...recordProvenance,
    ...overrideProvenance,
    source:
      normalizeOptionalString(
        overrideProvenance.source ?? recordProvenance.source,
        "Long-term memory promotion serialization input.provenance.source",
      ) ?? "offline-consolidation",
    observedAt,
    evidence: createUniqueStringList(
      [
        ...normalizeStringArray(overrideProvenance.evidence),
        ...normalizeStringArray(recordProvenance.evidence),
        ...normalizeStringArray(
          selection.candidate.signals.youngGeneration.importance?.sourceRecordIds,
        ),
        ...normalizeStringArray(
          selection.candidate.signals.youngGeneration.stability?.sourceRecordIds,
        ),
        ...normalizeStringArray(
          selection.candidate.signals.oldGeneration.importance?.sourceRecordIds,
        ),
        ...normalizeStringArray(
          selection.candidate.signals.oldGeneration.stability?.sourceRecordIds,
        ),
        selection.candidate.sourceMemoryId,
      ].filter((value) => typeof value === "string" && value.length > 0),
    ),
    actor:
      normalizeOptionalString(
        overrideProvenance.actor ?? recordProvenance.actor,
        "Long-term memory promotion serialization input.provenance.actor",
      ) ?? "offline-consolidation",
  });
};

const createPromotionSerializationLearnedTrait = ({
  inputLearnedTrait,
  sourceRecord,
  category,
  confidence,
  provenance,
  summary,
}) => {
  if (category !== "learned_trait") {
    return null;
  }

  const learnedTraitInput =
    isPlainObject(inputLearnedTrait) ? inputLearnedTrait : isPlainObject(sourceRecord?.learnedTrait)
      ? sourceRecord.learnedTrait
      : {};

  if (
    learnedTraitInput.provenance !== undefined &&
    !isPlainObject(learnedTraitInput.provenance)
  ) {
    throw new TypeError(
      "Long-term memory promotion serialization input.learnedTrait.provenance must be an object",
    );
  }

  return freezeDeep({
    label: normalizeRequiredString(
      learnedTraitInput.label ?? sourceRecord?.label ?? summary,
      "Long-term memory promotion serialization input.learnedTrait.label",
    ),
    confidence: normalizeUnitIntervalNumber(
      learnedTraitInput.confidence ?? confidence,
      "Long-term memory promotion serialization input.learnedTrait.confidence",
    ),
    provenance: freezeDeep(
      isPlainObject(learnedTraitInput.provenance)
        ? cloneObjectDeep(learnedTraitInput.provenance)
        : cloneObjectDeep(provenance),
    ),
  });
};

const normalizePromotionSerializationSelection = (selection) => {
  if (!isPlainObject(selection)) {
    throw new TypeError(
      "Long-term memory promotion serialization input.selection must be an object",
    );
  }

  const candidate = createConsolidationPromotionCandidate(selection.candidate);
  const evaluation = selection.evaluation;

  if (!isPlainObject(evaluation)) {
    throw new TypeError(
      "Long-term memory promotion serialization input.selection.evaluation must be an object",
    );
  }

  if (evaluation.eligible !== true || evaluation.decision !== "promote") {
    throw new Error(
      "Long-term memory promotion serialization input.selection must reference an eligible promotion selection.",
    );
  }

  if (evaluation.candidateId !== candidate.candidateId) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.evaluation.candidateId must match selection.candidate.candidateId.",
    );
  }

  if (evaluation.agentId !== candidate.agentId) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.evaluation.agentId must match selection.candidate.agentId.",
    );
  }

  if (evaluation.sourceMemoryId !== candidate.sourceMemoryId) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.evaluation.sourceMemoryId must match selection.candidate.sourceMemoryId.",
    );
  }

  if (evaluation.sourceMemoryKind !== candidate.sourceMemoryKind) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.evaluation.sourceMemoryKind must match selection.candidate.sourceMemoryKind.",
    );
  }

  if (evaluation.targetNodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
    throw new Error(
      `Long-term memory promotion serialization input.selection.evaluation.targetNodeKind must be "${MEMORY_NODE_KINDS.longTermMemory}".`,
    );
  }

  const sourceCollection = normalizeRequiredString(
    selection.sourceCollection,
    "Long-term memory promotion serialization input.selection.sourceCollection",
  );

  if (
    !CONSOLIDATION_PROMOTION_SERIALIZABLE_SOURCE_COLLECTIONS.includes(
      sourceCollection,
    )
  ) {
    throw new Error(
      `Long-term memory promotion serialization input.selection.sourceCollection must be one of ${CONSOLIDATION_PROMOTION_SERIALIZABLE_SOURCE_COLLECTIONS.join(", ")}.`,
    );
  }

  const targetMemoryId = normalizeOptionalString(
    selection.targetMemoryId,
    "Long-term memory promotion serialization input.selection.targetMemoryId",
  );
  const targetNodeId = normalizeOptionalString(
    selection.targetNodeId,
    "Long-term memory promotion serialization input.selection.targetNodeId",
  );

  if (targetMemoryId !== candidate.targetMemoryId) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.targetMemoryId must match selection.candidate.targetMemoryId.",
    );
  }

  assertConsolidationTargetMemoryIdPreservesSourceMemoryId(
    candidate.sourceMemoryId,
    targetMemoryId,
    "Long-term memory promotion serialization input.selection",
    {
      stage: "serialization",
      agentId: candidate.agentId,
      attemptedField: "targetMemoryId",
    },
  );

  const outputIdentity = createConsolidationPromotionOutputIdentity(
    candidate,
    "Long-term memory promotion serialization input.selection",
    {
      outputMemoryId:
        selection.outputMemoryId ?? targetMemoryId ?? candidate.sourceMemoryId,
      outputNodeId: selection.outputNodeId ?? targetNodeId ?? undefined,
    },
    {
      stage: "serialization",
    },
  );

  if (
    targetMemoryId !== null &&
    outputIdentity.outputMemoryId !== targetMemoryId
  ) {
    throw new Error(
      "Long-term memory promotion serialization input.selection.outputMemoryId must match selection.targetMemoryId when a durable target is present.",
    );
  }

  if (
    targetNodeId !== null &&
    outputIdentity.outputNodeId !== targetNodeId
  ) {
    throwConsolidationPipelineAbort({
      stage: "serialization",
      canonicalField: "nodeId",
      attemptedField: "targetNodeId",
      sourceMemoryId: candidate.sourceMemoryId,
      agentId: candidate.agentId,
      expectedValue: outputIdentity.outputNodeId,
      actualValue: targetNodeId,
      message:
        "Long-term memory promotion serialization input.selection.outputNodeId must match selection.targetNodeId when a durable target is present.",
    });
  }

  return freezeDeep({
    candidate,
    evaluation: cloneObjectDeep(evaluation),
    sourceCollection,
    targetMemoryId,
    targetNodeId,
    ...outputIdentity,
  });
};

export const serializePromotionSelectionToLongTermMemoryEntry = (input) => {
  if (!isLongTermMemoryPromotionSerializationInput(input)) {
    throw new TypeError(
      "Long-term memory promotion serialization input must include selection and memory.",
    );
  }

  const selection = normalizePromotionSerializationSelection(input.selection);
  const sourceRecord = getSanitizedPromotionSerializationSourceRecord(
    input.memory,
    "Long-term memory promotion serialization input",
  );

  if (
    sourceRecord.agentId !== undefined &&
    sourceRecord.agentId !== selection.candidate.agentId
  ) {
    throwConsolidationPipelineAbort({
      stage: "serialization",
      canonicalField: "agentId",
      attemptedField: "memory.agentId",
      sourceMemoryId: selection.candidate.sourceMemoryId,
      agentId: selection.candidate.agentId,
      expectedValue: selection.candidate.agentId,
      actualValue: String(sourceRecord.agentId),
      message:
        "Long-term memory promotion serialization input.memory.agentId must match selection.candidate.agentId when present.",
    });
  }

  if (
    sourceRecord.memoryId !== undefined &&
    sourceRecord.memoryId !== selection.candidate.sourceMemoryId
  ) {
    throwConsolidationPipelineAbort({
      stage: "serialization",
      canonicalField: "memoryId",
      attemptedField: "memory.memoryId",
      sourceMemoryId: selection.candidate.sourceMemoryId,
      agentId: selection.candidate.agentId,
      expectedValue: selection.candidate.sourceMemoryId,
      actualValue: String(sourceRecord.memoryId),
      message:
        "Long-term memory promotion serialization input.memory.memoryId must match selection.candidate.sourceMemoryId when present.",
    });
  }

  const content = normalizeRequiredString(
    input.content ??
      LONG_TERM_MEMORY_PROMOTION_SOURCE_CONTENT_FIELDS
        .map((fieldName) =>
          getPromotionSerializationContentField(sourceRecord, fieldName),
        )
        .find((value) => value !== null),
    "Long-term memory promotion serialization input.content",
  );
  const summary = normalizeOptionalString(
    input.summary ??
      getPromotionSerializationContentField(sourceRecord, "summary") ??
      content,
    "Long-term memory promotion serialization input.summary",
  );
  const category =
    input.category ??
    sourceRecord.category ??
    (selection.candidate.learnedTraitCandidate
      ? "learned_trait"
      : LONG_TERM_MEMORY_PROMOTION_DEFAULT_CATEGORY_BY_MEMORY_KIND[
          selection.candidate.sourceMemoryKind
        ]);
  const memoryId = normalizeMemoryItemStableId(
    input.memoryId ??
      selection.outputMemoryId ??
      selection.targetMemoryId ??
      sourceRecord.memoryId ??
      selection.candidate.sourceMemoryId,
    "Long-term memory promotion serialization input.memoryId",
  );
  assertConsolidationOutputMemoryIdPreservesSourceMemoryId(
    selection.candidate.sourceMemoryId,
    memoryId,
    "Long-term memory promotion serialization input",
    {
      stage: "serialization",
      agentId: selection.candidate.agentId,
      attemptedField: "output memoryId",
    },
  );
  const confidence = normalizeUnitIntervalNumber(
    input.confidence ?? sourceRecord.confidence ?? selection.evaluation.promotionScore,
    "Long-term memory promotion serialization input.confidence",
  );
  const stabilizedAt = normalizeDateLikeToIsoString(
    input.stabilizedAt ??
      sourceRecord.stabilizedAt ??
      sourceRecord.lastUpdatedAt ??
      sourceRecord.updatedAt ??
      selection.evaluation.evaluatedAt,
    "Long-term memory promotion serialization input.stabilizedAt",
  );
  const provenance = createPromotionSerializationProvenance({
    inputProvenance: input.provenance,
    sourceRecord,
    selection,
  });
  const learnedTrait = createPromotionSerializationLearnedTrait({
    inputLearnedTrait: input.learnedTrait,
    sourceRecord,
    category,
    confidence,
    provenance,
    summary: summary ?? content,
  });
  const sourceSalience = isPlainObject(sourceRecord.salience)
    ? sourceRecord.salience
    : null;
  const sourceTemporalContext = isPlainObject(sourceRecord.temporalContext)
    ? sourceRecord.temporalContext
    : null;
  const sourceConsolidationState = isPlainObject(sourceRecord.consolidationState)
    ? sourceRecord.consolidationState
    : null;
  const signalScores = Object.fromEntries(
    Object.entries(selection.evaluation.signalScores ?? {}).filter(
      ([signalName, signalValue]) =>
        typeof signalName === "string" &&
        signalName.length > 0 &&
        typeof signalValue === "number" &&
        Number.isFinite(signalValue),
    ),
  );
  const serializedEntry = serializeLongTermMemoryEntry({
    nodeId: input.nodeId ?? selection.outputNodeId,
    agentId: selection.candidate.agentId,
    memoryId,
    category,
    content,
    summary,
    confidence,
    provenance,
    stabilizedAt,
    temporalContext: {
      ...(sourceTemporalContext ?? {}),
      ...(isPlainObject(input.temporalContext) ? input.temporalContext : {}),
      firstObservedAt:
        input.temporalContext?.firstObservedAt ??
        sourceTemporalContext?.firstObservedAt ??
        provenance.observedAt,
      lastObservedAt:
        input.temporalContext?.lastObservedAt ??
        sourceTemporalContext?.lastObservedAt ??
        sourceRecord.lastUpdatedAt ??
        sourceRecord.updatedAt ??
        stabilizedAt,
      stabilizedAt:
        input.temporalContext?.stabilizedAt ??
        sourceTemporalContext?.stabilizedAt ??
        stabilizedAt,
      consolidatedAt:
        input.temporalContext?.consolidatedAt ??
        sourceTemporalContext?.consolidatedAt ??
        stabilizedAt,
      lastAccessedAt:
        input.temporalContext?.lastAccessedAt ??
        sourceTemporalContext?.lastAccessedAt ??
        null,
      supersededAt:
        input.temporalContext?.supersededAt ??
        sourceTemporalContext?.supersededAt ??
        null,
    },
    salience: {
      ...(sourceSalience ?? {}),
      ...(isPlainObject(input.salience) ? input.salience : {}),
      score:
        input.salience?.score ??
        sourceSalience?.score ??
        selection.evaluation.promotionScore,
      signals:
        input.salience?.signals ?? sourceSalience?.signals ?? signalScores,
      lastEvaluatedAt:
        input.salience?.lastEvaluatedAt ??
        sourceSalience?.lastEvaluatedAt ??
        selection.evaluation.evaluatedAt,
      sourceEntryId:
        input.salience?.sourceEntryId ??
        sourceSalience?.sourceEntryId ??
        selection.candidate.signals.youngGeneration.importance?.sourceRecordIds?.[0] ??
        null,
    },
    consolidationState: {
      ...(sourceConsolidationState ?? {}),
      ...(isPlainObject(input.consolidationState) ? input.consolidationState : {}),
      status:
        input.consolidationState?.status ??
        sourceConsolidationState?.status ??
        "promoted",
      lastOperation:
        input.consolidationState?.lastOperation ??
        sourceConsolidationState?.lastOperation ??
        "promote",
      journalRecordId:
        input.consolidationState?.journalRecordId ??
        sourceConsolidationState?.journalRecordId ??
        null,
      policyVersion:
        input.consolidationState?.policyVersion ??
        sourceConsolidationState?.policyVersion ??
        selection.evaluation.policyVersion,
      sourceMemoryIds:
        input.consolidationState?.sourceMemoryIds ??
        sourceConsolidationState?.sourceMemoryIds ??
        [selection.candidate.sourceMemoryId],
      preservedIdentityFields:
        input.consolidationState?.preservedIdentityFields ??
        sourceConsolidationState?.preservedIdentityFields ??
        selection.evaluation.protectedIdentityFields,
      protectedFromIdentityPromotion:
        input.consolidationState?.protectedFromIdentityPromotion ??
        sourceConsolidationState?.protectedFromIdentityPromotion ??
        (learnedTrait ? true : null),
    },
    learnedTrait,
  });

  const sanitizedSerializedEntry = sanitizeSerializedLongTermMemoryEntry(
    serializedEntry,
    "Long-term memory promotion serialization output",
  );

  if (sanitizedSerializedEntry.metadata.nodeId !== selection.outputNodeId) {
    throw new Error(
      "Long-term memory promotion serialization input selection.outputNodeId must match the serialized long-term memory nodeId.",
    );
  }

  return sanitizedSerializedEntry;
};

const assertConsolidationRewritePreservesStoredIdentityField = (
  expectedIdentity,
  rewrittenIdentity,
  canonicalField,
  attemptedField,
  labelPrefix,
) => {
  if (expectedIdentity[canonicalField] === rewrittenIdentity[canonicalField]) {
    return;
  }

  throwConsolidationPipelineAbort({
    stage: "rewrite",
    canonicalField,
    attemptedField,
    sourceMemoryId: expectedIdentity.memoryId,
    agentId: expectedIdentity.agentId,
    expectedValue: expectedIdentity[canonicalField],
    actualValue: rewrittenIdentity[canonicalField],
    message:
      `${labelPrefix} ${attemptedField} must preserve canonical ${canonicalField} ` +
      `"${expectedIdentity[canonicalField]}" and cannot be rewritten to "${rewrittenIdentity[canonicalField]}". ` +
      "Offline consolidation rewrites may revise durable content, but they must never mutate, swap, or reassign canonical identity.",
  });
};

const getConsolidationRewriteAttemptedIdentityField = (
  rewrittenEntry,
  canonicalField,
) => {
  if (!isPlainObject(rewrittenEntry)) {
    return null;
  }

  if (canonicalField === "agentId") {
    if (isPlainObject(rewrittenEntry.metadata) && "agentId" in rewrittenEntry.metadata) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.metadata.agentId",
        actualValue: String(rewrittenEntry.metadata.agentId),
      });
    }

    if ("agentId" in rewrittenEntry) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.agentId",
        actualValue: String(rewrittenEntry.agentId),
      });
    }
  }

  if (canonicalField === "memoryId") {
    if (isPlainObject(rewrittenEntry.content) && "memoryId" in rewrittenEntry.content) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.content.memoryId",
        actualValue: String(rewrittenEntry.content.memoryId),
      });
    }

    if ("memoryId" in rewrittenEntry) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.memoryId",
        actualValue: String(rewrittenEntry.memoryId),
      });
    }
  }

  if (canonicalField === "nodeId") {
    if (isPlainObject(rewrittenEntry.metadata) && "nodeId" in rewrittenEntry.metadata) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.metadata.nodeId",
        actualValue: String(rewrittenEntry.metadata.nodeId),
      });
    }

    if ("nodeId" in rewrittenEntry) {
      return freezeDeep({
        attemptedField: "rewrittenEntry.nodeId",
        actualValue: String(rewrittenEntry.nodeId),
      });
    }
  }

  return null;
};

const assertConsolidationRewriteInputPreservesCanonicalIdentity = (
  canonicalEntry,
  rewrittenEntry,
  labelPrefix,
) => {
  const expectedIdentity =
    createLongTermMemoryPersistenceStoredIdentity(canonicalEntry);

  ["agentId", "memoryId", "nodeId"].forEach((canonicalField) => {
    const attemptedField = getConsolidationRewriteAttemptedIdentityField(
      rewrittenEntry,
      canonicalField,
    );

    if (
      attemptedField === null ||
      expectedIdentity[canonicalField] === attemptedField.actualValue
    ) {
      return;
    }

    throwConsolidationPipelineAbort({
      stage: "rewrite",
      canonicalField,
      attemptedField: attemptedField.attemptedField,
      sourceMemoryId: expectedIdentity.memoryId,
      agentId: expectedIdentity.agentId,
      expectedValue: expectedIdentity[canonicalField],
      actualValue: attemptedField.actualValue,
      message:
        `${labelPrefix} ${attemptedField.attemptedField} must preserve canonical ${canonicalField} ` +
        `"${expectedIdentity[canonicalField]}" and cannot be rewritten to "${attemptedField.actualValue}". ` +
        "Offline consolidation rewrites may revise durable content, but they must never mutate, swap, or reassign canonical identity.",
    });
  });
};

const assertConsolidationRewritePreservesCanonicalIdentity = (
  canonicalEntry,
  rewrittenEntry,
  labelPrefix,
) => {
  const expectedIdentity =
    createLongTermMemoryPersistenceStoredIdentity(canonicalEntry);
  const rewrittenIdentity =
    createLongTermMemoryPersistenceStoredIdentity(rewrittenEntry);

  assertConsolidationRewritePreservesStoredIdentityField(
    expectedIdentity,
    rewrittenIdentity,
    "agentId",
    "rewrittenEntry.metadata.agentId",
    labelPrefix,
  );
  assertConsolidationRewritePreservesStoredIdentityField(
    expectedIdentity,
    rewrittenIdentity,
    "memoryId",
    "rewrittenEntry.content.memoryId",
    labelPrefix,
  );
  assertConsolidationRewritePreservesStoredIdentityField(
    expectedIdentity,
    rewrittenIdentity,
    "nodeId",
    "rewrittenEntry.metadata.nodeId",
    labelPrefix,
  );
};

export const rewritePromotionSelectionToLongTermMemoryEntry = (input) => {
  if (!isLongTermMemoryPromotionRewriteInput(input)) {
    throw new TypeError(
      "Long-term memory promotion rewrite input must include selection, memory, and rewrittenEntry.",
    );
  }

  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: input.selection,
    memory: input.memory,
  });
  assertConsolidationRewriteInputPreservesCanonicalIdentity(
    canonicalEntry,
    input.rewrittenEntry,
    "Long-term memory promotion rewrite input",
  );
  const rewrittenEntry = normalizeLongTermMemoryPersistenceEntry(
    input.rewrittenEntry,
    "Long-term memory promotion rewrite input.rewrittenEntry",
  );

  assertConsolidationRewritePreservesCanonicalIdentity(
    canonicalEntry,
    rewrittenEntry,
    "Long-term memory promotion rewrite input",
  );

  return sanitizeSerializedLongTermMemoryEntry(rewrittenEntry);
};

const validateSerializedLongTermMemoryContent = (content, label) => {
  const serializedContent = assertOldGenerationSnapshotObject(content, label);
  assertOldGenerationSnapshotAllowedKeys(
    serializedContent,
    LONG_TERM_MEMORY_PERSISTENCE_CONTENT_FIELD_KEYS,
    label,
  );

  return freezeDeep({
    memoryId: assertOldGenerationSnapshotString(
      serializedContent.memoryId,
      `${label}.memoryId`,
    ),
    category: assertOldGenerationSnapshotString(
      serializedContent.category,
      `${label}.category`,
    ),
    content: assertOldGenerationSnapshotString(
      serializedContent.content,
      `${label}.content`,
    ),
    summary: assertOldGenerationSnapshotString(
      serializedContent.summary,
      `${label}.summary`,
    ),
  });
};

const validateSerializedLongTermMemoryMetadata = (metadata, label) => {
  const serializedMetadata = assertOldGenerationSnapshotObject(metadata, label);
  assertOldGenerationSnapshotAllowedKeys(
    serializedMetadata,
    LONG_TERM_MEMORY_PERSISTENCE_METADATA_FIELD_KEYS,
    label,
  );

  return freezeDeep({
    nodeId: assertOldGenerationSnapshotString(
      serializedMetadata.nodeId,
      `${label}.nodeId`,
    ),
    agentId: assertOldGenerationSnapshotString(
      serializedMetadata.agentId,
      `${label}.agentId`,
    ),
    confidence: normalizeUnitIntervalNumber(
      serializedMetadata.confidence,
      `${label}.confidence`,
    ),
    provenance: assertOldGenerationSnapshotObject(
      serializedMetadata.provenance,
      `${label}.provenance`,
    ),
    stabilizedAt: assertOldGenerationSnapshotString(
      serializedMetadata.stabilizedAt,
      `${label}.stabilizedAt`,
    ),
    temporalContext: assertOldGenerationSnapshotObject(
      serializedMetadata.temporalContext,
      `${label}.temporalContext`,
    ),
    salience: assertOldGenerationSnapshotObject(
      serializedMetadata.salience,
      `${label}.salience`,
    ),
    consolidationState: assertOldGenerationSnapshotObject(
      serializedMetadata.consolidationState,
      `${label}.consolidationState`,
    ),
    learnedTrait:
      serializedMetadata.learnedTrait === undefined || serializedMetadata.learnedTrait === null
        ? null
        : assertOldGenerationSnapshotObject(
            serializedMetadata.learnedTrait,
            `${label}.learnedTrait`,
          ),
  });
};

export const serializeLongTermMemoryEntry = (input) => {
  if (isLongTermMemoryPromotionRewriteInput(input)) {
    return rewritePromotionSelectionToLongTermMemoryEntry(input);
  }

  if (isLongTermMemoryPromotionSerializationInput(input)) {
    return serializePromotionSelectionToLongTermMemoryEntry(input);
  }

  const memory = createLongTermMemory(input);

  return sanitizeSerializedLongTermMemoryEntry(
    freezeDeep({
      schemaId: LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId,
      schemaVersion: LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version,
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      content: freezeDeep({
        memoryId: memory.memoryId,
        category: memory.category,
        content: memory.content,
        summary: memory.summary,
      }),
      metadata: freezeDeep({
        nodeId: memory.nodeId,
        agentId: memory.agentId,
        confidence: memory.confidence,
        provenance: cloneObjectDeep(memory.provenance),
        stabilizedAt: memory.stabilizedAt,
        temporalContext: cloneObjectDeep(memory.temporalContext),
        salience: cloneObjectDeep(memory.salience),
        consolidationState: cloneObjectDeep(memory.consolidationState),
        learnedTrait: memory.learnedTrait ? cloneObjectDeep(memory.learnedTrait) : null,
      }),
    }),
  );
};

const isSerializedLongTermMemoryPersistenceEntry = (value) =>
  isPlainObject(value) &&
  value.schemaId === LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId &&
  value.nodeKind === MEMORY_NODE_KINDS.longTermMemory &&
  "content" in value &&
  "metadata" in value;

const deserializeLongTermMemoryEntryFromSerializedEntry = (
  entry,
  label = "Long-term memory persistence entry",
) => {
  const serializedEntry = assertOldGenerationSnapshotObject(entry, label);
  assertOldGenerationSnapshotAllowedKeys(
    serializedEntry,
    LONG_TERM_MEMORY_PERSISTENCE_FIELD_KEYS,
    label,
  );
  const schemaId = assertOldGenerationSnapshotString(
    serializedEntry.schemaId,
    `${label}.schemaId`,
  );
  const schemaVersion = assertOldGenerationSnapshotString(
    serializedEntry.schemaVersion,
    `${label}.schemaVersion`,
  );
  const nodeKind = assertOldGenerationSnapshotString(
    serializedEntry.nodeKind,
    `${label}.nodeKind`,
  );

  if (schemaId !== LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId) {
    throw new Error(
      `Long-term memory persistence entry.schemaId must be "${LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId}".`,
    );
  }

  if (schemaVersion !== LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version) {
    throw new Error(
      `Long-term memory persistence entry.schemaVersion must be "${LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version}".`,
    );
  }

  if (nodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
    throw new Error(
      `Long-term memory persistence entry.nodeKind must be "${MEMORY_NODE_KINDS.longTermMemory}".`,
    );
  }

  const content = validateSerializedLongTermMemoryContent(
    serializedEntry.content,
    `${label}.content`,
  );
  const metadata = validateSerializedLongTermMemoryMetadata(
    serializedEntry.metadata,
    `${label}.metadata`,
  );

  const restoredMemory = createLongTermMemory({
    nodeId: metadata.nodeId,
    agentId: metadata.agentId,
    memoryId: content.memoryId,
    category: content.category,
    content: content.content,
    summary: content.summary,
    confidence: metadata.confidence,
    provenance: metadata.provenance,
    stabilizedAt: metadata.stabilizedAt,
    temporalContext: metadata.temporalContext,
    salience: metadata.salience,
    consolidationState: metadata.consolidationState,
    learnedTrait: metadata.learnedTrait,
  });

  const canonicalEntry = serializeLongTermMemoryEntry(restoredMemory);

  if (!areOldGenerationSnapshotValuesEqual(canonicalEntry.content, content)) {
    throw new Error(
      "Long-term memory persistence entry.content must match the canonical serialized long-term memory content.",
    );
  }

  if (!areOldGenerationSnapshotValuesEqual(canonicalEntry.metadata, metadata)) {
    throw new Error(
      "Long-term memory persistence entry.metadata must match the canonical serialized long-term memory metadata.",
    );
  }

  return restoredMemory;
};

const normalizeLongTermMemoryPersistenceStoredEntrySource = (input, label) => {
  if (isSerializedLongTermMemoryPersistenceEntry(input)) {
    return input;
  }

  if (!isPlainObject(input)) {
    return normalizeStoredLongTermMemoryPersistenceEntry(input, label);
  }

  if ("entry" in input) {
    const normalizedEntry = normalizeLongTermMemoryPersistenceEntry(
      input.entry,
      `${label}.entry`,
    );

    if (!("value" in input)) {
      return normalizedEntry;
    }

    const normalizedValueEntry = normalizeStoredLongTermMemoryPersistenceEntry(
      input.value,
      typeof input.key === "string" && input.key.length > 0 ? input.key : label,
    );

    if (normalizedValueEntry === null) {
      return normalizedEntry;
    }

    if (!areOldGenerationSnapshotValuesEqual(normalizedValueEntry, normalizedEntry)) {
      throw new Error(
        `${label}.entry must match the serialized durable value returned by storage.`,
      );
    }

    return normalizedEntry;
  }

  if ("value" in input) {
    return normalizeStoredLongTermMemoryPersistenceEntry(
      input.value,
      typeof input.key === "string" && input.key.length > 0 ? input.key : label,
    );
  }

  return null;
};

export const deserializeLongTermMemoryEntry = (entry) => {
  const normalizedEntry = normalizeLongTermMemoryPersistenceStoredEntrySource(
    entry,
    "Long-term memory persistence entry",
  );

  if (normalizedEntry === null) {
    throw new Error(
      "Long-term memory persistence entry must be a serialized durable entry, storage record, or storage value.",
    );
  }

  return deserializeLongTermMemoryEntryFromSerializedEntry(normalizedEntry);
};

const normalizeLongTermMemoryPersistenceEntry = (input, label) => {
  if (isSerializedLongTermMemoryPersistenceEntry(input)) {
    return serializeLongTermMemoryEntry(
      deserializeLongTermMemoryEntryFromSerializedEntry(input, label),
    );
  }

  try {
    return serializeLongTermMemoryEntry(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not be normalized into a serialized long-term memory entry: ${reason}`);
  }
};

const isLongTermMemoryLogicalIdentityInput = (value) =>
  isPlainObject(value) &&
  typeof value.agentId === "string" &&
  typeof value.memoryId === "string" &&
  typeof value.category === "string" &&
  typeof value.content === "string";

const normalizeLongTermMemoryLogicalIdentityLineageMemoryIds = (
  value,
  memoryId,
) => {
  const normalizedLineageMemoryIds = createSortedUniqueStringList(
    normalizeStringArray(value),
  );

  if (normalizedLineageMemoryIds.length > 0) {
    return normalizedLineageMemoryIds;
  }

  return createSortedUniqueStringList([memoryId]);
};

const createLongTermMemoryLogicalIdentityDescriptor = (input, label) => {
  if (!isLongTermMemoryLogicalIdentityInput(input)) {
    throw new TypeError(
      `${label} must include agentId, memoryId, category, and content.`,
    );
  }

  const memoryId = normalizeMemoryItemStableId(input.memoryId, `${label}.memoryId`);
  const agentId = normalizeRequiredString(input.agentId, `${label}.agentId`);
  const category = normalizeRequiredString(input.category, `${label}.category`);
  assertLongTermMemoryCategory(category);

  const content = normalizeRequiredString(input.content, `${label}.content`);
  const summary = normalizeRequiredString(
    input.summary ?? input.content,
    `${label}.summary`,
  );
  const nodeId =
    input.nodeId === undefined || input.nodeId === null
      ? null
      : normalizeRequiredString(input.nodeId, `${label}.nodeId`);
  const lineageMemoryIds = normalizeLongTermMemoryLogicalIdentityLineageMemoryIds(
    input.lineageMemoryIds ??
      input.sourceMemoryIds ??
      input.consolidationState?.sourceMemoryIds,
    memoryId,
  );
  const learnedTraitLabel =
    category === "learned_trait"
      ? normalizeRequiredString(
          input.learnedTraitLabel ?? input.learnedTrait?.label ?? summary,
          `${label}.learnedTraitLabel`,
        )
      : null;
  const key = JSON.stringify({
    version: LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA.version,
    agentId,
    category,
    content,
    summary,
    lineageMemoryIds,
    learnedTraitLabel,
  });

  return freezeDeep({
    version: LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA.version,
    stableMemoryId: memoryId,
    nodeId,
    agentId,
    category,
    content,
    summary,
    lineageMemoryIds,
    learnedTraitLabel,
    key,
  });
};

const createLongTermMemoryLogicalIdentityDescriptorFromEntry = (entry, label) =>
  createLongTermMemoryLogicalIdentityDescriptor(
    {
      nodeId: entry.metadata.nodeId,
      agentId: entry.metadata.agentId,
      memoryId: entry.content.memoryId,
      category: entry.content.category,
      content: entry.content.content,
      summary: entry.content.summary,
      sourceMemoryIds: entry.metadata.consolidationState.sourceMemoryIds,
      learnedTrait: entry.metadata.learnedTrait,
    },
    label,
  );

const normalizeLongTermMemoryLogicalIdentityDescriptor = (input, label) => {
  if (isLongTermMemoryLogicalIdentityInput(input)) {
    return createLongTermMemoryLogicalIdentityDescriptor(input, label);
  }

  return createLongTermMemoryLogicalIdentityDescriptorFromEntry(
    normalizeLongTermMemoryPersistenceEntry(input, label),
    label,
  );
};

const normalizeLongTermMemoryLogicalIdentityRecordDescriptors = (records, label) => {
  if (!Array.isArray(records)) {
    throw new TypeError(`${label} must be an array`);
  }

  return freezeDeep(
    records.map((record, index) =>
      normalizeLongTermMemoryLogicalIdentityDescriptor(
        record,
        `${label}[${index}]`,
      ),
    ),
  );
};

const sortLongTermMemoryLogicalIdentityMatches = (matches) =>
  [...matches].sort((left, right) =>
    `${left.nodeId ?? ""}:${left.stableMemoryId}`.localeCompare(
      `${right.nodeId ?? ""}:${right.stableMemoryId}`,
    ),
  );

const createLongTermMemoryLogicalIdentityMatchResult = ({
  status,
  strategy,
  logicalIdentity,
  matches,
}) => {
  const sortedMatches = sortLongTermMemoryLogicalIdentityMatches(matches);
  const matchedLogicalIdentity =
    status !== "unmatched" && sortedMatches.length > 0 ? sortedMatches[0] : null;
  const conflictingMemoryIds =
    status === "matched"
      ? []
      : createSortedUniqueStringList(
          sortedMatches
            .map((match) => match.stableMemoryId)
            .filter((memoryId) => memoryId !== logicalIdentity.stableMemoryId),
        );

  return freezeDeep({
    status,
    strategy,
    logicalIdentity,
    matchCount: sortedMatches.length,
    matchedMemoryId: matchedLogicalIdentity?.stableMemoryId ?? null,
    matchedNodeId: matchedLogicalIdentity?.nodeId ?? null,
    matchedLogicalIdentity,
    conflictingMemoryIds,
  });
};

const resolveLongTermMemoryLogicalIdentityMatch = (records, logicalIdentity) => {
  const stableMemoryIdMatches = records.filter(
    (record) =>
      record.agentId === logicalIdentity.agentId &&
      record.stableMemoryId === logicalIdentity.stableMemoryId,
  );

  if (stableMemoryIdMatches.length > 0) {
    return createLongTermMemoryLogicalIdentityMatchResult({
      status: "matched",
      strategy: "stable-memory-id",
      logicalIdentity,
      matches: stableMemoryIdMatches,
    });
  }

  const logicalIdentityMatches = records.filter(
    (record) =>
      record.agentId === logicalIdentity.agentId && record.key === logicalIdentity.key,
  );

  if (logicalIdentityMatches.length === 0) {
    return createLongTermMemoryLogicalIdentityMatchResult({
      status: "unmatched",
      strategy: "logical-identity",
      logicalIdentity,
      matches: [],
    });
  }

  const distinctMatchedMemoryIds = createSortedUniqueStringList(
    logicalIdentityMatches.map((record) => record.stableMemoryId),
  );

  if (distinctMatchedMemoryIds.length > 1) {
    return createLongTermMemoryLogicalIdentityMatchResult({
      status: "ambiguous",
      strategy: "logical-identity",
      logicalIdentity,
      matches: logicalIdentityMatches,
    });
  }

  if (distinctMatchedMemoryIds[0] !== logicalIdentity.stableMemoryId) {
    return createLongTermMemoryLogicalIdentityMatchResult({
      status: "conflicting-stable-memory-id",
      strategy: "logical-identity",
      logicalIdentity,
      matches: logicalIdentityMatches,
    });
  }

  return createLongTermMemoryLogicalIdentityMatchResult({
    status: "matched",
    strategy: "logical-identity",
    logicalIdentity,
    matches: logicalIdentityMatches,
  });
};

export const createLongTermMemoryLogicalIdentity = (input) =>
  normalizeLongTermMemoryLogicalIdentityDescriptor(
    input,
    "Long-term memory logical identity input",
  );

export const matchLongTermMemoryLogicalIdentity = (records, input) =>
  resolveLongTermMemoryLogicalIdentityMatch(
    normalizeLongTermMemoryLogicalIdentityRecordDescriptors(
      records,
      "Long-term memory logical identity records",
    ),
    createLongTermMemoryLogicalIdentity(input),
  );

const normalizeLongTermMemoryPersistenceKeyPrefix = (value, label) => {
  if (value === undefined || value === null) {
    return DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedSegments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (normalizedSegments.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedSegments.join("/");
};

const createEncodedLongTermMemoryPersistenceSegment = (value, label) =>
  encodeURIComponent(normalizeRequiredString(value, label));

const serializeLongTermMemoryPersistenceStorageValue = (entry) =>
  `${JSON.stringify(entry, null, 2)}\n`;

const createLongTermMemoryPersistenceStorageRecord = ({
  key,
  keyPrefix,
  recordName,
  agentId,
  memoryId,
  nodeId,
  contentType,
  value,
  entry,
}) => {
  if (contentType !== "application/json") {
    throw new TypeError(
      'Long-term memory persistence storage record.contentType must be "application/json".',
    );
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      "Long-term memory persistence storage record.value must be a non-empty string.",
    );
  }

  return freezeDeep({
    ...createLongTermMemoryPersistenceStorageRecordDescriptor({
      key,
      keyPrefix,
      recordName,
      agentId,
      memoryId,
      nodeId,
    }),
    contentType,
    value,
    entry: normalizeLongTermMemoryPersistenceEntry(
      entry,
      "Long-term memory persistence storage record.entry",
    ),
  });
};

const assertLongTermMemoryPersistenceStorageRecordMatchesSanitizedEntry = (
  record,
  label,
) => {
  const expectedRecordName = createLongTermMemoryPersistenceRecordName(record.entry);
  const expectedKey = createLongTermMemoryPersistenceKey(record.entry, {
    keyPrefix: record.keyPrefix,
  });
  const expectedValue = serializeLongTermMemoryPersistenceStorageValue(
    record.entry,
  );

  if (record.recordName !== expectedRecordName) {
    throw new Error(
      `${label}.recordName must match the canonical sanitized durable entry record name.`,
    );
  }

  if (record.key !== expectedKey) {
    throw new Error(
      `${label}.key must match the canonical sanitized durable entry storage key.`,
    );
  }

  if (record.agentId !== record.entry.metadata.agentId) {
    throw new Error(
      `${label}.agentId must match the canonical sanitized durable entry agentId.`,
    );
  }

  if (record.memoryId !== record.entry.content.memoryId) {
    throw new Error(
      `${label}.memoryId must match the canonical sanitized durable entry memoryId.`,
    );
  }

  if (record.nodeId !== record.entry.metadata.nodeId) {
    throw new Error(
      `${label}.nodeId must match the canonical sanitized durable entry nodeId.`,
    );
  }

  if (record.value !== expectedValue) {
    throw new Error(
      `${label}.value must match the canonical sanitized durable entry JSON. ` +
        "Unsanitized payloads cannot be written to long-term storage.",
    );
  }
};

const normalizeLongTermMemoryPersistenceStorageWriteRequest = (
  request,
  label = "Long-term memory persistence storage.write(request)",
) => {
  if (!isPlainObject(request)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const storageRecord = createLongTermMemoryPersistenceStorageRecord(request);
  assertLongTermMemoryPersistenceStorageRecordMatchesSanitizedEntry(
    storageRecord,
    label,
  );

  return {
    ...request,
    ...storageRecord,
  };
};

const createLongTermMemoryPersistenceStorageRecordDescriptor = ({
  key,
  keyPrefix,
  recordName,
  agentId,
  memoryId,
  nodeId,
}) =>
  freezeDeep({
    key: normalizeRequiredString(
      key,
      "Long-term memory persistence storage record descriptor.key",
    ),
    keyPrefix: normalizeRequiredString(
      keyPrefix,
      "Long-term memory persistence storage record descriptor.keyPrefix",
    ),
    recordName: normalizeRequiredString(
      recordName,
      "Long-term memory persistence storage record descriptor.recordName",
    ),
    agentId: normalizeRequiredString(
      agentId,
      "Long-term memory persistence storage record descriptor.agentId",
    ),
    memoryId: normalizeRequiredString(
      memoryId,
      "Long-term memory persistence storage record descriptor.memoryId",
    ),
    nodeId: normalizeRequiredString(
      nodeId,
      "Long-term memory persistence storage record descriptor.nodeId",
    ),
  });

const normalizeLongTermMemoryPersistenceStoredIdentity = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object when provided.`);
  }

  return freezeDeep({
    agentId: normalizeRequiredString(
      value.agentId,
      `${label}.agentId`,
    ),
    memoryId: normalizeRequiredString(
      value.memoryId,
      `${label}.memoryId`,
    ),
    nodeId: normalizeRequiredString(
      value.nodeId,
      `${label}.nodeId`,
    ),
    logicalIdentityKey: normalizeRequiredString(
      value.logicalIdentityKey,
      `${label}.logicalIdentityKey`,
    ),
  });
};

const createLongTermMemoryPersistenceStoredIdentity = (entry) =>
  freezeDeep({
    agentId: entry.metadata.agentId,
    memoryId: entry.content.memoryId,
    nodeId: entry.metadata.nodeId,
    logicalIdentityKey: createLongTermMemoryLogicalIdentityDescriptorFromEntry(
      entry,
      "Long-term memory persistence write integrity entry",
    ).key,
  });

const createLongTermMemoryPersistenceWriteIntegrity = ({
  mode,
  existingEntry,
  nextEntry,
}) =>
  freezeDeep({
    mode,
    expectedExistingValue:
      existingEntry === null
        ? null
        : serializeLongTermMemoryPersistenceStorageValue(existingEntry),
    expectedExistingIdentity:
      existingEntry === null
      ? null
      : createLongTermMemoryPersistenceStoredIdentity(existingEntry),
    nextIdentity: createLongTermMemoryPersistenceStoredIdentity(nextEntry),
  });

const normalizeLongTermMemoryPersistenceStorageDeleteIntegrity = (
  integrity,
  label = "Long-term memory persistence storage.delete(request).integrity",
) => {
  if (integrity === undefined || integrity === null) {
    return null;
  }

  if (!isPlainObject(integrity)) {
    throw new TypeError(`${label} must be an object when provided.`);
  }

  const expectedExistingValue =
    integrity.expectedExistingValue === undefined ||
    integrity.expectedExistingValue === null
      ? null
      : normalizeRequiredString(
          integrity.expectedExistingValue,
          `${label}.expectedExistingValue`,
        );

  return freezeDeep({
    expectedExistingValue,
    expectedExistingIdentity:
      normalizeLongTermMemoryPersistenceStoredIdentity(
        integrity.expectedExistingIdentity,
        `${label}.expectedExistingIdentity`,
      ),
  });
};

const normalizeLongTermMemoryPersistenceStorageDeleteRequest = (
  request,
  label = "Long-term memory persistence storage.delete(request)",
) => {
  if (!isPlainObject(request)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return freezeDeep({
    ...createLongTermMemoryPersistenceStorageRecordDescriptor(request),
    integrity: normalizeLongTermMemoryPersistenceStorageDeleteIntegrity(
      request.integrity,
      `${label}.integrity`,
    ),
  });
};

const normalizeLongTermMemoryPersistenceStorageDeleteResult = (
  value,
  request,
  label = "Long-term memory persistence storage.delete(request) result",
) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const deleteResult = freezeDeep({
    ...createLongTermMemoryPersistenceStorageRecordDescriptor(value),
    deleted: value.deleted === true,
  });

  for (const field of ["key", "keyPrefix", "recordName", "agentId", "memoryId", "nodeId"]) {
    if (deleteResult[field] !== request[field]) {
      throw new Error(`${label}.${field} must match the delete request ${field}.`);
    }
  }

  return deleteResult;
};

const assertConsolidationMergePreservesStoredIdentityField = (
  existingIdentity,
  nextIdentity,
  canonicalField,
  attemptedField,
  labelPrefix,
) => {
  if (existingIdentity[canonicalField] === nextIdentity[canonicalField]) {
    return;
  }

  throwConsolidationPipelineAbort({
    stage: "merge",
    canonicalField,
    attemptedField,
    sourceMemoryId: nextIdentity.memoryId,
    agentId: nextIdentity.agentId,
    expectedValue: existingIdentity[canonicalField],
    actualValue: nextIdentity[canonicalField],
    message:
      `${labelPrefix} cannot replace existing canonical ${canonicalField} ` +
      `"${existingIdentity[canonicalField]}" with "${nextIdentity[canonicalField]}". ` +
      "Offline consolidation merges must preserve the existing durable canonical identity before write.",
  });
};

const assertConsolidationMergePreservesCanonicalIdentity = (
  existingEntry,
  nextEntry,
  labelPrefix,
) => {
  const existingIdentity = createLongTermMemoryPersistenceStoredIdentity(existingEntry);
  const nextIdentity = createLongTermMemoryPersistenceStoredIdentity(nextEntry);

  assertConsolidationMergePreservesStoredIdentityField(
    existingIdentity,
    nextIdentity,
    "agentId",
    "mergedEntry.metadata.agentId",
    labelPrefix,
  );
  assertConsolidationMergePreservesStoredIdentityField(
    existingIdentity,
    nextIdentity,
    "memoryId",
    "mergedEntry.content.memoryId",
    labelPrefix,
  );
  assertConsolidationMergePreservesStoredIdentityField(
    existingIdentity,
    nextIdentity,
    "nodeId",
    "mergedEntry.metadata.nodeId",
    labelPrefix,
  );
};

const normalizeLongTermMemoryPersistenceStorageAdapter = (storage) => {
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    throw new TypeError(
      "Long-term memory persistence storage must be an object with read(request) and write(request) methods.",
    );
  }

  if (typeof storage.read !== "function") {
    throw new TypeError(
      "Long-term memory persistence storage.read must be a function.",
    );
  }

  if (typeof storage.write !== "function") {
    throw new TypeError(
      "Long-term memory persistence storage.write must be a function.",
    );
  }

  if ("list" in storage && storage.list !== undefined && typeof storage.list !== "function") {
    throw new TypeError(
      "Long-term memory persistence storage.list must be a function when provided.",
    );
  }

  if (
    "delete" in storage &&
    storage.delete !== undefined &&
    typeof storage.delete !== "function"
  ) {
    throw new TypeError(
      "Long-term memory persistence storage.delete must be a function when provided.",
    );
  }

  return {
    ...storage,
    read(request) {
      return storage.read.call(storage, request);
    },
    write(request) {
      return storage.write.call(
        storage,
        normalizeLongTermMemoryPersistenceStorageWriteRequest(request),
      );
    },
    ...(typeof storage.list === "function"
      ? {
          list(request) {
            return storage.list.call(storage, request);
          },
        }
      : {}),
    ...(typeof storage.delete === "function"
      ? {
          delete(request) {
            return storage.delete.call(
              storage,
              normalizeLongTermMemoryPersistenceStorageDeleteRequest(request),
            );
          },
        }
      : {}),
  };
};

const resolveLongTermMemoryPersistenceStorageAdapter = (
  options,
  label = "Long-term memory persistence write input",
) => {
  const hasStorage = Object.hasOwn(options, "storage");
  const hasStorageAdapter = Object.hasOwn(options, "storageAdapter");

  if (!hasStorage && !hasStorageAdapter) {
    throw new TypeError(
      `${label} must include storage or storageAdapter.`,
    );
  }

  if (
    hasStorage &&
    hasStorageAdapter &&
    options.storage !== options.storageAdapter
  ) {
    throw new TypeError(
      `${label}.storage and ${label}.storageAdapter must reference the same adapter when both are provided.`,
    );
  }

  return normalizeLongTermMemoryPersistenceStorageAdapter(
    hasStorageAdapter ? options.storageAdapter : options.storage,
  );
};

const resolveLongTermMemoryPersistenceDeleteAdapter = (
  options,
  label = "Long-term memory persistence delete input",
) => {
  const storage = resolveLongTermMemoryPersistenceStorageAdapter(options, label);

  if (typeof storage.delete !== "function") {
    throw new TypeError(
      `${label} storage must provide delete(request) for durable removals.`,
    );
  }

  return storage;
};

const normalizeStoredLongTermMemoryPersistenceEntry = (value, key) => {
  if (value === undefined || value === null) {
    return null;
  }

  let parsedValue = value;

  if (typeof parsedValue === "string") {
    if (parsedValue.trim().length === 0) {
      throw new Error(
        `Stored long-term memory entry at key "${key}" must not be an empty string.`,
      );
    }

    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      throw new Error(
        `Stored long-term memory entry at key "${key}" must contain valid JSON.`,
      );
    }
  }

  try {
    return serializeLongTermMemoryEntry(
      deserializeLongTermMemoryEntryFromSerializedEntry(
        parsedValue,
        `Stored long-term memory entry at key "${key}"`,
      ),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Stored long-term memory entry at key "${key}" is invalid: ${reason}`,
    );
  }
};

const normalizeLongTermMemoryPersistenceStorageReadResult = (
  value,
  request,
  label,
) => {
  if (
    !isPlainObject(value) ||
    (!("found" in value) && !("value" in value))
  ) {
    return freezeDeep({
      ...request,
      found: value !== undefined && value !== null,
      value,
    });
  }

  const key = normalizeRequiredString(value.key, `${label}.key`);
  const keyPrefix = normalizeRequiredString(
    value.keyPrefix,
    `${label}.keyPrefix`,
  );
  const recordName = normalizeRequiredString(
    value.recordName,
    `${label}.recordName`,
  );
  const agentId = normalizeRequiredString(value.agentId, `${label}.agentId`);
  const memoryId = normalizeRequiredString(
    value.memoryId,
    `${label}.memoryId`,
  );
  const nodeId = normalizeRequiredString(value.nodeId, `${label}.nodeId`);

  if (typeof value.found !== "boolean") {
    throw new TypeError(`${label}.found must be a boolean.`);
  }

  const readResult = freezeDeep({
    key,
    keyPrefix,
    recordName,
    agentId,
    memoryId,
    nodeId,
    found: value.found,
    value: value.value,
  });

  for (const field of ["key", "keyPrefix", "recordName", "agentId", "memoryId", "nodeId"]) {
    if (readResult[field] !== request[field]) {
      throw new Error(`${label}.${field} must match the read request ${field}.`);
    }
  }

  return readResult;
};

const readStoredLongTermMemoryPersistenceSnapshot = async (storage, request) => {
  const readResult = normalizeLongTermMemoryPersistenceStorageReadResult(
    await Promise.resolve(storage.read(request)),
    request,
    `Long-term memory persistence storage.read({ key: "${request.key}" }) result`,
  );
  const rawValue = readResult.value;

  try {
    return {
      found: readResult.found,
      rawValue,
      entry: normalizeStoredLongTermMemoryPersistenceEntry(rawValue, request.key),
      validationError: null,
    };
  } catch (error) {
    return {
      found: readResult.found,
      rawValue,
      entry: null,
      validationError: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

const normalizeLongTermMemoryPersistenceStorageListEntries = async (
  storage,
  { keyPrefix, agentId },
) => {
  if (typeof storage.list !== "function") {
    return null;
  }

  const listedEntries = await Promise.resolve(
    storage.list({
      keyPrefix,
      agentId,
    }),
  );

  if (!Array.isArray(listedEntries)) {
    throw new TypeError(
      "Long-term memory persistence storage.list must return an array when provided.",
    );
  }

  const seenKeys = new Set();

  return freezeDeep(
    listedEntries
      .map((listedEntry, index) => {
        if (!isPlainObject(listedEntry)) {
          throw new TypeError(
            `Long-term memory persistence storage.list entry ${index} must be an object with key and value properties.`,
          );
        }

        const key = normalizeRequiredString(
          listedEntry.key,
          `Long-term memory persistence storage.list entry ${index}.key`,
        );

        if (seenKeys.has(key)) {
          throw new Error(
            `Long-term memory persistence storage.list returned duplicate key "${key}".`,
          );
        }
        seenKeys.add(key);

        const entry = normalizeStoredLongTermMemoryPersistenceEntry(
          listedEntry.value,
          key,
        );

        if (entry === null) {
          return null;
        }

        if (entry.metadata.agentId !== agentId) {
          throw new Error(
            `Long-term memory persistence storage.list returned agentId "${entry.metadata.agentId}" outside requested agentId "${agentId}".`,
          );
        }

        const canonicalKey = createLongTermMemoryPersistenceKey(entry, {
          keyPrefix,
        });

        if (canonicalKey !== key) {
          throw new Error(
            `Stored long-term memory entry at key "${key}" does not match its canonical storage key "${canonicalKey}".`,
          );
        }

        return freezeDeep({
          key,
          entry,
        });
      })
      .filter((listedEntry) => listedEntry !== null),
  );
};

const resolveStoredLongTermMemoryPersistenceIdentityMatch = (
  storedEntries,
  entry,
  label,
) => {
  const logicalIdentity = createLongTermMemoryLogicalIdentityDescriptorFromEntry(
    entry,
    `${label}.entry`,
  );
  const identityRecords = storedEntries.map((storedEntry, index) =>
    freezeDeep({
      ...createLongTermMemoryLogicalIdentityDescriptorFromEntry(
        storedEntry.entry,
        `${label}.storedEntries[${index}].entry`,
      ),
      storageKey: storedEntry.key,
      entry: storedEntry.entry,
    }),
  );
  const match = resolveLongTermMemoryLogicalIdentityMatch(
    identityRecords,
    logicalIdentity,
  );

  if (match.status === "unmatched") {
    return null;
  }

  if (match.status === "ambiguous") {
    throw new Error(
      `${label}.entry matches multiple stored durable memories for the same logical identity.`,
    );
  }

  if (match.status !== "unmatched") {
    assertConsolidationDeduplicationPreservesCanonicalIdentity(
      {
        agentId: logicalIdentity.agentId,
        sourceMemoryId: logicalIdentity.stableMemoryId,
        deduplicatedMemoryId: match.matchedMemoryId,
        deduplicatedNodeId: match.matchedNodeId,
      },
      `${label}.entry`,
      {
        attemptedMemoryField: "matchedStoredEntry.content.memoryId",
        attemptedNodeField: "matchedStoredEntry.metadata.nodeId",
      },
    );
  }

  const matchedRecords = identityRecords.filter((record) => {
    if (record.agentId !== logicalIdentity.agentId) {
      return false;
    }

    if (record.stableMemoryId !== match.matchedMemoryId) {
      return false;
    }

    if (
      match.strategy === "logical-identity" &&
      record.key !== logicalIdentity.key
    ) {
      return false;
    }

    return true;
  });

  if (matchedRecords.length !== 1) {
    throw new Error(
      `${label}.entry resolved to ${matchedRecords.length} stored durable records for memoryId "${match.matchedMemoryId}".`,
    );
  }

  return freezeDeep({
    key: matchedRecords[0].storageKey,
    entry: matchedRecords[0].entry,
    match,
  });
};

const verifyLongTermMemoryPersistenceWrite = async (
  storage,
  { key, keyPrefix, entry, operationLabel },
) => {
  const storedSnapshot = await readStoredLongTermMemoryPersistenceSnapshot(
    storage,
    createLongTermMemoryPersistenceStorageRecordDescriptor({
      key,
      keyPrefix,
      recordName: createLongTermMemoryPersistenceRecordName(entry),
      agentId: entry.metadata.agentId,
      memoryId: entry.content.memoryId,
      nodeId: entry.metadata.nodeId,
    }),
  );

  if (storedSnapshot.validationError !== null) {
    throw new Error(
      `${operationLabel} failed read-back validation at key "${key}": ${storedSnapshot.validationError.message}`,
    );
  }

  if (storedSnapshot.entry === null) {
    throw new Error(
      `${operationLabel} did not persist any durable memory at key "${key}".`,
    );
  }

  if (!areOldGenerationSnapshotValuesEqual(storedSnapshot.entry, entry)) {
    throw new Error(
      `${operationLabel} persisted unexpected durable content at key "${key}".`,
    );
  }

  const listedEntries = await normalizeLongTermMemoryPersistenceStorageListEntries(
    storage,
    {
      keyPrefix,
      agentId: entry.metadata.agentId,
    },
  );

  if (listedEntries === null) {
    return storedSnapshot;
  }

  const listedEntryAtCanonicalKey =
    listedEntries.find((storedEntry) => storedEntry.key === key)?.entry ?? null;

  if (listedEntryAtCanonicalKey === null) {
    throw new Error(
      `${operationLabel} did not surface key "${key}" through storage.list().`,
    );
  }

  if (
    !areOldGenerationSnapshotValuesEqual(
      listedEntryAtCanonicalKey,
      storedSnapshot.entry,
    )
  ) {
    throw new Error(
      `${operationLabel} storage.read({ key: "${key}" }) and storage.list() returned different canonical entries after write.`,
    );
  }

  const matchedStoredEntry = resolveStoredLongTermMemoryPersistenceIdentityMatch(
    listedEntries,
    entry,
    `${operationLabel} verification`,
  );

  if (matchedStoredEntry === null) {
    throw new Error(
      `${operationLabel} could not resolve the written durable identity after write.`,
    );
  }

  if (matchedStoredEntry.key !== key) {
    throw new Error(
      `${operationLabel} resolved the written durable identity to unexpected key "${matchedStoredEntry.key}".`,
    );
  }

  if (!areOldGenerationSnapshotValuesEqual(matchedStoredEntry.entry, entry)) {
    throw new Error(
      `${operationLabel} resolved the durable identity to content that did not match the canonical write payload.`,
    );
  }

  return storedSnapshot;
};

const verifyLongTermMemoryPersistenceDelete = async (
  storage,
  { key, keyPrefix, recordName, agentId, memoryId, nodeId, operationLabel },
) => {
  const storedSnapshot = await readStoredLongTermMemoryPersistenceSnapshot(
    storage,
    createLongTermMemoryPersistenceStorageRecordDescriptor({
      key,
      keyPrefix,
      recordName,
      agentId,
      memoryId,
      nodeId,
    }),
  );

  if (storedSnapshot.validationError !== null) {
    throw new Error(
      `${operationLabel} failed read-back validation at key "${key}": ${storedSnapshot.validationError.message}`,
    );
  }

  if (storedSnapshot.found || storedSnapshot.rawValue !== null || storedSnapshot.entry !== null) {
    throw new Error(
      `${operationLabel} left durable content behind at key "${key}".`,
    );
  }

  const listedEntries = await normalizeLongTermMemoryPersistenceStorageListEntries(
    storage,
    {
      keyPrefix,
      agentId,
    },
  );

  if (listedEntries === null) {
    return storedSnapshot;
  }

  if (listedEntries.some((storedEntry) => storedEntry.key === key)) {
    throw new Error(
      `${operationLabel} left key "${key}" visible through storage.list().`,
    );
  }

  return storedSnapshot;
};

const rollbackLongTermMemoryPersistenceOverwrite = async (
  storage,
  { key, keyPrefix, previousEntry, failedRawValue },
) => {
  const rollbackValue =
    typeof failedRawValue === "string" && failedRawValue.trim().length > 0
      ? failedRawValue
      : null;
  const serializedPreviousEntry =
    serializeLongTermMemoryPersistenceStorageValue(previousEntry);

  await Promise.resolve(
    storage.write({
      key,
      keyPrefix,
      recordName: createLongTermMemoryPersistenceRecordName(previousEntry),
      agentId: previousEntry.metadata.agentId,
      memoryId: previousEntry.content.memoryId,
      nodeId: previousEntry.metadata.nodeId,
      contentType: "application/json",
      value: serializedPreviousEntry,
      entry: previousEntry,
      overwrite: true,
      integrity: freezeDeep({
        mode: "rollback",
        expectedExistingValue: rollbackValue,
        expectedExistingIdentity: null,
        nextIdentity: createLongTermMemoryPersistenceStoredIdentity(
          previousEntry,
        ),
      }),
    }),
  );

  await verifyLongTermMemoryPersistenceWrite(storage, {
    key,
    keyPrefix,
    entry: previousEntry,
    operationLabel: "Long-term memory persistence rollback",
  });
};

const normalizeLongTermMemoryPersistenceWriteReference = (input, label) => {
  if (isLongTermMemoryPromotionRewriteInput(input)) {
    const entry = rewritePromotionSelectionToLongTermMemoryEntry(input);

    return freezeDeep({
      agentId: entry.metadata.agentId,
      memoryId: entry.content.memoryId,
      nodeId: entry.metadata.nodeId,
      serialize: () => entry,
    });
  }

  if (isLongTermMemoryPromotionSerializationInput(input)) {
    const selection = normalizePromotionSerializationSelection(input.selection);
    const sourceRecord = getPromotionSerializationSourceRecord(input.memory, label);

    if (
      sourceRecord.agentId !== undefined &&
      sourceRecord.agentId !== selection.candidate.agentId
    ) {
      throwConsolidationPipelineAbort({
        stage: "persistence",
        canonicalField: "agentId",
        attemptedField: "memory.agentId",
        sourceMemoryId: selection.candidate.sourceMemoryId,
        agentId: selection.candidate.agentId,
        expectedValue: selection.candidate.agentId,
        actualValue: String(sourceRecord.agentId),
        message: `${label}.memory.agentId must match selection.candidate.agentId when present.`,
      });
    }

    if (
      sourceRecord.memoryId !== undefined &&
      sourceRecord.memoryId !== selection.candidate.sourceMemoryId
    ) {
      throwConsolidationPipelineAbort({
        stage: "persistence",
        canonicalField: "memoryId",
        attemptedField: "memory.memoryId",
        sourceMemoryId: selection.candidate.sourceMemoryId,
        agentId: selection.candidate.agentId,
        expectedValue: selection.candidate.sourceMemoryId,
        actualValue: String(sourceRecord.memoryId),
        message: `${label}.memory.memoryId must match selection.candidate.sourceMemoryId when present.`,
      });
    }

    const memoryId = normalizeMemoryItemStableId(
      input.memoryId ??
        selection.outputMemoryId ??
        selection.targetMemoryId ??
        sourceRecord.memoryId ??
        selection.candidate.sourceMemoryId,
      `${label}.memoryId`,
    );
    assertConsolidationOutputMemoryIdPreservesSourceMemoryId(
      selection.candidate.sourceMemoryId,
      memoryId,
      label,
      {
        stage: "persistence",
        agentId: selection.candidate.agentId,
        attemptedField: "output memoryId",
      },
    );
    const nodeId =
      input.nodeId ??
      selection.outputNodeId ??
      selection.targetNodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        selection.candidate.agentId,
        memoryId,
      );
    assertConsolidationOutputNodeIdPreservesCanonicalIdentity(
      {
        agentId: selection.candidate.agentId,
        sourceMemoryId: selection.candidate.sourceMemoryId,
        outputMemoryId: memoryId,
      },
      nodeId,
      label,
      {
        stage: "persistence",
        attemptedField: "outputNodeId",
      },
    );

    return freezeDeep({
      agentId: selection.candidate.agentId,
      memoryId,
      nodeId,
      serialize: () => serializePromotionSelectionToLongTermMemoryEntry(input),
    });
  }

  if (
    isPlainObject(input) &&
    input.schemaId === LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId &&
    input.nodeKind === MEMORY_NODE_KINDS.longTermMemory &&
    "content" in input &&
    "metadata" in input
  ) {
    const serializedEntry = assertOldGenerationSnapshotObject(input, label);
    assertOldGenerationSnapshotAllowedKeys(
      serializedEntry,
      LONG_TERM_MEMORY_PERSISTENCE_FIELD_KEYS,
      label,
    );
    const schemaId = assertOldGenerationSnapshotString(
      serializedEntry.schemaId,
      `${label}.schemaId`,
    );
    const schemaVersion = assertOldGenerationSnapshotString(
      serializedEntry.schemaVersion,
      `${label}.schemaVersion`,
    );
    const nodeKind = assertOldGenerationSnapshotString(
      serializedEntry.nodeKind,
      `${label}.nodeKind`,
    );

    if (schemaId !== LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId) {
      throw new Error(
        `${label}.schemaId must be "${LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId}".`,
      );
    }

    if (schemaVersion !== LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version) {
      throw new Error(
        `${label}.schemaVersion must be "${LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version}".`,
      );
    }

    if (nodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
      throw new Error(
        `${label}.nodeKind must be "${MEMORY_NODE_KINDS.longTermMemory}".`,
      );
    }

    const content = validateSerializedLongTermMemoryContent(
      serializedEntry.content,
      `${label}.content`,
    );
    const metadata = validateSerializedLongTermMemoryMetadata(
      serializedEntry.metadata,
      `${label}.metadata`,
    );

    assertOldGenerationNodeId({
      nodeId: metadata.nodeId,
      agentId: metadata.agentId,
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      localId: content.memoryId,
      entityLabel: label,
    });

    return freezeDeep({
      agentId: metadata.agentId,
      memoryId: content.memoryId,
      nodeId: metadata.nodeId,
      serialize: () => normalizeLongTermMemoryPersistenceEntry(serializedEntry, label),
    });
  }

  const memory = createLongTermMemory(input);

  return freezeDeep({
    agentId: memory.agentId,
    memoryId: memory.memoryId,
    nodeId: memory.nodeId,
    serialize: () => serializeLongTermMemoryEntry(memory),
  });
};

const serializeLongTermMemoryPersistenceStorageRecordFromWriteReference = (
  writeReference,
  keyPrefix,
  label,
) => {
  const sanitizedEntryResult = sanitizeSerializedLongTermMemoryEntryResult(
    writeReference.serialize(),
  );
  assertNoUnredactableSerializedLongTermMemorySecrets(
    sanitizedEntryResult,
    label,
  );
  const entry = sanitizedEntryResult.sanitizedPayload;
  const recordName = `${createEncodedLongTermMemoryPersistenceSegment(
    entry.content.memoryId,
    `${label}.memoryId`,
  )}.json`;
  const key = `${keyPrefix}/${createEncodedLongTermMemoryPersistenceSegment(
    entry.metadata.agentId,
    `${label}.agentId`,
  )}/${recordName}`;

  return createLongTermMemoryPersistenceStorageRecord({
    key,
    keyPrefix,
    recordName,
    agentId: entry.metadata.agentId,
    memoryId: entry.content.memoryId,
    nodeId: entry.metadata.nodeId,
    contentType: "application/json",
    value: serializeLongTermMemoryPersistenceStorageValue(entry),
    entry,
  });
};

export const createLongTermMemoryPersistenceRecordName = (input) => {
  const entry = normalizeLongTermMemoryPersistenceEntry(
    input,
    "Long-term memory persistence record name input",
  );

  return `${createEncodedLongTermMemoryPersistenceSegment(
    entry.content.memoryId,
    "Long-term memory persistence record name memoryId",
  )}.json`;
};

export const createLongTermMemoryPersistenceKey = (input, options = {}) => {
  const entry = normalizeLongTermMemoryPersistenceEntry(
    input,
    "Long-term memory persistence key input",
  );
  const keyPrefix = normalizeLongTermMemoryPersistenceKeyPrefix(
    options?.keyPrefix,
    "Long-term memory persistence key prefix",
  );

  return `${keyPrefix}/${createEncodedLongTermMemoryPersistenceSegment(
    entry.metadata.agentId,
    "Long-term memory persistence key agentId",
  )}/${createLongTermMemoryPersistenceRecordName(entry)}`;
};

export const serializeLongTermMemoryPersistenceStorageRecord = (
  input,
  options = {},
) => {
  const writeReference = normalizeLongTermMemoryPersistenceWriteReference(
    input,
    "Long-term memory persistence storage record input",
  );
  const keyPrefix = normalizeLongTermMemoryPersistenceKeyPrefix(
    options?.keyPrefix,
    "Long-term memory persistence storage record keyPrefix",
  );

  return serializeLongTermMemoryPersistenceStorageRecordFromWriteReference(
    writeReference,
    keyPrefix,
    "Long-term memory persistence storage record input",
  );
};

export const persistLongTermMemoryEntry = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Long-term memory persistence write input must be an object.");
  }

  const storage = resolveLongTermMemoryPersistenceStorageAdapter(options);
  const writeReference = normalizeLongTermMemoryPersistenceWriteReference(
    options.entry,
    "Long-term memory persistence write input.entry",
  );
  const keyPrefix = normalizeLongTermMemoryPersistenceKeyPrefix(
    options.keyPrefix,
    "Long-term memory persistence write input.keyPrefix",
  );
  const recordName = `${createEncodedLongTermMemoryPersistenceSegment(
    writeReference.memoryId,
    "Long-term memory persistence write input.entry.memoryId",
  )}.json`;
  const key = `${keyPrefix}/${createEncodedLongTermMemoryPersistenceSegment(
    writeReference.agentId,
    "Long-term memory persistence write input.entry.agentId",
  )}/${recordName}`;
  const authorization = freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: writeReference.agentId,
      runtimePhase: options.runtimePhase,
      inactivitySuggestion: options.inactivitySuggestion,
      teamIdle: options.teamIdle,
    }),
  );

  const baseResult = {
    agentId: writeReference.agentId,
    memoryId: writeReference.memoryId,
    nodeId: writeReference.nodeId,
    keyPrefix,
    key,
    recordName,
    authorization,
    entry: null,
    serializedEntry: null,
  };

  if (!authorization.eligible) {
    return freezeDeep({
      ...baseResult,
      status: "blocked",
      applied: false,
      overwritten: false,
    });
  }

  const storageRecord =
    serializeLongTermMemoryPersistenceStorageRecordFromWriteReference(
      writeReference,
      keyPrefix,
      "Long-term memory persistence write input.entry",
    );
  const entry = storageRecord.entry;
  const serializedEntry = storageRecord.value;
  const authorizedResult = {
    ...baseResult,
    entry,
    serializedEntry,
  };
  const canonicalReadRequest =
    createLongTermMemoryPersistenceStorageRecordDescriptor({
      key: storageRecord.key,
      keyPrefix: storageRecord.keyPrefix,
      recordName: storageRecord.recordName,
      agentId: storageRecord.agentId,
      memoryId: storageRecord.memoryId,
      nodeId: storageRecord.nodeId,
    });
  const readSnapshotAtCanonicalKey =
    await readStoredLongTermMemoryPersistenceSnapshot(
      storage,
      canonicalReadRequest,
    );

  if (readSnapshotAtCanonicalKey.validationError !== null) {
    throw readSnapshotAtCanonicalKey.validationError;
  }

  const readEntryAtCanonicalKey = readSnapshotAtCanonicalKey.entry;
  const listedEntries = await normalizeLongTermMemoryPersistenceStorageListEntries(
    storage,
    {
      keyPrefix,
      agentId: entry.metadata.agentId,
    },
  );
  let existingEntry = readEntryAtCanonicalKey;

  if (listedEntries !== null) {
    const listedEntryAtCanonicalKey =
      listedEntries.find((storedEntry) => storedEntry.key === key)?.entry ?? null;

    if (listedEntryAtCanonicalKey !== null && readEntryAtCanonicalKey !== null) {
      if (
        !areOldGenerationSnapshotValuesEqual(
          listedEntryAtCanonicalKey,
          readEntryAtCanonicalKey,
        )
      ) {
        throw new Error(
          `Long-term memory persistence storage.read({ key: "${key}" }) and storage.list() returned different canonical entries.`,
        );
      }
    }

    const storedEntries =
      listedEntryAtCanonicalKey === null && readEntryAtCanonicalKey !== null
        ? freezeDeep([
            ...listedEntries,
            freezeDeep({
              key,
              entry: readEntryAtCanonicalKey,
            }),
          ])
        : listedEntries;
    const matchedStoredEntry = resolveStoredLongTermMemoryPersistenceIdentityMatch(
      storedEntries,
      entry,
      "Long-term memory persistence write input",
    );

    existingEntry = matchedStoredEntry?.entry ?? null;
  }

  if (existingEntry !== null) {
    assertConsolidationMergePreservesCanonicalIdentity(
      existingEntry,
      entry,
      "Long-term memory persistence merge input",
    );

    if (areOldGenerationSnapshotValuesEqual(existingEntry, entry)) {
      return freezeDeep({
        ...authorizedResult,
        status: "unchanged",
        applied: false,
        overwritten: false,
      });
    }

    try {
      await Promise.resolve(
        storage.write({
          ...storageRecord,
          overwrite: true,
          integrity: createLongTermMemoryPersistenceWriteIntegrity({
            mode: "replace",
            existingEntry,
            nextEntry: entry,
          }),
        }),
      );

      await verifyLongTermMemoryPersistenceWrite(storage, {
        key,
        keyPrefix,
        entry,
        operationLabel: "Long-term memory persistence overwrite",
      });
    } catch (error) {
      const writeFailureReason =
        error instanceof Error ? error.message : String(error);
      const failedSnapshot = await readStoredLongTermMemoryPersistenceSnapshot(
        storage,
        canonicalReadRequest,
      );

      try {
        await rollbackLongTermMemoryPersistenceOverwrite(storage, {
          key,
          keyPrefix,
          previousEntry: existingEntry,
          failedRawValue: failedSnapshot.rawValue,
        });
      } catch (rollbackError) {
        const rollbackFailureReason =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        throw new Error(
          `Long-term memory persistence overwrite failed integrity validation and rollback failed. Write failure: ${writeFailureReason}. Rollback failure: ${rollbackFailureReason}`,
        );
      }

      throw new Error(
        `Long-term memory persistence overwrite failed integrity validation. The previous durable entry was restored. ${writeFailureReason}`,
      );
    }

    return freezeDeep({
      ...authorizedResult,
      status: "overwritten",
      applied: true,
      overwritten: true,
    });
  }

  await Promise.resolve(
    storage.write({
      ...storageRecord,
      overwrite: false,
      integrity: createLongTermMemoryPersistenceWriteIntegrity({
        mode: "create",
        existingEntry: null,
        nextEntry: entry,
      }),
    }),
  );

  await verifyLongTermMemoryPersistenceWrite(storage, {
    key,
    keyPrefix,
    entry,
    operationLabel: "Long-term memory persistence create",
  });

  return freezeDeep({
    ...authorizedResult,
    status: "created",
    applied: true,
    overwritten: false,
  });
};

export const deleteLongTermMemoryEntry = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Long-term memory persistence delete input must be an object.");
  }

  const storage = resolveLongTermMemoryPersistenceDeleteAdapter(
    options,
    "Long-term memory persistence delete input",
  );
  const deleteReference = normalizeLongTermMemoryPersistenceWriteReference(
    options.entry,
    "Long-term memory persistence delete input.entry",
  );
  const keyPrefix = normalizeLongTermMemoryPersistenceKeyPrefix(
    options.keyPrefix,
    "Long-term memory persistence delete input.keyPrefix",
  );
  const recordName = `${createEncodedLongTermMemoryPersistenceSegment(
    deleteReference.memoryId,
    "Long-term memory persistence delete input.entry.memoryId",
  )}.json`;
  const key = `${keyPrefix}/${createEncodedLongTermMemoryPersistenceSegment(
    deleteReference.agentId,
    "Long-term memory persistence delete input.entry.agentId",
  )}/${recordName}`;
  const authorization = freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: deleteReference.agentId,
      runtimePhase: options.runtimePhase,
      inactivitySuggestion: options.inactivitySuggestion,
      teamIdle: options.teamIdle,
    }),
  );

  const baseResult = {
    agentId: deleteReference.agentId,
    memoryId: deleteReference.memoryId,
    nodeId: deleteReference.nodeId,
    keyPrefix,
    key,
    recordName,
    authorization,
    entry: null,
    serializedEntry: null,
  };

  if (!authorization.eligible) {
    return freezeDeep({
      ...baseResult,
      status: "blocked",
      applied: false,
      deleted: false,
    });
  }

  const canonicalReadRequest =
    createLongTermMemoryPersistenceStorageRecordDescriptor({
      key,
      keyPrefix,
      recordName,
      agentId: deleteReference.agentId,
      memoryId: deleteReference.memoryId,
      nodeId: deleteReference.nodeId,
    });
  const readSnapshotAtCanonicalKey =
    await readStoredLongTermMemoryPersistenceSnapshot(
      storage,
      canonicalReadRequest,
    );

  if (readSnapshotAtCanonicalKey.validationError !== null) {
    throw readSnapshotAtCanonicalKey.validationError;
  }

  const listedEntries = await normalizeLongTermMemoryPersistenceStorageListEntries(
    storage,
    {
      keyPrefix,
      agentId: deleteReference.agentId,
    },
  );
  let existingEntry = readSnapshotAtCanonicalKey.entry;

  if (listedEntries !== null) {
    const listedEntryAtCanonicalKey =
      listedEntries.find((storedEntry) => storedEntry.key === key)?.entry ?? null;

    if (listedEntryAtCanonicalKey !== null && readSnapshotAtCanonicalKey.entry !== null) {
      if (
        !areOldGenerationSnapshotValuesEqual(
          listedEntryAtCanonicalKey,
          readSnapshotAtCanonicalKey.entry,
        )
      ) {
        throw new Error(
          `Long-term memory persistence storage.read({ key: "${key}" }) and storage.list() returned different canonical entries.`,
        );
      }
    }

    if (listedEntryAtCanonicalKey !== null) {
      existingEntry = listedEntryAtCanonicalKey;
    }
  }

  if (existingEntry === null) {
    return freezeDeep({
      ...baseResult,
      status: "absent",
      applied: false,
      deleted: false,
    });
  }

  const serializedEntry =
    serializeLongTermMemoryPersistenceStorageValue(existingEntry);
  const authorizedResult = {
    ...baseResult,
    entry: existingEntry,
    serializedEntry,
  };

  try {
    const deleteResult = normalizeLongTermMemoryPersistenceStorageDeleteResult(
      await Promise.resolve(
        storage.delete({
          ...canonicalReadRequest,
          integrity: freezeDeep({
            expectedExistingValue: serializedEntry,
            expectedExistingIdentity: createLongTermMemoryPersistenceStoredIdentity(
              existingEntry,
            ),
          }),
        }),
      ),
      canonicalReadRequest,
      `Long-term memory persistence storage.delete({ key: "${key}" }) result`,
    );

    if (!deleteResult.deleted) {
      throw new Error(
        `Long-term memory persistence delete did not confirm durable removal at key "${key}".`,
      );
    }

    await verifyLongTermMemoryPersistenceDelete(storage, {
      ...canonicalReadRequest,
      operationLabel: "Long-term memory persistence delete",
    });
  } catch (error) {
    const deleteFailureReason =
      error instanceof Error ? error.message : String(error);
    const failedSnapshot = await readStoredLongTermMemoryPersistenceSnapshot(
      storage,
      canonicalReadRequest,
    );

    try {
      await rollbackLongTermMemoryPersistenceOverwrite(storage, {
        key,
        keyPrefix,
        previousEntry: existingEntry,
        failedRawValue: failedSnapshot.rawValue,
      });
    } catch (rollbackError) {
      const rollbackFailureReason =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `Long-term memory persistence delete failed integrity validation and rollback failed. Delete failure: ${deleteFailureReason}. Rollback failure: ${rollbackFailureReason}`,
      );
    }

    throw new Error(
      `Long-term memory persistence delete failed integrity validation. The previous durable entry was restored. ${deleteFailureReason}`,
    );
  }

  return freezeDeep({
    ...authorizedResult,
    status: "deleted",
    applied: true,
    deleted: true,
  });
};

const resolvePromotionPersistenceSourceMemory = (graph, selection, memory) => {
  if (memory !== undefined && memory !== null) {
    return memory;
  }

  const normalizedSelection = normalizePromotionSerializationSelection(selection);

  if (normalizedSelection.candidate.agentId !== graph.agentId) {
    throw new Error(
      `Long-term memory promotion persistence selection agentId "${normalizedSelection.candidate.agentId}" must match graph agentId "${graph.agentId}".`,
    );
  }

  const sourceMatches = cloneArray(
    graph.youngGeneration[normalizedSelection.sourceCollection],
  ).filter(
    (memoryEnvelope) =>
      memoryEnvelope?.record?.memoryId ===
      normalizedSelection.candidate.sourceMemoryId,
  );

  if (sourceMatches.length === 0) {
    throw new Error(
      `Long-term memory promotion persistence could not resolve source memory "${normalizedSelection.candidate.sourceMemoryId}" from graph.${normalizedSelection.sourceCollection}.`,
    );
  }

  if (sourceMatches.length > 1) {
    throw new Error(
      `Long-term memory promotion persistence found multiple source memories for "${normalizedSelection.candidate.sourceMemoryId}" in graph.${normalizedSelection.sourceCollection}.`,
    );
  }

  return sourceMatches[0];
};

const upsertLongTermMemoryIntoGraph = (graph, promotedMemory) => {
  let replaced = false;
  const nextLongTermMemory = cloneArray(graph.oldGeneration.longTermMemory).map(
    (existingMemory) => {
      if (existingMemory.memoryId !== promotedMemory.memoryId) {
        return existingMemory;
      }

      replaced = true;
      return promotedMemory;
    },
  );

  if (!replaced) {
    nextLongTermMemory.push(promotedMemory);
  }

  return rebuildMemoryGraph(graph, {
    longTermMemory: nextLongTermMemory,
  });
};

export const persistPromotionSelectionToLongTermMemory = async (
  graph,
  options = {},
) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "Long-term memory promotion persistence input must be an object.",
    );
  }

  const storage = resolveLongTermMemoryPersistenceStorageAdapter(
    options,
    "Long-term memory promotion persistence input",
  );
  const selection = normalizePromotionSerializationSelection(options.selection);
  const sourceMemory = resolvePromotionPersistenceSourceMemory(
    graph,
    selection,
    options.memory,
  );
  const persistenceEntry =
    options.rewrittenEntry === undefined || options.rewrittenEntry === null
      ? {
          selection,
          memory: sourceMemory,
        }
      : {
          selection,
          memory: sourceMemory,
          rewrittenEntry: options.rewrittenEntry,
        };
  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry: persistenceEntry,
    keyPrefix: options.keyPrefix,
    runtimePhase: options.runtimePhase,
    inactivitySuggestion: options.inactivitySuggestion,
    teamIdle: options.teamIdle,
  });

  if (!persisted.serializedEntry) {
    return freezeDeep({
      agentId: graph.agentId,
      selection,
      persisted,
      promotedMemory: null,
      nextGraph: graph,
    });
  }

  const promotedMemory = deserializeLongTermMemoryEntry(
    JSON.parse(persisted.serializedEntry),
  );

  return freezeDeep({
    agentId: graph.agentId,
    selection,
    persisted,
    promotedMemory,
    nextGraph: upsertLongTermMemoryIntoGraph(graph, promotedMemory),
  });
};

const normalizeConsolidationCheckpointScope = (
  input,
  label = "Consolidation checkpoint scope",
) => {
  if (!isPlainObject(input)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const cursor = isPlainObject(input.cursor) ? input.cursor : null;

  return freezeDeep({
    agentId: normalizeRequiredString(input.agentId, `${label}.agentId`),
    syncSource: normalizeRequiredString(input.syncSource, `${label}.syncSource`),
    streamId: normalizeRequiredString(
      cursor?.streamId ?? input.streamId,
      cursor?.streamId === undefined
        ? `${label}.streamId`
        : `${label}.cursor.streamId`,
    ),
  });
};

const normalizeConsolidationCheckpointCursor = (
  input,
  label = "Consolidation checkpoint cursor",
) => {
  if (!isPlainObject(input)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const cursor = freezeDeep({
    streamId: normalizeRequiredString(input.streamId, `${label}.streamId`),
    cursorToken: normalizeOptionalString(
      input.cursorToken,
      `${label}.cursorToken`,
    ),
    sequence: normalizeNullableNonNegativeInteger(
      input.sequence,
      `${label}.sequence`,
    ),
    eventId: normalizeOptionalString(input.eventId, `${label}.eventId`),
    watermark:
      input.watermark === undefined || input.watermark === null
        ? null
        : normalizeDateLikeToIsoString(input.watermark, `${label}.watermark`),
  });

  if (
    cursor.cursorToken === null &&
    cursor.sequence === null &&
    cursor.eventId === null &&
    cursor.watermark === null
  ) {
    throw new TypeError(
      `${label} must include at least one resume position field.`,
    );
  }

  return cursor;
};

export const createConsolidationCheckpoint = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("Consolidation checkpoint input must be an object.");
  }

  const checkpoint = freezeDeep({
    agentId: normalizeRequiredString(
      input.agentId,
      "Consolidation checkpoint input.agentId",
    ),
    syncSource: normalizeRequiredString(
      input.syncSource,
      "Consolidation checkpoint input.syncSource",
    ),
    cursor: normalizeConsolidationCheckpointCursor(
      input.cursor,
      "Consolidation checkpoint input.cursor",
    ),
    consolidatedAt: normalizeDateLikeToIsoString(
      input.consolidatedAt,
      "Consolidation checkpoint input.consolidatedAt",
    ),
    runtimePhase: normalizeOptionalString(
      input.runtimePhase,
      "Consolidation checkpoint input.runtimePhase",
    ),
    provenance: cloneObject(input.provenance),
  });

  const scope = normalizeConsolidationCheckpointScope(
    checkpoint,
    "Consolidation checkpoint input",
  );

  if (
    checkpoint.agentId !== scope.agentId ||
    checkpoint.syncSource !== scope.syncSource ||
    checkpoint.cursor.streamId !== scope.streamId
  ) {
    throw new Error(
      "Consolidation checkpoint input must preserve canonical agentId, syncSource, and cursor.streamId scope.",
    );
  }

  return checkpoint;
};

const isSerializedConsolidationCheckpointEntry = (value) =>
  isPlainObject(value) &&
  value.schemaId === CONSOLIDATION_CHECKPOINT_SCHEMA.schemaId &&
  value.recordType === CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType &&
  "checkpoint" in value;

export const serializeConsolidationCheckpointEntry = (input) => {
  const checkpoint = isSerializedConsolidationCheckpointEntry(input)
    ? deserializeConsolidationCheckpointEntryFromSerializedEntry(
        input,
        "Consolidation checkpoint entry",
      )
    : createConsolidationCheckpoint(input);

  return freezeDeep({
    schemaId: CONSOLIDATION_CHECKPOINT_SCHEMA.schemaId,
    schemaVersion: CONSOLIDATION_CHECKPOINT_SCHEMA.version,
    recordType: CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType,
    checkpoint,
  });
};

const deserializeConsolidationCheckpointEntryFromSerializedEntry = (
  entry,
  label = "Consolidation checkpoint entry",
) => {
  if (!isPlainObject(entry)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const schemaId = normalizeRequiredString(entry.schemaId, `${label}.schemaId`);
  const schemaVersion = normalizeRequiredString(
    entry.schemaVersion,
    `${label}.schemaVersion`,
  );
  const recordType = normalizeRequiredString(
    entry.recordType,
    `${label}.recordType`,
  );

  if (schemaId !== CONSOLIDATION_CHECKPOINT_SCHEMA.schemaId) {
    throw new Error(
      `${label}.schemaId must be "${CONSOLIDATION_CHECKPOINT_SCHEMA.schemaId}".`,
    );
  }

  if (schemaVersion !== CONSOLIDATION_CHECKPOINT_SCHEMA.version) {
    throw new Error(
      `${label}.schemaVersion must be "${CONSOLIDATION_CHECKPOINT_SCHEMA.version}".`,
    );
  }

  if (recordType !== CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType) {
    throw new Error(
      `${label}.recordType must be "${CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType}".`,
    );
  }

  const checkpoint = createConsolidationCheckpoint(
    isPlainObject(entry.checkpoint) ? entry.checkpoint : null,
  );
  const canonicalEntry = serializeConsolidationCheckpointEntry(checkpoint);

  if (!areOldGenerationSnapshotValuesEqual(canonicalEntry, entry)) {
    throw new Error(
      `${label} must match the canonical serialized consolidation checkpoint shape.`,
    );
  }

  return checkpoint;
};

const normalizeStoredConsolidationCheckpointEntry = (value, key) => {
  if (value === undefined || value === null) {
    return null;
  }

  let parsedValue = value;

  if (typeof parsedValue === "string") {
    if (parsedValue.trim().length === 0) {
      throw new Error(
        `Stored consolidation checkpoint at key "${key}" must not be an empty string.`,
      );
    }

    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      throw new Error(
        `Stored consolidation checkpoint at key "${key}" must contain valid JSON.`,
      );
    }
  }

  try {
    return serializeConsolidationCheckpointEntry(
      deserializeConsolidationCheckpointEntryFromSerializedEntry(
        parsedValue,
        `Stored consolidation checkpoint at key "${key}"`,
      ),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Stored consolidation checkpoint at key "${key}" is invalid: ${reason}`,
    );
  }
};

const normalizeConsolidationCheckpointStoredEntrySource = (input, label) => {
  if (isSerializedConsolidationCheckpointEntry(input)) {
    return serializeConsolidationCheckpointEntry(
      deserializeConsolidationCheckpointEntryFromSerializedEntry(input, label),
    );
  }

  if (!isPlainObject(input)) {
    return normalizeStoredConsolidationCheckpointEntry(input, label);
  }

  if ("entry" in input) {
    const normalizedEntry = serializeConsolidationCheckpointEntry(input.entry);

    if (!("value" in input)) {
      return normalizedEntry;
    }

    const normalizedValueEntry = normalizeStoredConsolidationCheckpointEntry(
      input.value,
      typeof input.key === "string" && input.key.length > 0 ? input.key : label,
    );

    if (normalizedValueEntry === null) {
      return normalizedEntry;
    }

    if (
      !areOldGenerationSnapshotValuesEqual(normalizedValueEntry, normalizedEntry)
    ) {
      throw new Error(
        `${label}.entry must match the serialized durable value returned by storage.`,
      );
    }

    return normalizedEntry;
  }

  if ("value" in input) {
    return normalizeStoredConsolidationCheckpointEntry(
      input.value,
      typeof input.key === "string" && input.key.length > 0 ? input.key : label,
    );
  }

  return null;
};

export const deserializeConsolidationCheckpointEntry = (entry) => {
  const normalizedEntry = normalizeConsolidationCheckpointStoredEntrySource(
    entry,
    "Consolidation checkpoint entry",
  );

  if (normalizedEntry === null) {
    throw new Error(
      "Consolidation checkpoint entry must be a serialized checkpoint entry, storage record, storage read result, or storage value.",
    );
  }

  return deserializeConsolidationCheckpointEntryFromSerializedEntry(
    normalizedEntry,
  );
};

const normalizeConsolidationCheckpointKeyPrefix = (value, label) => {
  if (value === undefined || value === null) {
    return DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedSegments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (normalizedSegments.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedSegments.join("/");
};

const createEncodedConsolidationCheckpointSegment = (value, label) =>
  encodeURIComponent(normalizeRequiredString(value, label));

export const createConsolidationCheckpointRecordName = (input) => {
  const scope = normalizeConsolidationCheckpointScope(
    input,
    "Consolidation checkpoint record name input",
  );

  return `${createEncodedConsolidationCheckpointSegment(
    scope.syncSource,
    "Consolidation checkpoint record name syncSource",
  )}--${createEncodedConsolidationCheckpointSegment(
    scope.streamId,
    "Consolidation checkpoint record name streamId",
  )}.json`;
};

export const createConsolidationCheckpointKey = (input, options = {}) => {
  const scope = normalizeConsolidationCheckpointScope(
    input,
    "Consolidation checkpoint key input",
  );
  const keyPrefix = normalizeConsolidationCheckpointKeyPrefix(
    options?.keyPrefix,
    "Consolidation checkpoint key prefix",
  );

  return `${keyPrefix}/${createEncodedConsolidationCheckpointSegment(
    scope.agentId,
    "Consolidation checkpoint key agentId",
  )}/${createConsolidationCheckpointRecordName(scope)}`;
};

const serializeConsolidationCheckpointStorageValue = (entry) =>
  `${JSON.stringify(entry, null, 2)}\n`;

const createConsolidationCheckpointStorageRecordDescriptor = ({
  key,
  keyPrefix,
  recordName,
  agentId,
  syncSource,
  streamId,
}) =>
  freezeDeep({
    key: normalizeRequiredString(
      key,
      "Consolidation checkpoint storage descriptor.key",
    ),
    keyPrefix: normalizeRequiredString(
      keyPrefix,
      "Consolidation checkpoint storage descriptor.keyPrefix",
    ),
    recordName: normalizeRequiredString(
      recordName,
      "Consolidation checkpoint storage descriptor.recordName",
    ),
    agentId: normalizeRequiredString(
      agentId,
      "Consolidation checkpoint storage descriptor.agentId",
    ),
    syncSource: normalizeRequiredString(
      syncSource,
      "Consolidation checkpoint storage descriptor.syncSource",
    ),
    streamId: normalizeRequiredString(
      streamId,
      "Consolidation checkpoint storage descriptor.streamId",
    ),
  });

const assertConsolidationCheckpointScopeMatchesDescriptor = (
  entry,
  descriptor,
  label,
) => {
  const entryScope = normalizeConsolidationCheckpointScope(
    entry.checkpoint,
    `${label}.checkpoint`,
  );

  for (const field of ["agentId", "syncSource", "streamId"]) {
    if (entryScope[field] !== descriptor[field]) {
      throw new Error(
        `${label}.checkpoint.${field} must match the storage descriptor ${field}.`,
      );
    }
  }
};

const createConsolidationCheckpointStorageRecord = ({
  key,
  keyPrefix,
  recordName,
  agentId,
  syncSource,
  streamId,
  contentType,
  value,
  entry,
}) => {
  if (contentType !== "application/json") {
    throw new TypeError(
      'Consolidation checkpoint storage record.contentType must be "application/json".',
    );
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      "Consolidation checkpoint storage record.value must be a non-empty string.",
    );
  }

  const storageRecord = freezeDeep({
    ...createConsolidationCheckpointStorageRecordDescriptor({
      key,
      keyPrefix,
      recordName,
      agentId,
      syncSource,
      streamId,
    }),
    contentType,
    value,
    entry: serializeConsolidationCheckpointEntry(entry),
  });

  assertConsolidationCheckpointScopeMatchesDescriptor(
    storageRecord.entry,
    storageRecord,
    "Consolidation checkpoint storage record",
  );

  return storageRecord;
};

const assertConsolidationCheckpointStorageRecordMatchesEntry = (
  record,
  label,
) => {
  const expectedRecordName = createConsolidationCheckpointRecordName(
    record.entry.checkpoint,
  );
  const expectedKey = createConsolidationCheckpointKey(
    record.entry.checkpoint,
    { keyPrefix: record.keyPrefix },
  );
  const expectedValue = serializeConsolidationCheckpointStorageValue(record.entry);

  if (record.recordName !== expectedRecordName) {
    throw new Error(
      `${label}.recordName must match the canonical checkpoint record name.`,
    );
  }

  if (record.key !== expectedKey) {
    throw new Error(`${label}.key must match the canonical checkpoint key.`);
  }

  assertConsolidationCheckpointScopeMatchesDescriptor(
    record.entry,
    record,
    label,
  );

  if (record.value !== expectedValue) {
    throw new Error(
      `${label}.value must match the canonical serialized checkpoint JSON.`,
    );
  }
};

const createConsolidationCheckpointStoredIdentity = (entry) =>
  freezeDeep(
    normalizeConsolidationCheckpointScope(
      entry.checkpoint,
      "Consolidation checkpoint write integrity entry",
    ),
  );

const normalizeConsolidationCheckpointStoredIdentity = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeConsolidationCheckpointScope(value, label);
};

const normalizeConsolidationCheckpointStorageWriteIntegrity = (
  integrity,
  label = "Consolidation checkpoint storage.write(request).integrity",
) => {
  if (integrity === undefined || integrity === null) {
    return null;
  }

  if (!isPlainObject(integrity)) {
    throw new TypeError(`${label} must be an object when provided.`);
  }

  const mode = normalizeRequiredString(integrity.mode, `${label}.mode`);

  if (!["create", "replace", "rollback"].includes(mode)) {
    throw new TypeError(
      `${label}.mode must be "create", "replace", or "rollback".`,
    );
  }

  const expectedExistingValue =
    integrity.expectedExistingValue === undefined ||
    integrity.expectedExistingValue === null
      ? null
      : normalizeRequiredString(
          integrity.expectedExistingValue,
          `${label}.expectedExistingValue`,
        );

  return freezeDeep({
    mode,
    expectedExistingValue,
    expectedExistingIdentity: normalizeConsolidationCheckpointStoredIdentity(
      integrity.expectedExistingIdentity,
      `${label}.expectedExistingIdentity`,
    ),
    nextIdentity: normalizeConsolidationCheckpointScope(
      integrity.nextIdentity,
      `${label}.nextIdentity`,
    ),
  });
};

const createConsolidationCheckpointWriteIntegrity = ({
  mode,
  existingEntry,
  nextEntry,
}) =>
  freezeDeep({
    mode,
    expectedExistingValue:
      existingEntry === null
        ? null
        : serializeConsolidationCheckpointStorageValue(existingEntry),
    expectedExistingIdentity:
      existingEntry === null
        ? null
        : createConsolidationCheckpointStoredIdentity(existingEntry),
    nextIdentity: createConsolidationCheckpointStoredIdentity(nextEntry),
  });

const normalizeConsolidationCheckpointStorageWriteRequest = (
  request,
  label = "Consolidation checkpoint storage.write(request)",
) => {
  if (!isPlainObject(request)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const storageRecord = createConsolidationCheckpointStorageRecord(request);
  assertConsolidationCheckpointStorageRecordMatchesEntry(storageRecord, label);

  return {
    ...request,
    ...storageRecord,
    overwrite: request.overwrite === true,
    integrity: normalizeConsolidationCheckpointStorageWriteIntegrity(
      request.integrity,
      `${label}.integrity`,
    ),
  };
};

const normalizeConsolidationCheckpointStorageAdapter = (storage) => {
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    throw new TypeError(
      "Consolidation checkpoint storage must be an object with read(request) and write(request) methods.",
    );
  }

  if (typeof storage.read !== "function") {
    throw new TypeError(
      "Consolidation checkpoint storage.read must be a function.",
    );
  }

  if (typeof storage.write !== "function") {
    throw new TypeError(
      "Consolidation checkpoint storage.write must be a function.",
    );
  }

  return {
    ...storage,
    read(request) {
      return storage.read.call(storage, request);
    },
    write(request) {
      return storage.write.call(
        storage,
        normalizeConsolidationCheckpointStorageWriteRequest(request),
      );
    },
  };
};

const resolveConsolidationCheckpointStorageAdapter = (
  options,
  label = "Consolidation checkpoint persistence input",
) => {
  const hasStorage = Object.hasOwn(options, "storage");
  const hasStorageAdapter = Object.hasOwn(options, "storageAdapter");

  if (!hasStorage && !hasStorageAdapter) {
    throw new TypeError(`${label} must include storage or storageAdapter.`);
  }

  if (
    hasStorage &&
    hasStorageAdapter &&
    options.storage !== options.storageAdapter
  ) {
    throw new TypeError(
      `${label}.storage and ${label}.storageAdapter must reference the same adapter when both are provided.`,
    );
  }

  return normalizeConsolidationCheckpointStorageAdapter(
    hasStorageAdapter ? options.storageAdapter : options.storage,
  );
};

const CONSOLIDATION_CHECKPOINT_INCOMPLETE_STATUSES = new Set([
  "aborted",
  "blocked",
  "blocked-by-schedule",
  "completed-with-blocked-work-units",
  "completed-with-errors",
  "deferred",
  "error",
  "failed",
  "partial",
  "rejected",
  "skipped",
]);

const normalizeConsolidationCheckpointCompletion = (
  value,
  label = "Consolidation checkpoint completion",
) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return freezeDeep({
      status: normalizeRequiredString(value, `${label}.status`),
      details: freezeDeep({
        status: normalizeRequiredString(value, `${label}.status`),
      }),
    });
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a string or object.`);
  }

  return freezeDeep({
    status: normalizeRequiredString(value.status, `${label}.status`),
    details: cloneValueDeep(value),
  });
};

const findConsolidationCheckpointIncompleteMarker = (
  value,
  path = "completion",
) => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const marker = findConsolidationCheckpointIncompleteMarker(
        value[index],
        `${path}[${index}]`,
      );

      if (marker !== null) {
        return marker;
      }
    }

    return null;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  if (
    typeof value.failedCount === "number" &&
    Number.isFinite(value.failedCount) &&
    value.failedCount > 0
  ) {
    return freezeDeep({
      field: `${path}.failedCount`,
      reason: "failed",
    });
  }

  if (
    typeof value.blockedCount === "number" &&
    Number.isFinite(value.blockedCount) &&
    value.blockedCount > 0
  ) {
    return freezeDeep({
      field: `${path}.blockedCount`,
      reason: "blocked",
    });
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      (key === "status" || key.endsWith("Status")) &&
      typeof nestedValue === "string" &&
      CONSOLIDATION_CHECKPOINT_INCOMPLETE_STATUSES.has(
        nestedValue.trim().toLowerCase(),
      )
    ) {
      return freezeDeep({
        field: `${path}.${key}`,
        reason: nestedValue,
      });
    }

    const nestedMarker = findConsolidationCheckpointIncompleteMarker(
      nestedValue,
      `${path}.${key}`,
    );

    if (nestedMarker !== null) {
      return nestedMarker;
    }
  }

  return null;
};

const evaluateConsolidationCheckpointCompletion = (completion) => {
  const normalizedCompletion =
    normalizeConsolidationCheckpointCompletion(completion);

  if (normalizedCompletion === null) {
    return freezeDeep({
      provided: false,
      status: null,
      completed: true,
      deferredField: null,
      deferredReason: null,
    });
  }

  if (normalizedCompletion.status !== "completed") {
    return freezeDeep({
      provided: true,
      status: normalizedCompletion.status,
      completed: false,
      deferredField: "completion.status",
      deferredReason: normalizedCompletion.status,
    });
  }

  const incompleteMarker = findConsolidationCheckpointIncompleteMarker(
    normalizedCompletion.details,
  );

  if (incompleteMarker !== null) {
    return freezeDeep({
      provided: true,
      status: normalizedCompletion.status,
      completed: false,
      deferredField: incompleteMarker.field,
      deferredReason: incompleteMarker.reason,
    });
  }

  return freezeDeep({
    provided: true,
    status: normalizedCompletion.status,
    completed: true,
    deferredField: null,
    deferredReason: null,
  });
};

const normalizeConsolidationCheckpointStorageReadResult = (
  value,
  request,
  label,
) => {
  if (
    !isPlainObject(value) ||
    (!("found" in value) && !("value" in value))
  ) {
    return freezeDeep({
      ...request,
      found: value !== undefined && value !== null,
      value,
    });
  }

  const readResult = freezeDeep({
    ...createConsolidationCheckpointStorageRecordDescriptor({
      key: value.key,
      keyPrefix: value.keyPrefix,
      recordName: value.recordName,
      agentId: value.agentId,
      syncSource: value.syncSource,
      streamId: value.streamId,
    }),
    found: value.found === true,
    value: value.value,
  });

  for (const field of [
    "key",
    "keyPrefix",
    "recordName",
    "agentId",
    "syncSource",
    "streamId",
  ]) {
    if (readResult[field] !== request[field]) {
      throw new Error(`${label}.${field} must match the read request ${field}.`);
    }
  }

  return readResult;
};

const readStoredConsolidationCheckpointSnapshot = async (storage, request) => {
  const readResult = normalizeConsolidationCheckpointStorageReadResult(
    await Promise.resolve(storage.read(request)),
    request,
    `Consolidation checkpoint storage.read({ key: "${request.key}" }) result`,
  );
  const rawValue = readResult.value;

  try {
    const entry = normalizeStoredConsolidationCheckpointEntry(rawValue, request.key);

    if (entry !== null) {
      assertConsolidationCheckpointScopeMatchesDescriptor(
        entry,
        request,
        `Stored consolidation checkpoint at key "${request.key}"`,
      );
    }

    return {
      found: readResult.found,
      rawValue,
      entry,
      validationError: null,
    };
  } catch (error) {
    return {
      found: readResult.found,
      rawValue,
      entry: null,
      validationError: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

const verifyConsolidationCheckpointWrite = async (
  storage,
  { descriptor, entry, operationLabel },
) => {
  const storedSnapshot = await readStoredConsolidationCheckpointSnapshot(
    storage,
    descriptor,
  );

  if (storedSnapshot.validationError !== null) {
    throw storedSnapshot.validationError;
  }

  if (storedSnapshot.entry === null) {
    throw new Error(
      `${operationLabel} did not persist any checkpoint at key "${descriptor.key}".`,
    );
  }

  if (!areOldGenerationSnapshotValuesEqual(storedSnapshot.entry, entry)) {
    throw new Error(
      `${operationLabel} persisted unexpected checkpoint content at key "${descriptor.key}".`,
    );
  }
};

const assertConsolidationCheckpointDoesNotRegress = (
  existingEntry,
  nextEntry,
  label,
) => {
  const existingCheckpoint = existingEntry.checkpoint;
  const nextCheckpoint = nextEntry.checkpoint;

  const existingScope = normalizeConsolidationCheckpointScope(
    existingCheckpoint,
    `${label}.existing`,
  );
  const nextScope = normalizeConsolidationCheckpointScope(
    nextCheckpoint,
    `${label}.next`,
  );

  for (const field of ["agentId", "syncSource", "streamId"]) {
    if (existingScope[field] !== nextScope[field]) {
      throw new Error(
        `${label} must preserve canonical ${field} when updating a checkpoint.`,
      );
    }
  }

  if (
    existingCheckpoint.cursor.sequence !== null &&
    nextCheckpoint.cursor.sequence !== null &&
    nextCheckpoint.cursor.sequence < existingCheckpoint.cursor.sequence
  ) {
    throw new Error(
      `${label} must not move checkpoint sequence backward from ${existingCheckpoint.cursor.sequence} to ${nextCheckpoint.cursor.sequence}.`,
    );
  }

  if (
    existingCheckpoint.cursor.watermark !== null &&
    nextCheckpoint.cursor.watermark !== null &&
    new Date(nextCheckpoint.cursor.watermark).getTime() <
      new Date(existingCheckpoint.cursor.watermark).getTime()
  ) {
    throw new Error(
      `${label} must not move checkpoint watermark backward from "${existingCheckpoint.cursor.watermark}" to "${nextCheckpoint.cursor.watermark}".`,
    );
  }
};

const rollbackConsolidationCheckpointOverwrite = async (
  storage,
  { keyPrefix, previousEntry, failedRawValue },
) => {
  const previousRecord = serializeConsolidationCheckpointStorageRecord(
    previousEntry,
    { keyPrefix },
  );

  await Promise.resolve(
    storage.write({
      ...previousRecord,
      overwrite: true,
      integrity: freezeDeep({
        mode: "rollback",
        expectedExistingValue:
          failedRawValue === undefined || failedRawValue === null
            ? null
            : typeof failedRawValue === "string"
              ? failedRawValue
              : JSON.stringify(failedRawValue),
        expectedExistingIdentity: null,
        nextIdentity: createConsolidationCheckpointStoredIdentity(previousEntry),
      }),
    }),
  );

  await verifyConsolidationCheckpointWrite(storage, {
    descriptor: createConsolidationCheckpointStorageRecordDescriptor(previousRecord),
    entry: previousRecord.entry,
    operationLabel: "Consolidation checkpoint rollback",
  });
};

export const serializeConsolidationCheckpointStorageRecord = (
  input,
  options = {},
) => {
  const entry = serializeConsolidationCheckpointEntry(input);
  const keyPrefix = normalizeConsolidationCheckpointKeyPrefix(
    options?.keyPrefix,
    "Consolidation checkpoint storage record keyPrefix",
  );
  const descriptorScope = normalizeConsolidationCheckpointScope(
    entry.checkpoint,
    "Consolidation checkpoint storage record input",
  );
  const recordName = createConsolidationCheckpointRecordName(entry.checkpoint);
  const key = `${keyPrefix}/${createEncodedConsolidationCheckpointSegment(
    descriptorScope.agentId,
    "Consolidation checkpoint storage record agentId",
  )}/${recordName}`;

  return createConsolidationCheckpointStorageRecord({
    key,
    keyPrefix,
    recordName,
    agentId: descriptorScope.agentId,
    syncSource: descriptorScope.syncSource,
    streamId: descriptorScope.streamId,
    contentType: "application/json",
    value: serializeConsolidationCheckpointStorageValue(entry),
    entry,
  });
};

export const persistConsolidationCheckpoint = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Consolidation checkpoint persistence input must be an object.");
  }

  const completion = evaluateConsolidationCheckpointCompletion(options.completion);
  const storage = resolveConsolidationCheckpointStorageAdapter(options);
  const storageRecord = serializeConsolidationCheckpointStorageRecord(
    options.entry,
    { keyPrefix: options.keyPrefix },
  );
  const descriptor = createConsolidationCheckpointStorageRecordDescriptor(
    storageRecord,
  );
  const entry = storageRecord.entry;
  const serializedEntry = storageRecord.value;
  const baseResult = {
    agentId: descriptor.agentId,
    syncSource: descriptor.syncSource,
    streamId: descriptor.streamId,
    keyPrefix: descriptor.keyPrefix,
    key: descriptor.key,
    recordName: descriptor.recordName,
    completionStatus: completion.status,
    completionDeferredField: completion.deferredField,
    completionDeferredReason: completion.deferredReason,
    entry,
    serializedEntry,
  };
  const existingSnapshot = await readStoredConsolidationCheckpointSnapshot(
    storage,
    descriptor,
  );

  if (existingSnapshot.validationError !== null) {
    throw existingSnapshot.validationError;
  }

  const existingEntry = existingSnapshot.entry;

  if (!completion.completed) {
    return freezeDeep({
      ...baseResult,
      status: "deferred",
      applied: false,
      overwritten: false,
      checkpointAdvanced: false,
    });
  }

  if (existingEntry !== null) {
    assertConsolidationCheckpointDoesNotRegress(
      existingEntry,
      entry,
      "Consolidation checkpoint persistence",
    );

    if (areOldGenerationSnapshotValuesEqual(existingEntry, entry)) {
      return freezeDeep({
        ...baseResult,
        status: "unchanged",
        applied: false,
        overwritten: false,
        checkpointAdvanced: false,
      });
    }
  }

  try {
    await Promise.resolve(
      storage.write({
        ...storageRecord,
        overwrite: existingEntry !== null,
        integrity: createConsolidationCheckpointWriteIntegrity({
          mode: existingEntry === null ? "create" : "replace",
          existingEntry,
          nextEntry: entry,
        }),
      }),
    );

    await verifyConsolidationCheckpointWrite(storage, {
      descriptor,
      entry,
      operationLabel:
        existingEntry === null
          ? "Consolidation checkpoint create"
          : "Consolidation checkpoint overwrite",
    });
  } catch (error) {
    if (existingEntry === null) {
      throw error;
    }

    const writeFailureReason =
      error instanceof Error ? error.message : String(error);
    const failedSnapshot = await readStoredConsolidationCheckpointSnapshot(
      storage,
      descriptor,
    );

    try {
      await rollbackConsolidationCheckpointOverwrite(storage, {
        keyPrefix: descriptor.keyPrefix,
        previousEntry: existingEntry,
        failedRawValue: failedSnapshot.rawValue,
      });
    } catch (rollbackError) {
      const rollbackFailureReason =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `Consolidation checkpoint overwrite failed integrity validation and rollback failed. Write failure: ${writeFailureReason}. Rollback failure: ${rollbackFailureReason}`,
      );
    }

    throw new Error(
      `Consolidation checkpoint overwrite failed integrity validation. The previous checkpoint was restored. ${writeFailureReason}`,
    );
  }

  return freezeDeep({
    ...baseResult,
    status: existingEntry === null ? "created" : "overwritten",
    applied: true,
    overwritten: existingEntry !== null,
    checkpointAdvanced: true,
  });
};

export const persistCompletedConsolidationCheckpoint = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "Completed consolidation checkpoint persistence input must be an object.",
    );
  }

  if (!Object.hasOwn(options, "completion")) {
    throw new TypeError(
      "Completed consolidation checkpoint persistence input must include completion.",
    );
  }

  return persistConsolidationCheckpoint(options);
};

export const readConsolidationCheckpoint = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Consolidation checkpoint read input must be an object.");
  }

  const storage = resolveConsolidationCheckpointStorageAdapter(
    options,
    "Consolidation checkpoint read input",
  );
  const scope = normalizeConsolidationCheckpointScope(
    options,
    "Consolidation checkpoint read input",
  );
  const keyPrefix = normalizeConsolidationCheckpointKeyPrefix(
    options.keyPrefix,
    "Consolidation checkpoint read input.keyPrefix",
  );
  const recordName = createConsolidationCheckpointRecordName(scope);
  const descriptor = createConsolidationCheckpointStorageRecordDescriptor({
    key: `${keyPrefix}/${createEncodedConsolidationCheckpointSegment(
      scope.agentId,
      "Consolidation checkpoint read input.agentId",
    )}/${recordName}`,
    keyPrefix,
    recordName,
    agentId: scope.agentId,
    syncSource: scope.syncSource,
    streamId: scope.streamId,
  });
  const snapshot = await readStoredConsolidationCheckpointSnapshot(
    storage,
    descriptor,
  );

  if (snapshot.validationError !== null) {
    throw snapshot.validationError;
  }

  return freezeDeep({
    ...descriptor,
    found: snapshot.entry !== null,
    entry: snapshot.entry,
    serializedEntry:
      snapshot.entry === null
        ? null
        : serializeConsolidationCheckpointStorageValue(snapshot.entry),
    checkpoint:
      snapshot.entry === null
        ? null
        : deserializeConsolidationCheckpointEntryFromSerializedEntry(
            snapshot.entry,
            "Consolidation checkpoint read result.entry",
          ),
  });
};

export const resolveConsolidationRpcChangeWindow = async (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("Consolidation RPC change window input must be an object.");
  }

  const scope = normalizeConsolidationCheckpointScope(
    options,
    "Consolidation RPC change window input",
  );
  const endInclusive = normalizeConsolidationCheckpointCursor(
    options.latestCursor,
    "Consolidation RPC change window input.latestCursor",
  );

  if (endInclusive.streamId !== scope.streamId) {
    throw new Error(
      "Consolidation RPC change window input.latestCursor.streamId must match the requested streamId.",
    );
  }

  const checkpointResult = await readConsolidationCheckpoint({
    ...options,
    agentId: scope.agentId,
    syncSource: scope.syncSource,
    streamId: scope.streamId,
  });
  const startExclusive = checkpointResult.checkpoint?.cursor ?? null;

  if (
    startExclusive !== null &&
    startExclusive.sequence !== null &&
    endInclusive.sequence !== null &&
    endInclusive.sequence < startExclusive.sequence
  ) {
    throw new Error(
      `Consolidation RPC change window must not move the end sequence backward from ${startExclusive.sequence} to ${endInclusive.sequence}.`,
    );
  }

  if (
    startExclusive !== null &&
    startExclusive.watermark !== null &&
    endInclusive.watermark !== null &&
    new Date(endInclusive.watermark).getTime() <
      new Date(startExclusive.watermark).getTime()
  ) {
    throw new Error(
      `Consolidation RPC change window must not move the end watermark backward from "${startExclusive.watermark}" to "${endInclusive.watermark}".`,
    );
  }

  return freezeDeep({
    key: checkpointResult.key,
    keyPrefix: checkpointResult.keyPrefix,
    recordName: checkpointResult.recordName,
    agentId: checkpointResult.agentId,
    syncSource: checkpointResult.syncSource,
    streamId: checkpointResult.streamId,
    checkpointFound: checkpointResult.found,
    checkpoint: checkpointResult.checkpoint,
    derivation:
      checkpointResult.checkpoint === null
        ? "bootstrap-from-stream-origin"
        : "resume-from-checkpoint",
    window: {
      startExclusive,
      endInclusive,
    },
  });
};

export const createArchivedMemory = (input) => {
  const originalMemoryId = normalizeMemoryItemStableId(
    input.originalMemoryId,
    "Archived memory originalMemoryId",
  );
  const snapshot = cloneObject(input.snapshot);
  const archivedMemory = freezeDeep({
    nodeId:
      input.nodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.archivedMemory,
        input.agentId,
        input.archiveId,
      ),
    archiveId: input.archiveId,
    agentId: input.agentId,
    originalGeneration: input.originalGeneration,
    originalMemoryKind: input.originalMemoryKind,
    originalMemoryId,
    originalNodeId: normalizeNullableString(input.originalNodeId),
    originalProvenance:
      "originalProvenance" in input
        ? normalizeOptionalClonedObject(input.originalProvenance)
        : deriveArchivedMemoryOriginalProvenance(input.originalGeneration, snapshot),
    archivalReason: input.archivalReason,
    archivedAt: input.archivedAt,
    lastRestoredAt: normalizeNullableString(input.lastRestoredAt),
    snapshot,
    provenance: cloneObject(input.provenance),
    temporalContext: createOldGenerationTemporalContext(input.temporalContext, {
      firstObservedAt: input.archivedAt,
      lastObservedAt: input.archivedAt,
      consolidatedAt: input.archivedAt,
    }),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status: "preserved",
        lastOperation: "preserve",
      },
    ),
  });
  assertOldGenerationNodeId({
    nodeId: archivedMemory.nodeId,
    agentId: archivedMemory.agentId,
    nodeKind: MEMORY_NODE_KINDS.archivedMemory,
    localId: archivedMemory.archiveId,
    entityLabel: `Old-generation archived memory "${archivedMemory.archiveId}"`,
  });
  assertArchivedMemoryShape(archivedMemory);
  return archivedMemory;
};

export const createMemoryEvidence = (input) => {
  assertMemoryEvidenceKind(input.kind);
  const evidence = freezeDeep({
    nodeId:
      input.nodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.memoryEvidence,
        input.agentId,
        input.evidenceId,
      ),
    evidenceId: input.evidenceId,
    agentId: input.agentId,
    kind: input.kind,
    source: input.source,
    observedAt: input.observedAt,
    detail: input.detail,
    reference: input.reference ?? null,
    provenance: cloneObject(input.provenance),
    temporalContext: createOldGenerationTemporalContext(input.temporalContext, {
      firstObservedAt: input.observedAt,
      lastObservedAt: input.observedAt,
    }),
    salience: createOldGenerationSalience(input.salience),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status: "preserved",
      },
    ),
  });
  assertOldGenerationNodeId({
    nodeId: evidence.nodeId,
    agentId: evidence.agentId,
    nodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    localId: evidence.evidenceId,
    entityLabel: `Old-generation memory evidence "${evidence.evidenceId}"`,
  });
  return evidence;
};

export const createConsolidationRecord = (input) => {
  assertConsolidationOperation(input.operation);
  const record = freezeDeep({
    nodeId:
      input.nodeId ??
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.consolidationRecord,
        input.agentId,
        input.recordId,
      ),
    recordId: input.recordId,
    agentId: input.agentId,
    operation: input.operation,
    runtimePhase: input.runtimePhase,
    consolidatedAt: input.consolidatedAt,
    sourceMemoryIds: cloneArray(input.sourceMemoryIds),
    policyVersion: input.policyVersion,
    preservedIdentityFields: cloneArray(input.preservedIdentityFields),
    provenance: cloneObject(input.provenance),
    temporalContext: createOldGenerationTemporalContext(input.temporalContext, {
      consolidatedAt: input.consolidatedAt,
      firstObservedAt: input.consolidatedAt,
      lastObservedAt: input.consolidatedAt,
    }),
    salience: createOldGenerationSalience(input.salience),
    consolidationState: createOldGenerationConsolidationState(
      input.consolidationState,
      {
        status:
          input.operation === "reinforce"
            ? "reinforced"
            : input.operation === "supersede"
              ? "superseded"
              : input.operation === "preserve"
                ? "preserved"
                : "promoted",
        lastOperation: input.operation,
        journalRecordId: input.recordId,
        policyVersion: input.policyVersion,
        sourceMemoryIds: input.sourceMemoryIds,
        preservedIdentityFields: input.preservedIdentityFields,
      },
    ),
  });
  assertOldGenerationNodeId({
    nodeId: record.nodeId,
    agentId: record.agentId,
    nodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    localId: record.recordId,
    entityLabel: `Old-generation consolidation record "${record.recordId}"`,
  });
  return record;
};

const deriveMaskedOriginalContentFromRecord = (record) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      value: null,
      sourceField: null,
    };
  }

  const sourceField =
    YOUNG_GENERATION_MASKABLE_CONTENT_FIELDS.find(
      (fieldName) => typeof record[fieldName] === "string",
    ) ?? null;

  return {
    value: sourceField ? record[sourceField] : null,
    sourceField,
  };
};

const normalizeOptionalClonedObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const clonedValue = cloneObject(value);
  return Object.keys(clonedValue).length > 0 ? clonedValue : null;
};

const createYoungGenerationMaskedOriginalContent = (input = null, record = null, fallback = {}) => {
  const normalizedInput =
    typeof input === "string"
      ? { value: input }
      : input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
  const normalizedFallback =
    fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const derivedContent = deriveMaskedOriginalContentFromRecord(record);
  const value = normalizeNullableString(normalizedInput.value ?? derivedContent.value);
  const sourceField = normalizeNullableString(
    normalizedInput.sourceField ?? derivedContent.sourceField,
  );
  const capturedAt = normalizeNullableString(
    normalizedInput.capturedAt ?? normalizedFallback.capturedAt,
  );

  if (value === null && sourceField === null && capturedAt === null) {
    return null;
  }

  return freezeDeep({
    value,
    sourceField,
    capturedAt,
  });
};

const createYoungGenerationMaskingAudit = (input = null, fallback = {}) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalizedFallback =
    fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const metadata = normalizeOptionalClonedObject(
    normalizedInput.metadata ?? normalizedFallback.metadata,
  );
  const audit = {
    auditRecordId: normalizeNullableString(
      normalizedInput.auditRecordId ?? normalizedFallback.auditRecordId,
    ),
    policyVersion: normalizeNullableString(
      normalizedInput.policyVersion ?? normalizedFallback.policyVersion,
    ),
    runtimePhase: normalizeNullableString(
      normalizedInput.runtimePhase ?? normalizedFallback.runtimePhase,
    ),
    sourceEvaluationAt: normalizeNullableString(
      normalizedInput.sourceEvaluationAt ?? normalizedFallback.sourceEvaluationAt,
    ),
    sourceEvaluationMode: normalizeNullableString(
      normalizedInput.sourceEvaluationMode ?? normalizedFallback.sourceEvaluationMode,
    ),
    recordedAt: normalizeNullableString(
      normalizedInput.recordedAt ?? normalizedFallback.recordedAt,
    ),
    actor: normalizeNullableString(normalizedInput.actor ?? normalizedFallback.actor),
    metadata,
  };

  if (Object.values(audit).every((value) => value === null)) {
    return null;
  }

  return freezeDeep(audit);
};

export const createYoungGenerationMaskingMetadata = (
  input = {},
  inactiveForRetrieval = false,
  record = null,
) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const isMasked = Boolean(normalizedInput.isMasked) || inactiveForRetrieval;
  const provenance =
    "provenance" in normalizedInput &&
    normalizedInput.provenance !== null &&
    normalizedInput.provenance !== undefined
      ? cloneObject(normalizedInput.provenance)
      : null;
  const maskedAt = normalizeNullableString(normalizedInput.maskedAt);
  const maskedBy = normalizeNullableString(normalizedInput.maskedBy);
  const maskUpdatedAt = normalizeNullableString(
    normalizedInput.maskUpdatedAt ?? normalizedInput.maskedAt,
  );
  const maskCapturedAt = maskUpdatedAt ?? maskedAt;

  return freezeDeep({
    isMasked,
    maskedAt,
    unmaskedAt: normalizeNullableString(normalizedInput.unmaskedAt),
    maskUpdatedAt,
    maskedBy,
    reason: normalizeNullableString(normalizedInput.reason),
    maskedOriginalContent: createYoungGenerationMaskedOriginalContent(
      normalizedInput.maskedOriginalContent,
      isMasked ? record : null,
      isMasked
        ? {
            capturedAt: maskCapturedAt,
          }
        : null,
    ),
    audit: createYoungGenerationMaskingAudit(normalizedInput.audit, {
      auditRecordId: provenance?.auditRecordId,
      policyVersion: provenance?.policyVersion,
      runtimePhase: provenance?.runtimePhase,
      sourceEvaluationAt: provenance?.sourceEvaluationAt,
      sourceEvaluationMode: provenance?.sourceEvaluationMode,
      recordedAt: maskCapturedAt ?? provenance?.recordedAt,
      actor: maskedBy ?? provenance?.actor,
      metadata: provenance,
    }),
    provenance,
  });
};

const createYoungGenerationArchiveLinkage = (input = null) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const archiveId = normalizeNullableString(normalizedInput.archiveId);
  const archiveNodeId = normalizeNullableString(normalizedInput.archiveNodeId);
  const archivedAt = normalizeNullableString(normalizedInput.archivedAt);

  if (archiveId === null && archiveNodeId === null && archivedAt === null) {
    return null;
  }

  return freezeDeep({
    archiveId,
    archiveNodeId,
    archivedAt,
  });
};

const createYoungGenerationMemoryLifecycle = (
  input = null,
  inactiveForRetrieval = false,
  masking = null,
) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const requestedState = normalizeNullableString(normalizedInput.state);

  if (
    requestedState !== null &&
    !YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES.includes(requestedState)
  ) {
    throw new TypeError(
      `young-generation lifecycle state must be one of ${YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES.join(", ")}`,
    );
  }

  const archiveLinkage = createYoungGenerationArchiveLinkage(
    normalizedInput.archiveLinkage,
  );
  const state = archiveLinkage
    ? "archived"
    : requestedState === "archived"
      ? "archived"
      : requestedState === "inactive" || inactiveForRetrieval || masking?.isMasked
        ? "inactive"
        : "active";
  const inactiveAt =
    state === "active"
      ? null
      : normalizeNullableString(normalizedInput.inactiveAt) ??
        archiveLinkage?.archivedAt ??
        masking?.maskUpdatedAt ??
        masking?.maskedAt ??
        null;
  const inactiveReason =
    state === "active"
      ? null
      : normalizeNullableString(normalizedInput.inactiveReason) ??
        (state === "archived"
          ? DEFAULT_YOUNG_GENERATION_ARCHIVED_INACTIVE_REASON
          : masking?.reason ?? null);

  return freezeDeep({
    state,
    inactiveAt,
    inactiveReason,
    archiveLinkage,
  });
};

export const createYoungGenerationMemory = (input) => {
  const normalizedInput =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const envelopeInput = isYoungGenerationMemoryEnvelope(normalizedInput)
    ? normalizedInput
    : {
        record: normalizedInput,
      };
  const requestedInactiveForRetrieval = Boolean(envelopeInput.inactiveForRetrieval);
  const record = cloneObject(envelopeInput.record);
  record.memoryId = normalizeMemoryItemStableId(
    record.memoryId,
    "Young-generation memory record.memoryId",
  );
  const initialMasking = createYoungGenerationMaskingMetadata(
    envelopeInput.masking,
    requestedInactiveForRetrieval,
    record,
  );
  const initialLifecycle = createYoungGenerationMemoryLifecycle(
    envelopeInput.lifecycle,
    requestedInactiveForRetrieval || initialMasking.isMasked,
    initialMasking,
  );
  const inactiveForRetrieval =
    requestedInactiveForRetrieval ||
    initialMasking.isMasked ||
    initialLifecycle.state !== "active";
  const masking =
    inactiveForRetrieval === requestedInactiveForRetrieval
      ? initialMasking
      : createYoungGenerationMaskingMetadata(
          envelopeInput.masking,
          inactiveForRetrieval,
          record,
        );
  const lifecycle = createYoungGenerationMemoryLifecycle(
    envelopeInput.lifecycle,
    inactiveForRetrieval,
    masking,
  );

  return freezeDeep({
    record,
    inactiveForRetrieval,
    masking,
    lifecycle,
  });
};

export const createImportanceIndexEntry = (input) => {
  const signals = normalizeSignals(input.signals);
  const memoryKind = normalizeRequiredString(
    input.memoryKind,
    "Importance index entry memoryKind",
  );

  if (!YOUNG_GENERATION_MEMORY_KINDS.includes(memoryKind)) {
    throw new TypeError(
      `Importance index entry memoryKind must be one of ${YOUNG_GENERATION_MEMORY_KINDS.join(", ")}`,
    );
  }

  return freezeDeep({
    entryId: normalizeRequiredString(input.entryId, "Importance index entry entryId"),
    agentId: normalizeRequiredString(input.agentId, "Importance index entry agentId"),
    memoryId: normalizeMemoryItemStableId(
      input.memoryId,
      "Importance index entry memoryId",
    ),
    memoryKind,
    signals,
    signalCount: Object.keys(signals).length,
    importanceScore: calculateImportanceScore(signals),
    lastUpdatedAt: normalizeRequiredString(
      input.lastUpdatedAt,
      "Importance index entry lastUpdatedAt",
    ),
    provenance: input.provenance ? cloneObject(input.provenance) : null,
  });
};

const assertYoungGenerationMemoryKind = (value, label) => {
  if (!YOUNG_GENERATION_MEMORY_KINDS.includes(value)) {
    throw new TypeError(
      `${label} must be one of ${YOUNG_GENERATION_MEMORY_KINDS.join(", ")}`,
    );
  }

  return value;
};

const assertConsolidationPromotionSignalPath = (value, label) => {
  const normalizedValue = normalizeRequiredString(value, label);

  if (!CONSOLIDATION_PROMOTION_SIGNAL_PATH_SET.has(normalizedValue)) {
    throw new TypeError(
      `${label} must be one of ${CONSOLIDATION_PROMOTION_SIGNAL_PATHS.join(", ")}`,
    );
  }

  return normalizedValue;
};

const normalizeConsolidationPromotionRequiredSignals = (value) => {
  const requiredSignals =
    value === undefined || value === null
      ? DEFAULT_CONSOLIDATION_PROMOTION_REQUIRED_SIGNALS
      : createUniqueStringList(
          normalizeStringList(
            value,
            "consolidation promotion requiredSignals",
          ).map((signalPath, index) =>
            assertConsolidationPromotionSignalPath(
              signalPath,
              `consolidation promotion requiredSignals[${index}]`,
            ),
          ),
        );

  if (requiredSignals.length === 0) {
    throw new TypeError(
      "consolidation promotion requiredSignals must contain at least one entry",
    );
  }

  return requiredSignals;
};

const normalizeConsolidationPromotionThresholds = (thresholds) => {
  const mergedThresholds = {
    ...DEFAULT_CONSOLIDATION_PROMOTION_THRESHOLDS,
    ...(isPlainObject(thresholds) ? thresholds : {}),
  };

  return freezeDeep({
    minimumPromotionScore: normalizeNumber(
      mergedThresholds.minimumPromotionScore,
    ),
    minimumYoungImportanceScore: normalizeNumber(
      mergedThresholds.minimumYoungImportanceScore,
    ),
    minimumYoungStabilityScore: normalizeNumber(
      mergedThresholds.minimumYoungStabilityScore,
    ),
    minimumOldImportanceScore: normalizeNumber(
      mergedThresholds.minimumOldImportanceScore,
    ),
    minimumOldStabilityScore: normalizeNumber(
      mergedThresholds.minimumOldStabilityScore,
    ),
  });
};

const normalizeConsolidationPromotionWeights = (weights) =>
  normalizeWeightRecord(
    weights,
    DEFAULT_CONSOLIDATION_PROMOTION_WEIGHTS,
    "consolidation promotion weights",
  );

const normalizeConsolidationPromotionRuntimePhases = (value) => {
  const runtimePhases =
    value === undefined || value === null
      ? RUNTIME_AUTHORIZED_IDLE_PHASES
      : normalizeLowercaseTokenList(
          value,
          "consolidation promotion allowedRuntimePhases",
        );

  if (runtimePhases.length === 0) {
    throw new TypeError(
      "consolidation promotion allowedRuntimePhases must contain at least one phase",
    );
  }

  runtimePhases.forEach((runtimePhase) => {
    if (!RUNTIME_AUTHORIZED_IDLE_PHASES.includes(runtimePhase)) {
      throw new TypeError(
        `consolidation promotion allowedRuntimePhases can only use ${RUNTIME_AUTHORIZED_IDLE_PHASES.join(", ")}`,
      );
    }
  });

  return runtimePhases;
};

const normalizeConsolidationPromotionProtectedIdentityFields = (value) =>
  createUniqueStringList([
    ...PROTECTED_IDENTITY_FIELDS,
    ...normalizeStringList(
      value,
      "consolidation promotion protectedIdentityFields",
    ),
  ]);

export const createConsolidationSignalCapture = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("consolidation signal capture must be an object");
  }

  const signals = normalizeSignals(input.signals);
  const signalCount = Object.keys(signals).length;

  if (signalCount === 0) {
    throw new TypeError(
      "consolidation signal capture must include at least one explicit signal",
    );
  }

  return freezeDeep({
    score: normalizeNumber(
      input.score === undefined || input.score === null
        ? calculateImportanceScore(signals)
        : input.score,
    ),
    signals,
    signalCount,
    capturedAt: normalizeRequiredString(
      input.capturedAt,
      "consolidation signal capturedAt",
    ),
    sourceCollection: normalizeOptionalString(
      input.sourceCollection,
      "consolidation signal sourceCollection",
    ),
    sourceRecordIds: normalizeStringList(
      input.sourceRecordIds,
      "consolidation signal sourceRecordIds",
    ),
    provenance: input.provenance ? cloneObject(input.provenance) : null,
  });
};

const createNullableConsolidationSignalCapture = (input, label) => {
  if (input === undefined || input === null) {
    return null;
  }

  try {
    return createConsolidationSignalCapture(input);
  } catch (error) {
    throw new TypeError(`${label}: ${error.message}`);
  }
};

const createConsolidationGenerationSignalSet = (input, label, options = {}) => {
  const normalizedInput = isPlainObject(input) ? input : {};
  const importance = createNullableConsolidationSignalCapture(
    normalizedInput.importance,
    `${label}.importance`,
  );
  const stability = createNullableConsolidationSignalCapture(
    normalizedInput.stability,
    `${label}.stability`,
  );

  if (options.requireImportance && importance === null) {
    throw new TypeError(`${label}.importance is required`);
  }

  if (options.requireStability && stability === null) {
    throw new TypeError(`${label}.stability is required`);
  }

  return freezeDeep({
    importance,
    stability,
  });
};

const getConsolidationPromotionSignalCapture = (candidate, signalPath) => {
  const [generation, dimension] = signalPath.split(".");
  return candidate.signals[generation]?.[dimension] ?? null;
};

const createConsolidationPromotionCriterionResult = (
  candidate,
  normalizedPolicy,
  signalPath,
) => {
  const [generation, dimension] = signalPath.split(".");
  const signalCapture = getConsolidationPromotionSignalCapture(
    candidate,
    signalPath,
  );
  const weightKey = CONSOLIDATION_PROMOTION_SIGNAL_WEIGHTS[signalPath];
  const thresholdKey = CONSOLIDATION_PROMOTION_SIGNAL_THRESHOLDS[signalPath];
  const score = signalCapture?.score ?? null;
  const threshold = normalizedPolicy.thresholds[thresholdKey];

  return freezeDeep({
    signalPath,
    generation,
    dimension,
    required: normalizedPolicy.requiredSignals.includes(signalPath),
    available: signalCapture !== null,
    score,
    threshold,
    weight: normalizedPolicy.weights[weightKey],
    meetsThreshold: score === null ? null : score >= threshold,
    signalCount: signalCapture?.signalCount ?? 0,
    capturedAt: signalCapture?.capturedAt ?? null,
    sourceCollection: signalCapture?.sourceCollection ?? null,
    sourceRecordIds: signalCapture?.sourceRecordIds ?? [],
  });
};

export const createConsolidationPromotionPolicy = (input = {}) =>
  freezeDeep({
    policyId: normalizeRequiredString(
      input.policyId ?? "default-consolidation-promotion-policy",
      "consolidation promotion policyId",
    ),
    version: normalizeRequiredString(
      input.version ?? CONSOLIDATION_PROMOTION_POLICY_SCHEMA.version,
      "consolidation promotion version",
    ),
    targetNodeKind: (() => {
      const targetNodeKind =
        input.targetNodeKind ?? MEMORY_NODE_KINDS.longTermMemory;

      if (targetNodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
        throw new TypeError(
          `consolidation promotion targetNodeKind must be ${MEMORY_NODE_KINDS.longTermMemory}`,
        );
      }

      return targetNodeKind;
    })(),
    requiresRuntimeAuthorization: (() => {
      const requiresRuntimeAuthorization =
        input.requiresRuntimeAuthorization === undefined
          ? true
          : Boolean(input.requiresRuntimeAuthorization);

      if (!requiresRuntimeAuthorization) {
        throw new TypeError(
          "consolidation promotion requiresRuntimeAuthorization must remain true",
        );
      }

      return requiresRuntimeAuthorization;
    })(),
    allowedRuntimePhases: normalizeConsolidationPromotionRuntimePhases(
      input.allowedRuntimePhases,
    ),
    inactivityHeuristicsAuthorize: (() => {
      const inactivityHeuristicsAuthorize = Boolean(
        input.inactivityHeuristicsAuthorize,
      );

      if (inactivityHeuristicsAuthorize) {
        throw new TypeError(
          "consolidation promotion inactivityHeuristicsAuthorize must remain false",
        );
      }

      return inactivityHeuristicsAuthorize;
    })(),
    teamIdleCoordinatesOnly: (() => {
      const teamIdleCoordinatesOnly =
        input.teamIdleCoordinatesOnly === undefined
          ? true
          : Boolean(input.teamIdleCoordinatesOnly);

      if (!teamIdleCoordinatesOnly) {
        throw new TypeError(
          "consolidation promotion teamIdleCoordinatesOnly must remain true",
        );
      }

      return teamIdleCoordinatesOnly;
    })(),
    allowIdentityPromotion: (() => {
      const allowIdentityPromotion = Boolean(input.allowIdentityPromotion);

      if (allowIdentityPromotion) {
        throw new TypeError(
          "consolidation promotion allowIdentityPromotion must remain false",
        );
      }

      return allowIdentityPromotion;
    })(),
    learnedTraitsTargetNodeKind: (() => {
      const learnedTraitsTargetNodeKind =
        input.learnedTraitsTargetNodeKind ?? MEMORY_NODE_KINDS.longTermMemory;

      if (learnedTraitsTargetNodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
        throw new TypeError(
          `consolidation promotion learnedTraitsTargetNodeKind must be ${MEMORY_NODE_KINDS.longTermMemory}`,
        );
      }

      return learnedTraitsTargetNodeKind;
    })(),
    protectedIdentityFields:
      normalizeConsolidationPromotionProtectedIdentityFields(
        input.protectedIdentityFields,
      ),
    requiredSignals: normalizeConsolidationPromotionRequiredSignals(
      input.requiredSignals,
    ),
    thresholds: normalizeConsolidationPromotionThresholds(input.thresholds),
    weights: normalizeConsolidationPromotionWeights(input.weights),
  });

export const DEFAULT_CONSOLIDATION_PROMOTION_POLICY =
  createConsolidationPromotionPolicy();

export const createConsolidationPromotionCandidate = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("consolidation promotion candidate must be an object");
  }

  const youngGenerationSignals = createConsolidationGenerationSignalSet(
    input.signals?.youngGeneration,
    "consolidation promotion candidate signals.youngGeneration",
    {
      requireImportance: true,
      requireStability: true,
    },
  );
  const oldGenerationSignals = createConsolidationGenerationSignalSet(
    input.signals?.oldGeneration,
    "consolidation promotion candidate signals.oldGeneration",
  );

  const candidate = freezeDeep({
    candidateId: normalizeRequiredString(
      input.candidateId,
      "consolidation promotion candidateId",
    ),
    agentId: normalizeRequiredString(
      input.agentId,
      "consolidation promotion agentId",
    ),
    sourceMemoryId: normalizeRequiredString(
      input.sourceMemoryId,
      "consolidation promotion sourceMemoryId",
    ),
    sourceMemoryKind: assertYoungGenerationMemoryKind(
      input.sourceMemoryKind,
      "consolidation promotion sourceMemoryKind",
    ),
    targetMemoryId: normalizeOptionalString(
      input.targetMemoryId,
      "consolidation promotion targetMemoryId",
    ),
    targetNodeKind: (() => {
      const targetNodeKind =
        input.targetNodeKind ?? MEMORY_NODE_KINDS.longTermMemory;

      if (targetNodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
        throw new TypeError(
          `consolidation promotion targetNodeKind must be ${MEMORY_NODE_KINDS.longTermMemory}`,
        );
      }

      return targetNodeKind;
    })(),
    learnedTraitCandidate: Boolean(input.learnedTraitCandidate),
    signals: {
      youngGeneration: youngGenerationSignals,
      oldGeneration: oldGenerationSignals,
    },
    provenance: input.provenance ? cloneObject(input.provenance) : null,
  });

  return freezeDeep({
    ...candidate,
    signalCoverage: CONSOLIDATION_PROMOTION_SIGNAL_PATHS.filter(
      (signalPath) =>
        getConsolidationPromotionSignalCapture(candidate, signalPath) !== null,
    ),
  });
};

const calculateConsolidationPromotionWeightedSignalScore = (
  candidate,
  normalizedPolicy,
) => {
  let weightedScoreTotal = 0;
  let contributingWeight = 0;

  CONSOLIDATION_PROMOTION_SIGNAL_PATHS.forEach((signalPath) => {
    const signalCapture = getConsolidationPromotionSignalCapture(
      candidate,
      signalPath,
    );
    const signalScore = signalCapture?.score ?? null;

    if (signalScore === null) {
      return;
    }

    const weightKey = CONSOLIDATION_PROMOTION_SIGNAL_WEIGHTS[signalPath];
    const weight = normalizedPolicy.weights[weightKey];

    weightedScoreTotal += signalScore * weight;
    contributingWeight += weight;
  });

  return contributingWeight === 0
    ? 0
    : Number((weightedScoreTotal / contributingWeight).toFixed(12));
};

const normalizeConsolidationPromotionPageRankEdges = (edges, candidateIdSet) => {
  if (edges === undefined || edges === null) {
    return freezeDeep([]);
  }

  if (!Array.isArray(edges)) {
    throw new TypeError("consolidation promotion PageRank edges must be an array");
  }

  return freezeDeep(
    edges.flatMap((edge, index) => {
      if (!isPlainObject(edge)) {
        throw new TypeError(
          `consolidation promotion PageRank edges[${index}] must be an object`,
        );
      }

      const from = normalizeRequiredString(
        edge.fromCandidateId,
        `consolidation promotion PageRank edges[${index}].fromCandidateId`,
      );
      const to = normalizeRequiredString(
        edge.toCandidateId,
        `consolidation promotion PageRank edges[${index}].toCandidateId`,
      );

      if (!candidateIdSet.has(from)) {
        throw new TypeError(
          `consolidation promotion PageRank edges[${index}].fromCandidateId must reference a known candidate`,
        );
      }

      if (!candidateIdSet.has(to)) {
        throw new TypeError(
          `consolidation promotion PageRank edges[${index}].toCandidateId must reference a known candidate`,
        );
      }

      const weight =
        edge.weight === undefined
          ? 1
          : normalizeNonNegativeNumber(
              edge.weight,
              `consolidation promotion PageRank edges[${index}].weight`,
            );

      if (weight === 0) {
        return [];
      }

      return [{ from, to, weight }];
    }),
  );
};

export const evaluateConsolidationPromotionPageRank = (options) => {
  if (!isPlainObject(options)) {
    throw new TypeError("consolidation promotion PageRank options must be an object");
  }

  const candidateInputs = options.candidates;

  if (!Array.isArray(candidateInputs) || candidateInputs.length === 0) {
    throw new TypeError(
      "consolidation promotion PageRank candidates must be a non-empty array",
    );
  }

  const policy = createConsolidationPromotionPolicy(options.policy);
  const candidates = candidateInputs.map((candidateInput, index) => {
    try {
      return createConsolidationPromotionCandidate(candidateInput);
    } catch (error) {
      throw new TypeError(
        `consolidation promotion PageRank candidates[${index}]: ${error.message}`,
      );
    }
  });
  const candidateIdSet = new Set();

  candidates.forEach((candidate, index) => {
    if (candidateIdSet.has(candidate.candidateId)) {
      throw new TypeError(
        `consolidation promotion PageRank candidates[${index}] candidateId must be unique`,
      );
    }

    candidateIdSet.add(candidate.candidateId);
  });

  const weightedSignalScores = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.candidateId,
      calculateConsolidationPromotionWeightedSignalScore(candidate, policy),
    ]),
  );
  const weightedSignalScoreTotal = Object.values(weightedSignalScores).reduce(
    (runningTotal, score) => runningTotal + score,
    0,
  );
  const personalization =
    weightedSignalScoreTotal > 0
      ? Object.fromEntries(
          candidates.map((candidate) => [
            candidate.candidateId,
            weightedSignalScores[candidate.candidateId] / weightedSignalScoreTotal,
          ]),
        )
      : Object.fromEntries(
          candidates.map((candidate) => [candidate.candidateId, 1 / candidates.length]),
        );
  const pageRank = evaluateWeightedPageRank({
    nodes: candidates.map((candidate) => candidate.candidateId),
    edges: normalizeConsolidationPromotionPageRankEdges(
      options.edges,
      candidateIdSet,
    ),
    dampingFactor: options.dampingFactor,
    tolerance: options.tolerance,
    maxIterations: options.maxIterations,
    personalization,
  });
  const candidateById = Object.fromEntries(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const rankedCandidates = pageRank.rankedNodeIds.map((candidateId, index) =>
    freezeDeep({
      rank: index + 1,
      candidateId,
      candidate: candidateById[candidateId],
      weightedSignalScore: weightedSignalScores[candidateId],
      personalizationScore: pageRank.personalization[candidateId],
      pageRankScore: pageRank.scores[candidateId],
    }),
  );

  return freezeDeep({
    policyId: policy.policyId,
    policyVersion: policy.version,
    dampingFactor: pageRank.dampingFactor,
    tolerance: pageRank.tolerance,
    maxIterations: pageRank.maxIterations,
    iterations: pageRank.iterations,
    converged: pageRank.converged,
    rankedCandidateIds: pageRank.rankedNodeIds,
    personalizationByCandidateId: pageRank.personalization,
    scoresByCandidateId: pageRank.scores,
    rankedCandidates,
  });
};

export const selectTopKConsolidationPromotions = (options) => {
  const ranking = evaluateConsolidationPromotionPageRank(options);
  const normalizedTopK = Object.hasOwn(options, "topK")
    ? normalizeNonNegativeInteger(options.topK, "consolidation promotion PageRank topK")
    : ranking.rankedCandidates.length;

  return freezeDeep({
    topK: normalizedTopK,
    ranking,
    selectedCandidates: ranking.rankedCandidates.slice(0, normalizedTopK),
    overflowCandidates: ranking.rankedCandidates.slice(normalizedTopK),
  });
};

export const evaluateConsolidationPromotionEligibility = (
  input,
  policy = DEFAULT_CONSOLIDATION_PROMOTION_POLICY,
) => {
  const candidate = createConsolidationPromotionCandidate(input);
  const normalizedPolicy = createConsolidationPromotionPolicy(policy);
  const evaluatedAt = new Date().toISOString();
  const criteria = CONSOLIDATION_PROMOTION_SIGNAL_PATHS.map((signalPath) =>
    createConsolidationPromotionCriterionResult(
      candidate,
      normalizedPolicy,
      signalPath,
    ),
  );
  const criteriaBySignalPath = Object.fromEntries(
    criteria.map((criterion) => [criterion.signalPath, criterion]),
  );
  const thresholdChecks = {};
  const signalScores = {};
  const blockedReasons = [];

  CONSOLIDATION_PROMOTION_SIGNAL_PATHS.forEach((signalPath) => {
    const signalCapture = getConsolidationPromotionSignalCapture(
      candidate,
      signalPath,
    );
    const signalScore = signalCapture?.score ?? null;
    const thresholdKey = CONSOLIDATION_PROMOTION_SIGNAL_THRESHOLDS[signalPath];
    const threshold = normalizedPolicy.thresholds[thresholdKey];

    signalScores[signalPath] = signalScore;
    thresholdChecks[signalPath] =
      signalScore === null ? null : signalScore >= threshold;

    if (
      normalizedPolicy.requiredSignals.includes(signalPath) &&
      signalScore === null
    ) {
      blockedReasons.push(`missing-${signalPath}`);
      return;
    }

    if (signalScore !== null && signalScore < threshold) {
      blockedReasons.push(`below-threshold-${signalPath}`);
    }
  });

  const promotionScore = Number(
    calculateConsolidationPromotionWeightedSignalScore(
      candidate,
      normalizedPolicy,
    ).toFixed(4),
  );
  const minimumPromotionScoreMet =
    promotionScore >= normalizedPolicy.thresholds.minimumPromotionScore;

  if (!minimumPromotionScoreMet) {
    blockedReasons.push("below-threshold-promotionScore");
  }

  const normalizedBlockedReasons = [...new Set(blockedReasons)];
  const eligible = normalizedBlockedReasons.length === 0;
  const decision = eligible ? "promote" : "defer";
  const criteriaSummary = freezeDeep({
    totalCriteria: criteria.length,
    requiredCriteria: criteria.filter((criterion) => criterion.required).length,
    optionalCriteria: criteria.filter((criterion) => !criterion.required).length,
    availableCriteria: criteria.filter((criterion) => criterion.available).length,
    satisfiedCriteria: criteria.filter(
      (criterion) => criterion.meetsThreshold === true,
    ).length,
    blockedCriteria: criteria.filter(
      (criterion) => criterion.meetsThreshold === false,
    ).length,
    missingRequiredCriteria: criteria
      .filter((criterion) => criterion.required && !criterion.available)
      .map((criterion) => criterion.signalPath),
  });
  const decisionMetadata = freezeDeep({
    evaluatedAt,
    policyId: normalizedPolicy.policyId,
    policyVersion: normalizedPolicy.version,
    scoringModel: "weighted-thresholds",
    evaluationMode: "offline-promotion-eligibility",
    offlineOnly: true,
  });

  return freezeDeep({
    candidateId: candidate.candidateId,
    agentId: candidate.agentId,
    sourceMemoryId: candidate.sourceMemoryId,
    sourceMemoryKind: candidate.sourceMemoryKind,
    targetMemoryId: candidate.targetMemoryId,
    targetNodeKind: candidate.targetNodeKind,
    learnedTraitCandidate: candidate.learnedTraitCandidate,
    policyId: normalizedPolicy.policyId,
    policyVersion: normalizedPolicy.version,
    evaluatedAt,
    signalCoverage: candidate.signalCoverage,
    requiredSignals: normalizedPolicy.requiredSignals,
    criteria,
    criteriaBySignalPath,
    criteriaSummary,
    thresholdChecks,
    signalScores,
    promotionScore,
    minimumPromotionScoreMet,
    eligible,
    eligibleForPromotion: eligible,
    decision,
    recommendedOperation: decision,
    blockedReasons: normalizedBlockedReasons,
    requiresRuntimeAuthorization:
      normalizedPolicy.requiresRuntimeAuthorization,
    allowedRuntimePhases: normalizedPolicy.allowedRuntimePhases,
    inactivityHeuristicsAuthorize:
      normalizedPolicy.inactivityHeuristicsAuthorize,
    teamIdleCoordinatesOnly: normalizedPolicy.teamIdleCoordinatesOnly,
    identityPromotionBlocked: !normalizedPolicy.allowIdentityPromotion,
    learnedTraitsTargetNodeKind:
      normalizedPolicy.learnedTraitsTargetNodeKind,
    protectedIdentityFields: normalizedPolicy.protectedIdentityFields,
    decisionMetadata,
  });
};

export const evaluateConsolidationPromotionCandidate = (
  input,
  policy = DEFAULT_CONSOLIDATION_PROMOTION_POLICY,
) => evaluateConsolidationPromotionEligibility(input, policy);

const CONSOLIDATION_PROMOTION_SOURCE_COLLECTION_BY_MEMORY_KIND = freezeDeep({
  [MEMORY_NODE_KINDS.workingMemory]: "workingMemory",
  [MEMORY_NODE_KINDS.shortTermMemory]: "shortTermMemory",
});

const createConsolidationPromotionPlanSelection = ({
  candidate,
  evaluation,
  sourceCollection,
  targetMemoryId = candidate.targetMemoryId,
  targetNodeId,
  outputMemoryId = candidate.sourceMemoryId,
  outputNodeId,
}) => {
  const outputIdentity = createConsolidationPromotionOutputIdentity(
    candidate,
    "consolidation promotion plan selection",
    {
      outputMemoryId,
      outputNodeId,
    },
  );

  return freezeDeep({
    candidate,
    evaluation,
    sourceCollection,
    targetMemoryId,
    targetNodeId,
    ...outputIdentity,
  });
};

const createConsolidationPromotionPlanEligibleCandidate = ({
  resolution,
  evaluation,
}) =>
  freezeDeep({
    selection: createConsolidationPromotionPlanSelection({
      candidate: resolution.candidate,
      evaluation,
      sourceCollection: resolution.sourceCollection,
      targetMemoryId: resolution.candidate.targetMemoryId,
      targetNodeId: resolution.targetNodeId,
      outputMemoryId: resolution.outputMemoryId,
      outputNodeId: resolution.outputNodeId,
    }),
    sourceMemory: resolution.sourceMemory,
  });

const createConsolidationPromotionPlanDeferredCandidate = ({
  candidate,
  deferredReason,
  evaluation = null,
  sourceCollection = null,
  targetMemoryId = candidate.targetMemoryId,
  targetNodeId = null,
  outputMemoryId = null,
  outputNodeId = null,
  abort = null,
}) => {
  const outputIdentity =
    outputMemoryId === null && outputNodeId === null
      ? freezeDeep({
          outputMemoryId: null,
          outputNodeId: null,
        })
      : createConsolidationPromotionOutputIdentity(
          candidate,
          "consolidation promotion deferred candidate",
          {
            outputMemoryId: outputMemoryId ?? candidate.sourceMemoryId,
            outputNodeId,
          },
        );

  return freezeDeep({
    candidate,
    evaluation,
    sourceCollection,
    targetMemoryId,
    targetNodeId,
    ...outputIdentity,
    deferredReason,
    abort:
      abort && isPlainObject(abort)
        ? createConsolidationPipelineAbort(abort)
        : null,
  });
};

const filterConsolidationPromotionPlanPageRankEdges = (
  edges,
  eligibleCandidateIds,
) => {
  if (edges === undefined || edges === null) {
    return null;
  }

  if (!Array.isArray(edges)) {
    throw new TypeError("consolidation promotion plan edges must be an array");
  }

  return edges.filter(
    (edge) =>
      eligibleCandidateIds.has(edge?.fromCandidateId) &&
      eligibleCandidateIds.has(edge?.toCandidateId),
  );
};

const rankConsolidationPromotionPlanEligibleCandidates = (
  eligibleCandidates,
  options,
  policy,
) => {
  const topK = Object.hasOwn(options, "topK")
    ? normalizeNonNegativeInteger(options.topK, "consolidation promotion plan topK")
    : null;
  const eligibleCandidateIds = new Set(
    eligibleCandidates.map(
      (entry) => entry.selection.candidate.candidateId,
    ),
  );
  const edges = filterConsolidationPromotionPlanPageRankEdges(
    options.edges,
    eligibleCandidateIds,
  );
  const usePageRank = topK !== null || (edges !== null && edges.length > 0);

  if (!usePageRank || eligibleCandidates.length === 0) {
    return freezeDeep({
      topK,
      ranking: null,
      rankedEligibleCandidates: eligibleCandidates,
    });
  }

  const eligibleCandidateById = Object.fromEntries(
    eligibleCandidates.map((entry) => [
      entry.selection.candidate.candidateId,
      entry,
    ]),
  );
  const ranking = evaluateConsolidationPromotionPageRank({
    candidates: eligibleCandidates.map((entry) => entry.selection.candidate),
    policy,
    ...(edges !== null ? { edges } : {}),
  });

  return freezeDeep({
    topK,
    ranking,
    rankedEligibleCandidates: ranking.rankedCandidateIds.map(
      (candidateId) => eligibleCandidateById[candidateId],
    ),
  });
};

const createConsolidationPromotionCandidateResolvedTarget = (
  candidate,
  targetMemoryId,
) =>
  targetMemoryId === candidate.targetMemoryId
    ? candidate
    : createConsolidationPromotionCandidate({
        ...candidate,
        targetMemoryId,
      });

const createConsolidationPromotionCandidateLogicalIdentity = (
  candidate,
  sourceMemory,
) => {
  const sourceRecord = getSanitizedPromotionSerializationSourceRecord(
    sourceMemory,
    "consolidation promotion candidate",
  );
  const content = normalizeRequiredString(
    LONG_TERM_MEMORY_PROMOTION_SOURCE_CONTENT_FIELDS.map((fieldName) =>
      getPromotionSerializationContentField(sourceRecord, fieldName),
    ).find((value) => value !== null),
    "consolidation promotion candidate logicalIdentity.content",
  );
  const summary = normalizeRequiredString(
    getPromotionSerializationContentField(sourceRecord, "summary") ?? content,
    "consolidation promotion candidate logicalIdentity.summary",
  );
  const category =
    sourceRecord.category ??
    (candidate.learnedTraitCandidate
      ? "learned_trait"
      : LONG_TERM_MEMORY_PROMOTION_DEFAULT_CATEGORY_BY_MEMORY_KIND[
          candidate.sourceMemoryKind
        ]);

  return createLongTermMemoryLogicalIdentityDescriptor(
    {
      agentId: candidate.agentId,
      memoryId: candidate.sourceMemoryId,
      category,
      content,
      summary,
      sourceMemoryIds: [candidate.sourceMemoryId],
      learnedTraitLabel:
        category === "learned_trait"
          ? sourceRecord.learnedTrait?.label ?? sourceRecord.label ?? summary
          : null,
    },
    "consolidation promotion candidate logicalIdentity",
  );
};

const resolveConsolidationPromotionPlanCandidate = (graph, candidate) => {
  const sourceCollection =
    CONSOLIDATION_PROMOTION_SOURCE_COLLECTION_BY_MEMORY_KIND[
      candidate.sourceMemoryKind
    ] ?? null;

  if (candidate.agentId !== graph.agentId) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        deferredReason: "cross-agent-candidate",
      }),
    };
  }

  if (sourceCollection === null) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        deferredReason: "unsupported-source-memory-kind",
      }),
    };
  }

  const sourceMatches = cloneArray(graph.youngGeneration[sourceCollection]).filter(
    (memoryEnvelope) =>
      memoryEnvelope?.record?.memoryId === candidate.sourceMemoryId,
  );

  if (sourceMatches.length === 0) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        deferredReason: "missing-source-memory",
      }),
    };
  }

  if (sourceMatches.length > 1) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        deferredReason: "ambiguous-source-memory",
      }),
    };
  }

  if (isRetrievalActiveYoungGenerationMemory(sourceMatches[0])) {
    const outputIdentity = createConsolidationPromotionOutputIdentity(
      {
        agentId: candidate.agentId,
        sourceMemoryId: sourceMatches[0].record.memoryId,
      },
      "consolidation promotion resolved source",
    );

    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        ...outputIdentity,
        deferredReason: "active-set-memory",
      }),
    };
  }

  const outputIdentity = createConsolidationPromotionOutputIdentity(
    {
      agentId: candidate.agentId,
      sourceMemoryId: sourceMatches[0].record.memoryId,
    },
    "consolidation promotion resolved source",
  );

  try {
    assertConsolidationTargetMemoryIdPreservesSourceMemoryId(
      candidate.sourceMemoryId,
      candidate.targetMemoryId,
      "consolidation promotion candidate",
      {
        stage: "planning",
        agentId: candidate.agentId,
        attemptedField: "targetMemoryId",
      },
    );
  } catch (error) {
    if (!isConsolidationPipelineAbortError(error)) {
      throw error;
    }

    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        ...outputIdentity,
        deferredReason: "memory-id-rewrite-attempt",
        abort: error.abort,
      }),
    };
  }

  if (candidate.targetMemoryId === null) {
    let logicalIdentityMatch = null;

    try {
      logicalIdentityMatch = resolveLongTermMemoryLogicalIdentityMatch(
        normalizeLongTermMemoryLogicalIdentityRecordDescriptors(
          graph.oldGeneration.longTermMemory,
          "consolidation promotion candidate logicalIdentity records",
        ),
        createConsolidationPromotionCandidateLogicalIdentity(
          candidate,
          sourceMatches[0],
        ),
      );
    } catch (error) {
      if (!isHippocampusBoundaryFailureError(error)) {
        throw error;
      }

      return {
        deferred: createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          ...outputIdentity,
          deferredReason: error.code,
        }),
      };
    }

    if (logicalIdentityMatch.status === "ambiguous") {
      return {
        deferred: createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          ...outputIdentity,
          deferredReason: "ambiguous-logical-identity",
        }),
      };
    }

    if (logicalIdentityMatch.status === "conflicting-stable-memory-id") {
      try {
        assertConsolidationDeduplicationPreservesCanonicalIdentity(
          {
            agentId: candidate.agentId,
            sourceMemoryId: candidate.sourceMemoryId,
            deduplicatedMemoryId: logicalIdentityMatch.matchedMemoryId,
            deduplicatedNodeId: logicalIdentityMatch.matchedNodeId,
          },
          "consolidation promotion logical identity deduplication",
          {
            attemptedMemoryField: "logicalIdentityMatch.matchedMemoryId",
            attemptedNodeField: "logicalIdentityMatch.matchedNodeId",
          },
        );
      } catch (error) {
        if (!isConsolidationPipelineAbortError(error)) {
          throw error;
        }

        return {
          deferred: createConsolidationPromotionPlanDeferredCandidate({
            candidate,
            sourceCollection,
            targetMemoryId: logicalIdentityMatch.matchedMemoryId,
            targetNodeId: logicalIdentityMatch.matchedNodeId,
            ...outputIdentity,
            deferredReason: "conflicting-logical-identity",
            abort: error.abort,
          }),
        };
      }

      return {
        deferred: createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          targetMemoryId: logicalIdentityMatch.matchedMemoryId,
          targetNodeId: logicalIdentityMatch.matchedNodeId,
          ...outputIdentity,
          deferredReason: "conflicting-logical-identity",
        }),
      };
    }

    try {
      assertConsolidationDeduplicationPreservesCanonicalIdentity(
        {
          agentId: candidate.agentId,
          sourceMemoryId: candidate.sourceMemoryId,
          deduplicatedMemoryId: logicalIdentityMatch.matchedMemoryId,
          deduplicatedNodeId: logicalIdentityMatch.matchedNodeId,
        },
        "consolidation promotion logical identity deduplication",
        {
          attemptedMemoryField: "logicalIdentityMatch.matchedMemoryId",
          attemptedNodeField: "logicalIdentityMatch.matchedNodeId",
        },
      );
    } catch (error) {
      if (!isConsolidationPipelineAbortError(error)) {
        throw error;
      }

      return {
        deferred: createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          targetMemoryId: logicalIdentityMatch.matchedMemoryId,
          targetNodeId: logicalIdentityMatch.matchedNodeId,
          ...outputIdentity,
          deferredReason: "canonical-id-rewrite-attempt",
          abort: error.abort,
        }),
      };
    }

    if (logicalIdentityMatch.status === "matched") {
      const resolvedCandidate = createConsolidationPromotionCandidateResolvedTarget(
        candidate,
        logicalIdentityMatch.matchedMemoryId,
      );

      return {
        resolved: freezeDeep({
          candidate: resolvedCandidate,
          sourceMemory: sourceMatches[0],
          sourceCollection,
          targetNodeId: logicalIdentityMatch.matchedNodeId,
          ...outputIdentity,
        }),
      };
    }

    return {
      resolved: freezeDeep({
        candidate,
        sourceMemory: sourceMatches[0],
        sourceCollection,
        targetNodeId: null,
        ...outputIdentity,
      }),
    };
  }

  const targetMatches = cloneArray(graph.oldGeneration.longTermMemory).filter(
    (memory) => memory.memoryId === candidate.targetMemoryId,
  );

  if (targetMatches.length === 0) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        ...outputIdentity,
        deferredReason: "missing-target-memory",
      }),
    };
  }

  if (targetMatches.length > 1) {
    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        ...outputIdentity,
        deferredReason: "ambiguous-target-memory",
      }),
    };
  }

  try {
    assertConsolidationDeduplicationPreservesCanonicalIdentity(
      {
        agentId: candidate.agentId,
        sourceMemoryId: candidate.sourceMemoryId,
        deduplicatedMemoryId: targetMatches[0].memoryId,
        deduplicatedNodeId: targetMatches[0].nodeId,
      },
      "consolidation promotion target deduplication",
      {
        attemptedMemoryField: "targetMemoryId",
        attemptedNodeField: "targetNodeId",
      },
    );
  } catch (error) {
    if (!isConsolidationPipelineAbortError(error)) {
      throw error;
    }

    return {
      deferred: createConsolidationPromotionPlanDeferredCandidate({
        candidate,
        sourceCollection,
        targetMemoryId: targetMatches[0].memoryId,
        targetNodeId: targetMatches[0].nodeId,
        ...outputIdentity,
        deferredReason: "canonical-id-rewrite-attempt",
        abort: error.abort,
      }),
    };
  }

  return {
    resolved: freezeDeep({
      candidate,
      sourceMemory: sourceMatches[0],
      sourceCollection,
      targetNodeId: targetMatches[0].nodeId,
      ...outputIdentity,
    }),
  };
};

export const planConsolidationPromotions = (graph, options = {}) => {
  if (!graph || typeof graph !== "object") {
    throw new TypeError("consolidation promotion plan requires a graph object");
  }

  const normalizedOptions = isPlainObject(options) ? options : {};
  const candidateInputs = normalizedOptions.candidates ?? [];

  if (!Array.isArray(candidateInputs)) {
    throw new TypeError("consolidation promotion candidates must be an array");
  }

  const policy = createConsolidationPromotionPolicy(normalizedOptions.policy);
  const authorization = freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: graph.agentId,
      runtimePhase: normalizedOptions.runtimePhase,
      inactivitySuggestion: normalizedOptions.inactivitySuggestion,
      teamIdle: normalizedOptions.teamIdle,
    }),
  );
  const selectedPromotions = [];
  const eligibleCandidates = [];
  const deferredCandidates = [];
  const seenCandidateIds = new Set();
  const seenSourceReferences = new Set();

  candidateInputs.forEach((candidateInput) => {
    const candidate = createConsolidationPromotionCandidate(candidateInput);
    const sourceCollection =
      CONSOLIDATION_PROMOTION_SOURCE_COLLECTION_BY_MEMORY_KIND[
        candidate.sourceMemoryKind
      ] ?? null;

    if (seenCandidateIds.has(candidate.candidateId)) {
      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          deferredReason: "duplicate-candidate-id",
        }),
      );
      return;
    }

    seenCandidateIds.add(candidate.candidateId);

    const sourceReferenceKey = [candidate.sourceMemoryKind, candidate.sourceMemoryId].join(
      ":",
    );

    if (seenSourceReferences.has(sourceReferenceKey)) {
      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate,
          sourceCollection,
          deferredReason: "duplicate-source-reference",
        }),
      );
      return;
    }

    seenSourceReferences.add(sourceReferenceKey);

    const resolution = resolveConsolidationPromotionPlanCandidate(graph, candidate);

    if (resolution.deferred) {
      deferredCandidates.push(resolution.deferred);
      return;
    }

    const evaluation = evaluateConsolidationPromotionEligibility(
      resolution.resolved.candidate,
      policy,
    );

    if (!authorization.eligible) {
      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate: resolution.resolved.candidate,
          evaluation,
          sourceCollection: resolution.resolved.sourceCollection,
          targetMemoryId: resolution.resolved.candidate.targetMemoryId,
          targetNodeId: resolution.resolved.targetNodeId,
          outputMemoryId: resolution.resolved.outputMemoryId,
          outputNodeId: resolution.resolved.outputNodeId,
          deferredReason: authorization.blockedReason,
        }),
      );
      return;
    }

    if (!evaluation.eligible) {
      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate: resolution.resolved.candidate,
          evaluation,
          sourceCollection: resolution.resolved.sourceCollection,
          targetMemoryId: resolution.resolved.candidate.targetMemoryId,
          targetNodeId: resolution.resolved.targetNodeId,
          outputMemoryId: resolution.resolved.outputMemoryId,
          outputNodeId: resolution.resolved.outputNodeId,
          deferredReason: "policy-ineligible",
        }),
      );
      return;
    }

    eligibleCandidates.push(
      createConsolidationPromotionPlanEligibleCandidate({
        resolution: resolution.resolved,
        evaluation,
      }),
    );
  });

  const rankedEligibleCandidates = rankConsolidationPromotionPlanEligibleCandidates(
    eligibleCandidates,
    normalizedOptions,
    policy,
  );

  rankedEligibleCandidates.rankedEligibleCandidates.forEach((eligibleCandidate) => {
    const selectedPromotion = eligibleCandidate.selection;

    if (
      rankedEligibleCandidates.topK !== null &&
      selectedPromotions.length >= rankedEligibleCandidates.topK
    ) {
      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate: selectedPromotion.candidate,
          evaluation: selectedPromotion.evaluation,
          sourceCollection: selectedPromotion.sourceCollection,
          targetMemoryId: selectedPromotion.targetMemoryId,
          targetNodeId: selectedPromotion.targetNodeId,
          outputMemoryId: selectedPromotion.outputMemoryId,
          outputNodeId: selectedPromotion.outputNodeId,
          deferredReason: "top-k-overflow",
        }),
      );
      return;
    }

    try {
      assertConsolidationPromotionSelectionPassesHippocampusBoundary(
        selectedPromotion,
        eligibleCandidate.sourceMemory,
      );
    } catch (error) {
      if (!isHippocampusBoundaryFailureError(error)) {
        throw error;
      }

      deferredCandidates.push(
        createConsolidationPromotionPlanDeferredCandidate({
          candidate: selectedPromotion.candidate,
          evaluation: selectedPromotion.evaluation,
          sourceCollection: selectedPromotion.sourceCollection,
          targetMemoryId: selectedPromotion.targetMemoryId,
          targetNodeId: selectedPromotion.targetNodeId,
          outputMemoryId: selectedPromotion.outputMemoryId,
          outputNodeId: selectedPromotion.outputNodeId,
          deferredReason: error.code,
        }),
      );
      return;
    }

    selectedPromotions.push(selectedPromotion);
  });

  return freezeDeep({
    agentId: graph.agentId,
    policyId: policy.policyId,
    policyVersion: policy.version,
    authorization,
    promotionCandidateCount: candidateInputs.length,
    selectedPromotions,
    selectedPromotionCount: selectedPromotions.length,
    deferredCandidates,
    deferredCount: deferredCandidates.length,
    batchEligible: authorization.eligible && selectedPromotions.length > 0,
    selectionMode: "offline-promotion-selection",
  });
};

const DEFAULT_ARCHIVED_BY = "offline-consolidation";
const DEFAULT_ARCHIVAL_REASON = "stale-low-value";
const DEFAULT_ARCHIVABLE_REASONS = freezeDeep(["low-retention-value"]);
const ARCHIVAL_RECOVERY_CONTEXT_VERSION = "1.0.0";
const ARCHIVAL_SOURCE_COLLECTION_BY_MEMORY_KIND = freezeDeep({
  [MEMORY_NODE_KINDS.workingMemory]: "workingMemory",
  [MEMORY_NODE_KINDS.shortTermMemory]: "shortTermMemory",
  [MEMORY_NODE_KINDS.longTermMemory]: "longTermMemory",
});

const normalizeUnitIntervalNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    throw new TypeError(`${label} must be a number between 0 and 1`);
  }

  return numericValue;
};

const normalizeDateLikeToIsoString = (value, label, fallbackValue = undefined) => {
  const valueToNormalize =
    value === undefined || value === null ? fallbackValue : value;
  const timestamp =
    valueToNormalize instanceof Date
      ? valueToNormalize.getTime()
      : new Date(valueToNormalize).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be a valid date-like value`);
  }

  return new Date(timestamp).toISOString();
};

const normalizeArchivableReasons = (value) =>
  createUniqueStringList(
    normalizeStringList(
      value ?? DEFAULT_ARCHIVABLE_REASONS,
      "archival transition archivableReasons",
    ),
  );

const normalizeArchivalEvaluationCandidate = (candidate, label) => {
  if (!isPlainObject(candidate)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep({
    memoryId: normalizeRequiredString(candidate.memoryId, `${label}.memoryId`),
    staleScore: normalizeUnitIntervalNumber(
      candidate.staleScore,
      `${label}.staleScore`,
    ),
    retentionValue: normalizeUnitIntervalNumber(
      candidate.retentionValue,
      `${label}.retentionValue`,
    ),
    recencyMs: normalizeNonNegativeNumber(candidate.recencyMs, `${label}.recencyMs`),
    reasons: normalizeStringList(candidate.reasons, `${label}.reasons`),
    breakdown: freezeDeep({
      recency: normalizeUnitIntervalNumber(
        candidate.breakdown?.recency,
        `${label}.breakdown.recency`,
      ),
      accessFrequency: normalizeUnitIntervalNumber(
        candidate.breakdown?.accessFrequency,
        `${label}.breakdown.accessFrequency`,
      ),
      retentionValue: normalizeUnitIntervalNumber(
        candidate.breakdown?.retentionValue,
        `${label}.breakdown.retentionValue`,
      ),
    }),
    metadata:
      candidate.metadata === undefined || candidate.metadata === null
        ? null
        : cloneObjectDeep(candidate.metadata),
  });
};

const normalizeArchivalEvaluation = (evaluation) => {
  if (!isPlainObject(evaluation)) {
    throw new TypeError("archival transition evaluation must be an object");
  }

  if (!Array.isArray(evaluation.staleCandidates)) {
    throw new TypeError("archival transition evaluation.staleCandidates must be an array");
  }

  return freezeDeep({
    evaluatedAt: normalizeRequiredString(
      evaluation.evaluatedAt,
      "archival transition evaluation.evaluatedAt",
    ),
    evaluationMode: normalizeRequiredString(
      evaluation.evaluationMode,
      "archival transition evaluation.evaluationMode",
    ),
    staleCandidates: evaluation.staleCandidates.map((candidate, index) =>
      normalizeArchivalEvaluationCandidate(
        candidate,
        `archival transition evaluation.staleCandidates[${index}]`,
      ),
    ),
  });
};

const assertConsolidationPromotionSelectionPassesHippocampusBoundary = (
  selection,
  sourceMemory,
) => {
  serializePromotionSelectionToLongTermMemoryEntry({
    selection,
    memory: sourceMemory,
  });
};

const inferArchivedMemorySourceGeneration = (generation, memoryKind) => {
  if (
    generation === MEMORY_NODE_KINDS.youngGeneration ||
    generation === MEMORY_NODE_KINDS.oldGeneration
  ) {
    return generation;
  }

  if (
    memoryKind === MEMORY_NODE_KINDS.workingMemory ||
    memoryKind === MEMORY_NODE_KINDS.shortTermMemory
  ) {
    return MEMORY_NODE_KINDS.youngGeneration;
  }

  if (memoryKind === MEMORY_NODE_KINDS.longTermMemory) {
    return MEMORY_NODE_KINDS.oldGeneration;
  }

  return null;
};

const normalizeArchivalCandidateReference = (candidate) => {
  const metadata = isPlainObject(candidate.metadata) ? candidate.metadata : {};
  const originalMemoryKind =
    typeof metadata.memoryKind === "string" ? metadata.memoryKind : null;
  const originalGeneration = inferArchivedMemorySourceGeneration(
    typeof metadata.generation === "string" ? metadata.generation : null,
    originalMemoryKind,
  );
  const sourceCollection =
    originalMemoryKind && ARCHIVAL_SOURCE_COLLECTION_BY_MEMORY_KIND[originalMemoryKind]
      ? ARCHIVAL_SOURCE_COLLECTION_BY_MEMORY_KIND[originalMemoryKind]
      : null;

  if (originalGeneration === null) {
    return freezeDeep({
      ...candidate,
      originalGeneration: null,
      originalMemoryKind,
      sourceCollection,
      sourceNodeId: null,
      deferredReason: "missing-source-generation",
    });
  }

  if (
    originalGeneration === MEMORY_NODE_KINDS.youngGeneration &&
    originalMemoryKind !== MEMORY_NODE_KINDS.workingMemory &&
    originalMemoryKind !== MEMORY_NODE_KINDS.shortTermMemory
  ) {
    return freezeDeep({
      ...candidate,
      originalGeneration,
      originalMemoryKind,
      sourceCollection,
      sourceNodeId: null,
      deferredReason: "unsupported-young-memory-kind",
    });
  }

  if (
    originalGeneration === MEMORY_NODE_KINDS.oldGeneration &&
    originalMemoryKind !== MEMORY_NODE_KINDS.longTermMemory
  ) {
    return freezeDeep({
      ...candidate,
      originalGeneration,
      originalMemoryKind,
      sourceCollection,
      sourceNodeId: null,
      deferredReason: "unsupported-old-memory-kind",
    });
  }

  return freezeDeep({
    ...candidate,
    originalGeneration,
    originalMemoryKind,
    sourceCollection,
  });
};

const createArchivalTransitionCandidate = (candidate, sourceNodeId) =>
  freezeDeep({
    memoryId: candidate.memoryId,
    originalGeneration: candidate.originalGeneration,
    originalMemoryKind: candidate.originalMemoryKind,
    sourceCollection: candidate.sourceCollection,
    sourceNodeId,
    staleScore: candidate.staleScore,
    retentionValue: candidate.retentionValue,
    recencyMs: candidate.recencyMs,
    reasons: candidate.reasons,
    breakdown: candidate.breakdown,
    metadata: candidate.metadata,
  });

const createArchivalDeferredCandidate = (candidate, deferredReason, sourceNodeId = null) =>
  freezeDeep({
    memoryId: candidate.memoryId,
    originalGeneration: candidate.originalGeneration ?? null,
    originalMemoryKind: candidate.originalMemoryKind ?? null,
    sourceCollection: candidate.sourceCollection ?? null,
    sourceNodeId,
    staleScore: candidate.staleScore,
    retentionValue: candidate.retentionValue,
    recencyMs: candidate.recencyMs,
    reasons: candidate.reasons,
    breakdown: candidate.breakdown,
    metadata: candidate.metadata,
    deferredReason,
  });

const createArchivalTransitionArchiveId = (
  candidate,
  archivedAt,
  allocatedArchiveIds,
) => {
  const baseArchiveId = [
    "archive",
    candidate.originalGeneration,
    candidate.originalMemoryKind,
    candidate.memoryId,
    archivedAt,
  ].join(":");
  let archiveId = baseArchiveId;
  let suffix = 1;

  while (allocatedArchiveIds.has(archiveId)) {
    suffix += 1;
    archiveId = `${baseArchiveId}:${suffix}`;
  }

  allocatedArchiveIds.add(archiveId);
  return archiveId;
};

const createArchivalRecoveryContext = ({
  archivedAt,
  archivedBy,
  candidate,
  detachedEdges,
  detachedImportanceIndex = [],
}) =>
  freezeDeep({
    version: ARCHIVAL_RECOVERY_CONTEXT_VERSION,
    preservedAt: archivedAt,
    preservedBy: archivedBy,
    sourceMemoryId: candidate.memoryId,
    sourceGeneration: candidate.originalGeneration,
    sourceMemoryKind: candidate.originalMemoryKind,
    detachedEdges: cloneArray(detachedEdges),
    detachedImportanceIndex: cloneArray(detachedImportanceIndex),
    staleEvaluation: freezeDeep({
      staleScore: candidate.staleScore,
      retentionValue: candidate.retentionValue,
      recencyMs: candidate.recencyMs,
      reasons: candidate.reasons,
      breakdown: candidate.breakdown,
    }),
  });

const createYoungGenerationArchiveSnapshot = ({
  agentId,
  archiveId,
  archivedAt,
  archivedBy,
  candidate,
  detachedEdges,
  detachedImportanceIndex,
  memoryEnvelope,
}) => ({
  ...createYoungGenerationMemory({
    record: memoryEnvelope?.record,
    inactiveForRetrieval: true,
    masking: memoryEnvelope?.masking,
    lifecycle: {
      ...cloneObject(memoryEnvelope?.lifecycle),
      state: "archived",
      inactiveAt: archivedAt,
      inactiveReason: DEFAULT_YOUNG_GENERATION_ARCHIVED_INACTIVE_REASON,
      archiveLinkage: {
        archiveId,
        archiveNodeId: createOldGenerationNodeId(
          MEMORY_NODE_KINDS.archivedMemory,
          agentId,
          archiveId,
        ),
        archivedAt,
      },
    },
  }),
  sourceCollection: candidate.sourceCollection,
  recoveryContext: createArchivalRecoveryContext({
    archivedAt,
    archivedBy,
    candidate,
    detachedEdges,
    detachedImportanceIndex,
  }),
});

const createOldGenerationArchiveSnapshot = ({
  archivedAt,
  archivedBy,
  candidate,
  detachedEdges,
  memory,
}) => ({
  ...memory,
  sourceCollection: candidate.sourceCollection,
  recoveryContext: createArchivalRecoveryContext({
    archivedAt,
    archivedBy,
    candidate,
    detachedEdges,
  }),
});

const isYoungGenerationEdgeAttachedToArchivedCandidate = (
  edge,
  candidate,
  importanceEntryIds,
) => {
  const edgeSchema = YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA.get(edge?.relation);

  if (!edgeSchema) {
    return false;
  }

  if (
    edge.from === candidate.memoryId &&
    edgeSchema.sourceNodeKind === candidate.originalMemoryKind
  ) {
    return true;
  }

  if (
    edge.to === candidate.memoryId &&
    edgeSchema.targetNodeKind === candidate.originalMemoryKind
  ) {
    return true;
  }

  if (
    importanceEntryIds.has(edge.from) &&
    edgeSchema.sourceNodeKind === MEMORY_NODE_KINDS.importanceIndex
  ) {
    return true;
  }

  if (
    importanceEntryIds.has(edge.to) &&
    edgeSchema.targetNodeKind === MEMORY_NODE_KINDS.importanceIndex
  ) {
    return true;
  }

  return false;
};

const resolveYoungGenerationArchivalCandidate = (graph, candidate) => {
  const memoryEnvelopeMatches = cloneArray(
    graph.youngGeneration[candidate.sourceCollection],
  ).filter((memoryEnvelope) => memoryEnvelope?.record?.memoryId === candidate.memoryId);

  if (memoryEnvelopeMatches.length === 0) {
    return {
      deferred: createArchivalDeferredCandidate(candidate, "missing-source-memory"),
    };
  }

  if (memoryEnvelopeMatches.length > 1) {
    return {
      deferred: createArchivalDeferredCandidate(candidate, "ambiguous-source-memory"),
    };
  }

  const memoryEnvelope = memoryEnvelopeMatches[0];

  if (isRetrievalActiveYoungGenerationMemory(memoryEnvelope)) {
    return {
      deferred: createArchivalDeferredCandidate(candidate, "active-set-memory"),
    };
  }

  const detachedImportanceIndex = cloneArray(
    graph.youngGeneration.importanceIndex,
  ).filter(
    (entry) =>
      entry.memoryId === candidate.memoryId &&
      entry.memoryKind === candidate.originalMemoryKind,
  );
  const importanceEntryIds = new Set(
    detachedImportanceIndex.map((entry) => entry.entryId),
  );
  const detachedEdges = cloneYoungGenerationEdges(graph.edges).filter((edge) =>
    isYoungGenerationEdgeAttachedToArchivedCandidate(
      edge,
      candidate,
      importanceEntryIds,
    ),
  );

  return {
    resolved: {
      candidate: createArchivalTransitionCandidate(candidate, null),
      sourceMemory: memoryEnvelope,
      detachedImportanceIndex,
      detachedEdges,
    },
  };
};

const resolveOldGenerationArchivalCandidate = (graph, candidate) => {
  const memory = cloneArray(graph.oldGeneration.longTermMemory).find(
    (entry) => entry.memoryId === candidate.memoryId,
  );

  if (!memory) {
    return {
      deferred: createArchivalDeferredCandidate(candidate, "missing-source-memory"),
    };
  }

  if (memory.category === "learned_trait") {
    return {
      deferred: createArchivalDeferredCandidate(
        candidate,
        "protected-learned-trait",
        memory.nodeId,
      ),
    };
  }

  const detachedEdges = cloneOldGenerationEdges(graph.edges).filter(
    (edge) => edge.from === memory.nodeId || edge.to === memory.nodeId,
  );

  return {
    resolved: {
      candidate: createArchivalTransitionCandidate(candidate, memory.nodeId),
      sourceMemory: memory,
      detachedImportanceIndex: [],
      detachedEdges,
    },
  };
};

const resolveArchivalTransitionCandidates = (graph, evaluation, archivableReasons) => {
  const deferredCandidates = [];
  const resolvedCandidates = [];
  const seenCandidateKeys = new Set();

  evaluation.staleCandidates.forEach((staleCandidate) => {
    const normalizedCandidate = normalizeArchivalCandidateReference(staleCandidate);

    if (
      !normalizedCandidate.reasons.some((reason) => archivableReasons.includes(reason))
    ) {
      deferredCandidates.push(
        createArchivalDeferredCandidate(
          normalizedCandidate,
          "missing-archivable-reason",
        ),
      );
      return;
    }

    if (normalizedCandidate.deferredReason) {
      deferredCandidates.push(
        createArchivalDeferredCandidate(
          normalizedCandidate,
          normalizedCandidate.deferredReason,
        ),
      );
      return;
    }

    const candidateKey = [
      normalizedCandidate.originalGeneration,
      normalizedCandidate.originalMemoryKind,
      normalizedCandidate.memoryId,
    ].join(":");

    if (seenCandidateKeys.has(candidateKey)) {
      deferredCandidates.push(
        createArchivalDeferredCandidate(
          normalizedCandidate,
          "duplicate-source-reference",
        ),
      );
      return;
    }

    seenCandidateKeys.add(candidateKey);

    const resolution =
      normalizedCandidate.originalGeneration === MEMORY_NODE_KINDS.youngGeneration
        ? resolveYoungGenerationArchivalCandidate(graph, normalizedCandidate)
        : resolveOldGenerationArchivalCandidate(graph, normalizedCandidate);

    if (resolution.deferred) {
      deferredCandidates.push(resolution.deferred);
      return;
    }

    resolvedCandidates.push(resolution.resolved);
  });

  return {
    resolvedCandidates: freezeDeep(resolvedCandidates),
    deferredCandidates: freezeDeep(deferredCandidates),
  };
};

const rollbackArchivedLongTermMemoryStorageDeletes = async (
  storage,
  deleteResults,
) => {
  for (const deleteResult of cloneArray(deleteResults).reverse()) {
    if (!deleteResult.applied || deleteResult.entry === null) {
      continue;
    }

    await rollbackLongTermMemoryPersistenceOverwrite(storage, {
      key: deleteResult.key,
      keyPrefix: deleteResult.keyPrefix,
      previousEntry: deleteResult.entry,
      failedRawValue: null,
    });
  }
};

const deleteArchivedLongTermMemoriesFromStorage = async (
  resolvedCandidates,
  options,
) => {
  const oldGenerationResolvedCandidates = cloneArray(resolvedCandidates).filter(
    (resolvedCandidate) =>
      resolvedCandidate.candidate.originalGeneration ===
      MEMORY_NODE_KINDS.oldGeneration,
  );

  if (oldGenerationResolvedCandidates.length === 0) {
    return freezeDeep([]);
  }

  if (
    !Object.hasOwn(options, "storage") &&
    !Object.hasOwn(options, "storageAdapter")
  ) {
    return freezeDeep([]);
  }

  const storage = resolveLongTermMemoryPersistenceDeleteAdapter(
    options,
    "archival transition persistence",
  );
  const deleteResults = [];

  try {
    for (const resolvedCandidate of oldGenerationResolvedCandidates) {
      deleteResults.push(
        await deleteLongTermMemoryEntry({
          storage,
          storageAdapter: storage,
          entry: resolvedCandidate.sourceMemory,
          keyPrefix: options.keyPrefix,
          runtimePhase: options.runtimePhase,
          inactivitySuggestion: options.inactivitySuggestion,
          teamIdle: options.teamIdle,
        }),
      );
    }
  } catch (error) {
    const deleteFailureReason =
      error instanceof Error ? error.message : String(error);

    try {
      await rollbackArchivedLongTermMemoryStorageDeletes(storage, deleteResults);
    } catch (rollbackError) {
      const rollbackFailureReason =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `Archival transition persisted delete flow failed and rollback failed. Delete failure: ${deleteFailureReason}. Rollback failure: ${rollbackFailureReason}`,
      );
    }

    throw new Error(
      `Archival transition persisted delete flow failed. Prior durable deletions were rolled back. ${deleteFailureReason}`,
    );
  }

  return freezeDeep(deleteResults);
};

export const archiveStaleMemories = async (graph, options = {}) => {
  const evaluation = normalizeArchivalEvaluation(options.evaluation);
  const archivedAt = normalizeDateLikeToIsoString(
    options.archivedAt,
    "archival transition archivedAt",
    new Date(),
  );
  const archivedBy = normalizeRequiredString(
    options.archivedBy ?? DEFAULT_ARCHIVED_BY,
    "archival transition archivedBy",
  );
  const archivalReason = normalizeRequiredString(
    options.archivalReason ?? DEFAULT_ARCHIVAL_REASON,
    "archival transition archivalReason",
  );
  const archivableReasons = normalizeArchivableReasons(options.archivableReasons);
  const authorization = freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: graph.agentId,
      runtimePhase: options.runtimePhase,
      inactivitySuggestion: options.inactivitySuggestion,
      teamIdle: options.teamIdle,
    }),
  );
  const { resolvedCandidates, deferredCandidates: selectionDeferredCandidates } =
    resolveArchivalTransitionCandidates(graph, evaluation, archivableReasons);

  if (!authorization.eligible) {
    const blockedCandidates = resolvedCandidates.map(({ candidate }) =>
      createArchivalDeferredCandidate(candidate, authorization.blockedReason),
    );

    return freezeDeep({
      agentId: graph.agentId,
      sourceEvaluationAt: evaluation.evaluatedAt,
      sourceEvaluationMode: evaluation.evaluationMode,
      archivedAt,
      archivedBy,
      archivalReason,
      archivableReasons,
      authorization,
      archivableCandidates: resolvedCandidates.map(({ candidate }) => candidate),
      archivableCandidateCount: resolvedCandidates.length,
      archivedTransitions: [],
      archivedCount: 0,
      persistedDeletes: [],
      persistedDeleteCount: 0,
      deferredCandidates: [
        ...selectionDeferredCandidates,
        ...blockedCandidates,
      ],
      deferredCount:
        selectionDeferredCandidates.length + blockedCandidates.length,
      applied: false,
      nextGraph: graph,
    });
  }

  const allocatedArchiveIds = new Set(
    cloneArray(graph.oldGeneration.archivedMemory).map((entry) => entry.archiveId),
  );
  const archivedTransitions = resolvedCandidates.map((resolvedCandidate) => {
    const archiveId = createArchivalTransitionArchiveId(
      resolvedCandidate.candidate,
      archivedAt,
      allocatedArchiveIds,
    );
    const archivedMemory =
      resolvedCandidate.candidate.originalGeneration === MEMORY_NODE_KINDS.youngGeneration
        ? createArchivedMemory({
            archiveId,
            agentId: graph.agentId,
            originalGeneration: resolvedCandidate.candidate.originalGeneration,
            originalMemoryKind: resolvedCandidate.candidate.originalMemoryKind,
            originalMemoryId: resolvedCandidate.candidate.memoryId,
            originalProvenance: normalizeOptionalClonedObject(
              resolvedCandidate.sourceMemory?.record?.provenance,
            ),
            archivalReason,
            archivedAt,
            snapshot: createYoungGenerationArchiveSnapshot({
              agentId: graph.agentId,
              archiveId,
              archivedAt,
              archivedBy,
              candidate: resolvedCandidate.candidate,
              detachedEdges: resolvedCandidate.detachedEdges,
              detachedImportanceIndex: resolvedCandidate.detachedImportanceIndex,
              memoryEnvelope: resolvedCandidate.sourceMemory,
            }),
            provenance: {
              source: "offline-archival-transition",
              actor: archivedBy,
              runtimePhase: authorization.runtimePhase?.value ?? null,
              teamIdle: authorization.teamIdle,
              sourceEvaluationAt: evaluation.evaluatedAt,
              sourceEvaluationMode: evaluation.evaluationMode,
              ...cloneObject(options.provenance),
            },
            consolidationState: {
              status: "preserved",
              lastOperation: "preserve",
              sourceMemoryIds: [resolvedCandidate.candidate.memoryId],
              policyVersion: normalizeNullableString(options.policyVersion),
            },
          })
        : createArchivedMemory({
            archiveId,
            agentId: graph.agentId,
            originalGeneration: resolvedCandidate.candidate.originalGeneration,
            originalMemoryKind: resolvedCandidate.candidate.originalMemoryKind,
            originalMemoryId: resolvedCandidate.candidate.memoryId,
            originalNodeId: resolvedCandidate.candidate.sourceNodeId,
            originalProvenance: resolvedCandidate.sourceMemory.provenance,
            archivalReason,
            archivedAt,
            snapshot: createOldGenerationArchiveSnapshot({
              archivedAt,
              archivedBy,
              candidate: resolvedCandidate.candidate,
              detachedEdges: resolvedCandidate.detachedEdges,
              memory: resolvedCandidate.sourceMemory,
            }),
            provenance: {
              source: "offline-archival-transition",
              actor: archivedBy,
              runtimePhase: authorization.runtimePhase?.value ?? null,
              teamIdle: authorization.teamIdle,
              sourceEvaluationAt: evaluation.evaluatedAt,
              sourceEvaluationMode: evaluation.evaluationMode,
              ...cloneObject(options.provenance),
            },
            consolidationState: {
              status: "preserved",
              lastOperation: "preserve",
              sourceMemoryIds: [resolvedCandidate.candidate.memoryId],
              policyVersion: normalizeNullableString(options.policyVersion),
            },
          });

    return freezeDeep({
      ...resolvedCandidate.candidate,
      archiveId,
      archivedMemory,
      detachedEdgeCount: resolvedCandidate.detachedEdges.length,
      detachedImportanceEntryCount:
        resolvedCandidate.detachedImportanceIndex.length,
    });
  });

  if (archivedTransitions.length === 0) {
    return freezeDeep({
      agentId: graph.agentId,
      sourceEvaluationAt: evaluation.evaluatedAt,
      sourceEvaluationMode: evaluation.evaluationMode,
      archivedAt,
      archivedBy,
      archivalReason,
      archivableReasons,
      authorization,
      archivableCandidates: [],
      archivableCandidateCount: 0,
      archivedTransitions: [],
      archivedCount: 0,
      persistedDeletes: [],
      persistedDeleteCount: 0,
      deferredCandidates: selectionDeferredCandidates,
      deferredCount: selectionDeferredCandidates.length,
      applied: false,
      nextGraph: graph,
    });
  }

  const persistedDeletes = await deleteArchivedLongTermMemoriesFromStorage(
    resolvedCandidates,
    options,
  );

  const archivedYoungReferences = new Set(
    archivedTransitions
      .filter(
        (transition) =>
          transition.originalGeneration === MEMORY_NODE_KINDS.youngGeneration,
      )
      .map(
        (transition) =>
          `${transition.originalMemoryKind}:${transition.memoryId}`,
      ),
  );
  const archivedOldMemoryIds = new Set(
    archivedTransitions
      .filter(
        (transition) =>
          transition.originalGeneration === MEMORY_NODE_KINDS.oldGeneration,
      )
      .map((transition) => transition.memoryId),
  );
  const removedYoungEdgeKeys = new Set(
    resolvedCandidates
      .filter(
        (resolvedCandidate) =>
          resolvedCandidate.candidate.originalGeneration ===
          MEMORY_NODE_KINDS.youngGeneration,
      )
      .flatMap((resolvedCandidate) =>
        resolvedCandidate.detachedEdges.map((edge) =>
          createYoungGenerationSnapshotEdgeKey(
            createYoungGenerationSnapshotEdge(edge),
          ),
        ),
      ),
  );
  const removedOldEdgeIds = new Set(
    resolvedCandidates
      .filter(
        (resolvedCandidate) =>
          resolvedCandidate.candidate.originalGeneration ===
          MEMORY_NODE_KINDS.oldGeneration,
      )
      .flatMap((resolvedCandidate) =>
        resolvedCandidate.detachedEdges.map((edge) => edge.edgeId),
      ),
  );
  const nextGraph = rebuildMemoryGraph(graph, {
    workingMemory: cloneArray(graph.youngGeneration.workingMemory).filter(
      (memoryEnvelope) =>
        !archivedYoungReferences.has(
          `${MEMORY_NODE_KINDS.workingMemory}:${memoryEnvelope?.record?.memoryId}`,
        ),
    ),
    shortTermMemory: cloneArray(graph.youngGeneration.shortTermMemory).filter(
      (memoryEnvelope) =>
        !archivedYoungReferences.has(
          `${MEMORY_NODE_KINDS.shortTermMemory}:${memoryEnvelope?.record?.memoryId}`,
        ),
    ),
    importanceIndex: cloneArray(graph.youngGeneration.importanceIndex).filter(
      (entry) =>
        !archivedYoungReferences.has(`${entry.memoryKind}:${entry.memoryId}`),
    ),
    longTermMemory: cloneArray(graph.oldGeneration.longTermMemory).filter(
      (memory) => !archivedOldMemoryIds.has(memory.memoryId),
    ),
    archivedMemory: [
      ...cloneArray(graph.oldGeneration.archivedMemory),
      ...archivedTransitions.map((transition) => transition.archivedMemory),
    ],
    edges: cloneArray(graph.edges).filter((edge) => {
      if (YOUNG_GENERATION_EDGE_RELATIONS.has(edge?.relation)) {
        return !removedYoungEdgeKeys.has(
          createYoungGenerationSnapshotEdgeKey(
            createYoungGenerationSnapshotEdge(edge),
          ),
        );
      }

      if (OLD_GENERATION_RELATIONS.has(edge?.relation)) {
        return !removedOldEdgeIds.has(edge.edgeId);
      }

      return true;
    }),
  });

  return freezeDeep({
    agentId: graph.agentId,
    sourceEvaluationAt: evaluation.evaluatedAt,
    sourceEvaluationMode: evaluation.evaluationMode,
    archivedAt,
    archivedBy,
    archivalReason,
    archivableReasons,
    authorization,
    archivableCandidates: resolvedCandidates.map(({ candidate }) => candidate),
    archivableCandidateCount: resolvedCandidates.length,
    archivedTransitions,
    archivedCount: archivedTransitions.length,
    persistedDeletes,
    persistedDeleteCount: persistedDeletes.filter(
      (deleteResult) => deleteResult.deleted,
    ).length,
    deferredCandidates: selectionDeferredCandidates,
    deferredCount: selectionDeferredCandidates.length,
    applied: true,
    nextGraph,
  });
};

const createGraphStateDeltaUnchangedReferenceKeySet = (graphStateDelta) =>
  new Set(
    Array.isArray(graphStateDelta?.memories)
      ? graphStateDelta.memories
          .filter((memory) => memory.status === GRAPH_STATE_DELTA_STATUSES[0])
          .map((memory) => memory.referenceKey)
      : [],
  );

const createGraphStateDeltaChangedReferenceKeySet = (graphStateDelta) =>
  new Set(
    Array.isArray(graphStateDelta?.memories)
      ? graphStateDelta.memories
          .filter((memory) => memory.status !== GRAPH_STATE_DELTA_STATUSES[0])
          .map((memory) => memory.referenceKey)
      : [],
  );

const createGraphStateMemoryReferenceKey = (memoryKind, memoryId) =>
  createGraphStateReconstructionMemoryDescriptorKey({
    memoryKind,
    memoryId,
  });

const createPersistedReuseMap = (entries, keySelector) =>
  new Map(cloneArray(entries).map((entry) => [keySelector(entry), entry]));

const createYoungGenerationNodeReferenceKey = (nodeKind, nodeId) =>
  createGraphStateMemoryReferenceKey(nodeKind, nodeId);

const createYoungGenerationEdgeNodeReferenceKeys = (edge) => {
  const edgeSchema = YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA.get(edge?.relation);

  if (!edgeSchema) {
    return null;
  }

  return freezeDeep({
    fromNodeReferenceKey: createYoungGenerationNodeReferenceKey(
      edgeSchema.sourceNodeKind,
      edge.from,
    ),
    toNodeReferenceKey: createYoungGenerationNodeReferenceKey(
      edgeSchema.targetNodeKind,
      edge.to,
    ),
  });
};

const createYoungGenerationImpactAdjacency = (edges) => {
  const adjacencyByNodeReferenceKey = new Map();
  const registerNodeReferenceKey = (nodeReferenceKey) => {
    if (!adjacencyByNodeReferenceKey.has(nodeReferenceKey)) {
      adjacencyByNodeReferenceKey.set(nodeReferenceKey, new Set());
    }

    return adjacencyByNodeReferenceKey.get(nodeReferenceKey);
  };

  cloneArray(edges).forEach((edge) => {
    const edgeNodeReferenceKeys = createYoungGenerationEdgeNodeReferenceKeys(edge);

    if (!edgeNodeReferenceKeys) {
      return;
    }

    registerNodeReferenceKey(
      edgeNodeReferenceKeys.fromNodeReferenceKey,
    ).add(edgeNodeReferenceKeys.toNodeReferenceKey);
    registerNodeReferenceKey(
      edgeNodeReferenceKeys.toNodeReferenceKey,
    ).add(edgeNodeReferenceKeys.fromNodeReferenceKey);
  });

  return adjacencyByNodeReferenceKey;
};

const createChangedYoungGenerationImportanceEntryIds = (
  reuseSource,
  targetYoungGeneration,
) => {
  const persistedEntriesById = createPersistedReuseMap(
    reuseSource?.youngGeneration?.importanceIndex,
    (entry) => entry.entryId,
  );
  const targetEntriesById = createPersistedReuseMap(
    targetYoungGeneration?.importanceIndex,
    (entry) => entry.entryId,
  );
  const changedEntryIds = new Set();

  createSortedUniqueStringList([
    ...persistedEntriesById.keys(),
    ...targetEntriesById.keys(),
  ]).forEach((entryId) => {
    const persistedEntry = persistedEntriesById.get(entryId) ?? null;
    const targetEntry = targetEntriesById.get(entryId) ?? null;

    if (
      !persistedEntry ||
      !targetEntry ||
      !areYoungGenerationSnapshotValuesEqual(persistedEntry, targetEntry)
    ) {
      changedEntryIds.add(entryId);
    }
  });

  return changedEntryIds;
};

const createChangedYoungGenerationEdgeKeys = (
  persistedSnapshotEdges,
  targetSnapshotEdges,
) => {
  const persistedEdgeKeys = new Set(
    cloneArray(persistedSnapshotEdges).map(createYoungGenerationSnapshotEdgeKey),
  );
  const targetEdgeKeys = new Set(
    cloneArray(targetSnapshotEdges).map(createYoungGenerationSnapshotEdgeKey),
  );
  const changedEdgeKeys = new Set();

  persistedEdgeKeys.forEach((edgeKey) => {
    if (!targetEdgeKeys.has(edgeKey)) {
      changedEdgeKeys.add(edgeKey);
    }
  });
  targetEdgeKeys.forEach((edgeKey) => {
    if (!persistedEdgeKeys.has(edgeKey)) {
      changedEdgeKeys.add(edgeKey);
    }
  });

  return changedEdgeKeys;
};

const createYoungGenerationImpactedNodeReferenceKeys = ({
  changedMemoryReferenceKeys,
  changedImportanceEntryIds,
  changedEdgeKeys,
  persistedSnapshotEdges,
  targetSnapshotEdges,
  reuseSource,
  targetYoungGeneration,
}) => {
  const seedNodeReferenceKeys = new Set(changedMemoryReferenceKeys);
  const registerImportanceEntrySeed = (entry) => {
    if (!isPlainObject(entry)) {
      return;
    }

    const entryId = normalizeNullableString(entry.entryId);

    if (!entryId || !changedImportanceEntryIds.has(entryId)) {
      return;
    }

    seedNodeReferenceKeys.add(
      createYoungGenerationNodeReferenceKey(MEMORY_NODE_KINDS.importanceIndex, entryId),
    );
    seedNodeReferenceKeys.add(
      createYoungGenerationNodeReferenceKey(entry.memoryKind, entry.memoryId),
    );
  };

  cloneArray(reuseSource?.youngGeneration?.importanceIndex).forEach(
    registerImportanceEntrySeed,
  );
  cloneArray(targetYoungGeneration?.importanceIndex).forEach(registerImportanceEntrySeed);

  const registerChangedEdgeSeed = (edge) => {
    const edgeKey = createYoungGenerationSnapshotEdgeKey(edge);

    if (!changedEdgeKeys.has(edgeKey)) {
      return;
    }

    const edgeNodeReferenceKeys = createYoungGenerationEdgeNodeReferenceKeys(edge);

    if (!edgeNodeReferenceKeys) {
      return;
    }

    seedNodeReferenceKeys.add(edgeNodeReferenceKeys.fromNodeReferenceKey);
    seedNodeReferenceKeys.add(edgeNodeReferenceKeys.toNodeReferenceKey);
  };

  cloneArray(persistedSnapshotEdges).forEach(registerChangedEdgeSeed);
  cloneArray(targetSnapshotEdges).forEach(registerChangedEdgeSeed);

  const impactedNodeReferenceKeys = new Set(seedNodeReferenceKeys);

  if (seedNodeReferenceKeys.size === 0) {
    return impactedNodeReferenceKeys;
  }

  const adjacencyByNodeReferenceKey = createYoungGenerationImpactAdjacency([
    ...cloneArray(persistedSnapshotEdges),
    ...cloneArray(targetSnapshotEdges),
  ]);
  const queue = [...seedNodeReferenceKeys];

  while (queue.length > 0) {
    const currentNodeReferenceKey = queue.shift();

    Array.from(
      adjacencyByNodeReferenceKey.get(currentNodeReferenceKey) ?? [],
    ).forEach((relatedNodeReferenceKey) => {
      if (impactedNodeReferenceKeys.has(relatedNodeReferenceKey)) {
        return;
      }

      impactedNodeReferenceKeys.add(relatedNodeReferenceKey);
      queue.push(relatedNodeReferenceKey);
    });
  }

  return impactedNodeReferenceKeys;
};

const createYoungGenerationReuseContext = (
  reuseSource,
  graphStateDelta,
  targetYoungGeneration,
) => {
  if (!reuseSource?.youngGeneration || !Array.isArray(reuseSource?.edges)) {
    return null;
  }

  const changedMemoryReferenceKeys =
    createGraphStateDeltaChangedReferenceKeySet(graphStateDelta);
  const persistedSnapshotEdges = createYoungGenerationSnapshotEdges(
    reuseSource,
    reuseSource.youngGeneration,
  );
  const targetSnapshotEdges = createYoungGenerationSnapshotEdges(
    { edges: targetYoungGeneration?.edges ?? [] },
    targetYoungGeneration,
  );
  const changedImportanceEntryIds = createChangedYoungGenerationImportanceEntryIds(
    reuseSource,
    targetYoungGeneration,
  );
  const changedEdgeKeys = createChangedYoungGenerationEdgeKeys(
    persistedSnapshotEdges,
    targetSnapshotEdges,
  );
  const impactedNodeReferenceKeys = createYoungGenerationImpactedNodeReferenceKeys({
    changedMemoryReferenceKeys,
    changedImportanceEntryIds,
    changedEdgeKeys,
    persistedSnapshotEdges,
    targetSnapshotEdges,
    reuseSource,
    targetYoungGeneration,
  });
  const invalidatedImportanceEntryIds = new Set(changedImportanceEntryIds);
  const registerImpactedImportanceEntry = (entry) => {
    const entryId = normalizeNullableString(entry?.entryId);

    if (!entryId) {
      return;
    }

    if (
      impactedNodeReferenceKeys.has(
        createYoungGenerationNodeReferenceKey(
          MEMORY_NODE_KINDS.importanceIndex,
          entryId,
        ),
      )
    ) {
      invalidatedImportanceEntryIds.add(entryId);
    }
  };

  cloneArray(reuseSource.youngGeneration.importanceIndex).forEach(
    registerImpactedImportanceEntry,
  );
  cloneArray(targetYoungGeneration?.importanceIndex).forEach(
    registerImpactedImportanceEntry,
  );

  const invalidatedEdgeKeys = new Set();
  const registerImpactedYoungEdge = (edge) => {
    const edgeNodeReferenceKeys = createYoungGenerationEdgeNodeReferenceKeys(edge);

    if (!edgeNodeReferenceKeys) {
      return;
    }

    if (
      impactedNodeReferenceKeys.has(edgeNodeReferenceKeys.fromNodeReferenceKey) ||
      impactedNodeReferenceKeys.has(edgeNodeReferenceKeys.toNodeReferenceKey)
    ) {
      invalidatedEdgeKeys.add(createYoungGenerationSnapshotEdgeKey(edge));
    }
  };

  cloneArray(persistedSnapshotEdges).forEach(registerImpactedYoungEdge);
  cloneArray(targetSnapshotEdges).forEach(registerImpactedYoungEdge);

  return {
    unchangedMemoryReferenceKeys:
      createGraphStateDeltaUnchangedReferenceKeySet(graphStateDelta),
    changedMemoryReferenceKeys,
    workingMemoryById: createPersistedReuseMap(
      reuseSource.youngGeneration.workingMemory,
      (memoryEnvelope) => memoryEnvelope.record.memoryId,
    ),
    shortTermMemoryById: createPersistedReuseMap(
      reuseSource.youngGeneration.shortTermMemory,
      (memoryEnvelope) => memoryEnvelope.record.memoryId,
    ),
    importanceIndexByEntryId: createPersistedReuseMap(
      reuseSource.youngGeneration.importanceIndex,
      (entry) => entry.entryId,
    ),
    edgeByKey: createPersistedReuseMap(
      cloneYoungGenerationEdges(reuseSource.edges),
      createYoungGenerationSnapshotEdgeKey,
    ),
    invalidatedImportanceEntryIds,
    invalidatedEdgeKeys,
    impactedNodeReferenceKeys,
  };
};

const createOldGenerationReuseContext = (
  reuseSource,
  graphStateDelta,
) => {
  if (!reuseSource?.oldGeneration || !Array.isArray(reuseSource?.edges)) {
    return null;
  }

  const changedMemoryReferenceKeys =
    createGraphStateDeltaChangedReferenceKeySet(graphStateDelta);
  const trackedMemoryReferenceKeyByNodeId = new Map([
    ...cloneArray(reuseSource.oldGeneration.longTermMemory).map(
      (memory) => [
        memory.nodeId,
        createGraphStateMemoryReferenceKey(
          MEMORY_NODE_KINDS.longTermMemory,
          memory.memoryId,
        ),
      ],
    ),
    ...cloneArray(reuseSource.oldGeneration.archivedMemory).map(
      (archivedMemory) => [
        archivedMemory.nodeId,
        createGraphStateMemoryReferenceKey(
          MEMORY_NODE_KINDS.archivedMemory,
          archivedMemory.originalMemoryId,
        ),
      ],
    ),
  ]);

  return {
    unchangedMemoryReferenceKeys:
      createGraphStateDeltaUnchangedReferenceKeySet(graphStateDelta),
    changedMemoryReferenceKeys,
    longTermMemoryById: createPersistedReuseMap(
      reuseSource.oldGeneration.longTermMemory,
      (memory) => memory.memoryId,
    ),
    archivedMemoryByOriginalMemoryId: createPersistedReuseMap(
      reuseSource.oldGeneration.archivedMemory,
      (archivedMemory) => archivedMemory.originalMemoryId,
    ),
    memoryEvidenceById: createPersistedReuseMap(
      reuseSource.oldGeneration.memoryEvidence,
      (evidence) => evidence.evidenceId,
    ),
    consolidationJournalById: createPersistedReuseMap(
      reuseSource.oldGeneration.consolidationJournal,
      (record) => record.recordId,
    ),
    trackedMemoryReferenceKeyByNodeId,
    edgeById: createPersistedReuseMap(
      cloneOldGenerationEdges(reuseSource.edges),
      (edge) => edge.edgeId,
    ),
  };
};

const maybeReusePersistedYoungGenerationMemoryEnvelope = (
  reuseContext,
  memoryKind,
  input,
) => {
  if (!reuseContext || !isYoungGenerationMemoryEnvelope(input)) {
    return null;
  }

  const memoryId = normalizeMemoryItemStableId(
    input.record?.memoryId,
    "young-generation persisted reuse memoryId",
  );
  const persistedMemory =
    memoryKind === MEMORY_NODE_KINDS.workingMemory
      ? reuseContext.workingMemoryById.get(memoryId)
      : reuseContext.shortTermMemoryById.get(memoryId);

  if (
    !persistedMemory ||
    !reuseContext.unchangedMemoryReferenceKeys.has(
      createGraphStateMemoryReferenceKey(memoryKind, memoryId),
    ) ||
    !areYoungGenerationSnapshotValuesEqual(persistedMemory, input)
  ) {
    return null;
  }

  return persistedMemory;
};

const maybeReusePersistedYoungGenerationImportanceIndexEntry = (
  reuseContext,
  input,
) => {
  if (!reuseContext || !isPlainObject(input)) {
    return null;
  }

  const entryId = normalizeRequiredString(
    input.entryId,
    "young-generation persisted reuse importanceIndex.entryId",
  );
  const persistedEntry = reuseContext.importanceIndexByEntryId.get(entryId);

  if (
    !persistedEntry ||
    reuseContext.invalidatedImportanceEntryIds?.has(entryId) ||
    !areYoungGenerationSnapshotValuesEqual(persistedEntry, input)
  ) {
    return null;
  }

  return persistedEntry;
};

const maybeReusePersistedLongTermMemory = (reuseContext, input) => {
  if (!reuseContext || !isPlainObject(input)) {
    return null;
  }

  const memoryId = normalizeMemoryItemStableId(
    input.memoryId,
    "old-generation persisted reuse longTermMemory.memoryId",
  );
  const persistedMemory = reuseContext.longTermMemoryById.get(memoryId);

  if (
    !persistedMemory ||
    !reuseContext.unchangedMemoryReferenceKeys.has(
      createGraphStateMemoryReferenceKey(
        MEMORY_NODE_KINDS.longTermMemory,
        memoryId,
      ),
    ) ||
    !areOldGenerationSnapshotValuesEqual(persistedMemory, {
      ...input,
      agentId: persistedMemory.agentId,
    })
  ) {
    return null;
  }

  return persistedMemory;
};

const maybeReusePersistedArchivedMemory = (reuseContext, input) => {
  if (!reuseContext || !isPlainObject(input)) {
    return null;
  }

  const originalMemoryId = normalizeMemoryItemStableId(
    input.originalMemoryId,
    "old-generation persisted reuse archivedMemory.originalMemoryId",
  );
  const persistedArchivedMemory =
    reuseContext.archivedMemoryByOriginalMemoryId.get(originalMemoryId);

  if (
    !persistedArchivedMemory ||
    !reuseContext.unchangedMemoryReferenceKeys.has(
      createGraphStateMemoryReferenceKey(
        MEMORY_NODE_KINDS.archivedMemory,
        originalMemoryId,
      ),
    ) ||
    !areOldGenerationSnapshotValuesEqual(persistedArchivedMemory, {
      ...input,
      agentId: persistedArchivedMemory.agentId,
    })
  ) {
    return null;
  }

  return persistedArchivedMemory;
};

const maybeReusePersistedMemoryEvidence = (reuseContext, input) => {
  if (!reuseContext || !isPlainObject(input)) {
    return null;
  }

  const evidenceId = normalizeRequiredString(
    input.evidenceId,
    "old-generation persisted reuse memoryEvidence.evidenceId",
  );
  const persistedEvidence = reuseContext.memoryEvidenceById.get(evidenceId);

  if (
    !persistedEvidence ||
    !areOldGenerationSnapshotValuesEqual(persistedEvidence, {
      ...input,
      agentId: persistedEvidence.agentId,
    })
  ) {
    return null;
  }

  return persistedEvidence;
};

const maybeReusePersistedConsolidationRecord = (reuseContext, input) => {
  if (!reuseContext || !isPlainObject(input)) {
    return null;
  }

  const recordId = normalizeRequiredString(
    input.recordId,
    "old-generation persisted reuse consolidationJournal.recordId",
  );
  const persistedRecord = reuseContext.consolidationJournalById.get(recordId);

  if (
    !persistedRecord ||
    !areOldGenerationSnapshotValuesEqual(persistedRecord, {
      ...input,
      agentId: persistedRecord.agentId,
    })
  ) {
    return null;
  }

  return persistedRecord;
};

const maybeReusePersistedYoungGenerationEdge = (reuseContext, edge) => {
  if (!reuseContext || !YOUNG_GENERATION_EDGE_RELATIONS.has(edge?.relation)) {
    return null;
  }

  const snapshotEdge = createYoungGenerationSnapshotEdge(edge);
  const edgeKey = createYoungGenerationSnapshotEdgeKey(snapshotEdge);
  const persistedEdge = reuseContext.edgeByKey.get(edgeKey);

  if (
    !persistedEdge ||
    reuseContext.invalidatedEdgeKeys?.has(edgeKey) ||
    !areYoungGenerationSnapshotValuesEqual(persistedEdge, snapshotEdge)
  ) {
    return null;
  }

  const edgeSchema = YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA.get(snapshotEdge.relation);

  if (!edgeSchema) {
    return null;
  }

  return persistedEdge;
};

const maybeReusePersistedOldGenerationEdge = (reuseContext, edge) => {
  if (!reuseContext || !OLD_GENERATION_RELATIONS.has(edge?.relation)) {
    return null;
  }

  const edgeId =
    typeof edge?.edgeId === "string" && edge.edgeId.length > 0 ? edge.edgeId : null;

  if (edgeId === null) {
    return null;
  }

  const persistedEdge = reuseContext.edgeById.get(edgeId);

  if (!persistedEdge || !areOldGenerationSnapshotValuesEqual(persistedEdge, edge)) {
    return null;
  }

  const trackedReferenceKeys = [edge.from, edge.to]
    .map((nodeId) => reuseContext.trackedMemoryReferenceKeyByNodeId.get(nodeId) ?? null)
    .filter(Boolean);

  if (
    trackedReferenceKeys.length === 0 ||
    trackedReferenceKeys.some(
      (referenceKey) => !reuseContext.unchangedMemoryReferenceKeys.has(referenceKey),
    )
  ) {
    return null;
  }

  return persistedEdge;
};

const normalizeLongTermMemoryGraphInput = (memory, agentId, label) => {
  const persistedEntry = normalizeLongTermMemoryPersistenceStoredEntrySource(
    memory,
    label,
  );

  if (persistedEntry !== null) {
    const restoredMemory = deserializeLongTermMemoryEntryFromSerializedEntry(
      persistedEntry,
      label,
    );

    if (restoredMemory.agentId !== agentId) {
      throw new Error(
        `${label}.agentId must stay inside graph agent "${agentId}", received "${restoredMemory.agentId}".`,
      );
    }

    return restoredMemory;
  }

  return createLongTermMemory({
    ...memory,
    agentId,
  });
};

const createOldGeneration = (identity, input = {}, reuseContext = null) => ({
  generation: "old",
  longTermMemory: cloneArray(input.longTermMemory).map((memory, index) => {
    const normalizedMemory = normalizeLongTermMemoryGraphInput(
      memory,
      identity.agentId,
      `Old-generation longTermMemory[${index}]`,
    );

    return (
      maybeReusePersistedLongTermMemory(reuseContext, normalizedMemory) ??
      normalizedMemory
    );
  }),
  archivedMemory: cloneArray(input.archivedMemory).map((archivedMemory) =>
    maybeReusePersistedArchivedMemory(reuseContext, archivedMemory) ??
    createArchivedMemory({
      ...archivedMemory,
      agentId: identity.agentId,
    }),
  ),
  memoryEvidence: cloneArray(input.memoryEvidence).map((evidence) =>
    maybeReusePersistedMemoryEvidence(reuseContext, evidence) ??
    createMemoryEvidence({
      ...evidence,
      agentId: identity.agentId,
    }),
  ),
  consolidationJournal: cloneArray(input.consolidationJournal).map((record) =>
    maybeReusePersistedConsolidationRecord(reuseContext, record) ??
    createConsolidationRecord({
      ...record,
      agentId: identity.agentId,
    }),
  ),
  immutableIdentity: identity,
});

const createYoungGeneration = (input = {}, reuseContext = null) => ({
  generation: "young",
  workingMemory: cloneArray(input.workingMemory).map((memoryEnvelope) =>
    maybeReusePersistedYoungGenerationMemoryEnvelope(
      reuseContext,
      MEMORY_NODE_KINDS.workingMemory,
      memoryEnvelope,
    ) ?? createYoungGenerationMemory(memoryEnvelope),
  ),
  shortTermMemory: cloneArray(input.shortTermMemory).map((memoryEnvelope) =>
    maybeReusePersistedYoungGenerationMemoryEnvelope(
      reuseContext,
      MEMORY_NODE_KINDS.shortTermMemory,
      memoryEnvelope,
    ) ?? createYoungGenerationMemory(memoryEnvelope),
  ),
  importanceIndex: cloneArray(input.importanceIndex).map((entry) =>
    maybeReusePersistedYoungGenerationImportanceIndexEntry(
      reuseContext,
      entry,
    ) ?? createImportanceIndexEntry(entry),
  ),
});

const registerOldGenerationNode = ({
  nodeIndex,
  graphAgentId,
  node,
  nodeKind,
  localId,
}) => {
  const entityLabel = `Old-generation ${OLD_GENERATION_NODE_KIND_TO_LABEL[nodeKind]} "${localId}"`;

  if (node.agentId !== graphAgentId) {
    throw new Error(
      `${entityLabel} must stay inside graph agent "${graphAgentId}", received "${node.agentId}".`,
    );
  }

  assertOldGenerationNodeId({
    nodeId: node.nodeId,
    agentId: graphAgentId,
    nodeKind,
    localId,
    entityLabel,
  });

  if (nodeIndex.has(node.nodeId)) {
    throw new Error(`Duplicate old-generation nodeId "${node.nodeId}" is not allowed.`);
  }

  nodeIndex.set(node.nodeId, freezeDeep({ nodeKind, node }));
};

const validateSupersedesInvariants = (adjacency, incomingEdgeByTarget) => {
  const visiting = new Set();
  const visited = new Set();

  const visit = (nodeId) => {
    if (visiting.has(nodeId)) {
      throw new Error(
        `Old-generation supersedes edges must remain acyclic; detected a cycle involving "${nodeId}".`,
      );
    }

    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    Array.from(adjacency.get(nodeId) ?? []).forEach(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  Array.from(adjacency.keys()).forEach(visit);

  incomingEdgeByTarget.forEach((sourceNodeIds, targetNodeId) => {
    if (sourceNodeIds.size > 1) {
      throw new Error(
        `Old-generation supersedes target "${targetNodeId}" cannot have multiple canonical successors.`,
      );
    }
  });
};

export const validateOldGenerationGraph = (graph) => {
  if (!graph || typeof graph !== "object") {
    throw new Error("Old-generation graph validation requires a graph object.");
  }

  if (!graph.oldGeneration || typeof graph.oldGeneration !== "object") {
    throw new Error("Old-generation graph validation requires graph.oldGeneration.");
  }

  const nodeIndex = new Map();
  const oldGeneration = graph.oldGeneration;

  registerOldGenerationNode({
    nodeIndex,
    graphAgentId: graph.agentId,
    node: oldGeneration.immutableIdentity,
    nodeKind: MEMORY_NODE_KINDS.immutableIdentity,
    localId: OLD_GENERATION_IDENTIFIER_SCHEMA.identityLocalId,
  });
  assertImmutableIdentityConsolidationState(oldGeneration.immutableIdentity);

  cloneArray(oldGeneration.longTermMemory).forEach((memory) => {
    assertLearnedTraitMemoryShape(memory);
    registerOldGenerationNode({
      nodeIndex,
      graphAgentId: graph.agentId,
      node: memory,
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      localId: memory.memoryId,
    });
  });

  cloneArray(oldGeneration.archivedMemory).forEach((archivedMemory) => {
    assertArchivedMemoryShape(archivedMemory);
    registerOldGenerationNode({
      nodeIndex,
      graphAgentId: graph.agentId,
      node: archivedMemory,
      nodeKind: MEMORY_NODE_KINDS.archivedMemory,
      localId: archivedMemory.archiveId,
    });
  });

  cloneArray(oldGeneration.memoryEvidence).forEach((evidence) => {
    registerOldGenerationNode({
      nodeIndex,
      graphAgentId: graph.agentId,
      node: evidence,
      nodeKind: MEMORY_NODE_KINDS.memoryEvidence,
      localId: evidence.evidenceId,
    });
  });

  cloneArray(oldGeneration.consolidationJournal).forEach((record) => {
    registerOldGenerationNode({
      nodeIndex,
      graphAgentId: graph.agentId,
      node: record,
      nodeKind: MEMORY_NODE_KINDS.consolidationRecord,
      localId: record.recordId,
    });
  });

  const oldGenerationEdges = cloneArray(graph.edges).filter((edge) =>
    OLD_GENERATION_RELATIONS.has(edge?.relation),
  );
  const edgeIds = new Set();
  const supersedesAdjacency = new Map();
  const supersedesIncomingByTarget = new Map();

  oldGenerationEdges.forEach((edge) => {
    const { sourceNodeId, targetNodeId, allowedCombination } =
      assertOldGenerationEdgeShape(edge);
    const sourceNode = nodeIndex.get(edge.from);
    const targetNode = nodeIndex.get(edge.to);

    if (!sourceNode) {
      throw new Error(
        `Old-generation edge "${edge.edgeId}" references missing source node "${edge.from}".`,
      );
    }

    if (!targetNode) {
      throw new Error(
        `Old-generation edge "${edge.edgeId}" references missing target node "${edge.to}".`,
      );
    }

    if (sourceNode.nodeKind !== allowedCombination.sourceNodeKind) {
      throw new Error(
        `Old-generation edge "${edge.edgeId}" source node "${edge.from}" must resolve to "${allowedCombination.sourceNodeKind}".`,
      );
    }

    if (targetNode.nodeKind !== allowedCombination.targetNodeKind) {
      throw new Error(
        `Old-generation edge "${edge.edgeId}" target node "${edge.to}" must resolve to "${allowedCombination.targetNodeKind}".`,
      );
    }

    if (
      sourceNode.nodeKind === MEMORY_NODE_KINDS.immutableIdentity ||
      targetNode.nodeKind === MEMORY_NODE_KINDS.immutableIdentity
    ) {
      throw new Error(
        `Immutable identity cannot participate in old-generation edges; rejected "${edge.edgeId}".`,
      );
    }

    if (edgeIds.has(edge.edgeId)) {
      throw new Error(`Duplicate old-generation edgeId "${edge.edgeId}" is not allowed.`);
    }

    edgeIds.add(edge.edgeId);

    if (edge.relation === OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation) {
      const targetRecordId = targetNode.node.recordId;
      if (
        edge.consolidationState.journalRecordId !== null &&
        edge.consolidationState.journalRecordId !== targetRecordId
      ) {
        throw new Error(
          `Old-generation createdByConsolidation edge "${edge.edgeId}" must target journal record "${edge.consolidationState.journalRecordId}".`,
        );
      }
    }

    if (edge.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation) {
      if (edge.from === edge.to) {
        throw new Error(
          `Old-generation supersedes edge "${edge.edgeId}" cannot point to the same memory node.`,
        );
      }

      const existingTargets = supersedesAdjacency.get(edge.from) ?? new Set();
      existingTargets.add(edge.to);
      supersedesAdjacency.set(edge.from, existingTargets);

      const incomingSources = supersedesIncomingByTarget.get(edge.to) ?? new Set();
      incomingSources.add(edge.from);
      supersedesIncomingByTarget.set(edge.to, incomingSources);
    }
  });

  validateSupersedesInvariants(supersedesAdjacency, supersedesIncomingByTarget);

  return true;
};

const YOUNG_GENERATION_IDENTITY_PRESERVING_RELATIONS = new Set([
  YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
  YOUNG_GENERATION_EDGE_SCHEMA.shortTermRecall.relation,
]);

const assertYoungGenerationTransitionEdgePreservesMemoryId = (edge) => {
  if (!YOUNG_GENERATION_IDENTITY_PRESERVING_RELATIONS.has(edge.relation)) {
    return;
  }

  const edgeSchema = YOUNG_GENERATION_EDGE_RELATION_TO_SCHEMA.get(edge.relation);

  if (!edgeSchema || edge.from === edge.to) {
    return;
  }

  throw new Error(
    `Young-generation edge "${edge.relation}:${edge.from}->${edge.to}" ` +
      `must preserve the same memoryId across ${edgeSchema.sourceNodeKind} -> ` +
      `${edgeSchema.targetNodeKind} transitions.`,
  );
};

const validateYoungGenerationGraph = (graph) => {
  if (!graph || typeof graph !== "object") {
    throw new Error("Young-generation graph validation requires a graph object.");
  }

  if (!graph.youngGeneration || typeof graph.youngGeneration !== "object") {
    throw new Error("Young-generation graph validation requires graph.youngGeneration.");
  }

  const nodeIndex = createYoungGenerationSnapshotNodeIndex(graph.youngGeneration);

  cloneArray(graph.youngGeneration.importanceIndex).forEach((entry, index) => {
    if (entry.agentId !== graph.agentId) {
      throw new Error(
        `Young-generation importanceIndex[${index}].agentId must stay inside graph agent "${graph.agentId}", received "${entry.agentId}".`,
      );
    }

    assertYoungGenerationSnapshotMemoryReference(
      nodeIndex,
      entry.memoryKind,
      entry.memoryId,
      `Young-generation importanceIndex[${index}].memoryId`,
    );
  });

  const youngGenerationEdges = validateYoungGenerationSnapshotEdges(
    cloneYoungGenerationEdges(graph.edges),
    nodeIndex,
  );

  youngGenerationEdges.forEach(assertYoungGenerationTransitionEdgePreservesMemoryId);
  assertImportanceIndexSnapshotEdgesStayAligned(
    youngGenerationEdges,
    graph.youngGeneration,
    "Young-generation graph edges",
  );

  return true;
};

const roundMemoryGraphReconstructionMs = (value) =>
  Number(Math.max(0, Number(value) || 0).toFixed(3));

const readMemoryGraphReconstructionNow = () => {
  if (typeof globalThis?.performance?.now === "function") {
    return globalThis.performance.now();
  }

  return Date.now();
};

const normalizeMemoryGraphReconstructionBudget = (reconstructionBudget) =>
  reconstructionBudget === undefined || reconstructionBudget === null
    ? null
    : createIdleWindowReconstructionBudget(reconstructionBudget);

const createMemoryGraphRebuildReplacementScopes = (options) => {
  const replacementScopes = [];

  if (Object.hasOwn(options, "workingMemory")) {
    replacementScopes.push("youngGeneration.workingMemory");
  }

  if (Object.hasOwn(options, "shortTermMemory")) {
    replacementScopes.push("youngGeneration.shortTermMemory");
  }

  if (Object.hasOwn(options, "importanceIndex")) {
    replacementScopes.push("youngGeneration.importanceIndex");
  }

  if (Object.hasOwn(options, "longTermMemory")) {
    replacementScopes.push("oldGeneration.longTermMemory");
  }

  if (Object.hasOwn(options, "archivedMemory")) {
    replacementScopes.push("oldGeneration.archivedMemory");
  }

  if (Object.hasOwn(options, "memoryEvidence")) {
    replacementScopes.push("oldGeneration.memoryEvidence");
  }

  if (Object.hasOwn(options, "consolidationJournal")) {
    replacementScopes.push("oldGeneration.consolidationJournal");
  }

  if (Object.hasOwn(options, "edges")) {
    replacementScopes.push("edges");
  }

  return createUniqueStringList(replacementScopes);
};

const createMemoryGraphReconstructionTargetMemorySet = (
  identityInput,
  options,
  replacementScopes = [],
) => {
  const agentId = createImmutableIdentity(identityInput).agentId;
  const workingMemoryCount = cloneArray(options.workingMemory).length;
  const shortTermMemoryCount = cloneArray(options.shortTermMemory).length;
  const importanceIndexCount = cloneArray(options.importanceIndex).length;
  const longTermMemoryCount = cloneArray(options.longTermMemory).length;
  const archivedMemoryCount = cloneArray(options.archivedMemory).length;
  const memoryEvidenceCount = cloneArray(options.memoryEvidence).length;
  const consolidationJournalCount = cloneArray(options.consolidationJournal).length;
  const edgeCount = cloneArray(options.edges).length;
  const totalYoungMemoryCount = workingMemoryCount + shortTermMemoryCount;
  const totalDurableMemoryCount = longTermMemoryCount + archivedMemoryCount;
  const totalMemoryCount = totalYoungMemoryCount + totalDurableMemoryCount;

  return freezeDeep({
    agentId,
    replacementScopes: createUniqueStringList(replacementScopes),
    workingMemoryCount,
    shortTermMemoryCount,
    importanceIndexCount,
    longTermMemoryCount,
    archivedMemoryCount,
    memoryEvidenceCount,
    consolidationJournalCount,
    edgeCount,
    totalYoungMemoryCount,
    totalDurableMemoryCount,
    totalMemoryCount,
    totalRecordCount:
      totalMemoryCount +
      importanceIndexCount +
      memoryEvidenceCount +
      consolidationJournalCount,
  });
};

const resolveMemoryGraphGenerationReuseSource = (
  generation,
  currentGraphReuseSource,
  persistedGraphStateReuseState,
) =>
  persistedGraphStateReuseState?.constructionMetadata?.reconstructionMetadata
    ?.generation === generation
    ? persistedGraphStateReuseState
    : currentGraphReuseSource;

const resolveMemoryGraphGenerationStateDelta = (
  generation,
  explicitGraphStateDelta,
  generationStateDeltas,
) =>
  explicitGraphStateDelta?.generation === generation
    ? explicitGraphStateDelta
    : generationStateDeltas?.[generation] ?? null;

const createMemoryGraphInstance = (
  immutableIdentity,
  options,
  {
    reconstructionBudget = null,
    reconstructionProfileCarrier = null,
    currentGraphReuseSource = null,
    generationStateDeltas = null,
    persistedGraphStateReuseState = null,
    graphStateDelta = null,
  } = {},
) => {
  const youngGenerationSource = resolveMemoryGraphGenerationReuseSource(
    "young",
    currentGraphReuseSource,
    persistedGraphStateReuseState,
  );
  const oldGenerationSource = resolveMemoryGraphGenerationReuseSource(
    "old",
    currentGraphReuseSource,
    persistedGraphStateReuseState,
  );
  const youngGenerationReuseContext = createYoungGenerationReuseContext(
    youngGenerationSource,
    resolveMemoryGraphGenerationStateDelta(
      "young",
      graphStateDelta,
      generationStateDeltas,
    ),
    {
      generation: "young",
      workingMemory: cloneArray(options.workingMemory),
      shortTermMemory: cloneArray(options.shortTermMemory),
      importanceIndex: cloneArray(options.importanceIndex),
      edges: cloneArray(options.edges),
    },
  );
  const oldGenerationReuseContext = createOldGenerationReuseContext(
    oldGenerationSource,
    resolveMemoryGraphGenerationStateDelta(
      "old",
      graphStateDelta,
      generationStateDeltas,
    ),
  );
  const graph = markMemoryGraphInstance({
    agentId: immutableIdentity.agentId,
    youngGeneration: createYoungGeneration(options, youngGenerationReuseContext),
    oldGeneration: createOldGeneration(
      immutableIdentity,
      options,
      oldGenerationReuseContext,
    ),
    edges: cloneArray(options.edges).map((edge) =>
      maybeReusePersistedYoungGenerationEdge(youngGenerationReuseContext, edge) ??
      maybeReusePersistedOldGenerationEdge(oldGenerationReuseContext, edge) ??
      createGraphEdge(edge, immutableIdentity.agentId),
    ),
  });

  attachMemoryGraphReconstructionBudget(graph, reconstructionBudget);
  attachMemoryGraphReconstructionProfileCarrier(graph, reconstructionProfileCarrier);

  return graph;
};

const createMemoryGraphReconstructionProfile = (
  context,
  {
    status,
    deferredPhase = null,
  } = {},
) => {
  const lastPhase =
    context.phaseMeasurements.length === 0
      ? null
      : context.phaseMeasurements[context.phaseMeasurements.length - 1];
  const elapsedMs = lastPhase?.totalElapsedMs ?? 0;
  const idleBudgetMs = context.reconstructionBudget?.reconstructionBudgetMs ?? null;
  const metrics = freezeDeep({
    idleTriggerWindowMs: context.reconstructionBudget?.idleTriggerWindowMs ?? null,
    reconstructionDurationMs: elapsedMs,
  });

  return freezeDeep({
    status,
    agentId: context.agentId,
    reconstructionBudget: context.reconstructionBudget,
    targetMemorySet: context.targetMemorySet,
    graphStateDelta: context.graphStateDelta,
    phaseMeasurements: freezeDeep([...context.phaseMeasurements]),
    metrics,
    elapsedMs,
    withinIdleBudget:
      idleBudgetMs === null ? null : elapsedMs <= idleBudgetMs && status === "completed",
    deferredPhase,
  });
};

const createMemoryGraphReconstructionDeferred = (context, phaseMeasurement) => {
  const profile = createMemoryGraphReconstructionProfile(context, {
    status: "deferred",
    deferredPhase: phaseMeasurement.phase,
  });
  const idleBudgetMs = context.reconstructionBudget?.reconstructionBudgetMs ?? null;
  const overBudgetMs =
    idleBudgetMs === null
      ? 0
      : roundMemoryGraphReconstructionMs(profile.elapsedMs - idleBudgetMs);
  const targetRecordCount = profile.targetMemorySet?.totalRecordCount ?? 0;

  return freezeDeep({
    status: "deferred",
    reason: MEMORY_GRAPH_RECONSTRUCTION_DEFERRED_REASONS[0],
    phase: phaseMeasurement.phase,
    idleBudgetMs,
    elapsedMs: profile.elapsedMs,
    overBudgetMs,
    targetMemorySet: profile.targetMemorySet,
    metrics: profile.metrics,
    profile,
    message:
      `Memory graph reconstruction deferred after phase "${phaseMeasurement.phase}" ` +
      `because idle budget ${idleBudgetMs}ms was exceeded ` +
      `while rebuilding ${targetRecordCount} target records.`,
  });
};

const finalizeMemoryGraphReconstructionPhase = (context, phase, phaseStartedAtMs) => {
  const completedAtMs = readMemoryGraphReconstructionNow();
  const elapsedMs = roundMemoryGraphReconstructionMs(completedAtMs - phaseStartedAtMs);
  const totalElapsedMs = roundMemoryGraphReconstructionMs(
    completedAtMs - context.startedAtMs,
  );
  const idleBudgetMs = context.reconstructionBudget?.reconstructionBudgetMs ?? null;
  const exceededIdleBudget =
    idleBudgetMs !== null && totalElapsedMs > idleBudgetMs;
  const phaseMeasurement = freezeDeep({
    phase: normalizeRequiredString(
      phase,
      "memory graph reconstruction phase",
    ),
    elapsedMs,
    totalElapsedMs,
    idleBudgetMs,
    budgetRemainingMs:
      idleBudgetMs === null
        ? null
        : roundMemoryGraphReconstructionMs(Math.max(idleBudgetMs - totalElapsedMs, 0)),
    exceededIdleBudget,
  });

  context.phaseMeasurements.push(phaseMeasurement);

  if (exceededIdleBudget) {
    throw new MemoryGraphReconstructionDeferredError(
      createMemoryGraphReconstructionDeferred(context, phaseMeasurement),
    );
  }

  return phaseMeasurement;
};

const executeMemoryGraphReconstructionPhase = (
  context,
  phase,
  operation,
  afterOperation = null,
) => {
  const phaseStartedAtMs = readMemoryGraphReconstructionNow();
  const result = operation();

  if (typeof afterOperation === "function") {
    afterOperation(result);
  }

  finalizeMemoryGraphReconstructionPhase(context, phase, phaseStartedAtMs);

  return result;
};

const rebuildMemoryGraphWithProfiling = (
  identityInput,
  options,
  {
    currentGraphReuseSource = null,
    replacementScopes = [],
  } = {},
) => {
  const immutableIdentity = createImmutableIdentity(identityInput);
  const reconstructionBudget = normalizeMemoryGraphReconstructionBudget(
    options.reconstructionBudget,
  );
  const persistedGraphStateReconstructionMetadata =
    normalizePersistedGraphStateReconstructionMetadata(
      options.persistedGraphStateReconstructionMetadata,
  );
  const persistedGraphStateReuseState = normalizePersistedGraphStateReuseState(
    options.persistedGraphStateReuseState,
  );
  const generationStateDeltas = createMemoryGraphGenerationStateDeltas(
    currentGraphReuseSource,
    options,
  );
  const context = {
    agentId: immutableIdentity.agentId,
    reconstructionBudget,
    persistedGraphStateReconstructionMetadata,
    persistedGraphStateReuseState,
    currentGraphReuseSource,
    generationStateDeltas,
    startedAtMs: readMemoryGraphReconstructionNow(),
    targetMemorySet: null,
    graphStateDelta: null,
    phaseMeasurements: [],
  };
  let graph = null;
  const reconstructionProfileCarrier = {};

  executeMemoryGraphReconstructionPhase(
    context,
    MEMORY_GRAPH_RECONSTRUCTION_PHASES[0],
    () =>
      createMemoryGraphReconstructionTargetMemorySet(
        immutableIdentity,
        options,
        replacementScopes,
      ),
    (targetMemorySet) => {
      context.targetMemorySet = targetMemorySet;
      context.graphStateDelta =
        createGraphStateDeltaFromRebuildOptions(
          options,
          context.persistedGraphStateReconstructionMetadata,
        );
    },
  );

  graph = executeMemoryGraphReconstructionPhase(
    context,
    MEMORY_GRAPH_RECONSTRUCTION_PHASES[1],
    () =>
      createMemoryGraphInstance(immutableIdentity, options, {
        reconstructionBudget,
        reconstructionProfileCarrier,
        currentGraphReuseSource,
        generationStateDeltas,
        persistedGraphStateReuseState,
        graphStateDelta: context.graphStateDelta,
      }),
    (materializedGraph) => {
      if (context.graphStateDelta === null) {
        context.graphStateDelta = createGraphStateDeltaFromGraph(
          materializedGraph,
          context.persistedGraphStateReconstructionMetadata,
        );
      }
    },
  );

  executeMemoryGraphReconstructionPhase(
    context,
    MEMORY_GRAPH_RECONSTRUCTION_PHASES[2],
    () => validateYoungGenerationGraph(graph),
  );

  executeMemoryGraphReconstructionPhase(
    context,
    MEMORY_GRAPH_RECONSTRUCTION_PHASES[3],
    () => validateOldGenerationGraph(graph),
  );

  graph = executeMemoryGraphReconstructionPhase(
    context,
    MEMORY_GRAPH_RECONSTRUCTION_PHASES[4],
    () => freezeDeep(graph),
  );

  Object.assign(
    reconstructionProfileCarrier,
    createMemoryGraphReconstructionProfile(context, {
      status: "completed",
    }),
  );
  freezeDeep(reconstructionProfileCarrier);

  return graph;
};

export const createMemoryGraph = (identityInput, options = {}) => {
  const immutableIdentity = createImmutableIdentity(identityInput);
  const reconstructionBudget = normalizeMemoryGraphReconstructionBudget(
    options.reconstructionBudget,
  );
  const graph = createMemoryGraphInstance(immutableIdentity, options, {
    reconstructionBudget,
  });

  validateYoungGenerationGraph(graph);
  validateOldGenerationGraph(graph);

  return freezeDeep(graph);
};

const normalizeMemoryGraphStartupRestoreOptions = (options) => {
  if (options === undefined || options === null) {
    return {};
  }

  if (!isPlainObject(options)) {
    throw new TypeError("Memory graph startup restore options must be an object.");
  }

  return options;
};

const loadPersistedLongTermMemoryEntriesFromStorage = async (agentId, options) => {
  const storage = resolveLongTermMemoryPersistenceStorageAdapter(
    options,
    "Memory graph startup restore input",
  );
  const keyPrefix = normalizeLongTermMemoryPersistenceKeyPrefix(
    options.keyPrefix,
    "Memory graph startup restore input.keyPrefix",
  );
  const listedEntries = await normalizeLongTermMemoryPersistenceStorageListEntries(
    storage,
    {
      keyPrefix,
      agentId,
    },
  );

  if (listedEntries === null) {
    throw new TypeError(
      "Memory graph startup restore input storage must provide list(request) to restore persisted long-term memories.",
    );
  }

  return freezeDeep(listedEntries.map(({ entry }) => entry));
};

export const restoreMemoryGraphFromStorage = async (identityInput, options = {}) => {
  const normalizedOptions = normalizeMemoryGraphStartupRestoreOptions(options);
  const immutableIdentity = createImmutableIdentity(identityInput);
  const longTermMemory = Object.hasOwn(normalizedOptions, "longTermMemory")
    ? normalizedOptions.longTermMemory
    : await loadPersistedLongTermMemoryEntriesFromStorage(
        immutableIdentity.agentId,
        normalizedOptions,
      );

  return createMemoryGraph(immutableIdentity, {
    ...normalizedOptions,
    longTermMemory,
  });
};

const normalizeMemoryGraphRebuildOptions = (options) => {
  if (options === undefined || options === null) {
    return {};
  }

  if (!isPlainObject(options)) {
    throw new TypeError("memory graph rebuild options must be an object");
  }

  return options;
};

export const rebuildMemoryGraph = (graph, options = {}) => {
  const normalizedOptions = normalizeMemoryGraphRebuildOptions(options);
  const resolvedOptions = {
    workingMemory:
      normalizedOptions.workingMemory ?? graph.youngGeneration.workingMemory,
    shortTermMemory:
      normalizedOptions.shortTermMemory ?? graph.youngGeneration.shortTermMemory,
    importanceIndex:
      normalizedOptions.importanceIndex ?? graph.youngGeneration.importanceIndex,
    longTermMemory:
      normalizedOptions.longTermMemory ?? graph.oldGeneration.longTermMemory,
    archivedMemory:
      normalizedOptions.archivedMemory ?? graph.oldGeneration.archivedMemory,
    memoryEvidence:
      normalizedOptions.memoryEvidence ?? graph.oldGeneration.memoryEvidence,
    consolidationJournal:
      normalizedOptions.consolidationJournal ??
      graph.oldGeneration.consolidationJournal,
    edges: normalizedOptions.edges ?? graph.edges,
    reconstructionBudget:
      normalizedOptions.reconstructionBudget ??
      getMemoryGraphReconstructionBudget(graph),
    persistedGraphStateReconstructionMetadata:
      normalizedOptions.persistedGraphStateReconstructionMetadata ?? null,
    persistedGraphStateReuseState:
      normalizedOptions.persistedGraphStateReuseState ?? null,
  };

  return rebuildMemoryGraphWithProfiling(
    graph.oldGeneration.immutableIdentity,
    resolvedOptions,
    {
      currentGraphReuseSource: graph,
      replacementScopes: createMemoryGraphRebuildReplacementScopes(normalizedOptions),
    },
  );
};

export const saveOldGenerationGraphState = (graph) => {
  const agentId = getMemoryGraphAgentId(graph);
  const oldGeneration = getOldGenerationConstructionState(graph);
  const edges = getOldGenerationSnapshotEdges(graph);

  validateOldGenerationGraph({
    agentId,
    oldGeneration,
    edges,
  });

  return freezeDeep({
    schemaId: OLD_GENERATION_GRAPH_STATE_SCHEMA.schemaId,
    schemaVersion: OLD_GENERATION_GRAPH_STATE_SCHEMA.version,
    constructionMetadata: createOldGenerationGraphStateConstructionMetadata(
      agentId,
      oldGeneration,
    ),
    oldGeneration,
    edges,
  });
};

export const saveYoungGenerationGraphState = (graph) => {
  const agentId = getMemoryGraphAgentId(graph);
  const youngGeneration = getYoungGenerationConstructionState(graph);
  const edges = createYoungGenerationSnapshotEdges(graph, youngGeneration);

  validateYoungGenerationGraph({
    agentId,
    youngGeneration,
    edges,
  });

  return freezeDeep({
    schemaId: YOUNG_GENERATION_GRAPH_STATE_SCHEMA.schemaId,
    schemaVersion: YOUNG_GENERATION_GRAPH_STATE_SCHEMA.version,
    constructionMetadata: createYoungGenerationGraphStateConstructionMetadata(
      agentId,
      youngGeneration,
    ),
    youngGeneration,
    edges,
  });
};

export const loadOldGenerationGraphState = (graph, state, options = {}) => {
  const deserializedState = deserializeOldGenerationGraphState(graph, state);

  return rebuildMemoryGraph(graph, {
    longTermMemory: deserializedState.oldGeneration.longTermMemory,
    archivedMemory: deserializedState.oldGeneration.archivedMemory,
    memoryEvidence: deserializedState.oldGeneration.memoryEvidence,
    consolidationJournal: deserializedState.oldGeneration.consolidationJournal,
    edges: [...cloneNonOldGenerationEdges(graph.edges), ...deserializedState.edges],
    reconstructionBudget: options.reconstructionBudget,
    persistedGraphStateReconstructionMetadata:
      deserializedState.constructionMetadata.reconstructionMetadata,
    persistedGraphStateReuseState: deserializedState,
  });
};

export const loadYoungGenerationGraphState = (graph, state, options = {}) => {
  const deserializedState = deserializeYoungGenerationGraphState(graph, state);

  return rebuildMemoryGraph(graph, {
    workingMemory: deserializedState.youngGeneration.workingMemory,
    shortTermMemory: deserializedState.youngGeneration.shortTermMemory,
    importanceIndex: deserializedState.youngGeneration.importanceIndex,
    edges: [...cloneNonYoungGenerationEdges(graph.edges), ...deserializedState.edges],
    reconstructionBudget: options.reconstructionBudget,
    persistedGraphStateReconstructionMetadata:
      deserializedState.constructionMetadata.reconstructionMetadata,
    persistedGraphStateReuseState: deserializedState,
  });
};

const normalizeYoungGenerationAccessMode = (accessMode = "retrieval") => {
  if (!YOUNG_GENERATION_ACCESS_MODE_SET.has(accessMode)) {
    throw new Error(`Unsupported young-generation access mode "${accessMode}".`);
  }

  return accessMode;
};

const normalizeOldGenerationAccessMode = (accessMode = "retrieval") => {
  if (!OLD_GENERATION_ACCESS_MODE_SET.has(accessMode)) {
    throw new Error(`Unsupported old-generation access mode "${accessMode}".`);
  }

  return accessMode;
};

const normalizeOldGenerationRelationshipDirection = (direction = "outbound") => {
  if (!OLD_GENERATION_RELATIONSHIP_DIRECTION_SET.has(direction)) {
    throw new Error(`Unsupported old-generation relationship direction "${direction}".`);
  }

  return direction;
};

const normalizeOldGenerationRelationshipDepth = (maxDepth = 1) => {
  const normalizedDepth = Number(maxDepth);

  if (!Number.isInteger(normalizedDepth) || normalizedDepth < 1) {
    throw new Error("Old-generation relationship walking maxDepth must be a positive integer.");
  }

  return normalizedDepth;
};

const normalizeOldGenerationRelationshipFanOutLimit = (fanOutLimit = undefined) => {
  if (fanOutLimit === undefined || fanOutLimit === null) {
    return null;
  }

  const normalizedFanOutLimit = Number(fanOutLimit);

  if (!Number.isInteger(normalizedFanOutLimit) || normalizedFanOutLimit < 1) {
    throw new Error(
      "Old-generation relationship walking fanOutLimit must be a positive integer.",
    );
  }

  return normalizedFanOutLimit;
};

const normalizeOldGenerationSupportedRelations = (relations, label) => {
  if (!Array.isArray(relations)) {
    throw new Error(`${label} must be an array.`);
  }

  return new Set(
    relations.map((relation, index) => {
      if (typeof relation !== "string" || relation.length === 0) {
        throw new Error(`${label}[${index}] must be a non-empty string.`);
      }

      if (!OLD_GENERATION_RELATIONS.has(relation)) {
        throw new Error(`Old-generation relationship filter relation "${relation}" is not supported.`);
      }

      return relation;
    }),
  );
};

const normalizeOldGenerationRelationFilter = (options = {}) => {
  const { relations = undefined, edgeTypes = undefined } =
    isPlainObject(options) ? options : {};

  if (relations === undefined && edgeTypes === undefined) {
    return null;
  }

  const normalizedRelations =
    relations === undefined
      ? null
      : normalizeOldGenerationSupportedRelations(
          relations,
          "Old-generation relationship filter relations",
        );
  const normalizedEdgeTypes =
    edgeTypes === undefined
      ? null
      : normalizeOldGenerationSupportedRelations(
          edgeTypes,
          "Old-generation relationship filter edgeTypes",
        );

  if (normalizedRelations === null) {
    return normalizedEdgeTypes;
  }

  if (normalizedEdgeTypes === null) {
    return normalizedRelations;
  }

  if (
    normalizedRelations.size !== normalizedEdgeTypes.size ||
    [...normalizedRelations].some((relation) => !normalizedEdgeTypes.has(relation))
  ) {
    throw new Error(
      "Old-generation relationship filter edgeTypes and relations must describe the same supported relations when both are provided.",
    );
  }

  return normalizedRelations;
};

const normalizeOldGenerationNodeKindFilter = (nodeKinds = undefined) => {
  if (nodeKinds === undefined) {
    return null;
  }

  if (!Array.isArray(nodeKinds)) {
    throw new Error("Old-generation relationship filter nodeKinds must be an array.");
  }

  return new Set(
    nodeKinds.map((nodeKind, index) => {
      if (typeof nodeKind !== "string" || nodeKind.length === 0) {
        throw new Error(
          `Old-generation relationship filter nodeKinds[${index}] must be a non-empty string.`,
        );
      }

      if (!OLD_GENERATION_NODE_KIND_SET.has(nodeKind)) {
        throw new Error(`Old-generation relationship filter node kind "${nodeKind}" is not supported.`);
      }

      return nodeKind;
    }),
  );
};

const normalizeOldGenerationSeedNodeIds = (seedNodeIds) => {
  if (!Array.isArray(seedNodeIds)) {
    throw new Error("Old-generation seed expansion seedNodeIds must be an array.");
  }

  return freezeDeep(
    [...new Set(
      seedNodeIds.map((seedNodeId, index) =>
        normalizeRequiredString(
          seedNodeId,
          `Old-generation seed expansion seedNodeIds[${index}]`,
        ),
      ),
    )],
  );
};

const createOldGenerationRelationshipCandidates = (accessIndex, nodeId, direction) => {
  const candidateEdges = [];

  if (direction === "outbound" || direction === "both") {
    cloneArray(accessIndex.edgesByFromNodeId.get(nodeId)).forEach((edge) => {
      candidateEdges.push({
        direction: "outbound",
        edge,
        relatedNodeId: edge.to,
      });
    });
  }

  if (direction === "inbound" || direction === "both") {
    cloneArray(accessIndex.edgesByToNodeId.get(nodeId)).forEach((edge) => {
      candidateEdges.push({
        direction: "inbound",
        edge,
        relatedNodeId: edge.from,
      });
    });
  }

  return candidateEdges;
};

const createOldGenerationAccessIndex = (graph, accessMode = "retrieval") => {
  const normalizedAccessMode = normalizeOldGenerationAccessMode(accessMode);
  const oldGeneration = graph?.oldGeneration;

  if (!oldGeneration || typeof oldGeneration !== "object") {
    throw new Error("Old-generation access requires graph.oldGeneration.");
  }

  const nodesByNodeId = new Map();
  const longTermMemoryById = new Map();
  const archivedMemoryById = new Map();
  const memoryEvidenceById = new Map();
  const consolidationRecordById = new Map();

  if (normalizedAccessMode === "administrative") {
    nodesByNodeId.set(oldGeneration.immutableIdentity.nodeId, oldGeneration.immutableIdentity);
  }

  cloneArray(oldGeneration.longTermMemory).forEach((memory) => {
    if (
      normalizedAccessMode === "retrieval" &&
      !isRetrievalActiveOldGenerationLongTermMemory(memory)
    ) {
      return;
    }

    nodesByNodeId.set(memory.nodeId, memory);
    longTermMemoryById.set(memory.memoryId, memory);
  });

  if (normalizedAccessMode === "administrative") {
    cloneArray(oldGeneration.archivedMemory).forEach((archivedMemory) => {
      nodesByNodeId.set(archivedMemory.nodeId, archivedMemory);
      archivedMemoryById.set(archivedMemory.archiveId, archivedMemory);
    });
  }

  cloneArray(oldGeneration.memoryEvidence).forEach((evidence) => {
    nodesByNodeId.set(evidence.nodeId, evidence);
    memoryEvidenceById.set(evidence.evidenceId, evidence);
  });

  cloneArray(oldGeneration.consolidationJournal).forEach((record) => {
    nodesByNodeId.set(record.nodeId, record);
    consolidationRecordById.set(record.recordId, record);
  });

  const edges = cloneOldGenerationEdges(graph?.edges).filter(
    (edge) => nodesByNodeId.has(edge.from) && nodesByNodeId.has(edge.to),
  );
  const edgesByFromNodeId = new Map();
  const edgesByToNodeId = new Map();

  edges.forEach((edge) => {
    const outboundEdges = edgesByFromNodeId.get(edge.from) ?? [];
    outboundEdges.push(edge);
    edgesByFromNodeId.set(edge.from, outboundEdges);

    const inboundEdges = edgesByToNodeId.get(edge.to) ?? [];
    inboundEdges.push(edge);
    edgesByToNodeId.set(edge.to, inboundEdges);
  });

  return {
    agentId: graph.agentId,
    accessMode: normalizedAccessMode,
    nodesByNodeId,
    longTermMemoryById,
    archivedMemoryById,
    memoryEvidenceById,
    consolidationRecordById,
    edgesByFromNodeId,
    edgesByToNodeId,
  };
};

const normalizeOldGenerationNodeLookup = (lookup) => {
  if (!lookup || typeof lookup !== "object" || Array.isArray(lookup)) {
    throw new Error("Old-generation node lookup must be an object.");
  }

  const selectors = [];
  const normalizedLookup = {};

  if (typeof lookup.nodeId === "string" && lookup.nodeId.length > 0) {
    selectors.push("nodeId");
    normalizedLookup.nodeId = lookup.nodeId;
  }

  if (typeof lookup.memoryId === "string" && lookup.memoryId.length > 0) {
    selectors.push("memoryId");
    normalizedLookup.memoryId = lookup.memoryId;
  }

  if (typeof lookup.evidenceId === "string" && lookup.evidenceId.length > 0) {
    selectors.push("evidenceId");
    normalizedLookup.evidenceId = lookup.evidenceId;
  }

  if (typeof lookup.recordId === "string" && lookup.recordId.length > 0) {
    selectors.push("recordId");
    normalizedLookup.recordId = lookup.recordId;
  }

  if (typeof lookup.archiveId === "string" && lookup.archiveId.length > 0) {
    selectors.push("archiveId");
    normalizedLookup.archiveId = lookup.archiveId;
  }

  if (lookup.nodeKind !== undefined || lookup.localId !== undefined) {
    if (typeof lookup.nodeKind !== "string" || lookup.nodeKind.length === 0) {
      throw new Error("Old-generation node lookup nodeKind must be a non-empty string.");
    }

    if (typeof lookup.localId !== "string" || lookup.localId.length === 0) {
      throw new Error("Old-generation node lookup localId must be a non-empty string.");
    }

    if (!OLD_GENERATION_NODE_KIND_SET.has(lookup.nodeKind)) {
      throw new Error(`Old-generation node lookup node kind "${lookup.nodeKind}" is not supported.`);
    }

    selectors.push("canonicalNode");
    normalizedLookup.nodeKind = lookup.nodeKind;
    normalizedLookup.localId = lookup.localId;
  }

  if (selectors.length !== 1) {
    throw new Error(
      "Old-generation node lookup requires exactly one selector: nodeId, memoryId, archiveId, evidenceId, recordId, or nodeKind with localId.",
    );
  }

  return normalizedLookup;
};

const resolveOldGenerationNode = (index, lookup) => {
  const normalizedLookup = normalizeOldGenerationNodeLookup(lookup);

  if (normalizedLookup.nodeId) {
    return index.nodesByNodeId.get(normalizedLookup.nodeId) ?? null;
  }

  if (normalizedLookup.memoryId) {
    return index.longTermMemoryById.get(normalizedLookup.memoryId) ?? null;
  }

  if (normalizedLookup.evidenceId) {
    return index.memoryEvidenceById.get(normalizedLookup.evidenceId) ?? null;
  }

  if (normalizedLookup.recordId) {
    return index.consolidationRecordById.get(normalizedLookup.recordId) ?? null;
  }

  if (normalizedLookup.archiveId) {
    return index.archivedMemoryById.get(normalizedLookup.archiveId) ?? null;
  }

  return (
    index.nodesByNodeId.get(
      createOldGenerationNodeId(
        normalizedLookup.nodeKind,
        index.agentId,
        normalizedLookup.localId,
      ),
    ) ?? null
  );
};

export const lookupLongTermMemory = (graph, memoryId) => {
  if (typeof memoryId !== "string" || memoryId.length === 0) {
    return null;
  }

  return createOldGenerationAccessIndex(graph).longTermMemoryById.get(memoryId) ?? null;
};

export const lookupMemoryEvidence = (graph, evidenceId) => {
  if (typeof evidenceId !== "string" || evidenceId.length === 0) {
    return null;
  }

  return createOldGenerationAccessIndex(graph).memoryEvidenceById.get(evidenceId) ?? null;
};

export const lookupConsolidationRecord = (graph, recordId) => {
  if (typeof recordId !== "string" || recordId.length === 0) {
    return null;
  }

  return createOldGenerationAccessIndex(graph).consolidationRecordById.get(recordId) ?? null;
};

export const lookupArchivedMemory = (graph, archiveId) => {
  if (typeof archiveId !== "string" || archiveId.length === 0) {
    return null;
  }

  return (
    createOldGenerationAccessIndex(graph, "administrative").archivedMemoryById.get(
      archiveId,
    ) ?? null
  );
};

const normalizeArchivedMemoryReferenceLookup = (reference) => {
  if (reference === undefined || reference === null) {
    return null;
  }

  if (typeof reference === "string") {
    return freezeDeep({
      archiveId: normalizeRequiredString(reference, "Archived-memory reference"),
      archiveNodeId: null,
      archivedAt: null,
    });
  }

  if (typeof reference !== "object" || Array.isArray(reference)) {
    throw new Error("Archived-memory reference must be a string or an object.");
  }

  const archiveId = normalizeOptionalString(
    reference.archiveId,
    "Archived-memory reference archiveId",
  );
  const archiveNodeId = normalizeOptionalString(
    reference.archiveNodeId,
    "Archived-memory reference archiveNodeId",
  );
  const archivedAt = normalizeOptionalString(
    reference.archivedAt,
    "Archived-memory reference archivedAt",
  );

  if (archiveId === null && archiveNodeId === null) {
    throw new Error(
      "Archived-memory reference must include archiveId or archiveNodeId.",
    );
  }

  return freezeDeep({
    archiveId,
    archiveNodeId,
    archivedAt,
  });
};

const resolveArchivedMemoryByNodeId = (accessIndex, archiveNodeId) => {
  const parsedArchiveNode = parseOldGenerationNodeId(archiveNodeId);

  if (parsedArchiveNode.nodeKind !== MEMORY_NODE_KINDS.archivedMemory) {
    throw new Error(
      `Archived-memory reference archiveNodeId "${archiveNodeId}" must target an "${MEMORY_NODE_KINDS.archivedMemory}" node.`,
    );
  }

  if (parsedArchiveNode.agentId !== accessIndex.agentId) {
    return null;
  }

  return accessIndex.nodesByNodeId.get(archiveNodeId) ?? null;
};

export const resolveArchivedMemoryReference = (graph, reference) => {
  const normalizedReference = normalizeArchivedMemoryReferenceLookup(reference);

  if (normalizedReference === null) {
    return null;
  }

  const accessIndex = createOldGenerationAccessIndex(graph, "administrative");
  const archivedMemoryById =
    normalizedReference.archiveId === null
      ? null
      : accessIndex.archivedMemoryById.get(normalizedReference.archiveId) ?? null;
  const archivedMemoryByNodeId =
    normalizedReference.archiveNodeId === null
      ? null
      : resolveArchivedMemoryByNodeId(accessIndex, normalizedReference.archiveNodeId);

  if (
    archivedMemoryById !== null &&
    archivedMemoryByNodeId !== null &&
    archivedMemoryById.nodeId !== archivedMemoryByNodeId.nodeId
  ) {
    throw new Error(
      `Archived-memory reference conflict: archiveId "${normalizedReference.archiveId}" resolved to "${archivedMemoryById.nodeId}" but archiveNodeId "${normalizedReference.archiveNodeId}" resolved to "${archivedMemoryByNodeId.nodeId}".`,
    );
  }

  return archivedMemoryById ?? archivedMemoryByNodeId ?? null;
};

export const lookupOldGenerationNode = (graph, lookup, options = {}) =>
  resolveOldGenerationNode(
    createOldGenerationAccessIndex(graph, options.accessMode),
    lookup,
  );

const createOldGenerationSeedExpansion = (accessIndex, seedNodeIds, options = {}) => {
  const direction = normalizeOldGenerationRelationshipDirection(options.direction);
  const maxDepth = normalizeOldGenerationRelationshipDepth(options.maxDepth);
  const relationFilter = normalizeOldGenerationRelationFilter(options);
  const nodeKindFilter = normalizeOldGenerationNodeKindFilter(options.nodeKinds);
  const fanOutLimit = normalizeOldGenerationRelationshipFanOutLimit(
    options.fanOutLimit,
  );
  const requestedSeedNodeIds = normalizeOldGenerationSeedNodeIds(seedNodeIds);
  const activeSeedNodeIds = [];
  const seedNodes = [];

  requestedSeedNodeIds.forEach((seedNodeId) => {
    const seedNode = accessIndex.nodesByNodeId.get(seedNodeId) ?? null;

    if (!seedNode) {
      return;
    }

    activeSeedNodeIds.push(seedNodeId);
    seedNodes.push(seedNode);
  });

  if (activeSeedNodeIds.length === 0) {
    return freezeDeep({
      accessMode: accessIndex.accessMode,
      direction,
      maxDepth,
      fanOutLimit,
      seedNodeIds: [],
      seedNodes: [],
      discoveredNodeIds: [],
      discoveredNodes: [],
      steps: [],
    });
  }

  const activeSeedNodeIdSet = new Set(activeSeedNodeIds);
  const discoveredNodeIds = [];
  const discoveredNodeIdSet = new Set();
  const steps = [];
  const queuedNodeKeys = new Set();
  const queue = [];
  const emittedSteps = new Set();

  activeSeedNodeIds.forEach((seedNodeId) => {
    const queueKey = `${seedNodeId}:${seedNodeId}`;
    queuedNodeKeys.add(queueKey);
    queue.push({
      seedNodeId,
      nodeId: seedNodeId,
      depth: 0,
      pathNodeIds: [seedNodeId],
      pathEdgeIds: [],
    });
  });

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || current.depth >= maxDepth) {
      continue;
    }

    const filteredCandidates = createOldGenerationRelationshipCandidates(
      accessIndex,
      current.nodeId,
      direction,
    ).filter((candidate) => {
      const relatedNode = accessIndex.nodesByNodeId.get(candidate.relatedNodeId);

      if (!relatedNode) {
        return false;
      }

      if (relationFilter && !relationFilter.has(candidate.edge.relation)) {
        return false;
      }

      const relatedNodeKind = parseOldGenerationNodeId(relatedNode.nodeId).nodeKind;

      if (nodeKindFilter && !nodeKindFilter.has(relatedNodeKind)) {
        return false;
      }

      return true;
    });
    const limitedCandidates =
      fanOutLimit === null
        ? filteredCandidates
        : filteredCandidates.slice(0, fanOutLimit);

    limitedCandidates.forEach((candidate) => {
      const relatedNode = accessIndex.nodesByNodeId.get(candidate.relatedNodeId);

      if (!relatedNode) {
        return;
      }

      const stepDepth = current.depth + 1;
      const stepKey = `${current.seedNodeId}:${candidate.direction}:${candidate.edge.edgeId}:${stepDepth}`;
      const pathNodeIds = [...current.pathNodeIds, candidate.relatedNodeId];
      const pathEdgeIds = [...current.pathEdgeIds, candidate.edge.edgeId];

      if (!emittedSteps.has(stepKey)) {
        emittedSteps.add(stepKey);
        steps.push(
          freezeDeep({
            seedNodeId: current.seedNodeId,
            depth: stepDepth,
            traversalIndex: steps.length,
            direction: candidate.direction,
            edge: candidate.edge,
            fromNode: accessIndex.nodesByNodeId.get(candidate.edge.from),
            toNode: accessIndex.nodesByNodeId.get(candidate.edge.to),
            relatedNode,
            pathNodeIds,
            pathEdgeIds,
          }),
        );
      }

      if (
        !activeSeedNodeIdSet.has(candidate.relatedNodeId) &&
        !discoveredNodeIdSet.has(candidate.relatedNodeId)
      ) {
        discoveredNodeIdSet.add(candidate.relatedNodeId);
        discoveredNodeIds.push(candidate.relatedNodeId);
      }

      const queueKey = `${current.seedNodeId}:${candidate.relatedNodeId}`;

      if (!queuedNodeKeys.has(queueKey)) {
        queuedNodeKeys.add(queueKey);
        queue.push({
          seedNodeId: current.seedNodeId,
          nodeId: candidate.relatedNodeId,
          depth: stepDepth,
          pathNodeIds,
          pathEdgeIds,
        });
      }
    });
  }

  return freezeDeep({
    accessMode: accessIndex.accessMode,
    direction,
    maxDepth,
    fanOutLimit,
    seedNodeIds: activeSeedNodeIds,
    seedNodes,
    discoveredNodeIds,
    discoveredNodes: discoveredNodeIds
      .map((nodeId) => accessIndex.nodesByNodeId.get(nodeId))
      .filter(Boolean),
    steps,
  });
};

export const expandOldGenerationSeedNodes = (graph, seedNodeIds, options = {}) =>
  createOldGenerationSeedExpansion(
    createOldGenerationAccessIndex(graph, options.accessMode),
    seedNodeIds,
    options,
  );

export const walkOldGenerationRelationships = (graph, lookup, options = {}) => {
  const accessMode = normalizeOldGenerationAccessMode(options.accessMode);
  const accessIndex = createOldGenerationAccessIndex(graph, accessMode);
  const startNode = resolveOldGenerationNode(accessIndex, lookup);
  const expansion = createOldGenerationSeedExpansion(
    accessIndex,
    startNode ? [startNode.nodeId] : [],
    options,
  );

  if (!startNode) {
    return freezeDeep({
      accessMode,
      direction: expansion.direction,
      maxDepth: expansion.maxDepth,
      fanOutLimit: expansion.fanOutLimit,
      startNode: null,
      steps: [],
    });
  }

  return freezeDeep({
    accessMode,
    direction: expansion.direction,
    maxDepth: expansion.maxDepth,
    fanOutLimit: expansion.fanOutLimit,
    startNode,
    steps: expansion.steps.map(({ seedNodeId, ...step }) => step),
  });
};

const PROMPT_TO_SEED_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "with",
]);

const PROMPT_TO_SEED_DIRECT_TOKEN_WEIGHTS = freezeDeep({
  summary: 1,
  content: 0.85,
  learnedTraitLabel: 0.95,
});

const PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS = freezeDeep({
  category: 0.55,
  memoryId: 0.25,
  nodeKind: 0.15,
  provenanceSource: 0.35,
  provenanceActor: 0.25,
  provenanceEvidence: 0.35,
  sourceMemoryIds: 0.2,
  relation: 0.2,
  relatedLongTermSummary: 0.45,
  relatedLongTermContent: 0.35,
  relatedLongTermCategory: 0.25,
  relatedLongTermLearnedTraitLabel: 0.4,
  relatedEvidenceDetail: 0.8,
  relatedEvidenceReference: 0.55,
  relatedEvidenceKind: 0.35,
  relatedEvidenceSource: 0.35,
  relatedConsolidationOperation: 0.3,
  relatedConsolidationRuntimePhase: 0.25,
  relatedConsolidationPolicyVersion: 0.2,
  relatedArchivedReason: 0.35,
  relatedArchivedMemoryId: 0.25,
  relatedArchivedMemoryKind: 0.25,
});

const normalizePromptToSeedResolutionOptions = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError("prompt-to-seed resolution options must be an object");
  }

  return freezeDeep({
    accessMode: normalizeOldGenerationAccessMode(options.accessMode),
    limit: Object.hasOwn(options, "limit")
      ? normalizeNonNegativeInteger(options.limit, "prompt-to-seed resolution limit")
      : null,
    minimumScore: Object.hasOwn(options, "minimumScore")
      ? normalizeNumber(
          options.minimumScore,
          0,
          1,
        )
      : 0.05,
  });
};

const normalizePromptToSeedPrompt = (prompt) =>
  normalizeRequiredString(prompt, "prompt-to-seed prompt").replace(/\s+/gu, " ");

const normalizePromptToSeedText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
};

const tokenizePromptToSeedText = (value) => {
  const normalizedText = normalizePromptToSeedText(value);

  if (!normalizedText) {
    return freezeDeep([]);
  }

  const rawTokens = normalizedText.split(" ").filter(Boolean);
  const filteredTokens = rawTokens.filter(
    (token) => token.length > 1 && !PROMPT_TO_SEED_STOPWORDS.has(token),
  );
  const effectiveTokens = filteredTokens.length > 0 ? filteredTokens : rawTokens;

  return freezeDeep([...new Set(effectiveTokens)]);
};

const createPromptToSeedBigrams = (tokens) => {
  if (!Array.isArray(tokens) || tokens.length < 2) {
    return freezeDeep([]);
  }

  const bigrams = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return freezeDeep([...new Set(bigrams)]);
};

const addPromptToSeedTokenWeights = (weights, value, weight) => {
  if (!(weights instanceof Map) || typeof value !== "string" || !value.trim()) {
    return;
  }

  tokenizePromptToSeedText(value).forEach((token) => {
    weights.set(token, Math.max(weights.get(token) ?? 0, weight));
  });
};

const addPromptToSeedTokenWeightsFromList = (weights, values, weight) => {
  cloneArray(values).forEach((value) => {
    if (typeof value === "string") {
      addPromptToSeedTokenWeights(weights, value, weight);
    }
  });
};

const addPromptToSeedProvenanceTokens = (weights, provenance) => {
  if (!isPlainObject(provenance)) {
    return;
  }

  addPromptToSeedTokenWeights(
    weights,
    provenance.source,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.provenanceSource,
  );
  addPromptToSeedTokenWeights(
    weights,
    provenance.actor,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.provenanceActor,
  );
  addPromptToSeedTokenWeightsFromList(
    weights,
    provenance.evidence,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.provenanceEvidence,
  );
};

const addPromptToSeedRelatedNodeTokens = (metadataWeights, phraseTexts, relatedNode) => {
  if (!relatedNode || typeof relatedNode !== "object") {
    return;
  }

  const relatedNodeKind = parseOldGenerationNodeId(relatedNode.nodeId).nodeKind;

  addPromptToSeedTokenWeights(
    metadataWeights,
    OLD_GENERATION_NODE_KIND_TO_LABEL[relatedNodeKind],
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.nodeKind,
  );

  if (relatedNodeKind === MEMORY_NODE_KINDS.longTermMemory) {
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.memoryId,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.memoryId,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.summary,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedLongTermSummary,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.content,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedLongTermContent,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.category,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedLongTermCategory,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.learnedTrait?.label,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedLongTermLearnedTraitLabel,
    );
    addPromptToSeedProvenanceTokens(metadataWeights, relatedNode.provenance);
    phraseTexts.push(relatedNode.summary, relatedNode.content, relatedNode.learnedTrait?.label);
    return;
  }

  if (relatedNodeKind === MEMORY_NODE_KINDS.memoryEvidence) {
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.detail,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedEvidenceDetail,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.reference,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedEvidenceReference,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.kind,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedEvidenceKind,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.source,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedEvidenceSource,
    );
    addPromptToSeedProvenanceTokens(metadataWeights, relatedNode.provenance);
    phraseTexts.push(relatedNode.detail, relatedNode.reference);
    return;
  }

  if (relatedNodeKind === MEMORY_NODE_KINDS.consolidationRecord) {
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.operation,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedConsolidationOperation,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.runtimePhase,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedConsolidationRuntimePhase,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.policyVersion,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedConsolidationPolicyVersion,
    );
    addPromptToSeedTokenWeightsFromList(
      metadataWeights,
      relatedNode.sourceMemoryIds,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.sourceMemoryIds,
    );
    addPromptToSeedProvenanceTokens(metadataWeights, relatedNode.provenance);
    return;
  }

  if (relatedNodeKind === MEMORY_NODE_KINDS.archivedMemory) {
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.archivalReason,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedArchivedReason,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.originalMemoryId,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedArchivedMemoryId,
    );
    addPromptToSeedTokenWeights(
      metadataWeights,
      relatedNode.originalMemoryKind,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relatedArchivedMemoryKind,
    );
    addPromptToSeedProvenanceTokens(metadataWeights, relatedNode.provenance);
  }
};

const createPromptToSeedCandidate = (accessIndex, memory) => {
  const directTokenWeights = new Map();
  const metadataTokenWeights = new Map();
  const phraseTexts = [memory.summary, memory.content, memory.learnedTrait?.label];
  const supportingNodeIds = new Set();
  const candidateEdges = [
    ...cloneArray(accessIndex.edgesByFromNodeId.get(memory.nodeId)),
    ...cloneArray(accessIndex.edgesByToNodeId.get(memory.nodeId)),
  ];
  const seenEdgeIds = new Set();

  addPromptToSeedTokenWeights(
    directTokenWeights,
    memory.summary,
    PROMPT_TO_SEED_DIRECT_TOKEN_WEIGHTS.summary,
  );
  addPromptToSeedTokenWeights(
    directTokenWeights,
    memory.content,
    PROMPT_TO_SEED_DIRECT_TOKEN_WEIGHTS.content,
  );
  addPromptToSeedTokenWeights(
    directTokenWeights,
    memory.learnedTrait?.label,
    PROMPT_TO_SEED_DIRECT_TOKEN_WEIGHTS.learnedTraitLabel,
  );

  addPromptToSeedTokenWeights(
    metadataTokenWeights,
    memory.memoryId,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.memoryId,
  );
  addPromptToSeedTokenWeights(
    metadataTokenWeights,
    memory.category,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.category,
  );
  addPromptToSeedTokenWeights(
    metadataTokenWeights,
    OLD_GENERATION_NODE_KIND_TO_LABEL[MEMORY_NODE_KINDS.longTermMemory],
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.nodeKind,
  );
  addPromptToSeedProvenanceTokens(metadataTokenWeights, memory.provenance);
  addPromptToSeedTokenWeightsFromList(
    metadataTokenWeights,
    memory.consolidationState?.sourceMemoryIds,
    PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.sourceMemoryIds,
  );

  candidateEdges.forEach((edge) => {
    if (!edge || seenEdgeIds.has(edge.edgeId)) {
      return;
    }

    seenEdgeIds.add(edge.edgeId);
    addPromptToSeedTokenWeights(
      metadataTokenWeights,
      edge.relation,
      PROMPT_TO_SEED_METADATA_TOKEN_WEIGHTS.relation,
    );
    addPromptToSeedProvenanceTokens(metadataTokenWeights, edge.provenance);

    const relatedNodeId = edge.from === memory.nodeId ? edge.to : edge.from;
    const relatedNode = accessIndex.nodesByNodeId.get(relatedNodeId);

    if (!relatedNode || relatedNode.nodeId === memory.nodeId) {
      return;
    }

    supportingNodeIds.add(relatedNode.nodeId);
    addPromptToSeedRelatedNodeTokens(
      metadataTokenWeights,
      phraseTexts,
      relatedNode,
    );
  });

  const phraseBigrams = new Set();

  phraseTexts
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .forEach((value) => {
      createPromptToSeedBigrams(tokenizePromptToSeedText(value)).forEach((bigram) => {
        phraseBigrams.add(bigram);
      });
    });

  return {
    memory,
    directTokenWeights,
    metadataTokenWeights,
    phraseBigrams,
    supportingNodeIds: createSortedUniqueStringList([...supportingNodeIds]),
    candidateTokenSet: new Set([
      ...directTokenWeights.keys(),
      ...metadataTokenWeights.keys(),
    ]),
  };
};

const createPromptToSeedTokenImportanceWeights = (promptTokens, candidates) => {
  const candidateCount = candidates.length;
  const tokenWeights = new Map();

  promptTokens.forEach((token) => {
    const documentFrequency = candidates.reduce(
      (count, candidate) => count + (candidate.candidateTokenSet.has(token) ? 1 : 0),
      0,
    );
    tokenWeights.set(
      token,
      Number((1 + Math.log((candidateCount + 1) / (documentFrequency + 1))).toFixed(4)),
    );
  });

  return tokenWeights;
};

const calculatePromptToSeedCoverageScore = (
  promptTokens,
  promptTokenWeights,
  candidateTokenWeights,
) => {
  const totalPromptWeight = promptTokens.reduce(
    (sum, token) => sum + (promptTokenWeights.get(token) ?? 0),
    0,
  );

  if (totalPromptWeight <= 0) {
    return 0;
  }

  const matchedPromptWeight = promptTokens.reduce(
    (sum, token) =>
      sum +
      (promptTokenWeights.get(token) ?? 0) * (candidateTokenWeights.get(token) ?? 0),
    0,
  );

  return Number((matchedPromptWeight / totalPromptWeight).toFixed(4));
};

const calculatePromptToSeedPhraseScore = (promptBigrams, candidatePhraseBigrams) => {
  if (promptBigrams.length === 0) {
    return 0;
  }

  const matchedCount = promptBigrams.reduce(
    (count, bigram) => count + (candidatePhraseBigrams.has(bigram) ? 1 : 0),
    0,
  );

  return Number((matchedCount / promptBigrams.length).toFixed(4));
};

const calculatePromptToSeedStructuralScore = (candidate, maxSupportingNodeCount) => {
  const supportingNodeScore =
    maxSupportingNodeCount <= 0
      ? 0
      : candidate.supportingNodeIds.length / maxSupportingNodeCount;
  const confidenceScore = normalizeNumber(candidate.memory.confidence);
  const salienceScore =
    candidate.memory.salience?.score === null ||
    candidate.memory.salience?.score === undefined
      ? 0
      : normalizeNumber(candidate.memory.salience.score);

  return Number(
    (
      confidenceScore * 0.4 +
      salienceScore * 0.45 +
      supportingNodeScore * 0.15
    ).toFixed(4),
  );
};

const collectPromptToSeedMatchedTerms = (promptTokens, candidateTokenWeights) =>
  freezeDeep(
    promptTokens.filter((token) => (candidateTokenWeights.get(token) ?? 0) > 0),
  );

export const resolvePromptToSeedMemoryNodeIds = (graph, prompt, options = {}) => {
  const normalizedOptions = normalizePromptToSeedResolutionOptions(options);
  const normalizedPrompt = normalizePromptToSeedPrompt(prompt);
  const promptTokens = tokenizePromptToSeedText(normalizedPrompt);

  if (promptTokens.length === 0) {
    throw new TypeError(
      "prompt-to-seed prompt must include at least one searchable token",
    );
  }

  const accessIndex = createOldGenerationAccessIndex(graph, normalizedOptions.accessMode);
  const candidates = [...accessIndex.longTermMemoryById.values()].map((memory) =>
    createPromptToSeedCandidate(accessIndex, memory),
  );

  if (candidates.length === 0) {
    return freezeDeep({
      prompt: normalizedPrompt,
      normalizedPrompt: normalizePromptToSeedText(normalizedPrompt),
      promptTokens,
      accessMode: normalizedOptions.accessMode,
      candidateCount: 0,
      seedNodeIds: [],
      seeds: [],
    });
  }

  const promptBigrams = createPromptToSeedBigrams(promptTokens);
  const promptTokenWeights = createPromptToSeedTokenImportanceWeights(
    promptTokens,
    candidates,
  );
  const maxSupportingNodeCount = candidates.reduce(
    (maxCount, candidate) => Math.max(maxCount, candidate.supportingNodeIds.length),
    0,
  );
  const rankedSeeds = candidates
    .map((candidate) => {
      const matchedContentTerms = collectPromptToSeedMatchedTerms(
        promptTokens,
        candidate.directTokenWeights,
      );
      const matchedMetadataTerms = collectPromptToSeedMatchedTerms(
        promptTokens,
        candidate.metadataTokenWeights,
      );
      const matchedTerms = freezeDeep(
        promptTokens.filter(
          (token) =>
            matchedContentTerms.includes(token) || matchedMetadataTerms.includes(token),
        ),
      );
      const directScore = calculatePromptToSeedCoverageScore(
        promptTokens,
        promptTokenWeights,
        candidate.directTokenWeights,
      );
      const metadataScore = calculatePromptToSeedCoverageScore(
        promptTokens,
        promptTokenWeights,
        candidate.metadataTokenWeights,
      );
      const phraseScore = calculatePromptToSeedPhraseScore(
        promptBigrams,
        candidate.phraseBigrams,
      );
      const structuralScore = calculatePromptToSeedStructuralScore(
        candidate,
        maxSupportingNodeCount,
      );
      const hasPromptMatch =
        matchedTerms.length > 0 || phraseScore > 0;
      const score = hasPromptMatch
        ? Number(
            (
              directScore * 0.55 +
              metadataScore * 0.2 +
              phraseScore * 0.15 +
              structuralScore * 0.1
            ).toFixed(4),
          )
        : 0;

      return freezeDeep({
        nodeId: candidate.memory.nodeId,
        memoryId: candidate.memory.memoryId,
        category: candidate.memory.category,
        score,
        directScore,
        metadataScore,
        phraseScore,
        structuralScore,
        matchedTerms,
        matchedContentTerms,
        matchedMetadataTerms,
        supportingNodeIds: candidate.supportingNodeIds,
      });
    })
    .filter((seed) => seed.score >= normalizedOptions.minimumScore)
    .sort((leftSeed, rightSeed) => {
      return (
        rightSeed.score - leftSeed.score ||
        rightSeed.directScore - leftSeed.directScore ||
        rightSeed.metadataScore - leftSeed.metadataScore ||
        rightSeed.phraseScore - leftSeed.phraseScore ||
        rightSeed.structuralScore - leftSeed.structuralScore ||
        leftSeed.nodeId.localeCompare(rightSeed.nodeId)
      );
    });

  const limitedSeeds =
    normalizedOptions.limit === null
      ? rankedSeeds
      : rankedSeeds.slice(0, normalizedOptions.limit);

  return freezeDeep({
    prompt: normalizedPrompt,
    normalizedPrompt: normalizePromptToSeedText(normalizedPrompt),
    promptTokens,
    accessMode: normalizedOptions.accessMode,
    candidateCount: candidates.length,
    seedNodeIds: limitedSeeds.map((seed) => seed.nodeId),
    seeds: limitedSeeds,
  });
};

const normalizeOldGenerationRetrievalCandidateSelectionOptions = (
  options = {},
) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "old-generation retrieval candidate selection options must be an object",
    );
  }

  normalizeOldGenerationRelationFilter(options);
  normalizeOldGenerationNodeKindFilter(options.nodeKinds);

  return freezeDeep({
    accessMode: normalizeOldGenerationAccessMode(options.accessMode),
    limit: Object.hasOwn(options, "limit")
      ? normalizeNonNegativeInteger(
          options.limit,
          "old-generation retrieval candidate selection limit",
        )
      : null,
    topK: Object.hasOwn(options, "topK")
      ? normalizeNullableNonNegativeInteger(
          options.topK,
          "old-generation retrieval candidate selection topK",
        )
      : null,
    minimumScore: Object.hasOwn(options, "minimumScore")
      ? normalizeNumber(
          options.minimumScore,
          0,
          1,
        )
      : 0.05,
    direction: Object.hasOwn(options, "direction")
      ? normalizeOldGenerationRelationshipDirection(options.direction)
      : "both",
    maxDepth: Object.hasOwn(options, "maxDepth")
      ? normalizeOldGenerationRelationshipDepth(options.maxDepth)
      : 1,
    fanOutLimit: Object.hasOwn(options, "fanOutLimit")
      ? normalizeOldGenerationRelationshipFanOutLimit(options.fanOutLimit)
      : null,
    relations: Array.isArray(options.relations)
      ? freezeDeep([...options.relations])
      : undefined,
    edgeTypes: Array.isArray(options.edgeTypes)
      ? freezeDeep([...options.edgeTypes])
      : undefined,
    nodeKinds: Array.isArray(options.nodeKinds)
      ? freezeDeep([...options.nodeKinds])
      : undefined,
  });
};

const createOldGenerationRetrievalCandidateExpansionProvenance = (
  step,
  seedMetadata,
) =>
  freezeDeep({
    seedNodeId: step.seedNodeId,
    seedMemoryId: seedMetadata?.seed.memoryId ?? null,
    seedRank: seedMetadata?.rank ?? null,
    seedScore: seedMetadata?.seed.score ?? null,
    depth: step.depth,
    traversalIndex: step.traversalIndex,
    direction: step.direction,
    relation: step.edge.relation,
    edgeId: step.edge.edgeId,
    fromNodeId: step.fromNode.nodeId,
    toNodeId: step.toNode.nodeId,
    pathNodeIds: step.pathNodeIds,
    pathEdgeIds: step.pathEdgeIds,
  });

const compareOldGenerationRetrievalCandidateExpansionProvenance = (
  left,
  right,
) => {
  const leftSeedRank = left.seedRank ?? Number.MAX_SAFE_INTEGER;
  const rightSeedRank = right.seedRank ?? Number.MAX_SAFE_INTEGER;

  return (
    left.depth - right.depth ||
    leftSeedRank - rightSeedRank ||
    left.traversalIndex - right.traversalIndex ||
    left.edgeId.localeCompare(right.edgeId)
  );
};

const createOldGenerationRetrievalCandidateOrdering = (
  seedMetadata,
  expansionProvenance,
) => {
  const sortedProvenance = [...expansionProvenance].sort(
    compareOldGenerationRetrievalCandidateExpansionProvenance,
  );
  const bestExpansion = sortedProvenance[0] ?? null;

  return freezeDeep({
    minDepth: seedMetadata ? 0 : bestExpansion?.depth ?? 0,
    seedRank: seedMetadata?.rank ?? null,
    seedScore: seedMetadata?.seed.score ?? null,
    closestSeedRank: seedMetadata?.rank ?? bestExpansion?.seedRank ?? null,
    closestSeedScore:
      seedMetadata?.seed.score ?? bestExpansion?.seedScore ?? null,
    firstTraversalIndex: bestExpansion?.traversalIndex ?? null,
    expansionCount: expansionProvenance.length,
  });
};

const createOldGenerationRetrievalCandidatePageRankPersonalizationWeight = (
  seedMetadata,
) =>
  Number(normalizeNumber(seedMetadata?.seed?.score ?? 0).toFixed(12));

const deriveOldGenerationRetrievalCandidatePageRankEdge = (
  step,
  candidateNodeIdSet,
) => {
  if (
    !step?.relatedNode ||
    parseOldGenerationNodeId(step.relatedNode.nodeId).nodeKind !==
      MEMORY_NODE_KINDS.longTermMemory
  ) {
    return null;
  }

  const candidatePathNodeIds = step.pathNodeIds.filter((nodeId) =>
    candidateNodeIdSet.has(nodeId),
  );

  if (candidatePathNodeIds.length < 2) {
    return null;
  }

  const toNodeId = candidatePathNodeIds[candidatePathNodeIds.length - 1];
  const fromNodeId = candidatePathNodeIds[candidatePathNodeIds.length - 2];

  if (
    fromNodeId === toNodeId ||
    !candidateNodeIdSet.has(fromNodeId) ||
    !candidateNodeIdSet.has(toNodeId)
  ) {
    return null;
  }

  return freezeDeep({
    fromNodeId,
    toNodeId,
    weight:
      step.edge?.salience?.score === null || step.edge?.salience?.score === undefined
        ? 1
        : normalizeNumber(step.edge.salience.score),
  });
};

const evaluateOldGenerationRetrievalCandidatePageRank = (
  candidateEntries,
  expansionSteps,
) => {
  if (candidateEntries.length === 0) {
    return null;
  }

  const candidateNodeIds = candidateEntries.map((candidate) => candidate.nodeId);
  const candidateNodeIdSet = new Set(candidateNodeIds);
  const candidateEntryByNodeId = new Map(
    candidateEntries.map((candidate) => [candidate.nodeId, candidate]),
  );
  const aggregatedEdges = new Map();

  expansionSteps.forEach((step) => {
    const derivedEdge = deriveOldGenerationRetrievalCandidatePageRankEdge(
      step,
      candidateNodeIdSet,
    );

    if (!derivedEdge) {
      return;
    }

    const edgeKey = `${derivedEdge.fromNodeId}->${derivedEdge.toNodeId}`;
    const existingEdge = aggregatedEdges.get(edgeKey) ?? {
      fromNodeId: derivedEdge.fromNodeId,
      toNodeId: derivedEdge.toNodeId,
      weight: 0,
      traversalCount: 0,
    };

    existingEdge.weight = Number((existingEdge.weight + derivedEdge.weight).toFixed(12));
    existingEdge.traversalCount += 1;
    aggregatedEdges.set(edgeKey, existingEdge);
  });

  const edges = freezeDeep(
    [...aggregatedEdges.values()]
      .sort(
        (left, right) =>
          left.fromNodeId.localeCompare(right.fromNodeId) ||
          left.toNodeId.localeCompare(right.toNodeId),
      )
      .map((edge) => freezeDeep(edge)),
  );
  const personalization = Object.fromEntries(
    candidateEntries.map((candidate) => [
      candidate.nodeId,
      createOldGenerationRetrievalCandidatePageRankPersonalizationWeight(
        candidate.seed,
      ),
    ]),
  );
  const personalizationWeightTotal = Object.values(personalization).reduce(
    (runningTotal, score) => runningTotal + score,
    0,
  );
  const pageRank = evaluateWeightedPageRank({
    nodes: candidateNodeIds,
    edges: edges.map((edge) => ({
      from: edge.fromNodeId,
      to: edge.toNodeId,
      weight: edge.weight,
    })),
    personalization: personalizationWeightTotal > 0 ? personalization : undefined,
  });

  return freezeDeep({
    dampingFactor: pageRank.dampingFactor,
    tolerance: pageRank.tolerance,
    maxIterations: pageRank.maxIterations,
    iterations: pageRank.iterations,
    converged: pageRank.converged,
    candidateNodeIds,
    rankedCandidateNodeIds: pageRank.rankedNodeIds,
    rankedCandidateMemoryIds: pageRank.rankedNodeIds.flatMap((nodeId) => {
      const candidate = candidateEntryByNodeId.get(nodeId);

      return candidate ? [candidate.memoryId] : [];
    }),
    personalizationByNodeId: pageRank.personalization,
    scoresByNodeId: pageRank.scores,
    edges,
  });
};

const compareOldGenerationRetrievalCandidates = (left, right) => {
  const leftSeedRank = left.ordering.closestSeedRank ?? Number.MAX_SAFE_INTEGER;
  const rightSeedRank = right.ordering.closestSeedRank ?? Number.MAX_SAFE_INTEGER;
  const leftTraversalIndex =
    left.ordering.firstTraversalIndex ?? Number.MAX_SAFE_INTEGER;
  const rightTraversalIndex =
    right.ordering.firstTraversalIndex ?? Number.MAX_SAFE_INTEGER;
  const leftSeedScore = left.ordering.closestSeedScore ?? 0;
  const rightSeedScore = right.ordering.closestSeedScore ?? 0;
  const leftPageRankScore = left.ranking.pageRankScore;
  const rightPageRankScore = right.ranking.pageRankScore;
  const leftPageRankRank = left.ranking.pageRankRank;
  const rightPageRankRank = right.ranking.pageRankRank;

  return (
    left.ordering.minDepth - right.ordering.minDepth ||
    leftSeedRank - rightSeedRank ||
    rightPageRankScore - leftPageRankScore ||
    leftPageRankRank - rightPageRankRank ||
    leftTraversalIndex - rightTraversalIndex ||
    rightSeedScore - leftSeedScore ||
    right.ordering.expansionCount - left.ordering.expansionCount ||
    left.nodeId.localeCompare(right.nodeId)
  );
};

export const selectOldGenerationRetrievalCandidates = (
  graph,
  prompt,
  options = {},
) => {
  const normalizedOptions =
    normalizeOldGenerationRetrievalCandidateSelectionOptions(options);
  const seedResolution = resolvePromptToSeedMemoryNodeIds(graph, prompt, {
    accessMode: normalizedOptions.accessMode,
    limit: normalizedOptions.limit,
    minimumScore: normalizedOptions.minimumScore,
  });
  const expansion = expandOldGenerationSeedNodes(
    graph,
    seedResolution.seedNodeIds,
    {
      accessMode: normalizedOptions.accessMode,
      direction: normalizedOptions.direction,
      maxDepth: normalizedOptions.maxDepth,
      relations: normalizedOptions.relations,
      edgeTypes: normalizedOptions.edgeTypes,
      nodeKinds: normalizedOptions.nodeKinds,
      fanOutLimit: normalizedOptions.fanOutLimit,
    },
  );
  const accessIndex = createOldGenerationAccessIndex(
    graph,
    normalizedOptions.accessMode,
  );
  const seedMetadataByNodeId = new Map(
    seedResolution.seeds.map((seed, index) => [
      seed.nodeId,
      freezeDeep({
        rank: index + 1,
        seed,
      }),
    ]),
  );
  const candidateEntriesByNodeId = new Map();

  seedResolution.seeds.forEach((seed) => {
    const memory = accessIndex.nodesByNodeId.get(seed.nodeId);

    if (!memory || parseOldGenerationNodeId(memory.nodeId).nodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
      return;
    }

    candidateEntriesByNodeId.set(seed.nodeId, {
      node: memory,
      seed: seedMetadataByNodeId.get(seed.nodeId) ?? null,
      expansionProvenance: [],
    });
  });

  expansion.steps.forEach((step) => {
    if (parseOldGenerationNodeId(step.relatedNode.nodeId).nodeKind !== MEMORY_NODE_KINDS.longTermMemory) {
      return;
    }

    const existingEntry =
      candidateEntriesByNodeId.get(step.relatedNode.nodeId) ?? {
        node: step.relatedNode,
        seed: null,
        expansionProvenance: [],
      };

    existingEntry.expansionProvenance.push(
      createOldGenerationRetrievalCandidateExpansionProvenance(
        step,
        seedMetadataByNodeId.get(step.seedNodeId) ?? null,
      ),
    );
    candidateEntriesByNodeId.set(step.relatedNode.nodeId, existingEntry);
  });

  const candidateEntries = [...candidateEntriesByNodeId.values()]
    .map((candidateEntry) => {
      const expansionProvenance = freezeDeep(
        [...candidateEntry.expansionProvenance].sort(
          compareOldGenerationRetrievalCandidateExpansionProvenance,
        ),
      );
      const ordering = createOldGenerationRetrievalCandidateOrdering(
        candidateEntry.seed,
        expansionProvenance,
      );
      const source =
        candidateEntry.seed && expansionProvenance.length > 0
          ? "seed_and_expansion"
          : candidateEntry.seed
            ? "seed"
            : "expansion";

      return freezeDeep({
        nodeId: candidateEntry.node.nodeId,
        memoryId: candidateEntry.node.memoryId,
        category: candidateEntry.node.category,
        source,
        seed: candidateEntry.seed?.seed ?? null,
        node: candidateEntry.node,
        expansionProvenance,
        ordering,
      });
    });
  const pageRank = evaluateOldGenerationRetrievalCandidatePageRank(
    candidateEntries,
    expansion.steps,
  );
  const pageRankRankByNodeId = new Map(
    cloneArray(pageRank?.rankedCandidateNodeIds).map((nodeId, index) => [
      nodeId,
      index + 1,
    ]),
  );
  const candidates = candidateEntries
    .map((candidateEntry) =>
      ({
        ...candidateEntry,
        ranking: {
          pageRankRank:
            pageRankRankByNodeId.get(candidateEntry.nodeId) ?? candidateEntries.length,
          pageRankScore: pageRank?.scoresByNodeId[candidateEntry.nodeId] ?? 0,
          personalizationScore:
            pageRank?.personalizationByNodeId[candidateEntry.nodeId] ?? 0,
        },
      })
    )
    .sort(compareOldGenerationRetrievalCandidates);
  const rankedCandidates = candidates.map((candidate, index) =>
    freezeDeep({
      ...candidate,
      ranking: {
        ...candidate.ranking,
        retrievalRank: index + 1,
      },
    }),
  );
  const selectedCandidates =
    normalizedOptions.topK === null
      ? rankedCandidates
      : rankedCandidates.slice(0, normalizedOptions.topK);
  const overflowCandidates =
    normalizedOptions.topK === null
      ? []
      : rankedCandidates.slice(normalizedOptions.topK);

  return freezeDeep({
    prompt: seedResolution.prompt,
    normalizedPrompt: seedResolution.normalizedPrompt,
    promptTokens: seedResolution.promptTokens,
    accessMode: seedResolution.accessMode,
    topK: normalizedOptions.topK,
    candidateCount: selectedCandidates.length,
    candidateNodeIds: selectedCandidates.map((candidate) => candidate.nodeId),
    candidateMemoryIds: selectedCandidates.map((candidate) => candidate.memoryId),
    rankedCandidateCount: rankedCandidates.length,
    rankedCandidateNodeIds: rankedCandidates.map((candidate) => candidate.nodeId),
    rankedCandidateMemoryIds: rankedCandidates.map(
      (candidate) => candidate.memoryId,
    ),
    seedResolution,
    expansion,
    pageRank,
    rankedCandidates,
    candidates: selectedCandidates,
    overflowCandidates,
  });
};

const rehydrateYoungGenerationInspectionRecord = (memoryEnvelope) => {
  const record = cloneObject(memoryEnvelope?.record);
  const maskedOriginalContent = memoryEnvelope?.masking?.maskedOriginalContent;

  if (
    !memoryEnvelope?.masking?.isMasked ||
    !YOUNG_GENERATION_MASKABLE_CONTENT_FIELDS.includes(maskedOriginalContent?.sourceField) ||
    typeof maskedOriginalContent?.sourceField !== "string" ||
    typeof maskedOriginalContent?.value !== "string"
  ) {
    return record;
  }

  record[maskedOriginalContent.sourceField] = maskedOriginalContent.value;
  return record;
};

const createYoungGenerationInspectionMemory = (memoryEnvelope) =>
  createYoungGenerationMemory({
    record: rehydrateYoungGenerationInspectionRecord(memoryEnvelope),
    inactiveForRetrieval: memoryEnvelope?.inactiveForRetrieval,
    masking: memoryEnvelope?.masking,
    lifecycle: memoryEnvelope?.lifecycle,
  });

const createYoungGenerationView = (graph, accessMode) => {
  const normalizedAccessMode = normalizeYoungGenerationAccessMode(accessMode);

  if (normalizedAccessMode === "retrieval") {
    const { workingMemory, shortTermMemory, activeMemoryReferences } =
      getRetrievalActiveYoungGenerationState(graph);

    return freezeDeep(
      createYoungGeneration({
        workingMemory,
        shortTermMemory,
        importanceIndex: cloneArray(graph.youngGeneration.importanceIndex).filter((entry) =>
          activeMemoryReferences.has(createMemoryReferenceKey(entry)),
        ),
      }),
    );
  }

  if (
    normalizedAccessMode === "inspection" ||
    normalizedAccessMode === "administrative"
  ) {
    return freezeDeep(
      createYoungGeneration({
        workingMemory: cloneArray(graph.youngGeneration.workingMemory).map(
          createYoungGenerationInspectionMemory,
        ),
        shortTermMemory: cloneArray(graph.youngGeneration.shortTermMemory).map(
          createYoungGenerationInspectionMemory,
        ),
        importanceIndex: graph.youngGeneration.importanceIndex,
      }),
    );
  }

  throw new Error(
    `Unsupported young-generation access mode "${normalizedAccessMode}".`,
  );
};

export const createYoungGenerationInspectionView = (graph) =>
  createYoungGenerationView(graph, "inspection");

export const createYoungGenerationAdministrativeView = (graph) =>
  createYoungGenerationView(graph, "administrative");

export const createYoungGenerationRetrievalView = (graph) =>
  createYoungGenerationView(graph, "retrieval");

export const putImportanceIndexEntry = (graph, input) => {
  const nextEntry = createImportanceIndexEntry(input);
  const nextEntryKey = createMemoryReferenceKey(nextEntry);
  const nextImportanceIndex = cloneArray(graph.youngGeneration.importanceIndex).filter(
    (entry) => createMemoryReferenceKey(entry) !== nextEntryKey,
  );

  nextImportanceIndex.push(nextEntry);

  return rebuildMemoryGraph(graph, {
    importanceIndex: nextImportanceIndex,
  });
};

export const updateImportanceIndexEntry = (graph, memoryReference, update) => {
  const currentImportanceIndex = cloneArray(graph.youngGeneration.importanceIndex);
  const currentEntryIndex = currentImportanceIndex.findIndex(
    (entry) => matchesMemoryReference(entry, memoryReference),
  );

  if (currentEntryIndex === -1) {
    throw new Error(
      `No importance index entry exists for ${memoryReference.memoryKind}:${memoryReference.memoryId}`,
    );
  }

  const currentEntry = currentImportanceIndex[currentEntryIndex];
  const nextSignals = update.replaceSignals
    ? normalizeSignals(update.signals)
    : {
        ...currentEntry.signals,
        ...normalizeSignals(update.signals),
      };

  currentImportanceIndex[currentEntryIndex] = createImportanceIndexEntry({
    entryId: currentEntry.entryId,
    agentId: currentEntry.agentId,
    memoryId: currentEntry.memoryId,
    memoryKind: currentEntry.memoryKind,
    signals: nextSignals,
    lastUpdatedAt: update.lastUpdatedAt ?? currentEntry.lastUpdatedAt,
    provenance: update.provenance ?? currentEntry.provenance,
  });

  return rebuildMemoryGraph(graph, {
    importanceIndex: currentImportanceIndex,
  });
};

export const queryImportanceIndex = (graph, query = {}) => {
  const accessMode = normalizeYoungGenerationAccessMode(query.accessMode);
  const minimumImportanceScore =
    query.minImportanceScore === undefined
      ? 0
      : normalizeNumber(query.minImportanceScore);
  const minimumSignalValue =
    query.minSignalValue === undefined ? 0 : normalizeNumber(query.minSignalValue);
  const limit = Object.hasOwn(query, "limit")
    ? normalizeNonNegativeInteger(query.limit, "query.limit")
    : null;
  const activeMemoryReferences =
    accessMode === "retrieval"
      ? getRetrievalActiveYoungGenerationState(graph).activeMemoryReferences
      : null;
  const filteredEntries = cloneArray(graph.youngGeneration.importanceIndex).filter((entry) => {
    if (
      activeMemoryReferences !== null &&
      !activeMemoryReferences.has(createMemoryReferenceKey(entry))
    ) {
      return false;
    }

    if (query.agentId && entry.agentId !== query.agentId) {
      return false;
    }

    if (query.memoryId && entry.memoryId !== query.memoryId) {
      return false;
    }

    if (query.memoryKind && entry.memoryKind !== query.memoryKind) {
      return false;
    }

    if (entry.importanceScore < minimumImportanceScore) {
      return false;
    }

    if (query.signalName) {
      const signalValue = entry.signals[query.signalName] ?? 0;

      if (signalValue < minimumSignalValue) {
        return false;
      }
    }

    return true;
  });
  const sortedEntries = filteredEntries.sort((leftEntry, rightEntry) => {
    if (query.sortBy === "lastUpdatedAtDesc") {
      return (
        rightEntry.lastUpdatedAt.localeCompare(leftEntry.lastUpdatedAt) ||
        rightEntry.importanceScore - leftEntry.importanceScore
      );
    }

    return (
      rightEntry.importanceScore - leftEntry.importanceScore ||
      rightEntry.lastUpdatedAt.localeCompare(leftEntry.lastUpdatedAt)
    );
  });
  const limitedEntries = limit === null ? sortedEntries : sortedEntries.slice(0, limit);

  return freezeDeep(limitedEntries);
};

export const describeBrainLibrary = () => ({
  name: BRAIN_LIBRARY_NAME,
  modules: [...BRAIN_LIBRARY_MODULES],
  runtimeModel: "caller-authorized offline consolidation",
});

export {
  DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY,
  HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS,
  HIPPOCAMPUS_SECRET_DETECTOR_IDS,
  createHippocampusSecretRedactionPolicy,
  sanitizeHippocampusBoundaryPayload,
} from "./hippocampus-secret-policy.js";

export {
  DEFAULT_STALE_MEMORY_WEIGHTS,
  createStaleMemoryMaskingDecisions,
  evaluateStaleMemories,
} from "./stale-memory.js";

export {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
  OFFLINE_BATCH_ORDERING_STRATEGIES,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
  createOfflineBatchWorkUnit,
} from "./batch-plan.js";

export {
  OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS,
  OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
  buildOfflineConsolidationBatchPlan,
  createOfflineConsolidationPlanBuilderPreset,
  createOfflineConsolidationPlanBuilderPresetCatalog,
  createOfflineConsolidationPlanBuilderRequest,
  requestOfflineConsolidationBatchPlan,
  resolveOfflineConsolidationPlanBuilderPreset,
  validateOfflineConsolidationBatchPlan,
} from "./offline-consolidation-plan-builder.js";

export {
  executeOfflineBatchPlan,
  scheduleOfflineBatchExecution,
} from "./offline-batch-executor.js";

export {
  DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR,
  DEFAULT_WEIGHTED_PAGERANK_MAX_ITERATIONS,
  DEFAULT_WEIGHTED_PAGERANK_TOLERANCE,
  evaluateWeightedPageRank,
} from "./pagerank.js";

export {
  AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS,
  AGENT_BRAIN_API_DEFAULT_TOP_K,
  buildAgentBrainMemoryGraph,
  runAgentBrainExperiment,
} from "./agent-api.js";

export {
  resolveZepiaConsolidationTopK,
} from "./zepia-consolidation-config.js";

export { buildZepiaConsolidationPayload } from "./zepia-consolidation-payload-builder.js";

export { ingestZepiaToolCallTracking } from "./zepia-tool-call-tracking.js";

export {
  RUNTIME_AUTHORIZED_IDLE_PHASES,
  createIdleWindowReconstructionBudget,
  createIdleWindowSuggestion,
  createRuntimePhase,
  evaluateIdleWindowAuthorization,
  planIdleWindowConsolidation,
} from "./runtime-phase.js";

export { planTeamIdleConsolidationBatch } from "./team-idle-batch.js";
