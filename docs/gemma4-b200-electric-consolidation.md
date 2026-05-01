# Gemma 4 on B200 + Electric Consolidation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Run Gemma 4-backed memory intelligence on B200 workers while Electric provides the durable stream and Postgres read-sync plane for `brain` consolidation.

**Architecture:** Keep the live runtime boundary boring and safe: Zepia/Hermes/Ouroboros talk to `brain` over coarse-grained RPC, not shared memory or RDMA. Electric records and fans out durable agent events, while B200 workers execute offline-only embedding, reranking, summarization, deduplication, stale-memory, and contradiction passes during caller-authorized idle/rest/break/sleep windows.

**Tech Stack:** Electric Streams, Electric Postgres Sync/Shapes, Postgres logical replication, `@zep/brain`, Gemma 4 serving on B200 worker pool, RPC/Connect/gRPC/Unix socket HTTP for runtime-to-brain control.

---

## Non-negotiable invariants

1. **Electric is not the writer of record.** Writes still go through the existing backend or brain durable write path; Electric observes Postgres and syncs read shapes.
2. **No RDMA across the live runtime boundary.** RDMA may exist only inside the B200 worker pool, hidden behind the brain service boundary.
3. **Offline-only consolidation.** Gemma 4/B200 work must run only after caller-controlled runtime authorization: `idle`, `rest`, `break`, or `sleep`.
4. **Checkpoint after durable write.** Stream checkpoints advance only after the related consolidation write commits. Replay is safer than a gap.
5. **Agent-scoped identity.** Team idle can batch work, but it must not merge agent identity or overwrite namespaces.

## Target architecture

```text
Hermes / Ouroboros / Zepia runtime
  -> Electric Streams append-only event log
  -> ingestion worker
  -> Postgres tables
  -> Electric Postgres Shapes for realtime UI / agents
  -> brain offline consolidation planner
  -> Gemma 4 on B200 worker pool
  -> durable memory writes
  -> checkpoint commit
```

## Initial Postgres tables

- `agent_events`: normalized prompt/tool/output/correction events with stream offsets.
- `tool_calls`: tool invocation references and co-reference evidence.
- `memory_candidates`: candidate memories awaiting consolidation.
- `short_term_memory`: young-generation buffered memories.
- `long_term_memory`: promoted durable memories.
- `consolidation_jobs`: offline work requests and authorization snapshots.
- `consolidation_runs`: execution metadata, blocked reasons, and worker output summaries.
- `stream_checkpoints`: one durable cursor per `agentId + syncSource + streamId`.

## Electric Shapes

- `agent_events where session_id = $session_id`
- `memory_candidates where agent_id = $agent_id and status in ('pending', 'deferred')`
- `long_term_memory where agent_id = $agent_id`
- `consolidation_jobs where status in ('queued', 'running', 'blocked')`
- `stream_checkpoints where agent_id = $agent_id`

## Gemma 4 / B200 worker responsibilities

1. `embedding-generation`: local/private embeddings for candidate memories and event summaries.
2. `memory-candidate-reranking`: rank candidates against task/project/user context.
3. `hippocampus-summary-distillation`: compress noisy sessions into stable memory entries.
4. `near-duplicate-clustering`: collapse semantically duplicate candidates before promotion.
5. `stale-memory-detection`: identify memories that should be masked or archived.
6. `contradiction-screening`: detect conflicts before overwriting durable memory.

## Bite-sized implementation sequence

### Task 1: Contract guard for the deployment plan

**Objective:** Add a small JS contract object that encodes the safe Gemma 4/B200/Electric architecture.

**Files:**
- Create: `src/gemma4-b200-electric-plan.js`
- Modify: `src/index.js`
- Modify: `src/index.d.ts`
- Test: `test/gemma4-b200-electric-plan.test.js`

**Verification:**

```sh
npm test -- test/gemma4-b200-electric-plan.test.js
```

### Task 2: Electric event ingestion adapter

**Objective:** Convert Electric stream events into normalized brain event rows without advancing checkpoints until persistence succeeds.

**Files:**
- Create: `src/electric-event-ingestion.js`
- Test: `test/electric-event-ingestion.test.js`

**Required tests:**
- Fails closed when stream id or offset is missing.
- Produces one checkpoint intent per `agentId + syncSource + streamId`.
- Does not mark checkpoint committable before durable memory write result exists.

### Task 3: Postgres Shape contract

**Objective:** Declare the minimum shape names and table/where contracts expected by dashboards and agents.

**Files:**
- Create: `src/electric-shape-contract.js`
- Test: `test/electric-shape-contract.test.js`

**Required tests:**
- Shape table list contains `agent_events`, `memory_candidates`, `long_term_memory`, `consolidation_jobs`, and `stream_checkpoints`.
- Memory candidate shape is agent-scoped.
- Long-term memory shape is agent-scoped.

### Task 4: B200 worker capability profile

**Objective:** Separate architecture-level B200 profile from numeric benchmarks and keep the first version benchmark-free.

**Files:**
- Modify: `src/gemma4-b200-electric-plan.js`
- Test: `test/gemma4-b200-electric-plan.test.js`

**Required tests:**
- Profile includes Gemma 4 model family and B200 accelerator class.
- Profile includes embeddings/reranking/summarization capabilities.
- Profile does not promise numeric throughput.

### Task 5: Integration docs

**Objective:** Expand this plan into operational docs once adapters exist.

**Files:**
- Modify: `docs/gemma4-b200-electric-consolidation.md`

**Verification:**
- Docs distinguish Electric read sync from durable write authority.
- Docs state RDMA is hidden inside worker pool only.
- Docs include checkpoint failure/replay behavior.

## Open decisions

- Exact Gemma 4 serving stack: vLLM, SGLang, TensorRT-LLM, or custom worker.
- Embedding model split: Gemma 4 native embeddings if available vs separate embedding model on the same B200 pool.
- Whether Electric Streams is the primary raw log or whether Postgres remains the primary log with streams as append/read façade.
- Whether B200 workers consume jobs directly from Postgres, a queue, or a brain RPC dispatcher.
