import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  YOUNG_GENERATION_EDGE_SCHEMA,
  createIdleWindowReconstructionBudget,
  createMemoryGraph,
  getMemoryGraphReconstructionBudget,
  getMemoryGraphReconstructionProfile,
  isMemoryGraphReconstructionDeferredError,
  loadYoungGenerationGraphState,
  rebuildMemoryGraph,
  saveYoungGenerationGraphState,
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

const mockReconstructionClock = (t, samples) => {
  let index = 0;

  t.mock.method(globalThis.performance, "now", () => {
    const nextIndex = Math.min(index, samples.length - 1);
    index += 1;
    return samples[nextIndex];
  });
};

test("graph rebuild helpers attach per-phase profiles while preserving scheduler-derived idle budgets", (t) => {
  mockReconstructionClock(t, [
    0,
    0,
    0.2,
    0.2,
    1.1,
    1.1,
    1.8,
    1.8,
    2.4,
    2.4,
    3.1,
    10,
    10,
    10.15,
    10.15,
    10.9,
    10.9,
    11.6,
    11.6,
    12.2,
    12.2,
    12.8,
  ]);

  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-budget-1",
          content: "Keep reconstruction budget attached to rebuilt graph instances.",
        },
      },
    ],
  });
  const budget = createIdleWindowReconstructionBudget({
    idleTriggerWindowMs: 1_500,
  });
  const savedState = saveYoungGenerationGraphState(graph);
  const rebuiltFromSnapshot = loadYoungGenerationGraphState(
    graph,
    savedState,
    {
      reconstructionBudget: budget,
    },
  );
  const unchangedFingerprint =
    savedState.constructionMetadata.reconstructionMetadata.memories[0].fingerprint;

  assert.deepEqual(getMemoryGraphReconstructionBudget(rebuiltFromSnapshot), budget);
  assert.deepEqual(
    getMemoryGraphReconstructionProfile(rebuiltFromSnapshot),
    {
      status: "completed",
      agentId: "agent-007",
      reconstructionBudget: budget,
      targetMemorySet: {
        agentId: "agent-007",
        replacementScopes: [
          "youngGeneration.workingMemory",
          "youngGeneration.shortTermMemory",
          "youngGeneration.importanceIndex",
          "edges",
        ],
        workingMemoryCount: 1,
        shortTermMemoryCount: 0,
        importanceIndexCount: 0,
        longTermMemoryCount: 0,
        archivedMemoryCount: 0,
        memoryEvidenceCount: 0,
        consolidationJournalCount: 0,
        edgeCount: 0,
        totalYoungMemoryCount: 1,
        totalDurableMemoryCount: 0,
        totalMemoryCount: 1,
        totalRecordCount: 1,
      },
      graphStateDelta: {
        generation: "young",
        summary: {
          persistedMemoryCount: 1,
          currentMemoryCount: 1,
          totalComparedCount: 1,
          unchangedCount: 1,
          addedCount: 0,
          removedCount: 0,
          modifiedCount: 0,
          changedCount: 0,
        },
        memories: [
          {
            referenceKey: "working_memory:wm-budget-1",
            memoryId: "wm-budget-1",
            memoryKind: "working_memory",
            status: "unchanged",
            previousFingerprint: unchangedFingerprint,
            currentFingerprint: unchangedFingerprint,
          },
        ],
      },
      phaseMeasurements: [
        {
          phase: "resolve-target-memory-set",
          elapsedMs: 0.2,
          totalElapsedMs: 0.2,
          idleBudgetMs: 1200,
          budgetRemainingMs: 1199.8,
          exceededIdleBudget: false,
        },
        {
          phase: "materialize-graph",
          elapsedMs: 0.9,
          totalElapsedMs: 1.1,
          idleBudgetMs: 1200,
          budgetRemainingMs: 1198.9,
          exceededIdleBudget: false,
        },
        {
          phase: "validate-young-generation",
          elapsedMs: 0.7,
          totalElapsedMs: 1.8,
          idleBudgetMs: 1200,
          budgetRemainingMs: 1198.2,
          exceededIdleBudget: false,
        },
        {
          phase: "validate-old-generation",
          elapsedMs: 0.6,
          totalElapsedMs: 2.4,
          idleBudgetMs: 1200,
          budgetRemainingMs: 1197.6,
          exceededIdleBudget: false,
        },
        {
          phase: "freeze-graph",
          elapsedMs: 0.7,
          totalElapsedMs: 3.1,
          idleBudgetMs: 1200,
          budgetRemainingMs: 1196.9,
          exceededIdleBudget: false,
        },
      ],
      metrics: {
        idleTriggerWindowMs: 1_500,
        reconstructionDurationMs: 3.1,
      },
      elapsedMs: 3.1,
      withinIdleBudget: true,
      deferredPhase: null,
    },
  );

  const rebuiltAgain = rebuildMemoryGraph(rebuiltFromSnapshot, {
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-budget-1",
          summary: "Budget should survive repeated graph reconstruction.",
        },
      },
    ],
  });

  assert.deepEqual(getMemoryGraphReconstructionBudget(rebuiltAgain), budget);
  assert.deepEqual(
    getMemoryGraphReconstructionProfile(rebuiltAgain)?.targetMemorySet?.replacementScopes,
    ["youngGeneration.shortTermMemory"],
  );
  assert.equal(getMemoryGraphReconstructionProfile(rebuiltAgain)?.status, "completed");
});

