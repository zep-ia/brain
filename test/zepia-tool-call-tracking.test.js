import test from "node:test";
import assert from "node:assert/strict";

import { ingestZepiaToolCallTracking } from "../src/index.js";

const createJsonStorageFixture = () => {
  const records = new Map();

  return {
    write(key, value) {
      records.set(key, JSON.stringify(value));
    },
    read(key) {
      return JSON.parse(records.get(key));
    },
  };
};

test("ingestZepiaToolCallTracking normalizes explicit source and referenced memory ids into stable co-reference candidates", () => {
  const result = ingestZepiaToolCallTracking({
    agentId: "agent-007",
    sessionId: "session-1",
    toolCalls: [
      {
        toolCallId: "tool-call-1",
        toolName: "github.search_code",
        calledAt: "2026-04-14T01:00:00Z",
        sourceMemoryId: "wm-1",
        referencedMemoryIds: ["stm-2", "ltm-3", "stm-2"],
        provenance: {
          channelId: "office-1",
        },
      },
    ],
  });

  assert.equal(result.agentId, "agent-007");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.toolCallCount, 1);
  assert.equal(result.linkCandidateCount, 2);
  assert.equal(result.coReferenceEdgeCount, 4);
  assert.deepEqual(result.toolCallIds, ["tool-call-1"]);
  assert.deepEqual(result.toolCalls[0].sourceIds, ["agent-007:wm-1"]);
  assert.deepEqual(result.toolCalls[0].targetIds, [
    "agent-007:ltm-3",
    "agent-007:stm-2",
  ]);
  assert.equal(result.toolCalls[0].coReferenceEdgeCount, 4);
  assert.deepEqual(
    result.linkCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      pairId: candidate.pairId,
      sourceId: candidate.sourceId,
      targetId: candidate.targetId,
    })),
    [
      {
        candidateId: "tool-call-1|agent-007:wm-1->agent-007:ltm-3",
        pairId: "agent-007:ltm-3<->agent-007:wm-1",
        sourceId: "agent-007:wm-1",
        targetId: "agent-007:ltm-3",
      },
      {
        candidateId: "tool-call-1|agent-007:wm-1->agent-007:stm-2",
        pairId: "agent-007:stm-2<->agent-007:wm-1",
        sourceId: "agent-007:wm-1",
        targetId: "agent-007:stm-2",
      },
    ],
  );
  assert.equal(result.linkCandidates[0].toolName, "github.search_code");
  assert.equal(result.linkCandidates[0].provenance.source, "zepia-explicit-tool-call-tracking");
  assert.equal(result.linkCandidates[0].provenance.channelId, "office-1");
  assert.deepEqual(
    result.coReferenceEdges.map((edge) => ({
      edgeId: edge.edgeId,
      candidateIds: edge.candidateIds,
      fromId: edge.fromId,
      toId: edge.toId,
      edgeWeight: edge.edgeWeight,
    })),
    [
      {
        edgeId: "tool-call-1|agent-007:wm-1->agent-007:ltm-3",
        candidateIds: ["tool-call-1|agent-007:wm-1->agent-007:ltm-3"],
        fromId: "agent-007:wm-1",
        toId: "agent-007:ltm-3",
        edgeWeight: 1,
      },
      {
        edgeId: "tool-call-1|agent-007:ltm-3->agent-007:wm-1",
        candidateIds: ["tool-call-1|agent-007:wm-1->agent-007:ltm-3"],
        fromId: "agent-007:ltm-3",
        toId: "agent-007:wm-1",
        edgeWeight: 1,
      },
      {
        edgeId: "tool-call-1|agent-007:wm-1->agent-007:stm-2",
        candidateIds: ["tool-call-1|agent-007:wm-1->agent-007:stm-2"],
        fromId: "agent-007:wm-1",
        toId: "agent-007:stm-2",
        edgeWeight: 1,
      },
      {
        edgeId: "tool-call-1|agent-007:stm-2->agent-007:wm-1",
        candidateIds: ["tool-call-1|agent-007:wm-1->agent-007:stm-2"],
        fromId: "agent-007:stm-2",
        toId: "agent-007:wm-1",
        edgeWeight: 1,
      },
    ],
  );
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.linkCandidates[0]));
  assert.ok(Object.isFrozen(result.coReferenceEdges[0]));
});

test("tracked explicit tool calls keep forward and reverse co-reference edges after storage round-trips", () => {
  const storage = createJsonStorageFixture();
  const tracking = ingestZepiaToolCallTracking({
    agentId: "agent-007",
    sessionId: "session-storage-1",
    toolCalls: [
      {
        toolCallId: "tool-call-storage-1",
        toolName: "brain.query_graph",
        calledAt: "2026-04-14T01:15:00Z",
        sourceMemoryId: "wm-7",
        referencedMemoryIds: ["stm-3"],
        provenance: {
          channelId: "office-1",
          trigger: "idle",
        },
      },
    ],
  });

  storage.write("tool-call-tracking/session-storage-1", {
    sessionId: tracking.sessionId,
    toolCalls: tracking.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      coReferenceEdges: toolCall.coReferenceEdges,
    })),
    coReferenceEdges: tracking.coReferenceEdges,
  });

  const storedTracking = storage.read("tool-call-tracking/session-storage-1");

  assert.deepEqual(
    storedTracking.toolCalls[0].coReferenceEdges.map((edge) => ({
      edgeId: edge.edgeId,
      fromId: edge.fromId,
      toId: edge.toId,
    })),
    [
      {
        edgeId: "tool-call-storage-1|agent-007:wm-7->agent-007:stm-3",
        fromId: "agent-007:wm-7",
        toId: "agent-007:stm-3",
      },
      {
        edgeId: "tool-call-storage-1|agent-007:stm-3->agent-007:wm-7",
        fromId: "agent-007:stm-3",
        toId: "agent-007:wm-7",
      },
    ],
  );
  assert.deepEqual(
    storedTracking.coReferenceEdges.map((edge) => ({
      edgeId: edge.edgeId,
      fromId: edge.fromId,
      toId: edge.toId,
    })),
    [
      {
        edgeId: "tool-call-storage-1|agent-007:wm-7->agent-007:stm-3",
        fromId: "agent-007:wm-7",
        toId: "agent-007:stm-3",
      },
      {
        edgeId: "tool-call-storage-1|agent-007:stm-3->agent-007:wm-7",
        fromId: "agent-007:stm-3",
        toId: "agent-007:wm-7",
      },
    ],
  );
});

