import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  validateOldGenerationGraph,
} from "../src/index.js";
import {
  CANONICAL_INVALID_OLD_GENERATION_GRAPH_EXAMPLES,
  CANONICAL_OLD_GENERATION_LOCAL_IDS,
  CANONICAL_OLD_GENERATION_NODE_IDS,
  createCanonicalValidOldGenerationGraph,
} from "../examples/old-generation-graph-examples.js";

test("canonical valid old-generation graph example covers the durable node and edge taxonomy", () => {
  const graph = createCanonicalValidOldGenerationGraph();
  const learnedTraitMemory = graph.oldGeneration.longTermMemory.find(
    (memory) => memory.category === "learned_trait",
  );
  const relationSet = new Set(graph.edges.map((edge) => edge.relation));
  const identityNodeId = graph.oldGeneration.immutableIdentity.nodeId;

  assert.equal(validateOldGenerationGraph(graph), true);
  assert.equal(graph.oldGeneration.immutableIdentity.nodeId, CANONICAL_OLD_GENERATION_NODE_IDS.immutableIdentity);
  assert.deepEqual(
    graph.oldGeneration.longTermMemory.map((memory) => memory.memoryId).sort(),
    [
      CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
      CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
      CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
    ].sort(),
  );
  assert.equal(graph.oldGeneration.immutableIdentity.consolidationState.status, "runtime_seeded");
  assert.equal(learnedTraitMemory.learnedTrait.protectedFromIdentityPromotion, true);
  assert.equal(learnedTraitMemory.nodeId, CANONICAL_OLD_GENERATION_NODE_IDS.learnedTraitMemory);
  assert.equal(graph.oldGeneration.memoryEvidence[0].nodeId, CANONICAL_OLD_GENERATION_NODE_IDS.memoryEvidence);
  assert.equal(
    graph.oldGeneration.consolidationJournal[0].nodeId,
    CANONICAL_OLD_GENERATION_NODE_IDS.consolidationRecord,
  );
  assert.equal(
    graph.oldGeneration.memoryEvidence[0].kind,
    "conversation_excerpt",
  );
  assert.equal(
    graph.oldGeneration.consolidationJournal[0].operation,
    "supersede",
  );
  assert.equal(graph.edges.length, 4);
  assert.equal(
    graph.edges.filter((edge) => edge.from === identityNodeId || edge.to === identityNodeId)
      .length,
    0,
  );
  assert.deepEqual(
    Array.from(relationSet).sort(),
    [
      OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
      OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
      OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
    ].sort(),
  );
  assert.equal(
    graph.edges.find(
      (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
    ).consolidationState.journalRecordId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );
  assert.equal(
    graph.edges.find((edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation)
      .consolidationState.status,
    "superseded",
  );
  assert.equal(
    graph.edges.find(
      (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
    ).to,
    CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
  );
  assert.equal(
    graph.oldGeneration.longTermMemory.every(
      (memory) => memory.agentId === graph.agentId,
    ),
    true,
  );
  assert.equal(
    graph.oldGeneration.immutableIdentity.nodeId.includes(MEMORY_NODE_KINDS.immutableIdentity),
    true,
  );
});

for (const invalidExample of CANONICAL_INVALID_OLD_GENERATION_GRAPH_EXAMPLES) {
  test(`canonical invalid old-generation graph example rejects ${invalidExample.name}`, () => {
    assert.throws(
      () => validateOldGenerationGraph(invalidExample.buildGraph()),
      invalidExample.expectedError,
    );
  });
}
