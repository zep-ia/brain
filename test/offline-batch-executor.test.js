import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOfflineConsolidationBatchPlan,
  createRuntimePhase,
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
  executeOfflineBatchPlan,
  scheduleOfflineBatchExecution,
} from "../src/index.js";

test("offline batch executor slices over-capacity plans into limit-safe runtime batches", async () => {
  const limit = createOfflineBatchLimit({
    limitId: "executor-slice-limit",
    maxAgentsPerBatch: 2,
    maxWorkUnitsPerBatch: 2,
    maxOverwriteTargetsPerBatch: 2,
    maxOverwriteTargetsPerWorkUnit: 1,
    maxIdentityScopesPerBatch: 2,
  });
  const plan = createOfflineBatchPlan({
    planId: "executor-slice-plan",
    limit,
    workUnits: [
      {
        workUnitId: "wu-1",
        agentId: "agent-1",
        overwriteTargets: ["long-term-memory:ltm-1"],
        runtimePhase: "idle",
      },
      {
        workUnitId: "wu-2",
        agentId: "agent-2",
        overwriteTargets: ["long-term-memory:ltm-2"],
        runtimePhase: "sleep",
      },
      {
        workUnitId: "wu-3",
        agentId: "agent-3",
        overwriteTargets: ["long-term-memory:ltm-3"],
        runtimePhase: "idle",
      },
    ],
  });

  assert.equal(plan.withinCapacity, false);

  const schedule = scheduleOfflineBatchExecution(plan);

  assert.equal(schedule.executable, true);
  assert.equal(schedule.sourcePlanWithinCapacity, false);
  assert.equal(schedule.sliceCount, 2);
  assert.deepEqual(
    schedule.slices.map((slice) => slice.batchPlan.orderedWorkUnitIds),
    [["wu-1", "wu-2"], ["wu-3"]],
  );
  schedule.slices.forEach((slice) => {
    assert.equal(slice.batchPlan.withinCapacity, true);
  });

  let activeDispatches = 0;
  let maxConcurrentDispatches = 0;
  const result = await executeOfflineBatchPlan(plan, {
    async dispatchWorkUnit(workUnit) {
      activeDispatches += 1;
      maxConcurrentDispatches = Math.max(
        maxConcurrentDispatches,
        activeDispatches,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeDispatches -= 1;
      return {
        handledWorkUnitId: workUnit.workUnitId,
      };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.executedCount, 3);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(result.schedule.sliceCount, 2);
  assert.equal(maxConcurrentDispatches, 2);
  assert.deepEqual(
    result.results.map((entry) => entry.output),
    [
      { handledWorkUnitId: "wu-1" },
      { handledWorkUnitId: "wu-2" },
      { handledWorkUnitId: "wu-3" },
    ],
  );
});

test("offline batch executor groups eligible-memory work into ordered slices with stable capacity metadata", () => {
  const limit = createOfflineBatchLimit({
    limitId: "eligible-memory-grouping-limit",
    maxAgentsPerBatch: 2,
    maxWorkUnitsPerBatch: 2,
    maxOverwriteTargetsPerBatch: 3,
    maxOverwriteTargetsPerWorkUnit: 2,
    maxIdentityScopesPerBatch: 2,
  });
  const plan = createOfflineBatchPlan({
    planId: "eligible-memory-grouping-plan",
    coordinationSignal: "team-idle",
    limit,
    workUnits: [
      {
        workUnitId: "memory-charlie",
        agentId: "agent-charlie",
        priority: 1,
        sequence: 2,
        overwriteTargets: ["long-term-memory:ltm-charlie"],
        runtimePhase: "sleep",
        metadata: {
          eligibleMemoryIds: ["stm-charlie"],
        },
      },
      {
        workUnitId: "memory-alpha",
        agentId: "agent-alpha",
        priority: 5,
        sequence: 0,
        overwriteTargets: [
          "long-term-memory:ltm-alpha",
          "consolidation-journal:ltm-alpha",
        ],
        runtimePhase: "idle",
        metadata: {
          eligibleMemoryIds: ["wm-alpha", "stm-alpha"],
        },
      },
      {
        workUnitId: "memory-bravo",
        agentId: "agent-bravo",
        priority: 4,
        sequence: 1,
        overwriteTargets: ["archived-memory:archive-bravo"],
        runtimePhase: "idle",
        metadata: {
          eligibleMemoryIds: ["wm-bravo"],
        },
      },
    ],
  });
  const schedule = scheduleOfflineBatchExecution(plan);

  assert.equal(schedule.executable, true);
  assert.equal(schedule.sourcePlanWithinCapacity, false);
  assert.equal(schedule.sliceCount, 2);
  assert.deepEqual(schedule.scheduledWorkUnitIds, [
    "memory-alpha",
    "memory-bravo",
    "memory-charlie",
  ]);
  assert.deepEqual(
    schedule.slices.map((slice) => ({
      orderedWorkUnitIds: slice.batchPlan.orderedWorkUnitIds,
      agentIds: slice.batchPlan.agentIds,
      capacityUsage: slice.batchPlan.capacityUsage,
      eligibleMemoryIds: slice.batchPlan.workUnits.map(
        (workUnit) => workUnit.metadata?.eligibleMemoryIds,
      ),
    })),
    [
      {
        orderedWorkUnitIds: ["memory-alpha", "memory-bravo"],
        agentIds: ["agent-alpha", "agent-bravo"],
        capacityUsage: {
          agentCount: 2,
          workUnitCount: 2,
          overwriteTargetCount: 3,
          identityScopeCount: 2,
          maxOverwriteTargetsPerWorkUnitObserved: 2,
        },
        eligibleMemoryIds: [["wm-alpha", "stm-alpha"], ["wm-bravo"]],
      },
      {
        orderedWorkUnitIds: ["memory-charlie"],
        agentIds: ["agent-charlie"],
        capacityUsage: {
          agentCount: 1,
          workUnitCount: 1,
          overwriteTargetCount: 1,
          identityScopeCount: 1,
          maxOverwriteTargetsPerWorkUnitObserved: 1,
        },
        eligibleMemoryIds: [["stm-charlie"]],
      },
    ],
  );
  schedule.slices.forEach((slice) => {
    assert.equal(slice.batchPlan.metadata?.sourcePlanId, plan.planId);
    assert.equal(slice.batchPlan.withinCapacity, true);
    assert.deepEqual(slice.batchPlan.capacityViolations, []);
  });
});

test("offline batch executor rechecks runtime authorization at execution time", async () => {
  const plan = createOfflineBatchPlan({
    planId: "executor-runtime-phase-plan",
    workUnits: [
      {
        workUnitId: "wu-alpha",
        agentId: "agent-alpha",
        runtimePhase: "idle",
      },
      {
        workUnitId: "wu-bravo",
        agentId: "agent-bravo",
        runtimePhase: "sleep",
      },
    ],
  });
  const dispatchedWorkUnitIds = [];

  const result = await executeOfflineBatchPlan(plan, {
    resolveRuntimePhase({ workUnit }) {
      return workUnit.workUnitId === "wu-bravo" ? "active" : "sleep";
    },
    async dispatchWorkUnit(workUnit) {
      dispatchedWorkUnitIds.push(workUnit.workUnitId);
      return {
        handledBy: "test-dispatcher",
      };
    },
  });

  assert.equal(result.authorizationMode, "execution-runtime-phase");
  assert.equal(result.status, "completed-with-blocked-work-units");
  assert.equal(result.executedCount, 1);
  assert.equal(result.blockedCount, 1);
  assert.deepEqual(dispatchedWorkUnitIds, ["wu-alpha"]);

  const blockedResult = result.results.find(
    (entry) => entry.workUnitId === "wu-bravo",
  );

  assert.ok(blockedResult);
  assert.equal(blockedResult.status, "blocked");
  assert.equal(blockedResult.runtimePhase, "active");
  assert.equal(blockedResult.blockedReason, "runtime-phase-not-idle-window");
  assert.equal(blockedResult.output, null);
});

test("offline batch executor materializes deferred consolidation slices when authorized work cannot fit the immediate batch", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "deferred-consolidation-request",
    agentId: "agent-deferred",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    priorityMemoryIds: ["wm-9", "stm-2"],
    planId: "deferred-consolidation-plan",
    batchLimit: {
      ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
      maxAgentsPerBatch: 1,
      maxWorkUnitsPerBatch: 2,
      maxOverwriteTargetsPerBatch: 4,
      maxOverwriteTargetsPerWorkUnit: 3,
      maxIdentityScopesPerBatch: 1,
    },
  });

  const schedule = scheduleOfflineBatchExecution(plan);

  assert.equal(plan.withinCapacity, false);
  assert.deepEqual(plan.capacityViolations, [
    "max-work-units-per-batch-exceeded",
    "max-overwrite-targets-per-batch-exceeded",
  ]);
  assert.equal(schedule.executable, true);
  assert.equal(schedule.blockedWorkUnitCount, 0);
  assert.equal(schedule.sourcePlanWithinCapacity, false);
  assert.deepEqual(schedule.sourcePlanCapacityViolations, [
    "max-work-units-per-batch-exceeded",
    "max-overwrite-targets-per-batch-exceeded",
  ]);
  assert.deepEqual(schedule.scheduledWorkUnitIds, plan.orderedWorkUnitIds);
  assert.equal(schedule.sliceCount, 3);

  const [immediateSlice, deferredSlice, deferredTailSlice] = schedule.slices;

  assert.deepEqual(immediateSlice.batchPlan.orderedWorkUnitIds, [
    "deferred-consolidation-plan/young-generation-triage",
  ]);
  assert.equal(immediateSlice.batchPlan.metadata?.sourcePlanId, plan.planId);
  assert.equal(immediateSlice.batchPlan.withinCapacity, true);
  assert.deepEqual(immediateSlice.batchPlan.capacityUsage, {
    agentCount: 1,
    workUnitCount: 1,
    overwriteTargetCount: 3,
    identityScopeCount: 1,
    maxOverwriteTargetsPerWorkUnitObserved: 3,
  });

  assert.deepEqual(deferredSlice.batchPlan.orderedWorkUnitIds, [
    "deferred-consolidation-plan/young-generation-promotion",
    "deferred-consolidation-plan/old-generation-reinforcement",
  ]);
  assert.equal(deferredSlice.batchPlan.metadata?.sourcePlanId, plan.planId);
  assert.equal(deferredSlice.batchPlan.withinCapacity, true);
  assert.deepEqual(deferredSlice.batchPlan.capacityUsage, {
    agentCount: 1,
    workUnitCount: 2,
    overwriteTargetCount: 4,
    identityScopeCount: 1,
    maxOverwriteTargetsPerWorkUnitObserved: 2,
  });
  assert.deepEqual(
    deferredSlice.batchPlan.workUnits.map((workUnit) => ({
      workUnitId: workUnit.workUnitId,
      stageId: workUnit.metadata?.stageId,
      priorityMemoryIds: workUnit.metadata?.priorityMemoryIds,
      runtimePhase: workUnit.runtimePhase,
    })),
    [
      {
        workUnitId: "deferred-consolidation-plan/young-generation-promotion",
        stageId: "young-generation-promotion",
        priorityMemoryIds: ["wm-9", "stm-2"],
        runtimePhase: "sleep",
      },
      {
        workUnitId: "deferred-consolidation-plan/old-generation-reinforcement",
        stageId: "old-generation-reinforcement",
        priorityMemoryIds: ["wm-9", "stm-2"],
        runtimePhase: "sleep",
      },
    ],
  );

  assert.deepEqual(deferredTailSlice.batchPlan.orderedWorkUnitIds, [
    "deferred-consolidation-plan/archived-memory-review",
  ]);
  assert.equal(deferredTailSlice.batchPlan.metadata?.sourcePlanId, plan.planId);
  assert.equal(deferredTailSlice.batchPlan.withinCapacity, true);
  assert.deepEqual(deferredTailSlice.batchPlan.capacityUsage, {
    agentCount: 1,
    workUnitCount: 1,
    overwriteTargetCount: 3,
    identityScopeCount: 1,
    maxOverwriteTargetsPerWorkUnitObserved: 3,
  });
  assert.deepEqual(
    deferredTailSlice.batchPlan.workUnits.map((workUnit) => workUnit.metadata?.stageId),
    ["archived-memory-review"],
  );
});

