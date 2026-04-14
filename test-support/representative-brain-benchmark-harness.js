import {
  createIdleWindowReconstructionBudget,
  createMemoryGraph,
  getMemoryGraphReconstructionBudget,
  getMemoryGraphReconstructionProfile,
  loadOldGenerationGraphState,
  loadYoungGenerationGraphState,
  planConsolidationPromotions,
  saveOldGenerationGraphState,
  saveYoungGenerationGraphState,
} from "../src/index.js";
import {
  REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS,
  createRepresentativeBrainBenchmarkFixture,
} from "./representative-brain-benchmark-fixtures.js";
import {
  analyzeCandidateGraphTopology,
  collectMemoryGraphCounts,
  createBenchmarkEqualityCheck,
  createBenchmarkRangeCheck,
  createBenchmarkValidationSummary,
  createComparableBenchmarkPerformanceMetrics,
} from "./benchmark-reporting.js";

const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const roundDurationMs = (value) => Number(value.toFixed(3));
const sum = (values) =>
  values.reduce((runningTotal, value) => runningTotal + value, 0);

const DEFAULT_RECONSTRUCTION_RESERVE_WINDOW_MS = 5;

export const REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS = freezeDeep(
  Object.keys(REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS),
);

export const DEFAULT_REPRESENTATIVE_BRAIN_BENCHMARK_RECONSTRUCTION_BUDGETS_MS =
  freezeDeep({
    "support-burst-sparse": 120,
    "handoff-wave-moderate": 200,
    "channel-history-dense": 320,
  });

const normalizeScenarioIds = (scenarioIds = REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS) => {
  if (!Array.isArray(scenarioIds)) {
    throw new TypeError("representative brain benchmark scenarios must be an array");
  }

  const normalizedScenarioIds = scenarioIds.map((scenarioId, index) => {
    if (typeof scenarioId !== "string" || scenarioId.trim().length === 0) {
      throw new TypeError(
        `representative brain benchmark scenarios[${index}] must be a non-empty string`,
      );
    }

    if (!Object.hasOwn(REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS, scenarioId)) {
      throw new TypeError(`Unknown brain benchmark scenario "${scenarioId}"`);
    }

    return scenarioId;
  });

  if (new Set(normalizedScenarioIds).size !== normalizedScenarioIds.length) {
    throw new TypeError("representative brain benchmark scenarios must be unique");
  }

  return freezeDeep([...normalizedScenarioIds]);
};

const normalizeBudgetMap = (budgetMap) => {
  if (budgetMap === undefined) {
    return DEFAULT_REPRESENTATIVE_BRAIN_BENCHMARK_RECONSTRUCTION_BUDGETS_MS;
  }

  if (budgetMap === null) {
    return null;
  }

  if (!budgetMap || typeof budgetMap !== "object" || Array.isArray(budgetMap)) {
    throw new TypeError(
      "representative brain benchmark reconstruction budgets must be an object or null",
    );
  }

  const normalizedBudgetMap = Object.fromEntries(
    Object.entries(budgetMap).map(([scenarioId, reconstructionBudgetMs]) => {
      if (!Object.hasOwn(REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS, scenarioId)) {
        throw new TypeError(`Unknown brain benchmark scenario "${scenarioId}"`);
      }

      if (
        typeof reconstructionBudgetMs !== "number" ||
        !Number.isInteger(reconstructionBudgetMs) ||
        reconstructionBudgetMs < 1
      ) {
        throw new TypeError(
          `reconstruction budget for scenario "${scenarioId}" must be a positive integer`,
        );
      }

      return [scenarioId, reconstructionBudgetMs];
    }),
  );

  return freezeDeep(normalizedBudgetMap);
};

const normalizeReserveWindowMs = (reserveWindowMs) => {
  if (reserveWindowMs === undefined) {
    return DEFAULT_RECONSTRUCTION_RESERVE_WINDOW_MS;
  }

  if (
    typeof reserveWindowMs !== "number" ||
    !Number.isInteger(reserveWindowMs) ||
    reserveWindowMs < 0
  ) {
    throw new TypeError(
      "representative brain benchmark reserveWindowMs must be a non-negative integer",
    );
  }

  return reserveWindowMs;
};

