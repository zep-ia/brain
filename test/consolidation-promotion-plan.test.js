import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  createIdleWindowSuggestion,
  createMemoryGraph,
  createRuntimePhase,
  planConsolidationPromotions,
} from "../src/index.js";

const createIdentity = (overrides = {}) => ({
  agentId: "agent-007",
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality.",
  safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance"],
  runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
  protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  ...overrides,
});

const createInactiveYoungMemory = (record, inactiveAt = "2026-04-12T09:30:00Z") => ({
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

const createGraph = () =>
  createMemoryGraph(createIdentity(), {
    workingMemory: [
      createInactiveYoungMemory({
        memoryId: "wm-eligible",
        content: "Promote the verified rollout insight.",
      }),
      createInactiveYoungMemory({
        memoryId: "wm-missing-target",
        content: "Target lookup should fail for this candidate.",
      }),
      createInactiveYoungMemory({
        memoryId: "wm-second",
        content: "Second working-memory source for duplicate checks.",
      }),
    ],
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-low",
        summary: "Recent note with weak promotion importance.",
      }),
    ],
    longTermMemory: [
      {
        memoryId: "wm-eligible",
        category: "semantic",
        content: "Existing durable rollout insight for the same memory identity.",
        summary: "Existing durable rollout insight for the same memory identity.",
        confidence: 0.92,
        stabilizedAt: "2026-04-12T07:45:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T07:45:00Z",
          evidence: ["wm-eligible"],
        },
        salience: {
          score: 0.82,
          signals: {
            durableSalience: 0.82,
          },
          lastEvaluatedAt: "2026-04-12T07:45:00Z",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "consolidation-0",
          policyVersion: "1.0.0",
          sourceMemoryIds: ["wm-eligible"],
        },
      },
      {
        memoryId: "ltm-existing",
        category: "semantic",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T08:00:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T08:00:00Z",
          evidence: ["ltm-existing"],
        },
        salience: {
          score: 0.8,
          signals: {
            durableSalience: 0.8,
          },
          lastEvaluatedAt: "2026-04-12T08:00:00Z",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "consolidation-1",
          policyVersion: "1.0.0",
          sourceMemoryIds: ["stm-origin"],
        },
      },
    ],
  });

const createPromotionCandidate = (overrides = {}) => {
  const defaultSignals = {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: ["importance-wm-eligible"],
        signals: {
          taskRelevance: 0.9,
          userSpecificity: 0.85,
        },
      },
      stability: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "workingMemory",
        sourceRecordIds: ["wm-eligible"],
        signals: {
          repeatedRecall: 0.8,
          crossEpisodeConsistency: 0.8,
        },
      },
    },
    oldGeneration: {
      importance: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "longTermMemory",
        sourceRecordIds: ["wm-eligible"],
        signals: {
          durableSalience: 0.7,
        },
      },
      stability: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "consolidationJournal",
        sourceRecordIds: ["consolidation-1"],
        signals: {
          reinforcementCount: 0.75,
        },
      },
    },
  };

  return {
    candidateId: "promo-wm-eligible",
    agentId: "agent-007",
    sourceMemoryId: "wm-eligible",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    targetMemoryId: "wm-eligible",
    signals: overrides.signals ?? defaultSignals,
    ...overrides,
  };
};

const createStrongSignals = (
  sourceMemoryId,
  sourceCollection = "workingMemory",
) => ({
  youngGeneration: {
    importance: {
      capturedAt: "2026-04-12T10:10:00Z",
      sourceCollection: "importanceIndex",
      sourceRecordIds: [`importance-${sourceMemoryId}`],
      signals: {
        taskRelevance: 0.91,
        userSpecificity: 0.87,
      },
    },
    stability: {
      capturedAt: "2026-04-12T10:10:00Z",
      sourceCollection,
      sourceRecordIds: [sourceMemoryId],
      signals: {
        repeatedRecall: 0.84,
        crossEpisodeConsistency: 0.82,
      },
    },
  },
  oldGeneration: {
    importance: {
      capturedAt: "2026-04-12T10:10:00Z",
      sourceCollection: "longTermMemory",
      sourceRecordIds: [sourceMemoryId],
      signals: {
        durableSalience: 0.76,
      },
    },
    stability: {
      capturedAt: "2026-04-12T10:10:00Z",
      sourceCollection: "consolidationJournal",
      sourceRecordIds: [`consolidation-${sourceMemoryId}`],
      signals: {
        reinforcementCount: 0.72,
      },
    },
  },
});

