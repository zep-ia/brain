# Old Generation Graph Examples

This page defines the canonical valid and invalid Old Generation graph examples
used to lock down the durable domain model. The executable fixture source lives
in [`examples/old-generation-graph-examples.js`](../examples/old-generation-graph-examples.js).

## Canonical Valid Graph

The valid reference graph keeps immutable identity isolated, stores learned
traits only in `longTermMemory`, and uses every allowed Old Generation edge
relation exactly once.

```js
{
  oldGeneration: {
    immutableIdentity: {
      nodeId: "old/agent-007/immutable_identity/self",
      agentId: "agent-007",
      persona: "deliberate analyst",
      role: "researcher",
      durableMission: "Protect user context quality.",
      consolidationState: { status: "runtime_seeded" },
    },
    longTermMemory: [
      {
        nodeId: "old/agent-007/long_term_memory/ltm-policy-current",
        memoryId: "ltm-policy-current",
        category: "semantic",
      },
      {
        nodeId: "old/agent-007/long_term_memory/ltm-policy-previous",
        memoryId: "ltm-policy-previous",
        category: "semantic",
        consolidationState: { status: "superseded" },
      },
      {
        nodeId: "old/agent-007/long_term_memory/ltm-evidence-seeking",
        memoryId: "ltm-evidence-seeking",
        category: "learned_trait",
        learnedTrait: {
          label: "evidence-seeking",
          protectedFromIdentityPromotion: true,
        },
      },
    ],
    memoryEvidence: [
      {
        nodeId: "old/agent-007/memory_evidence/evidence-citation-turn-18",
        evidenceId: "evidence-citation-turn-18",
        kind: "conversation_excerpt",
      },
    ],
    consolidationJournal: [
      {
        nodeId: "old/agent-007/consolidation_record/consolidation-supersede-1",
        recordId: "consolidation-supersede-1",
        operation: "supersede",
        runtimePhase: "idle",
      },
    ],
  },
  edges: [
    {
      relation: "long_term_memory_association",
      from: "old/agent-007/long_term_memory/ltm-policy-current",
      to: "old/agent-007/long_term_memory/ltm-evidence-seeking",
    },
    {
      relation: "long_term_memory_supported_by_evidence",
      from: "old/agent-007/long_term_memory/ltm-policy-current",
      to: "old/agent-007/memory_evidence/evidence-citation-turn-18",
    },
    {
      relation: "long_term_memory_created_by_consolidation",
      from: "old/agent-007/long_term_memory/ltm-policy-current",
      to: "old/agent-007/consolidation_record/consolidation-supersede-1",
    },
    {
      relation: "long_term_memory_supersedes",
      from: "old/agent-007/long_term_memory/ltm-policy-current",
      to: "old/agent-007/long_term_memory/ltm-policy-previous",
    },
  ],
}
```

This graph is valid because:

- Every node id and edge id stays inside the `old/{agentId}/...` identifier scheme.
- Immutable identity exists in Old Generation but does not participate in edges.
- Learned traits remain in `longTermMemory` and keep `protectedFromIdentityPromotion: true`.
- `supportedByEvidence` points only to `memoryEvidence`.
- `createdByConsolidation` points only to `consolidationJournal`.
- `supersedes` points only from a newer long-term memory to a historical one and remains acyclic.

## Canonical Invalid Graphs

These invalid examples are intentionally minimal. Each one breaks exactly one
construction rule and is exercised by the automated test suite.

- `orphaned-supported-by-evidence-edge`
  Remove the evidence node but leave the `supportedByEvidence` edge. The
  validator rejects it because Old Generation edges cannot reference missing
  nodes.
- `relation-to-node-kind-mismatch`
  Retarget `supportedByEvidence` to a consolidation record. The validator
  rejects it because relation semantics are fixed to documented source and
  target node kinds.
- `learned-trait-without-identity-protection`
  Keep a learned trait in `longTermMemory` but set
  `protectedFromIdentityPromotion: false`. The validator rejects it because
  learned traits may never be promoted into immutable identity.
- `supersedes-cycle`
  Add a reverse `supersedes` edge from the historical memory back to the
  current one. The validator rejects it because supersession chains must stay
  acyclic.
- `supersedes-multiple-canonical-successors`
  Add a second current memory that also supersedes the same historical memory.
  The validator rejects it because a historical memory can have only one
  canonical successor.

## Usage

Call `validateOldGenerationGraph(graph)` on batch input before any offline
consolidation plan executes. When you need a worked reference graph for tests or
integration wiring, start from the canonical fixture rather than assembling a
durable graph ad hoc.
