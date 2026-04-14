import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STALE_MEMORY_WEIGHTS,
  createStaleMemoryMaskingDecisions,
  evaluateStaleMemories,
} from "../src/index.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

test("stale-memory evaluation ranks low-value stale candidates by recency, access frequency, and retention value", () => {
  const result = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 4,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "old-cold-low-value",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 1,
        retentionValue: 0.15,
        metadata: {
          memoryKind: "short_term_memory",
        },
      },
      {
        memoryId: "old-but-valuable",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-04-02T12:00:00Z",
        accessCount: 10,
        retentionValue: 0.95,
      },
      {
        memoryId: "recent-hot-high-value",
        createdAt: "2026-04-10T12:00:00Z",
        lastAccessedAt: "2026-04-12T11:30:00Z",
        accessCount: 12,
        retentionValue: 0.92,
      },
    ],
  });

  assert.deepEqual(DEFAULT_STALE_MEMORY_WEIGHTS, {
    recency: 0.4,
    accessFrequency: 0.25,
    retentionValue: 0.35,
  });
  assert.equal(result.evaluationMode, "offline-suggestion-only");
  assert.equal(result.staleCandidateCount, 1);
  assert.deepEqual(
    result.staleCandidates.map((memory) => memory.memoryId),
    ["old-cold-low-value"],
  );
  assert.equal(result.scoredMemories[0].memoryId, "old-cold-low-value");
  assert.equal(result.scoredMemories[0].metadata.memoryKind, "short_term_memory");
  assert.ok(result.scoredMemories[0].staleScore > result.scoredMemories[1].staleScore);
  assert.ok(result.scoredMemories[0].reasons.includes("stale-recency"));
  assert.ok(result.scoredMemories[0].reasons.includes("low-access-frequency"));
  assert.ok(result.scoredMemories[0].reasons.includes("low-retention-value"));
  assert.equal(
    result.scoredMemories.find((memory) => memory.memoryId === "old-but-valuable")
      .staleCandidate,
    false,
  );
});

test("minimum recency blocks false positives even when the composite stale score is high", () => {
  const result = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "recent-but-low-value",
        createdAt: "2026-04-06T12:00:00Z",
        lastAccessedAt: "2026-04-06T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.05,
      },
    ],
  });

  assert.equal(result.staleCandidateCount, 0);
  assert.equal(result.scoredMemories[0].staleCandidate, false);
  assert.ok(result.scoredMemories[0].staleScore > result.staleThreshold);
  assert.ok(result.scoredMemories[0].recencyMs < result.minimumRecencyMs);
});

test("stale-memory evaluation rejects invalid temporal ordering", () => {
  assert.throws(
    () =>
      evaluateStaleMemories({
        now: "2026-04-12T12:00:00Z",
        memories: [
          {
            memoryId: "broken-memory",
            createdAt: "2026-04-12T12:00:00Z",
            lastAccessedAt: "2026-04-11T12:00:00Z",
            accessCount: 1,
            retentionValue: 0.2,
          },
        ],
      }),
    /lastAccessedAt must not be earlier than createdAt/,
  );
});

test("masking-stage helper converts only low-value stale candidates into mask decisions", () => {
  const evaluation = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "mask-me",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.15,
        metadata: {
          memoryKind: "short_term_memory",
        },
      },
      {
        memoryId: "defer-me",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.7,
        metadata: {
          memoryKind: "working_memory",
        },
      },
    ],
  });

  const result = createStaleMemoryMaskingDecisions({
    evaluation,
    maskedAt: "2026-04-12T12:05:00Z",
    maskedBy: "idle-consolidation-suggester",
    provenance: {
      source: "offline-suggestion",
      runtimePhase: "idle",
    },
  });

  assert.equal(result.maskedDecisionCount, 1);
  assert.equal(result.deferredCandidateCount, 1);
  assert.equal(result.maskedDecisions[0].memoryId, "mask-me");
  assert.equal(result.maskedDecisions[0].memoryKind, "short_term_memory");
  assert.equal(result.maskedDecisions[0].inactiveForRetrieval, true);
  assert.equal(result.maskedDecisions[0].masking.isMasked, true);
  assert.equal(result.maskedDecisions[0].masking.maskedAt, "2026-04-12T12:05:00.000Z");
  assert.equal(
    result.maskedDecisions[0].masking.maskedBy,
    "idle-consolidation-suggester",
  );
  assert.equal(result.maskedDecisions[0].masking.reason, "stale-low-value");
  assert.equal(result.maskedDecisions[0].masking.maskUpdatedAt, "2026-04-12T12:05:00.000Z");
  assert.equal(result.maskedDecisions[0].masking.maskedOriginalContent, null);
  assert.equal(result.maskedDecisions[0].masking.audit.runtimePhase, "idle");
  assert.equal(
    result.maskedDecisions[0].masking.audit.recordedAt,
    "2026-04-12T12:05:00.000Z",
  );
  assert.equal(result.maskedDecisions[0].masking.provenance.source, "offline-suggestion");
  assert.equal(result.deferredCandidates[0].memoryId, "defer-me");
});

test("masking-stage helper defaults maskedAt to evaluation time and preserves missing memory kinds as null", () => {
  const evaluation = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "mask-defaults",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.1,
      },
    ],
  });

  const result = createStaleMemoryMaskingDecisions({
    evaluation,
  });

  assert.equal(result.decisionMode, "offline-suggestion-only");
  assert.equal(result.maskedAt, evaluation.evaluatedAt);
  assert.equal(result.maskedBy, "offline-consolidation");
  assert.equal(result.reason, "stale-low-value");
  assert.equal(result.maskedDecisions[0].memoryKind, null);
  assert.equal(
    result.maskedDecisions[0].masking.provenance.sourceEvaluationAt,
    evaluation.evaluatedAt,
  );
  assert.equal(
    result.maskedDecisions[0].masking.audit.sourceEvaluationMode,
    evaluation.evaluationMode,
  );
});
