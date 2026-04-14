import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  PROTECTED_IDENTITY_FIELDS,
  createMemoryGraph,
  createOldGenerationNodeId,
  loadOldGenerationGraphState,
  saveOldGenerationGraphState,
  validateOldGenerationGraph,
} from "../src/index.js";
import {
  createCanonicalIdentityInput,
  createCanonicalLearnedTraitInput,
  createCanonicalLongTermMemoryInput,
} from "../examples/old-generation-graph-examples.js";

test("memory graphs expose an explicit old-generation container", () => {
  const graph = createMemoryGraph(createCanonicalIdentityInput());

  assert.ok(Object.hasOwn(graph, "oldGeneration"));
  assert.equal(graph.oldGeneration.generation, "old");
  assert.deepEqual(Object.keys(graph.oldGeneration).sort(), [
    "archivedMemory",
    "consolidationJournal",
    "generation",
    "immutableIdentity",
    "longTermMemory",
    "memoryEvidence",
  ]);
  assert.equal(
    graph.oldGeneration.immutableIdentity.nodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.immutableIdentity,
      graph.agentId,
      "self",
    ),
  );
  assert.equal(validateOldGenerationGraph(graph), true);
});

test("old-generation save and load preserve long-term-memory classification", () => {
  const graph = createMemoryGraph(createCanonicalIdentityInput(), {
    longTermMemory: [
      createCanonicalLongTermMemoryInput("ltm-classification-semantic"),
      createCanonicalLearnedTraitInput({
        memoryId: "ltm-classification-trait",
      }),
    ],
  });
  const savedState = saveOldGenerationGraphState(graph);
  const restoredGraph = loadOldGenerationGraphState(graph, savedState);

  assert.equal(restoredGraph.oldGeneration.longTermMemory.length, 2);
  restoredGraph.oldGeneration.longTermMemory.forEach((memory) => {
    assert.equal(
      memory.nodeId,
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        restoredGraph.agentId,
        memory.memoryId,
      ),
    );
  });
  assert.equal(
    restoredGraph.oldGeneration.longTermMemory[0].category,
    "semantic",
  );
  assert.equal(
    restoredGraph.oldGeneration.longTermMemory[1].category,
    "learned_trait",
  );
  assert.equal(
    restoredGraph.oldGeneration.longTermMemory[1].learnedTrait
      .protectedFromIdentityPromotion,
    true,
  );
  assert.equal(validateOldGenerationGraph(restoredGraph), true);
});

test("old-generation immutable identity rejects protected-field mutation", () => {
  const graph = createMemoryGraph(
    createCanonicalIdentityInput({
      runtimeInvariants: {
        deployment: {
          environment: "sandbox",
          tenant: "zep",
        },
        region: "ap-northeast-2",
      },
    }),
  );
  const identity = graph.oldGeneration.immutableIdentity;
  const originalIdentity = structuredClone(identity);
  const attemptedAssignments = new Map([
    ["agentId", "agent-999"],
    ["persona", "mutated persona"],
    ["role", "mutated role"],
    ["durableMission", "Mutated durable mission."],
    ["safetyConstraints", ["mutated safety constraint"]],
    ["ownership", ["mutated ownership"]],
    ["nonNegotiablePreferences", ["mutated preference"]],
    [
      "runtimeInvariants",
      {
        deployment: {
          environment: "mutated-environment",
          tenant: "mutated-tenant",
        },
        region: "mutated-region",
      },
    ],
    ["protectedCoreFacts", ["mutated protected fact"]],
  ]);

  assert.deepEqual(
    [...attemptedAssignments.keys()],
    [...PROTECTED_IDENTITY_FIELDS],
  );

  for (const [fieldName, nextValue] of attemptedAssignments) {
    assert.throws(
      () => {
        identity[fieldName] = nextValue;
      },
      TypeError,
      `Expected immutable identity field "${fieldName}" to reject reassignment.`,
    );
    assert.deepEqual(identity[fieldName], originalIdentity[fieldName]);
  }

  assert.throws(() => {
    identity.safetyConstraints.push("mutated safety constraint");
  }, TypeError);
  assert.throws(() => {
    identity.ownership.push("mutated ownership");
  }, TypeError);
  assert.throws(() => {
    identity.nonNegotiablePreferences.push("mutated preference");
  }, TypeError);
  assert.throws(() => {
    identity.runtimeInvariants.deployment.environment = "mutated-environment";
  }, TypeError);
  assert.throws(() => {
    identity.protectedCoreFacts.push("mutated protected fact");
  }, TypeError);

  assert.deepEqual(identity, originalIdentity);
});
