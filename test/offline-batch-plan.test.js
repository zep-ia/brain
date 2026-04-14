import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  createOfflineBatchLimit,
  createOfflineBatchPlan,
  createOfflineBatchWorkUnit,
} from "../src/index.js";

test("offline batch plan orders work units and aggregates capacity against reusable limits", () => {
  const limit = createOfflineBatchLimit({
    ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
    maxAgentsPerBatch: 2,
    maxWorkUnitsPerBatch: 2,
    maxOverwriteTargetsPerBatch: 3,
    maxOverwriteTargetsPerWorkUnit: 2,
    maxIdentityScopesPerBatch: 2,
  });
  const plan = createOfflineBatchPlan({
    planId: "offline-batch-1",
    coordinationSignal: "team-idle",
    limit,
    workUnits: [
      createOfflineBatchWorkUnit({
        workUnitId: "wu-bravo",
        agentId: "agent-bravo",
        priority: 1,
        sequence: 1,
        overwriteTargets: ["long-term-memory:ltm-2"],
        runtimePhase: "sleep",
      }),
      {
        workUnitId: "wu-alpha",
        agentId: "agent-alpha",
        priority: 5,
        sequence: 0,
        overwriteTargets: [
          "long-term-memory:ltm-1",
          "archived-memory:archive-1",
        ],
        runtimePhase: "idle",
      },
    ],
  });

  assert.equal(plan.limit.targetProfile, "b200-style");
  assert.deepEqual(plan.orderedWorkUnitIds, ["wu-alpha", "wu-bravo"]);
  assert.deepEqual(plan.agentIds, ["agent-alpha", "agent-bravo"]);
  assert.deepEqual(plan.workUnits.map((workUnit) => workUnit.runtimePhase), [
    "idle",
    "sleep",
  ]);
  assert.deepEqual(plan.workUnits.map((workUnit) => workUnit.order.priority), [5, 1]);
  assert.deepEqual(plan.capacityUsage, {
    agentCount: 2,
    workUnitCount: 2,
    overwriteTargetCount: 3,
    identityScopeCount: 2,
    maxOverwriteTargetsPerWorkUnitObserved: 2,
  });
  assert.equal(plan.withinCapacity, true);
  assert.deepEqual(plan.capacityViolations, []);
});

test("offline batch plan stays data-only and reports capacity violations without embedding executor logic", () => {
  assert.throws(
    () =>
      createOfflineBatchWorkUnit({
        workUnitId: "wu-inline",
        agentId: "agent-inline",
        execute() {
          return "not-allowed";
        },
      }),
    /must not embed executor logic/,
  );

  const plan = createOfflineBatchPlan({
    planId: "offline-batch-violations",
    limit: createOfflineBatchLimit({
      limitId: "tight-limit",
      targetProfile: "b200-style",
      acceleratorClass: "b200-style",
      maxAgentsPerBatch: 1,
      maxWorkUnitsPerBatch: 1,
      maxOverwriteTargetsPerBatch: 1,
      maxOverwriteTargetsPerWorkUnit: 1,
      maxIdentityScopesPerBatch: 1,
    }),
    workUnits: [
      {
        workUnitId: "wu-a",
        agentId: "agent-a",
        overwriteTargets: ["long-term-memory:ltm-1", "long-term-memory:ltm-2"],
      },
      {
        workUnitId: "wu-b",
        agentId: "agent-b",
        overwriteTargets: ["long-term-memory:ltm-3"],
      },
    ],
  });

  assert.equal(plan.withinCapacity, false);
  assert.deepEqual(plan.capacityViolations, [
    "max-agents-per-batch-exceeded",
    "max-work-units-per-batch-exceeded",
    "max-overwrite-targets-per-batch-exceeded",
    "max-overwrite-targets-per-work-unit-exceeded",
    "max-identity-scopes-per-batch-exceeded",
  ]);
});
