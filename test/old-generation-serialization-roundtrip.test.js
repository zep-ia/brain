import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  OLD_GENERATION_GRAPH_STATE_SCHEMA,
  YOUNG_GENERATION_EDGE_SCHEMA,
  createMemoryGraph,
  createOldGenerationNodeId,
  getMemoryGraphReconstructionProfile,
  loadOldGenerationGraphState,
  rebuildMemoryGraph,
  lookupLongTermMemory,
  saveOldGenerationGraphState,
  walkOldGenerationRelationships,
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

const YOUNG_GENERATION_RELATIONS = new Set(
  Object.values(YOUNG_GENERATION_EDGE_SCHEMA).map((edgeDefinition) => edgeDefinition.relation),
);

const normalizeSavedAt = (state) => ({
  ...state,
  constructionMetadata: {
    ...state.constructionMetadata,
    savedAt: "<normalized-saved-at>",
  },
});

const getYoungGenerationEdges = (graph) =>
  graph.edges.filter((edge) => YOUNG_GENERATION_RELATIONS.has(edge.relation));

const createYoungGenerationShellGraph = (graph, identity = graph.oldGeneration.immutableIdentity) =>
  createMemoryGraph(identity, {
    workingMemory: graph.youngGeneration.workingMemory,
    shortTermMemory: graph.youngGeneration.shortTermMemory,
    importanceIndex: graph.youngGeneration.importanceIndex,
    edges: getYoungGenerationEdges(graph),
  });

const getOldGenerationNodes = (graph) => [
  graph.oldGeneration.immutableIdentity,
  ...graph.oldGeneration.longTermMemory,
  ...graph.oldGeneration.archivedMemory,
  ...graph.oldGeneration.memoryEvidence,
  ...graph.oldGeneration.consolidationJournal,
];

const createNodeMap = (nodes) => new Map(nodes.map((node) => [node.nodeId, node]));
const createEdgeMap = (edges) => new Map(edges.map((edge) => [edge.edgeId, edge]));

