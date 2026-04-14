import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  archiveStaleMemories,
  createIdleWindowSuggestion,
  createMemoryGraph,
  createOldGenerationEdge,
  createOldGenerationNodeId,
  createRuntimePhase,
  createYoungGenerationRetrievalView,
  evaluateStaleMemories,
  lookupArchivedMemory,
  lookupLongTermMemory,
  lookupOldGenerationNode,
  resolveArchivedMemoryReference,
  serializeLongTermMemoryPersistenceStorageRecord,
} from "../src/index.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

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

const createInactiveYoungArchivalCandidateGraph = () =>
  createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-inactive",
        summary: "Previously masked recap is now waiting for offline archival review.",
        provenance: {
          source: "runtime-note",
          observedAt: "2026-03-08T09:00:00Z",
        },
      }),
    ],
  });

const createInactiveYoungArchivalEvaluation = () =>
  evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "stm-inactive",
        createdAt: "2026-03-08T09:00:00Z",
        lastAccessedAt: "2026-03-16T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.08,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
    ],
  });

const createInMemoryLongTermMemoryStorage = (initialEntries = {}) => {
  const values = new Map(Object.entries(initialEntries));

  return {
    async read(request) {
      return {
        ...request,
        found: values.has(request.key),
        value: values.get(request.key) ?? null,
      };
    },
    async write(request) {
      values.set(request.key, request.value);
      return {
        ...request,
        written: true,
      };
    },
    async delete(request) {
      return {
        ...request,
        deleted: values.delete(request.key),
      };
    },
    async list({ keyPrefix, agentId }) {
      const agentKeyPrefix = `${keyPrefix}/${encodeURIComponent(agentId)}/`;

      return [...values.entries()]
        .filter(([key]) => key.startsWith(agentKeyPrefix))
        .map(([key, value]) => ({
          key,
          value,
        }));
    },
    getValue(key) {
      return values.get(key) ?? null;
    },
  };
};

test("archiveStaleMemories moves low-value stale young memories into archival storage with recovery context", async () => {
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
        relation: "short_term_association",
      },
      {
        from: "importance-stm-archive",
        to: "stm-archive",
        relation: "importance_to_short_term_memory",
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
      {
        memoryId: "stm-active",
        createdAt: "2026-04-11T12:00:00Z",
        lastAccessedAt: "2026-04-12T09:00:00Z",
        accessCount: 3,
        retentionValue: 0.95,
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
      batchId: "archival-pass-1",
    },
  });

  assert.equal(result.authorization.eligible, true);
  assert.equal(result.archivedCount, 1);
  assert.equal(result.deferredCount, 0);
  assert.equal(result.nextGraph.youngGeneration.shortTermMemory.length, 1);
  assert.equal(
    result.nextGraph.youngGeneration.shortTermMemory[0].record.memoryId,
    "stm-active",
  );
  assert.deepEqual(
    result.nextGraph.youngGeneration.importanceIndex.map((entry) => entry.entryId),
    ["importance-stm-active"],
  );
  assert.deepEqual(result.nextGraph.edges, []);

  const archivedMemory = result.archivedTransitions[0].archivedMemory;

  assert.equal(archivedMemory.originalGeneration, MEMORY_NODE_KINDS.youngGeneration);
  assert.equal(archivedMemory.originalMemoryKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(archivedMemory.originalMemoryId, "stm-archive");
  assert.equal(archivedMemory.originalNodeId, null);
  assert.equal(archivedMemory.originalProvenance.source, "runtime-note");
  assert.equal(archivedMemory.snapshot.record.memoryId, "stm-archive");
  assert.equal(archivedMemory.snapshot.inactiveForRetrieval, true);
  assert.equal(archivedMemory.snapshot.masking.isMasked, true);
  assert.equal(archivedMemory.snapshot.lifecycle.state, "archived");
  assert.equal(
    archivedMemory.snapshot.lifecycle.inactiveAt,
    archivedMemory.archivedAt,
  );
  assert.equal(
    archivedMemory.snapshot.lifecycle.inactiveReason,
    "archived-to-old-generation",
  );
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
  assert.equal(
    archivedMemory.snapshot.recoveryContext.detachedImportanceIndex[0].entryId,
    "importance-stm-archive",
  );
  assert.deepEqual(
    archivedMemory.snapshot.recoveryContext.detachedEdges.map((edge) => edge.relation).sort(),
    ["importance_to_short_term_memory", "short_term_association"],
  );
  assert.equal(
    lookupArchivedMemory(result.nextGraph, archivedMemory.archiveId).archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    resolveArchivedMemoryReference(
      result.nextGraph,
      archivedMemory.snapshot.lifecycle.archiveLinkage,
    ).archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    resolveArchivedMemoryReference(result.nextGraph, {
      archiveNodeId: archivedMemory.nodeId,
    }).archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    resolveArchivedMemoryReference(result.nextGraph, archivedMemory.archiveId).archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    lookupOldGenerationNode(result.nextGraph, {
      archiveId: archivedMemory.archiveId,
    }),
    null,
  );
  assert.equal(
    lookupOldGenerationNode(
      result.nextGraph,
      {
        archiveId: archivedMemory.archiveId,
      },
      {
        accessMode: "administrative",
      },
    ).archiveId,
    archivedMemory.archiveId,
  );
});

