import { createOfflineBatchLimit, createOfflineBatchPlan } from "./batch-plan.js";
import { evaluateIdleWindowAuthorization } from "./runtime-phase.js";

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

const freezeRecord = (record) => Object.freeze(record);
const freezeRecordList = (records) => Object.freeze([...records]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizePositiveInteger = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return numericValue;
};

const normalizeExecutionOptions = (options) => {
  if (options === undefined || options === null) {
    return {};
  }

  if (!isPlainObject(options)) {
    throw new TypeError("offline batch execution options must be an object");
  }

  return options;
};

const normalizeDispatcher = (value) => {
  if (typeof value !== "function") {
    throw new TypeError("dispatchWorkUnit must be a function");
  }

  return value;
};

const normalizeOptionalResolver = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }

  return value;
};

const cloneValueDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneValueDeep);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneValueDeep(nestedValue),
      ]),
    );
  }

  return value;
};

const normalizeExecutionOutput = (value) => cloneValueDeep(value);

const serializeExecutionError = (error) => {
  if (error instanceof Error) {
    return freezeRecord({
      name: error.name,
      message: error.message,
    });
  }

  if (typeof error === "string") {
    return freezeRecord({
      name: "Error",
      message: error,
    });
  }

  return freezeRecord({
    name: "Error",
    message: "Unknown offline batch execution error",
  });
};

const addSetValue = (index, key, value) => {
  const current = index.get(key) ?? new Set();
  current.add(value);
  index.set(key, current);
};

const createIndexedViolationSetList = (workUnits) =>
  workUnits.map(() => new Set());

const markConflictingAgentScopedKeys = (
  workUnits,
  violationsByIndex,
  selector,
  violation,
) => {
  const keyedAgents = new Map();

  workUnits.forEach((workUnit) => {
    addSetValue(keyedAgents, selector(workUnit), workUnit.agentId);
  });

  workUnits.forEach((workUnit, index) => {
    if ((keyedAgents.get(selector(workUnit))?.size ?? 0) > 1) {
      violationsByIndex[index].add(violation);
    }
  });
};

const createBlockedWorkUnitRecord = (workUnit, violations) =>
  freezeDeep({
    workUnitId: workUnit.workUnitId,
    agentId: workUnit.agentId,
    identityScopeKey: workUnit.identityScopeKey,
    overwriteNamespace: workUnit.overwriteNamespace,
    blockedReason: violations[0] ?? null,
    violations: freezeRecordList(violations),
  });

const canAppendWorkUnitToSlice = (slice, workUnit, limit) => {
  const nextAgentCount = new Set([...slice.agentIds, workUnit.agentId]).size;

  if (
    limit.maxAgentsPerBatch !== null &&
    nextAgentCount > limit.maxAgentsPerBatch
  ) {
    return false;
  }

  const nextWorkUnitCount = slice.workUnits.length + 1;

  if (
    limit.maxWorkUnitsPerBatch !== null &&
    nextWorkUnitCount > limit.maxWorkUnitsPerBatch
  ) {
    return false;
  }

  const nextOverwriteTargetCount =
    slice.overwriteTargetCount + workUnit.overwriteTargetCount;

  if (
    limit.maxOverwriteTargetsPerBatch !== null &&
    nextOverwriteTargetCount > limit.maxOverwriteTargetsPerBatch
  ) {
    return false;
  }

  const nextIdentityScopeCount = new Set([
    ...slice.identityScopeKeys,
    workUnit.identityScopeKey,
  ]).size;

  if (
    limit.maxIdentityScopesPerBatch !== null &&
    nextIdentityScopeCount > limit.maxIdentityScopesPerBatch
  ) {
    return false;
  }

  return true;
};

const appendWorkUnitToSlice = (slice, workUnit) => {
  slice.workUnits.push(workUnit);
  slice.agentIds.add(workUnit.agentId);
  slice.identityScopeKeys.add(workUnit.identityScopeKey);
  slice.overwriteTargetCount += workUnit.overwriteTargetCount;
};

const createEmptySlice = () => ({
  workUnits: [],
  agentIds: new Set(),
  identityScopeKeys: new Set(),
  overwriteTargetCount: 0,
});

