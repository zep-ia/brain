import {
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  executeOfflineBatchPlan,
  planTeamIdleConsolidationBatch,
  requestOfflineConsolidationBatchPlan,
  scheduleOfflineBatchExecution,
} from "../src/index.js";
import {
  createB200OfflineTestBatchLimit,
  createOfflineFlowAgentFixture,
} from "./offline-flow-fixtures.js";

const RUNTIME_WINDOW_TO_PRESET_ID = Object.freeze({
  idle: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  sleep: "sleep-extended-maintenance",
});

const resolveWindowFixture = (agentFixture, runtimeWindow) => {
  const windowKey = runtimeWindow ?? "idle";
  const windowFixture =
    typeof windowKey === "string"
      ? agentFixture.runtime.windows[windowKey]
      : windowKey;

  if (!windowFixture) {
    throw new TypeError(`unsupported runtime window fixture: ${String(windowKey)}`);
  }

  return windowFixture;
};

const createDefaultExecutionOutput = (workUnit) => ({
  handledWorkUnitId: workUnit.workUnitId,
  stageId: workUnit.metadata?.stageId ?? null,
  runtimePhase: workUnit.runtimePhase,
});

export const createOfflineFlowHarness = (options = {}) => {
  const agentFixture =
    options.agentFixture ?? createOfflineFlowAgentFixture(options);
  const defaultBatchLimit =
    options.batchLimit ?? createB200OfflineTestBatchLimit();

  const createPlanOptions = (planOptions = {}) => {
    const windowFixture = resolveWindowFixture(
      agentFixture,
      planOptions.runtimeWindow,
    );
    const runtimeWindow =
      typeof planOptions.runtimeWindow === "string"
        ? planOptions.runtimeWindow
        : windowFixture.name ?? "idle";
    const presetId =
      planOptions.presetId ??
      RUNTIME_WINDOW_TO_PRESET_ID[runtimeWindow] ??
      DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID;

    return {
      requestId:
        planOptions.requestId ??
        `offline-flow-${agentFixture.identity.agentId}-${runtimeWindow}`,
      agentId: planOptions.agentId ?? agentFixture.identity.agentId,
      presetId,
      runtimePhase: planOptions.runtimePhase ?? windowFixture.runtimePhase,
      inactivitySuggestion:
        planOptions.inactivitySuggestion ?? windowFixture.inactivitySuggestion,
      teamIdle: Boolean(planOptions.teamIdle),
      priorityMemoryIds:
        planOptions.priorityMemoryIds ?? agentFixture.priorityMemoryIds,
      batchLimit: planOptions.batchLimit ?? defaultBatchLimit,
      planId:
        planOptions.planId ??
        `offline-flow-plan-${agentFixture.identity.agentId}-${runtimeWindow}`,
    };
  };

  const createTeamAgent = (teamOptions = {}) => {
    const teammateFixture = createOfflineFlowAgentFixture({
      identity: {
        ...(teamOptions.identity ?? {}),
        agentId:
          teamOptions.agentId ??
          teamOptions.identity?.agentId ??
          agentFixture.identity.agentId,
      },
    });
    const windowFixture = resolveWindowFixture(
      teammateFixture,
      teamOptions.runtimeWindow,
    );

    return {
      fixture: teammateFixture,
      agent: {
        agentId: teammateFixture.identity.agentId,
        runtimePhase: teamOptions.runtimePhase ?? windowFixture.runtimePhase,
        inactivitySuggestion:
          teamOptions.inactivitySuggestion ?? windowFixture.inactivitySuggestion,
        identityScope: teamOptions.identityScope ?? {
          agentId: teammateFixture.identity.agentId,
          persona: teammateFixture.identity.persona,
          role: teammateFixture.identity.role,
        },
        overwriteTargets: teamOptions.overwriteTargets ?? [
          {
            scope: "long-term-memory",
            targetId: teammateFixture.ids.currentLongTermMemoryId,
            agentId: teammateFixture.identity.agentId,
          },
          {
            scope: "archived-memory",
            targetId: teammateFixture.ids.archivedMemoryId,
            agentId: teammateFixture.identity.agentId,
          },
        ],
      },
    };
  };

  const requestPlan = (planOptions = {}) =>
    requestOfflineConsolidationBatchPlan(createPlanOptions(planOptions));

  const planTeamIdleBatch = (teamOptions = {}) => {
    const resolvedAgents =
      teamOptions.agents ??
      [
        createTeamAgent({ runtimeWindow: "idle" }),
        createTeamAgent({
          agentId: `${agentFixture.identity.agentId}-sleep`,
          runtimeWindow: "sleep",
          identity: {
            persona: "sleep-maintainer",
            role: "archivist",
          },
        }),
      ];

    return {
      fixtures: resolvedAgents.map((entry) => entry.fixture),
      plan: planTeamIdleConsolidationBatch({
        teamIdle: teamOptions.teamIdle ?? true,
        batchLimit: teamOptions.batchLimit ?? defaultBatchLimit,
        agents: resolvedAgents.map((entry) => entry.agent),
      }),
    };
  };

  const simulateWindow = async (runtimeWindow, simulationOptions = {}) => {
    const planOptions = {
      ...simulationOptions,
      runtimeWindow,
    };
    const requestResult = requestPlan(planOptions);

    if (requestResult.status !== "validated") {
      return {
        fixture: agentFixture,
        window: resolveWindowFixture(agentFixture, runtimeWindow),
        requestResult,
        plan: null,
        schedule: null,
        execution: null,
      };
    }

    const { plan } = requestResult;
    const schedule = scheduleOfflineBatchExecution(plan);
    const execution = await executeOfflineBatchPlan(plan, {
      dispatchWorkUnit:
        simulationOptions.dispatchWorkUnit ??
        (async (workUnit) => createDefaultExecutionOutput(workUnit)),
      resolveRuntimePhase: simulationOptions.resolveRuntimePhase,
      resolveInactivitySuggestion: simulationOptions.resolveInactivitySuggestion,
      maxConcurrentWorkUnits: simulationOptions.maxConcurrentWorkUnits,
    });

    return {
      fixture: agentFixture,
      window: resolveWindowFixture(agentFixture, runtimeWindow),
      requestResult,
      plan,
      schedule,
      execution,
    };
  };

  return {
    agentFixture,
    defaultBatchLimit,
    createPlanOptions,
    createTeamAgent,
    requestPlan,
    planTeamIdleBatch,
    simulateWindow,
  };
};
