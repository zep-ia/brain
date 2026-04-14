import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSOLIDATION_PROMOTION_INPUT_SCHEMA,
  CONSOLIDATION_PROMOTION_POLICY_SCHEMA,
  CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA,
  CONSOLIDATION_SIGNAL_DIMENSIONS,
  CONSOLIDATION_SIGNAL_GENERATIONS,
  DEFAULT_CONSOLIDATION_PROMOTION_POLICY,
  MEMORY_NODE_KINDS,
  PROTECTED_IDENTITY_FIELDS,
  createConsolidationPromotionCandidate,
  createConsolidationPromotionPolicy,
  createConsolidationSignalCapture,
  evaluateConsolidationPromotionEligibility,
  evaluateConsolidationPromotionCandidate,
} from "../src/index.js";

test("promotion schemas publish explicit signal dimensions and policy invariants", () => {
  assert.deepEqual(CONSOLIDATION_SIGNAL_DIMENSIONS, ["importance", "stability"]);
  assert.deepEqual(CONSOLIDATION_SIGNAL_GENERATIONS, [
    "youngGeneration",
    "oldGeneration",
  ]);
  assert.equal(
    CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA.fields.signalCount.min,
    1,
  );
  assert.equal(
    CONSOLIDATION_PROMOTION_INPUT_SCHEMA.schemaId,
    "agent_brain_consolidation_promotion_input",
  );
  assert.deepEqual(
    CONSOLIDATION_PROMOTION_INPUT_SCHEMA.fields.signals.fields.youngGeneration.requiredFields,
    ["importance", "stability"],
  );
  assert.equal(
    CONSOLIDATION_PROMOTION_POLICY_SCHEMA.schemaId,
    "agent_brain_consolidation_promotion_policy",
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.targetNodeKind,
    MEMORY_NODE_KINDS.longTermMemory,
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.learnedTraitsTargetNodeKind,
    MEMORY_NODE_KINDS.longTermMemory,
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.requiresRuntimeAuthorization,
    true,
  );
  assert.deepEqual(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.allowedRuntimePhases,
    ["idle", "rest", "break", "sleep"],
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.inactivityHeuristicsAuthorize,
    false,
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.teamIdleCoordinatesOnly,
    true,
  );
  assert.equal(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.allowIdentityPromotion,
    false,
  );
  assert.deepEqual(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.requiredSignals,
    ["youngGeneration.importance", "youngGeneration.stability"],
  );
  assert.deepEqual(
    DEFAULT_CONSOLIDATION_PROMOTION_POLICY.protectedIdentityFields,
    PROTECTED_IDENTITY_FIELDS,
  );
});

test("promotion candidates normalize explicit young and optional old signal captures", () => {
  const signalCapture = createConsolidationSignalCapture({
    capturedAt: "2026-04-12T10:00:00Z",
    sourceCollection: "importanceIndex",
    sourceRecordIds: ["importance-stm-42"],
    signals: {
      taskRelevance: 0.9,
      userSpecificity: 0.7,
    },
  });

  assert.equal(signalCapture.score, 0.8);
  assert.equal(signalCapture.signalCount, 2);

  const candidate = createConsolidationPromotionCandidate({
    candidateId: "promo-stm-42",
    agentId: "agent-007",
    sourceMemoryId: "stm-42",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T10:00:00Z",
          sourceCollection: "importanceIndex",
          sourceRecordIds: ["importance-stm-42"],
          signals: {
            taskRelevance: 0.9,
            userSpecificity: 0.7,
          },
        },
        stability: {
          capturedAt: "2026-04-12T10:00:00Z",
          sourceCollection: "shortTermMemory",
          sourceRecordIds: ["stm-41", "stm-42"],
          signals: {
            repeatedRecall: 0.8,
            crossEpisodeConsistency: 0.8,
          },
        },
      },
    },
  });

  assert.equal(candidate.targetNodeKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.equal(candidate.targetMemoryId, null);
  assert.deepEqual(candidate.signalCoverage, [
    "youngGeneration.importance",
    "youngGeneration.stability",
  ]);
  assert.equal(candidate.signals.oldGeneration.importance, null);
  assert.equal(candidate.signals.youngGeneration.stability.signalCount, 2);

  const evaluation = evaluateConsolidationPromotionEligibility(candidate);

  assert.equal(evaluation.eligible, true);
  assert.equal(evaluation.eligibleForPromotion, true);
  assert.equal(evaluation.decision, "promote");
  assert.equal(evaluation.recommendedOperation, "promote");
  assert.equal(evaluation.minimumPromotionScoreMet, true);
  assert.equal(evaluation.promotionScore, 0.8);
  assert.deepEqual(evaluation.blockedReasons, []);
  assert.equal(evaluation.sourceMemoryId, "stm-42");
  assert.equal(evaluation.sourceMemoryKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(evaluation.targetMemoryId, null);
  assert.equal(evaluation.policyId, "default-consolidation-promotion-policy");
  assert.equal(evaluation.policyVersion, "1.0.0");
  assert.equal(evaluation.criteria.length, 4);
  assert.equal(evaluation.criteriaSummary.requiredCriteria, 2);
  assert.equal(evaluation.criteriaSummary.availableCriteria, 2);
  assert.deepEqual(evaluation.criteriaSummary.missingRequiredCriteria, []);
  assert.equal(
    evaluation.criteriaBySignalPath["youngGeneration.importance"].weight,
    0.35,
  );
  assert.equal(
    evaluation.criteriaBySignalPath["youngGeneration.importance"].meetsThreshold,
    true,
  );
  assert.equal(
    evaluation.criteriaBySignalPath["oldGeneration.importance"].available,
    false,
  );
  assert.equal(
    evaluation.decisionMetadata.evaluationMode,
    "offline-promotion-eligibility",
  );
  assert.equal(evaluation.decisionMetadata.offlineOnly, true);
});

