import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  YOUNG_GENERATION_EDGE_SCHEMA,
  archiveStaleMemories,
  createMemoryGraph,
  createOldGenerationEdge,
  createOldGenerationNodeId,
  createRuntimePhase,
  evaluateStaleMemories,
  loadOldGenerationGraphState,
  saveOldGenerationGraphState,
} from "../src/index.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const YOUNG_GENERATION_RELATIONS = new Set(
  Object.values(YOUNG_GENERATION_EDGE_SCHEMA).map((edgeDefinition) => edgeDefinition.relation),
);

const createIdentity = () => ({
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

const createInactiveYoungMemory = (
  record,
  inactiveAt = "2026-03-15T12:00:00Z",
  reason = "batched-for-possible-archival",
) => ({
  record,
  inactiveForRetrieval: true,
  masking: {
    maskedAt: inactiveAt,
    maskedBy: "young-generation-masker",
    reason,
  },
  lifecycle: {
    state: "inactive",
    inactiveAt,
    inactiveReason: reason,
  },
});

const createYoungGenerationShellGraph = (graph) =>
  createMemoryGraph(graph.oldGeneration.immutableIdentity, {
    workingMemory: graph.youngGeneration.workingMemory,
    shortTermMemory: graph.youngGeneration.shortTermMemory,
    importanceIndex: graph.youngGeneration.importanceIndex,
    edges: graph.edges.filter((edge) => YOUNG_GENERATION_RELATIONS.has(edge.relation)),
  });

const roundTripArchivedMemory = (graph, archiveId) => {
  const savedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(graph)));
  const restoredGraph = loadOldGenerationGraphState(
    createYoungGenerationShellGraph(graph),
    savedState,
  );

  return {
    savedArchive: savedState.oldGeneration.archivedMemory.find(
      (entry) => entry.archiveId === archiveId,
    ),
    restoredArchive: restoredGraph.oldGeneration.archivedMemory.find(
      (entry) => entry.archiveId === archiveId,
    ),
  };
};

const toIsoString = (value) => new Date(value).toISOString();

