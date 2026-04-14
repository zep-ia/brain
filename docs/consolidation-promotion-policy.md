# Consolidation Promotion Policy

This library exposes a reusable promotion-scoring contract without granting
consolidation authority.

## Intent

- Promotion scoring consumes explicit signal captures from `youngGeneration`
  and optional contextual captures from `oldGeneration`.
- Runtime-phase authorization remains separate. Use
  `createRuntimePhase()` and `evaluateIdleWindowAuthorization()` to decide
  whether an offline pass may run.
- Team idle is only a batching hint. Promotion scoring stays agent-scoped.
- Immutable identity remains protected. Promotion targets
  `oldGeneration.longTermMemory` only, and learned traits still require
  identity-promotion blocking.

## Signal capture

`createConsolidationSignalCapture()` normalizes one explicit signal family:

- `score`: aggregate score in `[0, 1]`. If omitted, the library derives it from
  the normalized `signals` map.
- `signals`: explicit signal values such as `taskRelevance`, `repeatRecall`,
  `evidenceCoverage`, or `reinforcementCount`.
- `capturedAt`: timestamp for offline audit and replay.
- `sourceCollection` and `sourceRecordIds`: optional references back to the
  source collection such as `importanceIndex`, `shortTermMemory`,
  `longTermMemory`, or `consolidationJournal`.
- `provenance`: optional structured metadata for the caller's audit trail.

## Candidate input

`createConsolidationPromotionCandidate()` requires:

- `candidateId`, `agentId`, `sourceMemoryId`, and `sourceMemoryKind`
- `signals.youngGeneration.importance`
- `signals.youngGeneration.stability`

`signals.oldGeneration.importance` and `signals.oldGeneration.stability` are
optional. They let a caller bring in durable salience or stability context when
matching against an existing long-term memory record.

## Promotion criteria

Long-term promotion is intentionally multi-stage. A candidate is promotable only
when every required gate below passes.

| Gate | Required rule | Failure surface |
| --- | --- | --- |
| Signal completeness | `createConsolidationPromotionCandidate()` requires `youngGeneration.importance` and `youngGeneration.stability`. Old-generation signals stay optional. | Candidate creation fails fast for missing required young-generation captures. |
| Policy thresholds | The default policy requires `youngGeneration.importance >= 0.60`, `youngGeneration.stability >= 0.55`, and `promotionScore >= 0.65`. Optional old-generation scores may contribute to weighting, but they are not required by default. | `evaluateConsolidationPromotionEligibility()` returns `decision: "defer"` with `blockedReasons` such as `below-threshold-youngGeneration.importance`. |
| Runtime authority | Consolidation may run only when the caller explicitly supplies a caller-controlled runtime phase in `["idle", "rest", "break", "sleep"]`. | `planConsolidationPromotions()` defers with the runtime blocked reason, and `persistLongTermMemoryEntry()` returns `status: "blocked"`. |
| Source-memory safety | The source must resolve to exactly one young-generation memory in the same agent scope, and that source must already be parked outside the live retrieval set with `inactiveForRetrieval: true`. | Promotion planning defers with `missing-source-memory`, `ambiguous-source-memory`, `cross-agent-candidate`, or `active-set-memory`. |
| Stable identity preservation | `targetMemoryId` may be omitted or may equal the source `memoryId`, but it must never rewrite the source identity. Canonical `outputMemoryId` and `outputNodeId` are always derived from the resolved young-generation source. | Planning defers with `memory-id-rewrite-attempt`; rewrite, serialization, and persistence abort with `ConsolidationPipelineAbortError`. |
| Rerun-safe durable targeting | When `targetMemoryId` is omitted, planning may reattach to one matching long-term record. Stable-id conflicts, ambiguous logical identity, or missing explicit targets are deferred instead of merged. | Planning defers with `ambiguous-logical-identity`, `conflicting-logical-identity`, `missing-target-memory`, or `ambiguous-target-memory`. |
| Batch hygiene | A plan may not contain duplicate `candidateId` values or duplicate references to the same `(sourceMemoryKind, sourceMemoryId)`. | Planning defers with `duplicate-candidate-id` or `duplicate-source-reference`. |
| Identity protection for learned traits | A learned trait may promote only into `oldGeneration.longTermMemory`, and it must keep `protectedFromIdentityPromotion: true`. | Policy construction rejects identity-promotion overrides; serialization preserves learned-trait protection instead of mutating immutable identity. |

## Eligibility decision

