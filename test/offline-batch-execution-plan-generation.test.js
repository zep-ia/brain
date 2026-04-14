import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  buildOfflineConsolidationBatchPlan,
  createRuntimePhase,
  scheduleOfflineBatchExecution,
} from "../src/index.js";
import {
  normalizeBatchPlanExpression,
  parseBatchPlanExpression,
} from "../src/batch-plan-expression.js";

const collectComparisonEntries = (node, entries = []) => {
  switch (node.type) {
    case "and":
      collectComparisonEntries(node.left, entries);
      collectComparisonEntries(node.right, entries);
      return entries;
    case "comparison":
      entries.push([node.field, node.value]);
      return entries;
    default:
      throw new TypeError(
        `Execution-plan test expressions must normalize to comparison conjunctions only; found ${node.type}`,
      );
  }
};

const createExecutionScheduleFromExpression = ({
  expression,
  requestId,
  planId,
  agentId,
  batchLimit,
}) => {
  const normalizedExpression = normalizeBatchPlanExpression(expression);
  const comparisons = Object.fromEntries(
    collectComparisonEntries(parseBatchPlanExpression(normalizedExpression)),
  );
  const presetId = comparisons.presetId ?? null;
  const runtimePhase = comparisons.runtimePhase ?? null;
  const coordinationSignal = comparisons.coordinationSignal ?? "independent";

  if (!presetId || !runtimePhase) {
    throw new TypeError(
      "Execution-plan test expressions must include presetId and runtimePhase comparisons",
    );
  }

  const plan = buildOfflineConsolidationBatchPlan({
    requestId,
    planId,
    agentId,
    presetId,
    runtimePhase: createRuntimePhase(runtimePhase),
    teamIdle: coordinationSignal === "team-idle",
    batchLimit,
  });

  return {
    normalizedExpression,
    schedule: scheduleOfflineBatchExecution(plan),
  };
};

const summarizeExecutionPlan = (schedule) => ({
  planId: schedule.planId,
  schedulingStrategy: schedule.schedulingStrategy,
  coordinationSignal: schedule.coordinationSignal,
  sourcePlanWithinCapacity: schedule.sourcePlanWithinCapacity,
  sourcePlanCapacityViolations: schedule.sourcePlanCapacityViolations,
  sourcePlanStageIds: schedule.sourcePlan.metadata?.stageIds ?? [],
  scheduledWorkUnitIds: schedule.scheduledWorkUnitIds,
  sliceCount: schedule.sliceCount,
  executionSteps: schedule.slices.map((slice) => ({
    sliceId: slice.sliceId,
    sourcePlanId: slice.batchPlan.metadata?.sourcePlanId ?? null,
    orderedWorkUnitIds: slice.batchPlan.orderedWorkUnitIds,
    stageIds: slice.batchPlan.workUnits.map(
      (workUnit) => workUnit.metadata?.stageId ?? null,
    ),
    runtimePhases: slice.batchPlan.workUnits.map(
      (workUnit) => workUnit.runtimePhase,
    ),
    withinCapacity: slice.batchPlan.withinCapacity,
  })),
});

const TIGHT_EXECUTION_BATCH_LIMIT = {
  ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  maxAgentsPerBatch: 1,
  maxWorkUnitsPerBatch: 2,
  maxOverwriteTargetsPerBatch: 4,
  maxOverwriteTargetsPerWorkUnit: 3,
  maxIdentityScopesPerBatch: 1,
};

