import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  PROTECTED_IDENTITY_FIELDS,
  createMemoryGraph,
  createOldGenerationEdgeId,
  createOldGenerationNodeId,
  lookupConsolidationRecord,
  lookupLongTermMemory,
  lookupMemoryEvidence,
  lookupOldGenerationNode,
  validateOldGenerationGraph,
} from "../src/index.js";
import {
  CANONICAL_OLD_GENERATION_AGENT_ID,
  CANONICAL_OLD_GENERATION_LOCAL_IDS,
  createCanonicalConsolidationRecordInput,
  createCanonicalEvidenceInput,
  createCanonicalIdentityInput,
  createCanonicalLearnedTraitInput,
  createCanonicalLongTermMemoryInput,
} from "../examples/old-generation-graph-examples.js";

const createEdgeProvenance = (evidence) => ({
  source: "idle-window",
  observedAt: "2026-04-12T09:15:00Z",
  evidence: [evidence],
});

const buildInitialOldGenerationGraph = () => {
  const currentMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const historicalMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  const learnedTraitNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );

  return createMemoryGraph(createCanonicalIdentityInput(), {
    longTermMemory: [
      createCanonicalLongTermMemoryInput(
        CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
        {
          content: "The agent must include source citations in user-facing summaries.",
          summary: "Current citation policy for user-facing summaries.",
          confidence: 0.91,
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T09:00:00Z",
            evidence: ["turn-24"],
          },
        },
      ),
      createCanonicalLongTermMemoryInput(
        CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
        {
          content: "The agent may omit citations when the answer is short.",
          summary: "Previous citation policy before the stricter rule.",
          confidence: 0.62,
          provenance: {
            source: "conversation",
            observedAt: "2026-04-12T08:30:00Z",
            evidence: ["turn-12"],
          },
          temporalContext: {
            supersededAt: "2026-04-12T09:16:00Z",
          },
          consolidationState: {
            status: "superseded",
            lastOperation: "supersede",
            journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
            policyVersion: "old-generation-v1",
            sourceMemoryIds: ["stm-12"],
          },
        },
      ),
      createCanonicalLearnedTraitInput(),
    ],
    memoryEvidence: [createCanonicalEvidenceInput()],
    consolidationJournal: [createCanonicalConsolidationRecordInput()],
    edges: [
      {
        from: currentMemoryNodeId,
        to: learnedTraitNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        provenance: createEdgeProvenance("consolidation-run-association"),
        temporalContext: {
          firstObservedAt: "2026-04-12T09:00:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
      },
      {
        from: currentMemoryNodeId,
        to: evidenceNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        provenance: createEdgeProvenance("consolidation-run-evidence"),
        temporalContext: {
          firstObservedAt: "2026-04-12T09:00:00Z",
          lastObservedAt: "2026-04-12T09:15:00Z",
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: "old-generation-v1",
        },
      },
      {
        from: currentMemoryNodeId,
        to: recordNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
        provenance: createEdgeProvenance("consolidation-run-record"),
        temporalContext: {
          consolidatedAt: "2026-04-12T09:15:00Z",
        },
        consolidationState: {
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["stm-41", "stm-42"],
          preservedIdentityFields: ["agentId", "persona", "role", "durableMission"],
        },
      },
      {
        from: currentMemoryNodeId,
        to: historicalMemoryNodeId,
        relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
        provenance: createEdgeProvenance("consolidation-run-supersedes"),
        temporalContext: {
          consolidatedAt: "2026-04-12T09:15:00Z",
          supersededAt: "2026-04-12T09:16:00Z",
        },
        consolidationState: {
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: "old-generation-v1",
          sourceMemoryIds: ["stm-41", "stm-42"],
        },
      },
    ],
  });
};

