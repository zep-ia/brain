import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT,
  CONSOLIDATION_PIPELINE_ABORT_CONTRACT,
  LONG_TERM_MEMORY_SCHEMA,
  MEMORY_ITEM_IDENTITY_SCHEMA,
  MEMORY_NODE_KINDS,
  OLD_GENERATION_IDENTIFIER_SCHEMA,
  YOUNG_GENERATION_MEMORY_RECORD_SCHEMA,
  createArchivedMemory,
  createMemoryGraph,
  createRuntimePhase,
  createLongTermMemory,
  createYoungGenerationMemory,
  deserializeLongTermMemoryEntry,
  isConsolidationPipelineAbortError,
  planConsolidationPromotions,
  saveOldGenerationGraphState,
  serializePromotionSelectionToLongTermMemoryEntry,
} from "../src/index.js";

const createLongTermMemoryInput = (overrides = {}) => ({
  agentId: "agent-007",
  memoryId: "ltm-1",
  category: "semantic",
  content: "Legal review is required before launch.",
  summary: "Launch requires legal review.",
  confidence: 0.84,
  stabilizedAt: "2026-04-12T09:00:00Z",
  provenance: {
    source: "conversation",
    observedAt: "2026-04-12T09:00:00Z",
    evidence: ["turn-19"],
  },
  ...overrides,
});

const createArchivedYoungMemoryInput = (overrides = {}) => ({
  archiveId: "archive-young-1",
  agentId: "agent-007",
  originalGeneration: MEMORY_NODE_KINDS.youngGeneration,
  originalMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  originalMemoryId: "stm-archive-1",
  archivalReason: "low_value_stale_memory",
  archivedAt: "2026-04-12T09:05:00Z",
  snapshot: {
    record: {
      memoryId: "stm-archive-1",
      summary: "Archive this inactive planning note.",
      provenance: {
        source: "conversation",
        observedAt: "2026-04-12T09:00:00Z",
        evidence: ["turn-archive-1"],
      },
    },
    inactiveForRetrieval: true,
    recoveryContext: {
      sourceMemoryId: "stm-archive-1",
    },
  },
  provenance: {
    source: "idle-window",
    observedAt: "2026-04-12T09:05:00Z",
    evidence: ["archive-archive-young-1"],
  },
  ...overrides,
});

const createArchivedOldMemoryInput = (overrides = {}) => ({
  archiveId: "archive-old-1",
  agentId: "agent-007",
  originalGeneration: MEMORY_NODE_KINDS.oldGeneration,
  originalMemoryKind: MEMORY_NODE_KINDS.longTermMemory,
  originalMemoryId: "ltm-archive-1",
  originalNodeId: "old/agent-007/long_term_memory/ltm-archive-1",
  archivalReason: "retired_policy_snapshot",
  archivedAt: "2026-04-12T09:15:00Z",
  snapshot: {
    memoryId: "ltm-archive-1",
    category: "semantic",
    content: "Retired rollout policy kept for audit recovery.",
    summary: "Retired rollout policy.",
    provenance: {
      source: "offline-consolidation",
      observedAt: "2026-04-12T09:00:00Z",
      evidence: ["ltm-archive-1"],
    },
    recoveryContext: {
      sourceMemoryId: "ltm-archive-1",
    },
  },
  provenance: {
    source: "idle-window",
    observedAt: "2026-04-12T09:15:00Z",
    evidence: ["archive-archive-old-1"],
  },
  ...overrides,
});

const createIdentity = (overrides = {}) => ({
  agentId: "agent-007",
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality.",
  safetyConstraints: [
    "never overwrite identity",
    "stay offline while consolidating",
  ],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance"],
  runtimeInvariants: {
    deployment: "sandbox",
    tenant: "zep",
  },
  protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  ...overrides,
});

const createInactiveYoungMemory = (record, inactiveAt = "2026-04-12T10:00:00Z") => ({
  record,
  inactiveForRetrieval: true,
  masking: {
    maskedAt: inactiveAt,
    maskedBy: "offline-consolidation",
    reason: "queued-for-offline-consolidation",
  },
  lifecycle: {
    state: "inactive",
    inactiveAt,
    inactiveReason: "queued-for-offline-consolidation",
  },
});

const createPromotionCandidate = (overrides = {}) => ({
  candidateId: "promo-stm-identity-1",
  agentId: "agent-007",
  sourceMemoryId: "stm-identity-1",
  sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  targetMemoryId: null,
  signals: {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-12T10:05:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: ["importance-stm-identity-1"],
        signals: {
          taskRelevance: 0.94,
          userSpecificity: 0.86,
        },
      },
      stability: {
        capturedAt: "2026-04-12T10:05:00Z",
        sourceCollection: "shortTermMemory",
        sourceRecordIds: ["stm-identity-1"],
        signals: {
          repeatedRecall: 0.82,
          crossEpisodeConsistency: 0.84,
        },
      },
    },
  },
  ...overrides,
});

