import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
  LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA,
  LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
  LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
  LONG_TERM_MEMORY_PERSISTENCE_SCHEMA,
  LONG_TERM_MEMORY_RECORD_CONTRACT,
  MEMORY_NODE_KINDS,
  createOldGenerationNodeId,
  createLongTermMemory,
  createLongTermMemoryLogicalIdentity,
  createLongTermMemoryPersistenceKey,
  createLongTermMemoryPersistenceRecordName,
  serializeLongTermMemoryPersistenceStorageRecord,
  createConsolidationPromotionCandidate,
  createMemoryGraph,
  createOfflineBatchPlan,
  createRuntimePhase,
  deleteLongTermMemoryEntry,
  deserializeLongTermMemoryEntry,
  executeOfflineBatchPlan,
  evaluateConsolidationPromotionEligibility,
  isConsolidationPipelineAbortError,
  matchLongTermMemoryLogicalIdentity,
  planConsolidationPromotions,
  persistLongTermMemoryEntry,
  persistPromotionSelectionToLongTermMemory,
  restoreMemoryGraphFromStorage,
  rewritePromotionSelectionToLongTermMemoryEntry,
  saveOldGenerationGraphState,
  saveYoungGenerationGraphState,
  serializePromotionSelectionToLongTermMemoryEntry,
  serializeLongTermMemoryEntry,
} from "../src/index.js";
import { createCanonicalValidOldGenerationGraph } from "../examples/old-generation-graph-examples.js";
import {
  TEST_HIPPOCAMPUS_SECRETS,
  createShortTermSecretFixture,
} from "../test-support/hippocampus-secret-fixtures.js";

const createLongTermMemoryInput = (overrides = {}) => ({
  agentId: "agent-007",
  memoryId: "ltm-1",
  category: "semantic",
  content: "Legal review is required before launch.",
  summary: "Launch requires legal review.",
  confidence: 0.84,
  stabilizedAt: "2026-04-12T09:00:00Z",
  provenance: {
    source: "conversation",
    observedAt: "2026-04-12T09:00:00Z",
    evidence: ["turn-19"],
    actor: "assistant",
  },
  temporalContext: {
    firstObservedAt: "2026-04-12T08:58:00Z",
    lastObservedAt: "2026-04-12T09:00:00Z",
    stabilizedAt: "2026-04-12T09:00:00Z",
    consolidatedAt: "2026-04-12T09:00:00Z",
    lastAccessedAt: "2026-04-12T09:02:00Z",
    supersededAt: null,
  },
  salience: {
    score: 0.84,
    signals: {
      evidenceStrength: 0.9,
      recallPriority: 0.78,
    },
    lastEvaluatedAt: "2026-04-12T09:01:00Z",
    sourceEntryId: "importance-stm-1",
  },
  consolidationState: {
    status: "promoted",
    lastOperation: "promote",
    journalRecordId: "journal-1",
    policyVersion: "old-generation-v1",
    sourceMemoryIds: ["stm-1"],
    preservedIdentityFields: ["agentId", "persona", "role"],
    protectedFromIdentityPromotion: null,
  },
  ...overrides,
});

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

const createInactiveYoungMemory = (record, inactiveAt = "2026-04-12T10:04:00Z") => ({
  record,
  inactiveForRetrieval: true,
  masking: {
    maskedAt: inactiveAt,
    maskedBy: "offline-consolidation",
    reason: "queued-for-offline-consolidation",
  },
  lifecycle: {
    state: "inactive",
    inactiveAt,
    inactiveReason: "queued-for-offline-consolidation",
  },
});

const createPromotionSerializationFixture = ({
  sourceMemoryKind = MEMORY_NODE_KINDS.workingMemory,
  sourceMemory,
  candidateOverrides = {},
  planningRuntimePhase = "idle",
} = {}) => {
  const sourceCollection =
    sourceMemoryKind === MEMORY_NODE_KINDS.shortTermMemory
      ? "shortTermMemory"
      : "workingMemory";
  const memoryId =
    sourceMemory?.record?.memoryId ??
    sourceMemory?.memoryId ??
    candidateOverrides.sourceMemoryId ??
    "wm-promote-1";
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory:
      sourceCollection === "workingMemory"
        ? [
            sourceMemory ??
              createInactiveYoungMemory({
                memoryId,
                content: "Promote the verified rollout insight.",
                provenance: {
                  source: "conversation",
                  observedAt: "2026-04-12T10:00:00Z",
                  evidence: ["turn-42"],
                  actor: "assistant",
                },
              }),
          ]
        : [],
    shortTermMemory:
      sourceCollection === "shortTermMemory"
        ? [
            sourceMemory ??
              createInactiveYoungMemory({
                memoryId,
                content: "Promote the verified rollout insight.",
                provenance: {
                  source: "conversation",
                  observedAt: "2026-04-12T10:00:00Z",
                  evidence: ["turn-42"],
                  actor: "assistant",
                },
              }),
          ]
        : [],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase(planningRuntimePhase),
    candidates: [
      {
        candidateId: `promo-${memoryId}`,
        agentId: "agent-007",
        sourceMemoryId: memoryId,
        sourceMemoryKind,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: [`importance-${memoryId}`],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection,
              sourceRecordIds: [memoryId],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
        ...candidateOverrides,
      },
    ],
  });

  return {
    graph,
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration[sourceCollection][0],
  };
};

const assertPayloadsExcludeRawSecrets = (secretFixture, payloads) => {
  payloads.forEach(({ label, payload }) => {
    const serializedPayload = JSON.stringify(payload);

    secretFixture.rawSecretValues.forEach((secret) => {
      assert.equal(
        serializedPayload.includes(secret),
        false,
        `${label} leaked a raw secret value`,
      );
    });
  });
};

const createIneligiblePromotionSelection = ({
  candidateId,
  sourceMemoryId,
  sourceMemoryKind = MEMORY_NODE_KINDS.workingMemory,
  youngImportanceSignals,
  youngStabilitySignals,
}) => {
  const sourceCollection =
    sourceMemoryKind === MEMORY_NODE_KINDS.shortTermMemory
      ? "shortTermMemory"
      : "workingMemory";
  const candidate = createConsolidationPromotionCandidate({
    candidateId,
    agentId: "agent-007",
    sourceMemoryId,
    sourceMemoryKind,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection: "importanceIndex",
          sourceRecordIds: [`importance-${sourceMemoryId}`],
          signals: youngImportanceSignals,
        },
        stability: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection,
          sourceRecordIds: [sourceMemoryId],
          signals: youngStabilitySignals,
        },
      },
    },
  });

  return {
    candidate,
    evaluation: evaluateConsolidationPromotionEligibility(candidate),
    sourceCollection,
    targetMemoryId: null,
    targetNodeId: null,
  };
};

const createBoundaryRejectedPromotionFixture = ({
  sourceMemoryKind = MEMORY_NODE_KINDS.workingMemory,
  secretMemoryId = "sk-proj-1234567890abcdefghijklmnopqrstuvABCDE",
} = {}) => {
  const sourceCollection =
    sourceMemoryKind === MEMORY_NODE_KINDS.shortTermMemory
      ? "shortTermMemory"
      : "workingMemory";
  const candidate = createConsolidationPromotionCandidate({
    candidateId: `promo-${secretMemoryId}`,
    agentId: "agent-007",
    sourceMemoryId: secretMemoryId,
    sourceMemoryKind,
    targetMemoryId: null,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection: "importanceIndex",
          sourceRecordIds: [`importance-${secretMemoryId}`],
          signals: {
            taskRelevance: 0.92,
            userSpecificity: 0.88,
          },
        },
        stability: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection,
          sourceRecordIds: [secretMemoryId],
          signals: {
            repeatedRecall: 0.84,
            crossEpisodeConsistency: 0.81,
          },
        },
      },
    },
  });

  return {
    secretMemoryId,
    selection: {
      candidate,
      evaluation: evaluateConsolidationPromotionEligibility(candidate),
      sourceCollection,
      targetMemoryId: null,
      targetNodeId: null,
      outputMemoryId: secretMemoryId,
      outputNodeId: createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        "agent-007",
        secretMemoryId,
      ),
    },
    memory: createInactiveYoungMemory({
      memoryId: secretMemoryId,
      content: "Verified rollout insight that would otherwise be durable.",
      provenance: {
        source: "conversation",
        observedAt: "2026-04-12T10:00:00Z",
        evidence: ["turn-secret-42"],
        actor: "assistant",
      },
    }),
  };
};

