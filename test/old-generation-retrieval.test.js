import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  createMemoryGraph,
  createOldGenerationNodeId,
  expandOldGenerationSeedNodes,
  lookupConsolidationRecord,
  lookupLongTermMemory,
  lookupMemoryEvidence,
  lookupOldGenerationNode,
  selectOldGenerationRetrievalCandidates,
  walkOldGenerationRelationships,
} from "../src/index.js";
import {
  CANONICAL_OLD_GENERATION_AGENT_ID,
  CANONICAL_OLD_GENERATION_LOCAL_IDS,
  CANONICAL_OLD_GENERATION_NODE_IDS,
  createCanonicalIdentityInput,
  createCanonicalLongTermMemoryInput,
  createCanonicalValidOldGenerationGraph,
} from "../examples/old-generation-graph-examples.js";

const buildBidirectionalAssociationGraph = () => {
  const memoryIds = ["ltm-a", "ltm-b", "ltm-c", "ltm-d"];
  const nodeIds = Object.fromEntries(
    memoryIds.map((memoryId) => [
      memoryId,
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        memoryId,
      ),
    ]),
  );

  return createMemoryGraph(createCanonicalIdentityInput(), {
    longTermMemory: memoryIds.map((memoryId) =>
      createCanonicalLongTermMemoryInput(memoryId),
    ),
    edges: [
      {
        from: nodeIds["ltm-a"],
        to: nodeIds["ltm-b"],
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      },
      {
        from: nodeIds["ltm-b"],
        to: nodeIds["ltm-c"],
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      },
      {
        from: nodeIds["ltm-d"],
        to: nodeIds["ltm-b"],
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      },
    ],
  });
};

const buildSharedHubRetrievalGraph = () => {
  const memoryIds = Object.freeze({
    alpha: "ltm-alpha-seed",
    delta: "ltm-delta-seed",
    hub: "ltm-shared-hub",
  });
  const nodeIds = Object.fromEntries(
    Object.values(memoryIds).map((memoryId) => [
      memoryId,
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        memoryId,
      ),
    ]),
  );

  return {
    memoryIds,
    nodeIds,
    graph: createMemoryGraph(createCanonicalIdentityInput(), {
      longTermMemory: [
        createCanonicalLongTermMemoryInput(memoryIds.alpha, {
          content: "Alpha guidance is the primary retrieval anchor for rollout recalls.",
          summary: "Alpha guidance memory.",
        }),
        createCanonicalLongTermMemoryInput(memoryIds.delta, {
          content: "Delta appendix keeps the supporting retrieval note.",
          summary: "Delta appendix memory.",
        }),
        createCanonicalLongTermMemoryInput(memoryIds.hub, {
          content: "Shared citation bridge for cross-memory recall.",
          summary: "Shared citation bridge memory.",
        }),
      ],
      edges: [
        {
          from: nodeIds[memoryIds.alpha],
          to: nodeIds[memoryIds.hub],
          relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        },
        {
          from: nodeIds[memoryIds.delta],
          to: nodeIds[memoryIds.hub],
          relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        },
      ],
    }),
  };
};

