import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuntimePhase,
  planTeamIdleConsolidationBatch,
} from "../src/index.js";

test("team idle batching keeps each eligible agent on an independent identity and overwrite boundary", () => {
  const plan = planTeamIdleConsolidationBatch({
    teamIdle: true,
    agents: [
      {
        agentId: "agent-alpha",
        runtimePhase: createRuntimePhase("idle"),
        identityScope: {
          agentId: "agent-alpha",
          persona: "planner",
        },
        overwriteTargets: [
          {
            scope: "long-term-memory",
            targetId: "ltm-1",
          },
        ],
      },
      {
        agentId: "agent-bravo",
        runtimePhase: createRuntimePhase("sleep"),
        identityScope: {
          agentId: "agent-bravo",
          role: "researcher",
        },
        overwriteTargets: [
          {
            scope: "archived-memory",
            targetId: "archive-9",
          },
        ],
      },
    ],
  });

  assert.equal(plan.teamIdle, true);
  assert.equal(plan.eligibleCount, 2);
  assert.equal(plan.blockedCount, 0);
  assert.equal(plan.batchWindowOpen, true);
  assert.equal(plan.batchCount, 1);
  assert.equal(plan.batches[0].coordinationSignal, "team-idle");
  assert.equal(plan.batches[0].executionMode, "offline-independent");
  assert.equal(plan.batches[0].isolationMode, "agent-scoped");
  assert.equal(plan.batches[0].writeIsolationMode, "agent-scoped");
  assert.deepEqual(plan.batches[0].agentIds, ["agent-alpha", "agent-bravo"]);
  assert.equal(plan.defaultBatchLimit.targetProfile, "b200-style");
  assert.equal(plan.batches[0].batchPlan.limit.targetProfile, "b200-style");
  assert.equal(plan.batches[0].batchPlan.executionMode, "offline-plan-only");
  assert.equal(plan.batches[0].batchPlan.executorBinding, "external");
  assert.deepEqual(plan.batches[0].batchPlan.orderedWorkUnitIds, [
    "team-idle-batch-1:agent-alpha,agent-bravo/agent/agent-alpha",
    "team-idle-batch-1:agent-alpha,agent-bravo/agent/agent-bravo",
  ]);
  assert.equal(plan.batches[0].batchPlan.capacityUsage.agentCount, 2);
  assert.equal(plan.batches[0].batchPlan.capacityUsage.workUnitCount, 2);
  assert.equal(plan.batches[0].batchPlan.capacityUsage.overwriteTargetCount, 2);
  assert.equal(plan.batches[0].batchPlan.withinCapacity, true);
  assert.deepEqual(plan.batches[0].batchPlan.capacityViolations, []);

  const [alpha, bravo] = plan.eligibleAgents;

  assert.equal(alpha.sharedIdentity, false);
  assert.equal(bravo.sharedIdentity, false);
  assert.equal(alpha.identityIsolationKey, "agent:agent-alpha");
  assert.equal(bravo.identityIsolationKey, "agent:agent-bravo");
  assert.equal(alpha.overwriteNamespace, "agent:agent-alpha");
  assert.equal(bravo.overwriteNamespace, "agent:agent-bravo");
  assert.deepEqual(alpha.safetyViolations, []);
  assert.deepEqual(bravo.safetyViolations, []);
  assert.deepEqual(alpha.overwriteTargets, [
    {
      scope: "long-term-memory",
      targetId: "ltm-1",
      agentId: "agent-alpha",
    },
  ]);
  assert.deepEqual(bravo.overwriteTargets, [
    {
      scope: "archived-memory",
      targetId: "archive-9",
      agentId: "agent-bravo",
    },
  ]);
});

test("team idle batching blocks shared identity scopes and cross-agent overwrite targets", () => {
  const plan = planTeamIdleConsolidationBatch({
    teamIdle: true,
    agents: [
      {
        agentId: "agent-alpha",
        runtimePhase: createRuntimePhase("idle"),
        identityScope: {
          agentId: "agent-bravo",
        },
        overwriteTargets: [
          {
            scope: "long-term-memory",
            targetId: "ltm-shared",
            agentId: "agent-bravo",
          },
        ],
      },
      {
        agentId: "agent-duplicate",
        runtimePhase: createRuntimePhase("idle"),
      },
      {
        agentId: "agent-duplicate",
        runtimePhase: createRuntimePhase("sleep"),
      },
    ],
  });

  assert.equal(plan.teamIdle, true);
  assert.equal(plan.eligibleCount, 0);
  assert.equal(plan.blockedCount, 3);
  assert.equal(plan.batchWindowOpen, false);
  assert.equal(plan.batchCount, 0);
  assert.equal(plan.defaultBatchLimit.targetProfile, "b200-style");

  const alpha = plan.blockedAgents.find((entry) => entry.agentId === "agent-alpha");
  const duplicates = plan.blockedAgents.filter(
    (entry) => entry.agentId === "agent-duplicate",
  );

  assert.ok(alpha);
  assert.equal(alpha.blockedReason, "shared-identity-scope");
  assert.deepEqual(alpha.safetyViolations, [
    "shared-identity-scope",
    "cross-agent-overwrite-target",
  ]);

  assert.equal(duplicates.length, 2);
  duplicates.forEach((entry) => {
    assert.equal(entry.blockedReason, "duplicate-agent-batch-entry");
    assert.deepEqual(entry.safetyViolations, ["duplicate-agent-batch-entry"]);
  });
});