const createInMemoryLongTermMemoryStorage = (initialEntries = {}) => {
  const values = new Map(Object.entries(initialEntries));
  const reads = [];
  const writes = [];
  const deletes = [];

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
    async delete(request) {
      deletes.push(request);
      const deleted = values.delete(request.key);
      return {
        ...request,
        deleted,
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
    getReads() {
      return [...reads];
    },
    getWrites() {
      return [...writes];
    },
    getDeletes() {
      return [...deletes];
    },
  };
};

const createStoredIdentityExpectation = (entry) => ({
  agentId: entry.metadata.agentId,
  memoryId: entry.content.memoryId,
  nodeId: entry.metadata.nodeId,
  logicalIdentityKey: createLongTermMemoryLogicalIdentity(entry).key,
});

const createWriteIntegrityExpectation = ({
  mode,
  existingEntry = null,
  existingSerializedEntry = null,
  nextEntry,
}) => ({
  mode,
  expectedExistingValue: existingSerializedEntry,
  expectedExistingIdentity:
    existingEntry === null
      ? null
      : createStoredIdentityExpectation(existingEntry),
  nextIdentity: createStoredIdentityExpectation(nextEntry),
});

const cloneSnapshot = (value) => JSON.parse(JSON.stringify(value));
const normalizeSavedGraphStateSnapshot = (snapshot) => {
  const clonedSnapshot = cloneSnapshot(snapshot);

  if (clonedSnapshot?.constructionMetadata?.savedAt) {
    clonedSnapshot.constructionMetadata.savedAt = "<normalized>";
  }

  return clonedSnapshot;
};

const assertPersistedPromotionStorageRecord = ({
  storedRecord,
  fixture,
  memoryId,
  category,
}) => {
  const evaluation = fixture.selection.evaluation;
  const expectedSignalScores = Object.fromEntries(
    Object.entries(evaluation.signalScores).filter(
      ([, signalValue]) =>
        typeof signalValue === "number" && Number.isFinite(signalValue),
    ),
  );

  assert.equal(storedRecord.schemaId, LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId);
  assert.equal(
    storedRecord.schemaVersion,
    LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version,
  );
  assert.equal(storedRecord.nodeKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.deepEqual(storedRecord.content, {
    memoryId,
    category,
    content: "Promote the verified rollout insight.",
    summary: "Promote the verified rollout insight.",
  });
  assert.equal(
    storedRecord.metadata.nodeId,
    `old/agent-007/long_term_memory/${memoryId}`,
  );
  assert.equal(storedRecord.metadata.agentId, "agent-007");
  assert.equal(storedRecord.metadata.confidence, evaluation.promotionScore);
  assert.deepEqual(storedRecord.metadata.provenance, {
    source: "conversation",
    observedAt: "2026-04-12T10:00:00.000Z",
    evidence: ["turn-42", `importance-${memoryId}`, memoryId],
    actor: "assistant",
  });
  assert.equal(storedRecord.metadata.stabilizedAt, evaluation.evaluatedAt);
  assert.deepEqual(storedRecord.metadata.temporalContext, {
    firstObservedAt: "2026-04-12T10:00:00.000Z",
    lastObservedAt: evaluation.evaluatedAt,
    stabilizedAt: evaluation.evaluatedAt,
    consolidatedAt: evaluation.evaluatedAt,
    lastAccessedAt: null,
    supersededAt: null,
  });
  assert.deepEqual(storedRecord.metadata.salience, {
    score: evaluation.promotionScore,
    signals: expectedSignalScores,
    signalCount: Object.keys(expectedSignalScores).length,
    lastEvaluatedAt: evaluation.evaluatedAt,
    sourceEntryId: `importance-${memoryId}`,
  });
  assert.deepEqual(storedRecord.metadata.consolidationState, {
    status: "promoted",
    lastOperation: "promote",
    journalRecordId: null,
    policyVersion: evaluation.policyVersion,
    sourceMemoryIds: [memoryId],
    preservedIdentityFields: evaluation.protectedIdentityFields,
    protectedFromIdentityPromotion: null,
  });
  assert.equal(storedRecord.metadata.learnedTrait, null);
};

test("long-term memory persistence contract publishes every required content and metadata field", () => {
  assert.equal(LONG_TERM_MEMORY_RECORD_CONTRACT.schemaId, "agent_brain_long_term_memory_entry");
  assert.equal(LONG_TERM_MEMORY_RECORD_CONTRACT.nodeKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.deepEqual(LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS, [
    "memoryId",
    "category",
    "content",
    "summary",
  ]);
  assert.deepEqual(LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS, [
    "nodeId",
    "agentId",
    "confidence",
    "provenance",
    "stabilizedAt",
    "temporalContext",
    "salience",
    "consolidationState",
  ]);
  assert.deepEqual(
    LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.fields.content.requiredFields,
    LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
  );
  assert.deepEqual(
    LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.fields.metadata.requiredFields,
    LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
  );
});

test("createLongTermMemoryPersistenceRecordName and key derive stable agent-scoped storage locations", () => {
  const entry = createLongTermMemoryInput({
    memoryId: "ltm:policy/1",
  });

  assert.equal(
    createLongTermMemoryPersistenceRecordName(entry),
    "ltm%3Apolicy%2F1.json",
  );
  assert.equal(
    createLongTermMemoryPersistenceKey(entry, {
      keyPrefix: "/offline/brain/records/",
    }),
    "offline/brain/records/agent-007/ltm%3Apolicy%2F1.json",
  );
});

test("serializeLongTermMemoryPersistenceStorageRecord converts an in-memory durable record into the storage adapter payload", () => {
  const memory = createLongTermMemory(
    createLongTermMemoryInput({
      memoryId: "ltm:policy/1",
    }),
  );
  const expectedEntry = serializeLongTermMemoryEntry(memory);

  assert.deepEqual(
    serializeLongTermMemoryPersistenceStorageRecord(memory, {
      keyPrefix: "/offline/brain/records/",
    }),
    {
      key: "offline/brain/records/agent-007/ltm%3Apolicy%2F1.json",
      keyPrefix: "offline/brain/records",
      recordName: "ltm%3Apolicy%2F1.json",
      agentId: "agent-007",
      memoryId: "ltm:policy/1",
      nodeId: expectedEntry.metadata.nodeId,
      contentType: "application/json",
      value: `${JSON.stringify(expectedEntry, null, 2)}\n`,
      entry: expectedEntry,
    },
  );
});

test("deserializeLongTermMemoryEntry reconstructs an in-memory durable record from storage adapter payloads", () => {
  const memory = createLongTermMemory(
    createLongTermMemoryInput({
      memoryId: "ltm-storage-load-1",
    }),
  );
  const storageRecord = serializeLongTermMemoryPersistenceStorageRecord(memory, {
    keyPrefix: "/offline/brain/records/",
  });
  const listEntry = {
    key: storageRecord.key,
    value: storageRecord.value,
  };
  const readResult = {
    ...storageRecord,
    found: true,
    value: storageRecord.value,
  };

  assert.deepEqual(deserializeLongTermMemoryEntry(storageRecord), memory);
  assert.deepEqual(deserializeLongTermMemoryEntry(listEntry), memory);
  assert.deepEqual(deserializeLongTermMemoryEntry(readResult), memory);
});

test("createMemoryGraph rebuilds old-generation long-term memory from storage.list records", () => {
  const storageRecord = serializeLongTermMemoryPersistenceStorageRecord(
    createLongTermMemoryInput({
      memoryId: "ltm-storage-graph-1",
      content: "Persisted rollout policy from storage adapter listing.",
      summary: "Persisted rollout policy.",
    }),
  );

  const graph = createMemoryGraph(createIdentity(), {
    longTermMemory: [
      {
        key: storageRecord.key,
        value: storageRecord.value,
      },
    ],
  });

  assert.equal(graph.oldGeneration.longTermMemory.length, 1);
  assert.deepEqual(
    graph.oldGeneration.longTermMemory[0],
    deserializeLongTermMemoryEntry(storageRecord),
  );
  assert.equal(
    graph.oldGeneration.longTermMemory[0].memoryId,
    "ltm-storage-graph-1",
  );
});

test("restoreMemoryGraphFromStorage reloads persisted long-term memories during session startup", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const serializedEntry = serializeLongTermMemoryEntry(
    createLongTermMemoryInput({
      memoryId: "ltm-session-restore-1",
      content: "Persist this durable policy across brain process restarts.",
      summary: "Durable policy survives restart.",
    }),
  );

  await persistLongTermMemoryEntry({
    storageAdapter: storage,
    entry: serializedEntry,
    runtimePhase: createRuntimePhase("idle"),
  });

  const restoredGraph = await restoreMemoryGraphFromStorage(createIdentity(), {
    storageAdapter: storage,
  });

  assert.equal(restoredGraph.oldGeneration.longTermMemory.length, 1);
  assert.deepEqual(
    restoredGraph.oldGeneration.longTermMemory[0],
    deserializeLongTermMemoryEntry(serializedEntry),
  );
  assert.equal(
    restoredGraph.oldGeneration.longTermMemory[0].memoryId,
    "ltm-session-restore-1",
  );
});

test("restoreMemoryGraphFromStorage reloads every long-term memory saved by a previous session when the same storage adapter is reused", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const sessionOneEntries = [
    serializeLongTermMemoryEntry(
      createLongTermMemoryInput({
        memoryId: "ltm-session-reinit-1",
        content: "Carry forward the customer escalation policy across sessions.",
        summary: "Escalation policy persists across sessions.",
      }),
    ),
    serializeLongTermMemoryEntry(
      createLongTermMemoryInput({
        memoryId: "ltm-session-reinit-2",
        content: "Carry forward the deployment rollback rule across sessions.",
        summary: "Rollback rule persists across sessions.",
      }),
    ),
  ];

  for (const entry of sessionOneEntries) {
    await persistLongTermMemoryEntry({
      storageAdapter: storage,
      entry,
      runtimePhase: createRuntimePhase("idle"),
    });
  }

  const restoredGraph = await restoreMemoryGraphFromStorage(createIdentity(), {
    storageAdapter: storage,
  });
  const restoredEntriesById = new Map(
    restoredGraph.oldGeneration.longTermMemory.map((entry) => [entry.memoryId, entry]),
  );

  assert.deepEqual(
    restoredGraph.oldGeneration.longTermMemory.map((entry) => entry.memoryId).sort(),
    ["ltm-session-reinit-1", "ltm-session-reinit-2"],
  );

  sessionOneEntries.forEach((entry) => {
    assert.deepEqual(
      restoredEntriesById.get(entry.content.memoryId),
      deserializeLongTermMemoryEntry(entry),
    );
  });
});

test("persistPromotionSelectionToLongTermMemory durable writes survive framework reinitialization with the same storage adapter", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture({
    sourceMemory: createInactiveYoungMemory({
      memoryId: "wm-session-reinit-1",
      content: "Promote this rollout decision into durable memory before restart.",
      provenance: {
        source: "conversation",
        observedAt: "2026-04-12T10:00:00Z",
        evidence: ["turn-session-reinit-1"],
        actor: "assistant",
      },
    }),
  });

  const sessionOneResult = await persistPromotionSelectionToLongTermMemory(
    fixture.graph,
    {
      storageAdapter: storage,
      selection: fixture.selection,
      runtimePhase: createRuntimePhase("idle"),
    },
  );
  const sessionTwoGraph = await restoreMemoryGraphFromStorage(createIdentity(), {
    storageAdapter: storage,
  });

  assert.equal(sessionOneResult.persisted.status, "created");
  assert.equal(sessionTwoGraph.oldGeneration.longTermMemory.length, 1);
  assert.deepEqual(
    sessionTwoGraph.oldGeneration.longTermMemory[0],
    sessionOneResult.promotedMemory,
  );
  assert.equal(
    sessionTwoGraph.oldGeneration.longTermMemory[0].memoryId,
    "wm-session-reinit-1",
  );
});

test("restoreMemoryGraphFromStorage requires storage.list support for startup restoration", async () => {
  await assert.rejects(
    restoreMemoryGraphFromStorage(createIdentity(), {
      storageAdapter: {
        async read(request) {
          return {
            ...request,
            found: false,
            value: null,
          };
        },
        async write(request) {
          return {
            ...request,
            written: true,
          };
        },
      },
    }),
    /must provide list\(request\) to restore persisted long-term memories/,
  );
});

test("serializeLongTermMemoryPersistenceStorageRecord emits only sanitized payloads for redactable secrets", () => {
  const secret = "sk-proj-1234567890abcdefghijklmnopqrstuvABCDE";
  const storageRecord = serializeLongTermMemoryPersistenceStorageRecord(
    createLongTermMemoryInput({
      memoryId: "ltm-secret-redacted",
      content: `Escalate only after reviewing token ${secret}.`,
      summary: `Escalation token ${secret} must stay out of durable storage.`,
    }),
  );

  assert.equal(storageRecord.entry.content.content.includes(secret), false);
  assert.equal(storageRecord.entry.content.summary.includes(secret), false);
  assert.ok(storageRecord.entry.content.content.includes("[REDACTED_SECRET]"));
  assert.ok(storageRecord.entry.content.summary.includes("[REDACTED_SECRET]"));
  assert.equal(storageRecord.value.includes(secret), false);
  assert.ok(storageRecord.value.includes("[REDACTED_SECRET]"));
});

test("serializeLongTermMemoryEntry emits a versioned content and metadata record", () => {
  const entry = serializeLongTermMemoryEntry(createLongTermMemoryInput());

  assert.equal(entry.schemaId, LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId);
  assert.equal(entry.schemaVersion, LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version);
  assert.equal(entry.nodeKind, MEMORY_NODE_KINDS.longTermMemory);
  assert.deepEqual(entry.content, {
    memoryId: "ltm-1",
    category: "semantic",
    content: "Legal review is required before launch.",
    summary: "Launch requires legal review.",
  });
  assert.equal(entry.metadata.nodeId, "old/agent-007/long_term_memory/ltm-1");
  assert.equal(entry.metadata.agentId, "agent-007");
  assert.equal(entry.metadata.confidence, 0.84);
  assert.equal(entry.metadata.stabilizedAt, "2026-04-12T09:00:00Z");
  assert.equal(entry.metadata.salience.signalCount, 2);
  assert.equal(entry.metadata.consolidationState.status, "promoted");
  assert.equal(entry.metadata.learnedTrait, null);
});

