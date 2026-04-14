import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
  createYoungGenerationMemory,
  createYoungGenerationRetrievalView,
  queryImportanceIndex,
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

const createWorkingMemoryImportanceEntry = (
  memoryId,
  signals,
  lastUpdatedAt,
  overrides = {},
) => ({
  entryId: `importance-${memoryId}`,
  agentId: "agent-007",
  memoryId,
  memoryKind: MEMORY_NODE_KINDS.workingMemory,
  signals,
  lastUpdatedAt,
  ...overrides,
});

test("working memory normalizes a live record into an immutable active envelope", () => {
  const memory = createYoungGenerationMemory({
    memoryId: "wm-live",
    content: "Investigate the current rollout blocker.",
    metadata: {
      source: "runtime",
    },
  });

  assert.deepEqual(memory.record, {
    memoryId: "wm-live",
    content: "Investigate the current rollout blocker.",
    metadata: {
      source: "runtime",
    },
  });
  assert.equal(memory.inactiveForRetrieval, false);
  assert.equal(memory.masking.isMasked, false);
  assert.equal(memory.masking.maskedOriginalContent, null);
  assert.equal(memory.masking.audit, null);
  assert.ok(Object.isFrozen(memory));
  assert.ok(Object.isFrozen(memory.record));
});

test("working memory masking lifecycle derives retained source content and audit defaults", () => {
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "wm-masked",
      content: "Older rollout draft retained for offline review.",
    },
    inactiveForRetrieval: true,
    masking: {
      maskedAt: "2026-04-12T09:30:00Z",
      maskedBy: "offline-consolidation",
      reason: "stale-window",
      provenance: {
        source: "offline-suggestion",
        runtimePhase: "idle",
        policyVersion: "stale-memory-v1",
        auditRecordId: "mask-1",
      },
    },
  });

  assert.equal(memory.inactiveForRetrieval, true);
  assert.equal(memory.masking.isMasked, true);
  assert.equal(memory.masking.maskedOriginalContent.value, "Older rollout draft retained for offline review.");
  assert.equal(memory.masking.maskedOriginalContent.sourceField, "content");
  assert.equal(memory.masking.maskedOriginalContent.capturedAt, "2026-04-12T09:30:00Z");
  assert.equal(memory.masking.audit.auditRecordId, "mask-1");
  assert.equal(memory.masking.audit.policyVersion, "stale-memory-v1");
  assert.equal(memory.masking.audit.runtimePhase, "idle");
  assert.equal(memory.masking.audit.recordedAt, "2026-04-12T09:30:00Z");
  assert.equal(memory.masking.audit.actor, "offline-consolidation");
});

test("working-memory retrieval keeps every active item available while excluding retrieval-inactive ones", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-active-1",
          content: "Keep the current incident timeline in focus.",
        },
      },
      {
        record: {
          memoryId: "wm-hidden",
          content: "Older investigation branch preserved for offline review.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:35:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
        },
      },
      {
        record: {
          memoryId: "wm-active-2",
          content: "Track the legal approval dependency.",
        },
      },
    ],
    importanceIndex: [
      createWorkingMemoryImportanceEntry(
        "wm-active-1",
        {
          taskRelevance: 0.95,
          recency: 0.8,
        },
        "2026-04-12T09:10:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-hidden",
        {
          taskRelevance: 0.35,
        },
        "2026-04-12T09:05:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-active-2",
        {
          taskRelevance: 0.9,
          recency: 0.75,
        },
        "2026-04-12T09:12:00Z",
      ),
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.deepEqual(
    graph.youngGeneration.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active-1", "wm-hidden", "wm-active-2"],
  );
  assert.equal(graph.youngGeneration.workingMemory.length, 3);
  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active-1", "wm-active-2"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-active-1", "importance-wm-active-2"],
  );
  assert.ok(
    retrievalView.workingMemory.every((memory) => memory.inactiveForRetrieval === false),
  );
  assert.ok(Object.isFrozen(retrievalView));
});

test("working-memory capacity queries default to retrieval-active memories while preserving administrative inspection", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        memoryId: "wm-critical",
        content: "Current launch blocker with explicit user urgency.",
      },
      {
        memoryId: "wm-follow-up",
        content: "Secondary follow-up once the blocker is cleared.",
      },
      {
        record: {
          memoryId: "wm-hidden",
          content: "Stale branch retained only for offline inspection.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:10:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
        },
      },
      {
        memoryId: "wm-background",
        content: "Background context retained for later reference.",
      },
    ],
    importanceIndex: [
      createWorkingMemoryImportanceEntry(
        "wm-critical",
        {
          taskRelevance: 1,
          userExplicitness: 1,
        },
        "2026-04-12T09:20:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-follow-up",
        {
          taskRelevance: 0.8,
          recency: 0.75,
        },
        "2026-04-12T09:15:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-hidden",
        {
          taskRelevance: 1,
          recency: 1,
        },
        "2026-04-12T09:18:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-background",
        {
          taskRelevance: 0.3,
          recency: 0.2,
        },
        "2026-04-12T09:00:00Z",
      ),
    ],
  });

  const topTwoEntries = queryImportanceIndex(graph, {
    memoryKind: MEMORY_NODE_KINDS.workingMemory,
    limit: 2,
  });
  const administrativeTopTwoEntries = queryImportanceIndex(graph, {
    accessMode: "administrative",
    memoryKind: MEMORY_NODE_KINDS.workingMemory,
    limit: 2,
  });

  assert.deepEqual(
    topTwoEntries.map((entry) => entry.memoryId),
    ["wm-critical", "wm-follow-up"],
  );
  assert.deepEqual(
    administrativeTopTwoEntries.map((entry) => entry.memoryId),
    ["wm-critical", "wm-hidden"],
  );
  assert.equal(topTwoEntries.length, 2);
  assert.equal(graph.youngGeneration.workingMemory.length, 4);
  assert.deepEqual(
    graph.youngGeneration.importanceIndex.map((entry) => entry.memoryId),
    ["wm-critical", "wm-follow-up", "wm-hidden", "wm-background"],
  );
});