const createPersistableGraph = () => {
  const semanticMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-1",
  );
  const learnedTraitNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-trait-1",
  );
  const historicalMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-legacy-1",
  );
  const archivedSourceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    "agent-007",
    "ltm-retired-1",
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

  return createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-1",
          content: "Track the current rollout blocker in live context.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-1",
          summary: "Recent planning summary waiting for the next offline pass.",
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
          taskRelevance: 0.92,
          recency: 0.81,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-stm-1",
        agentId: "agent-007",
        memoryId: "wm-1",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.64,
        },
        lastUpdatedAt: "2026-04-12T09:45:00Z",
      },
    ],
    longTermMemory: [
      {
        memoryId: "ltm-1",
        category: "semantic",
        content: "Legal review is required before launch.",
        summary: "Launch requires legal review.",
        confidence: 0.91,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["turn-19"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T09:00:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          stabilizedAt: "2026-04-12T09:10:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
          lastAccessedAt: "2026-04-12T09:20:00Z",
        },
        salience: {
          signals: {
            evidenceStrength: 0.94,
            recallPriority: 0.79,
          },
          lastEvaluatedAt: "2026-04-12T09:16:00Z",
          sourceEntryId: "importance-stm-1",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-1"],
          preservedIdentityFields: ["agentId", "persona", "role"],
        },
      },
      {
        memoryId: "ltm-trait-1",
        category: "learned_trait",
        content: "The agent waits for direct evidence before escalating.",
        summary: "Evidence-seeking learned trait.",
        confidence: 0.83,
        stabilizedAt: "2026-04-12T09:12:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:12:00Z",
          evidence: ["turn-21"],
        },
        learnedTrait: {
          label: "evidence-seeking",
          confidence: 0.83,
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:12:00Z",
            evidence: ["turn-21"],
          },
        },
      },
      {
        memoryId: "ltm-legacy-1",
        category: "semantic",
        content: "Launch can proceed without legal review when timing is tight.",
        summary: "Previous launch policy before legal review became mandatory.",
        confidence: 0.57,
        stabilizedAt: "2026-04-12T08:40:00Z",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T08:40:00Z",
          evidence: ["turn-11"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T08:40:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          stabilizedAt: "2026-04-12T08:40:00Z",
          consolidatedAt: "2026-04-12T08:40:00Z",
          supersededAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          status: "superseded",
          lastOperation: "supersede",
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["stm-legacy-1"],
        },
      },
    ],
    archivedMemory: [
      {
        archiveId: "archive-retired-1",
        originalGeneration: MEMORY_NODE_KINDS.oldGeneration,
        originalMemoryKind: MEMORY_NODE_KINDS.longTermMemory,
        originalMemoryId: "ltm-retired-1",
        originalNodeId: archivedSourceNodeId,
        originalProvenance: {
          source: "conversation",
          observedAt: "2026-04-12T08:05:00Z",
          evidence: ["turn-03"],
        },
        archivalReason: "retired_policy_snapshot",
        archivedAt: "2026-04-12T09:13:00Z",
        lastRestoredAt: "2026-04-12T09:14:00Z",
        snapshot: {
          memoryId: "ltm-retired-1",
          category: "semantic",
          content: "Retired launch policy snapshot kept for audit history.",
          summary: "Archived retired policy snapshot.",
          confidence: 0.48,
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T08:05:00Z",
            evidence: ["turn-03"],
          },
        },
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:13:00Z",
          evidence: ["consolidation-run-0"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T08:05:00Z",
          lastObservedAt: "2026-04-12T09:13:00Z",
          consolidatedAt: "2026-04-12T09:13:00Z",
        },
        consolidationState: {
          status: "preserved",
          lastOperation: "preserve",
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["ltm-retired-1"],
        },
      },
    ],
    memoryEvidence: [
      {
        evidenceId: "evidence-1",
        kind: "conversation_excerpt",
        source: "conversation",
        observedAt: "2026-04-12T09:10:00Z",
        detail: "The user said launch needs legal approval.",
        reference: "turn-19",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["turn-19"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T09:10:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
        },
        salience: {
          signals: {
            citationStrength: 0.91,
          },
          lastEvaluatedAt: "2026-04-12T09:16:00Z",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
        },
      },
    ],
    consolidationJournal: [
      {
        recordId: "consolidation-1",
        operation: "supersede",
        runtimePhase: "idle",
        consolidatedAt: "2026-04-12T09:15:00Z",
        sourceMemoryIds: ["wm-1", "stm-legacy-1"],
        policyVersion: "old-generation-v1",
        preservedIdentityFields: ["agentId", "persona", "role"],
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:15:00Z",
          evidence: ["consolidation-run-1"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T09:15:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        salience: {
          signals: {
            sourceBreadth: 0.67,
            policyImpact: 0.82,
          },
          lastEvaluatedAt: "2026-04-12T09:15:00Z",
        },
      },
    ],
    edges: [
      {
        from: semanticMemoryNodeId,
        to: learnedTraitNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:15:00Z",
          evidence: ["consolidation-run-association"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T09:12:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        salience: {
          signals: {
            semanticSimilarity: 0.86,
            reinforcement: 0.74,
          },
          lastEvaluatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
        },
      },
      {
        from: semanticMemoryNodeId,
        to: evidenceNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:15:00Z",
          evidence: ["consolidation-run-evidence"],
        },
        temporalContext: {
          firstObservedAt: "2026-04-12T09:10:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        salience: {
          signals: {
            evidenceStrength: 0.92,
          },
          lastEvaluatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
        },
      },
      {
        from: semanticMemoryNodeId,
        to: recordNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:15:00Z",
          evidence: ["consolidation-run-record"],
        },
        temporalContext: {
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-1", "stm-legacy-1"],
          preservedIdentityFields: ["agentId", "persona", "role"],
        },
      },
      {
        from: semanticMemoryNodeId,
        to: historicalMemoryNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
        provenance: {
          source: "idle-window",
          observedAt: "2026-04-12T09:15:00Z",
          evidence: ["consolidation-run-supersede"],
        },
        temporalContext: {
          consolidatedAt: "2026-04-12T09:15:00Z",
          supersededAt: "2026-04-12T09:15:00Z",
        },
        salience: {
          signals: {
            policyDrift: 0.73,
          },
          lastEvaluatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-1", "stm-legacy-1"],
        },
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

test("old-generation graph state persists the initial identity-seeded durable snapshot", () => {
  const initialGraph = createMemoryGraph(createIdentity());
  const persistedState = saveOldGenerationGraphState(initialGraph);
  const persistedJson = JSON.stringify(persistedState);
  const restoredGraph = loadOldGenerationGraphState(
    createYoungGenerationShellGraph(initialGraph),
    JSON.parse(persistedJson),
  );
  const resavedState = saveOldGenerationGraphState(restoredGraph);

  assert.equal(persistedState.schemaId, OLD_GENERATION_GRAPH_STATE_SCHEMA.schemaId);
  assert.equal(persistedState.schemaVersion, OLD_GENERATION_GRAPH_STATE_SCHEMA.version);
  assert.equal(persistedState.constructionMetadata.agentId, initialGraph.agentId);
  assert.equal(
    persistedState.oldGeneration.immutableIdentity.agentId,
    initialGraph.agentId,
  );
  assert.equal(
    persistedState.oldGeneration.immutableIdentity.consolidationState.status,
    "runtime_seeded",
  );
  assert.deepEqual(persistedState.oldGeneration.longTermMemory, []);
  assert.deepEqual(persistedState.oldGeneration.archivedMemory, []);
  assert.deepEqual(persistedState.oldGeneration.memoryEvidence, []);
  assert.deepEqual(persistedState.oldGeneration.consolidationJournal, []);
  assert.deepEqual(persistedState.edges, []);
  assert.deepEqual(persistedState.oldGeneration, initialGraph.oldGeneration);
  assert.deepEqual(restoredGraph.oldGeneration, initialGraph.oldGeneration);
  assert.deepEqual(restoredGraph.youngGeneration, initialGraph.youngGeneration);
  assert.deepEqual(restoredGraph.edges, []);
  assert.deepEqual(normalizeSavedAt(resavedState), normalizeSavedAt(persistedState));
});

test("old-generation graph state round-trips through persisted JSON via the public serialization API", () => {
  const originalGraph = createPersistableGraph();
  const shellGraph = createYoungGenerationShellGraph(originalGraph);

  const savedState = saveOldGenerationGraphState({
    getAgentId: () => originalGraph.agentId,
    getImmutableIdentity: () => originalGraph.oldGeneration.immutableIdentity,
    getOldGeneration: () => originalGraph.oldGeneration,
    getEdges: () => originalGraph.edges,
  });
  const persistedJson = JSON.stringify(savedState);
  const restoredGraph = loadOldGenerationGraphState(
    shellGraph,
    JSON.parse(persistedJson),
  );
  const resavedState = saveOldGenerationGraphState(restoredGraph);

  assert.equal(savedState.schemaId, OLD_GENERATION_GRAPH_STATE_SCHEMA.schemaId);
  assert.equal(savedState.schemaVersion, OLD_GENERATION_GRAPH_STATE_SCHEMA.version);
  assert.equal(savedState.constructionMetadata.agentId, "agent-007");
  assert.equal(
    savedState.constructionMetadata.sourceGraphSchemaId,
    "agent_brain_memory_graph",
  );
  assert.equal(
    savedState.constructionMetadata.oldGenerationNodeKind,
    MEMORY_NODE_KINDS.oldGeneration,
  );
  assert.equal(
    savedState.constructionMetadata.archivedMemoryNodeKind,
    MEMORY_NODE_KINDS.archivedMemory,
  );
  assert.equal(
    savedState.constructionMetadata.reconstructionMetadata.generation,
    "old",
  );
  assert.deepEqual(
    savedState.constructionMetadata.reconstructionMetadata.memories.map(
      ({ memoryKind, memoryId }) => `${memoryKind}:${memoryId}`,
    ),
    [
      "archived_memory:ltm-retired-1",
      "long_term_memory:ltm-1",
      "long_term_memory:ltm-legacy-1",
      "long_term_memory:ltm-trait-1",
    ],
  );
  assert.equal(typeof savedState.constructionMetadata.savedAt, "string");
  assert.deepEqual(restoredGraph.oldGeneration, originalGraph.oldGeneration);
  assert.deepEqual(restoredGraph.youngGeneration, shellGraph.youngGeneration);
  assert.deepEqual(restoredGraph.edges, [...shellGraph.edges, ...savedState.edges]);
  assert.deepEqual(normalizeSavedAt(resavedState), normalizeSavedAt(savedState));
  assert.deepEqual(
    getMemoryGraphReconstructionProfile(restoredGraph)?.graphStateDelta?.summary,
    {
      persistedMemoryCount: 4,
      currentMemoryCount: 4,
      totalComparedCount: 4,
      unchangedCount: 4,
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      changedCount: 0,
    },
  );

  const parsedSnapshot = JSON.parse(persistedJson);

  assert.equal(
    parsedSnapshot.oldGeneration.longTermMemory[1].learnedTrait.label,
    "evidence-seeking",
  );
  assert.equal(
    parsedSnapshot.oldGeneration.archivedMemory[0].originalNodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      "agent-007",
      "ltm-retired-1",
    ),
  );
  assert.equal(
    parsedSnapshot.oldGeneration.immutableIdentity.agentId,
    "agent-007",
  );
  assert.deepEqual(normalizeSavedAt(parsedSnapshot), normalizeSavedAt(savedState));
});

test("old-generation loader reuses frozen persisted durable nodes and edges for unchanged memories", () => {
  const originalGraph = createPersistableGraph();
  const shellGraph = createYoungGenerationShellGraph(originalGraph);
  const savedState = saveOldGenerationGraphState(originalGraph);
  const restoredGraph = loadOldGenerationGraphState(shellGraph, savedState);
  const savedEvidenceEdge = savedState.edges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
  );
  const restoredEvidenceEdge = restoredGraph.edges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
  );

  assert.strictEqual(
    restoredGraph.oldGeneration.longTermMemory[0],
    savedState.oldGeneration.longTermMemory[0],
  );
  assert.strictEqual(
    restoredGraph.oldGeneration.longTermMemory[1],
    savedState.oldGeneration.longTermMemory[1],
  );
  assert.strictEqual(
    restoredGraph.oldGeneration.longTermMemory[2],
    savedState.oldGeneration.longTermMemory[2],
  );
  assert.strictEqual(
    restoredGraph.oldGeneration.archivedMemory[0],
    savedState.oldGeneration.archivedMemory[0],
  );
  assert.strictEqual(
    restoredGraph.oldGeneration.memoryEvidence[0],
    savedState.oldGeneration.memoryEvidence[0],
  );
  assert.strictEqual(
    restoredGraph.oldGeneration.consolidationJournal[0],
    savedState.oldGeneration.consolidationJournal[0],
  );
  assert.strictEqual(restoredEvidenceEdge, savedEvidenceEdge);
});