test("archiveStaleMemories removes archived young memories from retrieval views while keeping archive-record access explicit", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-active",
          content: "Current user request remains in the active working set.",
        },
      },
    ],
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
        entryId: "importance-wm-active",
        agentId: "agent-007",
        memoryId: "wm-active",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.94,
        },
        lastUpdatedAt: "2026-04-12T09:45:00Z",
      },
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
      {
        memoryId: "stm-active",
        createdAt: "2026-04-11T12:00:00Z",
        lastAccessedAt: "2026-04-12T09:00:00Z",
        accessCount: 3,
        retentionValue: 0.95,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
      {
        memoryId: "wm-active",
        createdAt: "2026-04-12T08:00:00Z",
        lastAccessedAt: "2026-04-12T11:55:00Z",
        accessCount: 5,
        retentionValue: 0.99,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
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
      batchId: "archival-pass-2",
    },
  });
  const archivedMemory = result.archivedTransitions[0].archivedMemory;
  const retrievalView = createYoungGenerationRetrievalView(result.nextGraph);
  const archiveRecord = lookupArchivedMemory(result.nextGraph, archivedMemory.archiveId);

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
  assert.equal(
    retrievalView.shortTermMemory.some((memory) => memory.record.memoryId === "stm-archive"),
    false,
  );
  assert.equal(lookupOldGenerationNode(result.nextGraph, {
    archiveId: archivedMemory.archiveId,
  }), null);
  assert.equal(archiveRecord.snapshot.record.memoryId, "stm-archive");
  assert.equal(archiveRecord.snapshot.lifecycle.state, "archived");
  assert.equal(
    resolveArchivedMemoryReference(
      result.nextGraph,
      archiveRecord.snapshot.lifecycle.archiveLinkage,
    ).archiveId,
    archiveRecord.archiveId,
  );
});

test("archiveStaleMemories excludes active-set young memories even when another parked memory is archivable", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-live",
          summary: "This recap is still part of the live retrieval set.",
        },
      },
      createInactiveYoungMemory(
        {
          memoryId: "stm-parked",
          summary: "This recap has already been parked for offline archival.",
        },
        "2026-03-18T12:00:00Z",
      ),
    ],
    importanceIndex: [
      {
        entryId: "importance-stm-live",
        agentId: "agent-007",
        memoryId: "stm-live",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.79,
        },
        lastUpdatedAt: "2026-04-12T09:20:00Z",
      },
      {
        entryId: "importance-stm-parked",
        agentId: "agent-007",
        memoryId: "stm-parked",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.11,
        },
        lastUpdatedAt: "2026-03-20T09:20:00Z",
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
        memoryId: "stm-live",
        createdAt: "2026-03-01T12:00:00Z",
        lastAccessedAt: "2026-03-05T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.06,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
      {
        memoryId: "stm-parked",
        createdAt: "2026-03-01T12:00:00Z",
        lastAccessedAt: "2026-03-04T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.05,
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
    archivedAt: "2026-04-12T12:25:00Z",
    archivedBy: "offline-consolidation",
    policyVersion: "archive-policy-v1",
  });

  assert.equal(result.authorization.eligible, true);
  assert.deepEqual(result.archivableCandidates.map((candidate) => candidate.memoryId), [
    "stm-parked",
  ]);
  assert.equal(result.archivedCount, 1);
  assert.deepEqual(result.archivedTransitions.map((transition) => transition.memoryId), [
    "stm-parked",
  ]);
  assert.equal(result.deferredCount, 1);
  assert.equal(result.deferredCandidates[0].memoryId, "stm-live");
  assert.equal(result.deferredCandidates[0].deferredReason, "active-set-memory");
  assert.deepEqual(
    result.nextGraph.youngGeneration.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-live"],
  );
});

