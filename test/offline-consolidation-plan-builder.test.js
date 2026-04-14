import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS,
  OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG,
  DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS,
  OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA,
  buildOfflineConsolidationBatchPlan,
  createOfflineConsolidationPlanBuilderPreset,
  createOfflineConsolidationPlanBuilderPresetCatalog,
  createOfflineConsolidationPlanBuilderRequest,
  createRuntimePhase,
  requestOfflineConsolidationBatchPlan,
  resolveOfflineConsolidationPlanBuilderPreset,
  validateOfflineConsolidationBatchPlan,
} from "../src/index.js";

test("offline consolidation plan-builder exposes a reusable default preset catalog", () => {
  assert.equal(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.contractLayer,
    "plan-builder",
  );
  assert.equal(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.outputPlanApi,
    "offline-batch-plan",
  );
  assert.equal(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.defaultPresetId,
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
  );
  assert.deepEqual(
    DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG.presetIds,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS,
  );

  const sleepPreset = resolveOfflineConsolidationPlanBuilderPreset(
    "sleep-extended-maintenance",
  );

  assert.equal(sleepPreset.runtimeWindow, "sleep");
  assert.deepEqual(sleepPreset.generationCoverage, ["young", "old"]);
  assert.equal(
    sleepPreset.batchProfileId,
    DEFAULT_B200_OFFLINE_BATCH_LIMIT.limitId,
  );
  assert.equal(sleepPreset.authorizationModel, "runtime-phase-only");
  assert.equal(sleepPreset.heuristicsPolicy, "suggest-only");
  assert.equal(sleepPreset.teamCoordinationPolicy, "batch-only");
  assert.equal(sleepPreset.immutableIdentityPolicy, "runtime-invariants-only");
  assert.equal(sleepPreset.learnedTraitPolicy, "long-term-memory-only");
  assert.equal(sleepPreset.allowIdentityPromotion, false);
});

test("offline consolidation plan-builder request resolves presets and keeps runtime heuristics advisory", () => {
  const request = createOfflineConsolidationPlanBuilderRequest({
    requestId: "request-1",
    agentId: "agent-1",
    presetId: "sleep-extended-maintenance",
    runtimePhase: {
      value: "sleep",
      authority: "caller",
      changedAt: "2026-04-12T10:30:00Z",
    },
    inactivitySuggestion: {
      inactivityMs: 900000,
      idleThresholdMs: 300000,
      note: "Long quiet period detected.",
    },
    teamIdle: true,
    priorityMemoryIds: ["stm-9", "ltm-2", "stm-9"],
    metadata: {
      requestedBy: "runtime-phase-transition",
    },
  });

  assert.equal(request.presetId, "sleep-extended-maintenance");
  assert.equal(request.runtimeWindow, "sleep");
  assert.equal(request.runtimePhase?.value, "sleep");
  assert.equal(request.runtimePhase?.authority, "caller");
  assert.equal(request.inactivitySuggestion?.authorizesConsolidation, false);
  assert.equal(request.teamIdle, true);
  assert.equal(request.coordinationHint, "team-idle");
  assert.deepEqual(request.priorityMemoryIds, ["stm-9", "ltm-2"]);
  assert.equal(
    request.batchProfileId,
    DEFAULT_B200_OFFLINE_BATCH_LIMIT.limitId,
  );
  assert.equal(request.authorizationModel, "runtime-phase-only");
  assert.equal(request.heuristicsPolicy, "suggest-only");
  assert.equal(request.teamCoordinationPolicy, "batch-only");
  assert.equal(request.scope, "agent-scoped");
  assert.equal(request.immutableIdentityPolicy, "runtime-invariants-only");
  assert.equal(request.learnedTraitPolicy, "long-term-memory-only");
  assert.equal(request.allowIdentityPromotion, false);
});

test("offline consolidation plan-builder request schema publishes fail-closed safety constants", () => {
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.schemaId,
    "agent_brain_offline_consolidation_request",
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.authorizationModel.const,
    "runtime-phase-only",
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.heuristicsPolicy.const,
    "suggest-only",
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.teamCoordinationPolicy.const,
    "batch-only",
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.allowIdentityPromotion.const,
    false,
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.workingLoopIsolation.const,
    "offline-decoupled",
  );
  assert.equal(
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA.fields.runtimeWindow.values.includes(
      "sleep",
    ),
    true,
  );
});

