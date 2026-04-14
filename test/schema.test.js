import test from "node:test";
import assert from "node:assert/strict";

import {
  ARCHIVED_MEMORY_SCHEMA,
  CONSOLIDATION_RECORD_SCHEMA,
  IMPORTANCE_INDEX_SCHEMA,
  IMMUTABLE_IDENTITY_SCHEMA,
  LONG_TERM_MEMORY_SCHEMA,
  MEMORY_EVIDENCE_SCHEMA,
  MEMORY_GRAPH_SCHEMA,
  MEMORY_NODE_KINDS,
  OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
  OLD_GENERATION_CONSOLIDATION_STATES,
  OLD_GENERATION_DOMAIN_SCHEMA,
  OLD_GENERATION_EDGE_SCHEMA,
  OLD_GENERATION_EDGE_FIELDS,
  OLD_GENERATION_GRAPH_STATE_SCHEMA,
  OLD_GENERATION_GRAPH_INVARIANTS,
  OLD_GENERATION_GRAPH_RULES,
  OLD_GENERATION_IDENTIFIER_SCHEMA,
  PROTECTED_IDENTITY_FIELDS,
  SHORT_TERM_MEMORY_SCHEMA,
  WORKING_MEMORY_SCHEMA,
  YOUNG_GENERATION_EDGE_SCHEMA,
  YOUNG_GENERATION_GRAPH_STATE_SCHEMA,
  YOUNG_GENERATION_MEMORY_KINDS,
  createArchivedMemory,
  createConsolidationRecord,
  createImmutableIdentity,
  createOldGenerationEdge,
  createOldGenerationEdgeId,
  createOldGenerationNodeId,
  createImportanceIndexEntry,
  createMemoryEvidence,
  createMemoryGraph,
  createYoungGenerationAdministrativeView,
  getMemoryGraphAgentId,
  getYoungGenerationConstructionState,
  getYoungGenerationSnapshotEdges,
  createYoungGenerationInspectionView,
  createYoungGenerationRetrievalView,
  createYoungGenerationMaskingMetadata,
  createYoungGenerationMemory,
  loadYoungGenerationGraphState,
  putImportanceIndexEntry,
  queryImportanceIndex,
  saveYoungGenerationGraphState,
  updateImportanceIndexEntry,
  validateOldGenerationGraph,
} from "../src/index.js";

const createIdentityInput = (overrides = {}) => ({
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

const createLongTermMemoryInput = (memoryId, overrides = {}) => ({
  memoryId,
  category: "semantic",
  content: `Durable memory ${memoryId}.`,
  summary: `Summary for ${memoryId}.`,
  confidence: 0.84,
  stabilizedAt: "2026-04-12T09:00:00Z",
  provenance: {
    source: "conversation",
    observedAt: "2026-04-12T09:00:00Z",
    evidence: [`turn-${memoryId}`],
  },
  ...overrides,
});

const createArchivedMemoryInput = (archiveId, overrides = {}) => ({
  archiveId,
  agentId: "agent-007",
  originalGeneration: MEMORY_NODE_KINDS.youngGeneration,
  originalMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  originalMemoryId: `stm-${archiveId}`,
  archivalReason: "low_value_stale_memory",
  archivedAt: "2026-04-12T09:05:00Z",
  snapshot: {
    record: {
      memoryId: `stm-${archiveId}`,
      summary: `Archived memory ${archiveId}.`,
      provenance: {
        source: "conversation",
        observedAt: "2026-04-12T09:00:00Z",
        evidence: [`turn-${archiveId}`],
      },
    },
    inactiveForRetrieval: true,
    masking: {
      isMasked: true,
    },
  },
  provenance: {
    source: "idle-window",
    observedAt: "2026-04-12T09:05:00Z",
    evidence: [`archive-${archiveId}`],
  },
  ...overrides,
});

const createMemoryEvidenceInput = (evidenceId, overrides = {}) => ({
  evidenceId,
  kind: "conversation_excerpt",
  source: "conversation",
  observedAt: "2026-04-12T09:00:00Z",
  detail: `Evidence for ${evidenceId}.`,
  provenance: {
    source: "conversation",
    observedAt: "2026-04-12T09:00:00Z",
    evidence: [`turn-${evidenceId}`],
  },
  ...overrides,
});

const createConsolidationRecordInput = (recordId, overrides = {}) => ({
  recordId,
  operation: "promote",
  runtimePhase: "idle",
  consolidatedAt: "2026-04-12T09:01:00Z",
  sourceMemoryIds: ["stm-1"],
  policyVersion: "old-generation-v1",
  provenance: {
    source: "idle-window",
    observedAt: "2026-04-12T09:01:00Z",
    evidence: [`run-${recordId}`],
  },
  ...overrides,
});

test("old generation schema exposes dedicated long-term, archived, evidence, audit, and identity nodes", () => {
  assert.equal(OLD_GENERATION_DOMAIN_SCHEMA.nodeKind, MEMORY_NODE_KINDS.oldGeneration);
  assert.deepEqual(Object.keys(OLD_GENERATION_DOMAIN_SCHEMA.fields).sort(), [
    "archivedMemory",
    "consolidationJournal",
    "immutableIdentity",
    "longTermMemory",
    "memoryEvidence",
  ]);
  assert.equal(
    OLD_GENERATION_DOMAIN_SCHEMA.fields.longTermMemory.itemNodeKind,
    MEMORY_NODE_KINDS.longTermMemory,
  );
  assert.equal(
    OLD_GENERATION_DOMAIN_SCHEMA.fields.archivedMemory.itemNodeKind,
    MEMORY_NODE_KINDS.archivedMemory,
  );
  assert.equal(
    OLD_GENERATION_DOMAIN_SCHEMA.fields.memoryEvidence.itemNodeKind,
    MEMORY_NODE_KINDS.memoryEvidence,
  );
  assert.equal(
    OLD_GENERATION_DOMAIN_SCHEMA.fields.consolidationJournal.itemNodeKind,
    MEMORY_NODE_KINDS.consolidationRecord,
  );
  assert.equal(
    OLD_GENERATION_DOMAIN_SCHEMA.fields.immutableIdentity.nodeKind,
    MEMORY_NODE_KINDS.immutableIdentity,
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.oldGeneration.fields.archivedMemory.itemNodeKind,
    MEMORY_NODE_KINDS.archivedMemory,
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.oldGeneration.fields.memoryEvidence.itemNodeKind,
    MEMORY_NODE_KINDS.memoryEvidence,
  );
});

test("immutable identity schema is agent-scoped and excludes learned traits", () => {
  assert.equal(IMMUTABLE_IDENTITY_SCHEMA.agentScoped, true);
  assert.equal(IMMUTABLE_IDENTITY_SCHEMA.allowLearnedTraits, false);
  assert.equal(IMMUTABLE_IDENTITY_SCHEMA.mergeStrategy, "forbid_cross_agent_merge");
  assert.deepEqual(Object.keys(IMMUTABLE_IDENTITY_SCHEMA.fields), [
    "nodeId",
    "agentId",
    "persona",
    "role",
    "durableMission",
    "safetyConstraints",
    "ownership",
    "nonNegotiablePreferences",
    "runtimeInvariants",
    "protectedCoreFacts",
    "provenance",
    "temporalContext",
    "consolidationState",
  ]);
  Object.entries(IMMUTABLE_IDENTITY_SCHEMA.fields).forEach(([fieldName, field]) => {
    assert.equal(
      field.mutable,
      false,
      `immutable identity field "${fieldName}" must be creation-only`,
    );
  });
  assert.ok(!("learnedTrait" in IMMUTABLE_IDENTITY_SCHEMA.fields));
  assert.ok(!("salience" in IMMUTABLE_IDENTITY_SCHEMA.fields));
  assert.ok(!PROTECTED_IDENTITY_FIELDS.includes("learnedTrait"));
});

test("long-term memory schema preserves learned traits and durable shape requirements", () => {
  assert.equal(LONG_TERM_MEMORY_SCHEMA.agentScoped, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.nodeId.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.agentId.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.summary.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.stabilizedAt.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.temporalContext.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.salience.required, true);
  assert.equal(LONG_TERM_MEMORY_SCHEMA.fields.consolidationState.required, true);
  assert.equal(
    LONG_TERM_MEMORY_SCHEMA.fields.learnedTrait.fields.protectedFromIdentityPromotion
      .const,
    true,
  );
  assert.equal(
    LONG_TERM_MEMORY_SCHEMA.fields.learnedTrait.fields.confidence.required,
    true,
  );
  assert.equal(
    LONG_TERM_MEMORY_SCHEMA.fields.learnedTrait.fields.provenance.required,
    true,
  );
});

test("archived memory schema preserves restore-safe source identity and timing metadata", () => {
  assert.equal(ARCHIVED_MEMORY_SCHEMA.nodeKind, MEMORY_NODE_KINDS.archivedMemory);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.agentScoped, true);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.archiveId.required, true);
  assert.deepEqual(ARCHIVED_MEMORY_SCHEMA.fields.originalGeneration.values, [
    MEMORY_NODE_KINDS.youngGeneration,
    MEMORY_NODE_KINDS.oldGeneration,
  ]);
  assert.deepEqual(ARCHIVED_MEMORY_SCHEMA.fields.originalMemoryKind.values, [
    MEMORY_NODE_KINDS.workingMemory,
    MEMORY_NODE_KINDS.shortTermMemory,
    MEMORY_NODE_KINDS.longTermMemory,
  ]);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.archivalReason.required, true);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.archivedAt.required, true);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.snapshot.required, true);
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.originalNodeId.type, "string|null");
  assert.equal(ARCHIVED_MEMORY_SCHEMA.fields.originalProvenance.type, "object|null");
});

