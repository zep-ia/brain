import test from "node:test";
import assert from "node:assert/strict";

import {
  CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT,
  CONSOLIDATION_CHECKPOINT_REQUIRED_CURSOR_FIELDS,
  CONSOLIDATION_CHECKPOINT_SCHEMA,
  DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX,
  createConsolidationCheckpoint,
  createConsolidationCheckpointKey,
  createConsolidationCheckpointRecordName,
  deserializeConsolidationCheckpointEntry,
  persistConsolidationCheckpoint,
  persistCompletedConsolidationCheckpoint,
  readConsolidationCheckpoint,
  resolveConsolidationRpcChangeWindow,
  serializeConsolidationCheckpointEntry,
  serializeConsolidationCheckpointStorageRecord,
} from "../src/index.js";

const createCheckpointInput = (overrides = {}) => {
  const defaultCursor = {
    streamId: "channel:alpha",
    cursorToken: "cursor-42",
    sequence: 42,
    eventId: "evt-42",
    watermark: "2026-04-14T01:05:00Z",
  };
  const defaultProvenance = {
    source: "zepia-rpc",
    batchId: "batch-1",
  };

  return {
    agentId: "agent-007",
    syncSource: "zepia-rpc-delta",
    ...overrides,
    cursor: {
      ...defaultCursor,
      ...(overrides.cursor ?? {}),
    },
    consolidatedAt: "2026-04-14T01:10:00Z",
    runtimePhase: "idle",
    provenance: {
      ...defaultProvenance,
      ...(overrides.provenance ?? {}),
    },
  };
};

const createInMemoryConsolidationCheckpointStorage = (initialEntries = {}) => {
  const values = new Map(Object.entries(initialEntries));
  const reads = [];
  const writes = [];

  return {
    async read(request) {
      reads.push(request);

      return {
        ...request,
        found: values.has(request.key),
        value: values.has(request.key) ? values.get(request.key) : null,
      };
    },
    async write(request) {
      writes.push(request);
      values.set(request.key, request.value);

      return {
        ...request,
        written: true,
      };
    },
    getValue(key) {
      return values.get(key) ?? null;
    },
    getReads() {
      return [...reads];
    },
    getWrites() {
      return [...writes];
    },
  };
};

test("consolidation checkpoint contract derives a stable agent-scoped storage location", () => {
  const checkpoint = createConsolidationCheckpoint(
    createCheckpointInput({
      syncSource: "zepia/rpc-delta",
      cursor: {
        streamId: "channel:alpha/beta",
      },
    }),
  );
  const serializedEntry = serializeConsolidationCheckpointEntry(checkpoint);
  const storageRecord = serializeConsolidationCheckpointStorageRecord(checkpoint, {
    keyPrefix: "/offline/brain/checkpoints/",
  });

  assert.equal(
    CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.schemaId,
    "agent_brain_consolidation_checkpoint",
  );
  assert.equal(
    CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT.recordType,
    "consolidation_checkpoint",
  );
  assert.deepEqual(CONSOLIDATION_CHECKPOINT_REQUIRED_CURSOR_FIELDS, [
    "streamId",
    "cursorToken",
    "sequence",
    "eventId",
    "watermark",
  ]);
  assert.equal(
    DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX,
    "agent-brain/consolidation-checkpoints",
  );
  assert.equal(
    createConsolidationCheckpointRecordName(checkpoint),
    "zepia%2Frpc-delta--channel%3Aalpha%2Fbeta.json",
  );
  assert.equal(
    createConsolidationCheckpointKey(checkpoint, {
      keyPrefix: "/offline/brain/checkpoints/",
    }),
    "offline/brain/checkpoints/agent-007/zepia%2Frpc-delta--channel%3Aalpha%2Fbeta.json",
  );
  assert.equal(serializedEntry.schemaId, CONSOLIDATION_CHECKPOINT_SCHEMA.schemaId);
  assert.deepEqual(deserializeConsolidationCheckpointEntry(storageRecord), checkpoint);
  assert.deepEqual(JSON.parse(storageRecord.value), storageRecord.entry);
});

