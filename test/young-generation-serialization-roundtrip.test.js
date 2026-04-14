import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  YOUNG_GENERATION_EDGE_SCHEMA,
  createYoungGenerationInspectionView,
  createYoungGenerationRetrievalView,
  createMemoryGraph,
  createOldGenerationNodeId,
  getMemoryGraphAgentId,
  getYoungGenerationConstructionState,
  getYoungGenerationSnapshotEdges,
  loadYoungGenerationGraphState,
  saveYoungGenerationGraphState,
} from "../src/index.js";

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

const normalizeSavedAt = (state) => ({
  ...state,
  constructionMetadata: {
    ...state.constructionMetadata,
    savedAt: "<normalized-saved-at>",
  },
});

const createPersistableGraph = () => {
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

  return createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-1",
          content: "Keep the release checklist in working memory until legal sign-off.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-1",
          summary: "Older launch notes stay persisted for offline sleep-window review.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:00:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Older launch notes stay persisted for offline sleep-window review.",
            sourceField: "summary",
            capturedAt: "2026-04-12T10:00:00Z",
          },
          audit: {
            auditRecordId: "mask-42",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
            recordedAt: "2026-04-12T10:00:00Z",
            actor: "offline-consolidation",
          },
          provenance: {
            source: "offline-suggestion",
            auditRecordId: "mask-42",
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
          taskRelevance: 0.95,
          recency: 0.8,
        },
        lastUpdatedAt: "2026-04-12T09:55:00Z",
      },
      {
        entryId: "importance-stm-1",
        agentId: "agent-007",
        memoryId: "wm-1",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.62,
        },
        lastUpdatedAt: "2026-04-12T09:45:00Z",
      },
    ],
    longTermMemory: [
      {
        memoryId: "ltm-1",
        category: "semantic",
        content: "The team requires legal approval before rollout.",
        summary: "Rollouts require legal approval.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:00:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          evidence: ["turn-19"],
        },
      },
    ],
    memoryEvidence: [
      {
        evidenceId: "evidence-1",
        kind: "conversation_excerpt",
        source: "conversation",
        observedAt: "2026-04-12T09:00:00Z",
        detail: "The user said legal approval is mandatory before launch.",
        reference: "turn-19",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          evidence: ["turn-19"],
        },
      },
    ],
    consolidationJournal: [
      {
        recordId: "consolidation-1",
        operation: "preserve",
        runtimePhase: "idle",
        consolidatedAt: "2026-04-12T09:10:00Z",
        sourceMemoryIds: ["wm-1"],
        policyVersion: "old-generation-v1",
        preservedIdentityFields: ["agentId", "persona", "role"],
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["consolidation-run-1"],
        },
      },
    ],
    edges: [
      {
        from: oldMemoryNodeId,
        to: oldEvidenceNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
      },
      {
        from: "importance-wm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
      },
      {
        from: "importance-stm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
      },
      {
        from: "wm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
    ],
  });
};

const createShellGraph = (graph) =>
  createMemoryGraph(graph.oldGeneration.immutableIdentity, {
    longTermMemory: graph.oldGeneration.longTermMemory,
    memoryEvidence: graph.oldGeneration.memoryEvidence,
    consolidationJournal: graph.oldGeneration.consolidationJournal,
    edges: [graph.edges[0]],
  });