const createLowImportanceSignals = (
  sourceMemoryId,
  sourceCollection = "shortTermMemory",
) => ({
  youngGeneration: {
    importance: {
      capturedAt: "2026-04-12T10:12:00Z",
      sourceCollection: "importanceIndex",
      sourceRecordIds: [`importance-${sourceMemoryId}`],
      signals: {
        taskRelevance: 0.4,
      },
    },
    stability: {
      capturedAt: "2026-04-12T10:12:00Z",
      sourceCollection,
      sourceRecordIds: [sourceMemoryId],
      signals: {
        repeatedRecall: 0.83,
        crossEpisodeConsistency: 0.8,
      },
    },
  },
});

const createMixedEligibilityGraph = () =>
  createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "This memory remains in the live working set.",
        },
      },
      createInactiveYoungMemory({
        memoryId: "wm-ready",
        content: "Promote this parked memory during authorized offline consolidation.",
      }),
      createInactiveYoungMemory({
        memoryId: "wm-missing-target",
        content: "This parked memory references a missing durable target.",
      }),
    ],
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-low",
        summary: "This parked note is too weak to promote.",
      }),
    ],
    longTermMemory: [
      {
        memoryId: "wm-ready",
        category: "semantic",
        content: "Existing durable memory for the parked promotion candidate.",
        summary: "Existing durable memory for the parked promotion candidate.",
        confidence: 0.91,
        stabilizedAt: "2026-04-12T08:15:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T08:15:00Z",
          evidence: ["wm-ready"],
        },
        salience: {
          score: 0.8,
          signals: {
            durableSalience: 0.8,
          },
          lastEvaluatedAt: "2026-04-12T08:15:00Z",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "consolidation-wm-ready",
          policyVersion: "1.0.0",
          sourceMemoryIds: ["wm-ready"],
        },
      },
    ],
  });

const createMixedEligibilityCandidates = () => [
  createPromotionCandidate({
    candidateId: "promo-wm-ready",
    sourceMemoryId: "wm-ready",
    targetMemoryId: "wm-ready",
    signals: createStrongSignals("wm-ready"),
  }),
  createPromotionCandidate({
    candidateId: "promo-wm-live",
    sourceMemoryId: "wm-live",
    targetMemoryId: null,
    signals: createStrongSignals("wm-live"),
  }),
  createPromotionCandidate({
    candidateId: "promo-stm-low",
    sourceMemoryId: "stm-low",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    targetMemoryId: null,
    signals: createLowImportanceSignals("stm-low"),
  }),
  createPromotionCandidate({
    candidateId: "promo-wm-missing-target",
    sourceMemoryId: "wm-missing-target",
    targetMemoryId: "wm-missing-target",
    signals: createStrongSignals("wm-missing-target"),
  }),
];