test("old-generation support schemas define evidence, consolidation, and edge semantics", () => {
  assert.equal(MEMORY_EVIDENCE_SCHEMA.nodeKind, MEMORY_NODE_KINDS.memoryEvidence);
  assert.equal(CONSOLIDATION_RECORD_SCHEMA.nodeKind, MEMORY_NODE_KINDS.consolidationRecord);
  assert.equal(MEMORY_EVIDENCE_SCHEMA.fields.nodeId.required, true);
  assert.equal(MEMORY_EVIDENCE_SCHEMA.fields.kind.required, true);
  assert.equal(MEMORY_EVIDENCE_SCHEMA.fields.temporalContext.required, true);
  assert.equal(MEMORY_EVIDENCE_SCHEMA.fields.consolidationState.required, true);
  assert.equal(CONSOLIDATION_RECORD_SCHEMA.fields.nodeId.required, true);
  assert.equal(CONSOLIDATION_RECORD_SCHEMA.fields.operation.required, true);
  assert.equal(CONSOLIDATION_RECORD_SCHEMA.fields.temporalContext.required, true);
  assert.equal(CONSOLIDATION_RECORD_SCHEMA.fields.consolidationState.required, true);
  assert.equal(
    OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.targetNodeKind,
    MEMORY_NODE_KINDS.memoryEvidence,
  );
  assert.equal(
    OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.targetNodeKind,
    MEMORY_NODE_KINDS.consolidationRecord,
  );
  assert.equal(
    OLD_GENERATION_EDGE_SCHEMA.supersedes.targetNodeKind,
    MEMORY_NODE_KINDS.longTermMemory,
  );
  assert.equal(
    OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.idPattern,
    OLD_GENERATION_IDENTIFIER_SCHEMA.edgeIdPattern,
  );
  assert.equal(OLD_GENERATION_EDGE_FIELDS.edgeId.required, true);
  assert.equal(OLD_GENERATION_EDGE_FIELDS.temporalContext.required, true);
  assert.equal(OLD_GENERATION_EDGE_FIELDS.consolidationState.required, true);
});

test("old-generation identifier schema declares per-kind node ids and shared edge format", () => {
  assert.equal(OLD_GENERATION_IDENTIFIER_SCHEMA.nodeIdPattern, "old/{agentId}/{nodeKind}/{localId}");
  assert.equal(
    OLD_GENERATION_IDENTIFIER_SCHEMA.nodeKinds.longTermMemory.localIdField,
    "memoryId",
  );
  assert.equal(
    OLD_GENERATION_IDENTIFIER_SCHEMA.nodeKinds.archivedMemory.localIdField,
    "archiveId",
  );
  assert.equal(
    OLD_GENERATION_IDENTIFIER_SCHEMA.nodeKinds.memoryEvidence.localIdField,
    "evidenceId",
  );
  assert.equal(
    OLD_GENERATION_IDENTIFIER_SCHEMA.nodeKinds.consolidationRecord.localIdField,
    "recordId",
  );
  assert.equal(
    OLD_GENERATION_IDENTIFIER_SCHEMA.nodeKinds.immutableIdentity.localIdField,
    "self",
  );
  assert.deepEqual(OLD_GENERATION_CONSOLIDATION_STATES, [
    "runtime_seeded",
    "promoted",
    "reinforced",
    "preserved",
    "superseded",
  ]);
});

test("old-generation graph rules publish allowed combinations and invariants", () => {
  assert.equal(OLD_GENERATION_GRAPH_RULES.identityNodeKind, MEMORY_NODE_KINDS.immutableIdentity);
  assert.deepEqual(
    OLD_GENERATION_GRAPH_RULES.allowedEdgeCombinations,
    OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
  );
  assert.deepEqual(
    OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS[
      OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation
    ],
    {
      sourceNodeKind: MEMORY_NODE_KINDS.longTermMemory,
      targetNodeKind: MEMORY_NODE_KINDS.memoryEvidence,
    },
  );
  assert.ok(
    OLD_GENERATION_GRAPH_INVARIANTS.some((rule) =>
      rule.includes("immutable identity is isolated"),
    ),
  );
  assert.ok(
    OLD_GENERATION_GRAPH_INVARIANTS.some((rule) => rule.includes("cannot create cycles")),
  );
  assert.ok(
    OLD_GENERATION_GRAPH_INVARIANTS.some((rule) => rule.includes("archived memories")),
  );
});

test("validateOldGenerationGraph accepts a canonical durable subgraph", () => {
  const memoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "evidence-1",
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    "agent-007",
    "consolidation-1",
  );
  const graph = createMemoryGraph(createIdentityInput(), {
    longTermMemory: [createLongTermMemoryInput("ltm-1")],
    memoryEvidence: [createMemoryEvidenceInput("evidence-1")],
    consolidationJournal: [createConsolidationRecordInput("consolidation-1")],
    edges: [
      {
        from: memoryNodeId,
        to: evidenceNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
      },
      {
        from: memoryNodeId,
        to: recordNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
        consolidationState: {
          journalRecordId: "consolidation-1",
        },
      },
    ],
  });

  assert.equal(validateOldGenerationGraph(graph), true);
});

