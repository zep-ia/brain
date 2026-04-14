import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  buildOfflineConsolidationBatchPlan,
  createRuntimePhase,
  requestOfflineConsolidationBatchPlan,
  validateOfflineConsolidationBatchPlan,
} from "../src/index.js";

test("offline consolidation gate rejects invalid requests before plan generation", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "focused-invalid-request",
    agentId: "agent-focused-invalid-request",
    executionMode: "inline",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.safeToExecute, false);
  assert.equal(result.request, null);
  assert.equal(result.plan, null);
  assert.deepEqual(result.rejection, {
    stage: "request-validation",
    reasonCode: "invalid-request",
    blockedReason: null,
    message:
      'offline consolidation plan-builder request contains unsupported field "executionMode"',
    requestId: "focused-invalid-request",
    agentId: "agent-focused-invalid-request",
    planId: null,
    runtimeWindow: null,
  });
});

test("offline consolidation plan validator rejects mutated plans before execution", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "focused-invalid-plan",
    agentId: "agent-focused-invalid-plan",
    presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
    runtimePhase: createRuntimePhase("idle"),
    planId: "focused-invalid-plan-id",
  });

  assert.throws(
    () =>
      validateOfflineConsolidationBatchPlan({
        ...plan,
        workUnits: plan.workUnits.map((workUnit, index) =>
          index === 0
            ? {
                ...workUnit,
                operation: "offline-consolidation-identity-merge",
              }
            : workUnit,
        ),
      }),
    /workUnits\[0\]\.operation must remain offline-consolidation-young-generation-triage/,
  );
});

test("offline consolidation gate returns validated agent-scoped plans for authorized sleep windows", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "focused-validated-request",
    agentId: "agent-focused-validated-request",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    teamIdle: true,
    priorityMemoryIds: ["stm-15", "ltm-4"],
    planId: "focused-validated-plan",
  });

  assert.equal(result.status, "validated");
  assert.equal(result.safeToExecute, true);
  assert.equal(result.rejection, null);
  assert.equal(result.request.requestId, "focused-validated-request");
  assert.equal(result.request.agentId, "agent-focused-validated-request");
  assert.equal(result.request.runtimeWindow, "sleep");
  assert.equal(result.request.coordinationHint, "team-idle");
  assert.equal(result.plan.planId, "focused-validated-plan");
  assert.equal(result.plan.agentCount, 1);
  assert.equal(result.plan.metadata.authorization.eligible, true);
  assert.equal(result.plan.metadata.authorization.blockedReason, null);
  assert.deepEqual(result.plan.metadata.stageIds, [
    "young-generation-triage",
    "young-generation-promotion",
    "old-generation-reinforcement",
    "archived-memory-review",
  ]);
  assert.deepEqual(result.plan.metadata.priorityMemoryIds, ["stm-15", "ltm-4"]);
  assert.equal(validateOfflineConsolidationBatchPlan(result.plan), true);
});