test("promotion planning selects only policy-eligible candidates during an authorized idle window", () => {
  const graph = createGraph();
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    teamIdle: true,
    candidates: [
      createPromotionCandidate(),
      createPromotionCandidate({
        candidateId: "promo-stm-low",
        sourceMemoryId: "stm-low",
        sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-stm-low"],
              signals: {
                taskRelevance: 0.4,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: ["stm-low"],
              signals: {
                repeatedRecall: 0.8,
              },
            },
          },
        },
      }),
      createPromotionCandidate({
        candidateId: "promo-wm-missing-target",
        sourceMemoryId: "wm-missing-target",
        targetMemoryId: "wm-missing-target",
      }),
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.policyId, "default-consolidation-promotion-policy");
  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 2);
  assert.equal(plan.batchEligible, true);
  assert.equal(plan.selectionMode, "offline-promotion-selection");
  assert.equal(plan.selectedPromotions[0].candidate.candidateId, "promo-wm-eligible");
  assert.equal(plan.selectedPromotions[0].sourceCollection, "workingMemory");
  assert.equal(plan.selectedPromotions[0].targetMemoryId, "wm-eligible");
  assert.equal(
    plan.selectedPromotions[0].targetNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
  assert.equal(plan.selectedPromotions[0].outputMemoryId, "wm-eligible");
  assert.equal(
    plan.selectedPromotions[0].outputNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
  assert.equal(plan.selectedPromotions[0].evaluation.eligible, true);
  assert.equal(
    plan.selectedPromotions[0].evaluation.criteriaBySignalPath["oldGeneration.importance"]
      .available,
    true,
  );

  const deferredById = Object.fromEntries(
    plan.deferredCandidates.map((entry) => [entry.candidate.candidateId, entry]),
  );

  assert.equal(deferredById["promo-stm-low"].deferredReason, "policy-ineligible");
  assert.equal(deferredById["promo-stm-low"].evaluation.eligible, false);
  assert.ok(
    deferredById["promo-stm-low"].evaluation.blockedReasons.includes(
      "below-threshold-youngGeneration.importance",
    ),
  );
  assert.equal(
    deferredById["promo-wm-missing-target"].deferredReason,
    "missing-target-memory",
  );
  assert.equal(deferredById["promo-wm-missing-target"].evaluation, null);
});

test("promotion planning filters mixed memories down to runtime-authorized batch-eligible consolidation candidates", () => {
  const plan = planConsolidationPromotions(createMixedEligibilityGraph(), {
    runtimePhase: createRuntimePhase("sleep"),
    teamIdle: true,
    candidates: createMixedEligibilityCandidates(),
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.authorization.runtimePhase.value, "sleep");
  assert.equal(plan.authorization.teamIdle, true);
  assert.equal(plan.promotionCandidateCount, 4);
  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 3);
  assert.equal(plan.batchEligible, true);
  assert.deepEqual(
    plan.selectedPromotions.map((selection) => selection.candidate.candidateId),
    ["promo-wm-ready"],
  );
  assert.deepEqual(
    plan.selectedPromotions.map((selection) => selection.candidate.sourceMemoryId),
    ["wm-ready"],
  );
  assert.ok(
    plan.selectedPromotions.every((selection) => selection.evaluation.eligible),
  );

  const deferredById = Object.fromEntries(
    plan.deferredCandidates.map((entry) => [entry.candidate.candidateId, entry]),
  );

  assert.equal(deferredById["promo-wm-live"].deferredReason, "active-set-memory");
  assert.equal(deferredById["promo-stm-low"].deferredReason, "policy-ineligible");
  assert.equal(
    deferredById["promo-wm-missing-target"].deferredReason,
    "missing-target-memory",
  );
});