test("graph-state delta classifies unchanged, modified, removed, and added memories against persisted metadata", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-delta-1",
          content: "This working memory stays unchanged.",
        },
      },
      {
        record: {
          memoryId: "wm-delta-2",
          content: "This working memory will be updated.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-delta-1",
          summary: "This short-term memory will be removed.",
        },
      },
    ],
  });
  const savedState = saveYoungGenerationGraphState(graph);
  const rebuilt = rebuildMemoryGraph(graph, {
    workingMemory: [
      graph.youngGeneration.workingMemory[0],
      {
        ...graph.youngGeneration.workingMemory[1],
        record: {
          ...graph.youngGeneration.workingMemory[1].record,
          content: "This working memory was updated after the persisted snapshot.",
        },
      },
      {
        record: {
          memoryId: "wm-delta-3",
          content: "This working memory was added after the persisted snapshot.",
        },
      },
    ],
    shortTermMemory: [],
    importanceIndex: [],
    persistedGraphStateReconstructionMetadata:
      savedState.constructionMetadata.reconstructionMetadata,
  });
  const graphStateDelta = getMemoryGraphReconstructionProfile(rebuilt)?.graphStateDelta;
  const persistedModifiedFingerprint =
    savedState.constructionMetadata.reconstructionMetadata.memories.find(
      (memory) =>
        memory.memoryKind === "working_memory" && memory.memoryId === "wm-delta-2",
    )?.fingerprint ?? null;

  assert.ok(graphStateDelta);
  assert.deepEqual(graphStateDelta?.summary, {
    persistedMemoryCount: 3,
    currentMemoryCount: 3,
    totalComparedCount: 4,
    unchangedCount: 1,
    addedCount: 1,
    removedCount: 1,
    modifiedCount: 1,
    changedCount: 3,
  });
  assert.deepEqual(
    Object.fromEntries(
      graphStateDelta.memories.map((memory) => [memory.referenceKey, memory.status]),
    ),
    {
      "short_term_memory:stm-delta-1": "removed",
      "working_memory:wm-delta-1": "unchanged",
      "working_memory:wm-delta-2": "modified",
      "working_memory:wm-delta-3": "added",
    },
  );
  assert.equal(
    graphStateDelta.memories.find(
      (memory) => memory.referenceKey === "working_memory:wm-delta-2",
    )?.previousFingerprint,
    persistedModifiedFingerprint,
  );
  assert.equal(
    graphStateDelta.memories.find(
      (memory) => memory.referenceKey === "working_memory:wm-delta-3",
    )?.previousFingerprint,
    null,
  );
  assert.equal(
    graphStateDelta.memories.find(
      (memory) => memory.referenceKey === "short_term_memory:stm-delta-1",
    )?.currentFingerprint,
    null,
  );
});