test("memory graph factory rejects old-generation edges with invalid node kinds", () => {
  const memoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    "agent-007",
    "consolidation-1",
  );

  assert.throws(
    () =>
      createMemoryGraph(createIdentityInput(), {
        longTermMemory: [createLongTermMemoryInput("ltm-1")],
        consolidationJournal: [createConsolidationRecordInput("consolidation-1")],
        edges: [
          {
            from: memoryNodeId,
            to: recordNodeId,
            relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
          },
        ],
      }),
    /memory_evidence/,
  );
});

test("memory graph factory rejects orphaned old-generation edges and duplicate durable ids", () => {
  const memoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const missingEvidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "missing-evidence",
  );

  assert.throws(
    () =>
      createMemoryGraph(createIdentityInput(), {
        longTermMemory: [createLongTermMemoryInput("ltm-1")],
        edges: [
          {
            from: memoryNodeId,
            to: missingEvidenceNodeId,
            relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
          },
        ],
      }),
    /missing target node/,
  );

  assert.throws(
    () =>
      createMemoryGraph(createIdentityInput(), {
        longTermMemory: [
          createLongTermMemoryInput("ltm-duplicate"),
          createLongTermMemoryInput("ltm-duplicate", {
            content: "Conflicting durable memory.",
            summary: "Conflicting durable memory.",
          }),
        ],
      }),
    /Duplicate old-generation nodeId/,
  );
});

test("memory graph factory rejects unsafe learned-trait promotion and supersedes cycles", () => {
  const memoryA = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-a",
  );
  const memoryB = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-b",
  );

  assert.throws(
    () =>
      createMemoryGraph(createIdentityInput(), {
        longTermMemory: [
          createLongTermMemoryInput("trait-1", {
            category: "learned_trait",
            content: "The agent asks for citations before acting.",
            summary: "Citation-seeking learned trait.",
          }),
        ],
      }),
    /must include learnedTrait metadata/,
  );

  assert.throws(
    () =>
      createMemoryGraph(createIdentityInput(), {
        longTermMemory: [
          createLongTermMemoryInput("ltm-a"),
          createLongTermMemoryInput("ltm-b"),
        ],
        edges: [
          {
            from: memoryA,
            to: memoryB,
            relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
          },
          {
            from: memoryB,
            to: memoryA,
            relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
          },
        ],
      }),
    /must remain acyclic/,
  );
});

test("importance index schema separates young-generation salience from memory content", () => {
  assert.equal(IMPORTANCE_INDEX_SCHEMA.nodeKind, MEMORY_NODE_KINDS.importanceIndex);
  assert.equal(IMPORTANCE_INDEX_SCHEMA.agentScoped, true);
  assert.deepEqual(IMPORTANCE_INDEX_SCHEMA.fields.memoryKind.values, [
    MEMORY_NODE_KINDS.workingMemory,
    MEMORY_NODE_KINDS.shortTermMemory,
  ]);
  assert.deepEqual(YOUNG_GENERATION_MEMORY_KINDS, [
    MEMORY_NODE_KINDS.workingMemory,
    MEMORY_NODE_KINDS.shortTermMemory,
  ]);
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.youngGeneration.fields.importanceIndex.itemNodeKind,
    MEMORY_NODE_KINDS.importanceIndex,
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.importanceIndex.nodeKind,
    MEMORY_NODE_KINDS.importanceIndex,
  );
  assert.ok(!("content" in IMPORTANCE_INDEX_SCHEMA.fields));
  assert.ok(!("summary" in IMPORTANCE_INDEX_SCHEMA.fields));
});

test("young-generation memory schemas preserve records and expose masking state", () => {
  assert.equal(WORKING_MEMORY_SCHEMA.nodeKind, MEMORY_NODE_KINDS.workingMemory);
  assert.equal(SHORT_TERM_MEMORY_SCHEMA.nodeKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(WORKING_MEMORY_SCHEMA.agentScoped, true);
  assert.equal(SHORT_TERM_MEMORY_SCHEMA.mergeStrategy, "forbid_cross_agent_merge");
  assert.equal(WORKING_MEMORY_SCHEMA.fields.record.required, true);
  assert.equal(WORKING_MEMORY_SCHEMA.fields.inactiveForRetrieval.required, true);
  assert.equal(WORKING_MEMORY_SCHEMA.fields.masking.fields.isMasked.required, true);
  assert.equal(WORKING_MEMORY_SCHEMA.fields.lifecycle.required, true);
  assert.deepEqual(WORKING_MEMORY_SCHEMA.fields.lifecycle.fields.state.values, [
    "active",
    "inactive",
    "archived",
  ]);
  assert.equal(
    WORKING_MEMORY_SCHEMA.fields.lifecycle.fields.archiveLinkage.fields.archiveId.type,
    "string|null",
  );
  assert.equal(
    WORKING_MEMORY_SCHEMA.fields.masking.fields.maskUpdatedAt.type,
    "string|null",
  );
  assert.equal(
    WORKING_MEMORY_SCHEMA.fields.masking.fields.maskedOriginalContent.fields.value.type,
    "string|null",
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.workingMemory.fields.masking.fields.maskedBy.type,
    "string|null",
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.shortTermMemory.fields.masking.fields.audit.fields
      .auditRecordId.type,
    "string|null",
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.nodes.shortTermMemory.fields.record.type,
    "object",
  );
});

test("young-generation edge schema is public and scoped to in-progress agent memory", () => {
  assert.equal(
    YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.sourceNodeKind,
    MEMORY_NODE_KINDS.workingMemory,
  );
  assert.equal(
    YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.targetNodeKind,
    MEMORY_NODE_KINDS.shortTermMemory,
  );
  assert.equal(
    YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.sourceNodeKind,
    MEMORY_NODE_KINDS.importanceIndex,
  );
  assert.equal(
    YOUNG_GENERATION_EDGE_SCHEMA.shortTermRecall.targetNodeKind,
    MEMORY_NODE_KINDS.workingMemory,
  );
  assert.equal(
    MEMORY_GRAPH_SCHEMA.edgeSchema.youngGeneration.shortTermAssociation.relation,
    "short_term_association",
  );
  assert.equal(
    YOUNG_GENERATION_EDGE_SCHEMA.shortTermAssociation.crossAgentAllowed,
    false,
  );
});

test("young-generation graph state schema exposes versioned snapshot metadata and public node contracts", () => {
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.schemaId,
    "agent_brain_young_generation_graph_state",
  );
  assert.equal(YOUNG_GENERATION_GRAPH_STATE_SCHEMA.version, "1.0.0");
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.fields.constructionMetadata.fields.agentId
      .required,
    true,
  );
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.fields.constructionMetadata.fields
      .reconstructionMetadata.required,
    true,
  );
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.fields.youngGeneration.nodeKind,
    MEMORY_NODE_KINDS.youngGeneration,
  );
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.nodes.importanceIndex.nodeKind,
    MEMORY_NODE_KINDS.importanceIndex,
  );
  assert.equal(
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA.edgeSchema.importanceToShortTermMemory
      .targetNodeKind,
    MEMORY_NODE_KINDS.shortTermMemory,
  );
  assert.equal(
    OLD_GENERATION_GRAPH_STATE_SCHEMA.fields.constructionMetadata.fields
      .reconstructionMetadata.required,
    true,
  );
});