test("promotion planning leaves mixed memories unselected when runtime authorization is blocked", () => {
  const plan = planConsolidationPromotions(createMixedEligibilityGraph(), {
    runtimePhase: createRuntimePhase("active"),
    teamIdle: true,
    inactivitySuggestion: createIdleWindowSuggestion({
      inactivityMs: 120_000,
      idleThresholdMs: 15_000,
      note: "Quiet period detected but runtime never entered an idle phase.",
    }),
    candidates: createMixedEligibilityCandidates(),
  });

  assert.equal(plan.authorization.eligible, false);
  assert.equal(plan.authorization.blockedReason, "runtime-phase-not-idle-window");
  assert.equal(plan.authorization.inactivitySuggestion.thresholdReached, true);
  assert.equal(
    plan.authorization.inactivitySuggestion.authorizesConsolidation,
    false,
  );
  assert.equal(plan.promotionCandidateCount, 4);
  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 4);
  assert.equal(plan.batchEligible, false);

  const deferredById = Object.fromEntries(
    plan.deferredCandidates.map((entry) => [entry.candidate.candidateId, entry]),
  );

  assert.equal(
    deferredById["promo-wm-ready"].deferredReason,
    "runtime-phase-not-idle-window",
  );
  assert.equal(
    deferredById["promo-stm-low"].deferredReason,
    "runtime-phase-not-idle-window",
  );
  assert.equal(deferredById["promo-wm-live"].deferredReason, "active-set-memory");
  assert.equal(
    deferredById["promo-wm-missing-target"].deferredReason,
    "missing-target-memory",
  );
});

test("promotion planning auto-resolves omitted target ids for reruns of the same durable memory", () => {
  const graph = createGraph();
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      createPromotionCandidate({
        candidateId: "promo-rerun-auto-resolve",
        targetMemoryId: null,
      }),
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 0);
  assert.equal(
    plan.selectedPromotions[0].candidate.candidateId,
    "promo-rerun-auto-resolve",
  );
  assert.equal(plan.selectedPromotions[0].candidate.targetMemoryId, "wm-eligible");
  assert.equal(plan.selectedPromotions[0].evaluation.targetMemoryId, "wm-eligible");
  assert.equal(plan.selectedPromotions[0].targetMemoryId, "wm-eligible");
  assert.equal(
    plan.selectedPromotions[0].targetNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
  assert.equal(plan.selectedPromotions[0].outputMemoryId, "wm-eligible");
  assert.equal(
    plan.selectedPromotions[0].outputNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
});

test("promotion planning defers omitted target ids when logical identity points at a different stable memory id", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      createInactiveYoungMemory({
        memoryId: "wm-conflict",
        content: "Promote the verified rollout insight.",
      }),
    ],
    longTermMemory: [
      {
        memoryId: "ltm-conflict",
        category: "semantic",
        content: "Promote the verified rollout insight.",
        summary: "Promote the verified rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T08:00:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T08:00:00Z",
          evidence: ["wm-conflict"],
        },
        salience: {
          score: 0.8,
          signals: {
            durableSalience: 0.8,
          },
          lastEvaluatedAt: "2026-04-12T08:00:00Z",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "consolidation-conflict",
          policyVersion: "1.0.0",
          sourceMemoryIds: ["wm-conflict"],
        },
      },
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-conflicting-identity",
        agentId: "agent-007",
        sourceMemoryId: "wm-conflict",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-conflict"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-conflict"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "conflicting-logical-identity",
  );
  assert.equal(plan.deferredCandidates[0].targetMemoryId, "ltm-conflict");
  assert.equal(
    plan.deferredCandidates[0].targetNodeId,
    "old/agent-007/long_term_memory/ltm-conflict",
  );
  assert.ok(plan.deferredCandidates[0].abort);
  assert.equal(plan.deferredCandidates[0].abort.stage, "deduplication");
  assert.equal(plan.deferredCandidates[0].abort.canonicalField, "memoryId");
  assert.equal(
    plan.deferredCandidates[0].abort.attemptedField,
    "logicalIdentityMatch.matchedMemoryId",
  );
  assert.equal(plan.deferredCandidates[0].abort.expectedValue, "wm-conflict");
  assert.equal(plan.deferredCandidates[0].abort.actualValue, "ltm-conflict");
});