test("ingestZepiaToolCallTracking expands multiple sources and targets with a stable derived tool call id", () => {
  const result = ingestZepiaToolCallTracking({
    sessionId: "loop-9",
    toolCalls: [
      {
        agentId: "agent-007",
        stepIndex: 2,
        tool: "review_pr",
        timestamp: Date.parse("2026-04-14T02:00:00Z"),
        sourceMemoryIds: ["wm-2", "stm-1"],
        targets: [{ memoryId: "ltm-9" }, { memoryId: "stm-4" }],
      },
    ],
  });

  assert.equal(result.toolCalls[0].toolCallId, "loop-9:2");
  assert.deepEqual(result.toolCalls[0].sourceMemoryIds, ["stm-1", "wm-2"]);
  assert.deepEqual(result.toolCalls[0].targetMemoryIds, ["ltm-9", "stm-4"]);
  assert.deepEqual(
    result.linkCandidates.map((candidate) => `${candidate.sourceId}->${candidate.targetId}`),
    [
      "agent-007:stm-1->agent-007:ltm-9",
      "agent-007:stm-1->agent-007:stm-4",
      "agent-007:wm-2->agent-007:ltm-9",
      "agent-007:wm-2->agent-007:stm-4",
    ],
  );
  assert.equal(result.coReferenceEdgeCount, 8);
});

test("ingestZepiaToolCallTracking skips self-links when the same memory appears on both sides", () => {
  const result = ingestZepiaToolCallTracking({
    agentId: "agent-007",
    toolCalls: [
      {
        toolCallId: "tool-call-2",
        toolName: "create_issue",
        calledAt: "2026-04-14T03:00:00Z",
        references: [
          { role: "source", memoryId: "wm-1" },
          { role: "target", memoryId: "wm-1" },
          { role: "target", memoryId: "stm-9" },
        ],
      },
    ],
  });

  assert.equal(result.linkCandidateCount, 1);
  assert.equal(result.coReferenceEdgeCount, 2);
  assert.deepEqual(
    result.linkCandidates.map((candidate) => `${candidate.sourceMemoryId}->${candidate.targetMemoryId}`),
    ["wm-1->stm-9"],
  );
  assert.deepEqual(
    result.coReferenceEdges.map((edge) => `${edge.fromMemoryId}->${edge.toMemoryId}`),
    ["wm-1->stm-9", "stm-9->wm-1"],
  );
});

test("ingestZepiaToolCallTracking deduplicates reciprocal co-reference edges when inverse candidates normalize from one tool call", () => {
  const result = ingestZepiaToolCallTracking({
    agentId: "agent-007",
    toolCalls: [
      {
        toolCallId: "tool-call-4",
        toolName: "memory.cross_link",
        calledAt: "2026-04-14T05:00:00Z",
        references: [
          { role: "source", memoryId: "wm-1" },
          { role: "source", memoryId: "stm-9" },
          { role: "target", memoryId: "wm-1" },
          { role: "target", memoryId: "stm-9" },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.linkCandidates.map((candidate) => `${candidate.sourceMemoryId}->${candidate.targetMemoryId}`),
    ["stm-9->wm-1", "wm-1->stm-9"],
  );
  assert.equal(result.linkCandidateCount, 2);
  assert.equal(result.coReferenceEdgeCount, 2);
  assert.deepEqual(
    result.coReferenceEdges.map((edge) => ({
      edgeId: edge.edgeId,
      candidateIds: edge.candidateIds,
    })),
    [
      {
        edgeId: "tool-call-4|agent-007:stm-9->agent-007:wm-1",
        candidateIds: [
          "tool-call-4|agent-007:stm-9->agent-007:wm-1",
          "tool-call-4|agent-007:wm-1->agent-007:stm-9",
        ],
      },
      {
        edgeId: "tool-call-4|agent-007:wm-1->agent-007:stm-9",
        candidateIds: [
          "tool-call-4|agent-007:stm-9->agent-007:wm-1",
          "tool-call-4|agent-007:wm-1->agent-007:stm-9",
        ],
      },
    ],
  );
});

test("ingestZepiaToolCallTracking rejects cross-agent references inside one batch", () => {
  assert.throws(
    () =>
      ingestZepiaToolCallTracking({
        agentId: "agent-007",
        toolCalls: [
          {
            toolCallId: "tool-call-3",
            toolName: "merge_pr",
            calledAt: "2026-04-14T04:00:00Z",
            sourceMemoryId: "wm-1",
            targets: [{ agentId: "agent-999", memoryId: "stm-2" }],
          },
        ],
      }),
    /must stay inside one agent boundary/,
  );
});