test("importance index entries normalize signals and derive aggregate score", () => {
  const entry = createImportanceIndexEntry({
    entryId: "importance-1",
    agentId: "agent-007",
    memoryId: "wm-1",
    memoryKind: MEMORY_NODE_KINDS.workingMemory,
    signals: {
      taskRelevance: 0.9,
      repetition: 0.7,
      novelty: 2,
    },
    lastUpdatedAt: "2026-04-12T09:00:00Z",
    provenance: {
      source: "runtime",
    },
  });

  assert.equal(entry.signalCount, 3);
  assert.equal(entry.importanceScore, 0.8667);
  assert.equal(entry.signals.novelty, 1);
  assert.ok(!("content" in entry));
  assert.ok(Object.isFrozen(entry));
});

test("young-generation memory helpers preserve records and normalize masking", () => {
  const masking = createYoungGenerationMaskingMetadata(
    {
      maskedAt: "2026-04-12T10:00:00Z",
      maskedBy: "offline-consolidation",
      reason: "stale-window",
      maskedOriginalContent: {
        value: "Keep this available offline only.",
        sourceField: "summary",
        capturedAt: "2026-04-12T10:00:00Z",
      },
      audit: {
        auditRecordId: "mask-1",
        policyVersion: "stale-memory-v1",
        runtimePhase: "sleep",
        recordedAt: "2026-04-12T10:00:00Z",
        actor: "offline-consolidation",
      },
      provenance: {
        source: "sleep-window",
      },
    },
    true,
  );
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "stm-1",
      summary: "Keep this available offline only.",
    },
    inactiveForRetrieval: true,
    masking,
  });

  assert.equal(masking.isMasked, true);
  assert.equal(masking.maskedBy, "offline-consolidation");
  assert.equal(masking.maskUpdatedAt, "2026-04-12T10:00:00Z");
  assert.equal(masking.maskedOriginalContent.value, "Keep this available offline only.");
  assert.equal(masking.audit.auditRecordId, "mask-1");
  assert.equal(memory.inactiveForRetrieval, true);
  assert.equal(memory.masking.reason, "stale-window");
  assert.deepEqual(memory.record, {
    memoryId: "stm-1",
    summary: "Keep this available offline only.",
  });
  assert.equal(memory.lifecycle.state, "inactive");
  assert.equal(memory.lifecycle.inactiveAt, "2026-04-12T10:00:00Z");
  assert.equal(memory.lifecycle.inactiveReason, "stale-window");
  assert.equal(memory.lifecycle.archiveLinkage, null);
  assert.ok(Object.isFrozen(memory));
});

test("young-generation memory helpers preserve archive-record linkage inside lifecycle metadata", () => {
  const archiveId = "archive:young_generation:short_term_memory:stm-archive";
  const archiveNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.archivedMemory,
    "agent-007",
    archiveId,
  );
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "stm-archive",
      summary: "Older recap has been durably archived.",
    },
    lifecycle: {
      archiveLinkage: {
        archiveId,
        archiveNodeId,
        archivedAt: "2026-04-12T11:10:00Z",
      },
    },
  });

  assert.equal(memory.inactiveForRetrieval, true);
  assert.equal(memory.masking.isMasked, true);
  assert.equal(memory.lifecycle.state, "archived");
  assert.equal(memory.lifecycle.inactiveAt, "2026-04-12T11:10:00Z");
  assert.equal(
    memory.lifecycle.inactiveReason,
    "archived-to-old-generation",
  );
  assert.equal(memory.lifecycle.archiveLinkage.archiveId, archiveId);
  assert.equal(memory.lifecycle.archiveLinkage.archiveNodeId, archiveNodeId);
  assert.equal(
    memory.lifecycle.archiveLinkage.archivedAt,
    "2026-04-12T11:10:00Z",
  );
});

test("young-generation memory helpers derive masked original content and structured audit from preserved record and legacy provenance", () => {
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "wm-2",
      content: "Preserve this plan for offline-only review.",
    },
    inactiveForRetrieval: true,
    masking: {
      maskedAt: "2026-04-12T11:00:00Z",
      maskedBy: "idle-consolidation-suggester",
      reason: "stale-window",
      provenance: {
        source: "offline-suggestion",
        auditRecordId: "mask-2",
        policyVersion: "stale-memory-v2",
        runtimePhase: "idle",
      },
    },
  });

  assert.equal(
    memory.masking.maskedOriginalContent.value,
    "Preserve this plan for offline-only review.",
  );
  assert.equal(memory.masking.maskedOriginalContent.sourceField, "content");
  assert.equal(memory.masking.audit.auditRecordId, "mask-2");
  assert.equal(memory.masking.audit.runtimePhase, "idle");
  assert.equal(memory.masking.audit.actor, "idle-consolidation-suggester");
});

test("young-generation memory helpers timestamp captured pre-mask content and audit defaults when masking is applied", () => {
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "stm-2",
      summary: "Preserve this milestone update before masking it from retrieval.",
    },
    inactiveForRetrieval: true,
    masking: {
      maskUpdatedAt: "2026-04-12T11:05:00Z",
      maskedBy: "offline-consolidation",
      reason: "stale-window",
      provenance: {
        source: "sleep-window",
        auditRecordId: "mask-3",
        policyVersion: "stale-memory-v3",
        runtimePhase: "sleep",
      },
    },
  });

  assert.equal(memory.masking.maskUpdatedAt, "2026-04-12T11:05:00Z");
  assert.equal(
    memory.masking.maskedOriginalContent.value,
    "Preserve this milestone update before masking it from retrieval.",
  );
  assert.equal(memory.masking.maskedOriginalContent.sourceField, "summary");
  assert.equal(memory.masking.maskedOriginalContent.capturedAt, "2026-04-12T11:05:00Z");
  assert.equal(memory.masking.audit.auditRecordId, "mask-3");
  assert.equal(memory.masking.audit.policyVersion, "stale-memory-v3");
  assert.equal(memory.masking.audit.runtimePhase, "sleep");
  assert.equal(memory.masking.audit.recordedAt, "2026-04-12T11:05:00Z");
  assert.equal(memory.masking.audit.actor, "offline-consolidation");
});

