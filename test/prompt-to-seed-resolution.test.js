import test from "node:test";
import assert from "node:assert/strict";

import { resolvePromptToSeedMemoryNodeIds } from "../src/index.js";
import {
  CANONICAL_OLD_GENERATION_LOCAL_IDS,
  CANONICAL_OLD_GENERATION_NODE_IDS,
  createCanonicalValidOldGenerationGraph,
} from "../examples/old-generation-graph-examples.js";

test("prompt-to-seed resolution ranks durable memories from direct content overlap", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const result = resolvePromptToSeedMemoryNodeIds(
    graph,
    "source citations in user-facing summaries",
    {
      limit: 2,
    },
  );

  assert.equal(result.accessMode, "retrieval");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.seedNodeIds[0], CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory);
  assert.equal(
    result.seeds[0].memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  assert.ok(result.seeds[0].score > 0.5);
  assert.ok(result.seeds[0].directScore > result.seeds[0].metadataScore);
  assert.ok(
    result.seeds[0].score > (result.seeds[1]?.score ?? 0),
  );
  assert.ok(result.seeds[0].matchedContentTerms.includes("source"));
  assert.ok(result.seeds[0].matchedContentTerms.includes("citations"));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.seeds[0]));
});

test("prompt-to-seed resolution uses connected evidence metadata to seed durable memories", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const result = resolvePromptToSeedMemoryNodeIds(
    graph,
    "accepting the answer turn 18",
  );

  assert.equal(result.seedNodeIds[0], CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory);
  assert.equal(
    result.seeds[0].memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  assert.equal(result.seeds[0].matchedContentTerms.includes("accepting"), false);
  assert.ok(result.seeds[0].matchedMetadataTerms.includes("accepting"));
  assert.ok(result.seeds[0].matchedMetadataTerms.includes("answer"));
  assert.ok(result.seeds[0].matchedMetadataTerms.includes("18"));
  assert.ok(
    result.seeds[0].supportingNodeIds.includes(
      CANONICAL_OLD_GENERATION_NODE_IDS.memoryEvidence,
    ),
  );
});

test("prompt-to-seed resolution keeps superseded memories out of retrieval mode while allowing administrative recall", () => {
  const graph = createCanonicalValidOldGenerationGraph();
  const prompt = "omit citations when the answer is short";

  const retrievalResult = resolvePromptToSeedMemoryNodeIds(graph, prompt);
  const administrativeResult = resolvePromptToSeedMemoryNodeIds(graph, prompt, {
    accessMode: "administrative",
  });

  assert.equal(
    retrievalResult.seedNodeIds.includes(CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory),
    false,
  );
  assert.equal(administrativeResult.accessMode, "administrative");
  assert.equal(administrativeResult.candidateCount, 3);
  assert.equal(
    administrativeResult.seedNodeIds[0],
    CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
  );
  assert.equal(
    administrativeResult.seeds[0].memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  assert.ok(administrativeResult.seeds[0].matchedContentTerms.includes("omit"));
  assert.ok(administrativeResult.seeds[0].matchedContentTerms.includes("short"));
});
