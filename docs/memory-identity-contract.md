# Memory Identity and Consolidation Contract

This document centralizes the identity rules and consolidation invariants for
the reusable `brain` library. It sits above the promotion, archival, and
persistence docs and records what may change, what may never change, and who is
allowed to open an offline consolidation window.

Use this contract together with:

- [`consolidation-promotion-policy.md`](./consolidation-promotion-policy.md)
- [`archive-restoration-contract.md`](./archive-restoration-contract.md)
- [`long-term-memory-persistence.md`](./long-term-memory-persistence.md)

## Core invariants

- Identity is agent-scoped. A graph, its memories, archived records, and
  durable identifiers stay inside one `agentId`. Team idle can coordinate batch
  planning, but it never merges identity or durable state across agents.
- Immutable identity is limited to runtime-supplied invariants and protected
  core facts: `agentId`, `persona`, `role`, `durableMission`,
  `safetyConstraints`, `ownership`, `nonNegotiablePreferences`,
  `runtimeInvariants`, and `protectedCoreFacts`.
- Learned traits remain `oldGeneration.longTermMemory` records with their own
  confidence, provenance, and `protectedFromIdentityPromotion: true`. They are
  never promoted into immutable identity.
- Consolidation stays offline. Promotion planning, durable serialization,
  archival transition, and durable persistence are all decoupled from the live
  working loop.

## Runtime authority

Offline consolidation is opened only by an explicit caller-controlled runtime
phase change.

- Authorized phases: `idle`, `rest`, `break`, `sleep`
- Required authority: `runtimePhase.authority === "caller"`
- Advisory only: `teamIdle`, inactivity heuristics, and scheduler suggestions
- Blocked cases:
  - `runtime-phase-not-idle-window`
  - `runtime-phase-not-caller-controlled`

This means inactivity signals may help batch work, but they never force a pass
to run. A scheduler may suggest that an agent looks idle, yet the library still
refuses consolidation until the caller explicitly marks that agent with an
authorized idle or sleep phase.

## Allowed state transitions

The library models a small set of allowed lifecycle moves. Anything outside
this matrix is out of contract.

| Surface | From | To | Allowed when | Notes |
| --- | --- | --- | --- | --- |
| Runtime authority | any runtime phase | `idle`, `rest`, `break`, `sleep` | caller-controlled phase change | Opens an offline window but does not itself mutate memory. |
| Runtime authority | any runtime phase | heuristic or `teamIdle` suggestion | always | Advisory only. No write authority is granted. |
| Young-generation lifecycle | `active` | `inactive` | a masking or parking pass marks `inactiveForRetrieval: true` | Retrieval exclusion only. The memory envelope remains preserved in young generation. |
| Young-generation lifecycle | `inactive` | `archived` | caller-authorized offline archival pass | Creates an `oldGeneration.archivedMemory` record and preserves archive linkage plus recovery context. |
| Consolidation path | inactive `workingMemory` or `shortTermMemory` | `oldGeneration.longTermMemory` | caller-authorized offline promotion plan plus durable write | The promoted durable record must preserve the source `memoryId`. |
| Old-generation lifecycle | active `longTermMemory` | `superseded` | offline consolidation emits a valid `supersedes` edge | `supersedes` stays acyclic and cannot assign multiple canonical successors. |
| Old-generation lifecycle | active `longTermMemory` | `archivedMemory` | caller-authorized offline archival pass | This is a live-to-archive move into a new archived record, not an in-place mutation of the live durable node. |
| Immutable identity | `runtime_seeded` | `runtime_seeded` | always | Immutable identity is creation-only and never transitions into learned-memory states. |

### Explicitly forbidden transitions

- Active young memory may not jump straight to archived state while it still
  belongs to the live retrieval set. `archiveStaleMemories()` defers it with
  `deferredReason: "active-set-memory"`.
- Heuristic inactivity, scheduler authority, or `teamIdle` may not open a
  consolidation window by themselves.
- Immutable identity may not transition to `promoted`, `preserved`,
  `superseded`, or `archived`.
- Learned traits may not transition into immutable identity, even when
  consolidation decides they are durable.

## Forbidden identity mutations

### Stable memory identity

- `memoryId` is the canonical stable identity for a memory item.
- Once a memory exists, its `memoryId` must not be regenerated, reassigned, or
  swapped for a different memory's id.
- Promotion planning carries canonical `outputMemoryId` and `outputNodeId`
  values derived from the resolved young-generation source record so downstream
  offline outputs keep the same stable identity.
- Promotion planning rejects `targetMemoryId` values that differ from the
  source `memoryId` with `deferredReason: "memory-id-rewrite-attempt"` plus a
  shared safe abort payload.
- Deduplication matching must not remap a loser record onto a different winner
  `memoryId` or collapse a durable record onto a replacement canonical
  `nodeId`. Those cases abort with `stage: "deduplication"` before write.
- Promotion rewrite, serialization, deduplication, reinforcement-merge
  validation, and long-term persistence throw
  `ConsolidationPipelineAbortError` carrying the same
  `canonical-id-mutation` abort contract if a caller tries to rewrite a stable
  `memoryId`, swap `agentId`, or replace a canonical durable `nodeId`.

### Agent boundary

- `agentId` must stay constant across the graph, archived records, durable node
  identifiers, and persistence keys for a single agent brain.
- Cross-agent promotion candidates are deferred with
  `deferredReason: "cross-agent-candidate"`.
- Persisted old-generation state may restore durable memory only when the
  immutable identity in storage still matches the target runtime shell.

### Derived node and archive identifiers

- Canonical old-generation node ids are derived wrappers, not replacements for
  memory identity:
  - `old/{agentId}/long_term_memory/{memoryId}`
  - `old/{agentId}/immutable_identity/self`
  - `old/{agentId}/archived_memory/{archiveId}`
- It is allowed to allocate a new `archiveId`, archive `nodeId`, or durable
  `edgeId` during offline work because those are new derived identifiers.
- It is forbidden to mutate the source memory identity while deriving those
  identifiers.

### Archive lineage

- Archived records must preserve `originalMemoryId`.
- Young-generation archive snapshots must keep
  `snapshot.record.memoryId === originalMemoryId`.
- Old-generation archive snapshots must keep
  `snapshot.memoryId === originalMemoryId`.
- Recovery metadata must keep
  `snapshot.recoveryContext.sourceMemoryId === originalMemoryId`.
- Offline archival output must not swap or invent a new source identity inside
  the preserved snapshot.

### Immutable identity

- Immutable identity is created from runtime authority and stays
  `consolidationState.status === "runtime_seeded"`.
- Persisted storage may not rewrite immutable identity fields such as
  `persona`, `role`, `durableMission`, `provenance`, or protected core facts.
- Immutable identity may not appear in old-generation edges.
- Immutable identity may not inherit `sourceMemoryIds` from learned memories.

### Learned traits

- Learned traits must keep `protectedFromIdentityPromotion: true`.
- Callers may not disable that flag on a `learned_trait` durable memory.
- Learned traits remain long-term memories with provenance; they do not mutate
  immutable identity even if they describe stable behavior.

## Practical review checklist

Before shipping a new consolidation or archival integration, confirm:

- the caller, not the scheduler, opened the runtime phase window;
- the source memory remains inside the same `agentId`;
- the source `memoryId` is unchanged from young generation through durable or
  archived output;
- archive snapshots preserve `originalMemoryId` in both the payload and
  recovery context;
- immutable identity is read from runtime authority and only compared against
  persisted state, never overwritten by it;
- learned traits are preserved in long-term memory with provenance and never
  promoted into identity.