test("memory graph factory materializes an explicit old generation boundary", () => {
  const memoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "evidence-1",
  );

  const graph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      longTermMemory: [
        {
          agentId: "agent-007",
          memoryId: "ltm-1",
          category: "learned_trait",
          content: "The agent tends to ask for evidence before acting.",
          summary: "Evidence-seeking is a stable learned trait.",
          confidence: 0.82,
          stabilizedAt: "2026-04-12T09:00:00Z",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:00:00Z",
            evidence: ["turn-18"],
          },
          learnedTrait: {
            label: "evidence-seeking",
            confidence: 0.82,
            provenance: {
              source: "conversation",
              observedAt: "2026-04-12T09:00:00Z",
              evidence: ["turn-18"],
            },
          },
        },
      ],
      memoryEvidence: [
        {
          evidenceId: "evidence-1",
          agentId: "agent-007",
          kind: "conversation_excerpt",
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          detail: "The agent repeatedly asked for citations before summarizing.",
          reference: "turn-18",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:00:00Z",
            evidence: ["turn-18"],
          },
        },
      ],
      consolidationJournal: [
        {
          recordId: "consolidation-1",
          agentId: "agent-007",
          operation: "promote",
          runtimePhase: "idle",
          consolidatedAt: "2026-04-12T09:01:00Z",
          sourceMemoryIds: ["stm-18"],
          policyVersion: "old-generation-v1",
          preservedIdentityFields: ["agentId", "persona"],
          provenance: {
            source: "idle-window",
            observedAt: "2026-04-12T09:01:00Z",
            evidence: ["consolidation-run-1"],
          },
        },
      ],
      edges: [
        {
          agentId: "agent-007",
          from: memoryNodeId,
          to: evidenceNodeId,
          relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
          provenance: {
            source: "idle-window",
            observedAt: "2026-04-12T09:01:00Z",
            evidence: ["consolidation-run-1"],
          },
          temporalContext: {
            consolidatedAt: "2026-04-12T09:01:00Z",
          },
          consolidationState: {
            status: "preserved",
            journalRecordId: "consolidation-1",
            policyVersion: "old-generation-v1",
          },
        },
      ],
    },
  );

  assert.equal(graph.oldGeneration.generation, "old");
  assert.equal(
    graph.oldGeneration.immutableIdentity.nodeId,
    "old/agent-007/immutable_identity/self",
  );
  assert.equal(graph.oldGeneration.immutableIdentity.consolidationState.status, "runtime_seeded");
  assert.equal(graph.oldGeneration.immutableIdentity.agentId, "agent-007");
  assert.equal(graph.oldGeneration.longTermMemory[0].nodeId, memoryNodeId);
  assert.equal(graph.oldGeneration.longTermMemory[0].agentId, "agent-007");
  assert.equal(graph.oldGeneration.longTermMemory[0].salience.score, 0.82);
  assert.equal(
    graph.oldGeneration.longTermMemory[0].consolidationState.protectedFromIdentityPromotion,
    true,
  );
  assert.equal(graph.oldGeneration.memoryEvidence[0].kind, "conversation_excerpt");
  assert.equal(graph.oldGeneration.memoryEvidence[0].nodeId, evidenceNodeId);
  assert.equal(graph.oldGeneration.consolidationJournal[0].operation, "promote");
  assert.equal(
    graph.oldGeneration.consolidationJournal[0].consolidationState.journalRecordId,
    "consolidation-1",
  );
  assert.equal(graph.oldGeneration.longTermMemory[0].learnedTrait.label, "evidence-seeking");
  assert.equal(
    graph.oldGeneration.longTermMemory[0].learnedTrait.protectedFromIdentityPromotion,
    true,
  );
  assert.equal(graph.edges[0].edgeId, createOldGenerationEdgeId(graph.edges[0]));
  assert.equal(graph.edges[0].consolidationState.journalRecordId, "consolidation-1");
  assert.ok(Object.isFrozen(graph.oldGeneration.immutableIdentity));
  assert.ok(Object.isFrozen(graph.oldGeneration.longTermMemory[0]));
  assert.ok(Object.isFrozen(graph.oldGeneration.memoryEvidence[0]));
  assert.ok(Object.isFrozen(graph.oldGeneration.consolidationJournal[0]));
  assert.ok(Object.isFrozen(graph.edges[0]));
});

test("immutable identity creation returns a deeply frozen creation-only snapshot", () => {
  const input = createIdentityInput({
    runtimeInvariants: {
      deployment: {
        tenant: "zep",
      },
    },
    provenance: {
      source: "runtime_authority",
      observedAt: "2026-04-12T09:00:00Z",
      evidence: ["runtime-seed"],
      metadata: {
        assertedBy: "bootstrap",
      },
    },
  });

  const identity = createImmutableIdentity(input);

  assert.notStrictEqual(identity.runtimeInvariants, input.runtimeInvariants);
  assert.notStrictEqual(
    identity.runtimeInvariants.deployment,
    input.runtimeInvariants.deployment,
  );
  assert.notStrictEqual(identity.provenance, input.provenance);
  assert.notStrictEqual(identity.provenance.metadata, input.provenance.metadata);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.safetyConstraints), true);
  assert.equal(Object.isFrozen(identity.runtimeInvariants), true);
  assert.equal(Object.isFrozen(identity.runtimeInvariants.deployment), true);
  assert.equal(Object.isFrozen(identity.provenance), true);
  assert.equal(Object.isFrozen(identity.provenance.metadata), true);
  assert.equal(Object.isFrozen(identity.temporalContext), true);
  assert.equal(Object.isFrozen(identity.consolidationState), true);
  assert.equal(
    Object.isFrozen(identity.consolidationState.preservedIdentityFields),
    true,
  );
  assert.equal(Object.isFrozen(input.runtimeInvariants.deployment), false);
  assert.equal(Object.isFrozen(input.provenance.metadata), false);
  assert.throws(() => {
    identity.persona = "mutated persona";
  }, TypeError);
  assert.throws(() => {
    identity.safetyConstraints.push("mutated safety constraint");
  }, TypeError);
  assert.throws(() => {
    identity.runtimeInvariants.deployment.tenant = "mutated-tenant";
  }, TypeError);
  assert.throws(() => {
    identity.consolidationState.preservedIdentityFields.push("memoryId");
  }, TypeError);
});

test("old-generation edge helper normalizes identifier and metadata defaults", () => {
  const from = "old/agent-007/long_term_memory/ltm-1";
  const to = "old/agent-007/consolidation_record/consolidation-1";
  const edge = createOldGenerationEdge({
    agentId: "agent-007",
    from,
    to,
    relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
    provenance: {
      source: "sleep-window",
      observedAt: "2026-04-12T09:15:00Z",
      evidence: ["consolidation-run-1"],
    },
    temporalContext: {
      consolidatedAt: "2026-04-12T09:15:00Z",
    },
    consolidationState: {
      journalRecordId: "consolidation-1",
      policyVersion: "old-generation-v1",
      sourceMemoryIds: ["stm-1"],
    },
  });

  assert.equal(
    edge.edgeId,
    "old/agent-007/edge/long_term_memory_created_by_consolidation/old%2Fagent-007%2Flong_term_memory%2Fltm-1->old%2Fagent-007%2Fconsolidation_record%2Fconsolidation-1",
  );
  assert.equal(edge.agentId, "agent-007");
  assert.equal(edge.temporalContext.consolidatedAt, "2026-04-12T09:15:00Z");
  assert.equal(edge.salience, null);
  assert.equal(edge.consolidationState.status, "preserved");
  assert.equal(edge.consolidationState.journalRecordId, "consolidation-1");
  assert.ok(Object.isFrozen(edge));
});

test("archived memory helper preserves restore-safe source metadata and derives source provenance", () => {
  const archivedMemory = createArchivedMemory(
    createArchivedMemoryInput("archive-1", {
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
      },
    }),
  );

  assert.equal(
    archivedMemory.nodeId,
    "old/agent-007/archived_memory/archive-1",
  );
  assert.equal(archivedMemory.originalGeneration, MEMORY_NODE_KINDS.youngGeneration);
  assert.equal(archivedMemory.originalMemoryKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(archivedMemory.originalNodeId, null);
  assert.equal(archivedMemory.originalProvenance.source, "conversation");
  assert.equal(archivedMemory.consolidationState.lastOperation, "preserve");
  assert.equal(archivedMemory.temporalContext.consolidatedAt, "2026-04-12T09:05:00Z");
  assert.ok(Object.isFrozen(archivedMemory));
});

test("archived memory helper rejects old-generation sources that omit canonical originalNodeId", () => {
  assert.throws(
    () =>
      createArchivedMemory(
        createArchivedMemoryInput("archive-old-1", {
          originalGeneration: MEMORY_NODE_KINDS.oldGeneration,
          originalMemoryKind: MEMORY_NODE_KINDS.longTermMemory,
          originalMemoryId: "ltm-1",
          originalNodeId: null,
          snapshot: {
            memoryId: "ltm-1",
            summary: "Historical durable memory.",
            provenance: {
              source: "conversation",
              observedAt: "2026-04-12T08:55:00Z",
              evidence: ["turn-ltm-1"],
            },
          },
        }),
      ),
    /must preserve originalNodeId/,
  );
});

