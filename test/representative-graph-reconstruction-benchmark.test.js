import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  createIdleWindowReconstructionBudget,
  createMemoryGraph,
  getMemoryGraphReconstructionBudget,
  getMemoryGraphReconstructionProfile,
  rebuildMemoryGraph,
  saveYoungGenerationGraphState,
} from "../src/index.js";
import {
  REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS,
  createRepresentativeTargetMemorySetFixture,
} from "../test-support/consolidation-target-memory-fixtures.js";
import {
  analyzeCandidateGraphTopology,
  collectMemoryGraphCounts,
  createBenchmarkEqualityCheck,
  createBenchmarkValidationSummary,
  createComparableBenchmarkPerformanceMetrics,
} from "../test-support/benchmark-reporting.js";

const REPRESENTATIVE_PRESET_IDS = [
  "small-sparse",
  "medium-moderate",
  "large-dense",
];
const REPRESENTATIVE_INCREMENTAL_IDLE_BUDGETS_MS = Object.freeze({
  "small-sparse": 15,
  "medium-moderate": 15,
  "large-dense": 15,
});
const BENCHMARK_CAPTURED_AT = "2026-04-14T04:20:00Z";
const BENCHMARK_INACTIVE_AT = "2026-04-14T04:21:00Z";

const createRepresentativeIdleBudget = (reconstructionBudgetMs) =>
  createIdleWindowReconstructionBudget({
    idleTriggerWindowMs: reconstructionBudgetMs + 1,
    reserveWindowMs: 1,
  });

const roundDurationMs = (value) => Number(value.toFixed(3));
const sum = (values) =>
  values.reduce((runningTotal, value) => runningTotal + value, 0);

const formatRepresentativeIdleBudgetRegression = ({
  scenarioId,
  idleBudgetMs,
  wallClockElapsedMs,
  reconstructionElapsedMs,
}) =>
  `Incremental reconstruction exceeded the idle budget for scenario "${scenarioId}": ` +
  `budget=${idleBudgetMs}ms, wallClock=${wallClockElapsedMs}ms, ` +
  `profiled=${reconstructionElapsedMs}ms.`;

const createBenchmarkModifiedWorkingMemory = (memoryEnvelope, presetId) => ({
  ...memoryEnvelope,
  record: {
    ...memoryEnvelope.record,
    content:
      `${memoryEnvelope.record.content} ` +
      `Benchmark replay for ${presetId} reinforced this memory before the next idle trigger.`,
    summary:
      `${memoryEnvelope.record.summary} ` +
      `Benchmark replay reinforced it before the next idle trigger.`,
  },
});

const createBenchmarkAddedWorkingMemory = (templateEnvelope, memoryId, presetId) => ({
  ...templateEnvelope,
  record: {
    ...templateEnvelope.record,
    memoryId,
    content:
      `Benchmark-added working memory for ${presetId} keeps the optimized ` +
      `reconstruction path exercised across representative memory sets.`,
    summary: `Benchmark-added working memory for ${presetId}.`,
    provenance: {
      ...templateEnvelope.record.provenance,
      observedAt: BENCHMARK_CAPTURED_AT,
      evidence: [`benchmark-${presetId}-added`],
    },
  },
  inactiveForRetrieval: true,
  masking: {
    ...templateEnvelope.masking,
    maskedAt: BENCHMARK_INACTIVE_AT,
    maskedBy: "representative-graph-reconstruction-benchmark",
    reason: "queued-for-benchmark-idle-rebuild",
  },
  lifecycle: {
    ...templateEnvelope.lifecycle,
    state: "inactive",
    inactiveAt: BENCHMARK_INACTIVE_AT,
    inactiveReason: "queued-for-benchmark-idle-rebuild",
  },
});

const roundSignal = (value) =>
  Number(Math.min(0.99, (Number(value) || 0) + 0.04).toFixed(2));

const createBenchmarkModifiedImportanceEntry = (entry) => ({
  ...entry,
  signals: Object.fromEntries(
    Object.entries(entry.signals).map(([signalName, signalValue]) => [
      signalName,
      roundSignal(signalValue),
    ]),
  ),
  lastUpdatedAt: BENCHMARK_CAPTURED_AT,
});

const createBenchmarkAddedImportanceEntry = (templateEntry, memoryId, presetId, agentId) => ({
  ...templateEntry,
  entryId: `importance-benchmark-${presetId}`,
  agentId,
  memoryId,
  memoryKind: MEMORY_NODE_KINDS.workingMemory,
  signals: {
    taskRelevance: roundSignal(templateEntry.signals.taskRelevance ?? 0.74),
    recency: roundSignal(templateEntry.signals.recency ?? 0.68),
  },
  lastUpdatedAt: BENCHMARK_CAPTURED_AT,
});

