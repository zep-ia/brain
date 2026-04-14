# Offline Consolidation Plan Builder

This library now exposes a caller-facing request and preset layer above the
shared `OfflineBatchPlan` primitives, plus a concrete builder that translates
an authorized request into shared batch-plan work units.

## Intent

Use the plan-builder contract when a caller wants to express:

- which offline consolidation window is being targeted: `idle` or `sleep`
- which reusable consolidation preset should shape the request
- whether team idle is present as a coordination signal
- which agent-scoped memories should be prioritized

Do not use this layer to describe low-level batch execution slices, capacity
limits, overwrite targets, or executor wiring. Those remain the job of
`createOfflineBatchLimit()`, `createOfflineBatchWorkUnit()`,
`createOfflineBatchPlan()`, `buildOfflineConsolidationBatchPlan()`, and the
executor helpers.

## Contract surface

`createOfflineConsolidationPlanBuilderPreset()` defines one reusable planning
profile. Each preset is intentionally high-level and carries:

- `runtimeWindow`: `idle` or `sleep`
- `intensity`: `conservative`, `balanced`, or `extended`
- `generationCoverage`: which memory generations the planner should consider
- `candidateSources`: high-level memory collections to scan
- `planningGoals`: high-level consolidation goals such as promotion,
  reinforcement, archival, and learned-trait preservation

Every preset also hard-codes the safety model for this iteration:

- `authorizationModel: "runtime-phase-only"`
- `heuristicsPolicy: "suggest-only"`
- `teamCoordinationPolicy: "batch-only"`
- `scope: "agent-scoped"`
- `immutableIdentityPolicy: "runtime-invariants-only"`
- `learnedTraitPolicy: "long-term-memory-only"`
- `allowIdentityPromotion: false`
- `outputPlanApi: "offline-batch-plan"`
- `workingLoopIsolation: "offline-decoupled"`

`createOfflineConsolidationPlanBuilderPresetCatalog()` groups presets into a
lookup catalog with a `defaultPresetId`.

`createOfflineConsolidationPlanBuilderRequest()` resolves one caller request
against that catalog and produces a normalized plan-builder request that is
still data-only. It carries:

- the resolved preset and preset catalog id
- the caller-supplied runtime phase and inactivity suggestion
- `teamIdle` plus the derived coordination hint
- agent-scoped `priorityMemoryIds`

`OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA` publishes the normalized
request shape and the safety constants enforced by the builder. The request
layer now fails closed before plan construction when callers try to:

- pass unsupported request fields or shared batch-plan fields
- override safety constants such as `authorizationModel`,
  `heuristicsPolicy`, `teamCoordinationPolicy`, or
  `allowIdentityPromotion`
- provide mismatched normalized fields such as `runtimeWindow`,
  `batchProfileId`, `presetVersion`, or a manual `coordinationHint`
- omit required identifiers such as `requestId` or `agentId`

`buildOfflineConsolidationBatchPlan()` consumes either one raw request input or
one normalized request and materializes a concrete `OfflineBatchPlan`. The
builder:

- rechecks caller-controlled runtime authorization before creating work units
- requires the runtime phase to match the targeted window:
  `idle` plans require `idle`, `rest`, or `break`; `sleep` plans require
  `sleep`
- translates the high-level goals into ordered agent-scoped work units such as
  `young-generation-triage`, `young-generation-promotion`,
  `old-generation-reinforcement`, `archived-memory-review`, and the
  learned-trait-preservation fallback stage
- preserves the B200-style architecture contract by resolving a matching
  `OfflineBatchLimit` profile and emitting a pure `OfflineBatchPlan`
- validates the final plan output before returning it, so only plans with
  complete planner metadata, caller-authorized `idle` or `sleep` runtime
  windows, and safe stage-specific consolidation operations are considered
  valid outputs

`requestOfflineConsolidationBatchPlan()` is the caller-facing validation gate
for the full request-to-plan boundary. It never returns an unvalidated plan:

- on success it returns `{ status: "validated", request, plan }`
- on failure it returns `{ status: "rejected", request, rejection }`
- rejection metadata reports the failing gate stage such as
  `request-validation`, `runtime-authorization`, or
  `batch-limit-validation`, plus a stable `reasonCode` and message

Use that API when a runtime owner needs one safe handoff result before any
offline execution wiring is considered. Keep
`buildOfflineConsolidationBatchPlan()` for strict internal flows that should
throw immediately on invalid inputs.

`validateOfflineConsolidationBatchPlan()` exposes that same fail-closed check
for any later consumer that wants to verify a stored or transformed plan before
execution. The safe operation catalog is published as
`OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS`.

## Gate outcome examples

The request-to-plan boundary has three caller-visible paths. Use them
intentionally:

### Rejected request

Use `requestOfflineConsolidationBatchPlan()` when the caller needs a structured
rejection instead of an exception.

```js
import { requestOfflineConsolidationBatchPlan } from "@zep/brain";

const result = requestOfflineConsolidationBatchPlan({
  requestId: "invalid-request",
  agentId: "agent-007",
  executionMode: "inline",
});

if (result.status === "rejected") {
  console.log(result.rejection.stage); // "request-validation"
  console.log(result.rejection.reasonCode); // "invalid-request"
  console.log(result.plan); // null
}
```

### Invalid plan rejection

Fresh builder outputs are already validated before they are returned. Run
`validateOfflineConsolidationBatchPlan()` when a plan has been stored,
transported, or transformed and must be rechecked before execution.

```js
import {
  buildOfflineConsolidationBatchPlan,
  createRuntimePhase,
  validateOfflineConsolidationBatchPlan,
} from "@zep/brain";

const plan = buildOfflineConsolidationBatchPlan({
  requestId: "plan-to-recheck",
  agentId: "agent-007",
  runtimePhase: createRuntimePhase("idle"),
});

const mutatedPlan = {
  ...plan,
  workUnits: plan.workUnits.map((workUnit, index) =>
    index === 0
      ? {
          ...workUnit,
          operation: "offline-consolidation-identity-merge",
        }
      : workUnit,
  ),
};

validateOfflineConsolidationBatchPlan(mutatedPlan);
// throws because the operation no longer matches the safe stage contract
```

### Validated plan generation

Authorized `idle` or `sleep` requests return one normalized request and one
validated agent-scoped plan.

```js
import {
  createRuntimePhase,
  requestOfflineConsolidationBatchPlan,
} from "@zep/brain";

const result = requestOfflineConsolidationBatchPlan({
  requestId: "validated-request",
  agentId: "agent-007",
  presetId: "sleep-extended-maintenance",
  runtimePhase: createRuntimePhase("sleep"),
  teamIdle: true,
  priorityMemoryIds: ["stm-42", "ltm-7"],
});

if (result.status === "validated") {
  console.log(result.request.runtimeWindow); // "sleep"
  console.log(result.plan.metadata.authorization.eligible); // true
  console.log(result.plan.metadata.stageIds);
}
```

## Default preset catalog

`DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG` ships with three
presets:

- `idle-young-triage`: conservative young-generation cleanup for short idle
  windows
- `idle-balanced-consolidation`: balanced idle-window planning across young and
  old generations
- `sleep-extended-maintenance`: deepest sleep-window maintenance sweep,
  including archival review

All default presets reference the architecture-level
`b200-style-offline-batch-limit` profile by id only. They do not embed the
shared `OfflineBatchLimit` type.

## Preset-to-plan mapping

Preset selection stays declarative. `buildOfflineConsolidationBatchPlan()`
turns a preset into ordered work units by filtering the preset's
`candidateSources` and `planningGoals` through a fixed safe stage catalog.

### Stage translation rules