test("young-generation graph state round-trips through persisted JSON via the public serialization API", () => {
  const originalGraph = createPersistableGraph();
  const shellGraph = createShellGraph(originalGraph);

  const savedState = saveYoungGenerationGraphState({
    getAgentId: () => originalGraph.agentId,
    getYoungGeneration: () => originalGraph.youngGeneration,
    getEdges: () => originalGraph.edges,
  });
  const persistedJson = JSON.stringify(savedState);
  const restoredGraph = loadYoungGenerationGraphState(
    shellGraph,
    JSON.parse(persistedJson),
  );
  const resavedState = saveYoungGenerationGraphState(restoredGraph);

  assert.deepEqual(restoredGraph.youngGeneration, originalGraph.youngGeneration);
  assert.deepEqual(restoredGraph.oldGeneration, originalGraph.oldGeneration);
  assert.deepEqual(restoredGraph.edges, originalGraph.edges);
  assert.deepEqual(normalizeSavedAt(resavedState), normalizeSavedAt(savedState));

  const parsedSnapshot = JSON.parse(persistedJson);

  assert.equal(
    parsedSnapshot.youngGeneration.shortTermMemory[0].record.memoryId,
    "wm-1",
  );
  assert.equal(
    parsedSnapshot.youngGeneration.shortTermMemory[0].masking.audit.runtimePhase,
    "sleep",
  );
  assert.deepEqual(normalizeSavedAt(parsedSnapshot), normalizeSavedAt(savedState));
});

test("young-generation loader reuses frozen persisted nodes and edges for unchanged snapshot memories", () => {
  const originalGraph = createPersistableGraph();
  const shellGraph = createShellGraph(originalGraph);
  const savedState = saveYoungGenerationGraphState(originalGraph);
  const restoredGraph = loadYoungGenerationGraphState(shellGraph, savedState);
  const savedCaptureEdge = savedState.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
  );
  const restoredCaptureEdge = restoredGraph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
  );

  assert.strictEqual(
    restoredGraph.youngGeneration.workingMemory[0],
    savedState.youngGeneration.workingMemory[0],
  );
  assert.strictEqual(
    restoredGraph.youngGeneration.shortTermMemory[0],
    savedState.youngGeneration.shortTermMemory[0],
  );
  assert.strictEqual(
    restoredGraph.youngGeneration.importanceIndex[0],
    savedState.youngGeneration.importanceIndex[0],
  );
  assert.strictEqual(
    restoredGraph.youngGeneration.importanceIndex[1],
    savedState.youngGeneration.importanceIndex[1],
  );
  assert.strictEqual(restoredCaptureEdge, savedCaptureEdge);
});

test("public snapshot export derives canonical importance edges alongside the persisted index payload", () => {
  const originalGraph = createPersistableGraph();
  const snapshot = saveYoungGenerationGraphState({
    agentId: originalGraph.agentId,
    youngGeneration: originalGraph.youngGeneration,
    edges: [
      {
        from: "wm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
        edgeId: "should-not-leak-into-public-snapshot",
      },
    ],
  });
  const restoredGraph = loadYoungGenerationGraphState(
    createShellGraph(originalGraph),
    JSON.parse(JSON.stringify(snapshot)),
  );

  assert.deepEqual(snapshot.youngGeneration.importanceIndex, originalGraph.youngGeneration.importanceIndex);
  assert.deepEqual(snapshot.edges, [
    {
      from: "wm-1",
      to: "wm-1",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
    },
    {
      from: "importance-wm-1",
      to: "wm-1",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
    },
    {
      from: "importance-stm-1",
      to: "wm-1",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
    },
  ]);
  assert.deepEqual(restoredGraph.youngGeneration.importanceIndex, originalGraph.youngGeneration.importanceIndex);
  assert.deepEqual(restoredGraph.edges.slice(1), snapshot.edges);
});