test("promotion planning defers record collapse when deduplication would replace the canonical durable node id", () => {
  const graph = structuredClone(
    createMemoryGraph(createIdentity(), {
      workingMemory: [
        createInactiveYoungMemory({
          memoryId: "wm-node-conflict",
          content: "Promote the same durable insight without changing the canonical node.",
        }),
      ],
      longTermMemory: [
        {
          memoryId: "wm-node-conflict",
          category: "semantic",
          content: "Promote the same durable insight without changing the canonical node.",
          summary: "Promote the same durable insight without changing the canonical node.",
          confidence: 0.89,
          stabilizedAt: "2026-04-12T08:10:00Z",
          provenance: {
            source: "offline-consolidation",
            observedAt: "2026-04-12T08:10:00Z",
            evidence: ["wm-node-conflict"],
          },
          salience: {
            score: 0.79,
            signals: {
              durableSalience: 0.79,
            },
            lastEvaluatedAt: "2026-04-12T08:10:00Z",
          },
          consolidationState: {
            status: "promoted",
            lastOperation: "promote",
            journalRecordId: "consolidation-node-conflict",
            policyVersion: "1.0.0",
            sourceMemoryIds: ["wm-node-conflict"],
          },
        },
      ],
    }),
  );

  graph.oldGeneration.longTermMemory[0].nodeId =
    "old/agent-007/long_term_memory/wm-node-conflict-collapsed";

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-node-conflict",
        agentId: "agent-007",
        sourceMemoryId: "wm-node-conflict",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-node-conflict",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:20:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-node-conflict"],
              signals: {
                taskRelevance: 0.95,
                userSpecificity: 0.87,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:20:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-node-conflict"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.83,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "canonical-id-rewrite-attempt",
  );
  assert.ok(plan.deferredCandidates[0].abort);
  assert.equal(plan.deferredCandidates[0].abort.stage, "deduplication");
  assert.equal(plan.deferredCandidates[0].abort.canonicalField, "nodeId");
  assert.equal(
    plan.deferredCandidates[0].abort.attemptedField,
    "targetNodeId",
  );
  assert.equal(
    plan.deferredCandidates[0].abort.expectedValue,
    "old/agent-007/long_term_memory/wm-node-conflict",
  );
  assert.equal(
    plan.deferredCandidates[0].abort.actualValue,
    "old/agent-007/long_term_memory/wm-node-conflict-collapsed",
  );
});

test("promotion planning excludes active-set young memories even when another parked memory is eligible", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "This memory is still part of the live working set.",
        },
      },
    ],
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-parked",
        summary: "This memory was masked out of retrieval and is ready for offline review.",
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-live",
        agentId: "agent-007",
        sourceMemoryId: "wm-live",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:12:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-live"],
              signals: {
                taskRelevance: 0.96,
                userSpecificity: 0.9,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:12:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-live"],
              signals: {
                repeatedRecall: 0.88,
                crossEpisodeConsistency: 0.82,
              },
            },
          },
        },
      },
      {
        candidateId: "promo-stm-parked",
        agentId: "agent-007",
        sourceMemoryId: "stm-parked",
        sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:15:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-stm-parked"],
              signals: {
                taskRelevance: 0.9,
                userSpecificity: 0.84,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:15:00Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: ["stm-parked"],
              signals: {
                repeatedRecall: 0.83,
                crossEpisodeConsistency: 0.8,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.selectedPromotions[0].candidate.candidateId, "promo-stm-parked");
  assert.equal(plan.selectedPromotions[0].sourceCollection, "shortTermMemory");
  assert.equal(
    plan.selectedPromotions.some(
      (selection) => selection.candidate.candidateId === "promo-wm-live",
    ),
    false,
  );
  assert.equal(plan.deferredCount, 1);
  assert.equal(plan.deferredCandidates[0].candidate.candidateId, "promo-wm-live");
  assert.equal(plan.deferredCandidates[0].deferredReason, "active-set-memory");
});

