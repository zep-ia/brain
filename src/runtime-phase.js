const freezeRecord = (record) => Object.freeze(record);

const freezeRecordList = (records) =>
  Object.freeze(records.map((record) => freezeRecord(record)));

const normalizeNonEmptyToken = (value, label) => {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeAgentId = (agentId) => {
  if (typeof agentId !== "string") {
    throw new TypeError("agentId must be a string");
  }

  const normalizedAgentId = agentId.trim();

  if (!normalizedAgentId) {
    throw new TypeError("agentId must not be empty");
  }

  return normalizedAgentId;
};

const normalizeNonNegativeNumber = (value, label) => {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return value;
};

const normalizePositiveInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return value;
};

const normalizeNonNegativeInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }

  return value;
};

export const RUNTIME_AUTHORIZED_IDLE_PHASES = Object.freeze([
  "idle",
  "rest",
  "break",
  "sleep",
]);

const EXPLICIT_PHASE_AUTHORITIES = new Set(["caller"]);
const RUNTIME_AUTHORIZED_IDLE_PHASE_SET = new Set(
  RUNTIME_AUTHORIZED_IDLE_PHASES,
);

export const createRuntimePhase = (value, options = {}) =>
  freezeRecord({
    value: normalizeNonEmptyToken(value, "runtime phase"),
    authority: normalizeNonEmptyToken(
      options.authority ?? options.source ?? "caller",
      "runtime phase authority",
    ),
    changedAt: options.changedAt ?? null,
    note: options.note ?? null,
  });

const normalizeRuntimePhase = (runtimePhase) => {
  if (typeof runtimePhase === "string") {
    return createRuntimePhase(runtimePhase);
  }

  if (!runtimePhase || typeof runtimePhase !== "object") {
    return null;
  }

  return createRuntimePhase(
    runtimePhase.value ?? runtimePhase.phase ?? runtimePhase.name,
    runtimePhase,
  );
};

export const createIdleWindowSuggestion = (options = {}) => {
  const inactivityMs = normalizeNonNegativeNumber(
    options.inactivityMs ?? 0,
    "inactivityMs",
  );
  const idleThresholdMs =
    options.idleThresholdMs === undefined || options.idleThresholdMs === null
      ? null
      : normalizeNonNegativeNumber(options.idleThresholdMs, "idleThresholdMs");

  return freezeRecord({
    source: normalizeNonEmptyToken(
      options.source ?? "runtime-inactivity-heuristic",
      "idle window suggestion source",
    ),
    suggestedPhase: normalizeNonEmptyToken(
      options.suggestedPhase ?? "idle",
      "idle window suggestion phase",
    ),
    inactivityMs,
    idleThresholdMs,
    thresholdReached:
      idleThresholdMs === null ? inactivityMs > 0 : inactivityMs >= idleThresholdMs,
    authorizesConsolidation: false,
    note: options.note ?? null,
  });
};

const createDefaultReserveWindowMs = (idleTriggerWindowMs) =>
  Math.min(
    Math.floor(idleTriggerWindowMs * 0.2),
    Math.max(idleTriggerWindowMs - 1, 0),
  );

export const createIdleWindowReconstructionBudget = (options = {}) => {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("idle window reconstruction budget options must be an object");
  }

  const idleTriggerWindowMs = normalizePositiveInteger(
    options.idleTriggerWindowMs,
    "idleTriggerWindowMs",
  );
  const requestedReserveWindowMs =
    options.reserveWindowMs ?? options.reconstructionReserveWindowMs;
  const reserveWindowMs = Math.min(
    requestedReserveWindowMs === undefined || requestedReserveWindowMs === null
      ? createDefaultReserveWindowMs(idleTriggerWindowMs)
      : normalizeNonNegativeInteger(
          requestedReserveWindowMs,
          "reserveWindowMs",
        ),
    Math.max(idleTriggerWindowMs - 1, 0),
  );

  return freezeRecord({
    source: "idle-trigger-window",
    idleTriggerWindowMs,
    reserveWindowMs,
    reconstructionBudgetMs: Math.max(1, idleTriggerWindowMs - reserveWindowMs),
  });
};

const normalizeIdleWindowSuggestion = (suggestion) => {
  if (!suggestion) {
    return null;
  }

  if (typeof suggestion !== "object") {
    throw new TypeError("idle window suggestion must be an object");
  }

  return createIdleWindowSuggestion(suggestion);
};

const getBlockedReason = (runtimePhase) => {
  if (!runtimePhase) {
    return "missing-runtime-phase";
  }

  if (!EXPLICIT_PHASE_AUTHORITIES.has(runtimePhase.authority)) {
    return "runtime-phase-not-caller-controlled";
  }

  if (!RUNTIME_AUTHORIZED_IDLE_PHASE_SET.has(runtimePhase.value)) {
    return "runtime-phase-not-idle-window";
  }

  return null;
};

export const evaluateIdleWindowAuthorization = (options = {}) => {
  const runtimePhase = normalizeRuntimePhase(options.runtimePhase);
  const blockedReason = getBlockedReason(runtimePhase);
  const eligible = blockedReason === null;
  const reconstructionBudget =
    options.idleTriggerWindowMs === undefined || options.idleTriggerWindowMs === null
      ? null
      : createIdleWindowReconstructionBudget({
          idleTriggerWindowMs: options.idleTriggerWindowMs,
          reserveWindowMs:
            options.reserveWindowMs ?? options.reconstructionReserveWindowMs,
        });

  return freezeRecord({
    agentId: normalizeAgentId(options.agentId),
    runtimePhase,
    inactivitySuggestion: normalizeIdleWindowSuggestion(
      options.inactivitySuggestion,
    ),
    reconstructionBudget,
    teamIdle: Boolean(options.teamIdle),
    eligible,
    opensConsolidation: eligible,
    decisionSource: eligible ? "runtime-phase" : null,
    blockedReason,
    requiresOfflineExecution: true,
  });
};

export const planIdleWindowConsolidation = (options = {}) => {
  const agents = options.agents ?? [];

  if (!Array.isArray(agents)) {
    throw new TypeError("agents must be an array");
  }

  const teamIdle = Boolean(options.teamIdle);
  const decisions = agents.map((agent) =>
    evaluateIdleWindowAuthorization({
      agentId: agent.agentId,
      runtimePhase: agent.runtimePhase,
      inactivitySuggestion: agent.inactivitySuggestion,
      idleTriggerWindowMs: agent.idleTriggerWindowMs,
      reserveWindowMs: agent.reserveWindowMs,
      reconstructionReserveWindowMs: agent.reconstructionReserveWindowMs,
      teamIdle,
    }),
  );

  const eligibleAgents = freezeRecordList(
    decisions.filter((decision) => decision.eligible),
  );
  const blockedAgents = freezeRecordList(
    decisions.filter((decision) => !decision.eligible),
  );

  return freezeRecord({
    teamIdle,
    windowAuthority: "runtime-phase",
    eligibleAgents,
    blockedAgents,
    eligibleCount: eligibleAgents.length,
    blockedCount: blockedAgents.length,
    batchWindowOpen: eligibleAgents.length > 0,
  });
};