test("old-generation export rejects accessor sources that omit runtime immutable identity authority", () => {
  const graph = createPersistableGraph();

  assert.throws(
    () =>
      saveOldGenerationGraphState({
        getAgentId: () => graph.agentId,
        getOldGeneration: () => graph.oldGeneration,
        getEdges: () => graph.edges,
      }),
    /requires runtime immutable identity from a concrete graph instance, source\.immutableIdentity, or source\.getImmutableIdentity\(\)/,
  );
});

test("old-generation export rejects accessor identity drift before saving durable state", () => {
  const graph = createPersistableGraph();

  assert.throws(
    () =>
      saveOldGenerationGraphState({
        getAgentId: () => graph.agentId,
        getImmutableIdentity: () => graph.oldGeneration.immutableIdentity,
        getOldGeneration: () => ({
          ...graph.oldGeneration,
          immutableIdentity: {
            ...graph.oldGeneration.immutableIdentity,
            provenance: {
              ...graph.oldGeneration.immutableIdentity.provenance,
              source: "tampered-export",
            },
          },
        }),
        getEdges: () => graph.edges,
      }),
    /oldGeneration\.immutableIdentity\.provenance must match the runtime immutable identity/,
  );
});

test("old-generation loader reconstructs persisted durable nodes, edges, metadata, and identifiers without structural drift", () => {
  const storedGraph = createPersistableGraph();
  const shellGraph = createYoungGenerationShellGraph(storedGraph);
  const savedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(storedGraph)));

  const restoredGraph = loadOldGenerationGraphState(shellGraph, savedState);
  const persistedOldNodes = [
    savedState.oldGeneration.immutableIdentity,
    ...savedState.oldGeneration.longTermMemory,
    ...savedState.oldGeneration.archivedMemory,
    ...savedState.oldGeneration.memoryEvidence,
    ...savedState.oldGeneration.consolidationJournal,
  ];
  const restoredOldNodes = getOldGenerationNodes(restoredGraph);
  const restoredOldEdges = restoredGraph.edges.filter(
    (edge) => !YOUNG_GENERATION_RELATIONS.has(edge.relation),
  );
  const persistedNodeMap = createNodeMap(persistedOldNodes);
  const restoredNodeMap = createNodeMap(restoredOldNodes);
  const persistedEdgeMap = createEdgeMap(savedState.edges);
  const restoredEdgeMap = createEdgeMap(restoredOldEdges);

  assert.deepEqual(restoredGraph.youngGeneration, shellGraph.youngGeneration);
  assert.deepEqual(
    [...restoredNodeMap.keys()].sort(),
    [...persistedNodeMap.keys()].sort(),
  );
  assert.deepEqual(
    [...restoredEdgeMap.keys()].sort(),
    [...persistedEdgeMap.keys()].sort(),
  );
  assert.ok(
    restoredOldEdges.every(
      (edge) => restoredNodeMap.has(edge.from) && restoredNodeMap.has(edge.to),
    ),
  );

  persistedNodeMap.forEach((persistedNode, nodeId) => {
    assert.deepEqual(restoredNodeMap.get(nodeId), persistedNode);
  });
  persistedEdgeMap.forEach((persistedEdge, edgeId) => {
    assert.deepEqual(restoredEdgeMap.get(edgeId), persistedEdge);
  });

  const archivedMemory = restoredGraph.oldGeneration.archivedMemory[0];
  const associationEdge = restoredOldEdges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
  );
  const supersedesEdge = restoredOldEdges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
  );

  assert.equal(
    archivedMemory.originalNodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      "agent-007",
      "ltm-retired-1",
    ),
  );
  assert.equal(archivedMemory.snapshot.memoryId, "ltm-retired-1");
  assert.equal(archivedMemory.consolidationState.journalRecordId, "consolidation-1");
  assert.deepEqual(associationEdge.provenance.evidence, ["consolidation-run-association"]);
  assert.equal(
    supersedesEdge.temporalContext.supersededAt,
    "2026-04-12T09:15:00Z",
  );
});