const createRepresentativeBenchmarkUpdate = (fixture) => {
  const { graph, presetId } = fixture;
  const workingMemory = graph.youngGeneration.workingMemory;
  const shortTermMemory = graph.youngGeneration.shortTermMemory;
  const importanceIndex = graph.youngGeneration.importanceIndex;

  assert.ok(
    workingMemory.length >= 2,
    `Representative preset "${presetId}" must include at least two working memories.`,
  );
  assert.ok(
    shortTermMemory.length >= 2,
    `Representative preset "${presetId}" must include at least two short-term memories.`,
  );

  const modifiedWorkingMemory = workingMemory[0];
  const reusedWorkingMemory = workingMemory[1];
  const removedShortTermMemory = shortTermMemory[0];
  const reusedShortTermMemory = shortTermMemory[1];
  const modifiedWorkingMemoryId = modifiedWorkingMemory.record.memoryId;
  const removedShortTermMemoryId = removedShortTermMemory.record.memoryId;
  const addedWorkingMemoryId = `memory-benchmark-${presetId}`;
  const modifiedImportanceEntry = importanceIndex.find(
    (entry) =>
      entry.memoryId === modifiedWorkingMemoryId &&
      entry.memoryKind === MEMORY_NODE_KINDS.workingMemory,
  );
  const addedImportanceTemplate =
    modifiedImportanceEntry ??
    importanceIndex.find(
      (entry) => entry.memoryKind === MEMORY_NODE_KINDS.workingMemory,
    );

  assert.ok(
    modifiedImportanceEntry,
    `Representative preset "${presetId}" must include a working-memory importance entry for the modified memory.`,
  );
  assert.ok(
    addedImportanceTemplate,
    `Representative preset "${presetId}" must include a working-memory importance entry template.`,
  );

  return {
    addedWorkingMemoryId,
    modifiedWorkingMemoryId,
    removedShortTermMemoryId,
    reusedWorkingMemoryId: reusedWorkingMemory.record.memoryId,
    reusedShortTermMemoryId: reusedShortTermMemory.record.memoryId,
    workingMemory: [
      createBenchmarkModifiedWorkingMemory(modifiedWorkingMemory, presetId),
      ...workingMemory.slice(1),
      createBenchmarkAddedWorkingMemory(
        modifiedWorkingMemory,
        addedWorkingMemoryId,
        presetId,
      ),
    ],
    shortTermMemory: shortTermMemory.slice(1),
    importanceIndex: [
      ...importanceIndex.flatMap((entry) => {
        if (
          entry.memoryId === removedShortTermMemoryId &&
          entry.memoryKind === MEMORY_NODE_KINDS.shortTermMemory
        ) {
          return [];
        }

        if (
          entry.memoryId === modifiedWorkingMemoryId &&
          entry.memoryKind === MEMORY_NODE_KINDS.workingMemory
        ) {
          return [createBenchmarkModifiedImportanceEntry(entry)];
        }

        return [entry];
      }),
      createBenchmarkAddedImportanceEntry(
        addedImportanceTemplate,
        addedWorkingMemoryId,
        presetId,
        fixture.identity.agentId,
      ),
    ],
  };
};

