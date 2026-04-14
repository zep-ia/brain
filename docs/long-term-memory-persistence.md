# Long-Term Memory Persistence

This library publishes a versioned per-entry contract for durable long-term
memory serialization:

- `DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX`
- `LONG_TERM_MEMORY_RECORD_CONTRACT`
- `LONG_TERM_MEMORY_PERSISTENCE_SCHEMA`
- `LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA`
- `createLongTermMemoryLogicalIdentity()`
- `matchLongTermMemoryLogicalIdentity()`
- `createLongTermMemoryPersistenceRecordName()`
- `createLongTermMemoryPersistenceKey()`
- `serializeLongTermMemoryEntry()`
- `serializePromotionSelectionToLongTermMemoryEntry()`
- `deserializeLongTermMemoryEntry()`
- `persistLongTermMemoryEntry()`
- `deleteLongTermMemoryEntry()`
- `persistPromotionSelectionToLongTermMemory()`

The contract is intentionally narrower than the full old-generation graph state.
It serializes one long-term memory entry at a time with a strict split between
memory content and persistence metadata.

The same module now also defines the rerun-safe logical-identity contract for
durable memories. Matching stays agent-scoped and deterministic:

- stable `memoryId` remains the first exact-match key,
- when exact stable ids are absent, the canonical logical-identity key compares
  only `agentId`, `category`, canonical `content`, canonical `summary`, sorted
  lineage memory ids, and learned-trait label,
- mutable metadata such as confidence, provenance, timestamps, salience, and
  consolidation journal details are excluded from that key,
- same-key records that disagree on stable `memoryId` are surfaced as conflicts
  rather than merged automatically, and deduplication aborts if winner/loser
  collapse would replace the source `memoryId` or canonical durable `nodeId`.

`serializePromotionSelectionToLongTermMemoryEntry()` is the offline bridge for
promotion output. It accepts a previously eligible `selectedPromotions` item
plus the source in-memory young-generation record, rehydrates masked content
when needed, and derives the durable metadata envelope from the promotion
evaluation without reopening runtime authorization. The bridge also enforces the
stable-memory identity contract: the emitted long-term memory entry must keep
the source memory's original `memoryId`, and any replacement target or manual
output-id rewrite attempt is rejected before serialization completes with a
`ConsolidationPipelineAbortError`. When the
promotion plan already carries canonical `outputMemoryId` and `outputNodeId`
values from the resolved young-generation record, the serializer reuses those
identifiers instead of re-deriving them late in the pipeline. When a promotion
targets an existing durable node with the same `memoryId`, callers may update
generation-state fields through `input.consolidationState`, but they must still
provide the young-generation source record or envelope rather than a
replacement long-term memory record.

`persistLongTermMemoryEntry()` is the storage-facing write path. It derives a
stable agent-scoped storage key, checks the caller-controlled runtime window
first, and only canonicalizes plus writes the entry when the caller has
explicitly opened an authorized idle, rest, break, or sleep window. When the
storage adapter provides agent-scoped listing, the writer also resolves stable
and logical identity matches before deciding whether to create, upsert, or
reject the write. Before any overwrite-style merge is applied, the writer
compares the existing durable `agentId`, `memoryId`, and canonical `nodeId`
with the post-merge entry and aborts with `ConsolidationPipelineAbortError`
when a merge would replace that canonical identity. Every authorized write is
then revalidated against the canonical sanitized storage record before the
adapter sees it, and the committed entry is read back through the same
validation contract before it is reported as committed. If a same-identity
overwrite fails read-back validation, the writer restores the previous durable
entry before surfacing the failure.

`deleteLongTermMemoryEntry()` is the matching storage-facing delete path. It
derives the same canonical agent-scoped storage key, rechecks the caller-
controlled runtime window, and removes only the durable record that still
matches the expected canonical identity and serialized payload. If delete
verification fails after the adapter call, the helper restores the previous
durable entry before surfacing the failure.

