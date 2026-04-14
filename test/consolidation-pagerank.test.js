import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  evaluateConsolidationPromotionPageRank,
  evaluateWeightedPageRank,
  selectTopKConsolidationPromotions,
} from "../src/index.js";

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

const createPromotionCandidate = (candidateId, importanceScore, stabilityScore) => ({
  candidateId,
  agentId: "agent-007",
  sourceMemoryId: `${candidateId}-memory`,
  sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  signals: {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-14T01:00:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: [`importance-${candidateId}`],
        signals: {
          taskRelevance: importanceScore,
        },
      },
      stability: {
        capturedAt: "2026-04-14T01:00:00Z",
        sourceCollection: "shortTermMemory",
        sourceRecordIds: [`${candidateId}-memory`],
        signals: {
          repeatedRecall: stabilityScore,
        },
      },
    },
  },
});

test("weighted PageRank follows the exact weighted transition probabilities", () => {
  const result = evaluateWeightedPageRank({
    nodes: ["A", "B"],
    edges: [
      { from: "A", to: "A", weight: 1 },
      { from: "A", to: "B", weight: 2 },
      { from: "B", to: "A", weight: 1 },
    ],
    tolerance: 1e-14,
    maxIterations: 1000,
  });

  assert.deepEqual(result.rankedNodeIds, ["A", "B"]);
  assertApproximatelyEqual(result.scores.A, 0.5904255319148937, 1e-10);
  assertApproximatelyEqual(result.scores.B, 0.4095744680851064, 1e-10);
  assertApproximatelyEqual(result.totalScore, 1, 1e-12);
});

test("weighted PageRank redistributes sink mass through the personalization vector", () => {
  const result = evaluateWeightedPageRank({
    nodes: ["A", "B", "C"],
    personalization: {
      A: 0.7,
      B: 0.2,
      C: 0.1,
    },
  });

  assert.deepEqual(result.rankedNodeIds, ["A", "B", "C"]);
  assertApproximatelyEqual(result.scores.A, 0.7, 1e-12);
  assertApproximatelyEqual(result.scores.B, 0.2, 1e-12);
  assertApproximatelyEqual(result.scores.C, 0.1, 1e-12);
  assertApproximatelyEqual(result.totalScore, 1, 1e-12);
});

test("promotion PageRank falls back to weighted signal personalization when no graph edges exist", () => {
  const candidates = [
    createPromotionCandidate("promo-a", 0.9, 0.8),
    createPromotionCandidate("promo-b", 0.8, 0.7),
    createPromotionCandidate("promo-c", 0.6, 0.6),
  ];
  const ranking = evaluateConsolidationPromotionPageRank({ candidates });
  const selection = selectTopKConsolidationPromotions({ candidates, topK: 2 });

  assert.deepEqual(ranking.rankedCandidateIds, [
    "promo-a",
    "promo-b",
    "promo-c",
  ]);
  assertApproximatelyEqual(
    ranking.scoresByCandidateId["promo-a"],
    0.38636363636363635,
    1e-12,
  );
  assertApproximatelyEqual(
    ranking.scoresByCandidateId["promo-b"],
    0.3409090909090909,
    1e-12,
  );
  assertApproximatelyEqual(
    ranking.scoresByCandidateId["promo-c"],
    0.2727272727272727,
    1e-12,
  );
  assert.deepEqual(
    selection.selectedCandidates.map((entry) => entry.candidateId),
    ["promo-a", "promo-b"],
  );
  assert.deepEqual(
    selection.overflowCandidates.map((entry) => entry.candidateId),
    ["promo-c"],
  );
});

test("promotion PageRank applies weighted candidate transitions before Top-K selection", () => {
  const candidates = [
    createPromotionCandidate("promo-a", 0.8, 0.8),
    createPromotionCandidate("promo-b", 0.8, 0.8),
  ];
  const ranking = evaluateConsolidationPromotionPageRank({
    candidates,
    edges: [
      { fromCandidateId: "promo-a", toCandidateId: "promo-a", weight: 1 },
      { fromCandidateId: "promo-a", toCandidateId: "promo-b", weight: 1 },
      { fromCandidateId: "promo-b", toCandidateId: "promo-a", weight: 3 },
      { fromCandidateId: "promo-b", toCandidateId: "promo-b", weight: 1 },
    ],
  });

  assert.deepEqual(ranking.rankedCandidateIds, ["promo-a", "promo-b"]);
  assertApproximatelyEqual(
    ranking.scoresByCandidateId["promo-a"],
    0.5876288659793815,
    1e-10,
  );
  assertApproximatelyEqual(
    ranking.scoresByCandidateId["promo-b"],
    0.41237113402061853,
    1e-10,
  );
  assert.equal(ranking.rankedCandidates[0].candidateId, "promo-a");
  assert.equal(ranking.rankedCandidates[0].rank, 1);
});