test("offline batch executor blocks unsafe plans before dispatch", async () => {
  const limit = createOfflineBatchLimit({
    limitId: "executor-safety-limit",
    maxOverwriteTargetsPerWorkUnit: 1,
  });
  const plan = createOfflineBatchPlan({
    planId: "executor-unsafe-plan",
    limit,
    workUnits: [
      {
        workUnitId: "wu-shared-alpha",
        agentId: "agent-alpha",
        identityScopeKey: "agent:shared",
        overwriteNamespace: "agent:shared",
        runtimePhase: "idle",
      },
      {
        workUnitId: "wu-shared-bravo",
        agentId: "agent-bravo",
        identityScopeKey: "agent:shared",
        overwriteNamespace: "agent:shared",
        runtimePhase: "sleep",
      },
      {
        workUnitId: "wu-overwrite-heavy",
        agentId: "agent-charlie",
        overwriteTargets: [
          "long-term-memory:ltm-1",
          "long-term-memory:ltm-2",
        ],
        runtimePhase: "idle",
      },
    ],
  });
  const schedule = scheduleOfflineBatchExecution(plan);

  assert.equal(schedule.executable, false);
  assert.equal(schedule.blockedWorkUnitCount, 3);
  assert.deepEqual(
    schedule.blockedWorkUnits.map((workUnit) => ({
      workUnitId: workUnit.workUnitId,
      violations: [...workUnit.violations],
    })),
    [
      {
        workUnitId: "wu-shared-alpha",
        violations: [
          "shared-identity-scope",
          "shared-overwrite-namespace",
        ],
      },
      {
        workUnitId: "wu-shared-bravo",
        violations: [
          "shared-identity-scope",
          "shared-overwrite-namespace",
        ],
      },
      {
        workUnitId: "wu-overwrite-heavy",
        violations: ["max-overwrite-targets-per-work-unit-exceeded"],
      },
    ],
  );

  let dispatchCount = 0;
  const result = await executeOfflineBatchPlan(plan, {
    async dispatchWorkUnit() {
      dispatchCount += 1;
    },
  });

  assert.equal(result.status, "blocked-by-schedule");
  assert.equal(result.executedCount, 0);
  assert.equal(result.dispatchedCount, 0);
  assert.equal(dispatchCount, 0);
  assert.deepEqual(result.results, []);
});
