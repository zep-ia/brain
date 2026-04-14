# Offline Batch Planning

The batch-planning surface in `@zep/brain` is intentionally data-only:

- `createOfflineConsolidationPlanBuilderPreset()`,
  `createOfflineConsolidationPlanBuilderPresetCatalog()`, and
  `createOfflineConsolidationPlanBuilderRequest()` sit one layer above the
  shared batch-plan API. They normalize caller intent and preset selection but
  intentionally do not expose `OfflineBatchPlan` fields such as `workUnits`,
  `limit`, or capacity accounting.
- `buildOfflineConsolidationBatchPlan()` is the bridge between those
  high-level request objects and the shared batch-plan API. It rechecks
  caller-controlled runtime authorization, translates the supported planning
  stages into ordered agent-scoped work units, and emits one concrete
  `OfflineBatchPlan`.
- `validateOfflineConsolidationBatchPlan()` is the planning-layer fail-closed
  validator for those outputs. It rejects any plan that is missing required
  planner metadata, targets a non-authorized execution window, or uses a stage
  operation or overwrite set outside the supported safe consolidation catalog.
- `createOfflineBatchLimit()` defines reusable capacity bounds and safety
  invariants for offline work.
- `createOfflineBatchWorkUnit()` describes one agent-scoped offline unit of
  consolidation work plus its ordering and overwrite footprint.
- `createOfflineBatchPlan()` sorts work units, aggregates capacity usage, and
  reports limit violations without choosing or running an executor.

The executor path stays separate from plan construction:

- `scheduleOfflineBatchExecution()` consumes one batch plan and repacks its
  ordered work units into execution slices that each remain within the declared
  limit profile.
- `executeOfflineBatchPlan()` runs those slices through a caller-supplied
  dispatcher, rechecking runtime authorization for each work unit immediately
  before dispatch.

## Batch-plan syntax

`createOfflineBatchPlan()` accepts one plain data object with this structure:

```text
OfflineBatchPlanInput
  planId: string
  coordinationSignal?: string | null
  limit?: OfflineBatchLimitInput | OfflineBatchLimit | null
  workUnits?: OfflineBatchWorkUnitInput[] | OfflineBatchWorkUnit[]
  metadata?: Record<string, unknown> | null
```

The plan input is the only caller-authored syntax for a concrete batch plan.
`createOfflineBatchPlan()` then normalizes it into an immutable
`OfflineBatchPlan` that adds the derived accounting fields described below.

### Supported top-level fields

| Field | Required | Description |
| --- | --- | --- |
| `planId` | yes | Stable identifier for the batch plan. Must be a non-empty string. |
| `coordinationSignal` | no | Optional grouping hint such as `independent` or `team-idle`. If omitted, the plan infers one from the work units. |
| `limit` | no | Optional reusable limit profile. Accepts either a raw `OfflineBatchLimitInput` object or an already normalized `OfflineBatchLimit`. If omitted, the plan uses `DEFAULT_B200_OFFLINE_BATCH_LIMIT`. |
| `workUnits` | no | Ordered agent-scoped offline units. Each entry is normalized through `createOfflineBatchWorkUnit()`. |
| `metadata` | no | Optional caller metadata. Must stay data-only and must not embed executor logic. |

### Supported `limit` fields

`limit` uses the `OfflineBatchLimitInput` shape below:

| Field | Required | Description |
| --- | --- | --- |
| `limitId` | no | Limit profile identifier. Defaults to `offline-batch-limit`. |
| `targetProfile` or `profile` | no | Human-readable limit profile name such as `b200-style`. |
| `acceleratorClass` | no | Infrastructure class label for planning and reporting. |
| `orderingStrategy` | no | One of `priority-descending-then-sequence` or `sequence-only`. |
| `maxAgentsPerBatch` | no | Positive integer or `null`. Caps distinct agents in one plan. |
| `maxWorkUnitsPerBatch` | no | Positive integer or `null`. Caps total work units in one plan. |
| `maxOverwriteTargetsPerBatch` | no | Positive integer or `null`. Caps the aggregate overwrite footprint. |
| `maxOverwriteTargetsPerWorkUnit` | no | Positive integer or `null`. Caps the overwrite footprint of one work unit. |
| `maxIdentityScopesPerBatch` | no | Positive integer or `null`. Caps distinct identity scopes. |
| `requiresRuntimeAuthorization` | no | Must remain `true`. Batch plans never self-authorize execution. |
| `heuristicsAuthorizeExecution` | no | Must remain `false`. Heuristics may suggest windows but never force work. |
| `teamIdleCoordinatesOnly` | no | Must remain `true`. Team idle is batching-only, not shared authority. |
| `identityIsolationMode` | no | Must remain `agent-scoped`. Identity boundaries are never merged. |
| `requiresIndependentWrites` | no | Must remain `true`. Each agent writes independently. |
| `executionMode` | no | Must remain `offline-plan-only`. The plan stays data-only. |
| `executorBinding` | no | Must remain `external`. The framework does not embed executor logic. |
| `liveWorkingLoopCoupling` | no | Must remain `offline-decoupled`. Consolidation stays outside the live loop. |
| `numericThroughputBenchmarkRequired` | no | Must remain `false` in this iteration. |
| `notes` | no | Optional free-form note about the limit profile. |