test("archiveStaleMemories advances inactive young memories into archived lifecycle state during caller-authorized offline consolidation", async () => {
  const graph = createInactiveYoungArchivalCandidateGraph();
  const evaluation = createInactiveYoungArchivalEvaluation();

  assert.equal(graph.youngGeneration.shortTermMemory[0].lifecycle.state, "inactive");
  assert.equal(graph.youngGeneration.shortTermMemory[0].lifecycle.archiveLinkage, null);

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("sleep", {
      changedAt: "2026-04-12T12:10:00Z",
    }),
    archivedAt: "2026-04-12T12:20:00Z",
    archivedBy: "offline-consolidation",
    policyVersion: "archive-policy-v1",
  });
  const archivedMemory = result.archivedTransitions[0].archivedMemory;

  assert.equal(result.authorization.eligible, true);
  assert.equal(result.archivedCount, 1);
  assert.equal(archivedMemory.snapshot.record.memoryId, "stm-inactive");
  assert.equal(archivedMemory.snapshot.inactiveForRetrieval, true);
  assert.equal(archivedMemory.snapshot.masking.isMasked, true);
  assert.equal(
    archivedMemory.snapshot.masking.reason,
    "batched-for-possible-archival",
  );
  assert.equal(archivedMemory.snapshot.lifecycle.state, "archived");
  assert.equal(archivedMemory.snapshot.lifecycle.inactiveAt, archivedMemory.archivedAt);
  assert.equal(
    archivedMemory.snapshot.lifecycle.inactiveReason,
    "archived-to-old-generation",
  );
  assert.equal(
    archivedMemory.snapshot.lifecycle.archiveLinkage.archiveId,
    archivedMemory.archiveId,
  );
  assert.equal(
    archivedMemory.snapshot.lifecycle.archiveLinkage.archivedAt,
    archivedMemory.archivedAt,
  );
});

test("archiveStaleMemories compaction preserves the source memory id across archived recovery surfaces", async () => {
  const graph = createInactiveYoungArchivalCandidateGraph();
  const evaluation = createInactiveYoungArchivalEvaluation();
  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("sleep"),
    archivedAt: "2026-04-12T12:30:00Z",
    archivedBy: "offline-consolidation",
    policyVersion: "archive-policy-v1",
  });
  const archivedMemory = result.archivedTransitions[0].archivedMemory;

  assert.equal(result.archivedCount, 1);
  assert.equal(archivedMemory.originalMemoryId, "stm-inactive");
  assert.equal(archivedMemory.snapshot.record.memoryId, "stm-inactive");
  assert.equal(
    archivedMemory.snapshot.recoveryContext.sourceMemoryId,
    "stm-inactive",
  );
});

