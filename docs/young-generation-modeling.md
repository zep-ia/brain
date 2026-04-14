# Young Generation Modeling

This page documents how the reusable `brain` library models the transient,
agent-scoped Young Generation domain. Young Generation is intentionally
separate from durable identity and old-generation consolidation artifacts: it
holds live context, recent episodes, and salience metadata that can later be
read by an offline consolidation pass when runtime explicitly authorizes an
idle, rest, break, or sleep phase.

## Domain shape

Young Generation always contains three collections:

- `workingMemory`
- `shortTermMemory`
- `importanceIndex`

Both memory collections use the same non-destructive envelope:

```js
{
  record: { ...originalMemoryRecord },
  inactiveForRetrieval: false,
  masking: {
    isMasked: false,
    maskedAt: null,
    maskedBy: null,
    reason: null,
    maskedOriginalContent: null,
    audit: null,
    provenance: null,
  },
  lifecycle: {
    state: "active",
    inactiveAt: null,
    inactiveReason: null,
    archiveLinkage: null,
  },
}
```

The envelope matters because retrieval masking is a visibility change, not a
delete. The original `record` stays stored for offline consolidation, audit,
administrative access, and inspection views. Lifecycle metadata keeps the
inactive or archived state explicit and preserves archive linkage when an
offline archival record is created.

Every young-generation `record` must include a canonical stable `memoryId`.
That `memoryId` is assigned once, must never be regenerated for the same
memory, and must never be reassigned to different content.

## Working Memory vs Short-Term Memory

`workingMemory` and `shortTermMemory` share the same envelope structure, but
they model different runtime behavior.

### Working Memory

Use `workingMemory` for the agent's current task horizon: live instructions,
active blockers, tool results still in play, and the immediate context that the
agent should be able to retrieve during the active loop.

Typical record shape:

```js
{
  memoryId: "wm-live",
  content: "Track the legal approval dependency for the current rollout.",
  metadata: {
    source: "runtime",
  },
}
```

Behavior notes:

- Records are usually content-centric and optimized for immediate reuse.
- Retrieval-active working-memory items stay visible in
  `createYoungGenerationRetrievalView()`.
- If an item becomes `inactiveForRetrieval`, it leaves the live retrieval view
  but remains stored in Young Generation for later offline handling.
- If an item is durably archived, the preserved archived snapshot records
  `lifecycle.state: "archived"` and points back to the archive record through
  `lifecycle.archiveLinkage`. Offline tooling can later resolve that linkage
  with `resolveArchivedMemoryReference()` without reintroducing the archived
  record into active retrieval.

### Short-Term Memory

Use `shortTermMemory` for recent episodes that should stay available to offline
consolidation and optional later recall, but do not need to remain in the live
working set.

Typical record shape:

```js
{
  memoryId: "stm-episode",
  summary: "The user confirmed legal review is complete.",
  detail: "This recent episode can still inform offline promotion decisions.",
  tags: ["legal", "recent"],
}
```

Behavior notes:

- Records are episode-oriented and usually summarized rather than written as a
  single live `content` field.
- Short-term memory can be linked back into working memory through
  `short_term_recall` edges, but it does not implicitly re-enter the live loop.
- Administrative and inspection views can rehydrate masked text from
  `masking.maskedOriginalContent` without moving the item into working memory.

### Practical boundary

Use this rule when choosing between the two:

- Put it in `workingMemory` if the active agent loop should retrieve it now.
- Put it in `shortTermMemory` if it is a recent episode worth preserving, but
  not part of the current live focus.

Neither collection grants consolidation authority by itself. Promotion,
reinforcement, preservation, or masking decisions still require a separate
runtime-authorized offline window.

## Importance Index Representation

`importanceIndex` is a separate Young Generation collection. It does not copy
importance scores into working-memory or short-term-memory records.

Each entry references exactly one young-generation memory target through:

- `memoryId`
- `memoryKind`
- `agentId`

Example:

```js
{
  entryId: "importance-wm-live",
  agentId: "agent-007",
  memoryId: "wm-live",
  memoryKind: "working_memory",
  signals: {
    taskRelevance: 0.9,
    recency: 0.7,
  },
  signalCount: 2,
  importanceScore: 0.8,
  lastUpdatedAt: "2026-04-12T09:10:00Z",
}
```

Representation rules:

- `signals` are normalized numeric salience inputs.
- `signalCount` is derived from the number of normalized signals.
- `importanceScore` is a derived aggregate score, currently the normalized mean
  of the signal values.
- Memory records themselves do not receive copied `signals`,
  `signalCount`, or `importanceScore` fields.

This separation is deliberate: the memory record remains the original content,
while importance metadata stays queryable and replaceable without mutating the
underlying memory payload.

## Graph Representation

In the graph, an importance entry is represented as its own node-like record in
`youngGeneration.importanceIndex` plus a canonical edge to the referenced
memory:

- `importance_to_working_memory`
- `importance_to_short_term_memory`

Example snapshot edges:

```js
[
  {
    from: "importance-wm-live",
    to: "wm-live",
    relation: "importance_to_working_memory",
  },
  {
    from: "importance-stm-live",
    to: "stm-live",
    relation: "importance_to_short_term_memory",
  },
]
```

The library keeps this representation aligned:

- `getYoungGenerationSnapshotEdges()` validates that declared importance edges
  match the persisted `importanceIndex` entries.
- Missing canonical importance edges are auto-merged during snapshot export so
  the public Young Generation graph state stays self-describing.
- Retrieval views drop importance entries only when their referenced memory is
  retrieval-inactive.
- `queryImportanceIndex()` uses the same retrieval-active default, so
  generation-time ranking excludes inactive memories unless the caller opts
  into administrative or inspection access.
- Administrative and inspection views preserve the full `importanceIndex`
  collection.

## Lifecycle Summary

1. The live agent loop writes working memory, short-term memory, and importance
   metadata inside the agent boundary.
2. Runtime heuristics may suggest an idle window, but they do not authorize
   consolidation.
3. When the caller explicitly changes runtime phase to an allowed offline
   window, consolidation code can read the stored Young Generation state.
4. Any durable promotion must still respect immutable identity boundaries and
   keep learned traits out of identity.

Use `createYoungGenerationRetrievalView()` for live access, and use
`saveYoungGenerationGraphState()` or the administrative and inspection views
when an offline pass needs the complete stored Young Generation graph.