test("live graph rebuild only re-materializes durable nodes and edges attached to modified long-term memories", () => {
  const graph = createPersistableGraph();
  const rebuiltGraph = rebuildMemoryGraph(graph, {
    longTermMemory: graph.oldGeneration.longTermMemory.map((memory) =>
      memory.memoryId === "ltm-1"
        ? {
            ...memory,
            content: "Legal review is required before launch and before any emergency rollout.",
          }
        : memory,
    ),
  });
  const originalSupportedByEvidenceEdge = graph.edges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
  );
  const rebuiltSupportedByEvidenceEdge = rebuiltGraph.edges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
  );
  const originalYoungCaptureEdge = graph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
  );
  const rebuiltYoungCaptureEdge = rebuiltGraph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
  );

  assert.notStrictEqual(
    rebuiltGraph.oldGeneration.longTermMemory.find((memory) => memory.memoryId === "ltm-1"),
    graph.oldGeneration.longTermMemory.find((memory) => memory.memoryId === "ltm-1"),
  );
  assert.strictEqual(
    rebuiltGraph.oldGeneration.longTermMemory.find(
      (memory) => memory.memoryId === "ltm-trait-1",
    ),
    graph.oldGeneration.longTermMemory.find((memory) => memory.memoryId === "ltm-trait-1"),
  );
  assert.notStrictEqual(rebuiltSupportedByEvidenceEdge, originalSupportedByEvidenceEdge);
  assert.strictEqual(rebuiltYoungCaptureEdge, originalYoungCaptureEdge);
  assert.deepEqual(rebuiltSupportedByEvidenceEdge, originalSupportedByEvidenceEdge);
});