test("execution-plan generation turns equivalent idle-window batch-plan expressions into the same canonical schedule", () => {
  const planId = "expression-idle-balanced-plan";
  const expressions = [
    "runtimePhase:rest && presetId:idle-balanced-consolidation && coordinationSignal:independent",
    "(coordinationSignal:independent && presetId:idle-balanced-consolidation) && runtimePhase:rest",
  ];
  const expectedNormalizedExpression =
    "coordinationSignal:independent && presetId:idle-balanced-consolidation && runtimePhase:rest";
  const expectedPlanSummary = {
    planId,
    schedulingStrategy: "ordered-slice-packing",
    coordinationSignal: "independent",
    sourcePlanWithinCapacity: false,
    sourcePlanCapacityViolations: [
      "max-work-units-per-batch-exceeded",
      "max-overwrite-targets-per-batch-exceeded",
    ],
    sourcePlanStageIds: [
      "young-generation-triage",
      "young-generation-promotion",
      "old-generation-reinforcement",
    ],
    scheduledWorkUnitIds: [
      `${planId}/young-generation-triage`,
      `${planId}/young-generation-promotion`,
      `${planId}/old-generation-reinforcement`,
    ],
    sliceCount: 2,
    executionSteps: [
      {
        sliceId: `${planId}:slice:1`,
        sourcePlanId: planId,
        orderedWorkUnitIds: [`${planId}/young-generation-triage`],
        stageIds: ["young-generation-triage"],
        runtimePhases: ["rest"],
        withinCapacity: true,
      },
      {
        sliceId: `${planId}:slice:2`,
        sourcePlanId: planId,
        orderedWorkUnitIds: [
          `${planId}/young-generation-promotion`,
          `${planId}/old-generation-reinforcement`,
        ],
        stageIds: [
          "young-generation-promotion",
          "old-generation-reinforcement",
        ],
        runtimePhases: ["rest", "rest"],
        withinCapacity: true,
      },
    ],
  };

  expressions.forEach((expression, index) => {
    const { normalizedExpression, schedule } = createExecutionScheduleFromExpression({
      expression,
      requestId: `idle-expression-request-${index + 1}`,
      planId,
      agentId: "agent-expression-idle",
      batchLimit: TIGHT_EXECUTION_BATCH_LIMIT,
    });

    assert.equal(normalizedExpression, expectedNormalizedExpression);
    assert.deepEqual(summarizeExecutionPlan(schedule), expectedPlanSummary);
  });
});

test("execution-plan generation preserves team-idle sleep maintenance structure for normalized expressions", () => {
  const planId = "expression-sleep-maintenance-plan";
  const expressions = [
    "runtimePhase:sleep && presetId:sleep-extended-maintenance && coordinationSignal:team-idle",
    "coordinationSignal:team-idle && (presetId:sleep-extended-maintenance && runtimePhase:sleep)",
  ];
  const expectedNormalizedExpression =
    "coordinationSignal:team-idle && presetId:sleep-extended-maintenance && runtimePhase:sleep";
  const expectedPlanSummary = {
    planId,
    schedulingStrategy: "ordered-slice-packing",
    coordinationSignal: "team-idle",
    sourcePlanWithinCapacity: false,
    sourcePlanCapacityViolations: [
      "max-work-units-per-batch-exceeded",
      "max-overwrite-targets-per-batch-exceeded",
    ],
    sourcePlanStageIds: [
      "young-generation-triage",
      "young-generation-promotion",
      "old-generation-reinforcement",
      "archived-memory-review",
    ],
    scheduledWorkUnitIds: [
      `${planId}/young-generation-triage`,
      `${planId}/young-generation-promotion`,
      `${planId}/old-generation-reinforcement`,
      `${planId}/archived-memory-review`,
    ],
    sliceCount: 3,
    executionSteps: [
      {
        sliceId: `${planId}:slice:1`,
        sourcePlanId: planId,
        orderedWorkUnitIds: [`${planId}/young-generation-triage`],
        stageIds: ["young-generation-triage"],
        runtimePhases: ["sleep"],
        withinCapacity: true,
      },
      {
        sliceId: `${planId}:slice:2`,
        sourcePlanId: planId,
        orderedWorkUnitIds: [
          `${planId}/young-generation-promotion`,
          `${planId}/old-generation-reinforcement`,
        ],
        stageIds: [
          "young-generation-promotion",
          "old-generation-reinforcement",
        ],
        runtimePhases: ["sleep", "sleep"],
        withinCapacity: true,
      },
      {
        sliceId: `${planId}:slice:3`,
        sourcePlanId: planId,
        orderedWorkUnitIds: [`${planId}/archived-memory-review`],
        stageIds: ["archived-memory-review"],
        runtimePhases: ["sleep"],
        withinCapacity: true,
      },
    ],
  };

  expressions.forEach((expression, index) => {
    const { normalizedExpression, schedule } = createExecutionScheduleFromExpression({
      expression,
      requestId: `sleep-expression-request-${index + 1}`,
      planId,
      agentId: "agent-expression-sleep",
      batchLimit: TIGHT_EXECUTION_BATCH_LIMIT,
    });

    assert.equal(normalizedExpression, expectedNormalizedExpression);
    assert.deepEqual(summarizeExecutionPlan(schedule), expectedPlanSummary);
  });
});
