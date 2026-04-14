import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX,
  MEMORY_NODE_KINDS,
  archiveStaleMemories,
  createMemoryGraph,
  deserializeLongTermMemoryEntry,
  evaluateStaleMemories,
  executeOfflineBatchPlan,
  persistLongTermMemoryEntry,
  planConsolidationPromotions,
  saveOldGenerationGraphState,
  saveYoungGenerationGraphState,
  scheduleOfflineBatchExecution,
  validateOfflineConsolidationBatchPlan,
} from "../src/index.js";
import { createOfflineFlowHarness } from "../test-support/offline-flow-harness.js";
import {
  createB200OfflineTestBatchLimit,
  createOfflineFlowAgentFixture,
} from "../test-support/offline-flow-fixtures.js";

const createDeferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID =
  "sk-proj-1234567890abcdefghijklmnopqrstuvABCDE";

const createInMemoryLongTermMemoryStorage = () => {
  const values = new Map();
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
};

const createOfflineFlowPromotionCandidates = (fixture) => [
  {
    candidateId: `promo-${fixture.ids.maskedWorkingMemoryId}`,
    agentId: fixture.identity.agentId,
    sourceMemoryId: fixture.ids.maskedWorkingMemoryId,
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    targetMemoryId: null,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: "2026-04-12T08:15:00Z",
          sourceCollection: "importanceIndex",
          sourceRecordIds: [`importance-${fixture.ids.maskedWorkingMemoryId}`],
          signals: {
            taskRelevance: 0.9,
            userSpecificity: 0.82,
          },
        },
        stability: {
          capturedAt: "2026-04-12T08:15:00Z",
          sourceCollection: "workingMemory",
          sourceRecordIds: [fixture.ids.maskedWorkingMemoryId],
          signals: {
            repeatedRecall: 0.84,
            crossEpisodeConsistency: 0.8,
          },
        },
      },
    },
  },
];

const createBoundaryRejectedOfflineFlowFixture = () => {
  const baseFixture = createOfflineFlowAgentFixture();
  const previousMaskedMemoryId = baseFixture.ids.maskedWorkingMemoryId;
  const graph = createMemoryGraph(baseFixture.identity, {
    workingMemory: baseFixture.graph.youngGeneration.workingMemory.map(
      (memoryEnvelope) =>
        memoryEnvelope.record.memoryId === previousMaskedMemoryId
          ? {
              ...memoryEnvelope,
              record: {
                ...memoryEnvelope.record,
                memoryId: HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID,
                content:
                  "Idle-only memory that should be rejected at the hippocampus boundary.",
              },
            }
          : memoryEnvelope,
    ),
    shortTermMemory: baseFixture.graph.youngGeneration.shortTermMemory,
    importanceIndex: baseFixture.graph.youngGeneration.importanceIndex.map(
      (entry) =>
        entry.memoryId === previousMaskedMemoryId
          ? {
              ...entry,
              entryId: `importance-${HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID}`,
              memoryId: HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID,
            }
          : entry,
    ),
    longTermMemory: baseFixture.graph.oldGeneration.longTermMemory,
    archivedMemory: baseFixture.graph.oldGeneration.archivedMemory,
    memoryEvidence: baseFixture.graph.oldGeneration.memoryEvidence,
    consolidationJournal: baseFixture.graph.oldGeneration.consolidationJournal,
    edges: baseFixture.graph.edges,
  });

  return {
    ...baseFixture,
    ids: {
      ...baseFixture.ids,
      maskedWorkingMemoryId: HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID,
    },
    priorityMemoryIds: baseFixture.priorityMemoryIds.map((memoryId) =>
      memoryId === previousMaskedMemoryId
        ? HIPPOCAMPUS_BOUNDARY_SECRET_MEMORY_ID
        : memoryId,
    ),
    graph,
  };
};

