import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateConsolidationPromotionPageRank,
  planConsolidationPromotions,
  selectTopKConsolidationPromotions,
} from "../src/index.js";
import {
  REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS,
  createRepresentativeBrainBenchmarkFixture,
} from "../test-support/representative-brain-benchmark-fixtures.js";

const SCENARIO_IDS = [
  "support-burst-sparse",
  "handoff-wave-moderate",
  "channel-history-dense",
];

test("representative brain benchmark scenarios define increasing volume tiers and bounded connectivity targets", () => {
  assert.deepEqual(Object.keys(REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS), SCENARIO_IDS);

  const scenarios = SCENARIO_IDS.map(
    (scenarioId) => REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS[scenarioId],
  );
  const candidateCounts = scenarios.map(
    (scenario) =>
      scenario.volumeProfile.workingMemoryCount +
      scenario.volumeProfile.shortTermMemoryCount,
  );
  const totalRecordCounts = scenarios.map(
    (scenario) =>
      scenario.volumeProfile.workingMemoryCount +
      scenario.volumeProfile.shortTermMemoryCount +
      scenario.volumeProfile.longTermMemoryCount +
      scenario.volumeProfile.archivedMemoryCount +
      scenario.volumeProfile.memoryEvidenceCount +
      scenario.volumeProfile.consolidationJournalCount,
  );
  const minimumDensities = scenarios.map(
    (scenario) => scenario.connectivityProfile.densityRange.min,
  );

  assert.ok(candidateCounts[0] < candidateCounts[1]);
  assert.ok(candidateCounts[1] < candidateCounts[2]);
  assert.ok(totalRecordCounts[0] < totalRecordCounts[1]);
  assert.ok(totalRecordCounts[1] < totalRecordCounts[2]);
  assert.ok(minimumDensities[0] < minimumDensities[1]);
  assert.ok(minimumDensities[1] < minimumDensities[2]);

  scenarios.forEach((scenario) => {
    assert.ok(scenario.topK > 0);
    assert.ok(scenario.durableTargetCoverage > 0);
    assert.ok(scenario.durableTargetCoverage < 1);
    assert.ok(
      scenario.connectivityProfile.densityRange.min <
        scenario.connectivityProfile.densityRange.max,
    );
    assert.ok(scenario.volumeProfile.memoryEvidenceCount > 0);
    assert.ok(scenario.volumeProfile.consolidationJournalCount > 0);
  });
});

test("representative brain benchmark fixtures deterministically generate realistic node-type volumes", () => {
  SCENARIO_IDS.forEach((scenarioId) => {
    const fixture = createRepresentativeBrainBenchmarkFixture({
      scenario: scenarioId,
    });
    const repeatedFixture = createRepresentativeBrainBenchmarkFixture({
      scenario: scenarioId,
    });
    const scenario = REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS[scenarioId];

    assert.deepEqual(fixture, repeatedFixture);
    assert.equal(fixture.scenarioId, scenarioId);
    assert.equal(
      fixture.graph.youngGeneration.workingMemory.length,
      scenario.volumeProfile.workingMemoryCount,
    );
    assert.equal(
      fixture.graph.youngGeneration.shortTermMemory.length,
      scenario.volumeProfile.shortTermMemoryCount,
    );
    assert.equal(
      fixture.graph.youngGeneration.importanceIndex.length,
      scenario.volumeProfile.workingMemoryCount +
        scenario.volumeProfile.shortTermMemoryCount,
    );
    assert.equal(
      fixture.graph.oldGeneration.longTermMemory.length,
      scenario.volumeProfile.longTermMemoryCount,
    );
    assert.equal(
      fixture.graph.oldGeneration.archivedMemory.length,
      scenario.volumeProfile.archivedMemoryCount,
    );
    assert.equal(
      fixture.graph.oldGeneration.memoryEvidence.length,
      scenario.volumeProfile.memoryEvidenceCount,
    );
    assert.equal(
      fixture.graph.oldGeneration.consolidationJournal.length,
      scenario.volumeProfile.consolidationJournalCount,
    );
    assert.equal(
      fixture.metrics.pageRankCandidateCount,
      scenario.volumeProfile.workingMemoryCount +
        scenario.volumeProfile.shortTermMemoryCount,
    );
    assert.equal(
      fixture.metrics.hippocampusEntryCount,
      fixture.metrics.pageRankCandidateCount,
    );
    assert.equal(fixture.metrics.withinWorkingMemoryTokenCap, true);
    assert.ok(fixture.metrics.estimatedYoungGenerationTokens > 0);
    assert.ok(
      fixture.metrics.estimatedYoungGenerationTokens <
        fixture.metrics.estimatedLongTermTokens * 2,
    );
    assert.ok(fixture.metrics.durableTargetCount > 0);
    assert.ok(fixture.metrics.durableTargetCount < fixture.metrics.pageRankCandidateCount);
    assert.ok(
      fixture.candidateTopology.some((entry) => entry.hasDurableTarget),
    );
    assert.ok(
      fixture.candidateTopology.some((entry) => entry.hasDurableTarget === false),
    );
  });
});

