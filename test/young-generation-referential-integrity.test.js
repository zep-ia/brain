import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  YOUNG_GENERATION_EDGE_SCHEMA,
  createMemoryGraph,
  loadYoungGenerationGraphState,
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

test("young-generation stage transitions preserve one stable memoryId across working, short-term, and hippocampus-like indexing", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-stable-1",
          content: "Keep the verified rollout blocker in live context.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "wm-stable-1",
          summary: "The same blocker remains available for offline consolidation.",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-stable-working",
        agentId: "agent-007",
        memoryId: "wm-stable-1",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.98,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-wm-stable-short-term",
        agentId: "agent-007",
        memoryId: "wm-stable-1",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.87,
        },
        lastUpdatedAt: "2026-04-12T10:05:00Z",
      },
    ],
    edges: [
      {
        from: "importance-wm-stable-working",
        to: "wm-stable-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToWorkingMemory.relation,
      },
      {
        from: "importance-wm-stable-short-term",
        to: "wm-stable-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.importanceToShortTermMemory.relation,
      },
      {
        from: "wm-stable-1",
        to: "wm-stable-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
      },
      {
        from: "wm-stable-1",
        to: "wm-stable-1",
        relation: YOUNG_GENERATION_EDGE_SCHEMA.shortTermRecall.relation,
      },
    ],
  });
  const snapshot = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(graph.oldGeneration.immutableIdentity),
    snapshot,
  );

  assert.equal(graph.youngGeneration.workingMemory[0].record.memoryId, "wm-stable-1");
  assert.equal(graph.youngGeneration.shortTermMemory[0].record.memoryId, "wm-stable-1");
  assert.deepEqual(
    graph.youngGeneration.importanceIndex.map((entry) => [
      entry.memoryKind,
      entry.memoryId,
    ]),
    [
      [MEMORY_NODE_KINDS.workingMemory, "wm-stable-1"],
      [MEMORY_NODE_KINDS.shortTermMemory, "wm-stable-1"],
    ],
  );
  assert.ok(
    snapshot.edges.some(
      (edge) =>
        edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation &&
        edge.from === "wm-stable-1" &&
        edge.to === "wm-stable-1",
    ),
  );
  assert.ok(
    snapshot.edges.some(
      (edge) =>
        edge.relation === YOUNG_GENERATION_EDGE_SCHEMA.shortTermRecall.relation &&
        edge.from === "wm-stable-1" &&
        edge.to === "wm-stable-1",
    ),
  );
  assert.equal(
    restoredGraph.youngGeneration.shortTermMemory[0].record.memoryId,
    "wm-stable-1",
  );
});

test("createMemoryGraph rejects working-to-short-term capture edges that rewrite stable memory ids", () => {
  assert.throws(
    () =>
      createMemoryGraph(createIdentity(), {
        workingMemory: [
          {
            record: {
              memoryId: "wm-source-1",
              content: "Keep the source memory live.",
            },
          },
        ],
        shortTermMemory: [
          {
            record: {
              memoryId: "stm-target-1",
              summary: "A rewritten target id would break referential integrity.",
            },
          },
        ],
        edges: [
          {
            from: "wm-source-1",
            to: "stm-target-1",
            relation: YOUNG_GENERATION_EDGE_SCHEMA.workingToShortTermCapture.relation,
          },
        ],
      }),
    /must preserve the same memoryId across working_memory -> short_term_memory transitions/,
  );
});

test("createMemoryGraph rejects importance-index entries that reference a missing stage memory id", () => {
  assert.throws(
    () =>
      createMemoryGraph(createIdentity(), {
        workingMemory: [
          {
            record: {
              memoryId: "wm-live-1",
              content: "Only the live working memory exists.",
            },
          },
        ],
        importanceIndex: [
          {
            entryId: "importance-missing-short-term",
            agentId: "agent-007",
            memoryId: "stm-missing-1",
            memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
            signals: {
              recallPriority: 0.71,
            },
            lastUpdatedAt: "2026-04-12T10:15:00Z",
          },
        ],
      }),
    /must reference an existing "short_term_memory" snapshot node/,
  );
});
