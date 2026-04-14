import {
  MEMORY_NODE_KINDS,
  OLD_GENERATION_EDGE_SCHEMA,
  createMemoryGraph,
  createOldGenerationNodeId,
} from "../src/index.js";
import {
  createCanonicalIdentityInput,
  createCanonicalLongTermMemoryInput,
} from "../examples/old-generation-graph-examples.js";

const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const REPRESENTATIVE_AGENT_ID = "agent-007";
const MEMORY_ASSOCIATION_RELATION =
  OLD_GENERATION_EDGE_SCHEMA.memoryAssociation.relation;
const LONG_TERM_ONLY_RETRIEVAL_OPTIONS = freezeDeep({
  limit: 2,
  direction: "outbound",
  relations: [MEMORY_ASSOCIATION_RELATION],
  nodeKinds: [MEMORY_NODE_KINDS.longTermMemory],
});

const createRepresentativeMemory = (memoryId, overrides = {}) =>
  createCanonicalLongTermMemoryInput(memoryId, {
    confidence: 0.88,
    salience: {
      score: 0.82,
      signals: {
        durableSalience: 0.82,
      },
      lastEvaluatedAt: "2026-04-14T03:00:00Z",
    },
    ...overrides,
  });

export const REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_MEMORY_IDS =
  freezeDeep({
    rolloutRunbook: "ltm-rollout-canary-runbook",
    incidentPlaybook: "ltm-incident-pager-playbook",
    rollbackGuardrails: "ltm-rollback-guardrails",
    deploymentVerification: "ltm-deployment-verification-queue",
    statusComms: "ltm-status-page-comms",
    recoveryPostmortem: "ltm-recovery-postmortem-template",
    invoiceReplay: "ltm-invoice-replay-runbook",
    creditEscalation: "ltm-credit-adjustment-escalation",
    billingBridge: "ltm-billing-recovery-bridge",
    ledgerAudit: "ltm-ledger-audit-trail",
    revenueOpsHandoff: "ltm-revenue-ops-handoff",
    secretPruning: "ltm-secret-pruning-boundary",
    tenantIsolation: "ltm-tenant-isolation-guardrail",
  });

const createRepresentativeNodeIds = (memoryIds) =>
  freezeDeep(
    Object.fromEntries(
      Object.values(memoryIds).map((memoryId) => [
        memoryId,
        createOldGenerationNodeId(
          MEMORY_NODE_KINDS.longTermMemory,
          REPRESENTATIVE_AGENT_ID,
          memoryId,
        ),
      ]),
    ),
  );

