import assert from "node:assert/strict";
import test from "node:test";

import { ingestElectricEventBatch } from "../src/index.js";

const baseEvent = (overrides = {}) => ({
  agentId: "agent-1",
  syncSource: "electric-streams",
  streamId: "hermes/session/123",
  offset: 1,
  eventType: "prompt",
  payload: { text: "remember this" },
  observedAt: "2026-05-01T23:25:00.000Z",
  ...overrides,
});

test("fails closed when stream id is missing", () => {
  assert.throws(
    () => ingestElectricEventBatch([baseEvent({ streamId: undefined })]),
    /streamId must not be empty/,
  );
});

test("fails closed when offset is missing", () => {
  assert.throws(
    () => ingestElectricEventBatch([baseEvent({ offset: undefined })]),
    /offset must be present/,
  );
});

test("produces one checkpoint intent per agentId + syncSource + streamId", () => {
  const result = ingestElectricEventBatch([
    baseEvent({ offset: 7, payload: { text: "a" } }),
    baseEvent({ offset: 9, payload: { text: "b" } }),
    baseEvent({ agentId: "agent-2", offset: 3, payload: { text: "c" } }),
    baseEvent({ syncSource: "electric-shape", offset: 4, payload: { text: "d" } }),
    baseEvent({ streamId: "hermes/session/456", offset: 2, payload: { text: "e" } }),
  ]);

  assert.equal(result.rows.length, 5);
  assert.equal(result.checkpointIntents.length, 4);

  const agentOneStream = result.checkpointIntents.find(
    (intent) =>
      intent.agentId === "agent-1" &&
      intent.syncSource === "electric-streams" &&
      intent.streamId === "hermes/session/123",
  );

  assert.deepEqual(agentOneStream, {
    agentId: "agent-1",
    syncSource: "electric-streams",
    streamId: "hermes/session/123",
    fromOffset: 7,
    toOffset: 9,
    status: "pending",
    committable: false,
    durableWriteResult: null,
  });
});

test("does not collapse checkpoint groups when identifiers contain separator-like bytes", () => {
  const result = ingestElectricEventBatch([
    baseEvent({
      agentId: "agent-a",
      syncSource: "source-b\u0000source-c",
      streamId: "stream-d",
      offset: 1,
    }),
    baseEvent({
      agentId: "agent-a\u0000source-b",
      syncSource: "source-c",
      streamId: "stream-d",
      offset: 2,
    }),
  ]);

  assert.equal(result.checkpointIntents.length, 2);
});

test("does not mark checkpoint committable before durable memory write result commits", () => {
  const pending = ingestElectricEventBatch([baseEvent({ offset: 11 })]);

  assert.equal(pending.checkpointIntents[0].status, "pending");
  assert.equal(pending.checkpointIntents[0].committable, false);
  assert.equal(pending.checkpointIntents[0].durableWriteResult, null);

  const failedWrite = ingestElectricEventBatch([baseEvent({ offset: 11 })], {
    durableWriteResult: { writeId: "memory-write-1", committed: false },
  });

  assert.equal(failedWrite.checkpointIntents[0].status, "pending");
  assert.equal(failedWrite.checkpointIntents[0].committable, false);
  assert.deepEqual(failedWrite.checkpointIntents[0].durableWriteResult, {
    writeId: "memory-write-1",
    committed: false,
  });

  const durableWriteResult = { writeId: "memory-write-2", committed: true };
  const committable = ingestElectricEventBatch([baseEvent({ offset: 11 })], {
    durableWriteResult,
  });

  assert.equal(committable.checkpointIntents[0].status, "committable");
  assert.equal(committable.checkpointIntents[0].committable, true);
  assert.deepEqual(
    committable.checkpointIntents[0].durableWriteResult,
    durableWriteResult,
  );
});

test("normalizes row timestamps and freezes returned ingestion contract", () => {
  const result = ingestElectricEventBatch([
    baseEvent({
      syncSource: undefined,
      type: "tool-call",
      eventType: undefined,
      observedAt: undefined,
      payload: { nested: { value: "safe" } },
    }),
  ], {
    syncSource: "electric-default",
    observedAt: "2026-05-02T00:00:00.000Z",
  });

  assert.deepEqual(result.rows[0], {
    agentId: "agent-1",
    syncSource: "electric-default",
    streamId: "hermes/session/123",
    offset: 1,
    eventType: "tool-call",
    payload: { nested: { value: "safe" } },
    observedAt: "2026-05-02T00:00:00.000Z",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows), true);
  assert.equal(Object.isFrozen(result.rows[0]), true);
  assert.equal(Object.isFrozen(result.rows[0].payload), true);
});

test("rejects non-string observedAt values", () => {
  assert.throws(
    () => ingestElectricEventBatch([baseEvent({ observedAt: 123 })]),
    /observedAt must be a string/,
  );
});