test("memory graph factory wraps young-generation memories in retrieval-safe envelopes", () => {
  const graph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      workingMemory: [
        {
          memoryId: "wm-1",
          content: "Draft the rollout plan before noon.",
        },
      ],
      shortTermMemory: [
        {
          record: {
            memoryId: "stm-1",
            summary: "The user confirmed the rollout depends on legal review.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T10:00:00Z",
            maskedBy: "offline-consolidation",
            reason: "stale-window",
            provenance: {
              source: "sleep-window",
            },
          },
        },
      ],
    },
  );

  assert.deepEqual(graph.youngGeneration.workingMemory[0].record, {
    memoryId: "wm-1",
    content: "Draft the rollout plan before noon.",
  });
  assert.equal(graph.youngGeneration.workingMemory[0].inactiveForRetrieval, false);
  assert.equal(graph.youngGeneration.workingMemory[0].masking.isMasked, false);
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].record.summary,
    "The user confirmed the rollout depends on legal review.",
  );
  assert.equal(graph.youngGeneration.shortTermMemory[0].inactiveForRetrieval, true);
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.maskedBy,
    "offline-consolidation",
  );
});

test("young generation graph state helpers round-trip live memory state and edges", () => {
  const oldMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const oldEvidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "evidence-1",
  );
  const originalGraph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      workingMemory: [
        {
          record: {
            memoryId: "wm-1",
            content: "Draft the rollout plan before noon.",
          },
          masking: {
            provenance: {
              source: "runtime",
            },
          },
        },
      ],
      shortTermMemory: [
        {
          record: {
            memoryId: "wm-1",
            summary: "Captured the rollout milestones from the planning session.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T09:10:00Z",
            maskedBy: "idle-consolidation-suggester",
            reason: "inactive",
            provenance: {
              source: "offline-suggestion",
            },
          },
        },
      ],
      importanceIndex: [
        {
          entryId: "importance-wm-1",
          agentId: "agent-007",
          memoryId: "wm-1",
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          signals: {
            taskRelevance: 0.9,
            repetition: 0.7,
          },
          lastUpdatedAt: "2026-04-12T09:00:00Z",
        },
      ],
      longTermMemory: [
        {
          agentId: "agent-007",
          memoryId: "ltm-1",
          category: "semantic",
          content: "Agent prefers explicit source citations in summaries.",
          summary: "Prefer explicit citations.",
          confidence: 0.84,
          stabilizedAt: "2026-04-12T09:00:00Z",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:00:00Z",
            evidence: ["turn-18"],
          },
        },
      ],
      memoryEvidence: [
        {
          evidenceId: "evidence-1",
          agentId: "agent-007",
          kind: "conversation_excerpt",
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          detail: "The user asked for citations twice before accepting the answer.",
          reference: "turn-18",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:00:00Z",
            evidence: ["turn-18"],
          },
        },
      ],
      consolidationJournal: [
        {
          recordId: "consolidation-1",
          agentId: "agent-007",
          operation: "preserve",
          runtimePhase: "idle",
          consolidatedAt: "2026-04-12T09:15:00Z",
          sourceMemoryIds: ["wm-1"],
          policyVersion: "old-generation-v1",
          preservedIdentityFields: ["agentId", "persona", "role"],
          provenance: {
            source: "idle-window",
            observedAt: "2026-04-12T09:15:00Z",
            evidence: ["consolidation-run-1"],
          },
        },
      ],
      edges: [
        {
          from: "importance-wm-1",
          to: "wm-1",
          relation: "importance_to_working_memory",
        },
        {
          from: "wm-1",
          to: "wm-1",
          relation: "working_to_short_term_capture",
        },
        {
          from: oldMemoryNodeId,
          to: oldEvidenceNodeId,
          relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        },
      ],
    },
  );

  const savedState = saveYoungGenerationGraphState(originalGraph);
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(originalGraph.oldGeneration.immutableIdentity, {
      longTermMemory: originalGraph.oldGeneration.longTermMemory,
      memoryEvidence: originalGraph.oldGeneration.memoryEvidence,
      consolidationJournal: originalGraph.oldGeneration.consolidationJournal,
      edges: [originalGraph.edges[2]],
    }),
    JSON.parse(JSON.stringify(savedState)),
  );

  assert.equal(savedState.schemaId, YOUNG_GENERATION_GRAPH_STATE_SCHEMA.schemaId);
  assert.equal(savedState.schemaVersion, YOUNG_GENERATION_GRAPH_STATE_SCHEMA.version);
  assert.equal(savedState.constructionMetadata.agentId, "agent-007");
  assert.equal(
    savedState.constructionMetadata.sourceGraphSchemaId,
    MEMORY_GRAPH_SCHEMA.schemaId,
  );
  assert.equal(
    savedState.constructionMetadata.youngGenerationNodeKind,
    MEMORY_NODE_KINDS.youngGeneration,
  );
  assert.equal(typeof savedState.constructionMetadata.savedAt, "string");
  assert.deepEqual(savedState.youngGeneration, originalGraph.youngGeneration);
  assert.deepEqual(savedState.edges, originalGraph.edges.slice(0, 2));
  assert.ok(Object.isFrozen(savedState.youngGeneration));
  assert.ok(Object.isFrozen(savedState.youngGeneration.workingMemory[0]));
  assert.ok(Object.isFrozen(savedState.constructionMetadata));
  assert.deepEqual(restoredGraph.youngGeneration, originalGraph.youngGeneration);
  assert.deepEqual(restoredGraph.edges, [originalGraph.edges[2], ...savedState.edges]);
  assert.deepEqual(restoredGraph.oldGeneration, originalGraph.oldGeneration);
});

test("young generation graph serialization works from the public accessor source contract", () => {
  const oldMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const oldEvidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "evidence-1",
  );
  const graph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      workingMemory: [
        {
          record: {
            memoryId: "wm-1",
            content: "Keep the runtime investigation in working memory.",
          },
        },
      ],
      shortTermMemory: [
        {
          record: {
            memoryId: "wm-1",
            summary: "Persist this for later offline consolidation.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T09:10:00Z",
            maskedBy: "offline-consolidation",
            reason: "stale-window",
          },
        },
      ],
      importanceIndex: [
        {
          entryId: "importance-wm-1",
          agentId: "agent-007",
          memoryId: "wm-1",
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          signals: {
            taskRelevance: 0.95,
          },
          lastUpdatedAt: "2026-04-12T09:00:00Z",
        },
      ],
      longTermMemory: [createLongTermMemoryInput("ltm-1")],
      memoryEvidence: [createMemoryEvidenceInput("evidence-1")],
      edges: [
        {
          from: "importance-wm-1",
          to: "wm-1",
          relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
        },
        {
          from: "wm-1",
          to: "wm-1",
          relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
        },
        {
          from: oldMemoryNodeId,
          to: oldEvidenceNodeId,
          relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        },
      ],
    },
  );

  const accessorSource = Object.freeze({
    getAgentId: () => graph.agentId,
    getYoungGeneration: () => graph.youngGeneration,
    getEdges: () => graph.edges,
  });

  assert.equal(getMemoryGraphAgentId(accessorSource), graph.agentId);
  assert.deepEqual(getYoungGenerationConstructionState(accessorSource), graph.youngGeneration);
  assert.deepEqual(getYoungGenerationSnapshotEdges(accessorSource), graph.edges.slice(0, 2));

  const savedState = saveYoungGenerationGraphState(accessorSource);

  assert.deepEqual(savedState.youngGeneration, graph.youngGeneration);
  assert.deepEqual(savedState.edges, graph.edges.slice(0, 2));
  assert.equal(savedState.constructionMetadata.agentId, graph.agentId);
});