| Stage id | Emitted when | Safe operation | Notes |
| --- | --- | --- | --- |
| `young-generation-triage` | `generationCoverage` includes `young` and the filtered goals include `mask-stale-young-memory` or `archive-stale-memory` | `offline-consolidation-young-generation-triage` | Uses `young-working-memory` and `young-short-term-memory` when present. Adds the `archived-memory:stale-young-memory` overwrite target when archival is requested. |
| `young-generation-promotion` | `generationCoverage` includes `young` and the goals include `promote-stable-young-memory` | `offline-consolidation-young-generation-promotion` | Carries `preserve-learned-traits` alongside promotion when that goal is also requested. |
| `old-generation-reinforcement` | `generationCoverage` includes `old` and the goals include `reinforce-old-memory` | `offline-consolidation-old-generation-reinforcement` | Scans only `old-long-term-memory`. Also carries `preserve-learned-traits` when requested. |
| `archived-memory-review` | `generationCoverage` includes `old` and the goals include `review-superseded-memory` | `offline-consolidation-archived-memory-review` | Uses `old-archived-memory` plus `old-long-term-memory` when available so superseded durable records can be reviewed offline. |
| `learned-trait-preservation` | `preserve-learned-traits` is requested but neither promotion nor reinforcement produced a stage | `offline-consolidation-learned-trait-preservation` | Fallback stage that keeps learned traits in long-term memory without promoting them into immutable identity. |

### Default preset matrix

| Preset id | Runtime window | Intensity | Candidate sources | Planning goals | Emitted stage ids |
| --- | --- | --- | --- | --- | --- |
| `idle-young-triage` | `idle` | `conservative` | `young-working-memory`, `young-short-term-memory` | `mask-stale-young-memory`, `promote-stable-young-memory`, `preserve-learned-traits` | `young-generation-triage`, `young-generation-promotion` |
| `idle-balanced-consolidation` | `idle` | `balanced` | `young-working-memory`, `young-short-term-memory`, `old-long-term-memory` | `mask-stale-young-memory`, `archive-stale-memory`, `promote-stable-young-memory`, `reinforce-old-memory`, `preserve-learned-traits` | `young-generation-triage`, `young-generation-promotion`, `old-generation-reinforcement` |
| `sleep-extended-maintenance` | `sleep` | `extended` | `young-working-memory`, `young-short-term-memory`, `old-long-term-memory`, `old-archived-memory` | `mask-stale-young-memory`, `archive-stale-memory`, `promote-stable-young-memory`, `reinforce-old-memory`, `review-superseded-memory`, `preserve-learned-traits` | `young-generation-triage`, `young-generation-promotion`, `old-generation-reinforcement`, `archived-memory-review` |

The runtime phase still gates whether that translation is allowed to execute:

- `idle` presets require a caller-authorized runtime phase of `idle`, `rest`,
  or `break`
- `sleep` presets require a caller-authorized runtime phase of `sleep`
- `teamIdle` changes only the coordination hint (`independent` vs
  `team-idle`); it never changes which stages a preset can emit

## Common validation failure cases

Use `requestOfflineConsolidationBatchPlan()` at the caller boundary when you
want structured rejections. Use `buildOfflineConsolidationBatchPlan()` and
`validateOfflineConsolidationBatchPlan()` inside stricter internal flows where
exceptions are appropriate.