test("offline consolidation plan-builder supports custom preset catalogs and default preset resolution", () => {
  const customCatalog = createOfflineConsolidationPlanBuilderPresetCatalog({
    catalogId: "custom-offline-consolidation-presets",
    defaultPresetId: "sleep-focused",
    presets: [
      {
        presetId: "sleep-focused",
        displayName: "Sleep Focused",
        description: "Custom sleep preset for extended maintenance planning.",
        runtimeWindow: "sleep",
        intensity: "extended",
        generationCoverage: ["young", "old"],
        candidateSources: [
          "young-short-term-memory",
          "old-long-term-memory",
        ],
        planningGoals: [
          "promote-stable-young-memory",
          "reinforce-old-memory",
          "preserve-learned-traits",
        ],
      },
    ],
  });
  const request = createOfflineConsolidationPlanBuilderRequest({
    requestId: "request-custom",
    agentId: "agent-custom",
    presetCatalog: customCatalog,
  });

  assert.equal(request.presetCatalogId, "custom-offline-consolidation-presets");
  assert.equal(request.presetId, "sleep-focused");
  assert.equal(request.runtimeWindow, "sleep");
  assert.equal(request.coordinationHint, "independent");

  const plan = buildOfflineConsolidationBatchPlan({
    request: {
      ...request,
      runtimePhase: createRuntimePhase("sleep"),
    },
    planId: "custom-catalog-plan",
  });

  assert.equal(plan.metadata.presetCatalogId, "custom-offline-consolidation-presets");
  assert.equal(plan.metadata.presetId, "sleep-focused");
});

test("offline consolidation plan-builder preset validation rejects incomplete required fields and invalid enum lists", () => {
  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPreset({
        displayName: "Missing Id",
        description: "Should fail because presetId is required.",
      }),
    /presetId must be a string/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPreset({
        presetId: "missing-display-name",
        description: "Should fail because displayName is required.",
      }),
    /displayName must be a string/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPreset({
        presetId: "invalid-generation-coverage",
        displayName: "Invalid Generation Coverage",
        description: "Should fail because generation coverage is empty.",
        generationCoverage: [],
      }),
    /generationCoverage must not be empty/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPreset({
        presetId: "invalid-planning-goals",
        displayName: "Invalid Planning Goals",
        description: "Should fail because planningGoals contains an unknown goal.",
        planningGoals: ["promote-stable-young-memory", "merge-agent-identities"],
      }),
    /planningGoals\[1\] must be one of/,
  );
});

test("offline consolidation plan-builder preset catalog validation rejects unresolved or inconsistent preset definitions", () => {
  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPresetCatalog({
        catalogId: "incomplete-indexed-catalog",
        presets: {
          "sleep-focused": {
            presetId: "sleep-focused",
            displayName: "Sleep Focused",
            description: "Indexed preset entry without presetIds should fail.",
            runtimeWindow: "sleep",
          },
        },
      }),
    /presets must be an array or a preset catalog index/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPresetCatalog({
        catalogId: "missing-index-entry",
        presetIds: ["sleep-focused"],
        presets: {},
      }),
    /presetIds\[0\] does not resolve to a configured preset/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPresetCatalog({
        catalogId: "duplicate-preset-catalog",
        presets: [
          {
            presetId: "duplicate",
            displayName: "Duplicate One",
            description: "First duplicate preset entry.",
          },
          {
            presetId: "duplicate",
            displayName: "Duplicate Two",
            description: "Second duplicate preset entry.",
          },
        ],
      }),
    /duplicate presetId is not allowed: duplicate/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPresetCatalog({
        catalogId: "bad-default-preset-catalog",
        defaultPresetId: "missing-default",
        presets: [
          {
            presetId: "sleep-focused",
            displayName: "Sleep Focused",
            description: "Preset exists but not under the requested default id.",
            runtimeWindow: "sleep",
          },
        ],
      }),
    /defaultPresetId must match one of the configured presets: missing-default/,
  );
});

