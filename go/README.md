# Go Brain

Go port of the `brain` framework.

## Scope

This port covers the full operational surface of the framework:

- young and old memory graph modeling
- runtime-phase authorization
- stale-memory scoring and masking suggestions
- offline promotion planning
- archival transitions
- long-term-memory serialization and persistence
- offline batch limits, plans, scheduling, and execution
- offline consolidation request presets and plan building
- team-idle batching
- a transport-neutral service contract for `zepia -> brain` RPC boundaries

## Run

```bash
cd brain/go
go test ./...
```

## Boundary

Use the Go package as either:

- an embedded library inside a Go worker process, or
- the implementation behind a separate RPC service that `zepia` calls.

The recommended process boundary is documented in
[`../docs/zepia-brain-rpc-boundary.md`](../docs/zepia-brain-rpc-boundary.md).