test("memory identity schema defines one immutable stable memoryId contract", () => {
  assert.equal(MEMORY_ITEM_IDENTITY_SCHEMA.stableIdField, "memoryId");
  assert.equal(MEMORY_ITEM_IDENTITY_SCHEMA.mutable, false);
  assert.equal(MEMORY_ITEM_IDENTITY_SCHEMA.regeneration, "forbidden");
  assert.equal(MEMORY_ITEM_IDENTITY_SCHEMA.reassignment, "forbidden");
  assert.ok(
    MEMORY_ITEM_IDENTITY_SCHEMA.rules.some((rule) =>
      rule.includes('stable "memoryId"'),
    ),
  );
  assert.ok(
    MEMORY_ITEM_IDENTITY_SCHEMA.rules.some((rule) =>
      rule.includes("must never be regenerated"),
    ),
  );
  assert.ok(
    MEMORY_ITEM_IDENTITY_SCHEMA.rules.some((rule) =>
      rule.includes("must never be reassigned"),
    ),
  );
});

test("consolidation identity invariant publishes the shared canonical-id abort contract", () => {
  assert.equal(
    CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.invariantId,
    "agent-scoped-canonical-id-preservation",
  );
  assert.deepEqual(
    CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.protectedCanonicalFields,
    ["agentId", "memoryId", "nodeId"],
  );
  assert.deepEqual(CONSOLIDATION_PIPELINE_ABORT_CONTRACT.reasons, [
    "canonical-id-mutation",
  ]);
  assert.deepEqual(CONSOLIDATION_PIPELINE_ABORT_CONTRACT.stages, [
    "planning",
    "deduplication",
    "rewrite",
    "serialization",
    "merge",
    "persistence",
  ]);
  assert.equal(
    CONSOLIDATION_PIPELINE_ABORT_CONTRACT.safeAction,
    "abort-offline-pipeline-before-write",
  );
});

test("young and old generation schemas reuse the canonical stable memoryId rules", () => {
  assert.deepEqual(YOUNG_GENERATION_MEMORY_RECORD_SCHEMA.requiredFields, ["memoryId"]);
  assert.equal(
    YOUNG_GENERATION_MEMORY_RECORD_SCHEMA.fields.memoryId.identityField,
    true,
  );
  assert.equal(
    YOUNG_GENERATION_MEMORY_RECORD_SCHEMA.fields.memoryId.regeneration,
    "forbidden",
  );
  assert.equal(
    YOUNG_GENERATION_MEMORY_RECORD_SCHEMA.fields.memoryId.reassignment,
    "forbidden",
  );
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.memoryId.identityField, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.memoryId.mutable, false);
  assert.equal(
    LONG_TERM_MEMORY_SCHEMA.fields.memoryId.regeneration,
    "forbidden",
  );
  assert.equal(
    LONG_TERM_MEMORY_SCHEMA.fields.memoryId.reassignment,
    "forbidden",
  );
  assert.equal(OLD_GENERATION_IDENTIFIER_SCHEMA.memoryItemStableIdField, "memoryId");
});

test("memory constructors require the canonical stable memoryId field", () => {
  assert.throws(
    () =>
      createYoungGenerationMemory({
        content: "Missing stable memory id should be rejected.",
      }),
    /Young-generation memory record\.memoryId must be a string/,
  );

  assert.throws(
    () =>
      createLongTermMemory(
        createLongTermMemoryInput({
          memoryId: "   ",
        }),
      ),
    /Long-term memory memoryId must not be empty/,
  );
});

test("memory constructors preserve normalized stable memory ids without regeneration", () => {
  const youngMemory = createYoungGenerationMemory({
    memoryId: " wm-live ",
    content: "Track the legal approval dependency.",
  });
  const longTermMemory = createLongTermMemory(
    createLongTermMemoryInput({
      memoryId: " ltm-live ",
    }),
  );

  assert.equal(youngMemory.record.memoryId, "wm-live");
  assert.equal(longTermMemory.memoryId, "ltm-live");
  assert.equal(longTermMemory.nodeId, "old/agent-007/long_term_memory/ltm-live");
});