const createRepresentativeBrainBenchmarkReconstructionBudget = (
  reconstructionBudgetMs,
  reserveWindowMs,
) =>
  createIdleWindowReconstructionBudget({
    idleTriggerWindowMs: reconstructionBudgetMs + reserveWindowMs,
    reserveWindowMs,
  });

const resolveScenarioReconstructionBudget = (
  scenarioId,
  reconstructionBudgetMsByScenario,
  reserveWindowMs,
) => {
  if (reconstructionBudgetMsByScenario === null) {
    return null;
  }

  const reconstructionBudgetMs =
    reconstructionBudgetMsByScenario[scenarioId] ?? null;

  return reconstructionBudgetMs === null
    ? null
    : createRepresentativeBrainBenchmarkReconstructionBudget(
        reconstructionBudgetMs,
        reserveWindowMs,
      );
};

const countSnapshotRecords = (youngState, oldState) =>
  youngState.youngGeneration.workingMemory.length +
  youngState.youngGeneration.shortTermMemory.length +
  youngState.youngGeneration.importanceIndex.length +
  oldState.oldGeneration.longTermMemory.length +
  oldState.oldGeneration.archivedMemory.length +
  oldState.oldGeneration.memoryEvidence.length +
  oldState.oldGeneration.consolidationJournal.length;

const createReconstructionStageResult = (graph, wallClockElapsedMs) =>
  freezeDeep({
    graph,
    wallClockElapsedMs,
    reconstructionBudget: getMemoryGraphReconstructionBudget(graph),
    profile: getMemoryGraphReconstructionProfile(graph),
  });

const runReconstructionStage = (loadGraph) => {
  const startedAtMs = globalThis.performance.now();
  const graph = loadGraph();

  return createReconstructionStageResult(
    graph,
    roundDurationMs(globalThis.performance.now() - startedAtMs),
  );
};

const createScenarioReconstructionBudgetFailure = ({
  scenarioId,
  scope,
  measurement,
  elapsedMs,
  reconstructionBudget,
}) =>
  freezeDeep({
    scenarioId,
    scope,
    measurement,
    elapsedMs,
    reconstructionBudgetMs: reconstructionBudget.reconstructionBudgetMs,
    idleTriggerWindowMs: reconstructionBudget.idleTriggerWindowMs,
    reserveWindowMs: reconstructionBudget.reserveWindowMs,
    message:
      `Representative graph reconstruction exceeded the idle-trigger window ` +
      `for scenario "${scenarioId}" during ${scope} ${measurement}: ` +
      `elapsed=${elapsedMs}ms, ` +
      `budget=${reconstructionBudget.reconstructionBudgetMs}ms, ` +
      `idleTriggerWindow=${reconstructionBudget.idleTriggerWindowMs}ms, ` +
      `reserve=${reconstructionBudget.reserveWindowMs}ms.`,
  });

const createScenarioReconstructionBudgetAssessment = ({
  scenarioId,
  reconstructionBudget,
  stages,
}) => {
  const totalWallClockElapsedMs = roundDurationMs(
    stages.youngGeneration.wallClockElapsedMs +
      stages.oldGeneration.wallClockElapsedMs,
  );
  const totalProfiledReconstructionElapsedMs = roundDurationMs(
    (stages.youngGeneration.profile?.elapsedMs ?? 0) +
      (stages.oldGeneration.profile?.elapsedMs ?? 0),
  );

  if (reconstructionBudget === null) {
    return freezeDeep({
      idleTriggerWindowMs: null,
      reserveWindowMs: null,
      reconstructionBudgetMs: null,
      totalWallClockElapsedMs,
      totalProfiledReconstructionElapsedMs,
      failures: [],
      withinReconstructionBudget: null,
    });
  }

  const failures = [];
  const appendFailure = (scope, measurement, elapsedMs) => {
    if (elapsedMs <= reconstructionBudget.reconstructionBudgetMs) {
      return;
    }

    failures.push(
      createScenarioReconstructionBudgetFailure({
        scenarioId,
        scope,
        measurement,
        elapsedMs,
        reconstructionBudget,
      }),
    );
  };

  appendFailure(
    "youngGeneration",
    "wall-clock",
    stages.youngGeneration.wallClockElapsedMs,
  );
  appendFailure(
    "youngGeneration",
    "profiled",
    stages.youngGeneration.profile?.elapsedMs ?? 0,
  );
  appendFailure(
    "oldGeneration",
    "wall-clock",
    stages.oldGeneration.wallClockElapsedMs,
  );
  appendFailure(
    "oldGeneration",
    "profiled",
    stages.oldGeneration.profile?.elapsedMs ?? 0,
  );
  appendFailure("graph", "wall-clock", totalWallClockElapsedMs);
  appendFailure("graph", "profiled", totalProfiledReconstructionElapsedMs);

  return freezeDeep({
    idleTriggerWindowMs: reconstructionBudget.idleTriggerWindowMs,
    reserveWindowMs: reconstructionBudget.reserveWindowMs,
    reconstructionBudgetMs: reconstructionBudget.reconstructionBudgetMs,
    totalWallClockElapsedMs,
    totalProfiledReconstructionElapsedMs,
    failures,
    withinReconstructionBudget: failures.length === 0,
  });
};