test("memory graph factory builds an identity-seeded old-generation instance from required identity fields", () => {
  const identityInput = createCanonicalIdentityInput();
  const graph = createMemoryGraph(identityInput);

  assert.equal(graph.oldGeneration.generation, "old");
  assert.deepEqual(graph.oldGeneration.longTermMemory, []);
  assert.deepEqual(graph.oldGeneration.archivedMemory, []);
  assert.deepEqual(graph.oldGeneration.memoryEvidence, []);
  assert.deepEqual(graph.oldGeneration.consolidationJournal, []);
  assert.deepEqual(graph.edges, []);
  assert.equal(
    graph.oldGeneration.immutableIdentity.nodeId,
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.immutableIdentity,
      identityInput.agentId,
      "self",
    ),
  );
  assert.equal(graph.oldGeneration.immutableIdentity.agentId, identityInput.agentId);
  assert.equal(graph.oldGeneration.immutableIdentity.persona, identityInput.persona);
  assert.equal(graph.oldGeneration.immutableIdentity.role, identityInput.role);
  assert.equal(
    graph.oldGeneration.immutableIdentity.durableMission,
    identityInput.durableMission,
  );
  assert.deepEqual(
    graph.oldGeneration.immutableIdentity.safetyConstraints,
    identityInput.safetyConstraints,
  );
  assert.deepEqual(graph.oldGeneration.immutableIdentity.ownership, identityInput.ownership);
  assert.deepEqual(
    graph.oldGeneration.immutableIdentity.nonNegotiablePreferences,
    identityInput.nonNegotiablePreferences,
  );
  assert.deepEqual(
    graph.oldGeneration.immutableIdentity.runtimeInvariants,
    identityInput.runtimeInvariants,
  );
  assert.deepEqual(
    graph.oldGeneration.immutableIdentity.protectedCoreFacts,
    identityInput.protectedCoreFacts,
  );
  assert.equal(
    graph.oldGeneration.immutableIdentity.consolidationState.status,
    "runtime_seeded",
  );
  assert.deepEqual(
    graph.oldGeneration.immutableIdentity.consolidationState.preservedIdentityFields,
    PROTECTED_IDENTITY_FIELDS,
  );
});

test("newly created old-generation graphs keep immutable identity readable only through administrative access", () => {
  const graph = createMemoryGraph(createCanonicalIdentityInput());

  const identityInRetrievalMode = lookupOldGenerationNode(graph, {
    nodeId: graph.oldGeneration.immutableIdentity.nodeId,
  });
  const identityInAdministrativeMode = lookupOldGenerationNode(
    graph,
    {
      nodeId: graph.oldGeneration.immutableIdentity.nodeId,
    },
    {
      accessMode: "administrative",
    },
  );

  assert.equal(identityInRetrievalMode, null);
  assert.equal(identityInAdministrativeMode, graph.oldGeneration.immutableIdentity);
  assert.equal(identityInAdministrativeMode.agentId, graph.agentId);
  assert.equal(identityInAdministrativeMode.persona, "deliberate analyst");
  assert.equal(identityInAdministrativeMode.role, "researcher");
  assert.equal(
    identityInAdministrativeMode.durableMission,
    "Protect user context quality.",
  );
  assert.deepEqual(
    identityInAdministrativeMode.consolidationState.preservedIdentityFields,
    PROTECTED_IDENTITY_FIELDS,
  );
  assert.ok(Object.isFrozen(identityInAdministrativeMode));
});

test("old-generation immutable identity rejects protected field mutation attempts after creation", () => {
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
  const originalIdentity = JSON.parse(JSON.stringify(identity));
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

test("memory graph factory builds a fully linked old-generation graph from raw durable inputs", () => {
  const graph = buildInitialOldGenerationGraph();
  const allOldGenerationNodes = [
    graph.oldGeneration.immutableIdentity,
    ...graph.oldGeneration.longTermMemory,
    ...graph.oldGeneration.memoryEvidence,
    ...graph.oldGeneration.consolidationJournal,
  ];
  const nodeById = new Map(
    allOldGenerationNodes.map((node) => [node.nodeId, node]),
  );
  const edgeByRelation = new Map(graph.edges.map((edge) => [edge.relation, edge]));
  const currentMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const historicalMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  const learnedTraitNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
  );
  const evidenceNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  );
  const recordNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );

  assert.equal(graph.oldGeneration.immutableIdentity.nodeId, createOldGenerationNodeId(
    MEMORY_NODE_KINDS.immutableIdentity,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    "self",
  ));
  assert.equal(allOldGenerationNodes.length, 6);
  assert.equal(nodeById.size, allOldGenerationNodes.length);
  assert.ok(allOldGenerationNodes.every((node) => node.agentId === graph.agentId));
  assert.ok(graph.edges.every((edge) => edge.agentId === graph.agentId));
  assert.equal(graph.edges.length, 4);
  assert.equal(new Set(graph.edges.map((edge) => edge.edgeId)).size, graph.edges.length);
  assert.ok(graph.edges.every((edge) => edge.edgeId === createOldGenerationEdgeId(edge)));
  assert.ok(
    graph.edges.every(
      (edge) =>
        nodeById.has(edge.from) &&
        nodeById.has(edge.to) &&
        edge.from !== graph.oldGeneration.immutableIdentity.nodeId &&
        edge.to !== graph.oldGeneration.immutableIdentity.nodeId,
    ),
  );
  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.from === currentMemoryNodeId)
      .map((edge) => edge.to)
      .sort(),
    [
      learnedTraitNodeId,
      evidenceNodeId,
      recordNodeId,
      historicalMemoryNodeId,
    ].sort(),
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation).to,
    learnedTraitNodeId,
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation).to,
    evidenceNodeId,
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation).to,
    recordNodeId,
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation)
      .consolidationState.journalRecordId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.supersedes.relation).to,
    historicalMemoryNodeId,
  );
  assert.equal(
    edgeByRelation.get(OLD_GENERATION_EDGE_SCHEMA.supersedes.relation)
      .consolidationState.status,
    "superseded",
  );
  assert.equal(
    nodeById.get(historicalMemoryNodeId).consolidationState.status,
    "superseded",
  );
  assert.equal(
    nodeById.get(learnedTraitNodeId).learnedTrait.protectedFromIdentityPromotion,
    true,
  );
  assert.equal(validateOldGenerationGraph(graph), true);
  assert.ok(Object.isFrozen(graph.oldGeneration));
  assert.ok(Object.isFrozen(graph.edges));
});