const createRepresentativeLongTermMemories = (memoryIds) =>
  freezeDeep([
    createRepresentativeMemory(memoryIds.rolloutRunbook, {
      content:
        "Canary sequencing runbook for staged deployment recovery. Follow the " +
        "canary checkpoint order, validate sequencing gates, and recover traffic " +
        "without drifting the rollout plan.",
      summary: "Canary sequencing deployment runbook.",
      confidence: 0.95,
    }),
    createRepresentativeMemory(memoryIds.incidentPlaybook, {
      content:
        "Pager commander playbook for deployment incidents. Assign the pager owner, " +
        "coordinate incident commanders, and keep recovery escalation aligned.",
      summary: "Pager commander incident playbook.",
      confidence: 0.92,
    }),
    createRepresentativeMemory(memoryIds.rollbackGuardrails, {
      content:
        "Shared recovery guardrails define stop-loss thresholds, safe revert order, " +
        "and batch handoff rules between deployment and incident memory clusters.",
      summary: "Shared recovery guardrails memory.",
      confidence: 0.9,
    }),
    createRepresentativeMemory(memoryIds.deploymentVerification, {
      content:
        "Deployment verification queue tracks post-revert checks, environment " +
        "validation, and staged traffic restoration after guardrail approval.",
      summary: "Deployment verification queue.",
      confidence: 0.86,
    }),
    createRepresentativeMemory(memoryIds.statusComms, {
      content:
        "Status page communication guidance keeps customer notices consistent " +
        "during outages and recovery updates.",
      summary: "Status page communication guidance.",
      confidence: 0.84,
    }),
    createRepresentativeMemory(memoryIds.recoveryPostmortem, {
      content:
        "Recovery retrospective template records stop-loss decisions, failed " +
        "handoffs, and follow-up actions after a shared guardrail path is used.",
      summary: "Recovery retrospective template.",
      confidence: 0.82,
    }),
    createRepresentativeMemory(memoryIds.invoiceReplay, {
      content:
        "Invoice ledger replay runbook rebuilds invoice batches, replays missing " +
        "ledger entries, and restores reconciliation state after payment drift.",
      summary: "Invoice ledger replay runbook.",
      confidence: 0.94,
    }),
    createRepresentativeMemory(memoryIds.creditEscalation, {
      content:
        "Reimbursement escalation checklist routes manual credit approvals, " +
        "finance commander review, and dispute handoff timing.",
      summary: "Reimbursement escalation checklist.",
      confidence: 0.9,
    }),
    createRepresentativeMemory(memoryIds.billingBridge, {
      content:
        "Shared billing recovery bridge connects batch checkpoints with synchronized " +
        "handoffs so finance fixes stay aligned.",
      summary: "Shared billing recovery bridge.",
      confidence: 0.89,
    }),
    createRepresentativeMemory(memoryIds.ledgerAudit, {
      content:
        "Ledger audit trail preserves reconciliation evidence, replay checkpoints, " +
        "and finance review notes for durable inspection.",
      summary: "Ledger audit trail memory.",
      confidence: 0.87,
    }),
    createRepresentativeMemory(memoryIds.revenueOpsHandoff, {
      content:
        "Revenue operations liaison template coordinates downstream notifications " +
        "after finance remediation work is complete.",
      summary: "Revenue operations handoff template.",
      confidence: 0.83,
    }),
    createRepresentativeMemory(memoryIds.secretPruning, {
      content:
        "Secret pruning boundary drops API keys and credentials before hippocampus " +
        "promotion or long-term indexing.",
      summary: "Secret pruning boundary.",
      confidence: 0.93,
    }),
    createRepresentativeMemory(memoryIds.tenantIsolation, {
      content:
        "Tenant isolation guardrail keeps channel memory partitioned across agents " +
        "sharing a zepia runtime authority.",
      summary: "Tenant isolation guardrail.",
      confidence: 0.91,
    }),
  ]);

const createRepresentativeEdges = (nodeIds, memoryIds) =>
  freezeDeep([
    {
      from: nodeIds[memoryIds.rolloutRunbook],
      to: nodeIds[memoryIds.rollbackGuardrails],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.rolloutRunbook],
      to: nodeIds[memoryIds.deploymentVerification],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.incidentPlaybook],
      to: nodeIds[memoryIds.rollbackGuardrails],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.incidentPlaybook],
      to: nodeIds[memoryIds.statusComms],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.rollbackGuardrails],
      to: nodeIds[memoryIds.recoveryPostmortem],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.invoiceReplay],
      to: nodeIds[memoryIds.billingBridge],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.invoiceReplay],
      to: nodeIds[memoryIds.ledgerAudit],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.creditEscalation],
      to: nodeIds[memoryIds.billingBridge],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
    {
      from: nodeIds[memoryIds.creditEscalation],
      to: nodeIds[memoryIds.revenueOpsHandoff],
      relation: MEMORY_ASSOCIATION_RELATION,
    },
  ]);

