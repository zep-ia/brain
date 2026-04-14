import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  createLongTermMemory,
  createMemoryGraph,
  createOldGenerationEdge,
  createOldGenerationEdgeId,
  createOldGenerationNodeId,
} from "../src/index.js";

export const CANONICAL_OLD_GENERATION_AGENT_ID = "agent-007";
export const CANONICAL_OLD_GENERATION_POLICY_VERSION = "old-generation-v1";
export const CANONICAL_OLD_GENERATION_TIMESTAMPS = Object.freeze({
  observedAt: "2026-04-12T09:00:00Z",
  consolidatedAt: "2026-04-12T09:15:00Z",
  supersededAt: "2026-04-12T09:16:00Z",
});

export const CANONICAL_OLD_GENERATION_LOCAL_IDS = Object.freeze({
  currentMemoryId: "ltm-policy-current",
  historicalMemoryId: "ltm-policy-previous",
  learnedTraitMemoryId: "ltm-evidence-seeking",
  evidenceId: "evidence-citation-turn-18",
  consolidationRecordId: "consolidation-supersede-1",
  alternateSuccessorMemoryId: "ltm-policy-current-alt",
});

export const CANONICAL_OLD_GENERATION_NODE_IDS = Object.freeze({
  immutableIdentity: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.immutableIdentity,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    "self",
  ),
  currentMemory: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
  ),
  historicalMemory: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
  ),
  learnedTraitMemory: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
  ),
  memoryEvidence: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.memoryEvidence,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  ),
  consolidationRecord: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.consolidationRecord,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  ),
  alternateSuccessorMemory: createOldGenerationNodeId(
    MEMORY_NODE_KINDS.longTermMemory,
    CANONICAL_OLD_GENERATION_AGENT_ID,
    CANONICAL_OLD_GENERATION_LOCAL_IDS.alternateSuccessorMemoryId,
  ),
});

const cloneGraph = (graph) => JSON.parse(JSON.stringify(graph));

const createConversationProvenance = (evidence) => ({
  source: "conversation",
  observedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.observedAt,
  evidence: [evidence],
});

const createConsolidationProvenance = (evidence = "consolidation-run-1") => ({
  source: "idle-window",
  observedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
  evidence: [evidence],
});

export const createCanonicalIdentityInput = (overrides = {}) => ({
  agentId: CANONICAL_OLD_GENERATION_AGENT_ID,
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality.",
  safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance"],
  runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
  protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  ...overrides,
});

export const createCanonicalLongTermMemoryInput = (memoryId, overrides = {}) => ({
  memoryId,
  category: "semantic",
  content: `Durable memory ${memoryId}.`,
  summary: `Summary for ${memoryId}.`,
  confidence: 0.84,
  stabilizedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
  provenance: createConversationProvenance(`turn-${memoryId}`),
  ...overrides,
});

export const createCanonicalLearnedTraitInput = (overrides = {}) =>
  createCanonicalLongTermMemoryInput(
    CANONICAL_OLD_GENERATION_LOCAL_IDS.learnedTraitMemoryId,
    {
      category: "learned_trait",
      content: "The agent asks for evidence before acting.",
      summary: "Evidence-seeking learned trait.",
      confidence: 0.82,
      provenance: createConversationProvenance("turn-18"),
      learnedTrait: {
        label: "evidence-seeking",
        confidence: 0.82,
        provenance: createConversationProvenance("turn-18"),
      },
      ...overrides,
    },
  );

export const createCanonicalEvidenceInput = (overrides = {}) => ({
  evidenceId: CANONICAL_OLD_GENERATION_LOCAL_IDS.evidenceId,
  kind: "conversation_excerpt",
  source: "conversation",
  observedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.observedAt,
  detail: "The user asked for explicit citations before accepting the answer.",
  reference: "turn-18",
  provenance: createConversationProvenance("turn-18"),
  ...overrides,
});