test("importance-index queries honor accepted explicit limit boundaries at the live result edges", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        memoryId: "wm-critical",
        content: "Keep the launch blocker in the active horizon.",
      },
      {
        memoryId: "wm-follow-up",
        content: "Retain the immediate follow-up dependency.",
      },
      {
        memoryId: "wm-watch",
        content: "Track the background regression signal.",
      },
      {
        memoryId: "wm-background",
        content: "Preserve low-priority context for later inspection.",
      },
    ],
    importanceIndex: [
      createWorkingMemoryImportanceEntry(
        "wm-critical",
        {
          taskRelevance: 1,
          recency: 0.9,
        },
        "2026-04-12T09:20:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-follow-up",
        {
          taskRelevance: 0.8,
          recency: 0.7,
        },
        "2026-04-12T09:15:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-watch",
        {
          taskRelevance: 0.6,
          recency: 0.5,
        },
        "2026-04-12T09:10:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-background",
        {
          taskRelevance: 0.2,
          recency: 0.1,
        },
        "2026-04-12T09:05:00Z",
      ),
    ],
  });
  const orderedMatchingIds = [
    "wm-critical",
    "wm-follow-up",
    "wm-watch",
    "wm-background",
  ];
  const boundaryCases = [
    {
      label: "minimum explicit limit",
      limit: 0,
      expectedIds: [],
    },
    {
      label: "minimum-plus-one explicit limit",
      limit: 1,
      expectedIds: orderedMatchingIds.slice(0, 1),
    },
    {
      label: "maximum-minus-one explicit limit",
      limit: orderedMatchingIds.length - 1,
      expectedIds: orderedMatchingIds.slice(0, orderedMatchingIds.length - 1),
    },
    {
      label: "maximum explicit limit",
      limit: orderedMatchingIds.length,
      expectedIds: orderedMatchingIds,
    },
    {
      label: "maximum-plus-one explicit limit",
      limit: orderedMatchingIds.length + 1,
      expectedIds: orderedMatchingIds,
    },
  ];

  for (const { label, limit, expectedIds } of boundaryCases) {
    const entries = queryImportanceIndex(graph, {
      memoryKind: MEMORY_NODE_KINDS.workingMemory,
      limit,
    });

    assert.deepEqual(
      entries.map((entry) => entry.memoryId),
      expectedIds,
      label,
    );
    assert.equal(entries.length, expectedIds.length, label);
  }

  assert.equal(graph.youngGeneration.importanceIndex.length, orderedMatchingIds.length);
});

test("importance-index queries reject malformed or unsupported explicit limit values", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        memoryId: "wm-critical",
        content: "Keep the incident blocker in the live horizon.",
      },
      {
        memoryId: "wm-follow-up",
        content: "Retain the follow-up dependency after the blocker.",
      },
    ],
    importanceIndex: [
      createWorkingMemoryImportanceEntry(
        "wm-critical",
        {
          taskRelevance: 1,
          recency: 0.9,
        },
        "2026-04-12T09:20:00Z",
      ),
      createWorkingMemoryImportanceEntry(
        "wm-follow-up",
        {
          taskRelevance: 0.8,
          recency: 0.7,
        },
        "2026-04-12T09:15:00Z",
      ),
    ],
  });

  const invalidLimitInputs = [
    {
      label: "malformed string limit",
      query: { limit: "2" },
    },
    {
      label: "missing explicit limit value",
      query: { limit: undefined },
    },
    {
      label: "negative limit",
      query: { limit: -1 },
    },
    {
      label: "unsupported fractional limit",
      query: { limit: 1.5 },
    },
    {
      label: "unsupported infinite limit",
      query: { limit: Number.POSITIVE_INFINITY },
    },
  ];

  for (const { label, query } of invalidLimitInputs) {
    assert.throws(
      () =>
        queryImportanceIndex(graph, {
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
          ...query,
        }),
      (error) => {
        assert.ok(error instanceof TypeError, label);
        assert.match(
          error.message,
          /query\.limit must be a non-negative integer/,
          label,
        );

        return true;
      },
      label,
    );
  }
});