test("archiveStaleMemories retires stale old-generation memories and preserves detached durable edges", async () => {
  const agentId = "agent-007";
  const archivedNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    agentId,
    "ltm-archive",
  );
  const activeNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    agentId,
    "ltm-active",
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    agentId,
    "evidence-1",
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    agentId,
    "consolidation-1",
  );
  const graph = createMemoryGraph(createIdentity(), {
    longTermMemory: [
      {
        memoryId: "ltm-active",
        agentId,
        category: "semantic",
        content: "Current customer domain knowledge remains durable and retrievable.",
        confidence: 0.9,
        provenance: {
          source: "runtime-trace",
          observedAt: "2026-03-25T10:00:00Z",
          evidence: ["trace-active"],
        },
        stabilizedAt: "2026-03-26T10:00:00Z",
      },
      {
        memoryId: "ltm-archive",
        agentId,
        category: "episodic",
        content: "Retired rollout episode no longer needs active long-term retrieval.",
        confidence: 0.25,
        provenance: {
          source: "runtime-trace",
          observedAt: "2026-02-01T10:00:00Z",
          evidence: ["trace-archive"],
        },
        stabilizedAt: "2026-02-05T10:00:00Z",
      },
    ],
    memoryEvidence: [
      {
        evidenceId: "evidence-1",
        agentId,
        kind: "runtime_trace",
        source: "runtime-trace",
        observedAt: "2026-02-01T10:00:00Z",
        detail: "Trace retained for historical recovery only.",
        provenance: {
          source: "runtime-trace",
        },
      },
    ],
    consolidationJournal: [
      {
        recordId: "consolidation-1",
        agentId,
        operation: "promote",
        runtimePhase: "sleep",
        consolidatedAt: "2026-02-05T10:00:00Z",
        sourceMemoryIds: ["ltm-archive"],
        policyVersion: "promotion-v1",
        provenance: {
          source: "offline-consolidation",
        },
      },
    ],
    edges: [
      createOldGenerationEdge({
        agentId,
        from: activeNodeId,
        to: archivedNodeId,
        relation: "long_term_memory_association",
        provenance: {
          source: "offline-consolidation",
        },
      }),
      createOldGenerationEdge({
        agentId,
        from: archivedNodeId,
        to: evidenceNodeId,
        relation: "long_term_memory_supported_by_evidence",
        provenance: {
          source: "offline-consolidation",
        },
      }),
      createOldGenerationEdge({
        agentId,
        from: archivedNodeId,
        to: recordNodeId,
        relation: "long_term_memory_created_by_consolidation",
        provenance: {
          source: "offline-consolidation",
        },
        consolidationState: {
          journalRecordId: "consolidation-1",
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

  const storageEntries = Object.fromEntries(
    graph.oldGeneration.longTermMemory.map((memory) => {
      const storageRecord = serializeLongTermMemoryPersistenceStorageRecord(memory);
      return [storageRecord.key, storageRecord.value];
    }),
  );
  const storage = createInMemoryLongTermMemoryStorage(storageEntries);
  const archivedStorageRecord = serializeLongTermMemoryPersistenceStorageRecord(
    graph.oldGeneration.longTermMemory.find((memory) => memory.memoryId === "ltm-archive"),
  );
  const activeStorageRecord = serializeLongTermMemoryPersistenceStorageRecord(
    graph.oldGeneration.longTermMemory.find((memory) => memory.memoryId === "ltm-active"),
  );

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("sleep"),
    archivedAt: "2026-04-12T12:20:00Z",
    archivedBy: "offline-consolidation",
    storage,
  });

  assert.equal(result.archivedCount, 1);
  assert.equal(result.persistedDeleteCount, 1);
  assert.equal(result.deferredCount, 0);
  assert.equal(lookupLongTermMemory(result.nextGraph, "ltm-archive"), null);
  assert.deepEqual(
    result.nextGraph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    ["ltm-active"],
  );
  assert.equal(result.nextGraph.oldGeneration.memoryEvidence.length, 1);
  assert.equal(result.nextGraph.oldGeneration.consolidationJournal.length, 1);
  assert.equal(
    result.nextGraph.edges.some(
      (edge) => edge.from === archivedNodeId || edge.to === archivedNodeId,
    ),
    false,
  );
  assert.equal(result.persistedDeletes[0].status, "deleted");
  assert.equal(result.persistedDeletes[0].memoryId, "ltm-archive");
  assert.equal(storage.getValue(archivedStorageRecord.key), null);
  assert.ok(storage.getValue(activeStorageRecord.key));

  const archivedMemory = result.archivedTransitions[0].archivedMemory;

  assert.equal(archivedMemory.originalGeneration, MEMORY_NODE_KINDS.oldGeneration);
  assert.equal(archivedMemory.originalMemoryKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.equal(archivedMemory.originalNodeId, archivedNodeId);
  assert.equal(archivedMemory.snapshot.memoryId, "ltm-archive");
  assert.equal(archivedMemory.snapshot.recoveryContext.detachedEdges.length, 3);
  assert.equal(
    archivedMemory.snapshot.recoveryContext.detachedEdges.every(
      (edge) => edge.from === archivedNodeId || edge.to === archivedNodeId,
    ),
    true,
  );
});

test("archiveStaleMemories keeps runtime heuristics advisory and refuses unauthorized archival writes", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveYoungMemory({
        memoryId: "stm-blocked",
        summary: "Candidate exists but must not archive during active work.",
      }),
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
        memoryId: "stm-blocked",
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
    runtimePhase: createRuntimePhase("active"),
    archivedAt: "2026-04-12T12:25:00Z",
  });

  assert.equal(result.authorization.eligible, false);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.applied, false);
  assert.equal(result.deferredCandidates[0].deferredReason, "runtime-phase-not-idle-window");
  assert.strictEqual(result.nextGraph, graph);
  assert.equal(graph.oldGeneration.archivedMemory.length, 0);
});