test("createLongTermMemoryLogicalIdentity keeps rerun matching stable while ignoring mutable metadata", () => {
  const firstIdentity = createLongTermMemoryLogicalIdentity(
    createLongTermMemoryInput({
      memoryId: "ltm-rerun-1",
      consolidationState: {
        status: "promoted",
        lastOperation: "promote",
        journalRecordId: "journal-1",
        policyVersion: "old-generation-v1",
        sourceMemoryIds: ["stm-2", "stm-1"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: null,
      },
    }),
  );
  const rerunIdentity = createLongTermMemoryLogicalIdentity(
    createLongTermMemoryInput({
      memoryId: "ltm-rerun-1",
      confidence: 0.97,
      stabilizedAt: "2026-04-12T10:30:00Z",
      provenance: {
        source: "offline-consolidation",
        observedAt: "2026-04-12T10:30:00Z",
        evidence: ["turn-20"],
        actor: "offline-consolidation",
      },
      salience: {
        score: 0.97,
        signals: {
          durableSalience: 0.97,
        },
        lastEvaluatedAt: "2026-04-12T10:30:00Z",
        sourceEntryId: "importance-rerun-1",
      },
      consolidationState: {
        status: "reinforced",
        lastOperation: "reinforce",
        journalRecordId: "journal-2",
        policyVersion: "old-generation-v2",
        sourceMemoryIds: ["stm-1", "stm-2"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: null,
      },
    }),
  );

  assert.equal(
    LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA.version,
    "1.0.0",
  );
  assert.equal(firstIdentity.key, rerunIdentity.key);
  assert.deepEqual(firstIdentity.lineageMemoryIds, ["stm-1", "stm-2"]);
  assert.equal(firstIdentity.stableMemoryId, "ltm-rerun-1");
  assert.equal(firstIdentity.learnedTraitLabel, null);
});

test("matchLongTermMemoryLogicalIdentity reports stable-id conflicts instead of merging them", () => {
  const existingDurableMemory = createLongTermMemory(
    createLongTermMemoryInput({
      memoryId: "ltm-existing",
      content: "Legal review is required before launch.",
      summary: "Launch requires legal review.",
      consolidationState: {
        status: "promoted",
        lastOperation: "promote",
        journalRecordId: "journal-existing",
        policyVersion: "old-generation-v1",
        sourceMemoryIds: ["wm-legal-review"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: null,
      },
    }),
  );

  const result = matchLongTermMemoryLogicalIdentity(
    [existingDurableMemory],
    {
      agentId: "agent-007",
      memoryId: "wm-legal-review",
      category: "semantic",
      content: "Legal review is required before launch.",
      summary: "Launch requires legal review.",
      sourceMemoryIds: ["wm-legal-review"],
    },
  );

  assert.equal(result.status, "conflicting-stable-memory-id");
  assert.equal(result.strategy, "logical-identity");
  assert.equal(result.matchCount, 1);
  assert.equal(result.matchedMemoryId, "ltm-existing");
  assert.equal(
    result.matchedNodeId,
    "old/agent-007/long_term_memory/ltm-existing",
  );
  assert.equal(result.matchedLogicalIdentity.stableMemoryId, "ltm-existing");
  assert.deepEqual(result.conflictingMemoryIds, ["ltm-existing"]);
});

test("persistLongTermMemoryEntry blocks writes outside caller-authorized idle windows", async () => {
  const storage = createInMemoryLongTermMemoryStorage();

  const result = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput(),
    runtimePhase: createRuntimePhase("active"),
    teamIdle: true,
    inactivitySuggestion: {
      inactivityMs: 60_000,
      idleThresholdMs: 15_000,
      note: "Heuristic detected no foreground activity.",
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.applied, false);
  assert.equal(result.overwritten, false);
  assert.equal(result.entry, null);
  assert.equal(result.serializedEntry, null);
  assert.equal(result.authorization.blockedReason, "runtime-phase-not-idle-window");
  assert.equal(storage.getWrites().length, 0);
});

test("persistLongTermMemoryEntry skips promotion serialization while runtime authorization is blocked", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture();

  const result = await persistLongTermMemoryEntry({
    storage,
    entry: {
      selection: fixture.selection,
      memory: {
        memoryId: "wm-promote-1",
      },
    },
    runtimePhase: createRuntimePhase("active"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.applied, false);
  assert.equal(result.entry, null);
  assert.equal(result.serializedEntry, null);
  assert.equal(storage.getWrites().length, 0);
});

test("persistLongTermMemoryEntry aborts default promotion persistence when immutable identity fields contain unredactable secrets", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createBoundaryRejectedPromotionFixture();

  await assert.rejects(
    () =>
      persistLongTermMemoryEntry({
        storage,
        entry: fixture,
        runtimePhase: createRuntimePhase("idle"),
      }),
    /contains unredactable secrets in immutable boundary fields/,
  );
  assert.equal(storage.getWrites().length, 0);
});

test("persistLongTermMemoryEntry aborts rewrite-route boundary rejections before any storage interaction", async () => {
  const fixture = createBoundaryRejectedPromotionFixture();
  const storageInteractions = {
    readCount: 0,
    writeCount: 0,
    listCount: 0,
  };

  await assert.rejects(
    () =>
      persistLongTermMemoryEntry({
        storage: {
          async read() {
            storageInteractions.readCount += 1;
            return null;
          },
          async write() {
            storageInteractions.writeCount += 1;
            return null;
          },
          async list() {
            storageInteractions.listCount += 1;
            return [];
          },
        },
        entry: {
          selection: fixture.selection,
          memory: fixture.memory,
          rewrittenEntry: {
            schemaId: LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.schemaId,
            schemaVersion: LONG_TERM_MEMORY_PERSISTENCE_SCHEMA.version,
            nodeKind: MEMORY_NODE_KINDS.longTermMemory,
            content: {
              memoryId: fixture.secretMemoryId,
              category: "semantic",
              content: "Rewritten durable insight that should never persist.",
              summary: "Rejected rewrite should never persist.",
            },
            metadata: {
              nodeId: fixture.selection.outputNodeId,
              agentId: fixture.selection.candidate.agentId,
              confidence: fixture.selection.evaluation.promotionScore,
              provenance: {
                source: "conversation",
                observedAt: "2026-04-12T10:00:00Z",
                evidence: ["turn-secret-42"],
                actor: "assistant",
              },
              stabilizedAt: fixture.selection.evaluation.evaluatedAt,
              temporalContext: {
                firstObservedAt: "2026-04-12T10:00:00Z",
                lastObservedAt: fixture.selection.evaluation.evaluatedAt,
                stabilizedAt: fixture.selection.evaluation.evaluatedAt,
                consolidatedAt: fixture.selection.evaluation.evaluatedAt,
                lastAccessedAt: null,
                supersededAt: null,
              },
              salience: {
                score: fixture.selection.evaluation.promotionScore,
                signals: fixture.selection.evaluation.signalScores,
                lastEvaluatedAt: fixture.selection.evaluation.evaluatedAt,
                sourceEntryId: `importance-${fixture.secretMemoryId}`,
              },
              consolidationState: {
                status: "promoted",
                lastOperation: "promote",
                journalRecordId: null,
                policyVersion: fixture.selection.evaluation.policyVersion,
                sourceMemoryIds: [fixture.secretMemoryId],
                preservedIdentityFields:
                  fixture.selection.evaluation.protectedIdentityFields,
                protectedFromIdentityPromotion: null,
              },
              learnedTrait: null,
            },
          },
        },
        runtimePhase: createRuntimePhase("idle"),
      }),
    /contains unredactable secrets in immutable boundary fields/,
  );

  assert.deepEqual(storageInteractions, {
    readCount: 0,
    writeCount: 0,
    listCount: 0,
  });
});

test("serializePromotionSelectionToLongTermMemoryEntry aborts when immutable boundary fields contain secrets", () => {
  const fixture = createBoundaryRejectedPromotionFixture();

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: fixture.selection,
        memory: fixture.memory,
      }),
    /contains unredactable secrets in immutable boundary fields/,
  );
});

test("persistLongTermMemoryEntry writes a canonical serialized record using the stable key", async () => {
  const storage = createInMemoryLongTermMemoryStorage();

  const result = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput(),
    runtimePhase: createRuntimePhase("idle"),
  });

  assert.equal(result.status, "created");
  assert.equal(result.applied, true);
  assert.equal(result.overwritten, false);
  assert.equal(
    result.key,
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/ltm-1.json`,
  );
  assert.equal(result.recordName, "ltm-1.json");
  assert.deepEqual(JSON.parse(storage.getValue(result.key)), result.entry);
  assert.deepEqual(storage.getReads()[0], {
    key: result.key,
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    recordName: "ltm-1.json",
    agentId: "agent-007",
    memoryId: "ltm-1",
    nodeId: "old/agent-007/long_term_memory/ltm-1",
  });
  assert.deepEqual(storage.getWrites()[0], {
    key: result.key,
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    recordName: "ltm-1.json",
    agentId: "agent-007",
    memoryId: "ltm-1",
    nodeId: "old/agent-007/long_term_memory/ltm-1",
    contentType: "application/json",
    value: result.serializedEntry,
    entry: result.entry,
    overwrite: false,
    integrity: {
      mode: "create",
      expectedExistingValue: null,
      expectedExistingIdentity: null,
      nextIdentity: {
        agentId: "agent-007",
        memoryId: "ltm-1",
        nodeId: "old/agent-007/long_term_memory/ltm-1",
        logicalIdentityKey: createLongTermMemoryLogicalIdentity(result.entry).key,
      },
    },
  });
});

test("persistLongTermMemoryEntry forwards only sanitized durable payloads to storage.write", async () => {
  const secret = "sk-proj-1234567890abcdefghijklmnopqrstuvABCDE";
  const values = new Map();
  let writtenRequest = null;

  const result = await persistLongTermMemoryEntry({
    storage: {
      async read(request) {
        return {
          ...request,
          found: values.has(request.key),
          value: values.get(request.key) ?? null,
        };
      },
      async write(request) {
        writtenRequest = request;
        values.set(request.key, request.value);
        return {
          ...request,
          written: true,
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
    },
    entry: createLongTermMemoryInput({
      memoryId: "ltm-storage-redacted",
      content: `Escalate only after reviewing token ${secret}.`,
      summary: `Escalation token ${secret} must stay out of durable storage.`,
    }),
    runtimePhase: createRuntimePhase("idle"),
  });

  assert.equal(result.status, "created");
  assert.ok(writtenRequest);
  assert.equal(writtenRequest.entry.content.content.includes(secret), false);
  assert.equal(writtenRequest.entry.content.summary.includes(secret), false);
  assert.ok(writtenRequest.entry.content.content.includes("[REDACTED_SECRET]"));
  assert.ok(writtenRequest.entry.content.summary.includes("[REDACTED_SECRET]"));
  assert.equal(writtenRequest.value.includes(secret), false);
  assert.ok(writtenRequest.value.includes("[REDACTED_SECRET]"));
});

test("deleteLongTermMemoryEntry removes the canonical durable record through storage.delete", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput({
      memoryId: "ltm-delete-1",
      content: "This durable record should be pruned from persisted storage.",
      summary: "Prune this durable record.",
    }),
    runtimePhase: createRuntimePhase("idle"),
  });

  const deleted = await deleteLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput({
      memoryId: "ltm-delete-1",
      content: "This durable record should be pruned from persisted storage.",
      summary: "Prune this durable record.",
    }),
    runtimePhase: createRuntimePhase("sleep"),
  });

  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.applied, true);
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.entry, persisted.entry);
  assert.equal(storage.getValue(persisted.key), null);
  assert.deepEqual(storage.getDeletes()[0], {
    key: persisted.key,
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    recordName: "ltm-delete-1.json",
    agentId: "agent-007",
    memoryId: "ltm-delete-1",
    nodeId: "old/agent-007/long_term_memory/ltm-delete-1",
    integrity: {
      expectedExistingValue: persisted.serializedEntry.trimEnd(),
      expectedExistingIdentity: {
        agentId: "agent-007",
        memoryId: "ltm-delete-1",
        nodeId: "old/agent-007/long_term_memory/ltm-delete-1",
        logicalIdentityKey: createLongTermMemoryLogicalIdentity(persisted.entry).key,
      },
    },
  });
});

test("persistLongTermMemoryEntry is idempotent when the stored entry already matches", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const input = createLongTermMemoryInput();

  const created = await persistLongTermMemoryEntry({
    storage,
    entry: input,
    runtimePhase: createRuntimePhase("idle"),
  });
  const unchanged = await persistLongTermMemoryEntry({
    storage,
    entry: input,
    runtimePhase: createRuntimePhase("sleep"),
  });

  assert.equal(created.status, "created");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.applied, false);
  assert.equal(unchanged.overwritten, false);
  assert.equal(storage.getWrites().length, 1);
});

test("persistLongTermMemoryEntry upserts a matching durable identity without explicit overwrite", async () => {
  const storage = createInMemoryLongTermMemoryStorage();

  await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput(),
    runtimePhase: createRuntimePhase("idle"),
  });

  const upserted = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput({
      summary: "Updated summary after offline reinforcement.",
      salience: {
        score: 0.91,
        signals: {
          evidenceStrength: 0.94,
          recallPriority: 0.88,
        },
        lastEvaluatedAt: "2026-04-12T09:05:00Z",
        sourceEntryId: "importance-stm-1",
      },
    }),
    runtimePhase: createRuntimePhase("idle"),
  });

  assert.equal(upserted.status, "overwritten");
  assert.equal(upserted.applied, true);
  assert.equal(upserted.overwritten, true);
  assert.equal(
    JSON.parse(storage.getValue(upserted.key)).content.summary,
    "Updated summary after offline reinforcement.",
  );
  assert.equal(storage.getWrites().length, 2);
  assert.equal(storage.getWrites()[1].overwrite, true);
  assert.deepEqual(
    storage.getWrites()[1].integrity,
    createWriteIntegrityExpectation({
      mode: "replace",
      existingEntry: storage.getWrites()[0].entry,
      existingSerializedEntry: storage.getWrites()[0].value,
      nextEntry: upserted.entry,
    }),
  );
});

test("persistLongTermMemoryEntry restores the previous durable entry when overwrite verification fails", async () => {
  const values = new Map();
  const reads = [];
  const writes = [];
  const storage = {
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

      if (request.integrity?.mode === "replace") {
        values.set(request.key, "{\"broken\"");
        return {
          ...request,
          written: true,
        };
      }

      values.set(request.key, request.value);
      return {
        ...request,
        written: true,
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
    getReads() {
      return [...reads];
    },
    getWrites() {
      return [...writes];
    },
  };

  const seeded = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput(),
    runtimePhase: createRuntimePhase("idle"),
  });

  await assert.rejects(
    () =>
      persistLongTermMemoryEntry({
        storage,
        entry: createLongTermMemoryInput({
          summary: "Corrupted overwrite attempt.",
        }),
        runtimePhase: createRuntimePhase("sleep"),
      }),
    /previous durable entry was restored/,
  );

  assert.equal(storage.getWrites().length, 3);
  assert.equal(storage.getWrites()[1].integrity.mode, "replace");
  assert.equal(storage.getWrites()[2].integrity.mode, "rollback");
  assert.equal(storage.getWrites()[2].overwrite, true);
  assert.equal(
    storage.getWrites()[2].integrity.expectedExistingValue,
    "{\"broken\"",
  );
  assert.deepEqual(JSON.parse(storage.getValue(seeded.key)), seeded.entry);
});

test("persistLongTermMemoryEntry rejects logical-identity conflicts instead of inserting a second durable record", async () => {
  const storage = createInMemoryLongTermMemoryStorage();

  await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput({
      memoryId: "ltm-existing",
      consolidationState: {
        status: "promoted",
        lastOperation: "promote",
        journalRecordId: "journal-existing",
        policyVersion: "old-generation-v1",
        sourceMemoryIds: ["wm-legal-review"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: null,
      },
    }),
    runtimePhase: createRuntimePhase("idle"),
  });

  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage,
      entry: createLongTermMemoryInput({
        memoryId: "wm-legal-review",
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "journal-new",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-legal-review"],
          preservedIdentityFields: ["agentId", "persona"],
          protectedFromIdentityPromotion: null,
        },
      }),
      runtimePhase: createRuntimePhase("sleep"),
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.match(
    abortError.message,
    /cannot remap canonical memoryId "wm-legal-review" to deduplication winner "ltm-existing"/,
  );
  assert.equal(abortError.abort.stage, "deduplication");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(
    abortError.abort.attemptedField,
    "matchedStoredEntry.content.memoryId",
  );
  assert.equal(abortError.abort.expectedValue, "wm-legal-review");
  assert.equal(abortError.abort.actualValue, "ltm-existing");
  assert.equal(storage.getWrites().length, 1);
  assert.equal(
    storage.getValue(
      `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/wm-legal-review.json`,
    ),
    null,
  );
});

test("persistLongTermMemoryEntry aborts identity-altering deduplication without changing canonical ownership or persisted state", async () => {
  const storage = createInMemoryLongTermMemoryStorage();

  const seeded = await persistLongTermMemoryEntry({
    storage,
    entry: createLongTermMemoryInput({
      memoryId: "ltm-canonical-owner",
      consolidationState: {
        status: "promoted",
        lastOperation: "promote",
        journalRecordId: "journal-existing",
        policyVersion: "old-generation-v1",
        sourceMemoryIds: ["wm-identity-source"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: null,
      },
    }),
    runtimePhase: createRuntimePhase("idle"),
  });
  const canonicalKey = seeded.key;
  const canonicalValueBefore = storage.getValue(canonicalKey);
  const persistedStateBefore = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });

  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage,
      entry: createLongTermMemoryInput({
        memoryId: "wm-identity-source",
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "journal-new",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-identity-source"],
          preservedIdentityFields: ["agentId", "persona"],
          protectedFromIdentityPromotion: null,
        },
      }),
      runtimePhase: createRuntimePhase("sleep"),
    });
  } catch (error) {
    abortError = error;
  }

  const conflictingKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/wm-identity-source.json`;
  const persistedStateAfter = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.match(
    abortError.message,
    /cannot remap canonical memoryId "wm-identity-source" to deduplication winner "ltm-canonical-owner"/,
  );
  assert.equal(abortError.abort.reason, "canonical-id-mutation");
  assert.equal(abortError.abort.stage, "deduplication");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(
    abortError.abort.attemptedField,
    "matchedStoredEntry.content.memoryId",
  );
  assert.equal(abortError.abort.expectedValue, "wm-identity-source");
  assert.equal(abortError.abort.actualValue, "ltm-canonical-owner");
  assert.equal(storage.getWrites().length, 1);
  assert.equal(storage.getValue(canonicalKey), canonicalValueBefore);
  assert.deepEqual(
    JSON.parse(storage.getValue(canonicalKey)),
    seeded.entry,
  );
  assert.equal(storage.getValue(conflictingKey), null);
  assert.deepEqual(persistedStateAfter, persistedStateBefore);
});

