import { evaluateIdleWindowAuthorization } from "./runtime-phase.js";
import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
} from "./batch-plan.js";

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

const freezeRecordList = (records) => Object.freeze([...records]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeRequiredString = (value, label) => {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeAgentId = (value, label = "agentId") =>
  normalizeRequiredString(value, label);

const normalizeOptionalString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredString(value, label);
};

const normalizeNonEmptyToken = (value, label) =>
  normalizeRequiredString(value, label).toLowerCase();

const createUniqueStringList = (values) => Object.freeze([...new Set(values)]);

const normalizeIdentityScope = (value, agentId, label) => {
  if (value === undefined || value === null) {
    return freezeDeep({
      agentId,
      persona: null,
      role: null,
    });
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep({
    agentId:
      value.agentId === undefined || value.agentId === null
        ? agentId
        : normalizeAgentId(value.agentId, `${label}.agentId`),
    persona: normalizeOptionalString(value.persona, `${label}.persona`),
    role: normalizeOptionalString(value.role, `${label}.role`),
  });
};

const normalizeOverwriteTargetId = (value, label) => {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new TypeError(`${label} must be a string, number, or bigint`);
  }

  const normalizedValue = String(value).trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeOverwriteTarget = (value, agentId, label) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const targetIdInput =
    value.targetId ??
    value.memoryId ??
    value.archiveId ??
    value.recordId ??
    value.key;

  return freezeDeep({
    scope: normalizeNonEmptyToken(
      value.scope ?? value.kind ?? "long-term-memory",
      `${label}.scope`,
    ),
    targetId: normalizeOverwriteTargetId(targetIdInput, `${label}.targetId`),
    agentId:
      value.agentId === undefined || value.agentId === null
        ? agentId
        : normalizeAgentId(value.agentId, `${label}.agentId`),
  });
};

const normalizeOverwriteTargets = (value, agentId, label) => {
  if (value === undefined || value === null) {
    return freezeRecordList([]);
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return freezeRecordList(
    value.map((entry, index) =>
      normalizeOverwriteTarget(entry, agentId, `${label}[${index}]`),
    ),
  );
};

const normalizeBatchAgentInput = (value, index) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`agents[${index}] must be an object`);
  }

  const agentId = normalizeAgentId(value.agentId, `agents[${index}].agentId`);

  return freezeDeep({
    agentId,
    runtimePhase: value.runtimePhase,
    inactivitySuggestion: value.inactivitySuggestion ?? null,
    identityScope: normalizeIdentityScope(
      value.identityScope,
      agentId,
      `agents[${index}].identityScope`,
    ),
    overwriteTargets: normalizeOverwriteTargets(
      value.overwriteTargets,
      agentId,
      `agents[${index}].overwriteTargets`,
    ),
  });
};

const createBatchIdentifier = (coordinationSignal, index, agentIds) =>
  `${coordinationSignal}-batch-${index + 1}:${agentIds.join(",")}`;

const createBatchGroup = (coordinationSignal, index, agents, defaultBatchLimit) => {
  const batchId = createBatchIdentifier(
    coordinationSignal,
    index,
    agents.map((agent) => agent.agentId),
  );
  const batchPlan = createOfflineBatchPlan({
    planId: batchId,
    coordinationSignal,
    limit: defaultBatchLimit,
    workUnits: agents.map((agent, agentIndex) => ({
      workUnitId: `${batchId}/agent/${agent.agentId}`,
      batchId,
      agentId: agent.agentId,
      operation: "offline-consolidation",
      coordinationSignal,
      sequence: agentIndex,
      priority: 0,
      identityScopeKey: agent.identityIsolationKey,
      overwriteNamespace: agent.overwriteNamespace,
      overwriteTargets: agent.overwriteTargets.map(
        (target) => `${target.scope}:${target.targetId}`,
      ),
      runtimePhase: agent.authorization.runtimePhase?.value ?? null,
      metadata: {
        safetyViolations: [...agent.safetyViolations],
      },
    })),
  });

  return freezeDeep({
    batchId,
    coordinationSignal,
    executionMode: "offline-independent",
    isolationMode: "agent-scoped",
    writeIsolationMode: "agent-scoped",
    agentIds: freezeRecordList(agents.map((agent) => agent.agentId)),
    agents: freezeRecordList(agents),
    batchPlan,
  });
};