test("offline consolidation plan-builder contracts reject shared batch-plan fields", () => {
  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderPreset({
        presetId: "invalid-preset",
        displayName: "Invalid",
        description: "Should fail because it leaks batch-plan fields.",
        workUnits: [],
      }),
    /must remain separate from shared batch-plan API via workUnits/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "invalid-request",
        agentId: "agent-invalid",
        maxWorkUnitsPerBatch: 4,
      }),
    /must remain separate from shared batch-plan API via maxWorkUnitsPerBatch/,
  );
});

test("offline consolidation plan-builder request rejects unsafe overrides and ambiguous normalization input before planning", () => {
  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "unsafe-authorization-model",
        agentId: "agent-unsafe",
        authorizationModel: "scheduler-controlled",
      }),
    /authorizationModel must be runtime-phase-only/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "unsafe-identity-promotion",
        agentId: "agent-unsafe",
        allowIdentityPromotion: true,
      }),
    /allowIdentityPromotion must be false/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "unsupported-field",
        agentId: "agent-unsafe",
        executionMode: "inline",
      }),
    /contains unsupported field "executionMode"/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "runtime-window-mismatch",
        agentId: "agent-unsafe",
        presetId: "sleep-extended-maintenance",
        runtimeWindow: "idle",
      }),
    /runtimeWindow must match resolved preset\.runtimeWindow: sleep/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "coordination-mismatch",
        agentId: "agent-unsafe",
        teamIdle: true,
        coordinationHint: "independent",
      }),
    /coordinationHint must match teamIdle-derived value: team-idle/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "type-mismatch",
        agentId: "agent-unsafe",
        teamIdle: "yes",
      }),
    /teamIdle must be a boolean/,
  );
});

test("offline consolidation plan-builder request rejects missing required identifiers with explicit errors", () => {
  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        agentId: "agent-missing-request",
      }),
    /requestId must be a string/,
  );

  assert.throws(
    () =>
      createOfflineConsolidationPlanBuilderRequest({
        requestId: "missing-agent-id",
      }),
    /agentId must be a string/,
  );
});

test("offline consolidation batch-plan builder translates default presets into B200-style concrete batch plans", () => {
  assert.deepEqual(OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS, [
    "young-generation-triage",
    "young-generation-promotion",
    "old-generation-reinforcement",
    "archived-memory-review",
    "learned-trait-preservation",
  ]);

  const cases = [
    {
      presetId: "idle-young-triage",
      runtimePhase: "idle",
      teamIdle: false,
      expectedStageIds: [
        "young-generation-triage",
        "young-generation-promotion",
      ],
    },
    {
      presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
      runtimePhase: "rest",
      teamIdle: false,
      expectedStageIds: [
        "young-generation-triage",
        "young-generation-promotion",
        "old-generation-reinforcement",
      ],
    },
    {
      presetId: "sleep-extended-maintenance",
      runtimePhase: "sleep",
      teamIdle: true,
      expectedStageIds: [
        "young-generation-triage",
        "young-generation-promotion",
        "old-generation-reinforcement",
        "archived-memory-review",
      ],
    },
  ];

  cases.forEach(({ presetId, runtimePhase, teamIdle, expectedStageIds }) => {
    const planId = `${presetId}-plan`;
    const agentId = `agent-${presetId}`;
    const plan = buildOfflineConsolidationBatchPlan({
      requestId: `${presetId}-request`,
      agentId,
      presetId,
      runtimePhase: createRuntimePhase(runtimePhase),
      teamIdle,
      priorityMemoryIds: ["stm-9", "ltm-2"],
      planId,
      batchPlanMetadata: {
        initiatedBy: "test-suite",
      },
    });

    assert.equal(plan.planId, planId);
    assert.equal(plan.limit.limitId, DEFAULT_B200_OFFLINE_BATCH_LIMIT.limitId);
    assert.equal(plan.limit.targetProfile, "b200-style");
    assert.equal(plan.limit.acceleratorClass, "b200-style");
    assert.equal(plan.coordinationSignal, teamIdle ? "team-idle" : "independent");
    assert.equal(plan.executionMode, "offline-plan-only");
    assert.deepEqual(plan.metadata.stageIds, expectedStageIds);
    assert.equal(plan.metadata.authorization.eligible, true);
    assert.equal(
      plan.metadata.authorization.runtimePhase.value,
      runtimePhase,
    );
    assert.deepEqual(
      plan.orderedWorkUnitIds,
      expectedStageIds.map((stageId) => `${planId}/${stageId}`),
    );
    assert.deepEqual(
      plan.workUnits.map((workUnit) => workUnit.metadata.stageId),
      expectedStageIds,
    );
    assert.deepEqual(
      plan.workUnits.map((workUnit) => workUnit.agentId),
      Array(expectedStageIds.length).fill(agentId),
    );
    assert.deepEqual(
      plan.workUnits.map((workUnit) => workUnit.runtimePhase),
      Array(expectedStageIds.length).fill(runtimePhase),
    );
    assert.deepEqual(plan.metadata.priorityMemoryIds, ["stm-9", "ltm-2"]);
    assert.deepEqual(plan.metadata.batchPlanMetadata, {
      initiatedBy: "test-suite",
    });
  });
});