test("superseded durable memories stay excluded from retrieval after save-load reruns", () => {
  const storedGraph = createPersistableGraph();
  const firstSavedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(storedGraph)));
  const firstRestore = loadOldGenerationGraphState(
    createYoungGenerationShellGraph(storedGraph),
    firstSavedState,
  );
  const secondSavedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(firstRestore)));
  const secondRestore = loadOldGenerationGraphState(
    createYoungGenerationShellGraph(firstRestore),
    secondSavedState,
  );
  const retrievalWalk = walkOldGenerationRelationships(secondRestore, {
    memoryId: "ltm-1",
  });
  const administrativeWalk = walkOldGenerationRelationships(
    secondRestore,
    {
      memoryId: "ltm-1",
    },
    {
      accessMode: "administrative",
    },
  );
  const persistedHistoricalMemory = secondSavedState.oldGeneration.longTermMemory.find(
    (memory) => memory.memoryId === "ltm-legacy-1",
  );

  assert.equal(lookupLongTermMemory(firstRestore, "ltm-legacy-1"), null);
  assert.equal(lookupLongTermMemory(secondRestore, "ltm-legacy-1"), null);
  assert.equal(
    retrievalWalk.steps.some((step) => step.relatedNode.memoryId === "ltm-legacy-1"),
    false,
  );
  assert.equal(
    administrativeWalk.steps.some((step) => step.relatedNode.memoryId === "ltm-legacy-1"),
    true,
  );
  assert.equal(persistedHistoricalMemory?.consolidationState.status, "superseded");
  assert.equal(
    persistedHistoricalMemory?.temporalContext.supersededAt,
    "2026-04-12T09:15:00Z",
  );
});