### Supported `workUnits[]` fields

Each `workUnits[]` entry uses the `OfflineBatchWorkUnitInput` shape below:

| Field | Required | Description |
| --- | --- | --- |
| `workUnitId` or `unitId` | yes | Stable work-unit identifier. One of these aliases must be provided. |
| `batchId` | no | Optional parent batch identifier when the caller wants to preserve external lineage. |
| `agentId` | yes | Agent-scoped identity owner for the work unit. |
| `operation` | no | Offline operation label. Defaults to `offline-consolidation`. |
| `coordinationSignal` | no | Per-work-unit grouping hint. Defaults to `independent`. |
| `runtimePhase` | no | Caller-controlled runtime phase for authorization checks, for example `idle`, `rest`, `break`, or `sleep`. |
| `identityScopeKey` | no | Explicit identity scope. Defaults to `agent:{agentId}`. |
| `overwriteNamespace` | no | Explicit overwrite namespace. Defaults to `agent:{agentId}`. |
| `overwriteTargets` | no | Array of overwrite targets. Each entry may be a string, number, bigint, or object with a target id and optional scope. |
| `order.priority` or `priority` | no | Non-negative integer priority. Higher values are scheduled first. Defaults to `0`. |
| `order.sequence` or `sequence` | no | Non-negative integer tie-breaker sequence. Defaults to the work-unit index during plan creation. |
| `order.sortKey` or `sortKey` | no | Optional stable sort suffix. Defaults to `{agentId}:{workUnitId}`. |
| `metadata` | no | Optional data-only metadata. Executor functions are rejected. |

### Normalized output fields

The returned `OfflineBatchPlan` preserves the caller-authored fields above and
adds these derived fields:

- `executionMode: "offline-plan-only"`
- `executorBinding: "external"`
- `liveWorkingLoopCoupling: "offline-decoupled"`
- `workUnitCount`
- `orderedWorkUnitIds`
- `agentIds`
- `agentCount`
- `capacityUsage`
- `capacityViolations`
- `withinCapacity`
- `requiresRuntimeAuthorization: true`
- `heuristicsAuthorizeExecution: false`

### Minimal valid example

This is the smallest non-empty batch-plan input that still declares one
agent-scoped offline unit explicitly:

```js
import { createOfflineBatchPlan } from "@zep/brain";

const plan = createOfflineBatchPlan({
  planId: "offline-batch-minimal",
  workUnits: [
    {
      workUnitId: "wu-1",
      agentId: "agent-007",
      runtimePhase: "idle",
    },
  ],
});
```

The normalized `plan` will fill in the default B200-style limit profile, the
default `offline-consolidation` operation, the agent-scoped identity and
overwrite namespaces, and the derived capacity fields.

### Expression helper syntax

The library also exports `tokenizeBatchPlanExpression()`,
`parseBatchPlanExpression()`, and `normalizeBatchPlanExpression()` for compact
batch-planning expressions. Their grammar is:

```text
comparison := field ":" value
expression := comparison
           | "!" expression
           | expression "&&" expression
           | expression "||" expression
           | "(" expression ")"
```

The parser is field-agnostic, but the framework's current batch-planning and
execution helpers use comparisons such as `presetId`, `runtimePhase`,
`coordinationSignal`, `agentId`, `operation`, and `overwriteTarget`.

## Safety model

- Runtime authority still comes from caller-supplied runtime phases. Batch plans
  do not authorize work on their own. `buildOfflineConsolidationBatchPlan()`
  only materializes a concrete plan when that runtime phase already matches the
  targeted `idle` or `sleep` window, and
  `validateOfflineConsolidationBatchPlan()` rechecks that guarantee on the
  emitted plan object itself.
