import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_AUTHORIZED_IDLE_PHASES,
  createIdleWindowReconstructionBudget,
  createIdleWindowSuggestion,
  createRuntimePhase,
  evaluateIdleWindowAuthorization,
  planIdleWindowConsolidation,
} from "../src/index.js";

test("idle-window authorization is limited to the supported runtime phases", () => {
  assert.deepEqual(RUNTIME_AUTHORIZED_IDLE_PHASES, [
    "idle",
    "rest",
    "break",
    "sleep",
  ]);

  for (const runtimePhase of RUNTIME_AUTHORIZED_IDLE_PHASES) {
    const decision = evaluateIdleWindowAuthorization({
      agentId: `agent-${runtimePhase}`,
      runtimePhase,
    });

    assert.equal(decision.eligible, true);
    assert.equal(decision.opensConsolidation, true);
    assert.equal(decision.blockedReason, null);
  }
});

test("idle heuristics remain advisory and cannot force consolidation", () => {
  const decision = evaluateIdleWindowAuthorization({
    agentId: "agent-active",
    runtimePhase: createRuntimePhase("active"),
    teamIdle: true,
    inactivitySuggestion: createIdleWindowSuggestion({
      inactivityMs: 60_000,
      idleThresholdMs: 15_000,
      note: "No live work detected",
    }),
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.opensConsolidation, false);
  assert.equal(decision.blockedReason, "runtime-phase-not-idle-window");
  assert.equal(decision.teamIdle, true);
  assert.equal(decision.inactivitySuggestion.authorizesConsolidation, false);
  assert.equal(decision.inactivitySuggestion.thresholdReached, true);
});

test("inactivity heuristics only flag threshold reach when usage meets or exceeds the configured cap", () => {
  const cases = [
    {
      label: "below-cap",
      inactivityMs: 14_999,
      expectedThresholdReached: false,
    },
    {
      label: "at-cap",
      inactivityMs: 15_000,
      expectedThresholdReached: true,
    },
    {
      label: "above-cap",
      inactivityMs: 15_001,
      expectedThresholdReached: true,
    },
  ];

  cases.forEach(({ label, inactivityMs, expectedThresholdReached }) => {
    const decision = evaluateIdleWindowAuthorization({
      agentId: `agent-${label}`,
      runtimePhase: createRuntimePhase("active"),
      inactivitySuggestion: createIdleWindowSuggestion({
        inactivityMs,
        idleThresholdMs: 15_000,
        note: `Runtime inactivity sample for ${label}.`,
      }),
    });

    assert.equal(
      decision.inactivitySuggestion.thresholdReached,
      expectedThresholdReached,
    );
    assert.equal(decision.inactivitySuggestion.authorizesConsolidation, false);
    assert.equal(decision.opensConsolidation, false);
    assert.equal(decision.blockedReason, "runtime-phase-not-idle-window");
  });
});

test("only caller-controlled runtime phases can authorize consolidation", () => {
  const decision = evaluateIdleWindowAuthorization({
    agentId: "agent-scheduler",
    runtimePhase: createRuntimePhase("sleep", { authority: "scheduler" }),
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.opensConsolidation, false);
  assert.equal(decision.blockedReason, "runtime-phase-not-caller-controlled");
});

test("team idle batches only the independently eligible agents", () => {
  const plan = planIdleWindowConsolidation({
    teamIdle: true,
    agents: [
      {
        agentId: "agent-idle",
        runtimePhase: createRuntimePhase("idle"),
      },
      {
        agentId: "agent-rest",
        runtimePhase: createRuntimePhase("rest"),
      },
      {
        agentId: "agent-focus",
        runtimePhase: createRuntimePhase("focus"),
        inactivitySuggestion: createIdleWindowSuggestion({
          inactivityMs: 45_000,
          idleThresholdMs: 15_000,
        }),
      },
    ],
  });

  assert.equal(plan.teamIdle, true);
  assert.equal(plan.windowAuthority, "runtime-phase");
  assert.equal(plan.batchWindowOpen, true);
  assert.deepEqual(
    plan.eligibleAgents.map((agent) => agent.agentId),
    ["agent-idle", "agent-rest"],
  );
  assert.deepEqual(
    plan.blockedAgents.map((agent) => [agent.agentId, agent.blockedReason]),
    [["agent-focus", "runtime-phase-not-idle-window"]],
  );
});

test("idle-window authorization derives a concrete reconstruction budget from the trigger window", () => {
  const decision = evaluateIdleWindowAuthorization({
    agentId: "agent-idle-budget",
    runtimePhase: createRuntimePhase("idle"),
    idleTriggerWindowMs: 2_000,
  });

  assert.deepEqual(
    decision.reconstructionBudget,
    createIdleWindowReconstructionBudget({
      idleTriggerWindowMs: 2_000,
    }),
  );

  const plan = planIdleWindowConsolidation({
    agents: [
      {
        agentId: "agent-idle-budget",
        runtimePhase: createRuntimePhase("rest"),
        idleTriggerWindowMs: 2_000,
      },
    ],
  });

  assert.deepEqual(
    plan.eligibleAgents[0].reconstructionBudget,
    decision.reconstructionBudget,
  );
});
