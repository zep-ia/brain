import test from "node:test";
import assert from "node:assert/strict";

import {
  createRepresentativeBrainBenchmarkHarness,
} from "../test-support/representative-brain-benchmark-harness.js";

const formatBudgetFailures = (scenarioResults) =>
  scenarioResults
    .flatMap((scenarioResult) =>
      scenarioResult.reconstructionBudgetAssessment.failures.map(
        (failure) => failure.message,
      ),
    )
    .join(" ");

test(
  "representative load benchmark fails when graph reconstruction exceeds the idle trigger window",
  (t) => {
    const harness = createRepresentativeBrainBenchmarkHarness();
    const result = harness.runAllScenarios();
    const failureMessage = formatBudgetFailures(result.scenarios);

    assert.equal(
      result.metrics.withinReconstructionBudget,
      true,
      failureMessage,
    );
    assert.deepEqual(result.metrics.failedBudgetScenarioIds, [], failureMessage);

    result.scenarios.forEach((scenarioResult) => {
      const { reconstructionBudget, reconstructionBudgetAssessment } = scenarioResult;
      const scenarioFailureMessage =
        reconstructionBudgetAssessment.failures
          .map((failure) => failure.message)
          .join(" ") ||
        `Representative graph reconstruction stayed within the idle trigger window for "${scenarioResult.scenarioId}".`;

      assert.equal(
        reconstructionBudgetAssessment.withinReconstructionBudget,
        true,
        scenarioFailureMessage,
      );
      assert.deepEqual(
        reconstructionBudgetAssessment.failures,
        [],
        scenarioFailureMessage,
      );

      if (reconstructionBudget !== null) {
        assert.ok(
          reconstructionBudgetAssessment.totalWallClockElapsedMs <=
            reconstructionBudget.reconstructionBudgetMs,
          scenarioFailureMessage,
        );
        assert.ok(
          reconstructionBudgetAssessment.totalProfiledReconstructionElapsedMs <=
            reconstructionBudget.reconstructionBudgetMs,
          scenarioFailureMessage,
        );
      }
    });

    t.diagnostic(
      `representative load performance report ${JSON.stringify(
        result.scenarios.map((scenarioResult) => ({
          scenarioId: scenarioResult.scenarioId,
          reconstructionBudget: scenarioResult.reconstructionBudget,
          reconstructionBudgetAssessment:
            scenarioResult.reconstructionBudgetAssessment,
        })),
      )}`,
    );
  },
);