- Team idle remains coordination-only. A batch may group many agents, but each
  work unit keeps its own `agentId`, `identityScopeKey`, and overwrite
  namespace.
- The plan surface is decoupled from the live loop. Every limit and work unit
  carries `executionMode: "offline-plan-only"`,
  `executorBinding: "external"`, and
  `liveWorkingLoopCoupling: "offline-decoupled"`.
- The executor path keeps the same boundary. Scheduled execution reports
  `executionMode: "offline-external-dispatch"` and
  `executorBinding: "caller-supplied"` so the caller still owns the actual
  offline worker implementation.
- Runtime inactivity heuristics may be attached to execution for audit, but they
  never authorize dispatch. The executor only trusts caller-supplied runtime
  phases from the work unit itself or from an execution-time resolver.

## Execution scheduling

`scheduleOfflineBatchExecution()` uses `ordered-slice-packing`:

- work units stay in the same global order as the source `OfflineBatchPlan`
- a new slice starts as soon as adding the next work unit would exceed one of
  the declared per-batch limits
- each slice materializes its own `batchPlan`, so downstream workers can inspect
  the exact limit-safe subset they are about to run

The scheduler fails closed before dispatch when a work unit cannot be run
safely under any slice:

- duplicate `workUnitId`
- shared `identityScopeKey` across different agents
- shared `overwriteNamespace` across different agents
- `overwriteTargetCount` above `maxOverwriteTargetsPerWorkUnit`

When one of those conditions appears, the returned schedule sets
`executable: false`, exposes `blockedWorkUnits`, and `executeOfflineBatchPlan()`
returns `status: "blocked-by-schedule"` without calling the dispatcher.

## Execution-time authorization

`executeOfflineBatchPlan()` supports two caller-controlled authorization modes:

- plan-runtime-phase: reuse the `runtimePhase` already stored on each work unit
- execution-runtime-phase: provide `resolveRuntimePhase()` and let the executor
  fetch a fresh caller-controlled phase right before dispatch

Both modes keep authority outside scheduler heuristics and outside team-idle
coordination. The executor calls `evaluateIdleWindowAuthorization()` for each
work unit and only dispatches units whose runtime phase is still one of
`idle`, `rest`, `break`, or `sleep`.

## B200-style profile

`DEFAULT_B200_OFFLINE_BATCH_LIMIT` is the architecture-level default profile for
this iteration:

- `targetProfile: "b200-style"`
- `acceleratorClass: "b200-style"`
- no numeric throughput benchmark requirement yet
- optional numeric capacity bounds that callers can tighten later

This keeps the library ready for large-batch infrastructure planning without
hard-coding executor behavior or premature throughput claims.

## Team-idle integration

`planTeamIdleConsolidationBatch()` now emits:

- `defaultBatchLimit`: the normalized reusable limit profile applied to every
  emitted batch
- `batches[n].batchPlan`: a pure offline batch plan with ordered work units and
  capacity accounting

Callers can hand `batches[n].batchPlan` straight to
`scheduleOfflineBatchExecution()` or `executeOfflineBatchPlan()` while
preserving agent-scoped isolation. Team idle still acts only as a grouping
signal: every dispatched work unit is re-authorized independently.

## Shared test harness

Reusable offline-flow fixtures live at:

- `test-support/offline-flow-fixtures.js`
- `test-support/offline-flow-harness.js`

They provide one consistent test setup for:

- populated young and old memory generations
- caller-controlled `idle` and `sleep` runtime windows
- heuristic-only false-positive idle suggestions that stay non-authoritative
- a tightened B200-style limit profile that forces realistic slice planning in tests

`test/offline-flow-harness.test.js` exercises the shared harness against idle,
sleep, and team-idle batch paths so future consolidation work can extend the
same offline contract instead of rebuilding bespoke fixtures.

## End-to-end walkthroughs

The flows below mirror the shared harness and its tightened B200-style limit
profile so slice packing is visible during documentation and test review:

```js
import {
  DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  createOfflineBatchLimit,
} from "@zep/brain";

const batchLimit = createOfflineBatchLimit({
  ...DEFAULT_B200_OFFLINE_BATCH_LIMIT,
  maxAgentsPerBatch: 1,
  maxWorkUnitsPerBatch: 2,
  maxOverwriteTargetsPerBatch: 4,
  maxOverwriteTargetsPerWorkUnit: 3,
  maxIdentityScopesPerBatch: 1,
});
```