test("offline consolidation batch-plan builder maps each supported preset to the expected executable work-unit plan", () => {
  const cases = [
    {
      presetId: "idle-young-triage",
      runtimePhase: "idle",
      expectedPlan: {
        runtimeWindow: "idle",
        intensity: "conservative",
        stageIds: [
          "young-generation-triage",
          "young-generation-promotion",
        ],
        workUnits: [
          {
            stageId: "young-generation-triage",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-triage"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: ["mask-stale-young-memory"],
            overwriteTargets: [
              "working-memory:young-generation-triage",
              "short-term-memory:young-generation-triage",
            ],
          },
          {
            stageId: "young-generation-promotion",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-promotion"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: [
              "promote-stable-young-memory",
              "preserve-learned-traits",
            ],
            overwriteTargets: [
              "long-term-memory:young-generation-promotion",
              "consolidation-journal:young-generation-promotion",
            ],
          },
        ],
      },
    },
    {
      presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
      runtimePhase: "idle",
      expectedPlan: {
        runtimeWindow: "idle",
        intensity: "balanced",
        stageIds: [
          "young-generation-triage",
          "young-generation-promotion",
          "old-generation-reinforcement",
        ],
        workUnits: [
          {
            stageId: "young-generation-triage",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-triage"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: [
              "mask-stale-young-memory",
              "archive-stale-memory",
            ],
            overwriteTargets: [
              "working-memory:young-generation-triage",
              "short-term-memory:young-generation-triage",
              "archived-memory:stale-young-memory",
            ],
          },
          {
            stageId: "young-generation-promotion",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-promotion"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: [
              "promote-stable-young-memory",
              "preserve-learned-traits",
            ],
            overwriteTargets: [
              "long-term-memory:young-generation-promotion",
              "consolidation-journal:young-generation-promotion",
            ],
          },
          {
            stageId: "old-generation-reinforcement",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "old-generation-reinforcement"
              ],
            candidateSources: ["old-long-term-memory"],
            planningGoals: [
              "reinforce-old-memory",
              "preserve-learned-traits",
            ],
            overwriteTargets: [
              "long-term-memory:old-generation-reinforcement",
              "consolidation-journal:old-generation-reinforcement",
            ],
          },
        ],
      },
    },
    {
      presetId: "sleep-extended-maintenance",
      runtimePhase: "sleep",
      expectedPlan: {
        runtimeWindow: "sleep",
        intensity: "extended",
        stageIds: [
          "young-generation-triage",
          "young-generation-promotion",
          "old-generation-reinforcement",
          "archived-memory-review",
        ],
        workUnits: [
          {
            stageId: "young-generation-triage",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-triage"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: [
              "mask-stale-young-memory",
              "archive-stale-memory",
            ],
            overwriteTargets: [
              "working-memory:young-generation-triage",
              "short-term-memory:young-generation-triage",
              "archived-memory:stale-young-memory",
            ],
          },
          {
            stageId: "young-generation-promotion",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "young-generation-promotion"
              ],
            candidateSources: [
              "young-working-memory",
              "young-short-term-memory",
            ],
            planningGoals: [
              "promote-stable-young-memory",
              "preserve-learned-traits",
            ],
            overwriteTargets: [
              "long-term-memory:young-generation-promotion",
              "consolidation-journal:young-generation-promotion",
            ],
          },
          {
            stageId: "old-generation-reinforcement",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "old-generation-reinforcement"
              ],
            candidateSources: ["old-long-term-memory"],
            planningGoals: [
              "reinforce-old-memory",
              "preserve-learned-traits",
            ],
            overwriteTargets: [
              "long-term-memory:old-generation-reinforcement",
              "consolidation-journal:old-generation-reinforcement",
            ],
          },
          {
            stageId: "archived-memory-review",
            operation:
              OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS[
                "archived-memory-review"
              ],
            candidateSources: [
              "old-long-term-memory",
              "old-archived-memory",
            ],
            planningGoals: ["review-superseded-memory"],
            overwriteTargets: [
              "archived-memory:superseded-review",
              "consolidation-journal:archived-memory-review",
              "long-term-memory:superseded-review",
            ],
          },
        ],
      },
    },
  ];

  assert.deepEqual(
    cases.map(({ presetId }) => presetId),
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS,
  );

  cases.forEach(({ presetId, runtimePhase, expectedPlan }) => {
    const planId = `${presetId}-executable-plan`;
    const plan = buildOfflineConsolidationBatchPlan({
      requestId: `${presetId}-executable-request`,
      agentId: `agent-${presetId}`,
      presetId,
      runtimePhase: createRuntimePhase(runtimePhase),
      planId,
    });

    assert.equal(plan.metadata.presetId, presetId);
    assert.equal(plan.metadata.runtimeWindow, expectedPlan.runtimeWindow);
    assert.equal(plan.metadata.intensity, expectedPlan.intensity);
    assert.deepEqual(plan.metadata.stageIds, expectedPlan.stageIds);
    assert.deepEqual(
      plan.orderedWorkUnitIds,
      expectedPlan.stageIds.map((stageId) => `${planId}/${stageId}`),
    );
    assert.deepEqual(
      plan.workUnits.map((workUnit) => ({
        stageId: workUnit.metadata.stageId,
        operation: workUnit.operation,
        candidateSources: workUnit.metadata.candidateSources,
        planningGoals: workUnit.metadata.planningGoals,
        overwriteTargets: workUnit.overwriteTargets,
      })),
      expectedPlan.workUnits,
    );
  });
});