const createOfflineFlowArchivalEvaluation = (fixture) =>
  evaluateStaleMemories({
    now: "2026-04-13T12:00:00Z",
    minimumRecencyMs: 6 * 60 * 60 * 1000,
    recencyHorizonMs: 7 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: fixture.ids.maskedWorkingMemoryId,
        createdAt: "2026-03-20T07:45:00Z",
        lastAccessedAt: "2026-03-21T08:00:00Z",
        accessCount: 0,
        retentionValue: 0.08,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
        },
      },
      {
        memoryId: fixture.ids.staleShortTermMemoryId,
        createdAt: "2026-03-19T22:30:00Z",
        lastAccessedAt: "2026-03-20T08:05:00Z",
        accessCount: 0,
        retentionValue: 0.05,
        metadata: {
          generation: MEMORY_NODE_KINDS.youngGeneration,
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
    ],
  });

const appendPersistedLongTermMemoryToGraph = (graph, persistedResult) => {
  const durableMemory = deserializeLongTermMemoryEntry(
    JSON.parse(persistedResult.serializedEntry),
  );

  return createMemoryGraph(graph.oldGeneration.immutableIdentity, {
    workingMemory: graph.youngGeneration.workingMemory,
    shortTermMemory: graph.youngGeneration.shortTermMemory,
    importanceIndex: graph.youngGeneration.importanceIndex,
    longTermMemory: [...graph.oldGeneration.longTermMemory, durableMemory],
    archivedMemory: graph.oldGeneration.archivedMemory,
    memoryEvidence: graph.oldGeneration.memoryEvidence,
    consolidationJournal: graph.oldGeneration.consolidationJournal,
    edges: graph.edges,
  });
};

const createOfflineFlowOutcomeDispatcher = (fixture, storage) => {
  let runtimeGraph = fixture.graph;
  let promotionPlan = null;
  let promotionPersistence = null;
  let archivalEvaluation = null;
  let archivalResult = null;

  return {
    getRuntimeGraph() {
      return runtimeGraph;
    },
    getPromotionPersistence() {
      return promotionPersistence;
    },
    getArchivalResult() {
      return archivalResult;
    },
    async dispatchWorkUnit(workUnit, executionContext) {
      const stageId = workUnit.metadata?.stageId ?? "unknown-stage";

      switch (stageId) {
        case "young-generation-triage": {
          promotionPlan = planConsolidationPromotions(runtimeGraph, {
            runtimePhase: executionContext.runtimePhase,
            teamIdle: executionContext.authorization.teamIdle,
            candidates: createOfflineFlowPromotionCandidates(fixture),
          });
          archivalEvaluation = createOfflineFlowArchivalEvaluation(fixture);

          return {
            stageId,
            selectedPromotionCount: promotionPlan.selectedPromotionCount,
            staleCandidateIds: archivalEvaluation.staleCandidates.map(
              (candidate) => candidate.memoryId,
            ),
          };
        }
        case "young-generation-promotion": {
          const selection = promotionPlan?.selectedPromotions[0];
          const sourceMemory = runtimeGraph.youngGeneration.workingMemory.find(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === fixture.ids.maskedWorkingMemoryId,
          );

          if (!selection || !sourceMemory) {
            return {
              stageId,
              persistedStatus: "skipped",
              blockedReason:
                promotionPlan?.deferredCandidates[0]?.deferredReason ??
                "missing-promotable-memory",
              persistedKey: null,
              persistedMemoryId: null,
            };
          }

          promotionPersistence = await persistLongTermMemoryEntry({
            storage,
            entry: {
              selection,
              memory: sourceMemory,
            },
            runtimePhase: executionContext.runtimePhase,
            teamIdle: executionContext.authorization.teamIdle,
          });
          runtimeGraph = appendPersistedLongTermMemoryToGraph(
            runtimeGraph,
            promotionPersistence,
          );

          return {
            stageId,
            persistedStatus: promotionPersistence.status,
            persistedKey: promotionPersistence.key,
            persistedMemoryId: promotionPersistence.memoryId,
          };
        }
        case "old-generation-reinforcement":
          return {
            stageId,
            durableMemoryIds: runtimeGraph.oldGeneration.longTermMemory.map(
              (memory) => memory.memoryId,
            ),
            learnedTraitMemoryIds: runtimeGraph.oldGeneration.longTermMemory
              .filter((memory) => memory.category === "learned_trait")
              .map((memory) => memory.memoryId),
          };
        case "archived-memory-review":
          archivalResult = await archiveStaleMemories(runtimeGraph, {
            evaluation:
              archivalEvaluation ?? createOfflineFlowArchivalEvaluation(fixture),
            runtimePhase: executionContext.runtimePhase,
            teamIdle: executionContext.authorization.teamIdle,
            archivedAt: "2026-04-13T12:05:00Z",
            archivedBy: "offline-consolidation",
            policyVersion: "offline-flow-v1",
            provenance: {
              batchId: workUnit.workUnitId,
            },
          });
          runtimeGraph = archivalResult.nextGraph;

          return {
            stageId,
            archivedCount: archivalResult.archivedCount,
            archivedSourceMemoryIds: archivalResult.archivedTransitions.map(
              (transition) => transition.memoryId,
            ),
            archivedArchiveIds: archivalResult.archivedTransitions.map(
              (transition) => transition.archiveId,
            ),
          };
        default:
          return {
            stageId,
          };
      }
    },
  };
};