const buildTraversalPriorityGraph = () => {
  const memoryIds = Object.freeze({
    alpha: "ltm-alpha-priority-seed",
    delta: "ltm-delta-priority-seed",
    appendix: "ltm-supporting-appendix",
    hub: "ltm-shared-priority-hub",
  });
  const nodeIds = Object.fromEntries(
    Object.values(memoryIds).map((memoryId) => [
      memoryId,
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        memoryId,
      ),
    ]),
  );

  return {
    memoryIds,
    nodeIds,
    graph: createMemoryGraph(createCanonicalIdentityInput(), {
      longTermMemory: [
        createCanonicalLongTermMemoryInput(memoryIds.alpha, {
          content: "Alpha runbook is the primary retrieval seed for rollout planning.",
          summary: "Alpha runbook memory.",
        }),
        createCanonicalLongTermMemoryInput(memoryIds.delta, {
          content: "Delta fallback memo is the secondary retrieval seed for rollouts.",
          summary: "Delta fallback memory.",
        }),
        createCanonicalLongTermMemoryInput(memoryIds.appendix, {
          content: "Supporting appendix with one-off rollout details.",
          summary: "Single-path appendix memory.",
        }),
        createCanonicalLongTermMemoryInput(memoryIds.hub, {
          content: "Shared bridge memory reused across connected retrieval paths.",
          summary: "Shared priority hub memory.",
        }),
      ],
      edges: [
        {
          from: nodeIds[memoryIds.alpha],
          to: nodeIds[memoryIds.appendix],
          relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        },
        {
          from: nodeIds[memoryIds.alpha],
          to: nodeIds[memoryIds.hub],
          relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        },
        {
          from: nodeIds[memoryIds.delta],
          to: nodeIds[memoryIds.hub],
          relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        },
      ],
    }),
  };
};

test("old-generation lookup entry points resolve durable nodes while gating immutable identity by default", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const memory = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const evidence = lookupMemoryEvidence(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  );
  const record = lookupConsolidationRecord(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  );
  const identityInRetrievalMode = lookupOldGenerationNode(graph, {
    nodeId: CANONICAL_OLD_GENERATION_NODE_IDS.immutableIdentity,
  });
  const identityInAdministrativeMode = lookupOldGenerationNode(
    graph,
    {
      nodeId: CANONICAL_OLD_GENERATION_NODE_IDS.immutableIdentity,
    },
    {
      accessMode: "administrative",
    },
  );
  const lookedUpRecord = lookupOldGenerationNode(graph, {
    nodeKind: MEMORY_NODE_KINDS.consolidationRecord,
    localId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  });

  assert.equal(memory.memoryId, CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId);
  assert.equal(evidence.evidenceId, CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId);
  assert.equal(record.recordId, CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId);
  assert.equal(lookedUpRecord.recordId, CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId);
  assert.equal(identityInRetrievalMode, null);
  assert.equal(
    identityInAdministrativeMode.nodeId,
    CANONICAL_OLD_GENERATION_NODE_IDS.immutableIdentity,
  );
  assert.ok(Object.isFrozen(memory));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(identityInAdministrativeMode));
});

test("old-generation long-term memory lookup keeps superseded history out of default retrieval while preserving administrative inspection", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const currentByDirectLookup = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const currentByMemorySelector = lookupOldGenerationNode(graph, {
    memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  });
  const currentByNodeIdSelector = lookupOldGenerationNode(graph, {
    nodeId: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
  });
  const currentByCanonicalSelector = lookupOldGenerationNode(graph, {
    nodeKind: MEMORY_NODE_KINDS.longTermMemory,
    localId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  });
  const currentByRepeatedLookup = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  const learnedTraitMemory = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
  );
  const historicalMemoryInRetrieval = lookupLongTermMemory(
    graph,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  const historicalMemoryInAdministrativeAccess = lookupOldGenerationNode(
    graph,
    {
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    },
    {
      accessMode: "administrative",
    },
  );

  assert.equal(currentByDirectLookup, currentByMemorySelector);
  assert.equal(currentByDirectLookup, currentByNodeIdSelector);
  assert.equal(currentByDirectLookup, currentByCanonicalSelector);
  assert.equal(currentByDirectLookup, currentByRepeatedLookup);
  assert.equal(
    currentByDirectLookup.summary,
    "Current citation policy for user-facing summaries.",
  );
  assert.equal(learnedTraitMemory.category, "learned_trait");
  assert.equal(learnedTraitMemory.learnedTrait.label, "evidence-seeking");
  assert.equal(historicalMemoryInRetrieval, null);
  assert.equal(
    historicalMemoryInAdministrativeAccess.memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
  assert.equal(
    historicalMemoryInAdministrativeAccess.consolidationState.status,
    "superseded",
  );
});