test("offline consolidation batch-plan builder emits a learned-trait preservation fallback stage when no promotion or reinforcement stage applies", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "learned-trait-only-request",
    agentId: "agent-learned-trait-only",
    runtimePhase: createRuntimePhase("sleep"),
    planId: "learned-trait-only-plan",
    preset: {
      presetId: "learned-trait-only",
      displayName: "Learned Trait Only",
      description: "Preserve learned traits without promoting or reinforcing durable memories.",
      runtimeWindow: "sleep",
      intensity: "conservative",
      generationCoverage: ["old"],
      candidateSources: ["old-long-term-memory"],
      planningGoals: ["preserve-learned-traits"],
    },
  });

  assert.deepEqual(plan.metadata.stageIds, ["learned-trait-preservation"]);
  assert.deepEqual(
    plan.workUnits.map((workUnit) => workUnit.metadata.stageId),
    ["learned-trait-preservation"],
  );
  assert.deepEqual(plan.workUnits[0].metadata.planningGoals, [
    "preserve-learned-traits",
  ]);
  assert.deepEqual(plan.workUnits[0].overwriteTargets, [
    "long-term-memory:learned-trait-preservation",
    "consolidation-journal:learned-trait-preservation",
  ]);
});

test("offline consolidation batch-plan builder reuses normalized requests, keeps heuristics advisory, and validates B200 profile inputs", () => {
  const request = createOfflineConsolidationPlanBuilderRequest({
    requestId: "normalized-request",
    agentId: "agent-normalized",
    presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
    runtimePhase: createRuntimePhase("break"),
    inactivitySuggestion: {
      inactivityMs: 90_000,
      idleThresholdMs: 30_000,
      note: "Quiet period detected.",
    },
    priorityMemoryIds: ["wm-1"],
    metadata: {
      requestedBy: "test-suite",
    },
  });
  const plan = buildOfflineConsolidationBatchPlan({
    request,
    planId: "normalized-request-plan",
    batchLimit: {
      ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
      limitId: request.batchProfileId,
      maxWorkUnitsPerBatch: 1,
    },
    batchPlanMetadata: {
      ticket: "BRAIN-202",
    },
  });

  assert.equal(plan.limit.maxWorkUnitsPerBatch, 1);
  assert.equal(plan.withinCapacity, false);
  assert.deepEqual(plan.capacityViolations, [
    "max-work-units-per-batch-exceeded",
  ]);
  assert.equal(plan.metadata.authorization.runtimePhase.value, "break");
  assert.equal(
    plan.metadata.authorization.inactivitySuggestion.authorizesConsolidation,
    false,
  );
  assert.deepEqual(plan.metadata.requestMetadata, {
    requestedBy: "test-suite",
  });
  assert.deepEqual(plan.metadata.batchPlanMetadata, {
    ticket: "BRAIN-202",
  });

  assert.throws(
    () =>
      buildOfflineConsolidationBatchPlan({
        requestId: "active-phase",
        agentId: "agent-active",
        presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
        runtimePhase: createRuntimePhase("active"),
        inactivitySuggestion: {
          inactivityMs: 120_000,
          idleThresholdMs: 30_000,
        },
      }),
    /requires a caller-authorized idle or sleep runtime phase: runtime-phase-not-idle-window/,
  );

  assert.throws(
    () =>
      buildOfflineConsolidationBatchPlan({
        requestId: "sleep-window-mismatch",
        agentId: "agent-mismatch",
        presetId: "sleep-extended-maintenance",
        runtimePhase: createRuntimePhase("idle"),
      }),
    /sleep runtimeWindow requires runtimePhase sleep/,
  );

  assert.throws(
    () =>
      buildOfflineConsolidationBatchPlan({
        request,
        batchLimit: {
          ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
          limitId: "different-profile-id",
        },
      }),
    /batchLimit\.limitId must match request\.batchProfileId/,
  );

  assert.throws(
    () =>
      buildOfflineConsolidationBatchPlan({
        request,
        batchLimit: {
          ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
          limitId: request.batchProfileId,
          targetProfile: "generic-offline",
        },
      }),
    /batchLimit\.targetProfile must remain b200-style/,
  );
});