test("incremental reconstruction from persisted young-generation state matches cold rebuild semantics across mixed deltas while reusing only unchanged slices", () => {
  const captureRelation =
    YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation;
  const importanceRelation =
    YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation;
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-incremental-1",
          content: "This working memory will be updated during incremental reconstruction.",
        },
      },
      {
        record: {
          memoryId: "wm-incremental-2",
          content: "This working memory should remain unchanged and reusable.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-incremental-1",
          summary: "This short-term buffer will be removed.",
        },
      },
      {
        record: {
          memoryId: "wm-incremental-2",
          summary: "This short-term buffer should be reused intact.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-incremental-1",
        agentId: "agent-007",
        memoryId: "wm-incremental-1",
        memoryKind: "working_memory",
        signals: {
          taskRelevance: 0.94,
        },
        lastUpdatedAt: "2026-04-12T10:10:00Z",
      },
      {
        entryId: "importance-incremental-2",
        agentId: "agent-007",
        memoryId: "wm-incremental-2",
        memoryKind: "working_memory",
        signals: {
          taskRelevance: 0.71,
        },
        lastUpdatedAt: "2026-04-12T10:11:00Z",
      },
    ],
    edges: [
      {
        from: "wm-incremental-1",
        to: "wm-incremental-1",
        relation: captureRelation,
      },
      {
        from: "wm-incremental-2",
        to: "wm-incremental-2",
        relation: captureRelation,
      },
      {
        from: "importance-incremental-1",
        to: "wm-incremental-1",
        relation: importanceRelation,
      },
      {
        from: "importance-incremental-2",
        to: "wm-incremental-2",
        relation: importanceRelation,
      },
    ],
  });
  const savedState = saveYoungGenerationGraphState(graph);
  const nextWorkingMemory = [
    {
      ...graph.youngGeneration.workingMemory[0],
      record: {
        ...graph.youngGeneration.workingMemory[0].record,
        content:
          "This working memory was updated during incremental reconstruction.",
      },
    },
    graph.youngGeneration.workingMemory[1],
    {
      record: {
        memoryId: "wm-incremental-3",
        content: "This working memory was added during incremental reconstruction.",
      },
    },
  ];
  const nextShortTermMemory = [
    graph.youngGeneration.shortTermMemory[1],
    {
      record: {
        memoryId: "wm-incremental-3",
        summary: "This new short-term buffer accompanies the added working memory.",
      },
    },
  ];
  const nextImportanceIndex = [
    graph.youngGeneration.importanceIndex[0],
    graph.youngGeneration.importanceIndex[1],
    {
      entryId: "importance-incremental-3",
      agentId: "agent-007",
      memoryId: "wm-incremental-3",
      memoryKind: "working_memory",
      signals: {
        taskRelevance: 0.67,
      },
      lastUpdatedAt: "2026-04-12T10:12:00Z",
    },
  ];
  const nextEdges = [
    {
      from: "wm-incremental-2",
      to: "wm-incremental-2",
      relation: captureRelation,
    },
    {
      from: "wm-incremental-3",
      to: "wm-incremental-3",
      relation: captureRelation,
    },
    {
      from: "importance-incremental-1",
      to: "wm-incremental-1",
      relation: importanceRelation,
    },
    {
      from: "importance-incremental-2",
      to: "wm-incremental-2",
      relation: importanceRelation,
    },
    {
      from: "importance-incremental-3",
      to: "wm-incremental-3",
      relation: importanceRelation,
    },
  ];
  const coldRebuild = createMemoryGraph(createIdentity(), {
    workingMemory: nextWorkingMemory,
    shortTermMemory: nextShortTermMemory,
    importanceIndex: nextImportanceIndex,
    edges: nextEdges,
  });
  const rebuilt = rebuildMemoryGraph(graph, {
    workingMemory: nextWorkingMemory,
    shortTermMemory: nextShortTermMemory,
    importanceIndex: nextImportanceIndex,
    edges: nextEdges,
    persistedGraphStateReconstructionMetadata:
      savedState.constructionMetadata.reconstructionMetadata,
    persistedGraphStateReuseState: savedState,
  });
  const graphStateDelta = getMemoryGraphReconstructionProfile(rebuilt)?.graphStateDelta;
  const reusedWorkingMemory = rebuilt.youngGeneration.workingMemory.find(
    (memory) => memory.record.memoryId === "wm-incremental-2",
  );
  const reusedShortTermMemory = rebuilt.youngGeneration.shortTermMemory.find(
    (memory) => memory.record.memoryId === "wm-incremental-2",
  );
  const rebuiltImportanceOne = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-incremental-1",
  );
  const rebuiltImportanceTwo = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-incremental-2",
  );
  const rebuiltCaptureTwo = rebuilt.edges.find(
    (edge) => edge.relation === captureRelation && edge.from === "wm-incremental-2",
  );
  const rebuiltImportanceEdgeOne = rebuilt.edges.find(
    (edge) =>
      edge.relation === importanceRelation &&
      edge.from === "importance-incremental-1",
  );
  const rebuiltImportanceEdgeTwo = rebuilt.edges.find(
    (edge) =>
      edge.relation === importanceRelation &&
      edge.from === "importance-incremental-2",
  );

  assert.deepEqual(rebuilt, coldRebuild);
  assert.deepEqual(graphStateDelta?.summary, {
    persistedMemoryCount: 4,
    currentMemoryCount: 5,
    totalComparedCount: 6,
    unchangedCount: 2,
    addedCount: 2,
    removedCount: 1,
    modifiedCount: 1,
    changedCount: 4,
  });
  assert.deepEqual(
    Object.fromEntries(
      graphStateDelta.memories.map((memory) => [memory.referenceKey, memory.status]),
    ),
    {
      "short_term_memory:wm-incremental-1": "removed",
      "short_term_memory:wm-incremental-2": "unchanged",
      "short_term_memory:wm-incremental-3": "added",
      "working_memory:wm-incremental-1": "modified",
      "working_memory:wm-incremental-2": "unchanged",
      "working_memory:wm-incremental-3": "added",
    },
  );
  assert.strictEqual(reusedWorkingMemory, savedState.youngGeneration.workingMemory[1]);
  assert.strictEqual(reusedShortTermMemory, savedState.youngGeneration.shortTermMemory[1]);
  assert.notStrictEqual(
    rebuiltImportanceOne,
    savedState.youngGeneration.importanceIndex[0],
  );
  assert.strictEqual(
    rebuiltImportanceTwo,
    savedState.youngGeneration.importanceIndex[1],
  );
  assert.strictEqual(
    rebuiltCaptureTwo,
    savedState.edges.find(
      (edge) => edge.relation === captureRelation && edge.from === "wm-incremental-2",
    ),
  );
  assert.notStrictEqual(
    rebuiltImportanceEdgeOne,
    savedState.edges.find(
      (edge) =>
        edge.relation === importanceRelation &&
        edge.from === "importance-incremental-1",
    ),
  );
  assert.strictEqual(
    rebuiltImportanceEdgeTwo,
    savedState.edges.find(
      (edge) =>
        edge.relation === importanceRelation &&
        edge.from === "importance-incremental-2",
    ),
  );
  assert.equal(
    rebuilt.youngGeneration.shortTermMemory.some(
      (memory) => memory.record.memoryId === "wm-incremental-1",
    ),
    false,
  );
  assert.equal(
    rebuilt.edges.some(
      (edge) => edge.relation === captureRelation && edge.from === "wm-incremental-1",
    ),
    false,
  );
});