test("young generation graph serialization persists derived masking snapshots and audit fields for masked memories", () => {
  const accessorSource = Object.freeze({
    getAgentId: () => "agent-007",
    getYoungGeneration: () => ({
      generation: "young",
      workingMemory: [],
      shortTermMemory: [
        {
          record: {
            memoryId: "stm-masked",
            summary: "Preserve this before retrieval masking is persisted.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T09:10:00Z",
            maskedBy: "offline-consolidation",
            reason: "stale-window",
            provenance: {
              source: "sleep-window",
              auditRecordId: "mask-9",
              policyVersion: "stale-memory-v4",
              runtimePhase: "sleep",
              sourceEvaluationAt: "2026-04-12T09:00:00Z",
              sourceEvaluationMode: "offline-suggestion-only",
            },
          },
        },
      ],
      importanceIndex: [],
    }),
    getEdges: () => [],
  });

  const savedState = saveYoungGenerationGraphState(accessorSource);

  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Preserve this before retrieval masking is persisted.",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.sourceField,
    "summary",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.capturedAt,
    "2026-04-12T09:10:00Z",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.auditRecordId,
    "mask-9",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.policyVersion,
    "stale-memory-v4",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.runtimePhase,
    "sleep",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.sourceEvaluationMode,
    "offline-suggestion-only",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.recordedAt,
    "2026-04-12T09:10:00Z",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.actor,
    "offline-consolidation",
  );
});

test("young generation graph serialization rejects missing public agent identity access", () => {
  assert.throws(
    () =>
      saveYoungGenerationGraphState({
        getYoungGeneration: () => ({
          generation: "young",
        }),
        getEdges: () => [],
      }),
    /non-empty agentId/,
  );
});

test("retrieval view excludes inactive young-generation memories without removing stored state", () => {
  const graph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      workingMemory: [
        {
          record: {
            memoryId: "wm-active",
            content: "Current user task is release coordination.",
          },
        },
        {
          record: {
            memoryId: "wm-hidden",
            content: "Old draft context retained for offline review.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T09:10:00Z",
            maskedBy: "offline-consolidation",
            reason: "stale-window",
          },
        },
      ],
      shortTermMemory: [
        {
          record: {
            memoryId: "stm-active",
            summary: "The legal review is blocked on export terms.",
          },
        },
        {
          record: {
            memoryId: "stm-hidden",
            summary: "Older milestone summary retained for offline consolidation.",
          },
          inactiveForRetrieval: true,
          masking: {
            maskedAt: "2026-04-12T09:15:00Z",
            maskedBy: "offline-consolidation",
            reason: "stale-window",
          },
        },
      ],
      importanceIndex: [
        {
          entryId: "importance-wm-active",
          agentId: "agent-007",
          memoryId: "wm-active",
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          signals: {
            taskRelevance: 0.95,
          },
          lastUpdatedAt: "2026-04-12T09:00:00Z",
        },
        {
          entryId: "importance-wm-hidden",
          agentId: "agent-007",
          memoryId: "wm-hidden",
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          signals: {
            taskRelevance: 0.6,
          },
          lastUpdatedAt: "2026-04-12T08:55:00Z",
        },
        {
          entryId: "importance-stm-active",
          agentId: "agent-007",
          memoryId: "stm-active",
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
          signals: {
            recallPriority: 0.88,
          },
          lastUpdatedAt: "2026-04-12T09:05:00Z",
        },
        {
          entryId: "importance-stm-hidden",
          agentId: "agent-007",
          memoryId: "stm-hidden",
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
          signals: {
            recallPriority: 0.5,
          },
          lastUpdatedAt: "2026-04-12T08:50:00Z",
        },
      ],
    },
  );

  const retrievalView = createYoungGenerationRetrievalView(graph);
  const savedState = saveYoungGenerationGraphState(graph);

  assert.equal(retrievalView.generation, "young");
  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active"],
  );
  assert.deepEqual(
    retrievalView.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-active"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-active", "importance-stm-active"],
  );
  assert.ok(Object.isFrozen(retrievalView));
  assert.ok(
    retrievalView.workingMemory.every((memory) => memory.inactiveForRetrieval === false),
  );
  assert.ok(
    retrievalView.shortTermMemory.every((memory) => memory.inactiveForRetrieval === false),
  );

  assert.deepEqual(
    graph.youngGeneration.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active", "wm-hidden"],
  );
  assert.deepEqual(
    graph.youngGeneration.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-active", "stm-hidden"],
  );
  assert.equal(graph.youngGeneration.workingMemory[1].inactiveForRetrieval, true);
  assert.equal(graph.youngGeneration.shortTermMemory[1].inactiveForRetrieval, true);
  assert.deepEqual(
    savedState.youngGeneration.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active", "wm-hidden"],
  );
  assert.deepEqual(
    savedState.youngGeneration.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-active", "stm-hidden"],
  );
  assert.deepEqual(
    savedState.youngGeneration.importanceIndex.map((entry) => entry.entryId),
    [
      "importance-wm-active",
      "importance-wm-hidden",
      "importance-stm-active",
      "importance-stm-hidden",
    ],
  );
});

test("inspection view rehydrates retained masked content after persistence restore without changing stored masked records", () => {
  const graph = createMemoryGraph(createIdentityInput(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-hidden",
          summary: "[masked for retrieval]",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:15:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Older milestone summary retained for offline consolidation.",
            sourceField: "summary",
            capturedAt: "2026-04-12T09:15:00Z",
          },
          audit: {
            auditRecordId: "mask-11",
            policyVersion: "stale-memory-v5",
            runtimePhase: "sleep",
            recordedAt: "2026-04-12T09:15:00Z",
            actor: "offline-consolidation",
          },
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-stm-hidden",
        agentId: "agent-007",
        memoryId: "stm-hidden",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.42,
        },
        lastUpdatedAt: "2026-04-12T09:14:00Z",
      },
    ],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(graph.oldGeneration.immutableIdentity),
    savedState,
  );
  const retrievalView = createYoungGenerationRetrievalView(restoredGraph);
  const administrativeView = createYoungGenerationAdministrativeView(restoredGraph);
  const inspectionView = createYoungGenerationInspectionView(restoredGraph);
  const resavedState = saveYoungGenerationGraphState(restoredGraph);

  assert.equal(savedState.youngGeneration.shortTermMemory[0].record.summary, "[masked for retrieval]");
  assert.equal(
    restoredGraph.youngGeneration.shortTermMemory[0].record.summary,
    "[masked for retrieval]",
  );
  assert.equal(retrievalView.shortTermMemory.length, 0);
  assert.equal(retrievalView.importanceIndex.length, 0);
  assert.equal(
    administrativeView.shortTermMemory[0].record.summary,
    "Older milestone summary retained for offline consolidation.",
  );
  assert.equal(
    administrativeView.shortTermMemory[0].masking.audit.auditRecordId,
    "mask-11",
  );
  assert.deepEqual(
    administrativeView.importanceIndex.map((entry) => entry.entryId),
    ["importance-stm-hidden"],
  );
  assert.ok(Object.isFrozen(administrativeView));
  assert.equal(
    inspectionView.shortTermMemory[0].record.summary,
    "Older milestone summary retained for offline consolidation.",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Older milestone summary retained for offline consolidation.",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].masking.audit.auditRecordId,
    "mask-11",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].masking.audit.runtimePhase,
    "sleep",
  );
  assert.deepEqual(
    inspectionView.importanceIndex.map((entry) => entry.entryId),
    ["importance-stm-hidden"],
  );
  assert.deepEqual(administrativeView, inspectionView);
  assert.equal(
    resavedState.youngGeneration.shortTermMemory[0].record.summary,
    "[masked for retrieval]",
  );
  assert.ok(Object.isFrozen(inspectionView));
});