test("persistConsolidationCheckpoint stores and reloads the last successful RPC cursor across restarts", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const checkpointInput = createCheckpointInput();
  const expectedCheckpoint = createConsolidationCheckpoint(checkpointInput);
  const persisted = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: checkpointInput,
  });
  const restored = await readConsolidationCheckpoint({
    storageAdapter: storage,
    agentId: expectedCheckpoint.agentId,
    syncSource: expectedCheckpoint.syncSource,
    streamId: expectedCheckpoint.cursor.streamId,
  });

  assert.equal(persisted.status, "created");
  assert.equal(persisted.applied, true);
  assert.equal(restored.found, true);
  assert.deepEqual(restored.checkpoint, expectedCheckpoint);
  assert.deepEqual(restored.entry, persisted.entry);
  assert.equal(restored.serializedEntry, persisted.serializedEntry);
  assert.deepEqual(JSON.parse(storage.getValue(persisted.key)), persisted.entry);
  assert.equal(storage.getReads().length >= 2, true);
  assert.equal(storage.getWrites().length, 1);
});

test("persistConsolidationCheckpoint is idempotent for unchanged cursors and overwrites newer positions", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const initialInput = createCheckpointInput();
  const advancedInput = createCheckpointInput({
    cursor: {
      cursorToken: "cursor-44",
      sequence: 44,
      eventId: "evt-44",
      watermark: "2026-04-14T01:08:00Z",
    },
    consolidatedAt: "2026-04-14T01:12:00Z",
    provenance: {
      batchId: "batch-2",
    },
  });
  const seeded = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: initialInput,
  });
  const unchanged = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: initialInput,
  });
  const overwritten = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: advancedInput,
  });
  const reloaded = await readConsolidationCheckpoint({
    storageAdapter: storage,
    agentId: "agent-007",
    syncSource: "zepia-rpc-delta",
    streamId: "channel:alpha",
  });

  assert.equal(seeded.status, "created");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.applied, false);
  assert.equal(overwritten.status, "overwritten");
  assert.equal(overwritten.overwritten, true);
  assert.deepEqual(reloaded.checkpoint, createConsolidationCheckpoint(advancedInput));
  assert.deepEqual(JSON.parse(storage.getValue(overwritten.key)), overwritten.entry);
});

test("persistCompletedConsolidationCheckpoint advances the resume cursor only after a fully successful consolidation", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const checkpointInput = createCheckpointInput();
  const expectedCheckpoint = createConsolidationCheckpoint(checkpointInput);
  const persisted = await persistCompletedConsolidationCheckpoint({
    storageAdapter: storage,
    entry: checkpointInput,
    completion: {
      status: "completed",
      executedCount: 2,
      failedCount: 0,
      blockedCount: 0,
      results: [
        {
          status: "executed",
          output: {
            stageId: "young-generation-promotion",
            persistedStatus: "created",
          },
        },
        {
          status: "executed",
          output: {
            stageId: "archived-memory-review",
            status: "completed",
          },
        },
      ],
    },
  });
  const restored = await readConsolidationCheckpoint({
    storageAdapter: storage,
    agentId: expectedCheckpoint.agentId,
    syncSource: expectedCheckpoint.syncSource,
    streamId: expectedCheckpoint.cursor.streamId,
  });

  assert.equal(persisted.status, "created");
  assert.equal(persisted.applied, true);
  assert.equal(persisted.checkpointAdvanced, true);
  assert.equal(persisted.completionStatus, "completed");
  assert.equal(persisted.completionDeferredField, null);
  assert.equal(persisted.completionDeferredReason, null);
  assert.deepEqual(restored.checkpoint, expectedCheckpoint);
});