test("old-generation relationship walking excludes superseded memories from default retrieval while preserving administrative inspection", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const walk = walkOldGenerationRelationships(graph, {
    memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  });
  const evidenceOnly = walkOldGenerationRelationships(
    graph,
    {
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
    },
    {
      relations: [OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation],
      nodeKinds: [MEMORY_NODE_KINDS.memoryEvidence],
    },
  );
  const administrativeWalk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
    },
    {
      accessMode: "administrative",
    },
  );

  assert.equal(walk.accessMode, "retrieval");
  assert.equal(walk.direction, "outbound");
  assert.equal(walk.maxDepth, 1);
  assert.equal(walk.startNode.memoryId, CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId);
  assert.deepEqual(
    walk.steps.map((step) => step.relatedNode.nodeId),
    [
      CANONICAL_OLD_GENERATION_NODE_IDS.learnedTraitMemory,
      CANONICAL_OLD_GENERATION_NODE_IDS.memoryEvidence,
      CANONICAL_OLD_GENERATION_NODE_IDS.consolidationRecord,
    ],
  );
  assert.deepEqual(
    administrativeWalk.steps.map((step) => step.relatedNode.nodeId),
    [
      CANONICAL_OLD_GENERATION_NODE_IDS.learnedTraitMemory,
      CANONICAL_OLD_GENERATION_NODE_IDS.memoryEvidence,
      CANONICAL_OLD_GENERATION_NODE_IDS.consolidationRecord,
      CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
    ],
  );
  assert.ok(walk.steps.every((step) => step.depth === 1));
  assert.ok(walk.steps.every((step) => step.direction === "outbound"));
  assert.equal(evidenceOnly.steps.length, 1);
  assert.equal(
    evidenceOnly.steps[0].relatedNode.evidenceId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  );
  assert.ok(Object.isFrozen(walk));
  assert.ok(Object.isFrozen(walk.steps[0]));
});

test("old-generation relationship walking supports multi-hop traversal over long-term memory associations", () => {
  const memoryIds = ["ltm-a", "ltm-b", "ltm-c"];
  const nodeIds = Object.fromEntries(
    memoryIds.map((memoryId) => [
      memoryId,
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        memoryId,
      ),
    ]),
  );
  const graph = createMemoryGraph(createCanonicalIdentityInput(), {
    longTermMemory: memoryIds.map((memoryId) =>
      createCanonicalLongTermMemoryInput(memoryId),
    ),
    edges: [
      {
        from: nodeIds["ltm-a"],
        to: nodeIds["ltm-b"],
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      },
      {
        from: nodeIds["ltm-b"],
        to: nodeIds["ltm-c"],
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
      },
    ],
  });

  const walk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: "ltm-a",
    },
    {
      maxDepth: 2,
    },
  );

  assert.deepEqual(
    walk.steps.map((step) => [step.depth, step.relatedNode.memoryId]),
    [
      [1, "ltm-b"],
      [2, "ltm-c"],
    ],
  );
  assert.equal(walk.steps[1].fromNode.memoryId, "ltm-b");
  assert.equal(walk.steps[1].toNode.memoryId, "ltm-c");
});