test("restored graphs expose round-tripped young-generation structures and importance indexes through the public brain interfaces", () => {
  const originalGraph = createPersistableGraph();
  const snapshot = saveYoungGenerationGraphState({
    getAgentId: () => originalGraph.agentId,
    getYoungGeneration: () => originalGraph.youngGeneration,
    getEdges: () => [
      {
        from: "wm-1",
        to: "wm-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
    ],
  });
  const restoredGraph = loadYoungGenerationGraphState(
    createShellGraph(originalGraph),
    JSON.parse(JSON.stringify(snapshot)),
  );
  const restoredYoungGeneration = getYoungGenerationConstructionState(restoredGraph);
  const restoredYoungEdges = getYoungGenerationSnapshotEdges(restoredGraph);
  const retrievalView = createYoungGenerationRetrievalView(restoredGraph);
  const inspectionView = createYoungGenerationInspectionView(restoredGraph);

  assert.equal(getMemoryGraphAgentId(restoredGraph), originalGraph.agentId);
  assert.deepEqual(restoredYoungGeneration, originalGraph.youngGeneration);
  assert.deepEqual(restoredYoungEdges, snapshot.edges);
  assert.deepEqual(restoredGraph.youngGeneration.importanceIndex, originalGraph.youngGeneration.importanceIndex);
  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-1"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-1"],
  );
  assert.equal(retrievalView.shortTermMemory.length, 0);
  assert.equal(
    inspectionView.shortTermMemory[0].record.summary,
    "Older launch notes stay persisted for offline sleep-window review.",
  );
  assert.deepEqual(inspectionView.importanceIndex, originalGraph.youngGeneration.importanceIndex);
});

test("masked-memory audit metadata stays traceable after save-load round trips for later inspection", () => {
  const expectedAudit = {
    auditRecordId: "mask-trace-1",
    policyVersion: "stale-memory-v2",
    runtimePhase: "idle",
    sourceEvaluationAt: "2026-04-12T09:58:00Z",
    sourceEvaluationMode: "offline-suggestion-only",
    recordedAt: "2026-04-12T10:00:00Z",
    actor: "offline-consolidation",
    metadata: {
      source: "offline-suggestion",
      runtimeAuthority: "runtime-phase-controller",
      teamIdleSignalId: "team-idle-42",
    },
  };
  const expectedProvenance = {
    source: "offline-suggestion",
    auditRecordId: "mask-trace-1",
    policyVersion: "stale-memory-v2",
    runtimePhase: "idle",
    sourceEvaluationAt: "2026-04-12T09:58:00Z",
    sourceEvaluationMode: "offline-suggestion-only",
    teamIdleSignalId: "team-idle-42",
  };
  const originalGraph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-traceable",
          summary: "Traceable launch note retained for offline inspection.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:00:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Traceable launch note retained for offline inspection.",
            sourceField: "summary",
            capturedAt: "2026-04-12T10:00:00Z",
          },
          audit: expectedAudit,
          provenance: expectedProvenance,
        },
      },
    ],
  });
  const snapshot = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(originalGraph)));
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(originalGraph.oldGeneration.immutableIdentity),
    snapshot,
  );
  const inspectionView = createYoungGenerationInspectionView(restoredGraph);

  assert.deepEqual(
    snapshot.youngGeneration.shortTermMemory[0].masking.audit,
    expectedAudit,
  );
  assert.deepEqual(
    snapshot.youngGeneration.shortTermMemory[0].masking.provenance,
    expectedProvenance,
  );
  assert.deepEqual(
    restoredGraph.youngGeneration.shortTermMemory[0].masking.audit,
    expectedAudit,
  );
  assert.deepEqual(
    inspectionView.shortTermMemory[0].masking.audit,
    expectedAudit,
  );
  assert.deepEqual(
    inspectionView.shortTermMemory[0].masking.provenance,
    expectedProvenance,
  );
  assert.equal(
    inspectionView.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Traceable launch note retained for offline inspection.",
  );
});

test("young-generation graph state loader rejects serialized importance edges that drift from the saved index entry", () => {
  const originalGraph = createPersistableGraph();
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(originalGraph)));
  const importanceEdgeIndex = savedState.edges.findIndex(
    (edge) => edge.from === "importance-wm-1",
  );

  savedState.edges[importanceEdgeIndex] = {
    from: "importance-wm-1",
    to: "wm-1",
    relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
  };

  assert.throws(
    () => loadYoungGenerationGraphState(createShellGraph(originalGraph), savedState),
    /must match importanceIndex entry "importance-wm-1"/,
  );
});