test("persistConsolidationCheckpoint leaves the previous checkpoint unchanged when batch execution completes with errors", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const initialInput = createCheckpointInput();
  const advancedInput = createCheckpointInput({
    cursor: {
      cursorToken: "cursor-44",
      sequence: 44,
      eventId: "evt-44",
      watermark: "2026-04-14T01:08:00Z",
    },
    consolidatedAt: "2026-04-14T01:12:00Z",
    provenance: {
      batchId: "batch-2",
    },
  });
  const seeded = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: initialInput,
  });
  const storedBefore = storage.getValue(seeded.key);
  const deferred = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: advancedInput,
    completion: {
      status: "completed-with-errors",
      executedCount: 1,
      failedCount: 1,
      blockedCount: 0,
      results: [
        {
          status: "executed",
        },
        {
          status: "failed",
        },
      ],
    },
  });
  const restored = await readConsolidationCheckpoint({
    storageAdapter: storage,
    agentId: "agent-007",
    syncSource: "zepia-rpc-delta",
    streamId: "channel:alpha",
  });

  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.applied, false);
  assert.equal(deferred.checkpointAdvanced, false);
  assert.equal(deferred.completionStatus, "completed-with-errors");
  assert.equal(deferred.completionDeferredField, "completion.status");
  assert.equal(deferred.completionDeferredReason, "completed-with-errors");
  assert.equal(storage.getValue(seeded.key), storedBefore);
  assert.deepEqual(restored.checkpoint, createConsolidationCheckpoint(initialInput));
  assert.equal(storage.getWrites().length, 1);
});

test("persistCompletedConsolidationCheckpoint leaves the previous checkpoint unchanged when consolidation only partially completes", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const initialInput = createCheckpointInput();
  const advancedInput = createCheckpointInput({
    cursor: {
      cursorToken: "cursor-45",
      sequence: 45,
      eventId: "evt-45",
      watermark: "2026-04-14T01:09:00Z",
    },
    consolidatedAt: "2026-04-14T01:13:00Z",
    provenance: {
      batchId: "batch-3",
    },
  });
  const seeded = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: initialInput,
  });
  const storedBefore = storage.getValue(seeded.key);
  const deferred = await persistCompletedConsolidationCheckpoint({
    storageAdapter: storage,
    entry: advancedInput,
    completion: {
      status: "completed",
      executedCount: 2,
      failedCount: 0,
      blockedCount: 0,
      results: [
        {
          status: "executed",
          output: {
            stageId: "young-generation-promotion",
            persistedStatus: "skipped",
            blockedReason: "hippocampus-boundary-rejected",
          },
        },
        {
          status: "executed",
          output: {
            stageId: "archived-memory-review",
            status: "completed",
          },
        },
      ],
    },
  });
  const restored = await readConsolidationCheckpoint({
    storageAdapter: storage,
    agentId: "agent-007",
    syncSource: "zepia-rpc-delta",
    streamId: "channel:alpha",
  });

  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.applied, false);
  assert.equal(deferred.checkpointAdvanced, false);
  assert.equal(deferred.completionStatus, "completed");
  assert.equal(
    deferred.completionDeferredField,
    "completion.results[0].output.persistedStatus",
  );
  assert.equal(deferred.completionDeferredReason, "skipped");
  assert.equal(storage.getValue(seeded.key), storedBefore);
  assert.deepEqual(restored.checkpoint, createConsolidationCheckpoint(initialInput));
  assert.equal(storage.getWrites().length, 1);
});

test("persistConsolidationCheckpoint rejects checkpoint regressions that move the resume cursor backward", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const latestInput = createCheckpointInput({
    cursor: {
      cursorToken: "cursor-44",
      sequence: 44,
      eventId: "evt-44",
      watermark: "2026-04-14T01:08:00Z",
    },
    consolidatedAt: "2026-04-14T01:12:00Z",
  });
  const latest = await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: latestInput,
  });
  const storedBefore = storage.getValue(latest.key);

  await assert.rejects(
    () =>
      persistConsolidationCheckpoint({
        storageAdapter: storage,
        entry: createCheckpointInput({
          cursor: {
            cursorToken: "cursor-43",
            sequence: 43,
            eventId: "evt-43",
            watermark: "2026-04-14T01:07:00Z",
          },
          consolidatedAt: "2026-04-14T01:13:00Z",
        }),
      }),
    /must not move checkpoint sequence backward/,
  );

  await assert.rejects(
    () =>
      persistConsolidationCheckpoint({
        storageAdapter: storage,
        entry: createCheckpointInput({
          cursor: {
            cursorToken: "cursor-45",
            sequence: 45,
            eventId: "evt-45",
            watermark: "2026-04-14T01:06:00Z",
          },
          consolidatedAt: "2026-04-14T01:14:00Z",
        }),
      }),
    /must not move checkpoint watermark backward/,
  );

  assert.equal(storage.getValue(latest.key), storedBefore);
});