`evaluateConsolidationPromotionEligibility()` applies the policy thresholds and
weights to a candidate and returns a promotion decision plus decision metadata:

- `eligible` and `eligibleForPromotion`: boolean aliases for the final outcome.
- `decision` and `recommendedOperation`: `"promote"` or `"defer"`.
- `criteria` and `criteriaBySignalPath`: per-signal-path results including
  requirement status, weight, threshold, score, and capture provenance.
- `criteriaSummary`: aggregate counts for required, available, satisfied, and
  blocked criteria.
- `decisionMetadata`: evaluator timestamp, policy identity, and the fixed
  offline scoring mode metadata.

`evaluateConsolidationPromotionCandidate()` remains available as a compatibility
alias and returns the same decision payload.

Eligibility is still only a scoring result. It does not authorize mutation,
does not resolve graph state, and does not choose a durable target on its own.

## Planning stage

`planConsolidationPromotions()` turns that evaluator into a reusable offline
selection stage for an agent-scoped graph:

- It rechecks caller-controlled runtime authorization before selecting any
  promotion work.
- It resolves each candidate against the current graph, requiring the
  young-generation source memory to exist and any referenced old-generation
  `targetMemoryId` to resolve inside the same agent boundary while preserving
  the source memory's original `memoryId`.
- It carries a canonical `outputMemoryId` and `outputNodeId` forward from the
  resolved young-generation source record so later offline writers can reuse
  the same stable identity without regenerating it.
- It defers, rather than selects, candidates that are cross-agent, duplicate,
  missing or ambiguous in the graph, attempt to rewrite a stable memory id,
  are blocked by runtime phase, or are ineligible under the promotion policy.
- It returns `selectedPromotions` and `deferredCandidates` without mutating
  long-term memory, so a later offline writer can consume only the selected
  subset.

## Promotion path

Use the promotion APIs as a staged offline pipeline:

1. Capture explicit importance and stability signals with
   `createConsolidationSignalCapture()`.
1. Build an agent-scoped candidate with
   `createConsolidationPromotionCandidate()`.
1. Score the candidate with
   `evaluateConsolidationPromotionEligibility()` to learn whether the required
   criteria pass and why.
1. Resolve runtime authority, source-memory state, rerun-safe target matching,
   and canonical durable output ids with `planConsolidationPromotions()`.
1. Convert one selected plan item plus its source young-generation memory into a
   durable entry with `serializePromotionSelectionToLongTermMemoryEntry()`. This
   stage rehydrates masked source content when needed and preserves the planned
   `outputMemoryId` and `outputNodeId`.
1. If an offline rewrite pass produces a revised durable entry,
   `rewritePromotionSelectionToLongTermMemoryEntry()` compares that rewritten
   output against the source canonical ids and aborts before write if the
   rewrite mutates `agentId`, `memoryId`, or `nodeId`.
1. Commit the durable entry through `persistLongTermMemoryEntry()`, which
   rechecks runtime authority, writes to a stable agent-scoped key, validates
   read-back, and rolls back invalid overwrite attempts.

That separation is the reusable contract:

- evaluation decides whether the signals justify promotion,
- planning decides whether runtime and graph state allow offline work,
- rewrite decides whether a rewritten durable draft still preserves canonical
  identity,
- serialization decides what durable record is safe to emit,
- persistence decides whether the durable write committed safely.

Callers should keep those stages separate. Skipping directly from signal scoring
to a durable write bypasses the graph-resolution and identity-preservation rules
that the library enforces in the later stages.

## Default policy

`DEFAULT_CONSOLIDATION_PROMOTION_POLICY` and
`createConsolidationPromotionPolicy()` define:

- required signals:
  `youngGeneration.importance`, `youngGeneration.stability`
- thresholds:
  `minimumPromotionScore: 0.65`
  `minimumYoungImportanceScore: 0.60`
  `minimumYoungStabilityScore: 0.55`
  `minimumOldImportanceScore: 0.00`
  `minimumOldStabilityScore: 0.00`
- normalized weights:
  `youngImportance: 0.35`
  `youngStability: 0.35`
  `oldImportance: 0.15`
  `oldStability: 0.15`

The policy also hard-codes the safety invariants required by this iteration:

- `requiresRuntimeAuthorization: true`
- `allowedRuntimePhases: ["idle", "rest", "break", "sleep"]`
- `inactivityHeuristicsAuthorize: false`
- `teamIdleCoordinatesOnly: true`
- `allowIdentityPromotion: false`
- `learnedTraitsTargetNodeKind: "long_term_memory"`

