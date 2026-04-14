# Archive Restoration Contract

Archived memory is an offline preservation format, not a live retrieval state.
The library keeps archival and restoration agent-scoped, runtime-gated, and
separate from the live working loop.

## Runtime authority

- `archiveStaleMemories()` may run only after the caller explicitly switches the
  runtime phase to `idle`, `rest`, `break`, or `sleep`.
- Inactivity heuristics can suggest a window, but they never authorize archival
  writes on their own.
- `teamIdle` is only a batching signal. Each agent still authorizes its own
  archival pass independently.

## Archive-state transitions

Young-generation archival is a two-step transition:

1. Live young memory remains in `workingMemory` or `shortTermMemory` while it is
   still part of the active retrieval set.
2. A prior masking or parking pass may mark the same memory
   `inactiveForRetrieval: true` with `lifecycle.state: "inactive"`.
3. Only a caller-authorized offline archival pass may advance that stored
   envelope to `lifecycle.state: "archived"`, stamp
   `lifecycle.inactiveReason: "archived-to-old-generation"`, and attach
   `lifecycle.archiveLinkage`.
4. The archived record is written into `oldGeneration.archivedMemory`, while the
   live young-generation collections drop the archived memory and its detached
   importance entries and edges.

Old-generation archival is a live-to-archive transition, not an in-place state
change:

- A stale `oldGeneration.longTermMemory` node is removed from the active durable
  set.
- Any durable edges that point to or from that node are detached from live graph
  traversal.
- The removed node plus its detached edge context are preserved in
  `oldGeneration.archivedMemory`.

Archived memory stays out of default retrieval. Access remains explicit through
`lookupArchivedMemory()` or `resolveArchivedMemoryReference()`.

## Active-set exclusion rules

- A young memory that is still in the active retrieval set is never archived,
  even if stale scoring marks it as low value.
- `archiveStaleMemories()` archives only already-inactive young memories. Live
  young memories are deferred with `deferredReason: "active-set-memory"`.
- `createYoungGenerationRetrievalView()` excludes archived or otherwise
  inactive young memories from normal recall and drops only the matching
  retrieval-facing importance entries.
- Default old-generation retrieval also excludes archived records. Archive
  access is administrative or explicit by archive reference, not part of normal
  long-term recall.

## Required metadata for safe restoration

Safe restoration depends on preserving archive identity, source lineage, and the
detached recovery context without inventing new identity.

Every archived record must preserve:

- Archive identity: `nodeId`, `archiveId`, and `agentId`.
- Source lineage: `originalGeneration`, `originalMemoryKind`,
  `originalMemoryId`, and, for archived old-generation memories,
  `originalNodeId`.
- Source provenance: `originalProvenance` when the source memory carried it.
- Archive timing and audit fields: `archivedAt`, `lastRestoredAt`,
  `provenance`, `temporalContext`, and `consolidationState`.
- Source snapshot: the archived `snapshot` itself, including the stored young-
  or old-generation payload that was removed from the live set.
- Recovery context: `snapshot.recoveryContext.version`, `preservedAt`,
  `preservedBy`, `sourceMemoryId`, `sourceGeneration`, `sourceMemoryKind`,
  detached importance entries, detached edges, and the stale-evaluation record
  that justified archival.

Young-generation archives add one more guarantee:

- `snapshot.lifecycle.archiveLinkage.archiveId`,
  `snapshot.lifecycle.archiveLinkage.archiveNodeId`, and
  `snapshot.lifecycle.archiveLinkage.archivedAt` must mirror the created archive
  record so offline tooling can correlate the preserved young snapshot with its
  archived durable record directly.

These guarantees let restoration tooling:

- verify the archive still belongs to the same agent,
- restore the detached snapshot without inventing a new `memoryId`,
- reconnect preserved importance and edge context deliberately rather than by
  guesswork,
- keep immutable identity under runtime authority instead of reading it from
  archival storage.

## Persistence and restore notes

- `saveOldGenerationGraphState()` and `loadOldGenerationGraphState()` round-trip
  archived records as durable old-generation data.
- The old-generation loader restores archived memory losslessly while still
  rejecting immutable-identity drift between storage and the target runtime
  shell.
- Learned traits remain long-term memories with confidence and provenance. They
  are not promoted into immutable identity and are not rewritten by archive
  restoration.