test("representative brain benchmark fixtures preserve connectivity distributions and remain usable by PageRank promotion planning", () => {
  const fixtures = SCENARIO_IDS.map((scenarioId) =>
    createRepresentativeBrainBenchmarkFixture({
      scenario: scenarioId,
    }),
  );
  const observedDensities = fixtures.map(
    (fixture) => fixture.metrics.pageRankLinkDensity,
  );

  assert.ok(observedDensities[0] < observedDensities[1]);
  assert.ok(observedDensities[1] < observedDensities[2]);

  fixtures.forEach((fixture) => {
    const knownCandidateIds = new Set(
      fixture.candidates.map((candidate) => candidate.candidateId),
    );
    const ranking = evaluateConsolidationPromotionPageRank({
      candidates: fixture.candidates,
      edges: fixture.pageRankEdges,
    });
    const selection = selectTopKConsolidationPromotions({
      candidates: fixture.candidates,
      edges: fixture.pageRankEdges,
      topK: fixture.metrics.topK,
    });
    const plan = planConsolidationPromotions(fixture.graph, {
      candidates: fixture.candidates,
      edges: fixture.pageRankEdges,
      topK: fixture.metrics.topK,
      runtimePhase: fixture.runtime.runtimePhase,
    });
    const {
      connectivityDistribution,
      pageRankEdgeCount,
      pageRankLinkDensity,
    } = fixture.metrics;

    fixture.pageRankEdges.forEach((edge) => {
      assert.equal(knownCandidateIds.has(edge.fromCandidateId), true);
      assert.equal(knownCandidateIds.has(edge.toCandidateId), true);
      assert.ok(edge.weight > 0);
    });

    assert.equal(
      connectivityDistribution.intraClusterEdges +
        connectivityDistribution.crossClusterEdges,
      pageRankEdgeCount,
    );
    assert.equal(
      connectivityDistribution.anchorFanOutEdges +
        connectivityDistribution.peerEdges,
      connectivityDistribution.intraClusterEdges,
    );
    assert.equal(
      connectivityDistribution.anchorBridgeEdges +
        connectivityDistribution.longRangeEdges,
      connectivityDistribution.crossClusterEdges,
    );
    assert.ok(connectivityDistribution.anchorFanOutEdges > 0);
    assert.ok(connectivityDistribution.anchorBridgeEdges > 0);
    assert.ok(connectivityDistribution.peerEdges > 0);
    assert.ok(connectivityDistribution.longRangeEdges > 0);
    assert.ok(
      pageRankLinkDensity >= fixture.scenario.connectivityProfile.densityRange.min,
    );
    assert.ok(
      pageRankLinkDensity <= fixture.scenario.connectivityProfile.densityRange.max,
    );
    assert.equal(ranking.rankedCandidateIds.length, fixture.candidates.length);
    assert.equal(selection.selectedCandidates.length, fixture.metrics.topK);
    assert.equal(plan.authorization.eligible, true);
    assert.ok(plan.selectedPromotionCount > 0);
    assert.ok(plan.selectedPromotionCount <= fixture.metrics.topK);
  });
});