## Example

```js
import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
  createRuntimePhase,
  createConsolidationPromotionCandidate,
  evaluateConsolidationPromotionEligibility,
  planConsolidationPromotions,
} from "@zep/brain";

const candidate = createConsolidationPromotionCandidate({
  candidateId: "promo-stm-42",
  agentId: "agent-007",
  sourceMemoryId: "stm-42",
  sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  signals: {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: ["importance-stm-42"],
        signals: {
          taskRelevance: 0.8,
          userSpecificity: 0.9,
        },
      },
      stability: {
        capturedAt: "2026-04-12T10:00:00Z",
        sourceCollection: "shortTermMemory",
        sourceRecordIds: ["stm-41", "stm-42"],
        signals: {
          repeatedRecall: 0.8,
          crossEpisodeConsistency: 0.7,
        },
      },
    },
  },
});

const evaluation = evaluateConsolidationPromotionEligibility(candidate);

console.log(evaluation.eligible);
console.log(evaluation.decision);
console.log(evaluation.promotionScore);
console.log(
  evaluation.criteriaBySignalPath["youngGeneration.importance"].meetsThreshold,
);

const graph = createMemoryGraph(
  {
    agentId: "agent-007",
    persona: "deliberate analyst",
    role: "researcher",
    durableMission: "Protect user context quality.",
    safetyConstraints: ["never overwrite identity"],
    ownership: ["customer-insight-domain"],
    nonNegotiablePreferences: ["preserve provenance"],
    runtimeInvariants: { tenant: "zep" },
    protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  },
  {
    shortTermMemory: [
      {
        memoryId: "stm-42",
        summary: "Keep the verified rollout dependency in focus.",
      },
    ],
  },
);

const plan = planConsolidationPromotions(graph, {
  runtimePhase: createRuntimePhase("idle"),
  candidates: [candidate],
});

console.log(plan.selectedPromotionCount);

// true
// "promote"
// 0.8
// true
// 1
```

The evaluation result is still not authorization to mutate durable memory. It is
only an offline scoring decision that another caller-controlled runtime gate may
choose to execute. `planConsolidationPromotions()` adds that runtime gate and
graph-backed selection layer, but it still produces only a plan, not a durable
write.

## Test-backed guarantees

The promotion rules above are backed by automated tests. When changing the
contract, update these tests and this document together.

- Scoring invariants and policy defaults are covered in
  [`../test/consolidation-promotion-policy.test.js`](../test/consolidation-promotion-policy.test.js),
  including the cases
  `promotion schemas publish explicit signal dimensions and policy invariants`,
  `promotion candidates normalize explicit young and optional old signal captures`,
  and
  `policy evaluation blocks below-threshold signals and refuses unsafe overrides`.
- Planning-stage safety and routing are covered in
  [`../test/consolidation-promotion-plan.test.js`](../test/consolidation-promotion-plan.test.js),
  including the cases
  `promotion planning selects only policy-eligible candidates during an authorized idle window`,
  `promotion planning excludes active-set young memories even when another parked memory is eligible`,
  `promotion planning defers rewrite attempts that target a different durable memory id`,
  `promotion planning keeps inactivity heuristics advisory when runtime is still active`,
  and
  `promotion planning defers cross-agent and duplicate candidates instead of merging agent identity`.
- Stable memory identity across planning and serialization is covered in
  [`../test/memory-identity.test.js`](../test/memory-identity.test.js),
  especially
  `offline promotion preserves one stable memoryId from young generation into old generation`
  and
  `consolidation flow rejects regenerated memory ids during planning and serialization`.
- Persistence-stage promotion guarantees are covered in
  [`../test/long-term-memory-persistence.test.js`](../test/long-term-memory-persistence.test.js),
  including:
  `persistLongTermMemoryEntry blocks writes outside caller-authorized idle windows`,
  `promotion pipeline persists a newly promoted durable record without changing the source memory id`,
  `promotion reruns keep a single long-term memory entry for the same consolidation input`,
  `serializePromotionSelectionToLongTermMemoryEntry rehydrates masked source content and derives persistence metadata`,
  `serializePromotionSelectionToLongTermMemoryEntry keeps learned traits protected from identity promotion`,
  `serializePromotionSelectionToLongTermMemoryEntry rejects explicit output memory id rewrites`,
  and
  `persistLongTermMemoryEntry surfaces canonical id rewrites as a persistence-stage abort`.