export const createCanonicalConsolidationRecordInput = (overrides = {}) => ({
  recordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
  operation: "supersede",
  runtimePhase: "idle",
  consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
  sourceMemoryIds: ["stm-41", "stm-42"],
  policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
  preservedIdentityFields: ["agentId", "persona", "role", "durableMission"],
  provenance: createConsolidationProvenance(),
  ...overrides,
});

const findOldGenerationEdgeByRelation = (graph, relation) =>
  graph.edges.find((edge) => edge.relation === relation);

export const createCanonicalValidOldGenerationGraph = () =>
  createMemoryGraph(createCanonicalIdentityInput(), {
    longTermMemory: [
      createCanonicalLongTermMemoryInput(
        CANONICAL_OLD_GENERATION_LOCAL_IDS.currentMemoryId,
        {
          content: "The agent must include source citations in user-facing summaries.",
          summary: "Current citation policy for user-facing summaries.",
          confidence: 0.91,
          provenance: createConversationProvenance("turn-24"),
        },
      ),
      createCanonicalLongTermMemoryInput(
        CANONICAL_OLD_GENERATION_LOCAL_IDS.historicalMemoryId,
        {
          content: "The agent may omit citations when the answer is short.",
          summary: "Previous citation policy before the stricter rule.",
          confidence: 0.62,
          provenance: createConversationProvenance("turn-12"),
          temporalContext: {
            supersededAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.supersededAt,
          },
          consolidationState: {
            status: "superseded",
            lastOperation: "supersede",
            journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
            policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
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
        from: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
        to: CANONICAL_OLD_GENERATION_NODE_IDS.learnedTraitMemory,
        relation: OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation,
        provenance: createConsolidationProvenance(),
        temporalContext: {
          firstObservedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.observedAt,
          lastObservedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
          consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        },
        salience: {
          score: 0.61,
          signals: {
            coRetrieval: 0.61,
          },
          lastEvaluatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        },
        consolidationState: {
          status: "preserved",
          policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
        },
      },
      {
        from: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
        to: CANONICAL_OLD_GENERATION_NODE_IDS.memoryEvidence,
        relation: OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
        provenance: createConsolidationProvenance(),
        temporalContext: {
          firstObservedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.observedAt,
          lastObservedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
          consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        },
        consolidationState: {
          status: "preserved",
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
        },
      },
      {
        from: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
        to: CANONICAL_OLD_GENERATION_NODE_IDS.consolidationRecord,
        relation: OLD_GENERATION_EDGE_SCHEMA.createdByConsolidation.relation,
        provenance: createConsolidationProvenance(),
        temporalContext: {
          consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        },
        consolidationState: {
          status: "superseded",
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
          sourceMemoryIds: ["stm-41", "stm-42"],
          preservedIdentityFields: ["agentId", "persona", "role", "durableMission"],
        },
      },
      {
        from: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
        to: CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
        relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
        provenance: createConsolidationProvenance(),
        temporalContext: {
          consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
          supersededAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.supersededAt,
        },
        consolidationState: {
          status: "superseded",
          journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
          policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
          sourceMemoryIds: ["stm-41", "stm-42"],
        },
      },
    ],
  });

const buildOrphanedEvidenceGraph = () => {
  const graph = cloneGraph(createCanonicalValidOldGenerationGraph());
  graph.oldGeneration.memoryEvidence = [];
  return graph;
};

const buildRelationToNodeKindMismatchGraph = () => {
  const graph = cloneGraph(createCanonicalValidOldGenerationGraph());
  const evidenceEdge = findOldGenerationEdgeByRelation(
    graph,
    OLD_GENERATION_EDGE_SCHEMA.supportedByEvidence.relation,
  );

  evidenceEdge.to = CANONICAL_OLD_GENERATION_NODE_IDS.consolidationRecord;
  evidenceEdge.edgeId = createOldGenerationEdgeId(evidenceEdge);

  return graph;
};

const buildUnsafeLearnedTraitGraph = () => {
  const graph = cloneGraph(createCanonicalValidOldGenerationGraph());
  const learnedTraitMemory = graph.oldGeneration.longTermMemory.find(
    (memory) => memory.category === "learned_trait",
  );

  learnedTraitMemory.consolidationState.protectedFromIdentityPromotion = false;
  return graph;
};

const buildSupersedesCycleGraph = () => {
  const graph = cloneGraph(createCanonicalValidOldGenerationGraph());

  graph.edges.push(
    createOldGenerationEdge({
      agentId: CANONICAL_OLD_GENERATION_AGENT_ID,
      from: CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
      to: CANONICAL_OLD_GENERATION_NODE_IDS.currentMemory,
      relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
      provenance: createConsolidationProvenance("consolidation-run-cycle"),
      temporalContext: {
        consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        supersededAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.supersededAt,
      },
      consolidationState: {
        status: "superseded",
        journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
        policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
        sourceMemoryIds: ["stm-40"],
      },
    }),
  );

  return graph;
};

const buildSupersedesMultipleSuccessorsGraph = () => {
  const graph = cloneGraph(createCanonicalValidOldGenerationGraph());

  graph.oldGeneration.longTermMemory.push(
    createLongTermMemory({
      agentId: CANONICAL_OLD_GENERATION_AGENT_ID,
      memoryId: CANONICAL_OLD_GENERATION_LOCAL_IDS.alternateSuccessorMemoryId,
      category: "semantic",
      content: "Alternate citation policy candidate created by a conflicting batch.",
      summary: "Conflicting alternate replacement memory.",
      confidence: 0.67,
      stabilizedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
      provenance: createConversationProvenance("turn-alt"),
    }),
  );

  graph.edges.push(
    createOldGenerationEdge({
      agentId: CANONICAL_OLD_GENERATION_AGENT_ID,
      from: CANONICAL_OLD_GENERATION_NODE_IDS.alternateSuccessorMemory,
      to: CANONICAL_OLD_GENERATION_NODE_IDS.historicalMemory,
      relation: OLD_GENERATION_EDGE_SCHEMA.supersedes.relation,
      provenance: createConsolidationProvenance("consolidation-run-alt"),
      temporalContext: {
        consolidatedAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.consolidatedAt,
        supersededAt: CANONICAL_OLD_GENERATION_TIMESTAMPS.supersededAt,
      },
      consolidationState: {
        status: "superseded",
        journalRecordId: CANONICAL_OLD_GENERATION_LOCAL_IDS.consolidationRecordId,
        policyVersion: CANONICAL_OLD_GENERATION_POLICY_VERSION,
        sourceMemoryIds: ["stm-alt"],
      },
    }),
  );

  return graph;
};

export const CANONICAL_INVALID_OLD_GENERATION_GRAPH_EXAMPLES = Object.freeze([
  {
    name: "orphaned-supported-by-evidence-edge",
    rule:
      "Old-generation edges must reference nodes that exist in the same agent-scoped durable graph.",
    expectedError: /missing target node/,
    buildGraph: buildOrphanedEvidenceGraph,
  },
  {
    name: "relation-to-node-kind-mismatch",
    rule:
      "Each old-generation relation is locked to its documented source and target node kinds.",
    expectedError: /must be a "memory_evidence" node/,
    buildGraph: buildRelationToNodeKindMismatchGraph,
  },
  {
    name: "learned-trait-without-identity-protection",
    rule:
      "Learned traits remain in long-term memory and must keep identity-promotion protection enabled.",
    expectedError: /protectedFromIdentityPromotion set to true/,
    buildGraph: buildUnsafeLearnedTraitGraph,
  },
  {
    name: "supersedes-cycle",
    rule: "Supersedes edges must remain acyclic.",
    expectedError: /must remain acyclic/,
    buildGraph: buildSupersedesCycleGraph,
  },
  {
    name: "supersedes-multiple-canonical-successors",
    rule:
      "A historical memory can have only one canonical successor in a supersedes chain.",
    expectedError: /cannot have multiple canonical successors/,
    buildGraph: buildSupersedesMultipleSuccessorsGraph,
  },
]);
