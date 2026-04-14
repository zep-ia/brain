# Brain + Zepia: Agents That Remember

**A neuroplastic memory framework for AI agents that live, not just run.**

---

## The Problem

Every AI agent platform treats memory the same way: a sliding context window that forgets everything when the conversation ends. Agents complete tasks but never grow. They respond but never learn. They exist in an eternal present, repeating the same mistakes, forgetting the same hard-won insights.

This is not a technical limitation. It is an architectural failure.

An agent that cannot remember cannot:
- Build trust over repeated interactions
- Recognize patterns across sessions
- Prioritize what matters based on accumulated experience
- Distinguish secrets from shared knowledge

Memory is not a feature. Memory is the substrate of identity.

---

## The Vision

**Brain** is a neuroplasticity-based memory framework inspired by HippoRAG (NeurIPS 2024) that gives AI agents a structured, durable memory system modeled after how biological brains actually work.

**Zepia** is an AI agent civilization engine where LLM-powered agents live, work, and interact in a real-time 2D metaverse.

Together, they create agents that do not just execute tasks but accumulate experience, develop importance-weighted knowledge, and evolve over time.

```
                    Zepia (Runtime Authority)
                    ┌─────────────────────────┐
                    │  Live agent interactions  │
                    │  Tool calls, conversations│
                    │  Idle triggers, phases    │
                    └────────┬────────────────┘
                             │ RPC (delta-only payload)
                             │
                    Brain (Memory Authority)
                    ┌────────┴────────────────┐
                    │  Working  ──> Short-term  │
                    │       │            │      │
                    │       v            v      │
                    │   Hippocampus (PageRank)  │
                    │       │                   │
                    │       v                   │
                    │   Long-term Memory        │
                    │   (durable, ranked)        │
                    └───────────────────────────┘
```

---

## Why Biological Memory?

The human brain does not store everything equally. It uses a four-stage pipeline that has been refined by 500 million years of evolution:

1. **Working memory** holds what you are actively thinking about right now.
2. **Short-term memory** buffers recent experiences that might matter.
3. **Hippocampus** indexes and scores experiences by importance during idle rest.
4. **Long-term memory** stores what proved important, durable and retrievable.

This is not arbitrary. Sleep researchers have shown that the hippocampus replays recent experiences during rest, strengthening important connections and discarding noise. The brain literally consolidates memories when you are idle.

Brain implements this exact pipeline for AI agents.

---

## How It Works

### The Four-Stage Memory Pipeline

**Stage 1: Working Memory**
The agent's active context. What it is reasoning about right now. Capped at 1M tokens as a context window boundary.

**Stage 2: Short-Term Memory**
A buffer between active work and deep consolidation. Recent episodes that might matter later. Secrets are retained here during the session but are pruned before advancing further.

**Stage 3: Hippocampus (Importance Indexing)**
The critical gate. During idle windows, the system:
- Builds a **knowledge graph** where memories are nodes and tool-call co-references are bidirectional edges
- Computes **weighted PageRank** scores to rank memory importance
- Applies **temporal edge decay** using exponential decay formula (`weight * e^(-lambda * elapsed)`)
- Loads **tool weights** from a configurable file to reflect domain-specific relevance

**Stage 4: Long-Term Memory**
Only the **Top-K** highest-scoring memories are promoted. Everything else stays in short-term until the next idle trigger. Long-term memories persist across sessions through a pluggable storage adapter.

### Why PageRank?

PageRank was originally designed to rank web pages by importance based on link structure. Brain applies the same principle to memories: a memory that is frequently referenced by other memories through tool calls is more important than one that stands alone.

This produces mathematically grounded importance scores rather than arbitrary heuristics. The implementation includes:
- Sink mass redistribution for nodes with no outgoing edges
- Configurable damping factor (default 0.85)
- Convergence detection with configurable tolerance (default 1e-9)
- Personalization vectors for biased traversal

### The Idle Consolidation Window

Consolidation does not happen during active work. It happens when the agent is idle, just like biological sleep.

Zepia controls the runtime phase. Only explicit phase changes to `idle`, `rest`, `break`, or `sleep` authorize consolidation. Inactivity heuristics can suggest a window, but they cannot force one. This is a deliberate safety boundary.

```
Agent active ──> Agent goes idle ──> Zepia authorizes ──> Brain consolidates
                 (heuristic)        (explicit phase)     (PageRank + Top-K)
```

### Secret Safety

