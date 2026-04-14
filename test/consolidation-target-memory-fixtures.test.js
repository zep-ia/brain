import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateConsolidationPromotionPageRank,
  planConsolidationPromotions,
  selectTopKConsolidationPromotions,
} from "../src/index.js";
import {
  REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS,
  createIncrementalTargetMemorySetFixture,
  createRepresentativeTargetMemorySetFixture,
} from "../test-support/consolidation-target-memory-fixtures.js";

const PRESET_IDS = ["small-sparse", "medium-moderate", "large-dense"];

test("representative target-memory fixtures span realistic graph sizes and density tiers while remaining usable by the promotion pipeline", () => {
  const fixtures = PRESET_IDS.map((presetId) =>
    createRepresentativeTargetMemorySetFixture({ preset: presetId }),
  );
  const candidateCounts = fixtures.map((fixture) => fixture.candidates.length);
  const linkDensities = fixtures.map(
    (fixture) => fixture.metrics.pageRankLinkDensity,
  );

  assert.deepEqual(
    candidateCounts,
    PRESET_IDS.map(
      (presetId) =>
        REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS[presetId].sourceTopicSlugs.length,
    ),
  );
  assert.ok(candidateCounts[0] < candidateCounts[1]);
  assert.ok(candidateCounts[1] < candidateCounts[2]);
  assert.ok(linkDensities[0] < linkDensities[1]);
  assert.ok(linkDensities[1] < linkDensities[2]);

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

    assert.equal(fixture.graph.agentId, fixture.identity.agentId);
    assert.equal(fixture.sourceMemoryIds.length, fixture.candidates.length);
    assert.equal(
      fixture.graph.youngGeneration.workingMemory.every(
        (memoryEnvelope) => memoryEnvelope.inactiveForRetrieval === true,
      ),
      true,
    );
    assert.equal(
      fixture.graph.youngGeneration.shortTermMemory.every(
        (memoryEnvelope) => memoryEnvelope.inactiveForRetrieval === true,
      ),
      true,
    );
    fixture.pageRankEdges.forEach((edge) => {
      assert.equal(knownCandidateIds.has(edge.fromCandidateId), true);
      assert.equal(knownCandidateIds.has(edge.toCandidateId), true);
      assert.ok(edge.weight > 0);
    });
    assert.equal(ranking.rankedCandidateIds.length, fixture.candidates.length);
    assert.equal(selection.selectedCandidates.length, fixture.metrics.topK);
    assert.equal(
      selection.overflowCandidates.length,
      fixture.candidates.length - fixture.metrics.topK,
    );
    assert.equal(plan.authorization.eligible, true);
    assert.ok(plan.selectedPromotionCount > 0);
    assert.ok(plan.selectedPromotionCount <= fixture.metrics.topK);
    plan.selectedPromotions.forEach((selectionEntry) => {
      assert.equal(
        fixture.sourceMemoryIds.includes(selectionEntry.candidate.sourceMemoryId),
        true,
      );
    });
  });
});

test("incremental target-memory fixtures preserve stable source ids while modeling realistic additions removals and edge reweighting", () => {
  const fixture = createIncrementalTargetMemorySetFixture();
  const baseSecretCandidate = fixture.base.candidates.find(
    (candidate) => candidate.candidateId === "promo-secret-boundary",
  );
  const nextSecretCandidate = fixture.next.candidates.find(
    (candidate) => candidate.candidateId === "promo-secret-boundary",
  );
  const baseRanking = evaluateConsolidationPromotionPageRank({
    candidates: fixture.base.candidates,
    edges: fixture.base.pageRankEdges,
  });
  const nextRanking = evaluateConsolidationPromotionPageRank({
    candidates: fixture.next.candidates,
    edges: fixture.next.pageRankEdges,
  });
  const basePlan = planConsolidationPromotions(fixture.base.graph, {
    candidates: fixture.base.candidates,
    edges: fixture.base.pageRankEdges,
    topK: fixture.base.metrics.topK,
    runtimePhase: fixture.base.runtime.runtimePhase,
  });
  const nextPlan = planConsolidationPromotions(fixture.next.graph, {
    candidates: fixture.next.candidates,
    edges: fixture.next.pageRankEdges,
    topK: fixture.next.metrics.topK,
    runtimePhase: fixture.next.runtime.runtimePhase,
  });

  assert.equal(fixture.scenarioId, "incremental-update");
  assert.deepEqual(fixture.delta.addedSourceMemoryIds, [
    "memory-incident-playbook",
    "memory-retention-window",
  ]);
  assert.deepEqual(fixture.delta.removedSourceMemoryIds, [
    "memory-scheduler-window",
  ]);
  assert.equal(
    fixture.delta.retainedSourceMemoryIds.includes("memory-secret-boundary"),
    true,
  );
  assert.equal(
    fixture.delta.modifiedSourceMemoryIds.includes("memory-secret-boundary"),
    true,
  );
  assert.equal(
    fixture.delta.modifiedSourceMemoryIds.includes("memory-archival-threshold"),
    true,
  );
  assert.equal(
    fixture.delta.reweightedEdgePairs.includes(
      "promo-rollout-blocker->promo-secret-boundary",
    ),
    true,
  );
  assert.equal(
    fixture.delta.addedEdgePairs.includes(
      "promo-team-idle-signal->promo-retention-window",
    ),
    true,
  );
  fixture.delta.modifiedSourceMemoryIds.forEach((memoryId) => {
    assert.equal(fixture.base.sourceMemoryIds.includes(memoryId), true);
    assert.equal(fixture.next.sourceMemoryIds.includes(memoryId), true);
  });
  assert.equal(basePlan.authorization.eligible, true);
  assert.equal(nextPlan.authorization.eligible, true);
  assert.ok(basePlan.selectedPromotionCount > 0);
  assert.ok(nextPlan.selectedPromotionCount > 0);
  assert.equal(baseSecretCandidate?.sourceMemoryId, "memory-secret-boundary");
  assert.equal(nextSecretCandidate?.sourceMemoryId, "memory-secret-boundary");
  assert.ok(
    nextSecretCandidate.signals.youngGeneration.importance.signals.taskRelevance >
      baseSecretCandidate.signals.youngGeneration.importance.signals.taskRelevance,
  );
  assert.ok(
    nextSecretCandidate.signals.youngGeneration.stability.signals.repeatedRecall >
      baseSecretCandidate.signals.youngGeneration.stability.signals.repeatedRecall,
  );
  assert.ok(
    nextRanking.scoresByCandidateId["promo-secret-boundary"] >
      baseRanking.scoresByCandidateId["promo-secret-boundary"],
  );
});
