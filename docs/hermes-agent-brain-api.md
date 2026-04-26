# Hermes / Generic Agent Brain API

This document describes the transport-neutral agent-facing API added on top of
`@zep/brain` so runtimes other than Zepia can experiment with the memory graph
and consolidation primitives.

## Intent

The original Zepia integration keeps Zepia as the runtime authority and Brain as
the memory authority. The generic Agent Brain API keeps that safety model but
removes the Zepia-specific payload assumption:

- callers provide generic agent events, references, and tool-call co-references;
- Brain builds an agent-scoped memory graph with no Zepia coupling;
- Brain runs a bounded PageRank experiment, defaulting to **90 iterations**;
- Brain returns ranked long-term candidates only after the hippocampus secret
  boundary passes.

This is intended for Hermes-style agents, CLI agents, chat agents, and future
service adapters that want to evaluate Brain without embedding the Zepia runtime.

## Public API

```js
import {
  AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS,
  buildAgentBrainMemoryGraph,
  runAgentBrainExperiment,
} from "@zep/brain";
```

### `buildAgentBrainMemoryGraph(input)`

Input:

```js
{
  agentId: "hermes-agent",
  events: [
    {
      id: "evt-1",
      kind: "conversation",
      content: "User wants project-aware Gmail labels.",
      summary: "Project-aware Gmail labeling preference.",
      references: ["evt-2"],
      signals: {
        userCorrection: 0.9,
        projectRelevance: 0.8
      },
      metadata: { source: "discord" }
    }
  ],
  toolCalls: [
    {
      id: "tool-1",
      toolName: "gmail.label.apply",
      sourceEventIds: ["evt-1"],
      referencedEventIds: ["evt-2"],
      weight: 2
    }
  ]
}
```

Output:

```js
{
  apiKind: "agent_brain_api_graph",
  schemaVersion: "1.0.0",
  agentId: "hermes-agent",
  zepiaCoupling: "none",
  nodes: [...],
  toolCalls: [...],
  edges: [...]
}
```

Edges are created from explicit event references and bidirectional tool-call
co-references. Unknown references and self-links are skipped.

### `runAgentBrainExperiment(input)`

Input extends `buildAgentBrainMemoryGraph()` with:

```js
{
  runtime: {
    phase: "idle",
    authority: "caller"
  },
  iterations: 90,
  topK: 5
}
```

Rules:

- `events` and `toolCalls` are optional arrays. Supplying any other shape fails
  closed with a typed error instead of being silently ignored.
- Event `id` / `memoryId` values must be unique within one agent graph.
- `iterations` defaults to `AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS`, which
  is `90`, and is passed to PageRank as the maximum iteration budget. Custom
  iteration budgets are echoed in the promotion reason for experiment traceability.
- `topK` defaults to `5`.
- Runtime authorization still uses the existing idle-window contract. The generic
  API does not self-authorize active-loop consolidation.
- Long-term candidates are passed through the hippocampus output secret boundary.
- Unredactable secrets block the experiment result and return no long-term
  candidates.

Output:

```js
{
  apiKind: "agent_brain_experiment_result",
  status: "completed",
  iterationsRequested: 90,
  runtimeAuthorization: { authorized: true, phase: "idle" },
  pageRank: {
    maxIterations: 90,
    iterationsCompleted: "<= 90",
    scores: { ... }
  },
  rankedMemories: [...],
  longTermCandidates: [...]
}
```

## Hermes usage pattern

Hermes can use this as an offline consolidation experiment:

1. Capture candidate memories from chat, tool calls, email, calendar, docs, and
   project context.
2. Normalize them into generic events with stable ids.
3. Attach references between related events and tool-call evidence.
4. Run `runAgentBrainExperiment()` during an idle/session-end/daily maintenance
   window with `iterations: 90`.
5. Persist only the returned `longTermCandidates` after applying any Hermes-local
   project/user memory policy.

## Why this is separate from Zepia

The API deliberately reports `zepiaCoupling: "none"`. It does not replace the
Zepia RPC boundary; it provides a reusable adapter surface so Brain can be used
by other agent runtimes while preserving the same safety invariants:

- caller-authorized idle window;
- agent-scoped graph;
- PageRank-based importance ranking;
- Top-K promotion;
- fail-closed secret boundary.