`persistPromotionSelectionToLongTermMemory()` is the graph-facing convenience
bridge for that same write path. It accepts the promotion selection plus the
source young-generation memory, persists either the default promotion output or
an explicit rewrite payload, and returns the updated durable memory plus the
next graph snapshot with the matching long-term memory entry replaced in place.

`planConsolidationPromotions()` uses the same matcher during reruns when a
candidate omits `targetMemoryId`. If one existing durable record already
matches the same stable `memoryId`, the planner reattaches to that record. If a
same-key durable record exists under a different stable `memoryId`, the planner
defers the candidate instead of rewriting identity.

## Serialized entry shape

```json
{
  "schemaId": "agent_brain_long_term_memory_entry",
  "schemaVersion": "1.0.0",
  "nodeKind": "long_term_memory",
  "content": {
    "memoryId": "ltm-1",
    "category": "semantic",
    "content": "Legal review is required before launch.",
    "summary": "Launch requires legal review."
  },
  "metadata": {
    "nodeId": "old/agent-007/long_term_memory/ltm-1",
    "agentId": "agent-007",
    "confidence": 0.84,
    "provenance": {
      "source": "conversation",
      "observedAt": "2026-04-12T09:00:00Z",
      "evidence": ["turn-19"]
    },
    "stabilizedAt": "2026-04-12T09:00:00Z",
    "temporalContext": {
      "firstObservedAt": "2026-04-12T08:58:00Z",
      "lastObservedAt": "2026-04-12T09:00:00Z",
      "stabilizedAt": "2026-04-12T09:00:00Z",
      "consolidatedAt": "2026-04-12T09:00:00Z",
      "lastAccessedAt": "2026-04-12T09:02:00Z",
      "supersededAt": null
    },
    "salience": {
      "score": 0.84,
      "signals": {
        "evidenceStrength": 0.9,
        "recallPriority": 0.78
      },
      "signalCount": 2,
      "lastEvaluatedAt": "2026-04-12T09:01:00Z",
      "sourceEntryId": "importance-stm-1"
    },
    "consolidationState": {
      "status": "promoted",
      "lastOperation": "promote",
      "journalRecordId": "journal-1",
      "policyVersion": "old-generation-v1",
      "sourceMemoryIds": ["stm-1"],
      "preservedIdentityFields": ["agentId", "persona", "role"],
      "protectedFromIdentityPromotion": null
    },
    "learnedTrait": null
  }
}
```

## Required content fields

- `memoryId`
- `category`
- `content`
- `summary`

## Required metadata fields

- `nodeId`
- `agentId`
- `confidence`
- `provenance`
- `stabilizedAt`
- `temporalContext`
- `salience`
- `consolidationState`

## Learned trait rule

`metadata.learnedTrait` is optional for non-trait memories. When
`content.category === "learned_trait"`, learned-trait metadata is required and
must keep `protectedFromIdentityPromotion: true`. The contract keeps learned
traits in long-term memory with their own confidence and provenance and never
allows them to drift into immutable identity.

## Storage write path

The default storage prefix is:

- `agent-brain/long-term-memory`

Canonical locations are derived as:

- `recordName`: `encodeURIComponent(memoryId) + ".json"`
- `key`: `{keyPrefix}/{encodeURIComponent(agentId)}/{recordName}`

This keeps each durable memory agent-scoped while preserving a stable file or
object name for repeated writes.

### Write behavior

- The caller must provide a runtime phase authorized by the runtime-phase
  contract. Heuristics and team-idle hints may be passed for audit, but they do
  not authorize the write.
- `storage.read({ key, keyPrefix, recordName, agentId, memoryId, nodeId })`
  explicitly identifies the durable record being fetched and should return the
  same descriptor fields plus `found` and `value`.
- `storage.list({ keyPrefix, agentId })` is optional, but when provided it must
  return every agent-scoped durable entry for that prefix so the writer can
  resolve stable-id and logical-identity matches before writing.