test("incremental reconstruction refreshes only the topology-impacted young-generation subgraph when new edges connect unchanged memories", () => {
  const workingReferenceRelation =
    YOUNG_GENERATION_EDGE_SCHEMA.workingMemoryReference.relation;
  const importanceRelation =
    YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation;
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-topology-1",
          content: "This memory is upstream of the newly connected subgraph.",
        },
      },
      {
        record: {
          memoryId: "wm-topology-2",
          content: "This memory becomes the bridge to a new neighbor.",
        },
      },
      {
        record: {
          memoryId: "wm-topology-3",
          content: "This memory joins the impacted subgraph through an edge-only delta.",
        },
      },
      {
        record: {
          memoryId: "wm-topology-4",
          content: "This memory remains isolated and should be fully reused.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-topology-1",
        agentId: "agent-007",
        memoryId: "wm-topology-1",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.92,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-topology-2",
        agentId: "agent-007",
        memoryId: "wm-topology-2",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.81,
        },
        lastUpdatedAt: "2026-04-12T10:01:00Z",
      },
      {
        entryId: "importance-topology-3",
        agentId: "agent-007",
        memoryId: "wm-topology-3",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.76,
        },
        lastUpdatedAt: "2026-04-12T10:02:00Z",
      },
      {
        entryId: "importance-topology-4",
        agentId: "agent-007",
        memoryId: "wm-topology-4",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.63,
        },
        lastUpdatedAt: "2026-04-12T10:03:00Z",
      },
    ],
    edges: [
      {
        from: "wm-topology-1",
        to: "wm-topology-2",
        relation: workingReferenceRelation,
      },
      {
        from: "importance-topology-1",
        to: "wm-topology-1",
        relation: importanceRelation,
      },
      {
        from: "importance-topology-2",
        to: "wm-topology-2",
        relation: importanceRelation,
      },
      {
        from: "importance-topology-3",
        to: "wm-topology-3",
        relation: importanceRelation,
      },
      {
        from: "importance-topology-4",
        to: "wm-topology-4",
        relation: importanceRelation,
      },
    ],
  });
  const savedState = saveYoungGenerationGraphState(graph);
  const nextEdges = [
    ...graph.edges,
    {
      from: "wm-topology-2",
      to: "wm-topology-3",
      relation: workingReferenceRelation,
    },
  ];
  const coldRebuild = createMemoryGraph(createIdentity(), {
    workingMemory: graph.youngGeneration.workingMemory,
    importanceIndex: graph.youngGeneration.importanceIndex,
    edges: nextEdges,
  });
  const rebuilt = rebuildMemoryGraph(graph, {
    edges: nextEdges,
    persistedGraphStateReconstructionMetadata:
      savedState.constructionMetadata.reconstructionMetadata,
    persistedGraphStateReuseState: savedState,
  });
  const graphStateDelta = getMemoryGraphReconstructionProfile(rebuilt)?.graphStateDelta;
  const rebuiltImportanceOne = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-topology-1",
  );
  const rebuiltImportanceTwo = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-topology-2",
  );
  const rebuiltImportanceThree = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-topology-3",
  );
  const rebuiltImportanceFour = rebuilt.youngGeneration.importanceIndex.find(
    (entry) => entry.entryId === "importance-topology-4",
  );
  const rebuiltBridgeEdge = rebuilt.edges.find(
    (edge) => edge.relation === workingReferenceRelation && edge.from === "wm-topology-1",
  );
  const rebuiltIsolatedImportanceEdge = rebuilt.edges.find(
    (edge) => edge.relation === importanceRelation && edge.from === "importance-topology-4",
  );

  assert.deepEqual(rebuilt, coldRebuild);
  assert.deepEqual(graphStateDelta?.summary, {
    persistedMemoryCount: 4,
    currentMemoryCount: 4,
    totalComparedCount: 4,
    unchangedCount: 4,
    addedCount: 0,
    removedCount: 0,
    modifiedCount: 0,
    changedCount: 0,
  });
  assert.strictEqual(
    rebuilt.youngGeneration.workingMemory[0],
    savedState.youngGeneration.workingMemory[0],
  );
  assert.strictEqual(
    rebuilt.youngGeneration.workingMemory[1],
    savedState.youngGeneration.workingMemory[1],
  );
  assert.strictEqual(
    rebuilt.youngGeneration.workingMemory[2],
    savedState.youngGeneration.workingMemory[2],
  );
  assert.strictEqual(
    rebuilt.youngGeneration.workingMemory[3],
    savedState.youngGeneration.workingMemory[3],
  );
  assert.notStrictEqual(
    rebuiltImportanceOne,
    savedState.youngGeneration.importanceIndex[0],
  );
  assert.notStrictEqual(
    rebuiltImportanceTwo,
    savedState.youngGeneration.importanceIndex[1],
  );
  assert.notStrictEqual(
    rebuiltImportanceThree,
    savedState.youngGeneration.importanceIndex[2],
  );
  assert.strictEqual(
    rebuiltImportanceFour,
    savedState.youngGeneration.importanceIndex[3],
  );
  assert.notStrictEqual(
    rebuiltBridgeEdge,
    savedState.edges.find(
      (edge) => edge.relation === workingReferenceRelation && edge.from === "wm-topology-1",
    ),
  );
  assert.strictEqual(
    rebuiltIsolatedImportanceEdge,
    savedState.edges.find(
      (edge) => edge.relation === importanceRelation && edge.from === "importance-topology-4",
    ),
  );
});