test("newly created old-generation graphs hide superseded durable nodes from default retrieval while preserving administrative access", () => {
  const graph = buildInitialOldGenerationGraph();

  const currentMemory = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const historicalMemory = lookupOldGenerationNode(
    graph,
    {
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      localId: CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    },
    {
      accessMode: "administrative",
    },
  );
  const evidence = lookupMemoryEvidence(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  );
  const record = lookupConsolidationRecord(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );

  assert.equal(currentMemory, graph.oldGeneration.longTermMemory[0]);
  assert.equal(
    currentMemory.summary,
    "Current citation policy for user-facing summaries.",
  );
  assert.equal(
    lookupOldGenerationNode(graph, {
      nodeKind: MEMORY_NODE_KINDS.longTermMemory,
      localId: CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    }),
    null,
  );
  assert.equal(historicalMemory, graph.oldGeneration.longTermMemory[1]);
  assert.equal(historicalMemory.consolidationState.status, "superseded");
  assert.equal(evidence, graph.oldGeneration.memoryEvidence[0]);
  assert.equal(evidence.reference, "turn-18");
  assert.equal(record, graph.oldGeneration.consolidationJournal[0]);
  assert.equal(record.operation, "supersede");
  assert.equal(record.runtimePhase, "idle");
  assert.ok(Object.isFrozen(currentMemory));
  assert.ok(Object.isFrozen(historicalMemory));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(record));
});

test("memory graph factory rejects multiple canonical supersedes successors during initial build", () => {
  const historicalMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  const firstCurrentMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const secondCurrentMemoryNodeId = createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.alternateSuccessorMemoryId,
  );

  assert.throws(
    () =>
      createMemoryGraph(createCanonicalIdentityInput(), {
        longTermMemory: [
          createCanonicalLongTermMemoryInput(
            CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
          ),
          createCanonicalLongTermMemoryInput(
            CANONICAL_OLD_GENERATION_LOCAL_IDS.alternateSuccessorMemoryId,
          ),
          createCanonicalLongTermMemoryInput(
            CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
          ),
        ],
        edges: [
          {
            from: firstCurrentMemoryNodeId,
            to: historicalMemoryNodeId,
            relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
            provenance: createEdgeProvenance("consolidation-run-a"),
            temporalContext: {
              consolidatedAt: "2026-04-12T09:15:00Z",
              supersededAt: "2026-04-12T09:16:00Z",
            },
          },
          {
            from: secondCurrentMemoryNodeId,
            to: historicalMemoryNodeId,
            relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
            provenance: createEdgeProvenance("consolidation-run-b"),
            temporalContext: {
              consolidatedAt: "2026-04-12T09:15:30Z",
              supersededAt: "2026-04-12T09:16:30Z",
            },
          },
        ],
      }),
    /cannot have multiple canonical successors/,
  );
});