test("promotion planning defers rewrite attempts that target a different durable memory id", () => {
  const graph = createGraph();
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      createPromotionCandidate({
        candidateId: "promo-rewrite-attempt",
        targetMemoryId: "ltm-existing",
      }),
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "memory-id-rewrite-attempt",
  );
  assert.equal(plan.deferredCandidates[0].evaluation, null);
  assert.equal(plan.deferredCandidates[0].sourceCollection, "workingMemory");
  assert.equal(plan.deferredCandidates[0].targetNodeId, null);
  assert.equal(plan.deferredCandidates[0].outputMemoryId, "wm-eligible");
  assert.equal(
    plan.deferredCandidates[0].outputNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
});

test("promotion planning refuses memory-id mutations without changing retained graph ids or deferred output identities", () => {
  const graph = structuredClone(createGraph());
  const retainedYoungMemoryIds = graph.youngGeneration.workingMemory.map(
    (memory) => memory.record.memoryId,
  );
  const retainedOldMemoryIds = graph.oldGeneration.longTermMemory.map(
    (memory) => memory.memoryId,
  );

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      createPromotionCandidate({
        candidateId: "promo-rewrite-refused-state",
        targetMemoryId: "ltm-existing",
      }),
    ],
  });

  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "memory-id-rewrite-attempt",
  );
  assert.equal(
    plan.deferredCandidates[0].candidate.sourceMemoryId,
    "wm-eligible",
  );
  assert.equal(plan.deferredCandidates[0].targetMemoryId, "ltm-existing");
  assert.equal(plan.deferredCandidates[0].outputMemoryId, "wm-eligible");
  assert.equal(
    plan.deferredCandidates[0].outputNodeId,
    "old/agent-007/long_term_memory/wm-eligible",
  );
  assert.equal(plan.deferredCandidates[0].abort?.expectedValue, "wm-eligible");
  assert.equal(plan.deferredCandidates[0].abort?.actualValue, "ltm-existing");
  assert.deepEqual(
    graph.youngGeneration.workingMemory.map((memory) => memory.record.memoryId),
    retainedYoungMemoryIds,
  );
  assert.deepEqual(
    graph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    retainedOldMemoryIds,
  );
});

test("promotion planning keeps inactivity heuristics advisory when runtime is still active", () => {
  const graph = createGraph();
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("active"),
    teamIdle: true,
    inactivitySuggestion: createIdleWindowSuggestion({
      inactivityMs: 60_000,
      idleThresholdMs: 15_000,
      note: "No live work detected",
    }),
    candidates: [createPromotionCandidate()],
  });

  assert.equal(plan.authorization.eligible, false);
  assert.equal(plan.authorization.blockedReason, "runtime-phase-not-idle-window");
  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(plan.batchEligible, false);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "runtime-phase-not-idle-window",
  );
  assert.equal(plan.deferredCandidates[0].evaluation.eligible, true);
  assert.equal(plan.authorization.inactivitySuggestion.thresholdReached, true);
  assert.equal(
    plan.authorization.inactivitySuggestion.authorizesConsolidation,
    false,
  );
});

test("promotion planning defers cross-agent and duplicate candidates instead of merging agent identity", () => {
  const graph = createGraph();
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [
      createPromotionCandidate(),
      createPromotionCandidate({
        candidateId: "promo-cross-agent",
        agentId: "agent-999",
        sourceMemoryId: "wm-second",
      }),
      createPromotionCandidate({
        candidateId: "promo-duplicate-source",
      }),
      createPromotionCandidate({
        candidateId: "promo-wm-eligible",
        sourceMemoryId: "wm-second",
        targetMemoryId: null,
      }),
    ],
  });

  assert.equal(plan.authorization.eligible, true);
  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 3);

  const deferredReasons = new Map(
    plan.deferredCandidates.map((entry) => [
      entry.candidate.candidateId,
      entry.deferredReason,
    ]),
  );

  assert.equal(deferredReasons.get("promo-cross-agent"), "cross-agent-candidate");
  assert.equal(
    deferredReasons.get("promo-duplicate-source"),
    "duplicate-source-reference",
  );
  assert.equal(deferredReasons.get("promo-wm-eligible"), "duplicate-candidate-id");
});