test("offline promotion preserves one stable memoryId from young generation into old generation", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: " stm-identity-1 ",
        summary: "Promote the verified dependency recap into durable memory.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:55:00Z",
          evidence: ["turn-31"],
        },
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate()],
  });

  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 0);
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].record.memoryId,
    "stm-identity-1",
  );
  assert.equal(
    plan.selectedPromotions[0].candidate.sourceMemoryId,
    "stm-identity-1",
  );
  assert.equal(plan.selectedPromotions[0].targetMemoryId, null);
  assert.equal(plan.selectedPromotions[0].outputMemoryId, "stm-identity-1");
  assert.equal(
    plan.selectedPromotions[0].outputNodeId,
    "old/agent-007/long_term_memory/stm-identity-1",
  );

  const entry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.shortTermMemory[0],
  });
  const restoredMemory = deserializeLongTermMemoryEntry(
    JSON.parse(JSON.stringify(entry)),
  );

  assert.equal(entry.content.memoryId, "stm-identity-1");
  assert.equal(
    entry.metadata.nodeId,
    "old/agent-007/long_term_memory/stm-identity-1",
  );
  assert.deepEqual(entry.metadata.consolidationState.sourceMemoryIds, [
    "stm-identity-1",
  ]);
  assert.equal(restoredMemory.memoryId, "stm-identity-1");
  assert.equal(
    restoredMemory.nodeId,
    "old/agent-007/long_term_memory/stm-identity-1",
  );
  assert.deepEqual(restoredMemory.consolidationState.sourceMemoryIds, [
    "stm-identity-1",
  ]);
});

test("successful young-to-old promotion propagates the canonical memoryId into old-generation state", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: " stm-identity-1 ",
        summary: "Promote the verified dependency recap into durable memory.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:55:00Z",
          evidence: ["turn-31"],
        },
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate()],
  });
  const promotedMemory = deserializeLongTermMemoryEntry(
    JSON.parse(
      JSON.stringify(
        serializePromotionSelectionToLongTermMemoryEntry({
          selection: plan.selectedPromotions[0],
          memory: graph.youngGeneration.shortTermMemory[0],
        }),
      ),
    ),
  );
  const promotedGraph = createMemoryGraph(createIdentity(), {
    shortTermMemory: graph.youngGeneration.shortTermMemory,
    longTermMemory: [promotedMemory],
  });
  const savedOldGenerationState = saveOldGenerationGraphState(promotedGraph);

  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(promotedGraph.oldGeneration.longTermMemory.length, 1);
  assert.equal(
    promotedGraph.oldGeneration.longTermMemory[0].memoryId,
    "stm-identity-1",
  );
  assert.equal(
    promotedGraph.oldGeneration.longTermMemory[0].nodeId,
    "old/agent-007/long_term_memory/stm-identity-1",
  );
  assert.deepEqual(
    promotedGraph.oldGeneration.longTermMemory[0].consolidationState.sourceMemoryIds,
    ["stm-identity-1"],
  );
  assert.equal(
    savedOldGenerationState.oldGeneration.longTermMemory[0].memoryId,
    "stm-identity-1",
  );
  assert.equal(
    savedOldGenerationState.oldGeneration.longTermMemory[0].nodeId,
    "old/agent-007/long_term_memory/stm-identity-1",
  );
  assert.deepEqual(
    savedOldGenerationState.oldGeneration.longTermMemory[0].consolidationState
      .sourceMemoryIds,
    ["stm-identity-1"],
  );
});

test("normal consolidation preserves all pre-existing output memory ids through persisted output", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: " stm-identity-1 ",
        summary: "Promote the verified dependency recap into durable memory.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:55:00Z",
          evidence: ["turn-31"],
        },
      }),
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "ltm-existing-1",
        content: "Existing durable rollout policy remains valid.",
        summary: "Keep the rollout policy.",
      }),
      createLongTermMemoryInput({
        memoryId: "ltm-existing-2",
        content: "Existing customer preference note remains durable.",
        summary: "Keep the customer preference note.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["turn-27"],
        },
      }),
    ],
  });
  const preExistingOutputMemoryIds = [
    ...graph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    graph.youngGeneration.shortTermMemory[0].record.memoryId,
  ];
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate()],
  });

  assert.equal(plan.selectedPromotionCount, 1);
  assert.deepEqual(preExistingOutputMemoryIds, [
    "ltm-existing-1",
    "ltm-existing-2",
    "stm-identity-1",
  ]);
  assert.equal(plan.selectedPromotions[0].outputMemoryId, "stm-identity-1");

  const entry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.shortTermMemory[0],
  });
  const promotedMemory = deserializeLongTermMemoryEntry(
    JSON.parse(JSON.stringify(entry)),
  );
  const consolidatedGraph = createMemoryGraph(createIdentity(), {
    shortTermMemory: graph.youngGeneration.shortTermMemory,
    longTermMemory: [...graph.oldGeneration.longTermMemory, promotedMemory],
  });
  const savedOldGenerationState = saveOldGenerationGraphState(consolidatedGraph);

  assert.equal(entry.content.memoryId, "stm-identity-1");
  assert.deepEqual(
    consolidatedGraph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    preExistingOutputMemoryIds,
  );
  assert.deepEqual(
    savedOldGenerationState.oldGeneration.longTermMemory.map(
      (memory) => memory.memoryId,
    ),
    preExistingOutputMemoryIds,
  );
});