test("policy evaluation blocks below-threshold signals and refuses unsafe overrides", () => {
  const candidate = createConsolidationPromotionCandidate({
    candidateId: "promo-stm-99",
    agentId: "agent-007",
    sourceMemoryId: "stm-99",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T11:00:00Z",
          signals: {
            taskRelevance: 0.9,
          },
        },
        stability: {
          capturedAt: "2026-04-12T11:00:00Z",
          signals: {
            repeatedRecall: 0.7,
          },
        },
      },
      oldGeneration: {
        importance: {
          capturedAt: "2026-04-12T11:00:00Z",
          signals: {
            durableSalience: 0.8,
          },
        },
        stability: {
          capturedAt: "2026-04-12T11:00:00Z",
          signals: {
            reinforcementCount: 0.2,
          },
        },
      },
    },
  });

  const evaluation = evaluateConsolidationPromotionCandidate(
    candidate,
    createConsolidationPromotionPolicy({
      thresholds: {
        minimumOldStabilityScore: 0.5,
      },
      weights: {
        youngImportance: 7,
        youngStability: 7,
        oldImportance: 3,
        oldStability: 3,
      },
    }),
  );

  assert.equal(evaluation.eligible, false);
  assert.equal(evaluation.eligibleForPromotion, false);
  assert.equal(evaluation.decision, "defer");
  assert.ok(
    evaluation.blockedReasons.includes(
      "below-threshold-oldGeneration.stability",
    ),
  );
  assert.equal(
    evaluation.thresholdChecks["oldGeneration.stability"],
    false,
  );
  assert.equal(
    evaluation.criteriaBySignalPath["oldGeneration.stability"].meetsThreshold,
    false,
  );
  assert.equal(evaluation.criteriaSummary.blockedCriteria, 1);

  assert.throws(
    () =>
      createConsolidationPromotionPolicy({
        allowIdentityPromotion: true,
      }),
    /allowIdentityPromotion must remain false/,
  );
  assert.throws(
    () =>
      createConsolidationPromotionPolicy({
        inactivityHeuristicsAuthorize: true,
      }),
    /inactivityHeuristicsAuthorize must remain false/,
  );
});

test("candidate evaluator remains a compatibility alias for the eligibility evaluator", () => {
  const candidate = createConsolidationPromotionCandidate({
    candidateId: "promo-wm-13",
    agentId: "agent-007",
    sourceMemoryId: "wm-13",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T12:00:00Z",
          signals: {
            taskRelevance: 0.9,
          },
        },
        stability: {
          capturedAt: "2026-04-12T12:00:00Z",
          signals: {
            repeatedRecall: 0.8,
          },
        },
      },
    },
  });

  const eligibility = evaluateConsolidationPromotionEligibility(candidate);
  const evaluation = evaluateConsolidationPromotionCandidate(candidate);

  assert.equal(evaluation.eligible, eligibility.eligible);
  assert.equal(evaluation.eligibleForPromotion, eligibility.eligibleForPromotion);
  assert.equal(evaluation.decision, eligibility.decision);
  assert.equal(evaluation.recommendedOperation, eligibility.recommendedOperation);
  assert.equal(evaluation.promotionScore, eligibility.promotionScore);
  assert.deepEqual(evaluation.criteriaSummary, eligibility.criteriaSummary);
  assert.deepEqual(
    evaluation.criteriaBySignalPath["youngGeneration.importance"],
    eligibility.criteriaBySignalPath["youngGeneration.importance"],
  );
});