test("promotion pipeline persists a newly promoted durable record without changing the source memory id", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture();
  const entry = serializePromotionSelectionToLongTermMemoryEntry(fixture);

  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry,
    runtimePhase: createRuntimePhase("idle"),
  });

  assert.equal(persisted.status, "created");
  assert.equal(entry.content.memoryId, fixture.selection.candidate.sourceMemoryId);
  assert.equal(persisted.memoryId, fixture.selection.candidate.sourceMemoryId);
  assert.equal(
    persisted.nodeId,
    `old/agent-007/long_term_memory/${fixture.selection.candidate.sourceMemoryId}`,
  );
  assert.equal(
    JSON.parse(storage.getValue(persisted.key)).content.memoryId,
    fixture.selection.candidate.sourceMemoryId,
  );
});

test("persistPromotionSelectionToLongTermMemory wires promotion creation through storageAdapter and returns the updated graph", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture();

  const result = await persistPromotionSelectionToLongTermMemory(
    fixture.graph,
    {
      storageAdapter: storage,
      selection: fixture.selection,
      runtimePhase: createRuntimePhase("idle"),
    },
  );

  assert.equal(result.persisted.status, "created");
  assert.equal(result.persisted.applied, true);
  assert.equal(result.promotedMemory?.memoryId, fixture.selection.outputMemoryId);
  assert.equal(result.nextGraph.oldGeneration.longTermMemory.length, 1);
  assert.equal(
    result.nextGraph.oldGeneration.longTermMemory[0].memoryId,
    fixture.selection.outputMemoryId,
  );
  assert.equal(storage.getWrites().length, 1);
  assert.equal(
    JSON.parse(storage.getValue(result.persisted.key)).content.memoryId,
    fixture.selection.candidate.sourceMemoryId,
  );
});

test("persistPromotionSelectionToLongTermMemory persists durable rewrites for existing long-term memories through storageAdapter", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content: "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-existing-1",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
      }),
    ],
  });

  const seeded = await persistLongTermMemoryEntry({
    storage,
    entry: graph.oldGeneration.longTermMemory[0],
    runtimePhase: createRuntimePhase("idle"),
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-existing-1",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });
  const rewrittenEntry = rewritePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.workingMemory[0],
    rewrittenEntry: {
      ...graph.oldGeneration.longTermMemory[0],
      content: "Reinforced rollout insight after offline merge.",
      summary: "Reinforced rollout insight after offline merge.",
      confidence: 0.97,
      stabilizedAt: "2026-04-12T10:15:00Z",
      temporalContext: {
        ...graph.oldGeneration.longTermMemory[0].temporalContext,
        lastObservedAt: "2026-04-12T10:15:00Z",
        stabilizedAt: "2026-04-12T10:15:00Z",
        consolidatedAt: "2026-04-12T10:15:00Z",
        lastAccessedAt: "2026-04-12T10:16:00Z",
      },
      salience: {
        ...graph.oldGeneration.longTermMemory[0].salience,
        score: 0.97,
        signals: {
          evidenceStrength: 0.95,
          recallPriority: 0.93,
        },
        lastEvaluatedAt: "2026-04-12T10:15:00Z",
        sourceEntryId: "importance-wm-existing-1",
      },
      consolidationState: {
        ...graph.oldGeneration.longTermMemory[0].consolidationState,
        status: "reinforced",
        lastOperation: "reinforce",
        journalRecordId: "journal-2",
        sourceMemoryIds: ["wm-existing-1"],
      },
    },
  });

  const result = await persistPromotionSelectionToLongTermMemory(graph, {
    storageAdapter: storage,
    selection: plan.selectedPromotions[0],
    rewrittenEntry,
    runtimePhase: createRuntimePhase("sleep"),
  });
  const storedEntry = JSON.parse(storage.getValue(result.persisted.key));

  assert.equal(seeded.key, result.persisted.key);
  assert.equal(result.persisted.status, "overwritten");
  assert.equal(result.persisted.applied, true);
  assert.equal(result.persisted.overwritten, true);
  assert.equal(storage.getWrites().length, 2);
  assert.equal(storage.getWrites()[1]?.integrity?.mode, "replace");
  assert.equal(result.promotedMemory?.memoryId, "wm-existing-1");
  assert.equal(
    result.promotedMemory?.summary,
    "Reinforced rollout insight after offline merge.",
  );
  assert.equal(result.nextGraph.oldGeneration.longTermMemory.length, 1);
  assert.equal(
    result.nextGraph.oldGeneration.longTermMemory[0].memoryId,
    "wm-existing-1",
  );
  assert.equal(
    result.nextGraph.oldGeneration.longTermMemory[0].summary,
    "Reinforced rollout insight after offline merge.",
  );
  assert.equal(storedEntry.content.memoryId, "wm-existing-1");
  assert.equal(
    storedEntry.content.summary,
    "Reinforced rollout insight after offline merge.",
  );
  assert.equal(storedEntry.metadata.consolidationState.status, "reinforced");
});

test("promotion persistence keeps canonical lineage references in the durable write integrity record", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    candidateOverrides: {
      sourceMemoryId: "stm-reference-stable-1",
      sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    },
    planningRuntimePhase: "sleep",
  });
  const entry = serializePromotionSelectionToLongTermMemoryEntry(fixture);

  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry: {
      selection: fixture.selection,
      memory: fixture.memory,
    },
    runtimePhase: createRuntimePhase("sleep"),
  });

  const write = storage.getWrites()[0];
  const logicalIdentity = createLongTermMemoryLogicalIdentity(entry);

  assert.equal(persisted.status, "created");
  assert.equal(write.memoryId, fixture.selection.candidate.sourceMemoryId);
  assert.equal(write.nodeId, fixture.selection.outputNodeId);
  assert.deepEqual(entry.metadata.consolidationState.sourceMemoryIds, [
    fixture.selection.candidate.sourceMemoryId,
  ]);
  assert.deepEqual(logicalIdentity.lineageMemoryIds, [
    fixture.selection.candidate.sourceMemoryId,
  ]);
  assert.deepEqual(write.integrity, {
    mode: "create",
    expectedExistingValue: null,
    expectedExistingIdentity: null,
    nextIdentity: createStoredIdentityExpectation(entry),
  });
});

test("promotion pipeline promotes stable and important working-memory records into long-term memory during idle", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-stable-important-1",
    },
  });

  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry: {
      selection: fixture.selection,
      memory: fixture.memory,
    },
    runtimePhase: createRuntimePhase("idle"),
  });
  const storedEntry = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(persisted.key)),
  );

  assert.equal(fixture.selection.sourceCollection, "workingMemory");
  assert.equal(fixture.selection.evaluation.eligible, true);
  assert.equal(fixture.selection.evaluation.decision, "promote");
  assert.equal(fixture.selection.evaluation.minimumPromotionScoreMet, true);
  assert.equal(
    fixture.selection.evaluation.criteriaBySignalPath["youngGeneration.importance"]
      .meetsThreshold,
    true,
  );
  assert.equal(
    fixture.selection.evaluation.criteriaBySignalPath["youngGeneration.stability"]
      .meetsThreshold,
    true,
  );
  assert.equal(persisted.status, "created");
  assert.equal(persisted.applied, true);
  assert.equal(persisted.authorization.runtimePhase.value, "idle");
  assert.equal(storedEntry.memoryId, "wm-stable-important-1");
  assert.equal(storedEntry.nodeId, "old/agent-007/long_term_memory/wm-stable-important-1");
  assert.equal(storedEntry.consolidationState.status, "promoted");
  assert.deepEqual(storedEntry.consolidationState.sourceMemoryIds, [
    "wm-stable-important-1",
  ]);
  assert.equal(storedEntry.salience.score, fixture.selection.evaluation.promotionScore);
});

test("promotion pipeline promotes stable and important short-term memories into long-term memory during sleep", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    candidateOverrides: {
      sourceMemoryId: "stm-stable-important-1",
    },
    planningRuntimePhase: "sleep",
  });

  const persisted = await persistLongTermMemoryEntry({
    storage,
    entry: {
      selection: fixture.selection,
      memory: fixture.memory,
    },
    runtimePhase: createRuntimePhase("sleep"),
  });
  const storedEntry = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(persisted.key)),
  );

  assert.equal(fixture.selection.sourceCollection, "shortTermMemory");
  assert.equal(fixture.selection.evaluation.eligible, true);
  assert.equal(fixture.selection.evaluation.decision, "promote");
  assert.equal(fixture.selection.evaluation.minimumPromotionScoreMet, true);
  assert.equal(
    fixture.selection.evaluation.criteriaBySignalPath["youngGeneration.importance"]
      .meetsThreshold,
    true,
  );
  assert.equal(
    fixture.selection.evaluation.criteriaBySignalPath["youngGeneration.stability"]
      .meetsThreshold,
    true,
  );
  assert.equal(persisted.status, "created");
  assert.equal(persisted.applied, true);
  assert.equal(persisted.authorization.runtimePhase.value, "sleep");
  assert.equal(storedEntry.memoryId, "stm-stable-important-1");
  assert.equal(storedEntry.nodeId, "old/agent-007/long_term_memory/stm-stable-important-1");
  assert.equal(storedEntry.consolidationState.status, "promoted");
  assert.deepEqual(storedEntry.consolidationState.sourceMemoryIds, [
    "stm-stable-important-1",
  ]);
  assert.equal(storedEntry.salience.score, fixture.selection.evaluation.promotionScore);
});

test("short-term promotion persistence never emits raw secret fixture values in promoted payloads", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const secretFixture = createShortTermSecretFixture({
    memoryId: "stm-secret-promoted-regression",
    observedAt: "2026-04-14T10:20:00Z",
    evidenceId: "turn-secret-promoted-regression",
  });
  const promotionFixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    sourceMemory: secretFixture.promotionShortTermMemory,
    candidateOverrides: {
      sourceMemoryId: secretFixture.memoryId,
      sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    },
    planningRuntimePhase: "sleep",
  });

  const result = await persistPromotionSelectionToLongTermMemory(
    promotionFixture.graph,
    {
      storageAdapter: storage,
      selection: promotionFixture.selection,
      runtimePhase: createRuntimePhase("sleep"),
    },
  );

  const persistedStorageValue = JSON.parse(result.persisted.serializedEntry);
  const storageWrite = storage.getWrites()[0];
  const promotedPayloads = [
    {
      label: "persisted entry",
      payload: result.persisted.entry,
    },
    {
      label: "persisted serialized entry",
      payload: persistedStorageValue,
    },
    {
      label: "storage write entry",
      payload: storageWrite.entry,
    },
    {
      label: "storage write value",
      payload: JSON.parse(storageWrite.value),
    },
    {
      label: "promoted memory",
      payload: result.promotedMemory,
    },
    {
      label: "next graph promoted memory",
      payload: result.nextGraph.oldGeneration.longTermMemory[0],
    },
  ];

  assert.equal(result.persisted.status, "created");
  assert.equal(result.promotedMemory?.memoryId, secretFixture.memoryId);
  assert.equal(
    result.persisted.entry.content.content,
    secretFixture.expectedSerializedLongTerm.content,
  );
  assert.equal(
    result.persisted.entry.content.summary,
    secretFixture.expectedSerializedLongTerm.summary,
  );
  assert.equal(
    result.persisted.entry.metadata.provenance.connection,
    secretFixture.expectedSerializedLongTerm.provenanceConnection,
  );
  assert.equal(
    result.promotedMemory?.content,
    secretFixture.expectedSerializedLongTerm.content,
  );
  assert.equal(
    result.promotedMemory?.summary,
    secretFixture.expectedSerializedLongTerm.summary,
  );
  assert.equal(
    result.promotedMemory?.provenance.connection,
    secretFixture.expectedSerializedLongTerm.provenanceConnection,
  );
  assertPayloadsExcludeRawSecrets(secretFixture, promotedPayloads);
});