const createRepresentativeQueryScenarios = (memoryIds, nodeIds) =>
  freezeDeep({
    deploymentRecovery: {
      prompt: "canary pager sequencing",
      options: {
        ...LONG_TERM_ONLY_RETRIEVAL_OPTIONS,
        maxDepth: 2,
      },
      expectedSeedMemoryIds: [
        memoryIds.rolloutRunbook,
        memoryIds.incidentPlaybook,
      ],
      expectedRankedCandidateMemoryIds: [
        memoryIds.rolloutRunbook,
        memoryIds.incidentPlaybook,
        memoryIds.rollbackGuardrails,
        memoryIds.deploymentVerification,
        memoryIds.statusComms,
        memoryIds.recoveryPostmortem,
      ],
      expectedPageRankEdges: [
        {
          fromNodeId: nodeIds[memoryIds.incidentPlaybook],
          toNodeId: nodeIds[memoryIds.rollbackGuardrails],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.incidentPlaybook],
          toNodeId: nodeIds[memoryIds.statusComms],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.rollbackGuardrails],
          toNodeId: nodeIds[memoryIds.recoveryPostmortem],
          weight: 2,
          traversalCount: 2,
        },
        {
          fromNodeId: nodeIds[memoryIds.rolloutRunbook],
          toNodeId: nodeIds[memoryIds.deploymentVerification],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.rolloutRunbook],
          toNodeId: nodeIds[memoryIds.rollbackGuardrails],
          weight: 1,
          traversalCount: 1,
        },
      ],
      expectedPageRankWinnerMemoryId: memoryIds.rollbackGuardrails,
      expectedPageRankLoserMemoryId: memoryIds.deploymentVerification,
      expectedDepthTwoMemoryId: memoryIds.recoveryPostmortem,
      expectedDepthTwoPathNodeIds: [
        nodeIds[memoryIds.rolloutRunbook],
        nodeIds[memoryIds.rollbackGuardrails],
        nodeIds[memoryIds.recoveryPostmortem],
      ],
    },
    billingRecovery: {
      prompt: "invoice reimbursement commander dispute ledger",
      options: {
        ...LONG_TERM_ONLY_RETRIEVAL_OPTIONS,
        maxDepth: 1,
      },
      expectedSeedMemoryIds: [
        memoryIds.creditEscalation,
        memoryIds.invoiceReplay,
      ],
      expectedRankedCandidateMemoryIds: [
        memoryIds.creditEscalation,
        memoryIds.invoiceReplay,
        memoryIds.billingBridge,
        memoryIds.revenueOpsHandoff,
        memoryIds.ledgerAudit,
      ],
      expectedPageRankEdges: [
        {
          fromNodeId: nodeIds[memoryIds.creditEscalation],
          toNodeId: nodeIds[memoryIds.billingBridge],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.creditEscalation],
          toNodeId: nodeIds[memoryIds.revenueOpsHandoff],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.invoiceReplay],
          toNodeId: nodeIds[memoryIds.billingBridge],
          weight: 1,
          traversalCount: 1,
        },
        {
          fromNodeId: nodeIds[memoryIds.invoiceReplay],
          toNodeId: nodeIds[memoryIds.ledgerAudit],
          weight: 1,
          traversalCount: 1,
        },
      ],
      expectedPageRankWinnerMemoryId: memoryIds.billingBridge,
      expectedPageRankLoserMemoryId: memoryIds.revenueOpsHandoff,
    },
  });

export const REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_SCENARIO_IDS =
  freezeDeep(["deploymentRecovery", "billingRecovery"]);

export const createRepresentativeOldGenerationRetrievalFixture = () => {
  const memoryIds = REPRESENTATIVE_OLD_GENERATION_RETRIEVAL_MEMORY_IDS;
  const nodeIds = createRepresentativeNodeIds(memoryIds);
  const graph = createMemoryGraph(
    createCanonicalIdentityInput({
      agentId: REPRESENTATIVE_AGENT_ID,
      persona: "runtime memory authority",
      role: "channel-memory-steward",
      durableMission:
        "Retain the most relevant long-term context through PageRank traversal while " +
        "keeping secrets outside the hippocampus boundary.",
    }),
    {
      longTermMemory: createRepresentativeLongTermMemories(memoryIds),
      edges: createRepresentativeEdges(nodeIds, memoryIds),
    },
  );

  return freezeDeep({
    agentId: REPRESENTATIVE_AGENT_ID,
    graph,
    memoryIds,
    nodeIds,
    queryScenarios: createRepresentativeQueryScenarios(memoryIds, nodeIds),
  });
};