test("old-generation loader restores durable memory while keeping runtime identity authority", () => {
  const storedGraph = createPersistableGraph();
  const runtimeShellGraph = createMemoryGraph(
    createIdentity({
      provenance: {
        source: "runtime_boot",
        observedAt: "2026-04-12T10:30:00Z",
        evidence: ["boot-sequence-1"],
      },
      temporalContext: {
        firstObservedAt: "2026-04-12T10:30:00Z",
      },
    }),
    {
      workingMemory: [
        {
          record: {
            memoryId: "wm-runtime",
            content: "Keep the current customer escalation in working memory.",
          },
        },
      ],
      importanceIndex: [
        {
          entryId: "importance-wm-runtime",
          agentId: "agent-007",
          memoryId: "wm-runtime",
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          signals: {
            taskRelevance: 0.88,
          },
          lastUpdatedAt: "2026-04-12T10:31:00Z",
        },
      ],
      edges: [
        {
          from: "importance-wm-runtime",
          to: "wm-runtime",
          relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
        },
      ],
    },
  );
  const savedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(storedGraph)));

  const restoredGraph = loadOldGenerationGraphState(runtimeShellGraph, savedState);

  assert.deepEqual(restoredGraph.youngGeneration, runtimeShellGraph.youngGeneration);
  assert.deepEqual(
    restoredGraph.oldGeneration.longTermMemory,
    storedGraph.oldGeneration.longTermMemory,
  );
  assert.deepEqual(
    restoredGraph.oldGeneration.archivedMemory,
    storedGraph.oldGeneration.archivedMemory,
  );
  assert.deepEqual(
    restoredGraph.oldGeneration.memoryEvidence,
    storedGraph.oldGeneration.memoryEvidence,
  );
  assert.deepEqual(
    restoredGraph.oldGeneration.consolidationJournal,
    storedGraph.oldGeneration.consolidationJournal,
  );
  assert.deepEqual(
    restoredGraph.oldGeneration.immutableIdentity,
    runtimeShellGraph.oldGeneration.immutableIdentity,
  );
  assert.deepEqual(restoredGraph.edges, [...runtimeShellGraph.edges, ...savedState.edges]);
});

test("old-generation loader rejects immutable identity drift from persisted storage", () => {
  const graph = createPersistableGraph();
  const shellGraph = createYoungGenerationShellGraph(graph, createIdentity());
  const savedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(graph)));

  savedState.oldGeneration.immutableIdentity.persona = "tampered persona";

  assert.throws(
    () => loadOldGenerationGraphState(shellGraph, savedState),
    /immutableIdentity\.persona must match the target graph runtime identity/,
  );
});

test("old-generation loader rejects snapshot edges outside the public durable edge schema", () => {
  const graph = createPersistableGraph();
  const shellGraph = createYoungGenerationShellGraph(graph, createIdentity());
  const savedState = JSON.parse(JSON.stringify(saveOldGenerationGraphState(graph)));

  savedState.edges[0].relation = YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation;

  assert.throws(
    () => loadOldGenerationGraphState(shellGraph, savedState),
    /is not defined by the public old-generation edge schema/,
  );
});
