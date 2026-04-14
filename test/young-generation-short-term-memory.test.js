import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
  createYoungGenerationAdministrativeView,
  createYoungGenerationInspectionView,
  createYoungGenerationMemory,
  createYoungGenerationRetrievalView,
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

const createShortTermImportanceEntry = (
  memoryId,
  signals,
  lastUpdatedAt,
  overrides = {},
) => ({
  entryId: `importance-${memoryId}`,
  agentId: "agent-007",
  memoryId,
  memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  signals,
  lastUpdatedAt,
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

test("short-term memory retains summary/detail episode records instead of a working-memory content field", () => {
  const memory = createYoungGenerationMemory({
    record: {
      memoryId: "stm-episode",
      summary: "The user confirmed legal review is complete.",
      detail: "This recent episode should remain available for offline consolidation.",
      tags: ["legal", "recent"],
    },
    inactiveForRetrieval: true,
    masking: {
      maskedAt: "2026-04-12T10:20:00Z",
      maskedBy: "offline-consolidation",
      reason: "stale-window",
    },
  });

  assert.deepEqual(memory.record, {
    memoryId: "stm-episode",
    summary: "The user confirmed legal review is complete.",
    detail: "This recent episode should remain available for offline consolidation.",
    tags: ["legal", "recent"],
  });
  assert.equal("content" in memory.record, false);
  assert.equal(memory.inactiveForRetrieval, true);
  assert.equal(memory.masking.isMasked, true);
  assert.equal(
    memory.masking.maskedOriginalContent.value,
    "The user confirmed legal review is complete.",
  );
  assert.equal(memory.masking.maskedOriginalContent.sourceField, "summary");
  assert.equal(
    memory.masking.maskedOriginalContent.capturedAt,
    "2026-04-12T10:20:00Z",
  );
  assert.equal(memory.masking.audit.actor, "offline-consolidation");
  assert.ok(Object.isFrozen(memory));
  assert.ok(Object.isFrozen(memory.record));
});

test("short-term retrieval filtering stays independent from the active working-memory set", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Keep the launch blocker in the live task horizon.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-live",
          summary: "Recent contract dependency is still worth recalling.",
        },
      },
      {
        record: {
          memoryId: "stm-hidden",
          summary: "Older recap retained only for offline review.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:30:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
        },
      },
    ],
    importanceIndex: [
      createWorkingMemoryImportanceEntry(
        "wm-live",
        {
          taskRelevance: 0.98,
          recency: 0.92,
        },
        "2026-04-12T10:10:00Z",
      ),
      createShortTermImportanceEntry(
        "stm-live",
        {
          recallPriority: 0.76,
        },
        "2026-04-12T10:12:00Z",
      ),
      createShortTermImportanceEntry(
        "stm-hidden",
        {
          recallPriority: 0.22,
        },
        "2026-04-12T10:00:00Z",
      ),
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.deepEqual(
    graph.youngGeneration.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-live", "stm-hidden"],
  );
  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.deepEqual(
    retrievalView.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-live"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-live", "importance-stm-live"],
  );
  assert.equal(graph.youngGeneration.shortTermMemory[1].inactiveForRetrieval, true);
  assert.ok(
    retrievalView.shortTermMemory.every((memory) => memory.inactiveForRetrieval === false),
  );
});

test("administrative and inspection access restore masked short-term text without moving it into working memory", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Keep drafting the current user response.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-hidden",
          summary: "[masked for retrieval]",
          detail: "Stored detail remains in the preserved short-term record.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:40:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "The user previously required a procurement check.",
            sourceField: "summary",
            capturedAt: "2026-04-12T10:40:00Z",
          },
          audit: {
            auditRecordId: "mask-stm-7",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
            recordedAt: "2026-04-12T10:40:00Z",
            actor: "offline-consolidation",
          },
        },
      },
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);
  const administrativeView = createYoungGenerationAdministrativeView(graph);
  const inspectionView = createYoungGenerationInspectionView(graph);

  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.equal(retrievalView.shortTermMemory.length, 0);
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].record.summary,
    "[masked for retrieval]",
  );
  assert.deepEqual(
    administrativeView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.deepEqual(
    administrativeView.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-hidden"],
  );
  assert.equal(
    administrativeView.shortTermMemory[0].record.summary,
    "The user previously required a procurement check.",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].record.summary,
    "The user previously required a procurement check.",
  );
  assert.equal(
    inspectionView.shortTermMemory[0].masking.audit.auditRecordId,
    "mask-stm-7",
  );
  assert.equal(
    administrativeView.shortTermMemory[0].record.detail,
    "Stored detail remains in the preserved short-term record.",
  );
  assert.ok(Object.isFrozen(administrativeView));
  assert.ok(Object.isFrozen(inspectionView));
});