const materializeExecutionSlice = (plan, limit, workUnits, sequence) => {
  const batchPlan = createOfflineBatchPlan({
    planId: `${plan.planId}:slice:${sequence + 1}`,
    coordinationSignal: plan.coordinationSignal,
    limit,
    workUnits,
    metadata: {
      sourcePlanId: plan.planId,
    },
  });

  return freezeDeep({
    sliceId: batchPlan.planId,
    sequence,
    batchPlan,
  });
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  if (items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
};

const createScheduleFromPlan = (plan) => {
  const limit = createOfflineBatchLimit(plan.limit);
  const violationsByIndex = createIndexedViolationSetList(plan.workUnits);
  const workUnitIdCounts = plan.workUnits.reduce((counts, workUnit) => {
    counts.set(workUnit.workUnitId, (counts.get(workUnit.workUnitId) ?? 0) + 1);
    return counts;
  }, new Map());

  plan.workUnits.forEach((workUnit, index) => {
    if ((workUnitIdCounts.get(workUnit.workUnitId) ?? 0) > 1) {
      violationsByIndex[index].add("duplicate-work-unit-id");
    }

    if (
      limit.maxOverwriteTargetsPerWorkUnit !== null &&
      workUnit.overwriteTargetCount > limit.maxOverwriteTargetsPerWorkUnit
    ) {
      violationsByIndex[index].add(
        "max-overwrite-targets-per-work-unit-exceeded",
      );
    }
  });

  markConflictingAgentScopedKeys(
    plan.workUnits,
    violationsByIndex,
    (workUnit) => workUnit.identityScopeKey,
    "shared-identity-scope",
  );
  markConflictingAgentScopedKeys(
    plan.workUnits,
    violationsByIndex,
    (workUnit) => workUnit.overwriteNamespace,
    "shared-overwrite-namespace",
  );

  const blockedWorkUnits = [];
  const schedulableWorkUnits = [];

  plan.workUnits.forEach((workUnit, index) => {
    const violations = [...violationsByIndex[index]];

    if (violations.length > 0) {
      blockedWorkUnits.push(createBlockedWorkUnitRecord(workUnit, violations));
      return;
    }

    schedulableWorkUnits.push(workUnit);
  });

  const slices = [];
  let currentSlice = createEmptySlice();

  schedulableWorkUnits.forEach((workUnit) => {
    if (
      currentSlice.workUnits.length > 0 &&
      !canAppendWorkUnitToSlice(currentSlice, workUnit, limit)
    ) {
      slices.push(
        materializeExecutionSlice(
          plan,
          limit,
          currentSlice.workUnits,
          slices.length,
        ),
      );
      currentSlice = createEmptySlice();
    }

    appendWorkUnitToSlice(currentSlice, workUnit);
  });

  if (currentSlice.workUnits.length > 0) {
    slices.push(
      materializeExecutionSlice(
        plan,
        limit,
        currentSlice.workUnits,
        slices.length,
      ),
    );
  }

  return freezeDeep({
    planId: plan.planId,
    coordinationSignal: plan.coordinationSignal,
    executionMode: "offline-external-dispatch",
    executorBinding: "caller-supplied",
    liveWorkingLoopCoupling: "offline-decoupled",
    schedulingStrategy: "ordered-slice-packing",
    limit,
    sourcePlan: plan,
    sourcePlanWithinCapacity: plan.withinCapacity,
    sourcePlanCapacityViolations: freezeRecordList([...plan.capacityViolations]),
    scheduledWorkUnitIds: freezeRecordList(
      schedulableWorkUnits.map((workUnit) => workUnit.workUnitId),
    ),
    scheduledWorkUnitCount: schedulableWorkUnits.length,
    blockedWorkUnits: freezeRecordList(blockedWorkUnits),
    blockedWorkUnitCount: blockedWorkUnits.length,
    slices: freezeRecordList(slices),
    sliceCount: slices.length,
    executable: blockedWorkUnits.length === 0,
    requiresRuntimeAuthorization: true,
    heuristicsAuthorizeExecution: false,
  });
};

export const scheduleOfflineBatchExecution = (planInput) =>
  createScheduleFromPlan(createOfflineBatchPlan(planInput));

const createExecutionRecord = ({
  workUnit,
  slice,
  authorizationMode,
  authorization,
  status,
  output,
  error,
}) =>
  freezeRecord({
    workUnitId: workUnit.workUnitId,
    agentId: workUnit.agentId,
    sliceId: slice.sliceId,
    sliceSequence: slice.sequence,
    status,
    authorizationMode,
    runtimePhase: authorization.runtimePhase?.value ?? null,
    authorization,
    blockedReason: status === "blocked" ? authorization.blockedReason : null,
    output: output === undefined ? null : normalizeExecutionOutput(output),
    error,
  });

const resolveMaxConcurrentWorkUnits = (optionsValue, slice) =>
  normalizePositiveInteger(
    optionsValue ?? slice.batchPlan.workUnitCount,
    "maxConcurrentWorkUnits",
  ) ?? slice.batchPlan.workUnitCount;

export const executeOfflineBatchPlan = async (planInput, options = {}) => {
  const normalizedOptions = normalizeExecutionOptions(options);
  const schedule = scheduleOfflineBatchExecution(planInput);

  if (!schedule.executable) {
    return freezeDeep({
      planId: schedule.planId,
      status: "blocked-by-schedule",
      authorizationMode: "plan-runtime-phase",
      schedule,
      results: freezeRecordList([]),
      dispatchedCount: 0,
      executedCount: 0,
      blockedCount: 0,
      failedCount: 0,
    });
  }

  const dispatchWorkUnit = normalizeDispatcher(normalizedOptions.dispatchWorkUnit);
  const resolveRuntimePhase = normalizeOptionalResolver(
    normalizedOptions.resolveRuntimePhase,
    "resolveRuntimePhase",
  );
  const resolveInactivitySuggestion = normalizeOptionalResolver(
    normalizedOptions.resolveInactivitySuggestion,
    "resolveInactivitySuggestion",
  );
  const authorizationMode =
    resolveRuntimePhase === null
      ? "plan-runtime-phase"
      : "execution-runtime-phase";
  const teamIdle = schedule.coordinationSignal === "team-idle";
  const executionResults = [];

  for (const slice of schedule.slices) {
    const maxConcurrentWorkUnits = resolveMaxConcurrentWorkUnits(
      normalizedOptions.maxConcurrentWorkUnits,
      slice,
    );
    const sliceResults = await mapWithConcurrency(
      slice.batchPlan.workUnits,
      maxConcurrentWorkUnits,
      async (workUnit) => {
        const executionContext = freezeDeep({
          planId: schedule.planId,
          coordinationSignal: schedule.coordinationSignal,
          schedulingStrategy: schedule.schedulingStrategy,
          sliceId: slice.sliceId,
          sliceSequence: slice.sequence,
          slicePlan: slice.batchPlan,
          limit: schedule.limit,
          authorizationMode,
        });
        const runtimePhase =
          resolveRuntimePhase === null
            ? workUnit.runtimePhase
            : await resolveRuntimePhase({
                workUnit,
                slice,
                schedule,
                executionContext,
              });
        const inactivitySuggestion =
          resolveInactivitySuggestion === null
            ? null
            : await resolveInactivitySuggestion({
                workUnit,
                slice,
                schedule,
                executionContext,
              });
        const authorization = evaluateIdleWindowAuthorization({
          agentId: workUnit.agentId,
          runtimePhase,
          inactivitySuggestion,
          teamIdle,
        });

        if (!authorization.eligible) {
          return createExecutionRecord({
            workUnit,
            slice,
            authorizationMode,
            authorization,
            status: "blocked",
            output: null,
            error: null,
          });
        }

        try {
          const output = await dispatchWorkUnit(workUnit, {
            ...executionContext,
            runtimePhase: authorization.runtimePhase,
            authorization,
          });

          return createExecutionRecord({
            workUnit,
            slice,
            authorizationMode,
            authorization,
            status: "executed",
            output,
            error: null,
          });
        } catch (error) {
          return createExecutionRecord({
            workUnit,
            slice,
            authorizationMode,
            authorization,
            status: "failed",
            output: null,
            error: serializeExecutionError(error),
          });
        }
      },
    );

    executionResults.push(...sliceResults);
  }

  const executedCount = executionResults.filter(
    (result) => result.status === "executed",
  ).length;
  const blockedCount = executionResults.filter(
    (result) => result.status === "blocked",
  ).length;
  const failedCount = executionResults.filter(
    (result) => result.status === "failed",
  ).length;

  return freezeDeep({
    planId: schedule.planId,
    status:
      failedCount > 0
        ? "completed-with-errors"
        : blockedCount > 0
          ? "completed-with-blocked-work-units"
          : "completed",
    authorizationMode,
    schedule,
    results: freezeRecordList(executionResults),
    dispatchedCount: executedCount + failedCount,
    executedCount,
    blockedCount,
    failedCount,
  });
};