test("shared offline flow fixtures provide young and old memory generations plus runtime authorization windows", () => {
  const fixture = createOfflineFlowAgentFixture();
  const batchLimit = createB200OfflineTestBatchLimit();

  assert.equal(fixture.graph.youngGeneration.workingMemory.length, 2);
  assert.equal(fixture.graph.youngGeneration.shortTermMemory.length, 2);
  assert.equal(fixture.graph.oldGeneration.longTermMemory.length, 2);
  assert.equal(fixture.graph.oldGeneration.archivedMemory.length, 1);
  assert.equal(fixture.graph.oldGeneration.memoryEvidence.length, 1);
  assert.equal(fixture.graph.oldGeneration.consolidationJournal.length, 1);
  assert.deepEqual(fixture.priorityMemoryIds, [
    fixture.ids.maskedWorkingMemoryId,
    fixture.ids.staleShortTermMemoryId,
    fixture.ids.currentLongTermMemoryId,
  ]);

  assert.equal(fixture.runtime.windows.idle.runtimePhase.value, "idle");
  assert.equal(fixture.runtime.windows.idle.runtimePhase.authority, "caller");
  assert.equal(fixture.runtime.windows.sleep.runtimePhase.value, "sleep");
  assert.equal(
    fixture.runtime.windows.activeFalsePositive.inactivitySuggestion.thresholdReached,
    true,
  );
  assert.equal(
    fixture.runtime.windows.activeFalsePositive.inactivitySuggestion
      .authorizesConsolidation,
    false,
  );
  assert.equal(fixture.runtime.windows.schedulerSleep.runtimePhase.authority, "scheduler");

  assert.equal(batchLimit.targetProfile, "b200-style");
  assert.equal(batchLimit.acceleratorClass, "b200-style");
  assert.equal(batchLimit.maxWorkUnitsPerBatch, 2);
  assert.equal(batchLimit.maxAgentsPerBatch, 1);
});

test("offline flow harness executes an authorized idle window through validated B200 slices", async () => {
  const harness = createOfflineFlowHarness();
  const scenario = await harness.simulateWindow("idle");

  assert.equal(scenario.requestResult.status, "validated");
  assert.equal(validateOfflineConsolidationBatchPlan(scenario.plan), true);
  assert.equal(scenario.plan.metadata.authorization.eligible, true);
  assert.equal(scenario.plan.metadata.runtimePhase.value, "idle");
  assert.deepEqual(scenario.plan.metadata.stageIds, [
    "young-generation-triage",
    "young-generation-promotion",
    "old-generation-reinforcement",
  ]);
  assert.equal(scenario.plan.limit.targetProfile, "b200-style");

  assert.equal(scenario.schedule.executable, true);
  assert.equal(scenario.schedule.sliceCount, 2);
  assert.deepEqual(
    scenario.schedule.slices.map((slice) => slice.batchPlan.orderedWorkUnitIds),
    [
      [`${scenario.plan.planId}/young-generation-triage`],
      [
        `${scenario.plan.planId}/young-generation-promotion`,
        `${scenario.plan.planId}/old-generation-reinforcement`,
      ],
    ],
  );

  assert.equal(scenario.execution.status, "completed");
  assert.deepEqual(
    scenario.execution.results.map((result) => [
      result.output.stageId,
      result.runtimePhase,
      result.status,
    ]),
    [
      ["young-generation-triage", "idle", "executed"],
      ["young-generation-promotion", "idle", "executed"],
      ["old-generation-reinforcement", "idle", "executed"],
    ],
  );
});