test("archiveStaleMemories does not advance inactive lifecycle state when idle is only scheduler-declared or heuristic-suggested", async () => {
  const graph = createInactiveYoungArchivalCandidateGraph();
  const evaluation = createInactiveYoungArchivalEvaluation();

  assert.equal(graph.youngGeneration.shortTermMemory[0].lifecycle.state, "inactive");

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("sleep", {
      authority: "scheduler",
      changedAt: "2026-04-12T12:10:00Z",
    }),
    inactivitySuggestion: createIdleWindowSuggestion({
      source: "runtime-heartbeat",
      suggestedPhase: "sleep",
      inactivityMs: 45 * 60 * 1000,
      idleThresholdMs: 30 * 60 * 1000,
      note: "No live requests observed during the sampling window.",
    }),
    teamIdle: true,
    archivedAt: "2026-04-12T12:25:00Z",
  });

  assert.equal(result.authorization.eligible, false);
  assert.equal(
    result.authorization.blockedReason,
    "runtime-phase-not-caller-controlled",
  );
  assert.equal(result.authorization.teamIdle, true);
  assert.equal(result.authorization.inactivitySuggestion.authorizesConsolidation, false);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.applied, false);
  assert.equal(result.deferredCandidates[0].deferredReason, "runtime-phase-not-caller-controlled");
  assert.strictEqual(result.nextGraph, graph);
  assert.equal(graph.youngGeneration.shortTermMemory[0].lifecycle.state, "inactive");
  assert.equal(graph.youngGeneration.shortTermMemory[0].lifecycle.archiveLinkage, null);
  assert.equal(graph.oldGeneration.archivedMemory.length, 0);
});

test("archiveStaleMemories keeps learned traits in long-term memory instead of archiving them", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    longTermMemory: [
      {
        memoryId: "trait-1",
        category: "learned_trait",
        content: "The agent prefers concise architecture summaries.",
        confidence: 0.72,
        provenance: {
          source: "human_feedback",
          observedAt: "2026-02-01T12:00:00Z",
          evidence: ["feedback-1"],
        },
        stabilizedAt: "2026-02-03T12:00:00Z",
        learnedTrait: {
          label: "prefers concise architecture summaries",
          confidence: 0.72,
          provenance: {
            source: "human_feedback",
          },
        },
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
        memoryId: "trait-1",
        createdAt: "2026-02-01T12:00:00Z",
        lastAccessedAt: "2026-02-05T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.05,
        metadata: {
          generation: MEMORY_NODE_KINDS.oldGeneration,
          memoryKind: MEMORY_NODE_KINDS.longTermMemory,
        },
      },
    ],
  });

  const result = await archiveStaleMemories(graph, {
    evaluation,
    runtimePhase: createRuntimePhase("idle"),
    archivedAt: "2026-04-12T12:30:00Z",
  });

  assert.equal(result.authorization.eligible, true);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.applied, false);
  assert.equal(result.deferredCandidates[0].deferredReason, "protected-learned-trait");
  assert.strictEqual(result.nextGraph, graph);
});