const createScenarioGraphCharacteristics = (fixture, reconstructedGraph) =>
  freezeDeep({
    densityLabel: fixture.metrics.densityLabel,
    graphCounts: collectMemoryGraphCounts(reconstructedGraph),
    pageRankTopology: analyzeCandidateGraphTopology({
      candidates: fixture.candidates,
      edges: fixture.pageRankEdges,
    }),
  });

const createScenarioValidation = ({ scenarioId, fixture, metrics, graphCharacteristics }) =>
  createBenchmarkValidationSummary({
    benchmarkId: scenarioId,
    checks: freezeDeep({
      workingMemoryCount: createBenchmarkEqualityCheck(
        "workingMemoryCount",
        fixture.metrics.workingMemoryCount,
        graphCharacteristics.graphCounts.workingMemoryCount,
      ),
      shortTermMemoryCount: createBenchmarkEqualityCheck(
        "shortTermMemoryCount",
        fixture.metrics.shortTermMemoryCount,
        graphCharacteristics.graphCounts.shortTermMemoryCount,
      ),
      hippocampusEntryCount: createBenchmarkEqualityCheck(
        "hippocampusEntryCount",
        fixture.metrics.hippocampusEntryCount,
        graphCharacteristics.graphCounts.hippocampusEntryCount,
      ),
      longTermMemoryCount: createBenchmarkEqualityCheck(
        "longTermMemoryCount",
        fixture.metrics.longTermMemoryCount,
        graphCharacteristics.graphCounts.longTermMemoryCount,
      ),
      archivedMemoryCount: createBenchmarkEqualityCheck(
        "archivedMemoryCount",
        fixture.metrics.archivedMemoryCount,
        graphCharacteristics.graphCounts.archivedMemoryCount,
      ),
      memoryEvidenceCount: createBenchmarkEqualityCheck(
        "memoryEvidenceCount",
        fixture.metrics.memoryEvidenceCount,
        graphCharacteristics.graphCounts.memoryEvidenceCount,
      ),
      consolidationJournalCount: createBenchmarkEqualityCheck(
        "consolidationJournalCount",
        fixture.metrics.consolidationJournalCount,
        graphCharacteristics.graphCounts.consolidationJournalCount,
      ),
      totalRecordCount: createBenchmarkEqualityCheck(
        "totalRecordCount",
        fixture.metrics.totalRecordCount,
        graphCharacteristics.graphCounts.totalRecordCount,
      ),
      snapshotRecordCount: createBenchmarkEqualityCheck(
        "snapshotRecordCount",
        fixture.metrics.totalRecordCount,
        metrics.snapshotRecordCount,
      ),
      graphEdgeCount: createBenchmarkEqualityCheck(
        "graphEdgeCount",
        metrics.snapshotEdgeCount,
        graphCharacteristics.graphCounts.graphEdgeCount,
      ),
      snapshotEdgeCount: createBenchmarkEqualityCheck(
        "snapshotEdgeCount",
        graphCharacteristics.graphCounts.graphEdgeCount,
        metrics.snapshotEdgeCount,
      ),
      reconstructedEdgeCount: createBenchmarkEqualityCheck(
        "reconstructedEdgeCount",
        metrics.snapshotEdgeCount,
        metrics.reconstructedEdgeCount,
      ),
      pageRankCandidateCount: createBenchmarkEqualityCheck(
        "pageRankCandidateCount",
        fixture.metrics.pageRankCandidateCount,
        graphCharacteristics.pageRankTopology.candidateCount,
      ),
      pageRankEdgeCount: createBenchmarkEqualityCheck(
        "pageRankEdgeCount",
        fixture.metrics.pageRankEdgeCount,
        graphCharacteristics.pageRankTopology.edgeCount,
      ),
      pageRankLinkDensity: createBenchmarkEqualityCheck(
        "pageRankLinkDensity",
        fixture.metrics.pageRankLinkDensity,
        graphCharacteristics.pageRankTopology.pageRankLinkDensity,
      ),
      pageRankLinkDensityRange: createBenchmarkRangeCheck(
        "pageRankLinkDensityRange",
        graphCharacteristics.pageRankTopology.pageRankLinkDensity,
        fixture.scenario.connectivityProfile.densityRange,
      ),
      weaklyConnectedComponentCount: createBenchmarkEqualityCheck(
        "weaklyConnectedComponentCount",
        1,
        graphCharacteristics.pageRankTopology.weaklyConnectedComponentCount,
      ),
      isolatedCandidateCount: createBenchmarkEqualityCheck(
        "isolatedCandidateCount",
        0,
        graphCharacteristics.pageRankTopology.isolatedCandidateCount,
      ),
      danglingEdgeCount: createBenchmarkEqualityCheck(
        "danglingEdgeCount",
        0,
        graphCharacteristics.pageRankTopology.danglingEdgeCount,
      ),
    }),
  });