test("promotion persistence redacts secret-bearing metadata evidence and importance artifacts", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const secretFixture = createShortTermSecretFixture({
    memoryId: "stm-secret-metadata-regression",
    observedAt: "2026-04-14T10:24:00Z",
    evidenceId: TEST_HIPPOCAMPUS_SECRETS.githubToken,
  });
  const promotionFixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    sourceMemory: secretFixture.promotionShortTermMemory,
    candidateOverrides: {
      sourceMemoryId: secretFixture.memoryId,
      sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
      signals: {
        youngGeneration: {
          importance: {
            capturedAt: "2026-04-14T10:25:00Z",
            sourceCollection: "importanceIndex",
            sourceRecordIds: [
              TEST_HIPPOCAMPUS_SECRETS.openAiApiKey,
              `importance-${secretFixture.memoryId}`,
            ],
            signals: {
              taskRelevance: 0.96,
              userSpecificity: 0.92,
            },
          },
          stability: {
            capturedAt: "2026-04-14T10:25:00Z",
            sourceCollection: "shortTermMemory",
            sourceRecordIds: [
              TEST_HIPPOCAMPUS_SECRETS.jwt,
              secretFixture.memoryId,
            ],
            signals: {
              repeatedRecall: 0.88,
              crossEpisodeConsistency: 0.85,
            },
          },
        },
      },
    },
    planningRuntimePhase: "sleep",
  });

  const result = await persistPromotionSelectionToLongTermMemory(
    promotionFixture.graph,
    {
      storageAdapter: storage,
      selection: promotionFixture.selection,
      runtimePhase: createRuntimePhase("sleep"),
    },
  );
  const persistedStorageValue = JSON.parse(result.persisted.serializedEntry);
  const storageWrite = storage.getWrites()[0];
  const metadataArtifacts = [
    {
      label: "persisted metadata",
      payload: result.persisted.entry.metadata,
    },
    {
      label: "persisted serialized metadata",
      payload: persistedStorageValue.metadata,
    },
    {
      label: "storage write metadata",
      payload: storageWrite.entry.metadata,
    },
    {
      label: "storage write serialized value",
      payload: storageWrite.value,
    },
  ];

  assert.equal(result.persisted.status, "created");
  assert.equal(
    result.persisted.entry.content.summary,
    secretFixture.expectedSerializedLongTerm.summary,
  );
  assert.equal(
    result.persisted.entry.metadata.provenance.connection,
    secretFixture.expectedSerializedLongTerm.provenanceConnection,
  );
  assert.ok(
    result.persisted.entry.metadata.provenance.evidence.some((value) =>
      value.includes(secretFixture.redactionPlaceholder),
    ),
  );
  assert.equal(
    result.persisted.entry.metadata.salience.sourceEntryId,
    secretFixture.redactionPlaceholder,
  );
  assert.equal(
    persistedStorageValue.metadata.salience.sourceEntryId,
    secretFixture.redactionPlaceholder,
  );
  assertPayloadsExcludeRawSecrets(secretFixture, metadataArtifacts);
});

test("old-generation graph persistence never emits raw secret fixture values in saved nodes or edges after promotion", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const baselineGraph = createCanonicalValidOldGenerationGraph();
  const secretFixture = createShortTermSecretFixture({
    memoryId: "stm-secret-graph-persistence-regression",
    observedAt: "2026-04-14T10:30:00Z",
    evidenceId: "turn-secret-graph-persistence-regression",
  });
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [],
    shortTermMemory: [secretFixture.promotionShortTermMemory],
    importanceIndex: [
      {
        entryId: `importance-${secretFixture.memoryId}`,
        agentId: "agent-007",
        memoryId: secretFixture.memoryId,
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          taskRelevance: 0.96,
          recency: 0.82,
        },
        lastUpdatedAt: "2026-04-14T10:30:00Z",
      },
    ],
    longTermMemory: baselineGraph.oldGeneration.longTermMemory,
    archivedMemory: baselineGraph.oldGeneration.archivedMemory,
    memoryEvidence: baselineGraph.oldGeneration.memoryEvidence,
    consolidationJournal: baselineGraph.oldGeneration.consolidationJournal,
    edges: baselineGraph.edges,
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [
      {
        candidateId: `promo-${secretFixture.memoryId}`,
        agentId: "agent-007",
        sourceMemoryId: secretFixture.memoryId,
        sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-14T10:31:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: [`importance-${secretFixture.memoryId}`],
              signals: {
                taskRelevance: 0.96,
                userSpecificity: 0.91,
              },
            },
            stability: {
              capturedAt: "2026-04-14T10:31:00Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: [secretFixture.memoryId],
              signals: {
                repeatedRecall: 0.87,
                crossEpisodeConsistency: 0.85,
              },
            },
          },
        },
      },
    ],
  });
  const result = await persistPromotionSelectionToLongTermMemory(graph, {
    storageAdapter: storage,
    selection: plan.selectedPromotions[0],
    runtimePhase: createRuntimePhase("sleep"),
  });
  const savedOldGenerationState = saveOldGenerationGraphState(result.nextGraph);
  const promotedGraphMemory = savedOldGenerationState.oldGeneration.longTermMemory.find(
    (memory) => memory.memoryId === secretFixture.memoryId,
  );
  const persistedGraphPayloads = [
    {
      label: "saved old-generation nodes",
      payload: savedOldGenerationState.oldGeneration,
    },
    {
      label: "saved old-generation edges",
      payload: savedOldGenerationState.edges,
    },
  ];

  assert.equal(result.persisted.status, "created");
  assert.ok(promotedGraphMemory);
  assert.ok(savedOldGenerationState.edges.length > 0);
  assert.equal(
    promotedGraphMemory.content,
    secretFixture.expectedSerializedLongTerm.content,
  );
  assert.equal(
    promotedGraphMemory.summary,
    secretFixture.expectedSerializedLongTerm.summary,
  );
  assert.equal(
    promotedGraphMemory.provenance.connection,
    secretFixture.expectedSerializedLongTerm.provenanceConnection,
  );
  assertPayloadsExcludeRawSecrets(secretFixture, persistedGraphPayloads);
});

test("eligible promotion persistence stores the expected long-term content and metadata", async () => {
  const scenarios = [
    {
      memoryId: "wm-stored-payload-1",
      sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
      planningRuntimePhase: "idle",
      runtimePhase: "idle",
      category: "semantic",
    },
    {
      memoryId: "stm-stored-payload-1",
      sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
      planningRuntimePhase: "sleep",
      runtimePhase: "sleep",
      category: "episodic",
    },
  ];

  for (const scenario of scenarios) {
    const storage = createInMemoryLongTermMemoryStorage();
    const fixture = createPromotionSerializationFixture({
      sourceMemoryKind: scenario.sourceMemoryKind,
      candidateOverrides: {
        sourceMemoryId: scenario.memoryId,
      },
      planningRuntimePhase: scenario.planningRuntimePhase,
    });

    const persisted = await persistLongTermMemoryEntry({
      storage,
      entry: {
        selection: fixture.selection,
        memory: fixture.memory,
      },
      runtimePhase: createRuntimePhase(scenario.runtimePhase),
    });
    const storedRecord = JSON.parse(storage.getValue(persisted.key));

    assert.equal(persisted.status, "created");
    assert.equal(persisted.applied, true);
    assert.deepEqual(storedRecord, persisted.entry);
    assertPersistedPromotionStorageRecord({
      storedRecord,
      fixture,
      memoryId: scenario.memoryId,
      category: scenario.category,
    });
  }
});

test("offline batch execution consolidates authorized young memories into old-generation storage during idle and sleep", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const idleFixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-batch-happy-path-1",
    },
    planningRuntimePhase: "idle",
  });
  const sleepFixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    candidateOverrides: {
      sourceMemoryId: "stm-batch-happy-path-1",
    },
    planningRuntimePhase: "sleep",
  });
  const plan = createOfflineBatchPlan({
    planId: "young-to-old-consolidation-happy-path",
    workUnits: [
      {
        workUnitId: "promote-working-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-happy-path-1"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: idleFixture.selection,
            memory: idleFixture.memory,
          },
        },
      },
      {
        workUnitId: "promote-short-term-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:stm-batch-happy-path-1"],
        runtimePhase: "sleep",
        metadata: {
          entry: {
            selection: sleepFixture.selection,
            memory: sleepFixture.memory,
          },
        },
      },
    ],
  });

  const result = await executeOfflineBatchPlan(plan, {
    maxConcurrentWorkUnits: 1,
    async dispatchWorkUnit(workUnit, executionContext) {
      return persistLongTermMemoryEntry({
        storage,
        entry: workUnit.metadata.entry,
        runtimePhase: executionContext.runtimePhase,
        teamIdle: executionContext.authorization.teamIdle,
      });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.authorizationMode, "plan-runtime-phase");
  assert.equal(result.executedCount, 2);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(
    result.results.map((entry) => [entry.workUnitId, entry.runtimePhase, entry.status]),
    [
      ["promote-working-memory", "idle", "executed"],
      ["promote-short-term-memory", "sleep", "executed"],
    ],
  );
  assert.deepEqual(
    result.results.map((entry) => [
      entry.output.status,
      entry.output.authorization.runtimePhase.value,
    ]),
    [
      ["created", "idle"],
      ["created", "sleep"],
    ],
  );
  assert.equal(storage.getWrites().length, 2);

  const storedWorkingMemoryEntry = deserializeLongTermMemoryEntry(
    JSON.parse(
      storage.getValue(
        `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/wm-batch-happy-path-1.json`,
      ),
    ),
  );
  const storedShortTermMemoryEntry = deserializeLongTermMemoryEntry(
    JSON.parse(
      storage.getValue(
        `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/stm-batch-happy-path-1.json`,
      ),
    ),
  );

  assert.equal(storedWorkingMemoryEntry.memoryId, "wm-batch-happy-path-1");
  assert.equal(
    storedWorkingMemoryEntry.nodeId,
    "old/agent-007/long_term_memory/wm-batch-happy-path-1",
  );
  assert.equal(storedWorkingMemoryEntry.consolidationState.status, "promoted");
  assert.deepEqual(storedWorkingMemoryEntry.consolidationState.sourceMemoryIds, [
    "wm-batch-happy-path-1",
  ]);

  assert.equal(storedShortTermMemoryEntry.memoryId, "stm-batch-happy-path-1");
  assert.equal(
    storedShortTermMemoryEntry.nodeId,
    "old/agent-007/long_term_memory/stm-batch-happy-path-1",
  );
  assert.equal(storedShortTermMemoryEntry.consolidationState.status, "promoted");
  assert.deepEqual(storedShortTermMemoryEntry.consolidationState.sourceMemoryIds, [
    "stm-batch-happy-path-1",
  ]);
});

test("offline batch execution still promotes accepted candidates when rejected candidates fail the pipeline", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const acceptedFixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-batch-accepted-1",
    },
    planningRuntimePhase: "idle",
  });
  const rejectedSelection = createIneligiblePromotionSelection({
    candidateId: "promo-batch-rejected-1",
    sourceMemoryId: "wm-batch-rejected-1",
    youngImportanceSignals: {
      taskRelevance: 0.24,
      userSpecificity: 0.22,
    },
    youngStabilitySignals: {
      repeatedRecall: 0.88,
      crossEpisodeConsistency: 0.84,
    },
  });
  const acceptedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    "wm-batch-accepted-1.json";
  const rejectedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    "wm-batch-rejected-1.json";
  const plan = createOfflineBatchPlan({
    planId: "young-to-old-consolidation-rejected-candidate-guardrail",
    workUnits: [
      {
        workUnitId: "promote-accepted-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-accepted-1"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: acceptedFixture.selection,
            memory: acceptedFixture.memory,
          },
        },
      },
      {
        workUnitId: "promote-rejected-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-rejected-1"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: rejectedSelection,
            memory: {
              memoryId: "wm-batch-rejected-1",
              content: "Rejected low-salience note should never become durable.",
            },
          },
        },
      },
    ],
  });

  const result = await executeOfflineBatchPlan(plan, {
    maxConcurrentWorkUnits: 1,
    async dispatchWorkUnit(workUnit, executionContext) {
      return persistLongTermMemoryEntry({
        storage,
        entry: workUnit.metadata.entry,
        runtimePhase: executionContext.runtimePhase,
        teamIdle: executionContext.authorization.teamIdle,
      });
    },
  });

  const acceptedResult = result.results.find(
    (entry) => entry.workUnitId === "promote-accepted-memory",
  );
  const rejectedResult = result.results.find(
    (entry) => entry.workUnitId === "promote-rejected-memory",
  );
  const storedAcceptedEntry = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(acceptedKey)),
  );

  assert.equal(result.status, "completed-with-errors");
  assert.equal(result.executedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.ok(acceptedResult);
  assert.ok(rejectedResult);
  assert.equal(acceptedResult.status, "executed");
  assert.equal(acceptedResult.output.status, "created");
  assert.equal(acceptedResult.output.memoryId, "wm-batch-accepted-1");
  assert.equal(rejectedResult.status, "failed");
  assert.match(rejectedResult.error.message, /eligible promotion selection/);
  assert.equal(storage.getWrites().length, 1);
  assert.equal(storage.getValue(rejectedKey), null);
  assert.equal(storedAcceptedEntry.memoryId, "wm-batch-accepted-1");
  assert.equal(storedAcceptedEntry.consolidationState.status, "promoted");
});

