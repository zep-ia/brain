import test from "node:test";
import assert from "node:assert/strict";

import {
  BRAIN_LIBRARY_MODULES,
  BRAIN_LIBRARY_NAME,
  CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT,
  CONSOLIDATION_CHECKPOINT_SCHEMA,
  CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT,
  CONSOLIDATION_PIPELINE_ABORT_CONTRACT,
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX,
  DEFAULT_CONSOLIDATION_PROMOTION_POLICY,
  DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
  DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
  DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR,
  HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS,
  HIPPOCAMPUS_SECRET_DETECTOR_IDS,
  LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA,
  LONG_TERM_MEMORY_PERSISTENCE_SCHEMA,
  LONG_TERM_MEMORY_RECORD_CONTRACT,
  OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
  OFFLINE_BATCH_ORDERING_STRATEGIES,
  OLD_GENERATION_ACCESS_MODES,
  OLD_GENERATION_RELATIONSHIP_DIRECTIONS,
  archiveStaleMemories,
  createConsolidationCheckpoint,
  createConsolidationCheckpointKey,
  createConsolidationCheckpointRecordName,
  createIdleWindowReconstructionBudget,
  createLongTermMemoryLogicalIdentity,
  createLongTermMemoryPersistenceKey,
  createLongTermMemoryPersistenceRecordName,
  serializeLongTermMemoryPersistenceStorageRecord,
  createOfflineConsolidationPlanBuilderPreset,
  createOfflineConsolidationPlanBuilderPresetCatalog,
  createOfflineConsolidationPlanBuilderRequest,
  buildOfflineConsolidationBatchPlan,
  requestOfflineConsolidationBatchPlan,
  createConsolidationPromotionCandidate,
  createConsolidationPromotionPolicy,
  createConsolidationSignalCapture,
  createHippocampusSecretRedactionPolicy,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
  createOfflineBatchWorkUnit,
  executeOfflineBatchPlan,
  createYoungGenerationAdministrativeView,
  createYoungGenerationInspectionView,
  createYoungGenerationRetrievalView,
  createStaleMemoryMaskingDecisions,
  deleteLongTermMemoryEntry,
  deserializeConsolidationCheckpointEntry,
  describeBrainLibrary,
  deserializeLongTermMemoryEntry,
  evaluateConsolidationPromotionEligibility,
  evaluateConsolidationPromotionCandidate,
  evaluateConsolidationPromotionPageRank,
  evaluateWeightedPageRank,
  buildZepiaConsolidationPayload,
  expandOldGenerationSeedNodes,
  getMemoryGraphAgentId,
  getMemoryGraphReconstructionBudget,
  getMemoryGraphReconstructionProfile,
  getOldGenerationConstructionState,
  getOldGenerationSnapshotEdges,
  getYoungGenerationConstructionState,
  getYoungGenerationSnapshotEdges,
  ingestZepiaToolCallTracking,
  loadOldGenerationGraphState,
  loadYoungGenerationGraphState,
  lookupArchivedMemory,
  lookupConsolidationRecord,
  lookupLongTermMemory,
  lookupMemoryEvidence,
  matchLongTermMemoryLogicalIdentity,
  lookupOldGenerationNode,
  planConsolidationPromotions,
  planTeamIdleConsolidationBatch,
  persistConsolidationCheckpoint,
  persistCompletedConsolidationCheckpoint,
  persistLongTermMemoryEntry,
  persistPromotionSelectionToLongTermMemory,
  readConsolidationCheckpoint,
  resolveConsolidationRpcChangeWindow,
  rebuildMemoryGraph,
  restoreMemoryGraphFromStorage,
  MemoryGraphReconstructionDeferredError,
  isConsolidationPipelineAbortError,
  isMemoryGraphReconstructionDeferredError,
  rewritePromotionSelectionToLongTermMemoryEntry,
  resolveArchivedMemoryReference,
  resolveOfflineConsolidationPlanBuilderPreset,
  resolvePromptToSeedMemoryNodeIds,
  selectOldGenerationRetrievalCandidates,
  sanitizeHippocampusBoundaryPayload,
  saveOldGenerationGraphState,
  saveYoungGenerationGraphState,
  scheduleOfflineBatchExecution,
  selectTopKConsolidationPromotions,
  serializeConsolidationCheckpointEntry,
  serializeConsolidationCheckpointStorageRecord,
  serializeLongTermMemoryEntry,
  serializePromotionSelectionToLongTermMemoryEntry,
  walkOldGenerationRelationships,
} from "../src/index.js";