const createScenarioReport = ({
  scenarioId,
  fixture,
  graphCharacteristics,
  reconstructionBudgetAssessment,
  validation,
  metrics,
  stages,
  promotionPlan,
}) => {
  const profiledReconstructionElapsedMs = roundDurationMs(
    (stages.youngGeneration.profile?.elapsedMs ?? 0) +
      (stages.oldGeneration.profile?.elapsedMs ?? 0),
  );

  return freezeDeep({
    benchmarkKind: "representative-brain-benchmark",
    benchmarkId: scenarioId,
    scenarioLabel: fixture.scenario.label,
    densityLabel: graphCharacteristics.densityLabel,
    validation,
    graph: graphCharacteristics,
    promotion: {
      topK: fixture.metrics.topK,
      selectedPromotionCount: promotionPlan.selectedPromotionCount,
      deferredPromotionCount: promotionPlan.deferredCount,
    },
    reconstructionBudgetAssessment,
    performance: createComparableBenchmarkPerformanceMetrics({
      wallClockElapsedMs: metrics.totalWallClockElapsedMs,
      reconstructionElapsedMs: profiledReconstructionElapsedMs,
      recordCount: graphCharacteristics.graphCounts.totalRecordCount,
      candidateCount: graphCharacteristics.pageRankTopology.candidateCount,
      edgeCount: graphCharacteristics.pageRankTopology.edgeCount,
      selectedPromotionCount: promotionPlan.selectedPromotionCount,
      stageElapsedMs: {
        youngGenerationWallClockMs: stages.youngGeneration.wallClockElapsedMs,
        oldGenerationWallClockMs: stages.oldGeneration.wallClockElapsedMs,
        youngGenerationProfiledMs: stages.youngGeneration.profile?.elapsedMs ?? null,
        oldGenerationProfiledMs: stages.oldGeneration.profile?.elapsedMs ?? null,
      },
    }),
  });
};

const createAggregateValidation = (scenarioResults) => {
  const failedScenarioIds = scenarioResults
    .filter((result) => result.validation.passed === false)
    .map((result) => result.scenarioId);

  return freezeDeep({
    passed: failedScenarioIds.length === 0,
    failedScenarioIds,
  });
};