const buildBatchGroups = (eligibleAgents, teamIdle, defaultBatchLimit) => {
  if (eligibleAgents.length === 0) {
    return freezeRecordList([]);
  }

  const coordinationSignal = teamIdle ? "team-idle" : "independent";

  if (teamIdle) {
    return freezeRecordList([
      createBatchGroup(coordinationSignal, 0, eligibleAgents, defaultBatchLimit),
    ]);
  }

  return freezeRecordList(
    eligibleAgents.map((agent, index) =>
      createBatchGroup(coordinationSignal, index, [agent], defaultBatchLimit),
    ),
  );
};

const createBatchAgentPlan = (agent, agentIdCounts, teamIdle) => {
  const authorization = freezeDeep(
    evaluateIdleWindowAuthorization({
      agentId: agent.agentId,
      runtimePhase: agent.runtimePhase,
      inactivitySuggestion: agent.inactivitySuggestion,
      teamIdle,
    }),
  );
  const safetyViolations = [];

  if (agent.identityScope.agentId !== agent.agentId) {
    safetyViolations.push("shared-identity-scope");
  }

  if ((agentIdCounts.get(agent.agentId) ?? 0) > 1) {
    safetyViolations.push("duplicate-agent-batch-entry");
  }

  agent.overwriteTargets.forEach((target) => {
    if (target.agentId !== agent.agentId) {
      safetyViolations.push("cross-agent-overwrite-target");
    }
  });

  const uniqueViolations = createUniqueStringList(safetyViolations);
  const batchEligible = authorization.eligible && uniqueViolations.length === 0;

  return freezeDeep({
    agentId: agent.agentId,
    authorization,
    identityScope: agent.identityScope,
    identityIsolationKey: `agent:${agent.agentId}`,
    sharedIdentity: false,
    overwriteNamespace: `agent:${agent.agentId}`,
    overwriteTargets: agent.overwriteTargets,
    safetyViolations: uniqueViolations,
    batchEligible,
    blockedReason:
      batchEligible
        ? null
        : authorization.blockedReason ?? uniqueViolations[0] ?? null,
    requiresIndependentWrites: true,
  });
};

export const planTeamIdleConsolidationBatch = (options = {}) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "team-idle consolidation batch planning options must be an object",
    );
  }

  const agentsInput = options.agents ?? [];

  if (!Array.isArray(agentsInput)) {
    throw new TypeError("team-idle consolidation batch planning agents must be an array");
  }

  const teamIdle = Boolean(options.teamIdle);
  const defaultBatchLimit = createOfflineBatchLimit(
    options.batchLimit ?? DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  );
  const normalizedAgents = agentsInput.map((agent, index) =>
    normalizeBatchAgentInput(agent, index),
  );
  const agentIdCounts = normalizedAgents.reduce((counts, agent) => {
    counts.set(agent.agentId, (counts.get(agent.agentId) ?? 0) + 1);
    return counts;
  }, new Map());
  const agentPlans = normalizedAgents.map((agent) =>
    createBatchAgentPlan(agent, agentIdCounts, teamIdle),
  );
  const eligibleAgents = freezeRecordList(
    agentPlans.filter((agent) => agent.batchEligible),
  );
  const blockedAgents = freezeRecordList(
    agentPlans.filter((agent) => !agent.batchEligible),
  );
  const batches = buildBatchGroups(eligibleAgents, teamIdle, defaultBatchLimit);

  return freezeDeep({
    teamIdle,
    coordinationSignal: teamIdle ? "team-idle" : "independent",
    windowAuthority: "runtime-phase",
    defaultBatchLimit,
    eligibleAgents,
    blockedAgents,
    eligibleCount: eligibleAgents.length,
    blockedCount: blockedAgents.length,
    batchWindowOpen: eligibleAgents.length > 0,
    batchCount: batches.length,
    batches,
  });
};