test("old-generation relationship walking resolves retrieval-visible inbound paths and requires administrative access for superseded history", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const evidenceWalk = walkOldGenerationRelationships(
    graph,
    {
      evidenceId: CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
    },
    {
      direction: "inbound",
    },
  );
  const recordWalk = walkOldGenerationRelationships(
    graph,
    {
      recordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
    },
    {
      direction: "inbound",
    },
  );
  const supersededWalk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    },
    {
      direction: "inbound",
      relations: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );
  const administrativeSupersededWalk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    },
    {
      accessMode: "administrative",
      direction: "inbound",
      relations: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  assert.equal(evidenceWalk.startNode.evidenceId, CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId);
  assert.deepEqual(
    evidenceWalk.steps.map((step) => [
      step.direction,
      step.edge.relation,
      step.relatedNode.memoryId,
    ]),
    [
      [
        "inbound",
        OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
      ],
    ],
  );
  assert.equal(
    recordWalk.steps[0].edge.relation,
    OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
  );
  assert.equal(
    recordWalk.steps[0].relatedNode.memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  assert.equal(supersededWalk.startNode, null);
  assert.deepEqual(supersededWalk.steps, []);
  assert.deepEqual(
    administrativeSupersededWalk.steps.map((step) => [
      step.depth,
      step.direction,
      step.relatedNode.memoryId,
    ]),
    [
      [1, "inbound", CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId],
    ],
  );
  assert.equal(
    administrativeSupersededWalk.steps[0].fromNode.memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  assert.equal(
    administrativeSupersededWalk.steps[0].toNode.memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  );
});

test("old-generation long-term memory traversal stays deterministic across repeated bidirectional association walks", () => {
  const graph = buildBidirectionalAssociationGraph();

  const firstWalk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: "ltm-b",
    },
    {
      direction: "both",
      maxDepth: 1,
      relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );
  const secondWalk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: "ltm-b",
    },
    {
      direction: "both",
      maxDepth: 1,
      relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  const firstPath = firstWalk.steps.map((step) => [
    step.depth,
    step.direction,
    step.relatedNode.memoryId,
  ]);
  const secondPath = secondWalk.steps.map((step) => [
    step.depth,
    step.direction,
    step.relatedNode.memoryId,
  ]);

  assert.deepEqual(firstPath, [
    [1, "outbound", "ltm-c"],
    [1, "inbound", "ltm-a"],
    [1, "inbound", "ltm-d"],
  ]);
  assert.deepEqual(secondPath, firstPath);
  assert.equal(firstWalk.startNode, secondWalk.startNode);
  assert.equal(firstWalk.steps[0].relatedNode, secondWalk.steps[0].relatedNode);
  assert.equal(firstWalk.steps[1].relatedNode, secondWalk.steps[1].relatedNode);
  assert.equal(firstWalk.steps[2].relatedNode, secondWalk.steps[2].relatedNode);
});

test("old-generation seed expansion discovers connected memories from multiple seeds", () => {
  const graph = buildBidirectionalAssociationGraph();
  const seedNodeIds = [
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      CANONICAL_OLD_GENERATION_AGENT_ID,
      "ltm-a",
    ),
    createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      CANONICAL_OLD_GENERATION_AGENT_ID,
      "ltm-d",
    ),
  ];

  const expansion = expandOldGenerationSeedNodes(
    graph,
    seedNodeIds,
    {
      direction: "outbound",
      maxDepth: 2,
      edgeTypes: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  assert.deepEqual(expansion.seedNodeIds, seedNodeIds);
  assert.deepEqual(
    expansion.discoveredNodeIds,
    [
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        "ltm-b",
      ),
      createOldGenerationNodeId(
        MEMORY_NODE_KINDS.longTermMemory,
        CANONICAL_OLD_GENERATION_AGENT_ID,
        "ltm-c",
      ),
    ],
  );
  assert.deepEqual(
    expansion.steps.map((step) => [
      step.seedNodeId,
      step.depth,
      step.relatedNode.memoryId,
    ]),
    [
      [seedNodeIds[0], 1, "ltm-b"],
      [seedNodeIds[1], 1, "ltm-b"],
      [seedNodeIds[0], 2, "ltm-c"],
      [seedNodeIds[1], 2, "ltm-c"],
    ],
  );
  assert.equal(expansion.fanOutLimit, null);
  assert.ok(Object.isFrozen(expansion));
  assert.ok(Object.isFrozen(expansion.steps[0]));
});

test("old-generation relationship walking applies deterministic fan-out limits with edge-type filters", () => {
  const graph = buildBidirectionalAssociationGraph();

  const walk = walkOldGenerationRelationships(
    graph,
    {
      memoryId: "ltm-b",
    },
    {
      direction: "both",
      maxDepth: 1,
      edgeTypes: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
      fanOutLimit: 2,
    },
  );

  assert.equal(walk.fanOutLimit, 2);
  assert.deepEqual(
    walk.steps.map((step) => [step.direction, step.relatedNode.memoryId]),
    [
      ["outbound", "ltm-c"],
      ["inbound", "ltm-a"],
    ],
  );
  assert.equal(
    walk.steps.some((step) => step.relatedNode.memoryId === "ltm-d"),
    false,
  );
});