test(
  "representative memory fixtures exercise incremental graph reconstruction within idle budgets and record end-to-end timings",
  async (t) => {
    const reports = [];

    assert.deepEqual(
      REPRESENTATIVE_PRESET_IDS,
      Object.keys(REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS),
    );
    assert.deepEqual(
      REPRESENTATIVE_PRESET_IDS,
      Object.keys(REPRESENTATIVE_INCREMENTAL_IDLE_BUDGETS_MS),
    );

    for (const presetId of REPRESENTATIVE_PRESET_IDS) {
      await t.test(`incremental benchmark: ${presetId}`, (t) => {
        const fixture = createRepresentativeTargetMemorySetFixture({
          preset: presetId,
        });
        const update = createRepresentativeBenchmarkUpdate(fixture);
        const savedState = saveYoungGenerationGraphState(fixture.graph);
        const reconstructionBudget = createRepresentativeIdleBudget(
          REPRESENTATIVE_INCREMENTAL_IDLE_BUDGETS_MS[presetId],
        );
        const coldGraph = createMemoryGraph(fixture.identity, {
          workingMemory: update.workingMemory,
          shortTermMemory: update.shortTermMemory,
          importanceIndex: update.importanceIndex,
          longTermMemory: fixture.graph.oldGeneration.longTermMemory,
          archivedMemory: fixture.graph.oldGeneration.archivedMemory,
          memoryEvidence: fixture.graph.oldGeneration.memoryEvidence,
          consolidationJournal: fixture.graph.oldGeneration.consolidationJournal,
          edges: fixture.graph.edges,
        });
        const startedAtMs = globalThis.performance.now();
        const rebuiltGraph = rebuildMemoryGraph(fixture.graph, {
          workingMemory: update.workingMemory,
          shortTermMemory: update.shortTermMemory,
          importanceIndex: update.importanceIndex,
          reconstructionBudget,
          persistedGraphStateReconstructionMetadata:
            savedState.constructionMetadata.reconstructionMetadata,
          persistedGraphStateReuseState: savedState,
        });
        const wallClockElapsedMs = Number(
          (globalThis.performance.now() - startedAtMs).toFixed(3),
        );
        const profile = getMemoryGraphReconstructionProfile(rebuiltGraph);
        const graphCounts = collectMemoryGraphCounts(rebuiltGraph);
        const pageRankTopology = analyzeCandidateGraphTopology({
          candidates: fixture.candidates,
          edges: fixture.pageRankEdges,
        });
        const reusedWorkingMemory = rebuiltGraph.youngGeneration.workingMemory.find(
          (memoryEnvelope) =>
            memoryEnvelope.record.memoryId === update.reusedWorkingMemoryId,
        );
        const reusedShortTermMemory =
          rebuiltGraph.youngGeneration.shortTermMemory.find(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.reusedShortTermMemoryId,
          );
        const modifiedWorkingMemory = rebuiltGraph.youngGeneration.workingMemory.find(
          (memoryEnvelope) =>
            memoryEnvelope.record.memoryId === update.modifiedWorkingMemoryId,
        );
        const previousModifiedWorkingMemory =
          savedState.youngGeneration.workingMemory.find(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.modifiedWorkingMemoryId,
          );
        const idleBudgetMs = reconstructionBudget.reconstructionBudgetMs;
        const budgetFailureMessage = formatRepresentativeIdleBudgetRegression({
          scenarioId: presetId,
          idleBudgetMs,
          wallClockElapsedMs,
          reconstructionElapsedMs: profile?.elapsedMs ?? null,
        });

        assert.deepEqual(rebuiltGraph, coldGraph);
        assert.deepEqual(
          getMemoryGraphReconstructionBudget(rebuiltGraph),
          reconstructionBudget,
        );
        assert.equal(profile?.status, "completed");
        assert.equal(profile?.targetMemorySet?.agentId, fixture.identity.agentId);
        assert.deepEqual(profile?.targetMemorySet?.replacementScopes, [
          "youngGeneration.workingMemory",
          "youngGeneration.shortTermMemory",
          "youngGeneration.importanceIndex",
        ]);
        assert.equal(
          profile?.metrics?.reconstructionDurationMs,
          profile?.elapsedMs ?? null,
        );
        assert.equal(
          profile?.metrics?.idleTriggerWindowMs,
          reconstructionBudget.idleTriggerWindowMs,
        );
        assert.ok(Number.isFinite(profile?.elapsedMs));
        assert.ok(profile.elapsedMs >= 0);
        assert.equal(profile?.withinIdleBudget, true, budgetFailureMessage);
        assert.ok(Number.isFinite(wallClockElapsedMs));
        assert.ok(wallClockElapsedMs >= 0);
        assert.ok(profile.elapsedMs <= idleBudgetMs, budgetFailureMessage);
        assert.ok(wallClockElapsedMs <= idleBudgetMs, budgetFailureMessage);
        assert.strictEqual(
          reusedWorkingMemory,
          savedState.youngGeneration.workingMemory.find(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.reusedWorkingMemoryId,
          ),
        );
        assert.strictEqual(
          reusedShortTermMemory,
          savedState.youngGeneration.shortTermMemory.find(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.reusedShortTermMemoryId,
          ),
        );
        assert.notStrictEqual(modifiedWorkingMemory, previousModifiedWorkingMemory);
        assert.equal(
          rebuiltGraph.youngGeneration.shortTermMemory.some(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.removedShortTermMemoryId,
          ),
          false,
        );
        assert.equal(
          rebuiltGraph.youngGeneration.workingMemory.some(
            (memoryEnvelope) =>
              memoryEnvelope.record.memoryId === update.addedWorkingMemoryId,
          ),
          true,
        );
        const validation = createBenchmarkValidationSummary({
          benchmarkId: presetId,
          checks: {
            workingMemoryCount: createBenchmarkEqualityCheck(
              "workingMemoryCount",
              update.workingMemory.length,
              graphCounts.workingMemoryCount,
            ),
            shortTermMemoryCount: createBenchmarkEqualityCheck(
              "shortTermMemoryCount",
              update.shortTermMemory.length,
              graphCounts.shortTermMemoryCount,
            ),
            hippocampusEntryCount: createBenchmarkEqualityCheck(
              "hippocampusEntryCount",
              update.importanceIndex.length,
              graphCounts.hippocampusEntryCount,
            ),
            longTermMemoryCount: createBenchmarkEqualityCheck(
              "longTermMemoryCount",
              fixture.graph.oldGeneration.longTermMemory.length,
              graphCounts.longTermMemoryCount,
            ),
            totalRecordCount: createBenchmarkEqualityCheck(
              "totalRecordCount",
              graphCounts.totalRecordCount,
              collectMemoryGraphCounts(coldGraph).totalRecordCount,
            ),
            graphEdgeCount: createBenchmarkEqualityCheck(
              "graphEdgeCount",
              coldGraph.edges.length,
              graphCounts.graphEdgeCount,
            ),
            sourceMemoryCount: createBenchmarkEqualityCheck(
              "sourceMemoryCount",
              fixture.metrics.sourceMemoryCount,
              pageRankTopology.candidateCount,
            ),
            pageRankEdgeCount: createBenchmarkEqualityCheck(
              "pageRankEdgeCount",
              fixture.metrics.pageRankEdgeCount,
              pageRankTopology.edgeCount,
            ),
            pageRankLinkDensity: createBenchmarkEqualityCheck(
              "pageRankLinkDensity",
              fixture.metrics.pageRankLinkDensity,
              pageRankTopology.pageRankLinkDensity,
            ),
            weaklyConnectedComponentCount: createBenchmarkEqualityCheck(
              "weaklyConnectedComponentCount",
              1,
              pageRankTopology.weaklyConnectedComponentCount,
            ),
            isolatedCandidateCount: createBenchmarkEqualityCheck(
              "isolatedCandidateCount",
              0,
              pageRankTopology.isolatedCandidateCount,
            ),
            danglingEdgeCount: createBenchmarkEqualityCheck(
              "danglingEdgeCount",
              0,
              pageRankTopology.danglingEdgeCount,
            ),
          },
        });
        const report = {
          benchmarkKind: "representative-graph-reconstruction",
          benchmarkId: presetId,
          graphSize: fixture.metrics.graphSize,
          linkDensity: fixture.metrics.linkDensity,
          validation,
          graph: {
            graphCounts,
            pageRankTopology,
          },
          performance: createComparableBenchmarkPerformanceMetrics({
            wallClockElapsedMs,
            reconstructionElapsedMs: profile?.elapsedMs ?? null,
            recordCount: graphCounts.totalRecordCount,
            candidateCount: pageRankTopology.candidateCount,
            edgeCount: pageRankTopology.edgeCount,
            stageElapsedMs: {
              rebuildWallClockMs: wallClockElapsedMs,
              rebuildProfiledMs: profile?.elapsedMs ?? null,
            },
          }),
        };

        assert.equal(validation.passed, true);
        assert.ok(report.performance.wallClockPerRecordMs !== null);
        assert.ok(report.performance.wallClockPerEdgeMs !== null);
        assert.ok(report.performance.profiledEdgesPerSecond !== null);

        reports.push(report);
        t.diagnostic(`representative reconstruction benchmark ${JSON.stringify(report)}`);
      });
    }

    const aggregateReport = {
      benchmarkKind: "representative-graph-reconstruction",
      presetIds: reports.map((report) => report.benchmarkId),
      validationPassed: reports.every((report) => report.validation.passed === true),
      presets: reports,
      performance: createComparableBenchmarkPerformanceMetrics({
        wallClockElapsedMs: roundDurationMs(
          sum(reports.map((report) => report.performance.wallClockElapsedMs ?? 0)),
        ),
        reconstructionElapsedMs: roundDurationMs(
          sum(
            reports.map(
              (report) => report.performance.reconstructionElapsedMs ?? 0,
            ),
          ),
        ),
        recordCount: sum(
          reports.map((report) => report.graph.graphCounts.totalRecordCount),
        ),
        candidateCount: sum(
          reports.map((report) => report.graph.pageRankTopology.candidateCount),
        ),
        edgeCount: sum(
          reports.map((report) => report.graph.pageRankTopology.edgeCount),
        ),
        stageElapsedMs: {
          rebuildWallClockMs: roundDurationMs(
            sum(
              reports.map(
                (report) =>
                  report.performance.stageElapsedMs.rebuildWallClockMs ?? 0,
              ),
            ),
          ),
          rebuildProfiledMs: roundDurationMs(
            sum(
              reports.map(
                (report) =>
                  report.performance.stageElapsedMs.rebuildProfiledMs ?? 0,
              ),
            ),
          ),
        },
      }),
    };

    assert.equal(aggregateReport.validationPassed, true);
    t.diagnostic(
      `representative incremental reconstruction benchmark report ${JSON.stringify(aggregateReport)}`,
    );
  },
);
