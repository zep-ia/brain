import assert from "node:assert/strict";
import test from "node:test";

import {
  createGemma4B200ElectricConsolidationPlan,
} from "../src/index.js";

test("creates a Gemma 4 on B200 plan with Electric as durable sync plane", () => {
  const plan = createGemma4B200ElectricConsolidationPlan({
    planId: "hermes-gemma4-b200-electric",
    streamIds: ["hermes/session/123"],
    postgresTables: ["agent_events", "memory_candidates", "long_term_memory"],
  });

  assert.equal(plan.schemaId, "gemma4_b200_electric_consolidation_plan");
  assert.equal(plan.model.modelFamily, "gemma-4");
  assert.equal(plan.accelerator.acceleratorClass, "b200");
  assert.equal(plan.electric.role, "durable-stream-and-read-sync-plane");
  assert.equal(plan.runtimeBoundary.transport, "rpc");
  assert.equal(plan.runtimeBoundary.zepiaToBrainUsesRdma, false);
  assert.equal(plan.writePath.electricOwnsWrites, false);
  assert.equal(plan.checkpointPolicy.advanceAfterDurableWrite, true);
  assert.deepEqual(plan.electric.streamIds, ["hermes/session/123"]);
  assert.deepEqual(plan.electric.postgresTables, [
    "agent_events",
    "memory_candidates",
    "long_term_memory",
  ]);
  assert.equal(plan.identityIsolation.mode, "agent-scoped");
  assert.equal(plan.identityIsolation.teamIdleMergesIdentity, false);
  assert.ok(plan.workerPipeline.operations.includes("embedding-generation"));
  assert.ok(plan.workerPipeline.operations.includes("memory-candidate-reranking"));
  assert.ok(plan.workerPipeline.operations.includes("hippocampus-summary-distillation"));
});

test("blocks RDMA across the live runtime boundary", () => {
  assert.throws(
    () =>
      createGemma4B200ElectricConsolidationPlan({
        runtimeBoundary: { zepiaToBrainUsesRdma: true },
      }),
    /zepiaToBrainUsesRdma must remain false/,
  );
});

test("keeps Electric on read sync and durable stream duties, not write authority", () => {
  assert.throws(
    () =>
      createGemma4B200ElectricConsolidationPlan({
        writePath: { electricOwnsWrites: true },
      }),
    /electricOwnsWrites must remain false/,
  );
});

test("default plan includes run metadata and explicit agent-scoped identity isolation", () => {
  const plan = createGemma4B200ElectricConsolidationPlan();

  assert.ok(plan.electric.postgresTables.includes("consolidation_runs"));
  assert.deepEqual(plan.identityIsolation, {
    mode: "agent-scoped",
    teamIdleMergesIdentity: false,
    overwriteNamespace: "agent-scoped",
    requiresIndependentWrites: true,
  });
});
