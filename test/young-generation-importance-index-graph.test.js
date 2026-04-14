import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  YOUNG_GENERATION_EDGE_SCHEMA,
  createMemoryGraph,
  createYoungGenerationAdministrativeView,
  createYoungGenerationInspectionView,
  createYoungGenerationRetrievalView,
  getYoungGenerationSnapshotEdges,
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

const createImportanceEntry = ({
  entryId,
  memoryId,
  memoryKind,
  signals,
  lastUpdatedAt,
}) => ({
  entryId,
  agentId: "agent-007",
  memoryId,
  memoryKind,
  signals,
  lastUpdatedAt,
});

const projectImportanceEntry = (entry) => ({
  entryId: entry.entryId,
  memoryId: entry.memoryId,
  memoryKind: entry.memoryKind,
  signalCount: entry.signalCount,
  importanceScore: entry.importanceScore,
  signals: entry.signals,
});

test("young-generation graph snapshots encode importance index entries as canonical edges without copying scores into memory records", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Keep the rollout blocker in the live horizon.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-live",
          summary: "Recent legal dependency is still relevant to offline review.",
        },
      },
    ],
    importanceIndex: [
      createImportanceEntry({
        entryId: "importance-wm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.9,
          recency: 0.7,
        },
        lastUpdatedAt: "2026-04-12T09:10:00Z",
      }),
      createImportanceEntry({
        entryId: "importance-stm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.6,
        },
        lastUpdatedAt: "2026-04-12T09:08:00Z",
      }),
    ],
    edges: [
      {
        from: "wm-live",
        to: "wm-live",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
    ],
  });

  assert.equal("importanceScore" in graph.youngGeneration.workingMemory[0].record, false);
  assert.equal("signalCount" in graph.youngGeneration.shortTermMemory[0].record, false);
  assert.equal("signals" in graph.youngGeneration.workingMemory[0].record, false);
  assert.deepEqual(
    graph.youngGeneration.importanceIndex.map(projectImportanceEntry),
    [
      {
        entryId: "importance-wm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signalCount: 2,
        importanceScore: 0.8,
        signals: {
          taskRelevance: 0.9,
          recency: 0.7,
        },
      },
      {
        entryId: "importance-stm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signalCount: 1,
        importanceScore: 0.6,
        signals: {
          recallPriority: 0.6,
        },
      },
    ],
  );
  assert.deepEqual(getYoungGenerationSnapshotEdges(graph), [
    {
      from: "wm-live",
      to: "wm-live",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
    },
    {
      from: "importance-wm-live",
      to: "wm-live",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
    },
    {
      from: "importance-stm-live",
      to: "wm-live",
      relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
    },
  ]);
});

test("young-generation graph views expose only the importance entries linked to visible memories while preserving derived values for admin and inspection access", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Track the current blocker in working memory.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-hidden",
          summary: "[masked for retrieval]",
          detail: "Original recap remains available for offline audit only.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:10:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Original recap remains available for offline audit only.",
            sourceField: "summary",
            capturedAt: "2026-04-12T10:10:00Z",
          },
        },
      },
    ],
    importanceIndex: [
      createImportanceEntry({
        entryId: "importance-wm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.95,
          recency: 0.85,
        },
        lastUpdatedAt: "2026-04-12T10:08:00Z",
      }),
      createImportanceEntry({
        entryId: "importance-stm-hidden",
        memoryId: "stm-hidden",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.3,
          stability: 0.5,
        },
        lastUpdatedAt: "2026-04-12T10:05:00Z",
      }),
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);
  const administrativeView = createYoungGenerationAdministrativeView(graph);
  const inspectionView = createYoungGenerationInspectionView(graph);

  assert.deepEqual(
    retrievalView.importanceIndex.map(projectImportanceEntry),
    [
      {
        entryId: "importance-wm-live",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signalCount: 2,
        importanceScore: 0.9,
        signals: {
          taskRelevance: 0.95,
          recency: 0.85,
        },
      },
    ],
  );
  assert.deepEqual(
    administrativeView.importanceIndex.map(projectImportanceEntry),
    graph.youngGeneration.importanceIndex.map(projectImportanceEntry),
  );
  assert.deepEqual(
    inspectionView.importanceIndex.map(projectImportanceEntry),
    graph.youngGeneration.importanceIndex.map(projectImportanceEntry),
  );
  assert.equal(
    administrativeView.shortTermMemory[0].record.summary,
    "Original recap remains available for offline audit only.",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].record.summary,
    "Original recap remains available for offline audit only.",
  );
  assert.equal("importanceScore" in administrativeView.shortTermMemory[0].record, false);
  assert.equal("signals" in inspectionView.workingMemory[0].record, false);
});