test("old-generation seed expansion respects retrieval visibility for superseded durable memories", () => {
  const graph = createCanonicalValidOldGenerationGraph();
  const historicalSeedNodeId = CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory;

  const retrievalExpansion = expandOldGenerationSeedNodes(
    graph,
    [historicalSeedNodeId],
    {
      direction: "inbound",
      relations: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );
  const administrativeExpansion = expandOldGenerationSeedNodes(
    graph,
    [historicalSeedNodeId],
    {
      accessMode: "administrative",
      direction: "inbound",
      relations: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  assert.deepEqual(retrievalExpansion.seedNodeIds, []);
  assert.deepEqual(retrievalExpansion.steps, []);
  assert.deepEqual(administrativeExpansion.seedNodeIds, [historicalSeedNodeId]);
  assert.deepEqual(
    administrativeExpansion.steps.map((step) => [
      step.seedNodeId,
      step.depth,
      step.direction,
      step.relatedNode.memoryId,
    ]),
    [
      [
        historicalSeedNodeId,
        1,
        "inbound",
        CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
      ],
    ],
  );
  assert.deepEqual(
    administrativeExpansion.discoveredNodeIds,
    [CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory],
  );
});

test("old-generation retrieval candidate selection composes prompt seeds with deduplicated long-term expansion provenance", () => {
  const graph = createCanonicalValidOldGenerationGraph();
  const associationEdge = graph.edges.find(
    (edge) => edge.relation === OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
  );

  const selection = selectOldGenerationRetrievalCandidates(
    graph,
    "source citations in user-facing summaries",
    {
      limit: 1,
      direction: "outbound",
      maxDepth: 1,
    },
  );

  assert.equal(selection.accessMode, "retrieval");
  assert.equal(selection.seedResolution.seedNodeIds[0], CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory);
  assert.equal(selection.candidateCount, 2);
  assert.deepEqual(selection.candidateMemoryIds, [
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
  ]);
  assert.equal(selection.candidates[0].source, "seed");
  assert.equal(selection.candidates[0].ordering.minDepth, 0);
  assert.equal(
    selection.candidates[0].seed.memoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  );
  assert.equal(selection.candidates[1].source, "expansion");
  assert.equal(selection.candidates[1].ordering.minDepth, 1);
  assert.equal(selection.candidates[1].ordering.firstTraversalIndex, 0);
  assert.equal(selection.candidates[1].expansionProvenance[0].edgeId, associationEdge.edgeId);
  assert.deepEqual(selection.candidates[1].expansionProvenance[0].pathNodeIds, [
    CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
    CANONICAL_OLD_GENERATION_NODE_IDS.learnedTraitMemory,
  ]);
  assert.deepEqual(selection.candidates[1].expansionProvenance[0].pathEdgeIds, [
    associationEdge.edgeId,
  ]);
  assert.ok(Object.isFrozen(selection));
  assert.ok(Object.isFrozen(selection.candidates[1]));
});

test("old-generation retrieval candidate selection deduplicates expansion hits across multiple seeds", () => {
  const { graph, memoryIds, nodeIds } = buildSharedHubRetrievalGraph();

  const selection = selectOldGenerationRetrievalCandidates(
    graph,
    "alpha guidance delta",
    {
      limit: 2,
      direction: "outbound",
      maxDepth: 1,
      relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );
  const hubCandidate = selection.candidates[2];

  assert.deepEqual(selection.candidateMemoryIds, [
    memoryIds.alpha,
    memoryIds.delta,
    memoryIds.hub,
  ]);
  assert.equal(hubCandidate.source, "expansion");
  assert.equal(hubCandidate.ordering.minDepth, 1);
  assert.equal(hubCandidate.ordering.closestSeedRank, 1);
  assert.equal(hubCandidate.ordering.expansionCount, 2);
  assert.deepEqual(
    hubCandidate.expansionProvenance.map((entry) => entry.seedMemoryId),
    [memoryIds.alpha, memoryIds.delta],
  );
  assert.deepEqual(
    hubCandidate.expansionProvenance.map((entry) => entry.pathNodeIds),
    [
      [nodeIds[memoryIds.alpha], nodeIds[memoryIds.hub]],
      [nodeIds[memoryIds.delta], nodeIds[memoryIds.hub]],
    ],
  );
});

test("old-generation retrieval candidate selection uses traversal PageRank to rank same-depth expansion candidates", () => {
  const { graph, memoryIds } = buildTraversalPriorityGraph();

  const selection = selectOldGenerationRetrievalCandidates(
    graph,
    "alpha delta runbook memo",
    {
      limit: 2,
      direction: "outbound",
      maxDepth: 1,
      relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  const candidateNodeIdsByMemoryId = new Map(
    selection.candidates.map((candidate) => [candidate.memoryId, candidate.nodeId]),
  );

  assert.deepEqual(selection.candidateMemoryIds.slice(0, 2).sort(), [
    memoryIds.alpha,
    memoryIds.delta,
  ].sort());
  assert.deepEqual(selection.candidateMemoryIds.slice(2), [
    memoryIds.hub,
    memoryIds.appendix,
  ]);
  assert.ok(
    selection.pageRank &&
      selection.pageRank.rankedCandidateMemoryIds.indexOf(memoryIds.hub) <
        selection.pageRank.rankedCandidateMemoryIds.indexOf(memoryIds.appendix),
  );
  assert.ok(
    selection.candidates[2].ranking.pageRankScore >
      selection.candidates[3].ranking.pageRankScore,
  );
  assert.deepEqual(selection.pageRank?.edges, [
    {
      fromNodeId: candidateNodeIdsByMemoryId.get(memoryIds.alpha),
      toNodeId: candidateNodeIdsByMemoryId.get(memoryIds.hub),
      weight: 1,
      traversalCount: 1,
    },
    {
      fromNodeId: candidateNodeIdsByMemoryId.get(memoryIds.alpha),
      toNodeId: candidateNodeIdsByMemoryId.get(memoryIds.appendix),
      weight: 1,
      traversalCount: 1,
    },
    {
      fromNodeId: candidateNodeIdsByMemoryId.get(memoryIds.delta),
      toNodeId: candidateNodeIdsByMemoryId.get(memoryIds.hub),
      weight: 1,
      traversalCount: 1,
    },
  ]);
});

test("old-generation retrieval candidate selection applies topK after stable traversal-aware ranking", () => {
  const { graph, memoryIds } = buildTraversalPriorityGraph();

  const selection = selectOldGenerationRetrievalCandidates(
    graph,
    "alpha delta runbook memo",
    {
      limit: 2,
      topK: 3,
      direction: "outbound",
      maxDepth: 1,
      relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
      nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
    },
  );

  assert.equal(selection.topK, 3);
  assert.equal(selection.candidateCount, 3);
  assert.equal(selection.rankedCandidateCount, 4);
  assert.deepEqual(selection.candidateMemoryIds.slice(0, 2).sort(), [
    memoryIds.alpha,
    memoryIds.delta,
  ].sort());
  assert.equal(selection.candidateMemoryIds[2], memoryIds.hub);
  assert.deepEqual(selection.rankedCandidateMemoryIds, [
    ...selection.candidateMemoryIds,
    memoryIds.appendix,
  ]);
  assert.deepEqual(
    selection.overflowCandidates.map((candidate) => candidate.memoryId),
    [memoryIds.appendix],
  );
  assert.deepEqual(
    selection.candidates.map((candidate) => candidate.ranking.retrievalRank),
    [1, 2, 3],
  );
  assert.deepEqual(
    selection.overflowCandidates.map((candidate) => candidate.ranking.retrievalRank),
    [4],
  );
});

test("old-generation retrieval candidate ranking stays stable across repeated topK slices", () => {
  const { graph } = buildTraversalPriorityGraph();
  const options = {
    limit: 2,
    topK: 2,
    direction: "outbound",
    maxDepth: 1,
    relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
    nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
  };

  const firstSelection = selectOldGenerationRetrievalCandidates(
    graph,
    "alpha delta runbook memo",
    options,
  );
  const secondSelection = selectOldGenerationRetrievalCandidates(
    graph,
    "alpha delta runbook memo",
    options,
  );

  assert.deepEqual(
    firstSelection.rankedCandidateMemoryIds,
    secondSelection.rankedCandidateMemoryIds,
  );
  assert.deepEqual(
    firstSelection.candidateMemoryIds,
    secondSelection.candidateMemoryIds,
  );
  assert.deepEqual(
    firstSelection.overflowCandidates.map((candidate) => candidate.memoryId),
    secondSelection.overflowCandidates.map((candidate) => candidate.memoryId),
  );
  assert.deepEqual(
    firstSelection.rankedCandidates.map((candidate) => candidate.ranking.retrievalRank),
    [1, 2, 3, 4],
  );
});

test("old-generation retrieval candidate selection keeps superseded memories out of retrieval mode while preserving administrative provenance", () => {
  const graph = createCanonicalValidOldGenerationGraph();
  const prompt = "omit citations when the answer is short";
  const options = {
    limit: 1,
    direction: "inbound",
    relations: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
    nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
  };

  const retrievalSelection = selectOldGenerationRetrievalCandidates(
    graph,
    prompt,
    options,
  );
  const administrativeSelection = selectOldGenerationRetrievalCandidates(
    graph,
    prompt,
    {
      ...options,
      accessMode: "administrative",
    },
  );

  assert.equal(
    retrievalSelection.candidateMemoryIds.includes(
      CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    ),
    false,
  );
  assert.deepEqual(administrativeSelection.candidateMemoryIds, [
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  ]);
  assert.equal(administrativeSelection.candidates[0].source, "seed");
  assert.equal(administrativeSelection.candidates[1].source, "expansion");
  assert.equal(
    administrativeSelection.candidates[1].expansionProvenance[0].direction,
    "inbound",
  );
  assert.deepEqual(
    administrativeSelection.candidates[1].expansionProvenance[0].pathNodeIds,
    [
      CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
      CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
    ],
  );
});

test("old-generation retrieval APIs fail safely on misses and reject ambiguous lookup selectors", () => {
  const graph = createCanonicalValidOldGenerationGraph();

  const missingWalk = walkOldGenerationRelationships(graph, {
    memoryId: "missing-memory",
  });
  const identityWalk = walkOldGenerationRelationships(graph, {
    nodeId: CANONICAL_OLD_GENERATION_NODE_IDS.immutableIdentity,
  });

  assert.equal(missingWalk.startNode, null);
  assert.deepEqual(missingWalk.steps, []);
  assert.equal(identityWalk.startNode, null);
  assert.deepEqual(identityWalk.steps, []);
  assert.throws(
    () =>
      lookupOldGenerationNode(graph, {
        nodeId: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
        memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
      }),
    /requires exactly one selector/,
  );
  assert.throws(
    () =>
      walkOldGenerationRelationships(
        graph,
        {
          memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
        },
        {
          maxDepth: 0,
        },
      ),
    /positive integer/,
  );
  assert.throws(
    () =>
      walkOldGenerationRelationships(
        graph,
        {
          memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
        },
        {
          fanOutLimit: 0,
        },
      ),
    /fanOutLimit must be a positive integer/,
  );
  assert.throws(
    () =>
      expandOldGenerationSeedNodes(
        graph,
        [CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory],
        {
          relations: [OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation],
          edgeTypes: [OLD_GENERATION_EDGE_SCHEMA.supersedes.relation],
        },
      ),
    /edgeTypes and relations must describe the same supported relations/,
  );
});
