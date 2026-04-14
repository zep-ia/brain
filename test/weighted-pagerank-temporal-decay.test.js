import test from "node:test";
import assert from "node:assert/strict";

import { evaluateWeightedPageRank } from "../src/index.js";

const assertApproximatelyEqual = (
  actual,
  expected,
  tolerance = 1e-12,
) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

const HOUR_IN_MS = 60 * 60 * 1000;

test("weighted PageRank applies multiplicative exponential temporal decay to timestamped edges", () => {
  const evaluatedAt = "2026-04-14T12:00:00.000Z";
  const decayLambda = Math.log(2) / HOUR_IN_MS;
  const manualDecayedWeight = Math.exp(-decayLambda * HOUR_IN_MS);

  assertApproximatelyEqual(manualDecayedWeight, 0.5, 1e-12);

  const temporallyDecayedResult = evaluateWeightedPageRank({
    nodes: ["A", "B"],
    edges: [
      {
        from: "A",
        to: "A",
        weight: 1,
        timestamp: evaluatedAt,
      },
      {
        from: "A",
        to: "B",
        weight: 1,
        timestamp: "2026-04-14T11:00:00.000Z",
      },
      {
        from: "B",
        to: "A",
        weight: 1,
        timestamp: evaluatedAt,
      },
    ],
    decayLambda,
    evaluatedAt,
    tolerance: 1e-14,
    maxIterations: 1000,
  });
  const manualWeightResult = evaluateWeightedPageRank({
    nodes: ["A", "B"],
    edges: [
      { from: "A", to: "A", weight: 1 },
      { from: "A", to: "B", weight: manualDecayedWeight },
      { from: "B", to: "A", weight: 1 },
    ],
    tolerance: 1e-14,
    maxIterations: 1000,
  });
  const undecayedResult = evaluateWeightedPageRank({
    nodes: ["A", "B"],
    edges: [
      { from: "A", to: "A", weight: 1 },
      { from: "A", to: "B", weight: 1 },
      { from: "B", to: "A", weight: 1 },
    ],
    tolerance: 1e-14,
    maxIterations: 1000,
  });

  assert.deepEqual(
    temporallyDecayedResult.rankedNodeIds,
    manualWeightResult.rankedNodeIds,
  );
  assertApproximatelyEqual(
    temporallyDecayedResult.scores.A,
    manualWeightResult.scores.A,
    1e-12,
  );
  assertApproximatelyEqual(
    temporallyDecayedResult.scores.B,
    manualWeightResult.scores.B,
    1e-12,
  );
  assert.ok(temporallyDecayedResult.scores.A > undecayedResult.scores.A);
  assertApproximatelyEqual(temporallyDecayedResult.totalScore, 1, 1e-12);
});

test("weighted PageRank leaves untimestamped edges unchanged when temporal decay is enabled", () => {
  const baseline = evaluateWeightedPageRank({
    nodes: ["A", "B", "C"],
    edges: [
      { from: "A", to: "B", weight: 2 },
      { from: "A", to: "C", weight: 1 },
      { from: "B", to: "A", weight: 1 },
      { from: "C", to: "A", weight: 1 },
    ],
    tolerance: 1e-14,
    maxIterations: 1000,
  });
  const withDecayEnabled = evaluateWeightedPageRank({
    nodes: ["A", "B", "C"],
    edges: [
      { from: "A", to: "B", weight: 2 },
      { from: "A", to: "C", weight: 1 },
      { from: "B", to: "A", weight: 1 },
      { from: "C", to: "A", weight: 1 },
    ],
    decayLambda: Math.log(2) / HOUR_IN_MS,
    evaluatedAt: "2026-04-14T12:00:00.000Z",
    tolerance: 1e-14,
    maxIterations: 1000,
  });

  assert.deepEqual(withDecayEnabled.rankedNodeIds, baseline.rankedNodeIds);
  assertApproximatelyEqual(withDecayEnabled.scores.A, baseline.scores.A, 1e-12);
  assertApproximatelyEqual(withDecayEnabled.scores.B, baseline.scores.B, 1e-12);
  assertApproximatelyEqual(withDecayEnabled.scores.C, baseline.scores.C, 1e-12);
});