test("consolidation flow rejects regenerated memory ids during planning and serialization", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-identity-1",
        summary: "Promote the verified dependency recap into durable memory.",
      }),
    ],
  });
  const rewritePlan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [
      createPromotionCandidate({
        candidateId: "promo-stm-identity-rewrite",
        targetMemoryId: "ltm-regenerated",
      }),
    ],
  });

  assert.equal(rewritePlan.selectedPromotionCount, 0);
  assert.equal(rewritePlan.deferredCount, 1);
  assert.equal(
    rewritePlan.deferredCandidates[0].deferredReason,
    "memory-id-rewrite-attempt",
  );
  assert.equal(rewritePlan.deferredCandidates[0].abort?.reason, "canonical-id-mutation");
  assert.equal(rewritePlan.deferredCandidates[0].abort?.stage, "planning");
  assert.equal(rewritePlan.deferredCandidates[0].abort?.canonicalField, "memoryId");
  assert.equal(
    rewritePlan.deferredCandidates[0].abort?.attemptedField,
    "targetMemoryId",
  );
  assert.equal(
    rewritePlan.deferredCandidates[0].abort?.expectedValue,
    "stm-identity-1",
  );
  assert.equal(
    rewritePlan.deferredCandidates[0].abort?.actualValue,
    "ltm-regenerated",
  );

  const validPlan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [createPromotionCandidate()],
  });

  assert.equal(validPlan.selectedPromotionCount, 1);
  let abortError = null;

  try {
    serializePromotionSelectionToLongTermMemoryEntry({
      selection: validPlan.selectedPromotions[0],
      memory: graph.youngGeneration.shortTermMemory[0],
      memoryId: "ltm-regenerated",
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.match(
    abortError.message,
    /cannot rewrite source memoryId "stm-identity-1" to output memoryId "ltm-regenerated"/,
  );
  assert.equal(abortError.abort.reason, "canonical-id-mutation");
  assert.equal(abortError.abort.stage, "serialization");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(abortError.abort.attemptedField, "output memoryId");
});

test("archived-memory compaction preserves the original memoryId across the archived snapshot", () => {
  const archivedYoungMemory = createArchivedMemory(createArchivedYoungMemoryInput());
  const archivedOldMemory = createArchivedMemory(createArchivedOldMemoryInput());

  assert.equal(archivedYoungMemory.originalMemoryId, "stm-archive-1");
  assert.equal(archivedYoungMemory.snapshot.record.memoryId, "stm-archive-1");
  assert.equal(
    archivedYoungMemory.snapshot.recoveryContext.sourceMemoryId,
    "stm-archive-1",
  );
  assert.equal(archivedOldMemory.originalMemoryId, "ltm-archive-1");
  assert.equal(archivedOldMemory.snapshot.memoryId, "ltm-archive-1");
  assert.equal(
    archivedOldMemory.snapshot.recoveryContext.sourceMemoryId,
    "ltm-archive-1",
  );
});

test("archived-memory compaction rejects young-generation snapshot memoryId rewrites", () => {
  assert.throws(
    () =>
      createArchivedMemory(
        createArchivedYoungMemoryInput({
          snapshot: {
            record: {
              memoryId: "stm-rewritten",
              summary: "Archive this inactive planning note.",
              provenance: {
                source: "conversation",
                observedAt: "2026-04-12T09:00:00Z",
                evidence: ["turn-archive-1"],
              },
            },
            inactiveForRetrieval: true,
          },
        }),
      ),
    /snapshot\.record\.memoryId "stm-rewritten" must preserve originalMemoryId "stm-archive-1"/,
  );
});

test("archived-memory compaction rejects recovery-context memoryId rewrites", () => {
  assert.throws(
    () =>
      createArchivedMemory(
        createArchivedOldMemoryInput({
          snapshot: {
            memoryId: "ltm-archive-1",
            category: "semantic",
            content: "Retired rollout policy kept for audit recovery.",
            summary: "Retired rollout policy.",
            provenance: {
              source: "offline-consolidation",
              observedAt: "2026-04-12T09:00:00Z",
              evidence: ["ltm-archive-1"],
            },
            recoveryContext: {
              sourceMemoryId: "ltm-rewritten",
            },
          },
        }),
      ),
    /snapshot\.recoveryContext\.sourceMemoryId "ltm-rewritten" must preserve originalMemoryId "ltm-archive-1"/,
  );
});
