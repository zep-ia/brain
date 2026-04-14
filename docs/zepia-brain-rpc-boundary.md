# Zepia To Brain Process Boundary

`zepia` and the Go `brain` port should be separated by a transport-neutral RPC
contract, not by shared in-process mutation and not by RDMA.

## Recommendation

- `zepia` remains the runtime authority.
- `brain` becomes an offline consolidation service.
- The boundary should use request-response RPC over `gRPC`, `Connect`, or a
  Unix-domain-socket HTTP API.

## Why RPC

- `zepia` owns the live runtime phase and must explicitly authorize `idle`,
  `rest`, `break`, or `sleep`.
- `brain` should consume graph snapshots and return offline plans, archival
  transitions, promotion selections, and persistence intents.
- The contract is naturally coarse-grained and structured, so RPC is a good
  fit for process isolation, retries, versioning, and observability.

## Why Not RDMA At This Boundary

- RDMA is useful only when moving large tensor or model-serving payloads between
  high-throughput workers on a tightly controlled cluster.
- The `zepia -> brain` boundary mostly exchanges structured metadata and graph
  snapshots, not GPU-sized tensor streams.
- Introducing RDMA here would raise operational complexity without solving the
  actual authority and contract problem.

## Where RDMA Could Still Matter

- Inside the `brain` backend, between the offline planner and a future
  GPU-heavy consolidation worker pool on B200 infrastructure.
- Even there, RDMA should stay hidden behind the `brain` service boundary.
  `zepia` should still speak normal RPC to `brain`.

## Suggested API Shape

1. `EvaluateIdleWindow`
   `zepia` sends `agentId`, runtime phase, optional inactivity suggestion, and
   `teamIdle`.
   `brain` returns one authorization decision.

2. `RequestOfflineConsolidationPlan`
   `zepia` sends request metadata, preset id, runtime phase, optional priority
   memory ids, and batch profile hints.
   `brain` returns either one validated batch plan or a structured rejection.

3. `ExecuteOfflineBatchPlan`
   `brain` executes or coordinates the already-authorized offline plan and
   rechecks runtime phase before each work unit.

4. `PersistLongTermMemory`
   `brain` writes durable long-term memory only after runtime authorization has
   been revalidated.

## Resume checkpoint

Delta-only RPC sync needs one durable cursor per
`agentId + syncSource + streamId`.

- `brain` should persist that checkpoint only after the corresponding
  consolidation write has completed successfully.
- The checkpoint record should carry the last committed resume position as an
  opaque `cursorToken`, numeric `sequence`, `eventId`, and/or timestamp
  `watermark`.
- Replays are safer than gaps, so a failed consolidation must not advance the
  checkpoint.
- The checkpoint should be transport-neutral so the same record works whether
  the boundary uses `gRPC`, `Connect`, or a Unix-domain-socket HTTP transport.

The Go port exposes this contract in [service_contract.go](/Users/jaegyu.lee/zep/brain/go/service_contract.go:1).