- `storage.write(request)` now carries `request.integrity` with the requested
  mode (`create`, `replace`, or rollback recovery), the expected prior serialized
  value when known, and the agent-scoped durable identity on both sides of the
  write. Adapters can use that descriptor to implement create-if-absent or
  compare-and-swap semantics without inventing their own matching rules.
- When authorization is blocked, the result returns `status: "blocked"` with
  `entry: null` and `serializedEntry: null`, so the writer does not emit a
  canonicalized durable payload.
- If the target key does not exist, the writer creates a new JSON record.
- If a matching durable identity already exists, the writer upserts that
  durable record instead of emitting a second insert.
- If deduplication resolves the same logical identity to a different canonical
  `memoryId` or `nodeId`, the writer aborts at `stage: "deduplication"` before
  any overwrite or collapse is attempted.
- If the existing stored record is canonically identical, the writer returns
  `status: "unchanged"` and does not write again.
- After every create or overwrite, the writer reads the canonical key back,
  revalidates the stored JSON, and, when listing is available, confirms that
  both `storage.read({ key, ... })` and `storage.list()` resolve the same
  durable identity.
- If a replace operation produces invalid, partial, or mismatched durable data,
  the writer rolls the previous entry back into place before throwing.
- Identity-safe upsert still rejects conflicts: a stored record with a
  different `agentId`, `memoryId`, or canonical `nodeId`, or a logical-identity
  match that points at a different stable `memoryId`, is rejected instead of
  merged.

### Example

```js
import {
  createRuntimePhase,
  persistLongTermMemoryEntry,
} from "@zep/brain";

const storage = {
  async read(request) {
    return {
      ...request,
      found: false,
      value: null,
    };
  },
  async list({ keyPrefix, agentId }) {
    return [];
  },
  async write(request) {
    await putObject(request.key, request.value);
    return {
      ...request,
      written: true,
    };
  },
};

const result = await persistLongTermMemoryEntry({
  storage,
  entry: {
    agentId: "agent-007",
    memoryId: "ltm-1",
    category: "semantic",
    content: "Legal review is required before launch.",
    summary: "Launch requires legal review.",
    confidence: 0.84,
    stabilizedAt: "2026-04-12T09:00:00Z",
    provenance: {
      source: "conversation",
      observedAt: "2026-04-12T09:00:00Z",
      evidence: ["turn-19"]
    }
  },
  runtimePhase: createRuntimePhase("idle"),
});

console.log(result.status);
console.log(result.key);
// "created"
// "agent-brain/long-term-memory/agent-007/ltm-1.json"
```

## Startup restore

When a new brain session starts, `restoreMemoryGraphFromStorage()` can rebuild
the old-generation long-term memory collection directly from the same storage
adapter:

```js
import { restoreMemoryGraphFromStorage } from "@zep/brain";

const restoredGraph = await restoreMemoryGraphFromStorage(
  {
    agentId: "agent-007",
    persona: "deliberate analyst",
    role: "researcher",
    durableMission: "Protect user context quality.",
    safetyConstraints: ["never overwrite identity"],
    ownership: ["customer-insight-domain"],
    nonNegotiablePreferences: ["preserve provenance"],
    runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
    protectedCoreFacts: ["agent-007 belongs to tenant zep"],
  },
  {
    storageAdapter: storage,
  },
);

console.log(restoredGraph.oldGeneration.longTermMemory.length);
// 1
```

Startup restore notes:

- `restoreMemoryGraphFromStorage()` requires `storage.list({ keyPrefix, agentId })`
  so it can enumerate every persisted durable memory for the agent.
- The restore helper rebuilds only long-term memory entries from per-entry
  storage records; archived memory, evidence, journal records, and edges still
  come from explicit graph-state inputs when needed.
- If the caller provides `options.longTermMemory`, that explicit durable state
  is used instead of reading from storage.