test("offline consolidation request-to-plan gate returns only validated plans for authorized inputs", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "validated-gate-request",
    agentId: "agent-gated",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    teamIdle: true,
    priorityMemoryIds: ["stm-11", "ltm-7"],
    planId: "validated-gate-plan",
  });

  assert.equal(result.status, "validated");
  assert.equal(result.safeToExecute, true);
  assert.equal(result.rejection, null);
  assert.equal(result.request.requestId, "validated-gate-request");
  assert.equal(result.request.agentId, "agent-gated");
  assert.equal(result.plan.planId, "validated-gate-plan");
  assert.equal(result.plan.metadata.authorization.eligible, true);
  assert.equal(result.plan.metadata.authorization.blockedReason, null);
  assert.equal(validateOfflineConsolidationBatchPlan(result.plan), true);
});

test("offline consolidation request-to-plan gate returns structured request-validation rejections", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "invalid-gate-request",
    agentId: "agent-invalid-gate",
    executionMode: "inline",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.safeToExecute, false);
  assert.equal(result.request, null);
  assert.equal(result.plan, null);
  assert.equal(result.rejection.stage, "request-validation");
  assert.equal(result.rejection.reasonCode, "invalid-request");
  assert.equal(result.rejection.blockedReason, null);
  assert.equal(result.rejection.requestId, "invalid-gate-request");
  assert.equal(result.rejection.agentId, "agent-invalid-gate");
  assert.equal(result.rejection.planId, null);
  assert.equal(result.rejection.runtimeWindow, null);
  assert.match(
    result.rejection.message,
    /contains unsupported field "executionMode"/,
  );
});

test("offline consolidation request-to-plan gate returns structured runtime authorization rejections", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "active-gate-request",
    agentId: "agent-active-gate",
    runtimePhase: createRuntimePhase("active"),
    planId: "active-gate-plan",
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.safeToExecute, false);
  assert.equal(result.plan, null);
  assert.equal(result.request.requestId, "active-gate-request");
  assert.equal(result.rejection.stage, "runtime-authorization");
  assert.equal(result.rejection.reasonCode, "runtime-phase-not-idle-window");
  assert.equal(
    result.rejection.blockedReason,
    "runtime-phase-not-idle-window",
  );
  assert.equal(result.rejection.requestId, "active-gate-request");
  assert.equal(result.rejection.agentId, "agent-active-gate");
  assert.equal(result.rejection.planId, "active-gate-plan");
  assert.equal(result.rejection.runtimeWindow, "idle");
  assert.match(
    result.rejection.message,
    /requires a caller-authorized idle or sleep runtime phase/,
  );
});