### 1. Authorized idle window

Create one caller-authorized idle plan, then schedule and execute it through the
standard offline path:

```js
import {
  createRuntimePhase,
  executeOfflineBatchPlan,
  requestOfflineConsolidationBatchPlan,
  scheduleOfflineBatchExecution,
} from "@zep/brain";

const requestResult = requestOfflineConsolidationBatchPlan({
  requestId: "idle-flow",
  agentId: "agent-007",
  presetId: "idle-balanced-consolidation",
  runtimePhase: createRuntimePhase("idle", {
    authority: "caller",
  }),
  batchLimit,
});

if (requestResult.status !== "validated") {
  throw new Error("expected a validated idle plan");
}

const schedule = scheduleOfflineBatchExecution(requestResult.plan);
const execution = await executeOfflineBatchPlan(requestResult.plan, {
  async dispatchWorkUnit(workUnit) {
    return {
      stageId: workUnit.metadata?.stageId ?? null,
    };
  },
});
```

Expected outcome:

- `requestResult.plan.metadata.runtimePhase.value` is `idle`.
- `requestResult.plan.metadata.stageIds` resolves to
  `young-generation-triage`, `young-generation-promotion`, and
  `old-generation-reinforcement`.
- `schedule.executable` stays `true` and `schedule.sliceCount` becomes `2`,
  packing triage first and promotion plus reinforcement second.
- `execution.status` is `completed` because every work unit still runs inside a
  caller-authorized idle window.

### 2. Authorized sleep window

Use the deeper sleep preset with the same B200-style limit:

```js
const requestResult = requestOfflineConsolidationBatchPlan({
  requestId: "sleep-flow",
  agentId: "agent-007",
  presetId: "sleep-extended-maintenance",
  runtimePhase: createRuntimePhase("sleep", {
    authority: "caller",
  }),
  teamIdle: true,
  batchLimit,
});

if (requestResult.status !== "validated") {
  throw new Error("expected a validated sleep plan");
}

const schedule = scheduleOfflineBatchExecution(requestResult.plan);
const execution = await executeOfflineBatchPlan(requestResult.plan, {
  maxConcurrentWorkUnits: 2,
  async dispatchWorkUnit(workUnit) {
    return {
      stageId: workUnit.metadata?.stageId ?? null,
    };
  },
});
```

Expected outcome:

- `requestResult.plan.metadata.stageIds` adds `archived-memory-review` after
  the three idle-window stages.
- `schedule.sliceCount` becomes `3`, producing one triage slice, one promotion
  plus reinforcement slice, and one archived-review slice.
- The archived-review slice starts only after the first two slices finish, so
  deeper archival work stays behind the lighter promotion and reinforcement
  stages.
- `execution.status` is `completed` and every result reports
  `runtimePhase: "sleep"`.

### 3. Runtime resumes before the next slice

A validated plan does not keep authority alive on its own. Re-resolve runtime
phase immediately before dispatch when the runtime owner wants a fresh guard:

```js
const execution = await executeOfflineBatchPlan(requestResult.plan, {
  resolveRuntimePhase({ workUnit }) {
    return workUnit.metadata?.stageId === "young-generation-triage"
      ? "sleep"
      : "active";
  },
  async dispatchWorkUnit(workUnit) {
    return {
      stageId: workUnit.metadata?.stageId ?? null,
    };
  },
});
```

Expected outcome:

- Plan creation still succeeds because the original request was
  caller-authorized for `sleep`.
- Only `young-generation-triage` executes.
- `young-generation-promotion`, `old-generation-reinforcement`, and
  `archived-memory-review` are returned as blocked results with
  `blockedReason: "runtime-phase-not-idle-window"`.
- `execution.status` becomes `completed-with-blocked-work-units` instead of
  forcing offline writes after runtime work resumes.

Heuristics-only and scheduler-inferred windows are blocked even earlier. The
shared harness keeps `activeFalsePositive` and `schedulerSleep` requests at
`status: "rejected"` with no plan, schedule, or dispatch.

For many-agent B200-style runs, call `planTeamIdleConsolidationBatch()` first
and then pass each emitted `batches[n].batchPlan` through the same
`scheduleOfflineBatchExecution()` and `executeOfflineBatchPlan()` path. Team
idle still acts only as a grouping signal: each work unit is re-authorized on
its own agent-scoped boundary.