test("offline flow harness executes an authorized sleep window with archived-memory review", async () => {
  const harness = createOfflineFlowHarness();
  const scenario = await harness.simulateWindow("sleep");

  assert.equal(scenario.requestResult.status, "validated");
  assert.equal(validateOfflineConsolidationBatchPlan(scenario.plan), true);
  assert.equal(scenario.plan.metadata.authorization.eligible, true);
  assert.equal(scenario.plan.metadata.runtimePhase.value, "sleep");
  assert.deepEqual(scenario.plan.metadata.stageIds, [
    "young-generation-triage",
    "young-generation-promotion",
    "old-generation-reinforcement",
    "archived-memory-review",
  ]);

  assert.equal(scenario.schedule.executable, true);
  assert.equal(scenario.schedule.sliceCount, 3);
  assert.deepEqual(
    scenario.execution.results.map((result) => [
      result.output.stageId,
      result.runtimePhase,
      result.status,
    ]),
    [
      ["young-generation-triage", "sleep", "executed"],
      ["young-generation-promotion", "sleep", "executed"],
      ["old-generation-reinforcement", "sleep", "executed"],
      ["archived-memory-review", "sleep", "executed"],
    ],
  );
});

test("offline flow persists promoted young memory during idle without forcing inline archival", async () => {
  const harness = createOfflineFlowHarness();
  const storage = createInMemoryLongTermMemoryStorage();
  const outcomeDispatcher = createOfflineFlowOutcomeDispatcher(
    harness.agentFixture,
    storage,
  );
  const scenario = await harness.simulateWindow("idle", {
    maxConcurrentWorkUnits: 1,
    dispatchWorkUnit: outcomeDispatcher.dispatchWorkUnit,
  });
  const finalGraph = outcomeDispatcher.getRuntimeGraph();
  const promotionPersistence = outcomeDispatcher.getPromotionPersistence();
  const oldState = saveOldGenerationGraphState(finalGraph);
  const expectedPersistedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/` +
    `${harness.agentFixture.identity.agentId}/` +
    `${harness.agentFixture.ids.maskedWorkingMemoryId}.json`;
  const storedPromotedMemory = deserializeLongTermMemoryEntry(
    JSON.parse(storage.getValue(expectedPersistedKey)),
  );
  const maskedWorkingMemory = finalGraph.youngGeneration.workingMemory.find(
    (memoryEnvelope) =>
      memoryEnvelope.record.memoryId === harness.agentFixture.ids.maskedWorkingMemoryId,
  );
  const promotionOutput = scenario.execution.results.find(
    (result) => result.output?.stageId === "young-generation-promotion",
  )?.output;
  const reinforcementOutput = scenario.execution.results.find(
    (result) => result.output?.stageId === "old-generation-reinforcement",
  )?.output;

  assert.equal(scenario.execution.status, "completed");
  assert.ok(promotionPersistence);
  assert.equal(promotionPersistence.status, "created");
  assert.equal(promotionPersistence.key, expectedPersistedKey);
  assert.equal(storage.getWrites().length, 1);

  assert.ok(maskedWorkingMemory);
  assert.equal(maskedWorkingMemory.inactiveForRetrieval, true);
  assert.equal(finalGraph.youngGeneration.workingMemory.length, 2);
  assert.equal(finalGraph.youngGeneration.shortTermMemory.length, 2);
  assert.deepEqual(
    finalGraph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
      harness.agentFixture.ids.maskedWorkingMemoryId,
    ],
  );
  assert.equal(finalGraph.oldGeneration.archivedMemory.length, 1);

  assert.equal(storedPromotedMemory.memoryId, harness.agentFixture.ids.maskedWorkingMemoryId);
  assert.equal(
    storedPromotedMemory.consolidationState.status,
    "promoted",
  );
  assert.equal(
    storedPromotedMemory.consolidationState.protectedFromIdentityPromotion,
    null,
  );
  assert.deepEqual(
    oldState.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
      harness.agentFixture.ids.maskedWorkingMemoryId,
    ],
  );
  assert.equal(oldState.oldGeneration.archivedMemory.length, 1);

  assert.deepEqual(promotionOutput, {
    stageId: "young-generation-promotion",
    persistedStatus: "created",
    persistedKey: expectedPersistedKey,
    persistedMemoryId: harness.agentFixture.ids.maskedWorkingMemoryId,
  });
  assert.deepEqual(reinforcementOutput, {
    stageId: "old-generation-reinforcement",
    durableMemoryIds: [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
      harness.agentFixture.ids.maskedWorkingMemoryId,
    ],
    learnedTraitMemoryIds: [harness.agentFixture.ids.learnedTraitMemoryId],
  });
});

test("offline flow fail-closes hippocampus boundary rejections during idle promotion", async () => {
  const agentFixture = createBoundaryRejectedOfflineFlowFixture();
  const harness = createOfflineFlowHarness({ agentFixture });
  const storage = createInMemoryLongTermMemoryStorage();
  const outcomeDispatcher = createOfflineFlowOutcomeDispatcher(
    harness.agentFixture,
    storage,
  );
  const scenario = await harness.simulateWindow("idle", {
    maxConcurrentWorkUnits: 1,
    dispatchWorkUnit: outcomeDispatcher.dispatchWorkUnit,
  });
  const finalGraph = outcomeDispatcher.getRuntimeGraph();
  const promotionOutput = scenario.execution.results.find(
    (result) => result.output?.stageId === "young-generation-promotion",
  )?.output;
  const reinforcementOutput = scenario.execution.results.find(
    (result) => result.output?.stageId === "old-generation-reinforcement",
  )?.output;

  assert.equal(scenario.execution.status, "completed");
  assert.equal(scenario.execution.failedCount, 0);
  assert.equal(storage.getWrites().length, 0);
  assert.equal(outcomeDispatcher.getPromotionPersistence(), null);
  assert.deepEqual(
    finalGraph.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
    ],
  );
  assert.deepEqual(promotionOutput, {
    stageId: "young-generation-promotion",
    persistedStatus: "skipped",
    blockedReason: "hippocampus-boundary-rejected",
    persistedKey: null,
    persistedMemoryId: null,
  });
  assert.deepEqual(reinforcementOutput, {
    stageId: "old-generation-reinforcement",
    durableMemoryIds: [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
    ],
    learnedTraitMemoryIds: [harness.agentFixture.ids.learnedTraitMemoryId],
  });
});

test("offline flow archives inactive young memory during sleep and persists the resulting offline graph artifacts", async () => {
  const harness = createOfflineFlowHarness();
  const storage = createInMemoryLongTermMemoryStorage();
  const outcomeDispatcher = createOfflineFlowOutcomeDispatcher(
    harness.agentFixture,
    storage,
  );
  const scenario = await harness.simulateWindow("sleep", {
    maxConcurrentWorkUnits: 1,
    dispatchWorkUnit: outcomeDispatcher.dispatchWorkUnit,
  });
  const finalGraph = outcomeDispatcher.getRuntimeGraph();
  const archivalResult = outcomeDispatcher.getArchivalResult();
  const expectedPersistedKey =
    `${DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX}/` +
    `${harness.agentFixture.identity.agentId}/` +
    `${harness.agentFixture.ids.maskedWorkingMemoryId}.json`;
  const youngState = saveYoungGenerationGraphState(finalGraph);
  const oldState = saveOldGenerationGraphState(finalGraph);
  const archivedWorkingMemory = finalGraph.oldGeneration.archivedMemory.find(
    (memory) =>
      memory.originalMemoryId === harness.agentFixture.ids.maskedWorkingMemoryId,
  );
  const archivedShortTermMemory = finalGraph.oldGeneration.archivedMemory.find(
    (memory) =>
      memory.originalMemoryId === harness.agentFixture.ids.staleShortTermMemoryId,
  );
  const archivalOutput = scenario.execution.results.find(
    (result) => result.output?.stageId === "archived-memory-review",
  )?.output;

  assert.equal(scenario.execution.status, "completed");
  assert.equal(storage.getWrites().length, 1);
  assert.ok(archivalResult);
  assert.equal(archivalResult.archivedCount, 2);

  assert.deepEqual(
    youngState.youngGeneration.workingMemory.map(
      (memoryEnvelope) => memoryEnvelope.record.memoryId,
    ),
    [harness.agentFixture.ids.activeWorkingMemoryId],
  );
  assert.deepEqual(
    youngState.youngGeneration.shortTermMemory.map(
      (memoryEnvelope) => memoryEnvelope.record.memoryId,
    ),
    [harness.agentFixture.ids.activeShortTermMemoryId],
  );
  assert.deepEqual(
    youngState.youngGeneration.importanceIndex.map((entry) => entry.memoryId).sort(),
    [
      harness.agentFixture.ids.activeShortTermMemoryId,
      harness.agentFixture.ids.activeWorkingMemoryId,
    ].sort(),
  );

  assert.deepEqual(
    oldState.oldGeneration.longTermMemory.map((memory) => memory.memoryId),
    [
      harness.agentFixture.ids.currentLongTermMemoryId,
      harness.agentFixture.ids.learnedTraitMemoryId,
      harness.agentFixture.ids.maskedWorkingMemoryId,
    ],
  );
  assert.deepEqual(
    oldState.oldGeneration.archivedMemory
      .map((memory) => memory.originalMemoryId)
      .sort(),
    [
      harness.agentFixture.ids.historicalLongTermMemoryId,
      harness.agentFixture.ids.maskedWorkingMemoryId,
      harness.agentFixture.ids.staleShortTermMemoryId,
    ].sort(),
  );

  assert.ok(archivedWorkingMemory);
  assert.equal(archivedWorkingMemory.snapshot.lifecycle.state, "archived");
  assert.equal(
    archivedWorkingMemory.snapshot.lifecycle.archiveLinkage.archiveId,
    archivedWorkingMemory.archiveId,
  );
  assert.ok(archivedShortTermMemory);
  assert.equal(archivedShortTermMemory.snapshot.lifecycle.state, "archived");
  assert.equal(
    archivedShortTermMemory.snapshot.lifecycle.archiveLinkage.archiveId,
    archivedShortTermMemory.archiveId,
  );

  assert.equal(archivalOutput.stageId, "archived-memory-review");
  assert.equal(archivalOutput.archivedCount, 2);
  assert.deepEqual(
    [...archivalOutput.archivedSourceMemoryIds].sort(),
    [
      harness.agentFixture.ids.maskedWorkingMemoryId,
      harness.agentFixture.ids.staleShortTermMemoryId,
    ].sort(),
  );
  assert.deepEqual(
    [...archivalOutput.archivedArchiveIds].sort(),
    archivalResult.archivedTransitions
      .map((transition) => transition.archiveId)
      .sort(),
  );
  assert.equal(
    storage.getValue(expectedPersistedKey) !== null,
    true,
  );
});

test("offline flow requires validated sleep preconditions and preserves ordered slice barriers before downstream execution", async () => {
  const harness = createOfflineFlowHarness();
  const requestResult = harness.requestPlan({
    runtimeWindow: "sleep",
    teamIdle: true,
  });

  assert.equal(requestResult.status, "validated");
  assert.equal(requestResult.safeToExecute, true);
  assert.equal(requestResult.request.runtimeWindow, "sleep");
  assert.equal(requestResult.request.coordinationHint, "team-idle");
  assert.equal(requestResult.plan.metadata.authorization.eligible, true);
  assert.equal(requestResult.plan.metadata.authorization.blockedReason, null);

  const schedule = scheduleOfflineBatchExecution(requestResult.plan);

  assert.equal(schedule.executable, true);
  assert.deepEqual(
    schedule.slices.map((slice) =>
      slice.batchPlan.workUnits.map((workUnit) => workUnit.metadata?.stageId),
    ),
    [
      ["young-generation-triage"],
      ["young-generation-promotion", "old-generation-reinforcement"],
      ["archived-memory-review"],
    ],
  );

  const events = [];
  const triageStarted = createDeferred();
  const triageReleased = createDeferred();
  const stageTwoStarted = createDeferred();
  const stageTwoReleased = createDeferred();
  let stageTwoStartCount = 0;

  const executionPromise = executeOfflineBatchPlan(requestResult.plan, {
    maxConcurrentWorkUnits: 2,
    async dispatchWorkUnit(workUnit) {
      const stageId = workUnit.metadata?.stageId ?? "unknown-stage";

      events.push(`start:${stageId}`);

      if (stageId === "young-generation-triage") {
        triageStarted.resolve();
        await triageReleased.promise;
      }

      if (
        stageId === "young-generation-promotion" ||
        stageId === "old-generation-reinforcement"
      ) {
        stageTwoStartCount += 1;

        if (stageTwoStartCount === 2) {
          stageTwoStarted.resolve();
        }

        await stageTwoReleased.promise;
      }

      events.push(`finish:${stageId}`);

      return {
        stageId,
      };
    },
  });

  await triageStarted.promise;
  assert.deepEqual(events, ["start:young-generation-triage"]);

  triageReleased.resolve();
  await stageTwoStarted.promise;

  assert.ok(events.includes("finish:young-generation-triage"));
  assert.equal(events.includes("start:archived-memory-review"), false);
  assert.deepEqual(
    [...new Set(events.filter((entry) => entry.startsWith("start:")))].sort(),
    [
      "start:old-generation-reinforcement",
      "start:young-generation-promotion",
      "start:young-generation-triage",
    ],
  );

  stageTwoReleased.resolve();
  const execution = await executionPromise;
  const archivedStartIndex = events.indexOf("start:archived-memory-review");

  assert.equal(execution.status, "completed");
  assert.ok(
    archivedStartIndex > events.indexOf("finish:young-generation-promotion"),
  );
  assert.ok(
    archivedStartIndex > events.indexOf("finish:old-generation-reinforcement"),
  );
  assert.deepEqual(
    execution.results.map((result) => result.output?.stageId ?? null),
    [
      "young-generation-triage",
      "young-generation-promotion",
      "old-generation-reinforcement",
      "archived-memory-review",
    ],
  );
});

test("offline flow harness groups idle and sleep agents into a B200-style team batch without shared identity", () => {
  const harness = createOfflineFlowHarness();
  const batchLimit = createB200OfflineTestBatchLimit({
    maxAgentsPerBatch: 2,
    maxIdentityScopesPerBatch: 2,
  });
  const { fixtures, plan } = harness.planTeamIdleBatch({
    batchLimit,
  });

  assert.equal(plan.teamIdle, true);
  assert.equal(plan.eligibleCount, 2);
  assert.equal(plan.blockedCount, 0);
  assert.equal(plan.batchCount, 1);
  assert.equal(plan.defaultBatchLimit.targetProfile, "b200-style");
  assert.equal(plan.batches[0].batchPlan.withinCapacity, true);
  assert.deepEqual(
    plan.eligibleAgents.map((agent) => [
      agent.agentId,
      agent.authorization.runtimePhase.value,
      agent.identityIsolationKey,
    ]),
    [
      [
        harness.agentFixture.identity.agentId,
        "idle",
        `agent:${harness.agentFixture.identity.agentId}`,
      ],
      [
        `${harness.agentFixture.identity.agentId}-sleep`,
        "sleep",
        `agent:${harness.agentFixture.identity.agentId}-sleep`,
      ],
    ],
  );
  assert.ok(
    fixtures.every((fixture) => fixture.graph.agentId === fixture.identity.agentId),
  );
});

test("offline flow harness keeps heuristic false-positive idle windows blocked", async () => {
  const harness = createOfflineFlowHarness();
  let dispatchCount = 0;
  const scenario = await harness.simulateWindow("activeFalsePositive", {
    teamIdle: true,
    async dispatchWorkUnit() {
      dispatchCount += 1;
      return {
        unexpected: true,
      };
    },
  });

  assert.equal(scenario.window.runtimePhase.value, "active");
  assert.equal(scenario.window.inactivitySuggestion.thresholdReached, true);
  assert.equal(scenario.requestResult.status, "rejected");
  assert.equal(scenario.requestResult.safeToExecute, false);
  assert.equal(
    scenario.requestResult.rejection.blockedReason,
    "runtime-phase-not-idle-window",
  );
  assert.equal(scenario.plan, null);
  assert.equal(scenario.schedule, null);
  assert.equal(scenario.execution, null);
  assert.equal(dispatchCount, 0);
});

test("offline flow harness blocks scheduler-inferred sleep windows until the caller explicitly authorizes them", async () => {
  const harness = createOfflineFlowHarness();
  let dispatchCount = 0;
  const scenario = await harness.simulateWindow("schedulerSleep", {
    teamIdle: true,
    async dispatchWorkUnit() {
      dispatchCount += 1;
      return {
        unexpected: true,
      };
    },
  });

  assert.equal(scenario.window.runtimePhase.value, "sleep");
  assert.equal(scenario.window.runtimePhase.authority, "scheduler");
  assert.equal(scenario.window.inactivitySuggestion.thresholdReached, true);
  assert.equal(scenario.requestResult.status, "rejected");
  assert.equal(scenario.requestResult.safeToExecute, false);
  assert.equal(
    scenario.requestResult.rejection.blockedReason,
    "runtime-phase-not-caller-controlled",
  );
  assert.equal(scenario.plan, null);
  assert.equal(scenario.schedule, null);
  assert.equal(scenario.execution, null);
  assert.equal(dispatchCount, 0);
});

test("offline flow blocks downstream consolidation stages when runtime work resumes before the next slice", async () => {
  const harness = createOfflineFlowHarness();
  const requestResult = harness.requestPlan({
    runtimeWindow: "sleep",
    teamIdle: true,
  });
  const dispatchedStageIds = [];

  assert.equal(requestResult.status, "validated");

  const execution = await executeOfflineBatchPlan(requestResult.plan, {
    resolveRuntimePhase({ workUnit }) {
      return workUnit.metadata?.stageId === "young-generation-triage"
        ? "sleep"
        : "active";
    },
    async dispatchWorkUnit(workUnit) {
      const stageId = workUnit.metadata?.stageId ?? "unknown-stage";
      dispatchedStageIds.push(stageId);
      return {
        stageId,
      };
    },
  });

  assert.equal(execution.authorizationMode, "execution-runtime-phase");
  assert.equal(execution.status, "completed-with-blocked-work-units");
  assert.deepEqual(dispatchedStageIds, ["young-generation-triage"]);
  assert.deepEqual(
    execution.results.map((result) => ({
      stageId: result.output?.stageId ?? result.workUnitId.split("/").pop(),
      status: result.status,
      runtimePhase: result.runtimePhase,
      blockedReason: result.blockedReason,
    })),
    [
      {
        stageId: "young-generation-triage",
        status: "executed",
        runtimePhase: "sleep",
        blockedReason: null,
      },
      {
        stageId: "young-generation-promotion",
        status: "blocked",
        runtimePhase: "active",
        blockedReason: "runtime-phase-not-idle-window",
      },
      {
        stageId: "old-generation-reinforcement",
        status: "blocked",
        runtimePhase: "active",
        blockedReason: "runtime-phase-not-idle-window",
      },
      {
        stageId: "archived-memory-review",
        status: "blocked",
        runtimePhase: "active",
        blockedReason: "runtime-phase-not-idle-window",
      },
    ],
  );
});