test("offline consolidation request-to-plan gate returns structured batch-limit rejections", () => {
  const result = requestOfflineConsolidationBatchPlan({
    requestId: "batch-limit-gate-request",
    agentId: "agent-batch-limit-gate",
    runtimePhase: createRuntimePhase("idle"),
    batchLimit: {
      ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
      limitId: "unexpected-batch-profile",
    },
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.safeToExecute, false);
  assert.equal(result.plan, null);
  assert.equal(result.request.requestId, "batch-limit-gate-request");
  assert.equal(result.rejection.stage, "batch-limit-validation");
  assert.equal(result.rejection.reasonCode, "invalid-batch-limit");
  assert.equal(result.rejection.blockedReason, null);
  assert.equal(result.rejection.requestId, "batch-limit-gate-request");
  assert.equal(result.rejection.agentId, "agent-batch-limit-gate");
  assert.equal(
    result.rejection.planId,
    "offline-consolidation:batch-limit-gate-request",
  );
  assert.equal(result.rejection.runtimeWindow, "idle");
  assert.match(
    result.rejection.message,
    /batchLimit\.limitId must match request\.batchProfileId/,
  );
});

test("offline consolidation batch-plan validation accepts builder outputs and publishes the safe stage operation catalog", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "validated-output-request",
    agentId: "agent-validated-output",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    teamIdle: true,
    planId: "validated-output-plan",
  });

  assert.deepEqual(OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS, {
    "young-generation-triage": "offline-consolidation-young-generation-triage",
    "young-generation-promotion":
      "offline-consolidation-young-generation-promotion",
    "old-generation-reinforcement":
      "offline-consolidation-old-generation-reinforcement",
    "archived-memory-review": "offline-consolidation-archived-memory-review",
    "learned-trait-preservation":
      "offline-consolidation-learned-trait-preservation",
  });
  assert.equal(validateOfflineConsolidationBatchPlan(plan), true);
});

test("offline consolidation batch-plan validation rejects plans with incomplete metadata", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "missing-metadata-request",
    agentId: "agent-missing-metadata",
    presetId: DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID,
    runtimePhase: createRuntimePhase("idle"),
    planId: "missing-metadata-plan",
  });

  assert.throws(
    () =>
      validateOfflineConsolidationBatchPlan({
        ...plan,
        metadata: Object.fromEntries(
          Object.entries(plan.metadata).filter(
            ([fieldName]) => fieldName !== "authorization",
          ),
        ),
      }),
    /offline consolidation batch plan metadata must include authorization/,
  );

  assert.throws(
    () =>
      validateOfflineConsolidationBatchPlan({
        ...plan,
        workUnits: plan.workUnits.map((workUnit, index) =>
          index === 0
            ? {
                ...workUnit,
                metadata: Object.fromEntries(
                  Object.entries(workUnit.metadata).filter(
                    ([fieldName]) => fieldName !== "stageId",
                  ),
                ),
              }
            : workUnit,
        ),
      }),
    /workUnits\[0\]\.metadata must include stageId/,
  );
});

test("offline consolidation batch-plan validation rejects unauthorized runtime windows in output plans", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "unauthorized-window-request",
    agentId: "agent-unauthorized-window",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    planId: "unauthorized-window-plan",
  });

  assert.throws(
    () =>
      validateOfflineConsolidationBatchPlan({
        ...plan,
        metadata: {
          ...plan.metadata,
          runtimePhase: createRuntimePhase("active"),
          authorization: {
            ...plan.metadata.authorization,
            runtimePhase: createRuntimePhase("active"),
          },
        },
      }),
    /authorization\.runtimePhase must use runtimePhase sleep for sleep windows/,
  );
});

test("offline consolidation batch-plan validation rejects unsafe consolidation operations", () => {
  const plan = buildOfflineConsolidationBatchPlan({
    requestId: "unsafe-operation-request",
    agentId: "agent-unsafe-operation",
    presetId: "sleep-extended-maintenance",
    runtimePhase: createRuntimePhase("sleep"),
    planId: "unsafe-operation-plan",
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