const createAggregateReport = (scenarioResults) => {
  const totalRecordCount = sum(
    scenarioResults.map((result) => result.report.graph.graphCounts.totalRecordCount),
  );
  const totalCandidateCount = sum(
    scenarioResults.map(
      (result) => result.report.graph.pageRankTopology.candidateCount,
    ),
  );
  const totalEdgeCount = sum(
    scenarioResults.map((result) => result.report.graph.pageRankTopology.edgeCount),
  );
  const totalReconstructionElapsedMs = roundDurationMs(
    sum(
      scenarioResults.map(
        (result) => result.report.performance.reconstructionElapsedMs ?? 0,
      ),
    ),
  );

  return freezeDeep({
    benchmarkKind: "representative-brain-benchmark",
    scenarioIds: scenarioResults.map((result) => result.scenarioId),
    validationPassed: scenarioResults.every(
      (result) => result.validation.passed === true,
    ),
    scenarios: scenarioResults.map((result) => result.report),
    performance: createComparableBenchmarkPerformanceMetrics({
      wallClockElapsedMs: roundDurationMs(
        sum(
          scenarioResults.map(
            (result) => result.report.performance.wallClockElapsedMs ?? 0,
          ),
        ),
      ),
      reconstructionElapsedMs: totalReconstructionElapsedMs,
      recordCount: totalRecordCount,
      candidateCount: totalCandidateCount,
      edgeCount: totalEdgeCount,
      selectedPromotionCount: sum(
        scenarioResults.map((result) => result.promotionPlan.selectedPromotionCount),
      ),
      stageElapsedMs: {
        youngGenerationWallClockMs: roundDurationMs(
          sum(
            scenarioResults.map(
              (result) => result.stages.youngGeneration.wallClockElapsedMs,
            ),
          ),
        ),
        oldGenerationWallClockMs: roundDurationMs(
          sum(
            scenarioResults.map(
              (result) => result.stages.oldGeneration.wallClockElapsedMs,
            ),
          ),
        ),
      },
    }),
  });
};

const createAggregateMetrics = (scenarioResults) => {
  const totalWallClockElapsedMs = roundDurationMs(
    sum(scenarioResults.map((result) => result.metrics.totalWallClockElapsedMs)),
  );
  const failedBudgetScenarioIds = scenarioResults
    .filter((result) => result.reconstructionBudgetAssessment.withinReconstructionBudget === false)
    .map((result) => result.scenarioId);
  const withinReconstructionBudget = scenarioResults.every(
    (result) => result.metrics.withinReconstructionBudget !== false,
  )
    ? scenarioResults.some(
        (result) => result.metrics.withinReconstructionBudget === null,
      )
      ? null
      : true
    : false;

  return freezeDeep({
    scenarioCount: scenarioResults.length,
    totalSnapshotRecordCount: sum(
      scenarioResults.map((result) => result.metrics.snapshotRecordCount),
    ),
    totalSnapshotEdgeCount: sum(
      scenarioResults.map((result) => result.metrics.snapshotEdgeCount),
    ),
    totalPageRankCandidateCount: sum(
      scenarioResults.map((result) => result.metrics.pageRankCandidateCount),
    ),
    totalPageRankEdgeCount: sum(
      scenarioResults.map((result) => result.metrics.pageRankEdgeCount),
    ),
    totalSelectedPromotionCount: sum(
      scenarioResults.map((result) => result.metrics.selectedPromotionCount),
    ),
    totalWallClockElapsedMs,
    totalProfiledReconstructionElapsedMs: roundDurationMs(
      sum(
        scenarioResults.map(
          (result) =>
            result.reconstructionBudgetAssessment.totalProfiledReconstructionElapsedMs,
        ),
      ),
    ),
    totalReconstructionWallClockElapsedMs: roundDurationMs(
      sum(
        scenarioResults.map(
          (result) =>
            result.reconstructionBudgetAssessment.totalWallClockElapsedMs,
        ),
      ),
    ),
    maxScenarioWallClockElapsedMs: Math.max(
      ...scenarioResults.map((result) => result.metrics.totalWallClockElapsedMs),
    ),
    failedBudgetScenarioIds,
    withinReconstructionBudget,
    validationPassed: scenarioResults.every(
      (result) => result.validation.passed === true,
    ),
  });
};