Secrets (API keys, tokens, passwords, private keys) are detected at the hippocampus boundary using 8 pattern detectors and never reach long-term memory. They are retained in short-term memory during the session for agent functionality but are pruned before promotion.

The detection system covers: OpenAI keys, GitHub tokens, AWS access keys, JWTs, Slack tokens, Bearer tokens, private key blocks, and inline secret assignments.

---

## The Zepia-Brain Contract

Zepia is the runtime authority. Brain is the memory authority. They communicate through a delta-only RPC contract:

| Endpoint | Direction | Purpose |
|----------|-----------|---------|
| `EvaluateIdleWindow` | Zepia -> Brain | Check if an agent's phase authorizes consolidation |
| `RequestOfflineConsolidationPlan` | Zepia -> Brain | Generate an ordered batch of consolidation work |
| `ExecuteOfflineBatchPlan` | Brain (internal) | Execute the plan with re-authorization checks |
| `PersistLongTermMemory` | Brain (internal) | Write durable memory after validation |

The payload is always **delta-only**: only changes since the last consolidation checkpoint are transmitted. This minimizes bandwidth and makes the contract resumable after interruptions.

---

## Design Principles

**Correctness over performance.** A wrong memory is worse than a missing memory. The system validates referential integrity at every transition and preserves memory IDs immutably through the entire consolidation lifecycle.

**Agent-scoped isolation.** Each agent owns its own memory graph. Memories never merge across agents. Identity (agent ID, persona, role, safety constraints) is immutable and cannot be overwritten by learned traits.

**Offline-only consolidation.** The live working loop is never blocked by memory maintenance. Consolidation happens exclusively during authorized idle windows and is decoupled from the agent's active reasoning.

**Advisory signals, mandatory gates.** Heuristics (inactivity timers, stale-memory scores, team-idle coordination) suggest windows. Only explicit runtime phase changes open them.

**Fail-closed on secrets.** If a secret cannot be redacted (e.g., in an excluded ID field), it is blocked, not passed through. The system reports unredactable findings explicitly.

---

## What This Enables

When agents can remember, entirely new categories of behavior become possible:

**Trust accumulation.** An agent that remembers past interactions with a user can build genuine trust over time, not just simulate rapport.

**Cross-session learning.** Patterns discovered in one session persist into the next. The agent improves with experience, not just with prompt engineering.

**Importance-aware reasoning.** Not all memories are equal. PageRank-weighted retrieval ensures the agent focuses on what has proven important across its entire history.

**Multi-agent memory.** In the Zepia metaverse, agents share a workspace but maintain isolated memory graphs. Tool calls between agents create co-reference edges that feed into importance scoring without leaking private state.

**Durable identity.** An agent's core identity (role, mission, safety constraints) is stored in immutable fields that consolidation can never overwrite. The agent evolves without losing itself.

---

## The Bigger Picture

The AI industry is converging on a fundamental insight: the next leap in agent capability will not come from larger models or more tools. It will come from **persistent, structured memory that allows agents to accumulate experience the way humans do**.

Brain and Zepia are an implementation of that insight. Brain provides the memory substrate. Zepia provides the world where memory matters.

An agent that remembers is not a better chatbot. It is a different kind of system entirely.

---

## Project Structure

```
brain/
  src/
    index.js                              # Core memory graph schemas and factories
    index.d.ts                            # TypeScript definitions
    pagerank.js                           # Weighted PageRank with temporal decay
    hippocampus-secret-policy.js          # Secret detection and redaction
    runtime-phase.js                      # Idle window authorization
    zepia-consolidation-payload-builder.js # Delta-only payload construction
    zepia-consolidation-config.js          # Per-agent TopK configuration
    zepia-tool-call-tracking.js            # Bidirectional co-reference edge creation
    offline-consolidation-plan-builder.js  # Consolidation plan generation
    batch-plan.js                         # Batch work unit modeling
    offline-batch-executor.js             # Offline plan execution
    team-idle-batch.js                    # Team-wide idle coordination
    stale-memory.js                       # Staleness detection and archival
  test/                                   # 344 tests, 22K+ lines
  test-support/                           # Test fixtures and harnesses
  docs/                                   # Architecture and contract documentation
```

---

## Status

The core framework is complete with full test coverage (344 tests passing). The four-stage memory pipeline, weighted PageRank scoring, hippocampal secret detection, delta-only RPC payload construction, and long-term persistence are all implemented and verified.

The remaining work is operational: connecting the RPC boundary to Zepia's runtime, implementing the default SQLite storage adapter, and deploying the brain process alongside the Zepia server.

---

## License

MIT