| Where the failure appears | Common mistake | Result |
| --- | --- | --- |
| `createOfflineConsolidationPlanBuilderRequest()` or `requestOfflineConsolidationBatchPlan()` | Passing unsupported request fields such as `executionMode`, or leaking batch-plan fields such as `maxWorkUnitsPerBatch` | Fails closed during `request-validation`. Gate responses use `reasonCode: "invalid-request"`. |
| `createOfflineConsolidationPlanBuilderRequest()` | Trying to override safety constants such as `authorizationModel: "scheduler-controlled"` or `allowIdentityPromotion: true` | Throws immediately because presets and requests must remain `runtime-phase-only`, `suggest-only`, `batch-only`, and identity-safe. |
| `createOfflineConsolidationPlanBuilderRequest()` | Supplying mismatched normalization fields such as `runtimeWindow: "idle"` for `sleep-extended-maintenance`, or forcing `coordinationHint: "independent"` while `teamIdle: true` | Throws immediately because normalized request fields must match the resolved preset and derived coordination state. |
| `requestOfflineConsolidationBatchPlan()` or `buildOfflineConsolidationBatchPlan()` | Using `runtimePhase: active`, or using `runtimePhase: idle` with a `sleep` preset | Rejected or thrown at runtime authorization. Gate responses use `stage: "runtime-authorization"` and the blocking idle-window reason; raw builders throw a runtime-window mismatch error. |
| `requestOfflineConsolidationBatchPlan()` or `buildOfflineConsolidationBatchPlan()` | Passing a `batchLimit` whose `limitId` does not match `request.batchProfileId`, or whose `targetProfile` is not `b200-style` | Rejected or thrown during batch-limit validation. Gate responses use `stage: "batch-limit-validation"` and `reasonCode: "invalid-batch-limit"`. |
| `validateOfflineConsolidationBatchPlan()` | Removing required metadata such as `plan.metadata.authorization` or `workUnits[n].metadata.stageId` after storage or transport | Throws because validated plans must stay metadata-complete and stage-indexed. |
| `validateOfflineConsolidationBatchPlan()` | Mutating a work unit to use an unsafe operation such as `offline-consolidation-identity-merge` | Throws because every stage id is pinned to one safe operation in `OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS`. |

When debugging a rejection, inspect these fields first:

- `result.rejection.stage` to find the failing gate
- `result.rejection.reasonCode` for the stable category
- `result.rejection.blockedReason` when runtime authorization was denied
- the thrown `TypeError` message when using the raw builder or validator APIs

## Extending the preset catalog

### Preset-only extension path

If a new consolidation preset can be expressed with the existing runtime
windows, candidate sources, planning goals, and safe stages, no planner code
changes are required. Extend the catalog only:

1. Define a preset with `createOfflineConsolidationPlanBuilderPreset()` or as a
   plain preset object inside `createOfflineConsolidationPlanBuilderPresetCatalog()`.
2. Choose only supported enum values for `runtimeWindow`, `intensity`,
   `generationCoverage`, `candidateSources`, and `planningGoals`.
3. Keep the preset declarative. Do not add executor logic or low-level
   batch-plan fields such as `workUnits`, `limit`, or `overwriteTargets`.
4. Register the preset in a custom catalog, set `defaultPresetId` if needed,
   and pass that catalog through `presetCatalog` when creating requests.
5. Build a plan once and verify the emitted `metadata.stageIds` and
   `workUnits[].operation` values match the intended policy.

```js
import {
  createOfflineConsolidationPlanBuilderPresetCatalog,
  createRuntimePhase,
  requestOfflineConsolidationBatchPlan,
} from "@zep/brain";

const presetCatalog = createOfflineConsolidationPlanBuilderPresetCatalog({
  catalogId: "custom-offline-consolidation-presets",
  defaultPresetId: "sleep-focused",
  presets: [
    {
      presetId: "sleep-focused",
      displayName: "Sleep Focused",
      description: "Custom sleep preset for reinforcement-heavy maintenance.",
      runtimeWindow: "sleep",
      intensity: "extended",
      generationCoverage: ["young", "old"],
      candidateSources: ["young-short-term-memory", "old-long-term-memory"],
      planningGoals: [
        "promote-stable-young-memory",
        "reinforce-old-memory",
        "preserve-learned-traits",
      ],
    },
  ],
});

const result = requestOfflineConsolidationBatchPlan({
  requestId: "custom-preset-request",
  agentId: "agent-007",
  presetCatalog,
  presetId: "sleep-focused",
  runtimePhase: createRuntimePhase("sleep"),
});

if (result.status === "validated") {
  console.log(result.plan.metadata.stageIds);
  // ["young-generation-promotion", "old-generation-reinforcement"]
}
```