export const runRepresentativeBrainBenchmarkScenario = (options = {}) => {
  const scenarioId = options.scenario ?? "handoff-wave-moderate";
  const reserveWindowMs = normalizeReserveWindowMs(options.reserveWindowMs);
  const reconstructionBudgetMsByScenario = normalizeBudgetMap(
    options.reconstructionBudgetMsByScenario,
  );
  const reconstructionBudget = resolveScenarioReconstructionBudget(
    scenarioId,
    reconstructionBudgetMsByScenario,
    reserveWindowMs,
  );
  const fixture = createRepresentativeBrainBenchmarkFixture({
    scenario: scenarioId,
    agentId: options.agentId,
  });
  const youngState = saveYoungGenerationGraphState(fixture.graph);
  const oldState = saveOldGenerationGraphState(fixture.graph);
  const shellGraph = createMemoryGraph(fixture.identity);
  const totalStartedAtMs = globalThis.performance.now();
  const youngGeneration = runReconstructionStage(() =>
    loadYoungGenerationGraphState(shellGraph, youngState, {
      reconstructionBudget,
    }),
  );
  const oldGeneration = runReconstructionStage(() =>
    loadOldGenerationGraphState(youngGeneration.graph, oldState, {
      reconstructionBudget,
    }),
  );
  const reconstructedGraph = oldGeneration.graph;
  const promotionPlan = planConsolidationPromotions(reconstructedGraph, {
    candidates: fixture.candidates,
    edges: fixture.pageRankEdges,
    topK: fixture.metrics.topK,
    runtimePhase: fixture.runtime.runtimePhase,
  });
  const totalWallClockElapsedMs = roundDurationMs(
    globalThis.performance.now() - totalStartedAtMs,
  );
  const stages = freezeDeep({
    youngGeneration,
    oldGeneration,
  });
  const reconstructionBudgetAssessment = createScenarioReconstructionBudgetAssessment({
    scenarioId,
    reconstructionBudget,
    stages,
  });
  const metrics = freezeDeep({
    snapshotRecordCount: countSnapshotRecords(youngState, oldState),
    snapshotEdgeCount: youngState.edges.length + oldState.edges.length,
    reconstructedEdgeCount: reconstructedGraph.edges.length,
    pageRankCandidateCount: fixture.metrics.pageRankCandidateCount,
    pageRankEdgeCount: fixture.pageRankEdges.length,
    selectedPromotionCount: promotionPlan.selectedPromotionCount,
    deferredPromotionCount: promotionPlan.deferredCount,
    totalWallClockElapsedMs,
    totalReconstructionWallClockElapsedMs:
      reconstructionBudgetAssessment.totalWallClockElapsedMs,
    totalProfiledReconstructionElapsedMs:
      reconstructionBudgetAssessment.totalProfiledReconstructionElapsedMs,
    withinReconstructionBudget:
      reconstructionBudgetAssessment.withinReconstructionBudget,
  });
  const graphCharacteristics = createScenarioGraphCharacteristics(
    fixture,
    reconstructedGraph,
  );
  const validation = createScenarioValidation({
    scenarioId,
    fixture,
    metrics,
    graphCharacteristics,
  });
  const report = createScenarioReport({
    scenarioId,
    fixture,
    graphCharacteristics,
    reconstructionBudgetAssessment,
    validation,
    metrics,
    stages,
    promotionPlan,
  });

  return freezeDeep({
    scenarioId,
    fixture,
    snapshots: {
      youngGeneration: youngState,
      oldGeneration: oldState,
    },
    reconstructionBudget,
    reconstructionBudgetAssessment,
    reconstructedGraph,
    stages,
    promotionPlan,
    graphCharacteristics,
    validation,
    report,
    metrics,
  });
};

export const createRepresentativeBrainBenchmarkHarness = (options = {}) => {
  const scenarioIds = normalizeScenarioIds(options.scenarios);
  const reconstructionBudgetMsByScenario = normalizeBudgetMap(
    options.reconstructionBudgetMsByScenario,
  );
  const reserveWindowMs = normalizeReserveWindowMs(options.reserveWindowMs);

  const runScenario = (scenarioOptions = {}) =>
    runRepresentativeBrainBenchmarkScenario({
      ...scenarioOptions,
      reserveWindowMs,
      reconstructionBudgetMsByScenario,
    });

  const runAllScenarios = (scenarioOptions = {}) => {
    const scenarioResults = scenarioIds.map((scenarioId) =>
      runScenario({
        ...scenarioOptions,
        scenario: scenarioId,
      }),
    );

    return freezeDeep({
      scenarioIds,
      scenarios: scenarioResults,
      validation: createAggregateValidation(scenarioResults),
      report: createAggregateReport(scenarioResults),
      metrics: createAggregateMetrics(scenarioResults),
    });
  };

  return freezeDeep({
    scenarioIds,
    reconstructionBudgetMsByScenario,
    reserveWindowMs,
    runScenario,
    runAllScenarios,
  });
};