test("young generation graph state loader rejects mismatched generation tags", () => {
  const graph = createMemoryGraph({
    agentId: "agent-007",
    persona: "deliberate analyst",
    role: "researcher",
    durableMission: "Protect user context quality.",
    safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
    ownership: ["customer-insight-domain"],
    nonNegotiablePreferences: ["preserve provenance"],
    runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
    protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.youngGeneration.generation = "youngest";

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /generation "young"/,
  );
});

test("young generation graph state loader rejects incompatible public snapshot metadata", () => {
  const graph = createMemoryGraph({
    agentId: "agent-007",
    persona: "deliberate analyst",
    role: "researcher",
    durableMission: "Protect user context quality.",
    safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
    ownership: ["customer-insight-domain"],
    nonNegotiablePreferences: ["preserve provenance"],
    runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
    protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.schemaVersion = "9.9.9";
  savedState.constructionMetadata.agentId = "agent-999";

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /schemaVersion must be "1.0.0"/,
  );
});

test("young generation graph state loader rejects non-young edge relations in snapshots", () => {
  const graph = createMemoryGraph({
    agentId: "agent-007",
    persona: "deliberate analyst",
    role: "researcher",
    durableMission: "Protect user context quality.",
    safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
    ownership: ["customer-insight-domain"],
    nonNegotiablePreferences: ["preserve provenance"],
    runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
    protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.edges = [
    {
      from: "ltm-1",
      to: "evidence-1",
      relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
    },
  ];

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /public young-generation edge schema/,
  );
});

test("young generation graph state loader rejects missing snapshot construction metadata", () => {
  const graph = createMemoryGraph(createIdentityInput());
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  delete savedState.constructionMetadata;

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /constructionMetadata must be an object/,
  );
});

test("young generation graph state loader rejects inconsistent masking payloads", () => {
  const graph = createMemoryGraph(createIdentityInput(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-1",
          summary: "Retained for offline consolidation.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:10:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          provenance: {
            source: "offline-suggestion",
          },
        },
      },
    ],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.youngGeneration.shortTermMemory[0].inactiveForRetrieval = false;

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /derived masking fields in sync/,
  );
});

test("young generation graph state loader rejects importance entries with derived score drift", () => {
  const graph = createMemoryGraph(createIdentityInput(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-1",
          content: "Keep the draft in working memory.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-1",
        agentId: "agent-007",
        memoryId: "wm-1",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.9,
          recency: 0.7,
        },
        lastUpdatedAt: "2026-04-12T09:00:00Z",
      },
    ],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.youngGeneration.importanceIndex[0].importanceScore = 0.2;

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /importanceScore must match the derived importance score 0\.8/,
  );
});

test("young generation graph state loader rejects edges that do not resolve inside the snapshot", () => {
  const graph = createMemoryGraph(createIdentityInput(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-1",
          content: "Investigate the consolidation candidate.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-1",
        agentId: "agent-007",
        memoryId: "wm-1",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.9,
        },
        lastUpdatedAt: "2026-04-12T09:00:00Z",
      },
    ],
    edges: [
      {
        from: "importance-wm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
      },
    ],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));

  savedState.edges[0].to = "wm-missing";

  assert.throws(
    () => loadYoungGenerationGraphState(graph, savedState),
    /must reference an existing "working_memory" snapshot node/,
  );
});

test("old-generation artifact factories create frozen evidence and consolidation records", () => {
  const evidence = createMemoryEvidence({
    evidenceId: "evidence-1",
    agentId: "agent-007",
    kind: "runtime_trace",
    source: "trace-store",
    observedAt: "2026-04-12T09:00:00Z",
    detail: "The memory was reinforced after repeated successful tool use.",
    provenance: {
      source: "trace-store",
      observedAt: "2026-04-12T09:00:00Z",
      evidence: ["trace-1"],
    },
  });
  const record = createConsolidationRecord({
    recordId: "consolidation-1",
    agentId: "agent-007",
    operation: "reinforce",
    runtimePhase: "sleep",
    consolidatedAt: "2026-04-12T10:00:00Z",
    sourceMemoryIds: ["stm-10", "stm-11"],
    policyVersion: "old-generation-v1",
    provenance: {
      source: "sleep-window",
      observedAt: "2026-04-12T10:00:00Z",
      evidence: ["run-1"],
    },
  });

  assert.equal(evidence.reference, null);
  assert.deepEqual(record.sourceMemoryIds, ["stm-10", "stm-11"]);
  assert.deepEqual(record.preservedIdentityFields, []);
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(record));
});

test("importance index APIs store, update, and query salience separately from memory payloads", () => {
  const initialGraph = createMemoryGraph(
    {
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
      ownership: ["customer-insight-domain"],
      nonNegotiablePreferences: ["preserve provenance"],
      runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
      protectedCoreFacts: ["agent-007 belongs to tenant zep"],
    },
    {
      workingMemory: [
        {
          memoryId: "wm-1",
          content: "Draft the rollout plan before noon.",
        },
      ],
    },
  );

  const graphWithImportance = putImportanceIndexEntry(initialGraph, {
    entryId: "importance-wm-1",
    agentId: "agent-007",
    memoryId: "wm-1",
    memoryKind: MEMORY_NODE_KINDS.workingMemory,
    signals: {
      taskRelevance: 0.9,
      repetition: 0.7,
    },
    lastUpdatedAt: "2026-04-12T09:00:00Z",
  });

  const updatedGraph = updateImportanceIndexEntry(
    graphWithImportance,
    {
      memoryId: "wm-1",
      memoryKind: MEMORY_NODE_KINDS.workingMemory,
    },
    {
      signals: {
        userExplicitness: 1,
      },
      lastUpdatedAt: "2026-04-12T09:05:00Z",
    },
  );

  const queriedEntries = queryImportanceIndex(updatedGraph, {
    memoryKind: MEMORY_NODE_KINDS.workingMemory,
    minImportanceScore: 0.85,
    signalName: "userExplicitness",
    minSignalValue: 0.9,
  });

  assert.equal(initialGraph.youngGeneration.importanceIndex.length, 0);
  assert.equal(graphWithImportance.youngGeneration.importanceIndex.length, 1);
  assert.equal(updatedGraph.youngGeneration.importanceIndex[0].importanceScore, 0.8667);
  assert.equal(
    updatedGraph.youngGeneration.workingMemory[0].record.content,
    "Draft the rollout plan before noon.",
  );
  assert.equal(queriedEntries.length, 1);
  assert.equal(queriedEntries[0].memoryId, "wm-1");
  assert.ok(!("content" in queriedEntries[0]));
});
