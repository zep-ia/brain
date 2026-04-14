import test from "node:test";
import assert from "node:assert/strict";

import { selectOldGenerationRetrievalCandidates } from "../src/index.js";
import {
  REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_SCENARIO_IDS,
  createRepresentativeOldGenerationRetrievalFixture,
} from "../test-support/representative-old-generation-retrieval-fixtures.js";

test("representative old-generation retrieval fixture exposes stable query scenarios", () => {
  const fixture = createRepresentativeOldGenerationRetrievalFixture();

  assert.deepEqual(
    Object.keys(fixture.queryScenarios),
    REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_SCENARIO_IDS,
  );
  assert.equal(fixture.graph.oldGeneration.longTermMemory.length, 13);
  assert.equal(fixture.graph.edges.length, 9);
});

for (const scenarioId of REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_SCENARIO_IDS) {
  test(
    `representative retrieval scenario ${scenarioId} returns the expected relevant memories`,
    () => {
      const fixture = createRepresentativeOldGenerationRetrievalFixture();
      const scenario = fixture.queryScenarios[scenarioId];
      const selection = selectOldGenerationRetrievalCandidates(
        fixture.graph,
        scenario.prompt,
        scenario.options,
      );
      const rankedCandidatesByMemoryId = new Map(
        selection.rankedCandidates.map((candidate) => [candidate.memoryId, candidate]),
      );
      const pageRankWinner = rankedCandidatesByMemoryId.get(
        scenario.expectedPageRankWinnerMemoryId,
      );
      const pageRankLoser = rankedCandidatesByMemoryId.get(
        scenario.expectedPageRankLoserMemoryId,
      );

      assert.deepEqual(
        selection.seedResolution.seeds.map((seed) => seed.memoryId),
        scenario.expectedSeedMemoryIds,
      );
      assert.deepEqual(
        selection.rankedCandidateMemoryIds,
        scenario.expectedRankedCandidateMemoryIds,
      );
      assert.deepEqual(selection.pageRank?.edges, scenario.expectedPageRankEdges);
      assert.ok(pageRankWinner);
      assert.ok(pageRankLoser);
      assert.equal(pageRankWinner.ordering.minDepth, pageRankLoser.ordering.minDepth);
      assert.equal(
        pageRankWinner.ordering.closestSeedRank,
        pageRankLoser.ordering.closestSeedRank,
      );
      assert.ok(
        pageRankWinner.ranking.pageRankScore > pageRankLoser.ranking.pageRankScore,
      );
      assert.ok(
        selection.pageRank.rankedCandidateMemoryIds.indexOf(
          scenario.expectedPageRankWinnerMemoryId,
        ) <
          selection.pageRank.rankedCandidateMemoryIds.indexOf(
            scenario.expectedPageRankLoserMemoryId,
          ),
      );

      if (scenario.expectedDepthTwoMemoryId) {
        const depthTwoCandidate = rankedCandidatesByMemoryId.get(
          scenario.expectedDepthTwoMemoryId,
        );

        assert.ok(depthTwoCandidate);
        assert.equal(depthTwoCandidate.ordering.minDepth, 2);
        assert.deepEqual(
          depthTwoCandidate.expansionProvenance[0].pathNodeIds,
          scenario.expectedDepthTwoPathNodeIds,
        );
      }
    },
  );
}
