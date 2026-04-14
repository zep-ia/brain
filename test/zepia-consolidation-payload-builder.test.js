import test from "node:test";
import assert from "node:assert/strict";

import { buildZepiaConsolidationPayload } from "../src/index.js";

const createCheckpointFromPayload = (payload) => ({
  found: true,
  checkpoint: {
    agentId: payload.agentId,
    syncSource: "zepia-rpc-delta",
    cursor: {
      streamId: "channel:alpha",
      cursorToken: "cursor-5",
      sequence: 5,
      eventId: "evt-5",
      watermark: "2026-04-14T05:00:00.000Z",
    },
    consolidatedAt: "2026-04-14T05:00:00.000Z",
    runtimePhase: "idle",
    provenance: payload.checkpointProvenance,
  },
});

test("buildZepiaConsolidationPayload bootstraps current memory entities as added when no checkpoint snapshot exists", () => {
  const payload = buildZepiaConsolidationPayload({
    agentId: "agent-007",
    sessionId: "session-bootstrap-1",
    idleSince: "2026-04-14T06:00:00Z",
    memoryEntities: [
      {
        memoryId: "wm-1",
        state: "working",
        content: "Keep the current task context available.",
      },
      {
        memoryId: "stm-1",
        state: "short-term",
        summary: "Recent buffer waiting for the next idle cycle.",
      },
    ],
  });

  assert.equal(payload.checkpointFound, false);
  assert.equal(payload.summary.currentMemoryCount, 2);
  assert.equal(payload.summary.unchangedCount, 0);
  assert.equal(payload.summary.addedCount, 2);
  assert.equal(payload.summary.updatedCount, 0);
  assert.equal(payload.summary.deletedCount, 0);
  assert.deepEqual(
    payload.memories.map((record) => ({
      operation: record.operation,
      memoryId: record.memoryId,
    })),
    [
      {
        operation: "added",
        memoryId: "stm-1",
      },
      {
        operation: "added",
        memoryId: "wm-1",
      },
    ],
  );
  assert.equal(payload.toolCallTracking.toolCallCount, 0);
  assert.deepEqual(
    payload.checkpointSnapshot.memories.map((descriptor) => descriptor.memoryId),
    ["stm-1", "wm-1"],
  );
  assert.deepEqual(
    payload.checkpointProvenance.zepiaConsolidationPayload,
    payload.checkpointSnapshot,
  );
  assert.ok(Object.isFrozen(payload));
  assert.ok(Object.isFrozen(payload.memories[0]));
});

test("buildZepiaConsolidationPayload emits only added, updated, and deleted memories since the stored checkpoint snapshot", () => {
  const previousPayload = buildZepiaConsolidationPayload({
    agentId: "agent-007",
    memoryEntities: [
      {
        memoryId: "wm-keep",
        state: "working",
        content: "This memory remains unchanged across idle runs.",
      },
      {
        memoryId: "wm-updated",
        state: "working",
        content: "This memory will be revised after the last checkpoint.",
      },
      {
        memoryId: "wm-removed",
        state: "short-term",
        summary: "This memory is evicted before the next consolidation run.",
      },
    ],
  });

  const payload = buildZepiaConsolidationPayload({
    agentId: "agent-007",
    sessionId: "session-delta-1",
    checkpoint: createCheckpointFromPayload(previousPayload),
    memoryEntities: [
      {
        memoryId: "wm-keep",
        state: "working",
        content: "This memory remains unchanged across idle runs.",
      },
      {
        memoryId: "wm-updated",
        state: "working",
        content: "This memory changed after the stored checkpoint.",
      },
      {
        memoryId: "wm-added",
        state: "short-term",
        summary: "This memory was created after the stored checkpoint.",
      },
    ],
  });

  assert.equal(payload.checkpointFound, true);
  assert.equal(payload.summary.checkpointMemoryCount, 3);
  assert.equal(payload.summary.currentMemoryCount, 3);
  assert.equal(payload.summary.unchangedCount, 1);
  assert.equal(payload.summary.addedCount, 1);
  assert.equal(payload.summary.updatedCount, 1);
  assert.equal(payload.summary.deletedCount, 1);
  assert.deepEqual(
    payload.memories.map((record) => ({
      operation: record.operation,
      memoryId: record.memoryId,
      deleted: record.entity.deleted === true,
    })),
    [
      {
        operation: "added",
        memoryId: "wm-added",
        deleted: false,
      },
      {
        operation: "updated",
        memoryId: "wm-updated",
        deleted: false,
      },
      {
        operation: "deleted",
        memoryId: "wm-removed",
        deleted: true,
      },
    ],
  );
  assert.deepEqual(
    payload.checkpointSnapshot.memories.map((descriptor) => descriptor.memoryId),
    ["wm-added", "wm-keep", "wm-updated"],
  );
});

test("buildZepiaConsolidationPayload preserves explicit tombstones and keeps tool-call tracking in the payload", () => {
  const previousPayload = buildZepiaConsolidationPayload({
    agentId: "agent-007",
    memoryEntities: [
      {
        memoryId: "wm-source",
        state: "working",
        content: "Source memory from the prior checkpoint.",
      },
      {
        memoryId: "stm-target",
        state: "short-term",
        summary: "Referenced memory from the prior checkpoint.",
      },
    ],
  });

  const payload = buildZepiaConsolidationPayload({
    agentId: "agent-007",
    sessionId: "session-explicit-delete-1",
    checkpoint: createCheckpointFromPayload(previousPayload),
    memoryEntities: [
      {
        memoryId: "wm-source",
        state: "working",
        content: "Source memory from the prior checkpoint.",
      },
      {
        memoryId: "stm-target",
        deleted: true,
        reason: "evicted-after-idle",
      },
      {
        memoryId: "stm-fresh",
        state: "short-term",
        summary: "Fresh target memory added during the same idle window.",
      },
    ],
    toolCalls: [
      {
        toolCallId: "tool-call-9",
        toolName: "brain.query_graph",
        calledAt: "2026-04-14T06:05:00Z",
        sourceMemoryId: "wm-source",
        referencedMemoryIds: ["stm-fresh"],
      },
    ],
  });

  assert.deepEqual(
    payload.memories.map((record) => ({
      operation: record.operation,
      memoryId: record.memoryId,
      reason: record.entity.reason ?? null,
    })),
    [
      {
        operation: "added",
        memoryId: "stm-fresh",
        reason: null,
      },
      {
        operation: "deleted",
        memoryId: "stm-target",
        reason: "evicted-after-idle",
      },
    ],
  );
  assert.equal(payload.toolCallTracking.toolCallCount, 1);
  assert.equal(payload.toolCallTracking.coReferenceEdgeCount, 2);
  assert.deepEqual(
    payload.toolCallTracking.toolCalls[0].targetMemoryIds,
    ["stm-fresh"],
  );
});
