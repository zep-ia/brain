# Offline Consolidation Safety and Limit Rules

This document centralizes the fail-closed limit rules and safety constraints
that govern offline consolidation in `@zep/brain`.

Use it together with:

- [`offline-consolidation-plan-builder.md`](./offline-consolidation-plan-builder.md)
- [`offline-batch-planning.md`](./offline-batch-planning.md)
- [`memory-identity-contract.md`](./memory-identity-contract.md)

## Core authority model

Offline consolidation is caller-authorized, offline-only, and agent-scoped.

- Only an explicit caller-controlled runtime phase change may authorize an
  offline consolidation window.
- Runtime inactivity heuristics may suggest that a window looks safe, but they
  never grant execution authority.
- Team idle is only a batching and coordination signal. It does not create a
  shared window and does not merge identity across agents.
- Scheduler and executor infrastructure may queue, slice, or dispatch work only
  after authorization already exists, and they must treat that authorization as
  provisional until execution time.
- Identity remains agent-scoped for every plan, work unit, overwrite namespace,
  and durable write path.

## Runtime authorization requirements

Offline consolidation is allowed only when both of these conditions hold:

1. The runtime phase was supplied by the caller that owns the agent runtime.
1. That runtime phase is inside an authorized offline window.

The library's offline-authorized phases are:

- `idle`
- `rest`
- `break`
- `sleep`

The library's blocked authority sources are:

- inactivity heuristics
- scheduler inference
- executor-local guesses
- team-idle signals without a caller phase change

If authorization is missing or no longer valid, the safe outcome is rejection,
deferral, or blocked dispatch rather than best-effort consolidation.

## Idle and sleep window boundaries

The planner treats `idle` and `sleep` as different offline windows with
different boundaries.

| Targeted window | Caller runtime phases that satisfy it | Intended scope | Hard boundary |
| --- | --- | --- | --- |
| `idle` | `idle`, `rest`, `break` | short offline triage, promotion, and reinforcement work that fits a lighter offline window | Must not be widened from heuristics alone and must not be treated as a `sleep` window. |
| `sleep` | `sleep` only | deeper maintenance such as archival review and the longest offline passes | Must not be inferred from `idle`, `rest`, `break`, or team-idle coordination. |

These boundaries apply at both planning time and execution time:

- `requestOfflineConsolidationBatchPlan()` and
  `buildOfflineConsolidationBatchPlan()` reject a request whose caller runtime
  phase does not match the targeted `idle` or `sleep` window.
- `validateOfflineConsolidationBatchPlan()` rejects stored or transformed plans
  that drift outside those window rules.
- `executeOfflineBatchPlan()` rechecks authorization per work unit immediately
  before dispatch, so a previously valid plan still stops if the agent has
  returned to active runtime work.

## Limit rules that must remain fixed

The batch-planning and execution surfaces expose reusable limit objects, but
some limit fields are safety invariants rather than tuning knobs.

| Limit field | Required value | Why it is fixed |
| --- | --- | --- |
| `requiresRuntimeAuthorization` | `true` | Plans never self-authorize execution. |
| `heuristicsAuthorizeExecution` | `false` | Idle detection may suggest work but never force it. |
| `teamIdleCoordinatesOnly` | `true` | Team idle is batching-only, not shared authority. |
| `identityIsolationMode` | `agent-scoped` | Identity boundaries are never merged across agents. |
| `requiresIndependentWrites` | `true` | Each agent consolidates through its own durable write path. |
| `executionMode` | `offline-plan-only` | The plan stays decoupled from the live working loop. |
| `executorBinding` | `external` | The framework does not embed scheduler or worker authority. |
| `liveWorkingLoopCoupling` | `offline-decoupled` | Consolidation cannot run inline with active task execution. |
| `numericThroughputBenchmarkRequired` | `false` | B200 readiness is architectural in this iteration, not a numeric throughput promise. |

Numeric limits such as `maxAgentsPerBatch`, `maxWorkUnitsPerBatch`,
`maxOverwriteTargetsPerBatch`, `maxOverwriteTargetsPerWorkUnit`, and
`maxIdentityScopesPerBatch` remain caller-tunable planning bounds. They can
shrink or slice work, but they must never widen authority, merge identity, or
override runtime-window rules.

## Execution safety constraints

Once a plan exists, the executor still stays inside a strict offline boundary.

- Scheduling may repack work into smaller slices to satisfy capacity limits,
  but it must preserve per-agent identity scope and overwrite isolation.
- Execution must recheck caller-controlled runtime authorization immediately
  before dispatch instead of trusting stale planning-time eligibility.
- If a work unit exceeds overwrite limits, reuses another agent's identity
  scope, or collides on overwrite namespace, scheduling must block rather than
  partially run.
- Consolidation remains decoupled from the live working loop even during an
  authorized window. The live loop may capture or persist state, but durable
  promotion, reinforcement, and archival writes still run offline.

## Forbidden shortcuts

The following behaviors are outside contract and must remain rejected:

- treating heuristic inactivity as sufficient authorization
- promoting `idle`, `rest`, or `break` into a `sleep` window
- letting team idle create one shared consolidation identity
- running durable consolidation inline with active runtime work
- merging immutable identity across agents
- promoting learned traits into immutable identity

## Integration checklist

Before wiring a new runtime or batch executor into offline consolidation,
confirm that:

- the caller owns the runtime-phase change that opened the window;
- the targeted window is explicitly `idle` or `sleep`, with `sleep` reserved
  for `runtimePhase: "sleep"` only;
- heuristics and team idle are recorded only as advisory metadata;
- batch limits only bound or slice work and do not alter authority semantics;
- execution rechecks runtime authorization immediately before dispatch;
- each agent keeps its own identity scope, overwrite namespace, and durable
  write path.