test("live graph rebuild invalidates only the young-generation edges and index entries attached to modified memories", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live-1",
          content: "This working memory will be edited in place.",
        },
      },
      {
        record: {
          memoryId: "wm-live-2",
          content: "This working memory should be reused as-is.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-live-1",
          summary: "Short-term buffer for the first memory.",
        },
      },
      {
        record: {
          memoryId: "wm-live-2",
          summary: "Short-term buffer for the second memory.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-live-1",
        agentId: "agent-007",
        memoryId: "wm-live-1",
        memoryKind: "working_memory",
        signals: {
          taskRelevance: 0.91,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-live-2",
        agentId: "agent-007",
        memoryId: "wm-live-2",
        memoryKind: "working_memory",
        signals: {
          taskRelevance: 0.73,
        },
        lastUpdatedAt: "2026-04-12T10:05:00Z",
      },
    ],
    edges: [
      {
        from: "wm-live-1",
        to: "wm-live-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
      {
        from: "wm-live-2",
        to: "wm-live-2",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
      {
        from: "importance-live-1",
        to: "wm-live-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
      },
      {
        from: "importance-live-2",
        to: "wm-live-2",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
      },
    ],
  });

  const rebuilt = rebuildMemoryGraph(graph, {
    workingMemory: [
      {
        ...graph.youngGeneration.workingMemory[0],
        record: {
          ...graph.youngGeneration.workingMemory[0].record,
          content: "This working memory changed while its edges stayed structurally identical.",
        },
      },
      graph.youngGeneration.workingMemory[1],
    ],
  });
  const originalCaptureOne = graph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation &&
      edge.from === "wm-live-1",
  );
  const rebuiltCaptureOne = rebuilt.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation &&
      edge.from === "wm-live-1",
  );
  const originalCaptureTwo = graph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation &&
      edge.from === "wm-live-2",
  );
  const rebuiltCaptureTwo = rebuilt.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation &&
      edge.from === "wm-live-2",
  );
  const originalImportanceOne = graph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation &&
      edge.from === "importance-live-1",
  );
  const rebuiltImportanceOne = rebuilt.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation &&
      edge.from === "importance-live-1",
  );
  const originalImportanceTwo = graph.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation &&
      edge.from === "importance-live-2",
  );
  const rebuiltImportanceTwo = rebuilt.edges.find(
    (edge) =>
      edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation &&
      edge.from === "importance-live-2",
  );

  assert.notStrictEqual(
    rebuilt.youngGeneration.workingMemory[0],
    graph.youngGeneration.workingMemory[0],
  );
  assert.strictEqual(
    rebuilt.youngGeneration.workingMemory[1],
    graph.youngGeneration.workingMemory[1],
  );
  assert.notStrictEqual(
    rebuilt.youngGeneration.importanceIndex[0],
    graph.youngGeneration.importanceIndex[0],
  );
  assert.strictEqual(
    rebuilt.youngGeneration.importanceIndex[1],
    graph.youngGeneration.importanceIndex[1],
  );
  assert.notStrictEqual(rebuiltCaptureOne, originalCaptureOne);
  assert.strictEqual(rebuiltCaptureTwo, originalCaptureTwo);
  assert.notStrictEqual(rebuiltImportanceOne, originalImportanceOne);
  assert.strictEqual(rebuiltImportanceTwo, originalImportanceTwo);
  assert.deepEqual(rebuiltCaptureOne, originalCaptureOne);
  assert.deepEqual(rebuiltImportanceOne, originalImportanceOne);
});