test("young-generation archival records preserve restoration identity, lineage, timestamps, and detached recovery metadata", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-active",
          summary: "Fresh dependency recap remains in the active young generation.",
        },
      },
      createInactiveYoungMemory({
        memoryId: "stm-archive",
        summary: "Older milestone recap is no longer useful for live retrieval.",
        provenance: {
          source: "runtime-note",
          observedAt: "2026-02-20T12:00:00Z",
        },
      }, "2026-03-02T09:30:00Z"),
    ],
    importanceIndex: [
      {
        entryId: "importance-stm-active",
        agentId: "agent-007",
        memoryId: "stm-active",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.88,
        },
        lastUpdatedAt: "2026-04-12T09:30:00Z",
      },
      {
        entryId: "importance-stm-archive",
        agentId: "agent-007",
        memoryId: "stm-archive",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.12,
        },
        lastUpdatedAt: "2026-03-02T09:30:00Z",
      },
    ],
    edges: [
      {
        from: "stm-archive",
        to: "stm-active",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.shortTermAssociation.relation,
      },
      {
        from: "importance-stm-archive",
        to: "stm-archive",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
      },
    ],
  });
  const evaluation = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "stm-archive",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.1,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
    ],
  });

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("idle"),
    archivedAt: "2026-04-12T12:15:00Z",
    archivedBy: "offline-consolidation",
    policyVersion: "archive-policy-v1",
    provenance: {
      batchId: "archival-pass-young-contract",
    },
  });
  const archivedMemory = result.archivedTransitions[0].archivedMemory;
  const { savedArchive, restoredArchive } = roundTripArchivedMemory(
    result.nextGraph,
    archivedMemory.archiveId,
  );

  assert.equal(
    archivedMemory.nodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.archivedMemory,
      "agent-007",
      archivedMemory.archiveId,
    ),
  );
  assert.equal(archivedMemory.agentId, "agent-007");
  assert.equal(archivedMemory.originalGeneration, MEMORY_NODE_KINDS.youngGeneration);
  assert.equal(archivedMemory.originalMemoryKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(archivedMemory.originalMemoryId, "stm-archive");
  assert.equal(archivedMemory.originalNodeId, null);
  assert.deepEqual(archivedMemory.originalProvenance, {
    source: "runtime-note",
    observedAt: "2026-02-20T12:00:00Z",
  });
  assert.equal(archivedMemory.archivedAt, toIsoString("2026-04-12T12:15:00Z"));
  assert.equal(archivedMemory.lastRestoredAt, null);
  assert.equal(archivedMemory.provenance.source, "offline-archival-transition");
  assert.equal(archivedMemory.provenance.actor, "offline-consolidation");
  assert.equal(archivedMemory.provenance.batchId, "archival-pass-young-contract");
  assert.equal(
    archivedMemory.temporalContext.firstObservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.temporalContext.lastObservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.temporalContext.consolidatedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(archivedMemory.consolidationState.status, "preserved");
  assert.equal(archivedMemory.consolidationState.lastOperation, "preserve");
  assert.deepEqual(archivedMemory.consolidationState.sourceMemoryIds, ["stm-archive"]);
  assert.equal(archivedMemory.consolidationState.policyVersion, "archive-policy-v1");
  assert.equal(archivedMemory.snapshot.sourceCollection, "shortTermMemory");
  assert.equal(archivedMemory.snapshot.record.memoryId, "stm-archive");
  assert.equal(archivedMemory.snapshot.inactiveForRetrieval, true);
  assert.equal(archivedMemory.snapshot.lifecycle.state, "archived");
  assert.equal(
    archivedMemory.snapshot.lifecycle.archiveLinkage.archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    archivedMemory.snapshot.lifecycle.archiveLinkage.archiveNodeId,
    archivedMemory.nodeId,
  );
  assert.equal(
    archivedMemory.snapshot.lifecycle.archiveLinkage.archivedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(archivedMemory.snapshot.recoveryContext.version, "1.0.0");
  assert.equal(
    archivedMemory.snapshot.recoveryContext.preservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.preservedBy,
    "offline-consolidation",
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceMemoryId,
    archivedMemory.originalMemoryId,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceGeneration,
    archivedMemory.originalGeneration,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceMemoryKind,
    archivedMemory.originalMemoryKind,
  );
  assert.deepEqual(
    archivedMemory.snapshot.recoveryContext.detachedImportanceIndex.map((entry) => entry.entryId),
    ["importance-stm-archive"],
  );
  assert.deepEqual(
    archivedMemory.snapshot.recoveryContext.detachedEdges.map((edge) => edge.relation).sort(),
    [
      YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
      YOUNG_GENERATION_EDGE_SCHEMA.shortTermAssociation.relation,
    ],
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.staleEvaluation.retentionValue,
    0.1,
  );
  assert.deepEqual(savedArchive, archivedMemory);
  assert.deepEqual(restoredArchive, archivedMemory);
});

test("old-generation archival records preserve restoration lineage and detached durable graph context through persistence round-trips", async () => {
  const archivedNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-archive",
  );
  const activeNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-active",
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    "agent-007",
    "evidence-archive",
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    "agent-007",
    "consolidation-archive",
  );
  const graph = createMemoryGraph(createIdentity(), {
    longTermMemory: [
      {
        memoryId: "ltm-active",
        category: "semantic",
        content: "Current launch guardrail stays active in old generation.",
        summary: "Active durable launch guardrail.",
        confidence: 0.93,
        stabilizedAt: "2026-04-12T10:00:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T10:00:00Z",
          evidence: ["turn-active"],
        },
      },
      {
        memoryId: "ltm-archive",
        category: "semantic",
        content: "Retired launch policy is kept only for offline restoration.",
        summary: "Retired launch policy snapshot.",
        confidence: 0.41,
        stabilizedAt: "2026-02-01T10:00:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-02-01T10:00:00Z",
          evidence: ["turn-archive"],
        },
        temporalContext: {
          firstObservedAt: "2026-02-01T10:00:00Z",
          lastObservedAt: "2026-02-10T10:00:00Z",
          stabilizedAt: "2026-02-01T10:00:00Z",
          consolidatedAt: "2026-02-10T10:00:00Z",
          lastAccessedAt: "2026-02-10T10:00:00Z",
        },
        consolidationState: {
          status: "preserved",
          lastOperation: "preserve",
          journalRecordId: "consolidation-archive",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["stm-archive-origin"],
        },
      },
    ],
    memoryEvidence: [
      {
        evidenceId: "evidence-archive",
        kind: "conversation_excerpt",
        source: "conversation",
        observedAt: "2026-02-01T10:00:00Z",
        detail: "The old launch policy came from an earlier planning conversation.",
        provenance: {
          source: "conversation",
          observedAt: "2026-02-01T10:00:00Z",
          evidence: ["turn-archive"],
        },
      },
    ],
    consolidationJournal: [
      {
        recordId: "consolidation-archive",
        operation: "preserve",
        runtimePhase: "idle",
        consolidatedAt: "2026-02-10T10:00:00Z",
        sourceMemoryIds: ["stm-archive-origin"],
        policyVersion: "old-generation-v1",
        provenance: {
          source: "idle-window",
          observedAt: "2026-02-10T10:00:00Z",
          evidence: ["consolidation-archive"],
        },
      },
    ],
    edges: [
      createOldGenerationEdge({
        agentId: "agent-007",
        from: archivedNodeId,
        to: activeNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        provenance: {
          source: "offline-consolidation",
        },
      }),
      createOldGenerationEdge({
        agentId: "agent-007",
        from: archivedNodeId,
        to: evidenceNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        provenance: {
          source: "offline-consolidation",
        },
      }),
      createOldGenerationEdge({
        agentId: "agent-007",
        from: archivedNodeId,
        to: recordNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
        provenance: {
          source: "offline-consolidation",
        },
        consolidationState: {
          journalRecordId: "consolidation-archive",
        },
      }),
    ],
  });
  const evaluation = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 14 * DAY_IN_MS,
    recencyHorizonMs: 45 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.6,
    memories: [
      {
        memoryId: "ltm-archive",
        createdAt: "2026-02-01T10:00:00Z",
        lastAccessedAt: "2026-02-10T10:00:00Z",
        accessCount: 0,
        retentionValue: 0.1,
        metadata: {
          generation: MEMORY_NODE_KINDS.oldGeneration,
          memoryKind: MEMORY_NODE_KINDS.longTermMemory,
        },
      },
    ],
  });

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("sleep"),
    archivedAt: "2026-04-12T12:20:00Z",
    archivedBy: "offline-consolidation",
    policyVersion: "archive-policy-v1",
    provenance: {
      batchId: "archival-pass-old-contract",
    },
  });
  const archivedMemory = result.archivedTransitions[0].archivedMemory;
  const { savedArchive, restoredArchive } = roundTripArchivedMemory(
    result.nextGraph,
    archivedMemory.archiveId,
  );

  assert.equal(
    archivedMemory.nodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.archivedMemory,
      "agent-007",
      archivedMemory.archiveId,
    ),
  );
  assert.equal(archivedMemory.agentId, "agent-007");
  assert.equal(archivedMemory.originalGeneration, MEMORY_NODE_KINDS.oldGeneration);
  assert.equal(archivedMemory.originalMemoryKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.equal(archivedMemory.originalMemoryId, "ltm-archive");
  assert.equal(archivedMemory.originalNodeId, archivedNodeId);
  assert.deepEqual(archivedMemory.originalProvenance, {
    source: "conversation",
    observedAt: "2026-02-01T10:00:00Z",
    evidence: ["turn-archive"],
  });
  assert.equal(archivedMemory.archivedAt, toIsoString("2026-04-12T12:20:00Z"));
  assert.equal(archivedMemory.lastRestoredAt, null);
  assert.equal(archivedMemory.provenance.source, "offline-archival-transition");
  assert.equal(archivedMemory.provenance.actor, "offline-consolidation");
  assert.equal(archivedMemory.provenance.batchId, "archival-pass-old-contract");
  assert.equal(
    archivedMemory.temporalContext.firstObservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.temporalContext.lastObservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.temporalContext.consolidatedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(archivedMemory.consolidationState.status, "preserved");
  assert.equal(archivedMemory.consolidationState.lastOperation, "preserve");
  assert.deepEqual(archivedMemory.consolidationState.sourceMemoryIds, ["ltm-archive"]);
  assert.equal(archivedMemory.consolidationState.policyVersion, "archive-policy-v1");
  assert.equal(archivedMemory.snapshot.sourceCollection, "longTermMemory");
  assert.equal(archivedMemory.snapshot.memoryId, "ltm-archive");
  assert.equal(archivedMemory.snapshot.recoveryContext.version, "1.0.0");
  assert.equal(
    archivedMemory.snapshot.recoveryContext.preservedAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.preservedBy,
    "offline-consolidation",
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceMemoryId,
    archivedMemory.originalMemoryId,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceGeneration,
    archivedMemory.originalGeneration,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceMemoryKind,
    archivedMemory.originalMemoryKind,
  );
  assert.deepEqual(archivedMemory.snapshot.recoveryContext.detachedImportanceIndex, []);
  assert.equal(archivedMemory.snapshot.recoveryContext.detachedEdges.length, 3);
  assert.equal(
    archivedMemory.snapshot.recoveryContext.detachedEdges.every(
      (edge) => edge.from === archivedNodeId || edge.to === archivedNodeId,
    ),
    true,
  );
  assert.equal(
    archivedMemory.snapshot.recoveryContext.staleEvaluation.retentionValue,
    0.1,
  );
  assert.deepEqual(savedArchive, archivedMemory);
  assert.deepEqual(restoredArchive, archivedMemory);
});