test("offline batch execution rejects hippocampus boundary failures without partial long-term-memory writes", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const acceptedFixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-batch-boundary-safe-1",
    },
    planningRuntimePhase: "idle",
  });
  const rejectedFixture = createBoundaryRejectedPromotionFixture({
    secretMemoryId: "sk-proj-1234567890boundaryrejectabcdefghijklmnopQRST",
  });
  const acceptedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    "wm-batch-boundary-safe-1.json";
  const rejectedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    `${encodeURIComponent(rejectedFixture.secretMemoryId)}.json`;
  const plan = createOfflineBatchPlan({
    planId: "young-to-old-consolidation-boundary-rejection-guardrail",
    workUnits: [
      {
        workUnitId: "promote-safe-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-boundary-safe-1"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: acceptedFixture.selection,
            memory: acceptedFixture.memory,
          },
        },
      },
      {
        workUnitId: "promote-secret-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:boundary-rejected-secret"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: rejectedFixture.selection,
            memory: rejectedFixture.memory,
          },
        },
      },
    ],
  });

  const result = await executeOfflineBatchPlan(plan, {
    maxConcurrentWorkUnits: 1,
    async dispatchWorkUnit(workUnit, executionContext) {
      return persistLongTermMemoryEntry({
        storage,
        entry: workUnit.metadata.entry,
        runtimePhase: executionContext.runtimePhase,
        teamIdle: executionContext.authorization.teamIdle,
      });
    },
  });

  const safeResult = result.results.find(
    (entry) => entry.workUnitId === "promote-safe-memory",
  );
  const rejectedResult = result.results.find(
    (entry) => entry.workUnitId === "promote-secret-memory",
  );

  assert.equal(result.status, "completed-with-errors");
  assert.equal(result.executedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.equal(safeResult?.status, "executed");
  assert.equal(safeResult?.output.status, "created");
  assert.equal(rejectedResult?.status, "failed");
  assert.match(
    rejectedResult?.error.message ?? "",
    /contains unredactable secrets in immutable boundary fields/,
  );
  assert.deepEqual(
    storage.getWrites().map((request) => request.memoryId),
    ["wm-batch-boundary-safe-1"],
  );
  assert.ok(storage.getValue(acceptedKey));
  assert.equal(storage.getValue(rejectedKey), null);
});