test("graph rebuild defers cleanly when the idle reconstruction budget is exhausted", (t) => {
  mockReconstructionClock(t, [0, 0, 0.4, 0.4, 1.9, 1.9, 3.3]);

  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-budget-defer-1",
          content: "Defer reconstruction instead of overrunning the idle window.",
        },
      },
    ],
  });
  const budget = createIdleWindowReconstructionBudget({
    idleTriggerWindowMs: 4,
    reserveWindowMs: 1,
  });

  assert.throws(
    () =>
      rebuildMemoryGraph(graph, {
        shortTermMemory: [
          {
            record: {
              memoryId: "wm-budget-defer-1",
              summary: "This rebuild should be deferred after validation crosses budget.",
            },
          },
        ],
        reconstructionBudget: budget,
      }),
    (error) => {
      assert.ok(isMemoryGraphReconstructionDeferredError(error));
      assert.equal(error.deferred.reason, "idle-budget-exceeded");
      assert.equal(error.deferred.phase, "validate-young-generation");
      assert.equal(error.deferred.idleBudgetMs, 3);
      assert.equal(error.deferred.elapsedMs, 3.3);
      assert.equal(error.deferred.overBudgetMs, 0.3);
      assert.deepEqual(error.deferred.metrics, {
        idleTriggerWindowMs: 4,
        reconstructionDurationMs: 3.3,
      });
      assert.equal(error.deferred.profile.status, "deferred");
      assert.deepEqual(error.deferred.profile.metrics, {
        idleTriggerWindowMs: 4,
        reconstructionDurationMs: 3.3,
      });
      assert.equal(
        error.deferred.profile.deferredPhase,
        "validate-young-generation",
      );
      assert.deepEqual(
        error.deferred.profile.phaseMeasurements.map((phase) => phase.phase),
        [
          "resolve-target-memory-set",
          "materialize-graph",
          "validate-young-generation",
        ],
      );
      assert.equal(
        error.deferred.profile.phaseMeasurements[2].exceededIdleBudget,
        true,
      );
      assert.equal(error.deferred.targetMemorySet?.shortTermMemoryCount, 1);
      assert.equal(error.deferred.targetMemorySet?.totalRecordCount, 2);
      assert.match(error.message, /Memory graph reconstruction deferred/);
      return true;
    },
  );
});
