import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  MEMORY_NODE_KINDS,
  createIdleWindowSuggestion,
  createMemoryGraph,
  createOfflineBatchLimit,
  createOldGenerationNodeId,
  createRuntimePhase,
} from "../src/index.js";

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

const normalizeAgentToken = (agentId) => {
  const normalizedToken = String(agentId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedToken || "agent";
};

const createConversationProvenance = (observedAt, evidenceId) => ({
  source: "conversation",
  observedAt,
  evidence: [evidenceId],
});

const createOfflineWindowProvenance = (source, observedAt, evidenceId) => ({
  source,
  observedAt,
  evidence: [evidenceId],
});

export const DEFAULT_OFFLINE_FLOW_AGENT_ID = "agent-007";

export const createOfflineFlowIdentity = (overrides = {}) => ({
  agentId: DEFAULT_OFFLINE_FLOW_AGENT_ID,
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality without identity drift.",
  safetyConstraints: [
    "never overwrite immutable identity",
    "consolidate only inside caller-authorized offline windows",
  ],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance", "keep learned traits non-identity"],
  runtimeInvariants: {
    deployment: "sandbox",
    tenant: "zep",
  },
  protectedCoreFacts: ["agent identity is scoped to one runtime agent id"],
  ...overrides,
});

export const createB200OfflineTestBatchLimit = (overrides = {}) =>
  createOfflineBatchLimit({
    ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
    maxAgentsPerBatch: 1,
    maxWorkUnitsPerBatch: 2,
    maxOverwriteTargetsPerBatch: 4,
    maxOverwriteTargetsPerWorkUnit: 3,
    maxIdentityScopesPerBatch: 1,
    ...overrides,
  });

export const createOfflineFlowRuntimeAuthorizationFixture = (options = {}) => {
  const agentId = options.agentId ?? DEFAULT_OFFLINE_FLOW_AGENT_ID;
  const token = normalizeAgentToken(agentId);
  const idleSuggestion = createIdleWindowSuggestion({
    source: "runtime-inactivity-heuristic",
    suggestedPhase: "idle",
    inactivityMs: 45 * 60 * 1000,
    idleThresholdMs: 15 * 60 * 1000,
    note: `No live work detected for ${token}.`,
  });
  const sleepSuggestion = createIdleWindowSuggestion({
    source: "runtime-inactivity-heuristic",
    suggestedPhase: "sleep",
    inactivityMs: 6 * 60 * 60 * 1000,
    idleThresholdMs: 30 * 60 * 1000,
    note: `Extended quiet period detected for ${token}.`,
  });

  return freezeDeep({
    agentId,
    windows: {
      idle: {
        name: "idle",
        runtimePhase: createRuntimePhase("idle", {
          authority: "caller",
          changedAt: "2026-04-12T09:30:00Z",
          note: `Caller opened an idle consolidation window for ${token}.`,
        }),
        inactivitySuggestion: idleSuggestion,
      },
      sleep: {
        name: "sleep",
        runtimePhase: createRuntimePhase("sleep", {
          authority: "caller",
          changedAt: "2026-04-12T23:30:00Z",
          note: `Caller opened a sleep maintenance window for ${token}.`,
        }),
        inactivitySuggestion: sleepSuggestion,
      },
      activeFalsePositive: {
        name: "activeFalsePositive",
        runtimePhase: createRuntimePhase("active", {
          authority: "caller",
          changedAt: "2026-04-12T09:45:00Z",
          note: `The agent is still active despite heuristic quietness for ${token}.`,
        }),
        inactivitySuggestion: idleSuggestion,
      },
      schedulerSleep: {
        name: "schedulerSleep",
        runtimePhase: createRuntimePhase("sleep", {
          authority: "scheduler",
          changedAt: "2026-04-12T23:35:00Z",
          note: `Scheduler inferred sleep for ${token}.`,
        }),
        inactivitySuggestion: sleepSuggestion,
      },
    },
  });
};

export const createOfflineFlowGraphFixture = (options = {}) => {
  const identity = createOfflineFlowIdentity(options.identity);
  const agentId = identity.agentId;
  const token = normalizeAgentToken(agentId);
  const ids = freezeDeep({
    activeWorkingMemoryId: `wm-${token}-focus`,
    maskedWorkingMemoryId: `wm-${token}-masked`,
    activeShortTermMemoryId: `stm-${token}-pattern`,
    staleShortTermMemoryId: `stm-${token}-stale`,
    currentLongTermMemoryId: `ltm-${token}-policy-current`,
    learnedTraitMemoryId: `ltm-${token}-evidence-seeking`,
    historicalLongTermMemoryId: `ltm-${token}-policy-previous`,
    archivedMemoryId: `archive-${token}-superseded-policy`,
    evidenceId: `evidence-${token}-turn-18`,
    consolidationRecordId: `consolidation-${token}-sleep-1`,
  });

  const graph = createMemoryGraph(identity, {
    workingMemory: [
      {
        record: {
          memoryId: ids.activeWorkingMemoryId,
          content: `Live focus item for ${agentId}.`,
          provenance: createConversationProvenance(
            "2026-04-12T09:10:00Z",
            `turn-${ids.activeWorkingMemoryId}`,
          ),
        },
      },
      {
        record: {
          memoryId: ids.maskedWorkingMemoryId,
          content: `Masked branch retained only for offline review for ${agentId}.`,
          provenance: createConversationProvenance(
            "2026-04-12T07:45:00Z",
            `turn-${ids.maskedWorkingMemoryId}`,
          ),
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T08:00:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          provenance: {
            source: "runtime-inactivity-heuristic",
            runtimePhase: "idle",
            policyVersion: "offline-flow-v1",
            auditRecordId: `mask-${token}`,
          },
        },
        lifecycle: {
          state: "inactive",
          inactiveAt: "2026-04-12T08:00:00Z",
          inactiveReason: "batched-for-offline-consolidation",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: ids.activeShortTermMemoryId,
          summary: `Fresh short-term summary for ${agentId}.`,
          provenance: createConversationProvenance(
            "2026-04-12T09:15:00Z",
            `turn-${ids.activeShortTermMemoryId}`,
          ),
        },
      },
      {
        record: {
          memoryId: ids.staleShortTermMemoryId,
          summary: `Older short-term detail awaiting offline triage for ${agentId}.`,
          provenance: createConversationProvenance(
            "2026-04-11T22:30:00Z",
            `turn-${ids.staleShortTermMemoryId}`,
          ),
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T08:05:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          provenance: {
            source: "runtime-inactivity-heuristic",
            runtimePhase: "idle",
            policyVersion: "offline-flow-v1",
            auditRecordId: `mask-${token}-short-term`,
          },
        },
        lifecycle: {
          state: "inactive",
          inactiveAt: "2026-04-12T08:05:00Z",
          inactiveReason: "batched-for-offline-consolidation",
        },
      },
    ],
    importanceIndex: [
      {
        entryId: `importance-${ids.activeWorkingMemoryId}`,
        agentId,
        memoryId: ids.activeWorkingMemoryId,
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 1,
          recency: 0.9,
        },
        lastUpdatedAt: "2026-04-12T09:20:00Z",
      },
      {
        entryId: `importance-${ids.maskedWorkingMemoryId}`,
        agentId,
        memoryId: ids.maskedWorkingMemoryId,
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.2,
          recency: 0.1,
        },
        lastUpdatedAt: "2026-04-12T08:00:00Z",
      },
      {
        entryId: `importance-${ids.activeShortTermMemoryId}`,
        agentId,
        memoryId: ids.activeShortTermMemoryId,
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          taskRelevance: 0.85,
          recency: 0.8,
        },
        lastUpdatedAt: "2026-04-12T09:25:00Z",
      },
      {
        entryId: `importance-${ids.staleShortTermMemoryId}`,
        agentId,
        memoryId: ids.staleShortTermMemoryId,
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          taskRelevance: 0.15,
          recency: 0.05,
        },
        lastUpdatedAt: "2026-04-12T08:05:00Z",
      },
    ],
    longTermMemory: [
      {
        memoryId: ids.currentLongTermMemoryId,
        category: "semantic",
        content: `Durable policy memory for ${agentId}.`,
        summary: `Current durable policy for ${agentId}.`,
        confidence: 0.91,
        stabilizedAt: "2026-04-12T07:30:00Z",
        provenance: createConversationProvenance(
          "2026-04-12T07:20:00Z",
          `turn-${ids.currentLongTermMemoryId}`,
        ),
      },
      {
        memoryId: ids.learnedTraitMemoryId,
        category: "learned_trait",
        content: `${agentId} asks for evidence before acting.`,
        summary: `Evidence-seeking learned trait for ${agentId}.`,
        confidence: 0.82,
        stabilizedAt: "2026-04-12T07:40:00Z",
        provenance: createConversationProvenance(
          "2026-04-12T07:35:00Z",
          `turn-${ids.learnedTraitMemoryId}`,
        ),
        learnedTrait: {
          label: "evidence-seeking",
          confidence: 0.82,
          provenance: createConversationProvenance(
            "2026-04-12T07:35:00Z",
            `turn-${ids.learnedTraitMemoryId}`,
          ),
        },
      },
    ],
    archivedMemory: [
      {
        archiveId: ids.archivedMemoryId,
        agentId,
        originalGeneration: MEMORY_NODE_KINDS.oldGeneration,
        originalMemoryKind: MEMORY_NODE_KINDS.longTermMemory,
        originalMemoryId: ids.historicalLongTermMemoryId,
        originalNodeId: createOldGenerationNodeId(
          MEMORY_NODE_KINDS.longTermMemory,
          agentId,
          ids.historicalLongTermMemoryId,
        ),
        archivalReason: "superseded-old-memory",
        archivedAt: "2026-04-12T01:15:00Z",
        snapshot: {
          memoryId: ids.historicalLongTermMemoryId,
          category: "semantic",
          content: `Previous durable policy for ${agentId}.`,
          summary: `Superseded durable policy for ${agentId}.`,
          confidence: 0.6,
          stabilizedAt: "2026-04-11T22:00:00Z",
          provenance: createConversationProvenance(
            "2026-04-11T21:30:00Z",
            `turn-${ids.historicalLongTermMemoryId}`,
          ),
        },
        provenance: createOfflineWindowProvenance(
          "sleep-window",
          "2026-04-12T01:15:00Z",
          `archive-${ids.archivedMemoryId}`,
        ),
        consolidationState: {
          status: "preserved",
          lastOperation: "preserve",
          journalRecordId: ids.consolidationRecordId,
          policyVersion: "offline-flow-v1",
          sourceMemoryIds: [ids.staleShortTermMemoryId],
        },
      },
    ],
    memoryEvidence: [
      {
        evidenceId: ids.evidenceId,
        kind: "conversation_excerpt",
        source: "conversation",
        observedAt: "2026-04-12T07:00:00Z",
        detail: `The user required grounded, cited answers from ${agentId}.`,
        reference: "turn-18",
        provenance: createConversationProvenance(
          "2026-04-12T07:00:00Z",
          "turn-18",
        ),
      },
    ],
    consolidationJournal: [
      {
        recordId: ids.consolidationRecordId,
        operation: "preserve",
        runtimePhase: "sleep",
        consolidatedAt: "2026-04-12T01:15:00Z",
        sourceMemoryIds: [ids.staleShortTermMemoryId],
        policyVersion: "offline-flow-v1",
        preservedIdentityFields: ["agentId", "persona", "role", "durableMission"],
        provenance: createOfflineWindowProvenance(
          "sleep-window",
          "2026-04-12T01:15:00Z",
          ids.consolidationRecordId,
        ),
      },
    ],
  });

  return freezeDeep({
    identity,
    ids,
    priorityMemoryIds: [
      ids.maskedWorkingMemoryId,
      ids.staleShortTermMemoryId,
      ids.currentLongTermMemoryId,
    ],
    graph,
  });
};

export const createOfflineFlowAgentFixture = (options = {}) => {
  const graphFixture = createOfflineFlowGraphFixture(options);
  const runtime = createOfflineFlowRuntimeAuthorizationFixture({
    agentId: graphFixture.identity.agentId,
  });

  return freezeDeep({
    ...graphFixture,
    runtime,
    teamBatchAgent: {
      agentId: graphFixture.identity.agentId,
      runtimePhase: runtime.windows.idle.runtimePhase,
      inactivitySuggestion: runtime.windows.idle.inactivitySuggestion,
      identityScope: {
        agentId: graphFixture.identity.agentId,
        persona: graphFixture.identity.persona,
        role: graphFixture.identity.role,
      },
      overwriteTargets: [
        {
          scope: "long-term-memory",
          targetId: graphFixture.ids.currentLongTermMemoryId,
          agentId: graphFixture.identity.agentId,
        },
        {
          scope: "archived-memory",
          targetId: graphFixture.ids.archivedMemoryId,
          agentId: graphFixture.identity.agentId,
        },
      ],
    },
  });
};