### Planner-surface extension points

If a future preset needs a brand-new runtime window, candidate source,
planning goal, or stage, extend the planner surface deliberately instead of
trying to smuggle new values through a custom catalog. The required code touch
points are:

- `OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS`,
  `OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES`, and
  `OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS` for the public enum
  contracts
- `createConcreteBatchPlanWorkUnits()` for the preset-to-stage translation
  logic
- `OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS` and
  `OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS` for validator-visible safe
  execution contracts
- `validateOfflineConsolidationBatchPlan()` for output-plan enforcement
- the preset mapping and rejection tests in
  `test/offline-consolidation-plan-builder.test.js` and
  `test/offline-consolidation-plan-builder-gate-paths.test.js`

That split is intentional:

- new presets that only recombine existing policy knobs are configuration
- new stages or new authority semantics are architecture changes and must be
  implemented, validated, and tested as code

## Future integration: zepia idle and team idle signals

Later runtime integrations may feed zepia idle signals, team-idle snapshots,
or similar coordination telemetry into this request layer before a plan is
built. That integration is intentionally limited to suggestion, batching, and
eligibility-precheck roles.

Safe future uses include:

- asking whether an agent should be considered for offline-plan evaluation at
  all
- selecting a preset such as `idle-young-triage` instead of a deeper
  `sleep-extended-maintenance` run
- grouping already-authorized agents into the same infrastructure batch for
  B200-style execution planning
- attaching advisory metadata that explains why a request was queued, deferred,
  or skipped

Those signals still do not own consolidation authority:

- a zepia idle signal may suggest that an agent looks inactive, but it must not
  mutate `runtimePhase`, create an authorized request by itself, or bypass the
  caller that owns runtime state
- team idle remains a coordination and batching input only; it may help decide
  which independently authorized agents are worth evaluating together, but it
  must not turn team-level idleness into a shared consolidation window
- each agent must still pass its own runtime-phase gate, preserve its own
  immutable identity boundary, and emit its own agent-scoped work units

In practice, a future integration should treat zepia idle and team idle as
prefilters ahead of `requestOfflineConsolidationBatchPlan()`, not as a
replacement for the caller-controlled phase change required to authorize
offline consolidation.

## Separation from batch-plan API

The plan-builder contract rejects low-level batch-plan fields such as:

- `workUnits`
- `limit`
- `capacityUsage`
- `overwriteTargets`
- `maxWorkUnitsPerBatch`

That boundary is deliberate:

- the plan-builder layer captures caller intent
- `buildOfflineConsolidationBatchPlan()` captures one authorized translation
  from that intent into shared batch-plan API calls
- the batch-plan layer captures reusable ordered offline work units
- the executor layer remains the only place where dispatch is attempted

## Example

```js
import {
  requestOfflineConsolidationBatchPlan,
  createRuntimePhase,
} from "@zep/brain";

const planResult = requestOfflineConsolidationBatchPlan({
  requestId: "consolidation-request-1",
  agentId: "agent-007",
  presetId: "sleep-extended-maintenance",
  runtimePhase: createRuntimePhase("sleep"),
  teamIdle: true,
  priorityMemoryIds: ["stm-42", "ltm-7"],
  metadata: {
    initiatedBy: "runtime-phase-change",
  },
});

if (planResult.status === "rejected") {
  console.error(planResult.rejection.stage);
  console.error(planResult.rejection.reasonCode);
  console.error(planResult.rejection.message);
} else {
  console.log(planResult.request.preset.displayName);
  console.log(planResult.request.runtimeWindow);
  console.log(planResult.request.coordinationHint);

  console.log(planResult.plan.orderedWorkUnitIds);
  console.log(planResult.plan.limit.targetProfile);
}
```