test("brain package exposes a reusable public entrypoint", () => {
  assert.equal(BRAIN_LIBRARY_NAME, "@zep/brain");
  assert.deepEqual(BRAIN_LIBRARY_MODULES, [
    "memory-graph",
    "consolidation",
    "batch-planning",
    "identity-guard",
  ]);

  assert.deepEqual(describeBrainLibrary(), {
    name: "@zep/brain",
    modules: [
      "memory-graph",
      "consolidation",
      "batch-planning",
      "identity-guard",
    ],
    runtimeModel: "caller-authorized offline consolidation",
  });
  assert.equal(typeof getMemoryGraphAgentId, "function");
  assert.equal(typeof getMemoryGraphReconstructionBudget, "function");
  assert.equal(typeof getMemoryGraphReconstructionProfile, "function");
  assert.equal(DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR, 0.85);
  assert.equal(typeof getOldGenerationConstructionState, "function");
  assert.equal(typeof getOldGenerationSnapshotEdges, "function");
  assert.equal(typeof getYoungGenerationConstructionState, "function");
  assert.equal(typeof getYoungGenerationSnapshotEdges, "function");
  assert.equal(typeof rebuildMemoryGraph, "function");
  assert.equal(typeof restoreMemoryGraphFromStorage, "function");
  assert.equal(typeof saveOldGenerationGraphState, "function");
  assert.equal(typeof saveYoungGenerationGraphState, "function");
  assert.equal(typeof loadOldGenerationGraphState, "function");
  assert.equal(typeof loadYoungGenerationGraphState, "function");
  assert.deepEqual(OLD_GENERATION_ACCESS_MODES, ["retrieval", "administrative"]);
  assert.deepEqual(OLD_GENERATION_RELATIONSHIP_DIRECTIONS, [
    "outbound",
    "inbound",
    "both",
  ]);
  assert.equal(typeof lookupLongTermMemory, "function");
  assert.equal(typeof lookupArchivedMemory, "function");
  assert.equal(typeof resolveArchivedMemoryReference, "function");
  assert.equal(typeof lookupMemoryEvidence, "function");
  assert.equal(typeof lookupConsolidationRecord, "function");
  assert.equal(typeof lookupOldGenerationNode, "function");
  assert.equal(typeof expandOldGenerationSeedNodes, "function");
  assert.equal(typeof walkOldGenerationRelationships, "function");
  assert.equal(typeof resolvePromptToSeedMemoryNodeIds, "function");
  assert.equal(typeof selectOldGenerationRetrievalCandidates, "function");
  assert.equal(typeof createYoungGenerationAdministrativeView, "function");
  assert.equal(typeof createYoungGenerationInspectionView, "function");
  assert.equal(typeof createYoungGenerationRetrievalView, "function");
  assert.deepEqual(HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS, ["input", "output"]);
  assert.ok(HIPPOCAMPUS_SECRET_DETECTOR_IDS.includes("openai-api-key"));
  assert.equal(
    DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY.policyId,
    "hippocampus-secret-redaction-policy",
  );
  assert.equal(typeof createHippocampusSecretRedactionPolicy, "function");
  assert.equal(typeof sanitizeHippocampusBoundaryPayload, "function");
  assert.equal(typeof createStaleMemoryMaskingDecisions, "function");
  assert.equal(typeof archiveStaleMemories, "function");
  assert.equal(typeof createConsolidationSignalCapture, "function");
  assert.equal(typeof createConsolidationPromotionPolicy, "function");
  assert.equal(typeof createConsolidationPromotionCandidate, "function");
  assert.equal(typeof evaluateConsolidationPromotionEligibility, "function");
  assert.equal(typeof evaluateConsolidationPromotionCandidate, "function");
  assert.equal(typeof evaluateConsolidationPromotionPageRank, "function");
  assert.equal(typeof evaluateWeightedPageRank, "function");
  assert.equal(typeof buildZepiaConsolidationPayload, "function");
  assert.equal(typeof ingestZepiaToolCallTracking, "function");
  assert.equal(typeof planConsolidationPromotions, "function");
  assert.equal(typeof selectTopKConsolidationPromotions, "function");
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS, [
    "idle",
    "sleep",
  ]);
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES, [
    "conservative",
    "balanced",
    "extended",
  ]);
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE, [
    "young",
    "old",
  ]);
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES, [
    "young-working-memory",
    "young-short-term-memory",
    "old-long-term-memory",
    "old-archived-memory",
  ]);
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS, [
    "mask-stale-young-memory",
    "archive-stale-memory",
    "promote-stable-young-memory",
    "reinforce-old-memory",
    "review-superseded-memory",
    "preserve-learned-traits",
  ]);
  assert.deepEqual(OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS, [
    "young-generation-triage",
    "young-generation-promotion",
    "old-generation-reinforcement",
    "archived-memory-review",
    "learned-trait-preservation",
  ]);
  assert.equal(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
    "idle-balanced-consolidation",
  );
  assert.deepEqual(OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS, [
    "idle-young-triage",
    "idle-balanced-consolidation",
    "sleep-extended-maintenance",
  ]);
  assert.equal(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.defaultPresetId,
    "idle-balanced-consolidation",
  );
  assert.equal(typeof createOfflineConsolidationPlanBuilderPreset, "function");
  assert.equal(typeof createOfflineConsolidationPlanBuilderPresetCatalog, "function");
  assert.equal(typeof resolveOfflineConsolidationPlanBuilderPreset, "function");
  assert.equal(typeof createOfflineConsolidationPlanBuilderRequest, "function");
  assert.equal(typeof buildOfflineConsolidationBatchPlan, "function");
  assert.equal(typeof requestOfflineConsolidationBatchPlan, "function");
  assert.deepEqual(OFFLINE_BATCH_ORDERING_STRATEGIES, [
    "priority-descending-then-sequence",
    "sequence-only",
  ]);
  assert.equal(
    DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
    "priority-descending-then-sequence",
  );
  assert.equal(DEFAULT_B200_OFFLINE_BATCH_LIMIT.targetProfile, "b200-style");
  assert.equal(typeof createOfflineBatchLimit, "function");
  assert.equal(typeof createOfflineBatchWorkUnit, "function");
  assert.equal(typeof createOfflineBatchPlan, "function");
  assert.equal(typeof scheduleOfflineBatchExecution, "function");
  assert.equal(typeof executeOfflineBatchPlan, "function");
  assert.equal(typeof createIdleWindowReconstructionBudget, "function");
  assert.equal(typeof planTeamIdleConsolidationBatch, "function");
  assert.equal(typeof MemoryGraphReconstructionDeferredError, "function");
  assert.equal(LONG_TERM_MEMORY_RECORD_CONTRACT.schemaId, "agent_brain_long_term_memory_entry");
  assert.equal(LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version, "1.0.0");
  assert.equal(LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA.version, "1.0.0");
  assert.equal(
    DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    "agent-brain/long-term-memory",
  );
  assert.equal(
    CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.schemaId,
    "agent_brain_consolidation_checkpoint",
  );
  assert.equal(CONSOLIDATION_CHECKPOINT_SCHEMA.version, "1.0.0");
  assert.equal(
    DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX,
    "agent-brain/consolidation-checkpoints",
  );
  assert.equal(typeof createConsolidationCheckpoint, "function");
  assert.equal(typeof serializeConsolidationCheckpointEntry, "function");
  assert.equal(typeof deserializeConsolidationCheckpointEntry, "function");
  assert.equal(typeof createConsolidationCheckpointRecordName, "function");
  assert.equal(typeof createConsolidationCheckpointKey, "function");
  assert.equal(typeof serializeConsolidationCheckpointStorageRecord, "function");
  assert.equal(typeof persistConsolidationCheckpoint, "function");
  assert.equal(typeof persistCompletedConsolidationCheckpoint, "function");
  assert.equal(typeof readConsolidationCheckpoint, "function");
  assert.equal(typeof resolveConsolidationRpcChangeWindow, "function");
  assert.equal(typeof createLongTermMemoryLogicalIdentity, "function");
  assert.equal(typeof matchLongTermMemoryLogicalIdentity, "function");
  assert.equal(typeof createLongTermMemoryPersistenceRecordName, "function");
  assert.equal(typeof createLongTermMemoryPersistenceKey, "function");
  assert.equal(typeof serializeLongTermMemoryPersistenceStorageRecord, "function");
  assert.equal(typeof serializeLongTermMemoryEntry, "function");
  assert.equal(typeof serializePromotionSelectionToLongTermMemoryEntry, "function");
  assert.equal(typeof rewritePromotionSelectionToLongTermMemoryEntry, "function");
  assert.equal(typeof deserializeLongTermMemoryEntry, "function");
  assert.equal(typeof persistLongTermMemoryEntry, "function");
  assert.equal(typeof deleteLongTermMemoryEntry, "function");
  assert.equal(typeof persistPromotionSelectionToLongTermMemory, "function");
  assert.equal(
    CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT.invariantId,
    "agent-scoped-canonical-id-preservation",
  );
  assert.equal(
    CONSOLIDATION_PIPELINE_ABORT_CONTRACT.safeAction,
    "abort-offline-pipeline-before-write",
  );
  assert.equal(typeof isConsolidationPipelineAbortError, "function");
  assert.equal(typeof isMemoryGraphReconstructionDeferredError, "function");
  assert.equal(DEFAULT_CONSOLIDATION_PROMOTION_POLICY.allowIdentityPromotion, false);
});