test("offline batch execution never persists errored promotion candidates into long-term storage", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const acceptedFixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-batch-accepted-2",
    },
    planningRuntimePhase: "idle",
  });
  const erroredFixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-batch-error-1",
    },
    planningRuntimePhase: "idle",
  });
  const erroringStorage = {
    read: storage.read,
    write(request) {
      if (request.memoryId === "wm-batch-error-1") {
        throw new Error("forced long-term memory storage failure");
      }

      return storage.write(request);
    },
    list: storage.list,
  };
  const acceptedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    "wm-batch-accepted-2.json";
  const erroredKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/agent-007/` +
    "wm-batch-error-1.json";
  const plan = createOfflineBatchPlan({
    planId: "young-to-old-consolidation-error-candidate-guardrail",
    workUnits: [
      {
        workUnitId: "promote-accepted-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-accepted-2"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: acceptedFixture.selection,
            memory: acceptedFixture.memory,
          },
        },
      },
      {
        workUnitId: "promote-errored-memory",
        agentId: "agent-007",
        overwriteTargets: ["long-term-memory:wm-batch-error-1"],
        runtimePhase: "idle",
        metadata: {
          entry: {
            selection: erroredFixture.selection,
            memory: erroredFixture.memory,
          },
        },
      },
    ],
  });

  const result = await executeOfflineBatchPlan(plan, {
    maxConcurrentWorkUnits: 1,
    async dispatchWorkUnit(workUnit, executionContext) {
      return persistLongTermMemoryEntry({
        storage: erroringStorage,
        entry: workUnit.metadata.entry,
        runtimePhase: executionContext.runtimePhase,
        teamIdle: executionContext.authorization.teamIdle,
      });
    },
  });

  const acceptedResult = result.results.find(
    (entry) => entry.workUnitId === "promote-accepted-memory",
  );
  const erroredResult = result.results.find(
    (entry) => entry.workUnitId === "promote-errored-memory",
  );
  const storedAcceptedEntry = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(acceptedKey)),
  );

  assert.equal(result.status, "completed-with-errors");
  assert.equal(result.executedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.ok(acceptedResult);
  assert.ok(erroredResult);
  assert.equal(acceptedResult.status, "executed");
  assert.equal(acceptedResult.output.status, "created");
  assert.equal(acceptedResult.output.memoryId, "wm-batch-accepted-2");
  assert.equal(erroredResult.status, "failed");
  assert.match(
    erroredResult.error.message,
    /forced long-term memory storage failure/,
  );
  assert.equal(storage.getWrites().length, 1);
  assert.equal(storage.getValue(erroredKey), null);
  assert.equal(storedAcceptedEntry.memoryId, "wm-batch-accepted-2");
  assert.equal(storedAcceptedEntry.consolidationState.status, "promoted");
});

test("promotion reruns keep a single long-term memory entry for the same consolidation input", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const fixture = createPromotionSerializationFixture();
  const rerunInput = {
    selection: fixture.selection,
    memory: fixture.memory,
  };

  const created = await persistLongTermMemoryEntry({
    storage,
    entry: rerunInput,
    runtimePhase: createRuntimePhase("idle"),
  });
  const rerunDuringSleep = await persistLongTermMemoryEntry({
    storage,
    entry: rerunInput,
    runtimePhase: createRuntimePhase("sleep"),
  });
  const rerunDuringRest = await persistLongTermMemoryEntry({
    storage,
    entry: rerunInput,
    runtimePhase: createRuntimePhase("rest"),
  });
  const storedEntries = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });

  assert.equal(created.status, "created");
  assert.equal(rerunDuringSleep.status, "unchanged");
  assert.equal(rerunDuringSleep.applied, false);
  assert.equal(rerunDuringSleep.overwritten, false);
  assert.equal(rerunDuringSleep.key, created.key);
  assert.equal(rerunDuringRest.status, "unchanged");
  assert.equal(rerunDuringRest.applied, false);
  assert.equal(rerunDuringRest.overwritten, false);
  assert.equal(rerunDuringRest.key, created.key);
  assert.equal(storage.getWrites().length, 1);
  assert.equal(storedEntries.length, 1);
  assert.deepEqual(
    storedEntries.map(({ key }) => key),
    [created.key],
  );
  assert.equal(
    deserializeLongTermMemoryEntry(JSON.parse(storedEntries[0].value)).memoryId,
    fixture.selection.candidate.sourceMemoryId,
  );
});

test("duplicate-handled consolidation reruns preserve the surviving durable memory identity end to end", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      createInactiveYoungMemory({
        memoryId: "wm-rerun-stable-1",
        content: "Refresh the durable rollout recap from the parked source memory.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T10:10:00Z",
          evidence: ["turn-46"],
          actor: "assistant",
        },
      }),
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-rerun-stable-1",
        content: "Existing durable rollout recap.",
        summary: "Existing durable rollout recap.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-rerun-stable-1"],
          actor: "offline-consolidation",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "journal-existing-rerun",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-rerun-stable-1"],
          preservedIdentityFields: ["agentId", "persona"],
          protectedFromIdentityPromotion: null,
        },
      }),
    ],
  });

  const seeded = await persistLongTermMemoryEntry({
    storage,
    entry: graph.oldGeneration.longTermMemory[0],
    runtimePhase: createRuntimePhase("idle"),
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("sleep"),
    candidates: [
      {
        candidateId: "promo-rerun-stable-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-rerun-stable-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:15:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-rerun-stable-1"],
              signals: {
                taskRelevance: 0.93,
                userSpecificity: 0.89,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:15:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-rerun-stable-1"],
              signals: {
                repeatedRecall: 0.86,
                crossEpisodeConsistency: 0.82,
              },
            },
          },
        },
      },
    ],
  });
  const promotedEntry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.workingMemory[0],
  });
  const overwritten = await persistLongTermMemoryEntry({
    storage,
    entry: promotedEntry,
    overwrite: true,
    runtimePhase: createRuntimePhase("sleep"),
  });
  const storedEntries = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });
  const persisted = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(seeded.key)),
  );
  const overwriteIntegrity = storage.getWrites()[1]?.integrity ?? null;

  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(plan.deferredCount, 0);
  assert.equal(plan.selectedPromotions[0].candidate.targetMemoryId, "wm-rerun-stable-1");
  assert.equal(plan.selectedPromotions[0].targetMemoryId, "wm-rerun-stable-1");
  assert.equal(plan.selectedPromotions[0].outputMemoryId, "wm-rerun-stable-1");
  assert.equal(
    plan.selectedPromotions[0].targetNodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(
    plan.selectedPromotions[0].outputNodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(promotedEntry.content.memoryId, "wm-rerun-stable-1");
  assert.equal(
    promotedEntry.metadata.nodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(seeded.key, overwritten.key);
  assert.equal(overwritten.status, "overwritten");
  assert.equal(overwritten.memoryId, "wm-rerun-stable-1");
  assert.equal(
    overwritten.nodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(storage.getWrites().length, 2);
  assert.equal(overwriteIntegrity?.mode, "replace");
  assert.equal(
    overwriteIntegrity?.expectedExistingIdentity?.memoryId,
    "wm-rerun-stable-1",
  );
  assert.equal(
    overwriteIntegrity?.nextIdentity?.memoryId,
    "wm-rerun-stable-1",
  );
  assert.equal(
    overwriteIntegrity?.expectedExistingIdentity?.nodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(
    overwriteIntegrity?.nextIdentity?.nodeId,
    "old/agent-007/long_term_memory/wm-rerun-stable-1",
  );
  assert.equal(storedEntries.length, 1);
  assert.deepEqual(
    storedEntries.map(({ key }) => key),
    [seeded.key],
  );
  assert.equal(persisted.memoryId, "wm-rerun-stable-1");
  assert.equal(persisted.nodeId, "old/agent-007/long_term_memory/wm-rerun-stable-1");
  assert.equal(
    persisted.content,
    "Refresh the durable rollout recap from the parked source memory.",
  );
  assert.deepEqual(persisted.consolidationState.sourceMemoryIds, [
    "wm-rerun-stable-1",
  ]);
});

test("reinforcement merge pipeline overwrites the same durable record without changing its identity", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content: "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-existing-1",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
      }),
    ],
  });

  const seeded = await persistLongTermMemoryEntry({
    storage,
    entry: graph.oldGeneration.longTermMemory[0],
    runtimePhase: createRuntimePhase("idle"),
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-existing-1",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });
  const entry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.workingMemory[0],
    summary: "Reinforced rollout insight after offline merge.",
    consolidationState: {
      status: "reinforced",
      lastOperation: "reinforce",
      journalRecordId: "journal-2",
    },
  });

  const overwritten = await persistLongTermMemoryEntry({
    storage,
    entry,
    overwrite: true,
    runtimePhase: createRuntimePhase("sleep"),
  });
  const persisted = JSON.parse(storage.getValue(overwritten.key));

  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(seeded.key, overwritten.key);
  assert.equal(overwritten.status, "overwritten");
  assert.equal(entry.content.memoryId, "wm-existing-1");
  assert.equal(overwritten.memoryId, "wm-existing-1");
  assert.equal(overwritten.nodeId, "old/agent-007/long_term_memory/wm-existing-1");
  assert.equal(persisted.content.memoryId, "wm-existing-1");
  assert.equal(
    persisted.metadata.nodeId,
    "old/agent-007/long_term_memory/wm-existing-1",
  );
  assert.equal(
    persisted.content.summary,
    "Reinforced rollout insight after offline merge.",
  );
  assert.equal(persisted.metadata.consolidationState.status, "reinforced");
});

test("persistLongTermMemoryEntry rejects low-importance promotion selections before writing", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const selection = createIneligiblePromotionSelection({
    candidateId: "promo-low-importance",
    sourceMemoryId: "wm-low-importance",
    youngImportanceSignals: {
      taskRelevance: 0.3,
      userSpecificity: 0.35,
    },
    youngStabilitySignals: {
      repeatedRecall: 0.84,
      crossEpisodeConsistency: 0.81,
    },
  });

  assert.equal(selection.evaluation.eligible, false);
  assert.equal(
    selection.evaluation.criteriaBySignalPath["youngGeneration.importance"]
      .meetsThreshold,
    false,
  );
  assert.ok(
    selection.evaluation.blockedReasons.includes(
      "below-threshold-youngGeneration.importance",
    ),
  );

  await assert.rejects(
    () =>
      persistLongTermMemoryEntry({
        storage,
        entry: {
          selection,
          memory: {
            memoryId: "wm-low-importance",
            content: "Low-salience note.",
          },
        },
        runtimePhase: createRuntimePhase("idle"),
      }),
    /eligible promotion selection/,
  );
  assert.equal(storage.getWrites().length, 0);
});

test("persistLongTermMemoryEntry rejects low-stability promotion selections before writing", async () => {
  const storage = createInMemoryLongTermMemoryStorage();
  const selection = createIneligiblePromotionSelection({
    candidateId: "promo-low-stability",
    sourceMemoryId: "wm-low-stability",
    youngImportanceSignals: {
      taskRelevance: 0.91,
      userSpecificity: 0.87,
    },
    youngStabilitySignals: {
      repeatedRecall: 0.25,
      crossEpisodeConsistency: 0.2,
    },
  });

  assert.equal(selection.evaluation.eligible, false);
  assert.equal(
    selection.evaluation.criteriaBySignalPath["youngGeneration.stability"]
      .meetsThreshold,
    false,
  );
  assert.ok(
    selection.evaluation.blockedReasons.includes(
      "below-threshold-youngGeneration.stability",
    ),
  );

  await assert.rejects(
    () =>
      persistLongTermMemoryEntry({
        storage,
        entry: {
          selection,
          memory: {
            memoryId: "wm-low-stability",
            content: "Unstable note that should not reach durable memory.",
          },
        },
        runtimePhase: createRuntimePhase("idle"),
      }),
    /eligible promotion selection/,
  );
  assert.equal(storage.getWrites().length, 0);
});

test("serializePromotionSelectionToLongTermMemoryEntry rehydrates masked source content and derives persistence metadata", () => {
  const fixture = createPromotionSerializationFixture({
    sourceMemory: {
      record: {
        memoryId: "wm-masked-1",
        content: "[masked]",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:58:00Z",
          evidence: ["turn-40"],
          actor: "assistant",
        },
      },
      inactiveForRetrieval: true,
      masking: {
        isMasked: true,
        maskedOriginalContent: {
          value: "Promote the verified rollout insight.",
          sourceField: "content",
          capturedAt: "2026-04-12T10:04:00Z",
        },
      },
    },
    candidateOverrides: {
      sourceMemoryId: "wm-masked-1",
    },
  });

  const entry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  const delegatedEntry = serializeLongTermMemoryEntry(fixture);

  assert.deepEqual(entry, delegatedEntry);
  assert.equal(fixture.selection.targetMemoryId, null);
  assert.equal(fixture.selection.outputMemoryId, "wm-masked-1");
  assert.equal(
    fixture.selection.outputNodeId,
    "old/agent-007/long_term_memory/wm-masked-1",
  );
  assert.deepEqual(entry.content, {
    memoryId: "wm-masked-1",
    category: "semantic",
    content: "Promote the verified rollout insight.",
    summary: "Promote the verified rollout insight.",
  });
  assert.equal(entry.metadata.nodeId, "old/agent-007/long_term_memory/wm-masked-1");
  assert.equal(entry.metadata.agentId, "agent-007");
  assert.equal(
    entry.metadata.confidence,
    fixture.selection.evaluation.promotionScore,
  );
  assert.equal(
    entry.metadata.salience.score,
    fixture.selection.evaluation.promotionScore,
  );
  assert.equal(
    entry.metadata.salience.lastEvaluatedAt,
    fixture.selection.evaluation.evaluatedAt,
  );
  assert.equal(
    entry.metadata.consolidationState.policyVersion,
    fixture.selection.evaluation.policyVersion,
  );
  assert.deepEqual(entry.metadata.consolidationState.sourceMemoryIds, [
    "wm-masked-1",
  ]);
  assert.deepEqual(
    entry.metadata.consolidationState.preservedIdentityFields,
    fixture.selection.evaluation.protectedIdentityFields,
  );
  assert.deepEqual(entry.metadata.provenance.evidence, [
    "turn-40",
    "importance-wm-masked-1",
    "wm-masked-1",
  ]);
});

test("serializePromotionSelectionToLongTermMemoryEntry keeps learned traits protected from identity promotion", () => {
  const fixture = createPromotionSerializationFixture({
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    sourceMemory: createInactiveYoungMemory({
        memoryId: "stm-trait-1",
        category: "learned_trait",
        label: "evidence-seeking",
        content: "The agent waits for direct evidence before escalating.",
        summary: "Evidence-seeking learned trait.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          evidence: ["turn-21"],
        },
      }),
    candidateOverrides: {
      sourceMemoryId: "stm-trait-1",
      sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
      learnedTraitCandidate: true,
    },
  });

  const entry = serializePromotionSelectionToLongTermMemoryEntry(fixture);

  assert.equal(entry.content.category, "learned_trait");
  assert.equal(entry.metadata.learnedTrait.label, "evidence-seeking");
  assert.equal(entry.metadata.learnedTrait.protectedFromIdentityPromotion, true);
  assert.equal(
    entry.metadata.consolidationState.protectedFromIdentityPromotion,
    true,
  );
});

test("serializePromotionSelectionToLongTermMemoryEntry allows same-id target updates through consolidationState overrides", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content: "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-existing-1",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-existing-1",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.selectedPromotionCount, 1);

  const entry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.workingMemory[0],
    consolidationState: {
      status: "reinforced",
      lastOperation: "reinforce",
      journalRecordId: "journal-2",
    },
  });

  assert.equal(entry.content.memoryId, "wm-existing-1");
  assert.equal(
    entry.metadata.nodeId,
    "old/agent-007/long_term_memory/wm-existing-1",
  );
  assert.equal(entry.metadata.consolidationState.status, "reinforced");
  assert.equal(entry.metadata.consolidationState.lastOperation, "reinforce");
  assert.equal(entry.metadata.consolidationState.journalRecordId, "journal-2");
  assert.deepEqual(entry.metadata.consolidationState.sourceMemoryIds, [
    "wm-existing-1",
  ]);
});

test("serializePromotionSelectionToLongTermMemoryEntry rejects durable replacement records for same-id target updates", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content: "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-existing-1",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-existing-1",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.selectedPromotionCount, 1);

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: plan.selectedPromotions[0],
        memory: graph.oldGeneration.longTermMemory[0],
      }),
    /must describe the source young-generation memory and cannot include durable replacement fields/,
  );
});

test("serializePromotionSelectionToLongTermMemoryEntry rejects target memory replacements that rewrite the source memory id", () => {
  const fixture = createPromotionSerializationFixture();

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: {
          ...fixture.selection,
          candidate: {
            ...fixture.selection.candidate,
            targetMemoryId: "ltm-rewrite",
          },
          evaluation: {
            ...fixture.selection.evaluation,
            targetMemoryId: "ltm-rewrite",
          },
          targetMemoryId: "ltm-rewrite",
          targetNodeId: "old/agent-007/long_term_memory/ltm-rewrite",
        },
        memory: fixture.memory,
      }),
    /cannot rewrite source memoryId "wm-promote-1" to targetMemoryId "ltm-rewrite"/,
  );
});

test("promotion pipeline rejects caller tampering that rewrites the source memory id before persistence", () => {
  const fixture = createPromotionSerializationFixture();

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: {
          ...fixture.selection,
          candidate: {
            ...fixture.selection.candidate,
            targetMemoryId: "ltm-rewrite",
          },
          evaluation: {
            ...fixture.selection.evaluation,
            targetMemoryId: "ltm-rewrite",
          },
          targetMemoryId: "ltm-rewrite",
          targetNodeId: "old/agent-007/long_term_memory/ltm-rewrite",
        },
        memory: fixture.memory,
      }),
    /cannot rewrite source memoryId "wm-promote-1" to targetMemoryId "ltm-rewrite"/,
  );
});

test("serializePromotionSelectionToLongTermMemoryEntry rejects explicit output memory id rewrites", () => {
  const fixture = createPromotionSerializationFixture();

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        ...fixture,
        memoryId: "ltm-overridden",
      }),
    /cannot rewrite source memoryId "wm-promote-1" to output memoryId "ltm-overridden"/,
  );
});

test("rewritePromotionSelectionToLongTermMemoryEntry preserves canonical ids while allowing content rewrites", () => {
  const fixture = createPromotionSerializationFixture();
  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  const rewritten = rewritePromotionSelectionToLongTermMemoryEntry({
    selection: fixture.selection,
    memory: fixture.memory,
    rewrittenEntry: {
      ...canonicalEntry,
      content: {
        ...canonicalEntry.content,
        content: "Rewritten durable recap with clearer launch policy wording.",
        summary: "Rewritten durable recap.",
      },
      metadata: {
        ...canonicalEntry.metadata,
        confidence: 0.91,
      },
    },
  });

  assert.equal(rewritten.metadata.agentId, fixture.selection.candidate.agentId);
  assert.equal(rewritten.content.memoryId, fixture.selection.outputMemoryId);
  assert.equal(rewritten.metadata.nodeId, fixture.selection.outputNodeId);
  assert.equal(
    rewritten.content.content,
    "Rewritten durable recap with clearer launch policy wording.",
  );
  assert.equal(rewritten.content.summary, "Rewritten durable recap.");
});

test("rewritePromotionSelectionToLongTermMemoryEntry preserves lineage references when only mutable metadata changes", () => {
  const fixture = createPromotionSerializationFixture({
    candidateOverrides: {
      sourceMemoryId: "wm-reference-stable-1",
    },
  });
  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  const rewritten = rewritePromotionSelectionToLongTermMemoryEntry({
    selection: fixture.selection,
    memory: fixture.memory,
    rewrittenEntry: {
      ...canonicalEntry,
      metadata: {
        ...canonicalEntry.metadata,
        confidence: 0.97,
        provenance: {
          ...canonicalEntry.metadata.provenance,
          actor: "offline-consolidation",
        },
        salience: {
          ...canonicalEntry.metadata.salience,
          score: 0.97,
          lastEvaluatedAt: "2026-04-12T10:45:00Z",
        },
      },
    },
  });

  const canonicalIdentity = createLongTermMemoryLogicalIdentity(canonicalEntry);
  const rewrittenIdentity = createLongTermMemoryLogicalIdentity(rewritten);

  assert.equal(rewritten.content.memoryId, canonicalEntry.content.memoryId);
  assert.equal(rewritten.metadata.agentId, canonicalEntry.metadata.agentId);
  assert.equal(rewritten.metadata.nodeId, canonicalEntry.metadata.nodeId);
  assert.deepEqual(
    rewritten.metadata.consolidationState.sourceMemoryIds,
    canonicalEntry.metadata.consolidationState.sourceMemoryIds,
  );
  assert.deepEqual(
    rewrittenIdentity.lineageMemoryIds,
    canonicalIdentity.lineageMemoryIds,
  );
  assert.equal(rewrittenIdentity.key, canonicalIdentity.key);
});

[
  {
    name: "memoryId rewrites",
    attemptedField: "rewrittenEntry.content.memoryId",
    canonicalField: "memoryId",
    actualValue: "wm-rewritten",
    mutate: (entry) => ({
      ...entry,
      content: {
        ...entry.content,
        memoryId: "wm-rewritten",
      },
    }),
  },
  {
    name: "agent scope swaps",
    attemptedField: "rewrittenEntry.metadata.agentId",
    canonicalField: "agentId",
    actualValue: "agent-999",
    mutate: (entry) => ({
      ...entry,
      metadata: {
        ...entry.metadata,
        agentId: "agent-999",
      },
    }),
  },
  {
    name: "canonical node reassignments",
    attemptedField: "rewrittenEntry.metadata.nodeId",
    canonicalField: "nodeId",
    actualValue: "old/agent-007/long_term_memory/wm-reassigned",
    mutate: (entry) => ({
      ...entry,
      metadata: {
        ...entry.metadata,
        nodeId: "old/agent-007/long_term_memory/wm-reassigned",
      },
    }),
  },
].forEach(({ name, attemptedField, canonicalField, actualValue, mutate }) => {
  test(
    `rewritePromotionSelectionToLongTermMemoryEntry rejects ${name}`,
    () => {
      const fixture = createPromotionSerializationFixture();
      const canonicalEntry =
        serializePromotionSelectionToLongTermMemoryEntry(fixture);
      let abortError = null;

      try {
        rewritePromotionSelectionToLongTermMemoryEntry({
          selection: fixture.selection,
          memory: fixture.memory,
          rewrittenEntry: mutate(canonicalEntry),
        });
      } catch (error) {
        abortError = error;
      }

      assert.ok(isConsolidationPipelineAbortError(abortError));
      assert.equal(abortError.abort.stage, "rewrite");
      assert.equal(abortError.abort.canonicalField, canonicalField);
      assert.equal(abortError.abort.attemptedField, attemptedField);
      assert.equal(
        abortError.abort.expectedValue,
        canonicalField === "agentId"
          ? canonicalEntry.metadata.agentId
          : canonicalField === "memoryId"
            ? canonicalEntry.content.memoryId
            : canonicalEntry.metadata.nodeId,
      );

      assert.equal(abortError.abort.actualValue, actualValue);
    },
  );
});

test("persistLongTermMemoryEntry surfaces canonical id rewrites as a persistence-stage abort", async () => {
  const fixture = createPromotionSerializationFixture();
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage: {
        read: () => null,
        write: () => {
          throw new Error("storage.write should not be called for aborted writes");
        },
      },
      runtimePhase: createRuntimePhase("idle"),
      entry: {
        ...fixture,
        memoryId: "ltm-overridden",
      },
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.reason, "canonical-id-mutation");
  assert.equal(abortError.abort.stage, "persistence");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(abortError.abort.expectedValue, "wm-promote-1");
  assert.equal(abortError.abort.actualValue, "ltm-overridden");
});

test("persistLongTermMemoryEntry routes rewrite-stage input through canonical id validation", async () => {
  const fixture = createPromotionSerializationFixture();
  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  let writeCalled = false;
  const storedEntries = new Map();

  const result = await persistLongTermMemoryEntry({
    storage: {
      read: (request) => ({
        ...request,
        found: storedEntries.has(request.key),
        value: storedEntries.get(request.key) ?? null,
      }),
      write: (request) => {
        writeCalled = true;
        storedEntries.set(request.key, request.value);
        assert.equal(
          request.entry.content.content,
          "Rewritten durable insight with clarified rollout guidance.",
        );
        return {
          ...request,
          written: true,
        };
      },
    },
    runtimePhase: createRuntimePhase("idle"),
    entry: {
      selection: fixture.selection,
      memory: fixture.memory,
      rewrittenEntry: {
        ...canonicalEntry,
        content: {
          ...canonicalEntry.content,
          content: "Rewritten durable insight with clarified rollout guidance.",
          summary: "Rewritten rollout guidance.",
        },
      },
    },
  });

  assert.equal(writeCalled, true);
  assert.equal(result.status, "created");
  assert.equal(result.entry?.content.memoryId, fixture.selection.outputMemoryId);
  assert.equal(
    result.entry?.content.content,
    "Rewritten durable insight with clarified rollout guidance.",
  );
});

test("persistLongTermMemoryEntry aborts rewrite-stage canonical id swaps before storage write", async () => {
  const fixture = createPromotionSerializationFixture();
  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  let writeCalled = false;
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage: {
        read: () => null,
        write: () => {
          writeCalled = true;
          throw new Error("storage.write should not be called for rewrite-stage aborts");
        },
      },
      runtimePhase: createRuntimePhase("idle"),
      entry: {
        selection: fixture.selection,
        memory: fixture.memory,
        rewrittenEntry: {
          ...canonicalEntry,
          metadata: {
            ...canonicalEntry.metadata,
            nodeId: "old/agent-007/long_term_memory/wm-swapped",
          },
        },
      },
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.stage, "rewrite");
  assert.equal(abortError.abort.canonicalField, "nodeId");
  assert.equal(abortError.abort.attemptedField, "rewrittenEntry.metadata.nodeId");
  assert.equal(writeCalled, false);
});

test("persistLongTermMemoryEntry aborts identity-altering rewrite attempts without changing canonical ids or stored memories", async () => {
  const fixture = createPromotionSerializationFixture();
  const canonicalEntry = serializePromotionSelectionToLongTermMemoryEntry(fixture);
  const canonicalKey = createLongTermMemoryPersistenceKey(canonicalEntry);
  const canonicalValueBefore = JSON.stringify(canonicalEntry);
  const storage = createInMemoryLongTermMemoryStorage({
    [canonicalKey]: canonicalValueBefore,
  });
  const persistedStateBefore = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });
  const rewrittenEntry = {
    ...canonicalEntry,
    content: {
      ...canonicalEntry.content,
      memoryId: "ltm-rewritten",
    },
    metadata: {
      ...canonicalEntry.metadata,
      nodeId: "old/agent-007/long_term_memory/ltm-rewritten",
    },
  };
  const rewrittenKey = createLongTermMemoryPersistenceKey(rewrittenEntry);
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage,
      runtimePhase: createRuntimePhase("idle"),
      entry: {
        selection: fixture.selection,
        memory: fixture.memory,
        rewrittenEntry,
      },
    });
  } catch (error) {
    abortError = error;
  }

  const persistedStateAfter = await storage.list({
    keyPrefix: DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
    agentId: "agent-007",
  });

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.reason, "canonical-id-mutation");
  assert.equal(abortError.abort.stage, "rewrite");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(
    abortError.abort.attemptedField,
    "rewrittenEntry.content.memoryId",
  );
  assert.equal(abortError.abort.expectedValue, canonicalEntry.content.memoryId);
  assert.equal(abortError.abort.actualValue, "ltm-rewritten");
  assert.equal(storage.getWrites().length, 0);
  assert.equal(storage.getValue(canonicalKey), canonicalValueBefore);
  assert.equal(storage.getValue(rewrittenKey), null);
  assert.deepEqual(
    JSON.parse(storage.getValue(canonicalKey)),
    canonicalEntry,
  );
  assert.deepEqual(persistedStateAfter, persistedStateBefore);
});

test("persistLongTermMemoryEntry aborts before merge when the existing durable memoryId would be replaced", async () => {
  const existingEntry = serializeLongTermMemoryEntry(
    createLongTermMemoryInput({
      memoryId: "ltm-existing",
    }),
  );
  let writeCalled = false;
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage: {
        read: () => JSON.stringify(existingEntry),
        write: () => {
          writeCalled = true;
          throw new Error("storage.write should not be called for aborted merges");
        },
      },
      runtimePhase: createRuntimePhase("idle"),
      entry: createLongTermMemoryInput(),
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.stage, "merge");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(abortError.abort.attemptedField, "mergedEntry.content.memoryId");
  assert.equal(abortError.abort.expectedValue, "ltm-existing");
  assert.equal(abortError.abort.actualValue, "ltm-1");
  assert.equal(writeCalled, false);
});

test("persistLongTermMemoryEntry aborts before merge when the existing durable agent scope would be replaced", async () => {
  const existingEntry = serializeLongTermMemoryEntry(
    createLongTermMemoryInput({
      agentId: "agent-999",
    }),
  );
  let writeCalled = false;
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage: {
        read: () => JSON.stringify(existingEntry),
        write: () => {
          writeCalled = true;
          throw new Error("storage.write should not be called for aborted merges");
        },
      },
      runtimePhase: createRuntimePhase("idle"),
      entry: createLongTermMemoryInput(),
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.stage, "merge");
  assert.equal(abortError.abort.canonicalField, "agentId");
  assert.equal(abortError.abort.attemptedField, "mergedEntry.metadata.agentId");
  assert.equal(abortError.abort.expectedValue, "agent-999");
  assert.equal(abortError.abort.actualValue, "agent-007");
  assert.equal(writeCalled, false);
});

test("identity-altering merge abort preserves existing young and old generation state", async () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content:
            "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "ltm-existing",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
        consolidationState: {
          status: "promoted",
          lastOperation: "promote",
          journalRecordId: "journal-existing",
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["wm-existing-1"],
          preservedIdentityFields: ["agentId", "persona"],
          protectedFromIdentityPromotion: null,
        },
      }),
    ],
  });
  const previousYoungState = normalizeSavedGraphStateSnapshot(
    saveYoungGenerationGraphState(graph),
  );
  const previousOldState = normalizeSavedGraphStateSnapshot(
    saveOldGenerationGraphState(graph),
  );
  const existingDurableEntry = serializeLongTermMemoryEntry(
    graph.oldGeneration.longTermMemory[0],
  );
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: null,
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });
  const attemptedEntry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.workingMemory[0],
  });
  let writeCalled = false;
  let abortError = null;

  try {
    await persistLongTermMemoryEntry({
      storage: {
        read: () => JSON.stringify(existingDurableEntry),
        write: () => {
          writeCalled = true;
          throw new Error("storage.write should not be called for aborted merges");
        },
      },
      runtimePhase: createRuntimePhase("idle"),
      entry: attemptedEntry,
    });
  } catch (error) {
    abortError = error;
  }

  assert.ok(isConsolidationPipelineAbortError(abortError));
  assert.equal(abortError.abort.stage, "merge");
  assert.equal(abortError.abort.canonicalField, "memoryId");
  assert.equal(abortError.abort.expectedValue, "ltm-existing");
  assert.equal(abortError.abort.actualValue, "wm-existing-1");
  assert.equal(writeCalled, false);
  assert.deepEqual(
    normalizeSavedGraphStateSnapshot(saveYoungGenerationGraphState(graph)),
    previousYoungState,
  );
  assert.deepEqual(
    normalizeSavedGraphStateSnapshot(saveOldGenerationGraphState(graph)),
    previousOldState,
  );
});

test("serializePromotionSelectionToLongTermMemoryEntry rejects tampered output identity fields from the promotion plan", () => {
  const fixture = createPromotionSerializationFixture();

  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: {
          ...fixture.selection,
          outputMemoryId: "ltm-rewrite",
          outputNodeId: "old/agent-007/long_term_memory/ltm-rewrite",
        },
        memory: fixture.memory,
      }),
    /cannot rewrite source memoryId "wm-promote-1" to output memoryId "ltm-rewrite"/,
  );
});

test("reinforcement merge pipeline rejects replacement durable records before persistence", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-existing-1",
          content: "Refresh the durable rollout insight from the parked source memory.",
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T10:00:00Z",
            evidence: ["turn-44"],
            actor: "assistant",
          },
        },
        inactiveForRetrieval: true,
      },
    ],
    longTermMemory: [
      createLongTermMemoryInput({
        memoryId: "wm-existing-1",
        content: "Existing durable rollout insight.",
        summary: "Existing durable rollout insight.",
        confidence: 0.9,
        stabilizedAt: "2026-04-12T09:10:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-12T09:10:00Z",
          evidence: ["wm-existing-1"],
          actor: "offline-consolidation",
        },
      }),
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [
      {
        candidateId: "promo-wm-existing-1",
        agentId: "agent-007",
        sourceMemoryId: "wm-existing-1",
        sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
        targetMemoryId: "wm-existing-1",
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-wm-existing-1"],
              signals: {
                taskRelevance: 0.92,
                userSpecificity: 0.88,
              },
            },
            stability: {
              capturedAt: "2026-04-12T10:05:00Z",
              sourceCollection: "workingMemory",
              sourceRecordIds: ["wm-existing-1"],
              signals: {
                repeatedRecall: 0.84,
                crossEpisodeConsistency: 0.81,
              },
            },
          },
        },
      },
    ],
  });

  assert.equal(plan.selectedPromotionCount, 1);
  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: plan.selectedPromotions[0],
        memory: graph.oldGeneration.longTermMemory[0],
      }),
    /must describe the source young-generation memory and cannot include durable replacement fields/,
  );
});

test("deserializeLongTermMemoryEntry round-trips learned-trait records without identity drift", () => {
  const serializedEntry = serializeLongTermMemoryEntry(
    createLongTermMemoryInput({
      memoryId: "ltm-trait-1",
      category: "learned_trait",
      content: "The agent waits for direct evidence before escalating.",
      summary: "Evidence-seeking learned trait.",
      learnedTrait: {
        label: "evidence-seeking",
        confidence: 0.84,
        provenance: {
          source: "conversation",
          observedAt: "2026-04-12T09:00:00Z",
          evidence: ["turn-21"],
        },
      },
      consolidationState: {
        status: "promoted",
        lastOperation: "promote",
        journalRecordId: "journal-1",
        policyVersion: "old-generation-v1",
        sourceMemoryIds: ["stm-1"],
        preservedIdentityFields: ["agentId", "persona"],
        protectedFromIdentityPromotion: true,
      },
    }),
  );

  const restoredMemory = deserializeLongTermMemoryEntry(
    JSON.parse(JSON.stringify(serializedEntry)),
  );

  assert.equal(restoredMemory.category, "learned_trait");
  assert.equal(restoredMemory.learnedTrait.label, "evidence-seeking");
  assert.equal(
    restoredMemory.learnedTrait.protectedFromIdentityPromotion,
    true,
  );
  assert.equal(
    restoredMemory.consolidationState.protectedFromIdentityPromotion,
    true,
  );
  assert.deepEqual(serializeLongTermMemoryEntry(restoredMemory), serializedEntry);
});

test("serializePromotionSelectionToLongTermMemoryEntry rejects ineligible promotion selections", () => {
  const candidate = createConsolidationPromotionCandidate({
    candidateId: "promo-low",
    agentId: "agent-007",
    sourceMemoryId: "wm-low",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection: "importanceIndex",
          sourceRecordIds: ["importance-wm-low"],
          signals: {
            taskRelevance: 0.3,
          },
        },
        stability: {
          capturedAt: "2026-04-12T10:05:00Z",
          sourceCollection: "workingMemory",
          sourceRecordIds: ["wm-low"],
          signals: {
            repeatedRecall: 0.84,
          },
        },
      },
    },
  });
  const evaluation = evaluateConsolidationPromotionEligibility(candidate);

  assert.equal(evaluation.eligible, false);
  assert.throws(
    () =>
      serializePromotionSelectionToLongTermMemoryEntry({
        selection: {
          candidate,
          evaluation,
          sourceCollection: "workingMemory",
          targetMemoryId: null,
          targetNodeId: null,
        },
        memory: {
          memoryId: "wm-low",
          content: "Low-salience note.",
        },
      }),
    /eligible promotion selection/,
  );
});

test("deserializeLongTermMemoryEntry rejects missing required metadata fields", () => {
  const serializedEntry = JSON.parse(
    JSON.stringify(serializeLongTermMemoryEntry(createLongTermMemoryInput())),
  );
  delete serializedEntry.metadata.salience;

  assert.throws(
    () => deserializeLongTermMemoryEntry(serializedEntry),
    /Long-term memory persistence entry\.metadata\.salience must be an object\./,
  );
});
