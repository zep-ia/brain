import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REPRESENTATIVE_BRAIN_BENCHMARK_RECONSTRUCTION_BUDGETS_MS,
  REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS,
  createRepresentativeBrainBenchmarkHarness,
} from "../test-support/representative-brain-benchmark-harness.js";

test(
  "representative brain benchmark harness reconstructs every scenario fixture end-to-end and preserves canonical graph state",
  (t) => {
    const harness = createRepresentativeBrainBenchmarkHarness();
    const result = harness.runAllScenarios();

    assert.deepEqual(harness.scenarioIds, REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS);
    assert.deepEqual(result.scenarioIds, REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS);
    assert.equal(
      result.metrics.scenarioCount,
      REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS.length,
    );
    assert.equal(result.validation.passed, true);
    assert.equal(result.metrics.validationPassed, true);
    assert.equal(result.report.validationPassed, true);
    assert.equal(
      result.report.scenarios.length,
      REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIO_IDS.length,
    );
    assert.ok(result.report.performance.wallClockPerRecordMs !== null);
    assert.ok(result.report.performance.wallClockPerEdgeMs !== null);
    assert.ok(result.report.performance.recordsPerSecond !== null);

    result.scenarios.forEach((scenarioResult) => {
      const expectedEdges = [
        ...scenarioResult.snapshots.youngGeneration.edges,
        ...scenarioResult.snapshots.oldGeneration.edges,
      ];

      assert.deepEqual(
        scenarioResult.reconstructedGraph.youngGeneration,
        scenarioResult.fixture.graph.youngGeneration,
      );
      assert.deepEqual(
        scenarioResult.reconstructedGraph.oldGeneration,
        scenarioResult.fixture.graph.oldGeneration,
      );
      assert.deepEqual(scenarioResult.reconstructedGraph.edges, expectedEdges);
      assert.deepEqual(
        scenarioResult.stages.youngGeneration.reconstructionBudget,
        scenarioResult.reconstructionBudget,
      );
      assert.deepEqual(
        scenarioResult.stages.oldGeneration.reconstructionBudget,
        scenarioResult.reconstructionBudget,
      );
      assert.equal(scenarioResult.stages.youngGeneration.profile?.status, "completed");
      assert.equal(scenarioResult.stages.oldGeneration.profile?.status, "completed");
      assert.equal(
        scenarioResult.stages.youngGeneration.profile?.graphStateDelta?.summary
          ?.unchangedCount,
        scenarioResult.stages.youngGeneration.profile?.graphStateDelta?.summary
          ?.persistedMemoryCount,
      );
      assert.equal(
        scenarioResult.stages.oldGeneration.profile?.graphStateDelta?.summary
          ?.unchangedCount,
        scenarioResult.stages.oldGeneration.profile?.graphStateDelta?.summary
          ?.persistedMemoryCount,
      );
      assert.equal(
        scenarioResult.metrics.snapshotRecordCount,
        scenarioResult.fixture.metrics.totalRecordCount,
      );
      assert.equal(
        scenarioResult.metrics.snapshotEdgeCount,
        scenarioResult.metrics.reconstructedEdgeCount,
      );
      assert.equal(scenarioResult.validation.passed, true);
      assert.equal(
        scenarioResult.report.validation.passed,
        scenarioResult.validation.passed,
      );
      assert.equal(
        scenarioResult.graphCharacteristics.graphCounts.totalRecordCount,
        scenarioResult.fixture.metrics.totalRecordCount,
      );
      assert.equal(
        scenarioResult.graphCharacteristics.pageRankTopology
          .weaklyConnectedComponentCount,
        1,
      );
      assert.equal(
        scenarioResult.graphCharacteristics.pageRankTopology.isolatedCandidateCount,
        0,
      );
      assert.ok(scenarioResult.report.performance.wallClockPerCandidateMs !== null);
      assert.ok(scenarioResult.report.performance.wallClockPerEdgeMs !== null);
      assert.ok(scenarioResult.report.performance.profiledEdgesPerSecond !== null);
      assert.equal(
        scenarioResult.metrics.pageRankCandidateCount,
        scenarioResult.fixture.metrics.pageRankCandidateCount,
      );
      assert.equal(
        scenarioResult.metrics.pageRankEdgeCount,
        scenarioResult.fixture.metrics.pageRankEdgeCount,
      );
      assert.equal(scenarioResult.promotionPlan.authorization.eligible, true);
      assert.equal(
        scenarioResult.promotionPlan.selectedPromotionCount,
        scenarioResult.fixture.metrics.topK,
      );
      assert.equal(
        scenarioResult.promotionPlan.selectedPromotionCount,
        scenarioResult.metrics.selectedPromotionCount,
      );
      assert.ok(scenarioResult.stages.youngGeneration.wallClockElapsedMs >= 0);
      assert.ok(scenarioResult.stages.oldGeneration.wallClockElapsedMs >= 0);
      assert.ok(scenarioResult.metrics.totalWallClockElapsedMs >= 0);
    });

    t.diagnostic(
      `representative brain benchmark report ${JSON.stringify(result.report)}`,
    );
  },
);

test(
  "representative brain benchmark harness records representative reconstruction timings within configured idle budgets",
  () => {
    const harness = createRepresentativeBrainBenchmarkHarness();
    const result = harness.runAllScenarios();

    assert.deepEqual(
      harness.reconstructionBudgetMsByScenario,
      DEFAULT_REPRESENTATIVE_BRAIN_BENCHMARK_RECONSTRUCTION_BUDGETS_MS,
    );
    assert.equal(result.metrics.withinReconstructionBudget, true);

    result.scenarios.forEach((scenarioResult) => {
      assert.equal(scenarioResult.metrics.withinReconstructionBudget, true);
      assert.equal(
        scenarioResult.stages.youngGeneration.profile?.withinIdleBudget,
        true,
      );
      assert.equal(
        scenarioResult.stages.oldGeneration.profile?.withinIdleBudget,
        true,
      );
      assert.equal(
        scenarioResult.report.performance.reconstructionElapsedMs !== null,
        true,
      );
      assert.ok(
        scenarioResult.stages.youngGeneration.profile?.elapsedMs <=
          scenarioResult.reconstructionBudget.reconstructionBudgetMs,
      );
      assert.ok(
        scenarioResult.stages.oldGeneration.profile?.elapsedMs <=
          scenarioResult.reconstructionBudget.reconstructionBudgetMs,
      );
    });
  },
);