test("resolveConsolidationRpcChangeWindow resumes from the persisted checkpoint and returns the next exact delta window", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const checkpointInput = createCheckpointInput();
  const latestCursor = {
    streamId: checkpointInput.cursor.streamId,
    cursorToken: "cursor-47",
    sequence: 47,
    eventId: "evt-47",
    watermark: "2026-04-14T01:11:00Z",
  };

  await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: checkpointInput,
  });

  const resolved = await resolveConsolidationRpcChangeWindow({
    storageAdapter: storage,
    agentId: checkpointInput.agentId,
    syncSource: checkpointInput.syncSource,
    streamId: checkpointInput.cursor.streamId,
    latestCursor,
  });

  assert.equal(resolved.checkpointFound, true);
  assert.equal(resolved.derivation, "resume-from-checkpoint");
  assert.deepEqual(resolved.checkpoint, createConsolidationCheckpoint(checkpointInput));
  assert.deepEqual(
    resolved.window.startExclusive,
    createConsolidationCheckpoint(checkpointInput).cursor,
  );
  assert.deepEqual(
    resolved.window.endInclusive,
    createConsolidationCheckpoint({
      ...checkpointInput,
      cursor: latestCursor,
      consolidatedAt: "2026-04-14T01:15:00Z",
    }).cursor,
  );
});

test("resolveConsolidationRpcChangeWindow deterministically bootstraps from stream origin when no checkpoint exists yet", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const latestCursor = {
    streamId: "channel:alpha",
    cursorToken: "cursor-7",
    sequence: 7,
    eventId: "evt-7",
    watermark: "2026-04-14T01:02:00Z",
  };
  const resolved = await resolveConsolidationRpcChangeWindow({
    storageAdapter: storage,
    agentId: "agent-007",
    syncSource: "zepia-rpc-delta",
    streamId: "channel:alpha",
    latestCursor,
  });

  assert.equal(resolved.checkpointFound, false);
  assert.equal(resolved.checkpoint, null);
  assert.equal(resolved.derivation, "bootstrap-from-stream-origin");
  assert.equal(resolved.window.startExclusive, null);
  assert.deepEqual(
    resolved.window.endInclusive,
    createConsolidationCheckpoint({
      ...createCheckpointInput(),
      cursor: latestCursor,
      consolidatedAt: "2026-04-14T01:03:00Z",
    }).cursor,
  );
});

test("resolveConsolidationRpcChangeWindow rejects end cursors that move behind the persisted checkpoint", async () => {
  const storage = createInMemoryConsolidationCheckpointStorage();
  const checkpointInput = createCheckpointInput();

  await persistConsolidationCheckpoint({
    storageAdapter: storage,
    entry: checkpointInput,
  });

  await assert.rejects(
    () =>
      resolveConsolidationRpcChangeWindow({
        storageAdapter: storage,
        agentId: checkpointInput.agentId,
        syncSource: checkpointInput.syncSource,
        streamId: checkpointInput.cursor.streamId,
        latestCursor: {
          streamId: checkpointInput.cursor.streamId,
          cursorToken: "cursor-41",
          sequence: 41,
          eventId: "evt-41",
          watermark: "2026-04-14T01:04:00Z",
        },
      }),
    /must not move the end sequence backward/,
  );
});
