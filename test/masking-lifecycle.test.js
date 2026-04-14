import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
  createYoungGenerationInspectionView,
  createStaleMemoryMaskingDecisions,
  createYoungGenerationRetrievalView,
  evaluateStaleMemories,
  loadYoungGenerationGraphState,
  saveYoungGenerationGraphState,
} from "../src/index.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const createIdentity = () => ({
  agentId: "agent-007",
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality.",
  safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance"],
  runtimeInvariants: { deployment: "sandbox", tenant: "zep" },
  protectedCoreFacts: ["agent-007 belongs to tenant zep"],
});

test("masking eligibility only marks stale memories with maskable low-retention value", () => {
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
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
      {
        memoryId: "defer-me",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.75,
        metadata: {
          memoryKind: MEMORY_NODE_KINDS.workingMemory,
        },
      },
      {
        memoryId: "too-recent",
        createdAt: "2026-04-10T12:00:00Z",
        lastAccessedAt: "2026-04-11T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.05,
        metadata: {
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
    ],
  });

  const maskingStage = createStaleMemoryMaskingDecisions({
    evaluation,
    maskedAt: "2026-04-12T12:10:00Z",
    maskedBy: "idle-consolidation-suggester",
    provenance: {
      source: "offline-suggestion",
      runtimePhase: "idle",
    },
  });

  assert.equal(evaluation.staleCandidateCount, 2);
  assert.deepEqual(
    evaluation.staleCandidates.map((memory) => memory.memoryId),
    ["mask-me", "defer-me"],
  );
  assert.equal(maskingStage.maskedDecisionCount, 1);
  assert.equal(maskingStage.deferredCandidateCount, 1);
  assert.deepEqual(
    maskingStage.maskedDecisions.map((decision) => decision.memoryId),
    ["mask-me"],
  );
  assert.deepEqual(
    maskingStage.deferredCandidates.map((candidate) => candidate.memoryId),
    ["defer-me"],
  );
  assert.equal(maskingStage.maskedDecisions[0].memoryKind, MEMORY_NODE_KINDS.shortTermMemory);
  assert.equal(maskingStage.maskedDecisions[0].inactiveForRetrieval, true);
  assert.equal(
    maskingStage.maskedDecisions[0].masking.provenance.sourceEvaluationMode,
    "offline-suggestion-only",
  );
});

test("stale-memory masking decisions remain masked when materialized into the young-generation graph", () => {
  const evaluation = evaluateStaleMemories({
    now: "2026-04-12T12:00:00Z",
    minimumRecencyMs: 7 * DAY_IN_MS,
    recencyHorizonMs: 30 * DAY_IN_MS,
    accessFrequencyCapPerDay: 1,
    staleThreshold: 0.65,
    memories: [
      {
        memoryId: "stm-stale",
        createdAt: "2026-02-20T12:00:00Z",
        lastAccessedAt: "2026-03-01T12:00:00Z",
        accessCount: 0,
        retentionValue: 0.1,
        metadata: {
          memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        },
      },
    ],
  });

  const maskingStage = createStaleMemoryMaskingDecisions({
    evaluation,
    maskedAt: "2026-04-12T12:15:00Z",
    maskedBy: "idle-consolidation-suggester",
    provenance: {
      source: "offline-suggestion",
      runtimePhase: "idle",
      auditRecordId: "mask-stale-1",
      policyVersion: "stale-memory-v1",
    },
  });
  const [decision] = maskingStage.maskedDecisions;
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: decision.memoryId,
          summary: "Retained only for offline inspection after stale evaluation.",
        },
        inactiveForRetrieval: decision.inactiveForRetrieval,
        masking: decision.masking,
      },
    ],
  });
  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.equal(maskingStage.maskedDecisionCount, 1);
  assert.equal(graph.youngGeneration.shortTermMemory[0].inactiveForRetrieval, true);
  assert.equal(graph.youngGeneration.shortTermMemory[0].masking.isMasked, true);
  assert.equal(graph.youngGeneration.shortTermMemory[0].masking.reason, "stale-low-value");
  assert.equal(graph.youngGeneration.shortTermMemory[0].masking.audit.runtimePhase, "idle");
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Retained only for offline inspection after stale evaluation.",
  );
  assert.equal(retrievalView.shortTermMemory.length, 0);
});

test("consolidation-authored masking metadata forces stale memory envelopes into masked state", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-consolidated",
          summary: "Older milestone recap retained only for offline consolidation.",
        },
        masking: {
          isMasked: true,
          maskedAt: "2026-04-12T12:20:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          audit: {
            auditRecordId: "mask-consolidated-1",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
          },
          provenance: {
            source: "consolidation-record",
            auditRecordId: "mask-consolidated-1",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
          },
        },
      },
    ],
  });
  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.equal(graph.youngGeneration.shortTermMemory[0].inactiveForRetrieval, true);
  assert.equal(graph.youngGeneration.shortTermMemory[0].masking.isMasked, true);
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.sourceField,
    "summary",
  );
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Older milestone recap retained only for offline consolidation.",
  );
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.audit.runtimePhase,
    "sleep",
  );
  assert.equal(
    graph.youngGeneration.shortTermMemory[0].masking.audit.recordedAt,
    "2026-04-12T12:20:00Z",
  );
  assert.equal(retrievalView.shortTermMemory.length, 0);
});

test("inactive-for-retrieval memories disappear from live retrieval but keep stored source records", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-active",
          content: "Current task is launch readiness.",
        },
      },
      {
        record: {
          memoryId: "wm-masked",
          content: "Older rollout draft kept for offline review.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:30:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Older rollout draft kept for offline review.",
            sourceField: "content",
            capturedAt: "2026-04-12T09:30:00Z",
          },
          audit: {
            auditRecordId: "mask-1",
            policyVersion: "stale-memory-v1",
            runtimePhase: "idle",
            recordedAt: "2026-04-12T09:30:00Z",
            actor: "offline-consolidation",
          },
          provenance: {
            source: "offline-suggestion",
            auditRecordId: "mask-1",
          },
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-active",
        agentId: "agent-007",
        memoryId: "wm-active",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.95,
        },
        lastUpdatedAt: "2026-04-12T09:00:00Z",
      },
      {
        entryId: "importance-wm-masked",
        agentId: "agent-007",
        memoryId: "wm-masked",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.35,
        },
        lastUpdatedAt: "2026-04-12T08:30:00Z",
      },
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-active"],
  );
  assert.deepEqual(
    graph.youngGeneration.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-active", "wm-masked"],
  );
  assert.equal(graph.youngGeneration.workingMemory[1].inactiveForRetrieval, true);
  assert.equal(
    graph.youngGeneration.workingMemory[1].masking.maskedOriginalContent.value,
    "Older rollout draft kept for offline review.",
  );
  assert.equal(graph.youngGeneration.workingMemory[1].record.content.includes("offline"), true);
});

test("retrieval results exclude masked memories while leaving unmasked peers retrievable", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Keep the active launch checklist available during runtime work.",
        },
      },
      {
        record: {
          memoryId: "wm-masked-derived",
          content: "Older launch branch preserved only for offline review.",
        },
        masking: {
          isMasked: true,
          maskedAt: "2026-04-12T10:05:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          audit: {
            auditRecordId: "mask-live-1",
            policyVersion: "stale-memory-v1",
            runtimePhase: "idle",
          },
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-live",
          summary: "Fresh contract dependency remains retrievable.",
        },
      },
      {
        record: {
          memoryId: "stm-masked-derived",
          summary: "Older recap held back from live retrieval.",
        },
        masking: {
          isMasked: true,
          maskedAt: "2026-04-12T10:10:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          audit: {
            auditRecordId: "mask-live-2",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
          },
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-live",
        agentId: "agent-007",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.95,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-wm-masked-derived",
        agentId: "agent-007",
        memoryId: "wm-masked-derived",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.15,
        },
        lastUpdatedAt: "2026-04-12T09:55:00Z",
      },
      {
        entryId: "importance-stm-live",
        agentId: "agent-007",
        memoryId: "stm-live",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.82,
        },
        lastUpdatedAt: "2026-04-12T10:01:00Z",
      },
      {
        entryId: "importance-stm-masked-derived",
        agentId: "agent-007",
        memoryId: "stm-masked-derived",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.2,
        },
        lastUpdatedAt: "2026-04-12T09:50:00Z",
      },
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);

  assert.deepEqual(
    retrievalView.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.deepEqual(
    retrievalView.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-live"],
  );
  assert.deepEqual(
    retrievalView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-live", "importance-stm-live"],
  );
  assert.equal(graph.youngGeneration.workingMemory[1].inactiveForRetrieval, true);
  assert.equal(graph.youngGeneration.shortTermMemory[1].inactiveForRetrieval, true);
  assert.equal(graph.youngGeneration.workingMemory[0].inactiveForRetrieval, false);
  assert.equal(graph.youngGeneration.shortTermMemory[0].inactiveForRetrieval, false);
});

test("masked memories remain stored and auditable in young-generation snapshots", () => {
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-masked",
          summary: "Older milestone summary retained for offline consolidation.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T09:45:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Older milestone summary retained for offline consolidation.",
            sourceField: "summary",
            capturedAt: "2026-04-12T09:45:00Z",
          },
          audit: {
            auditRecordId: "mask-7",
            policyVersion: "stale-memory-v1",
            runtimePhase: "sleep",
            recordedAt: "2026-04-12T09:45:00Z",
            actor: "offline-consolidation",
          },
          provenance: {
            source: "offline-suggestion",
            auditRecordId: "mask-7",
            policyVersion: "stale-memory-v1",
          },
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-stm-masked",
        agentId: "agent-007",
        memoryId: "stm-masked",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.4,
        },
        lastUpdatedAt: "2026-04-12T09:40:00Z",
        provenance: {
          source: "runtime",
        },
      },
    ],
  });

  const retrievalView = createYoungGenerationRetrievalView(graph);
  const savedState = saveYoungGenerationGraphState(graph);
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(graph.oldGeneration.immutableIdentity),
    JSON.parse(JSON.stringify(savedState)),
  );

  assert.equal(retrievalView.shortTermMemory.length, 0);
  assert.equal(retrievalView.importanceIndex.length, 0);
  assert.equal(savedState.youngGeneration.shortTermMemory.length, 1);
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].record.memoryId,
    "stm-masked",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].record.summary,
    "Older milestone summary retained for offline consolidation.",
  );
  assert.equal(savedState.youngGeneration.shortTermMemory[0].inactiveForRetrieval, true);
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.provenance.auditRecordId,
    "mask-7",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.provenance.policyVersion,
    "stale-memory-v1",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.audit.auditRecordId,
    "mask-7",
  );
  assert.equal(
    savedState.youngGeneration.shortTermMemory[0].masking.maskedOriginalContent.value,
    "Older milestone summary retained for offline consolidation.",
  );
  assert.deepEqual(
    savedState.youngGeneration.importanceIndex.map((entry) => entry.entryId),
    ["importance-stm-masked"],
  );
  assert.equal(
    restoredGraph.youngGeneration.shortTermMemory[0].masking.provenance.auditRecordId,
    "mask-7",
  );
  assert.equal(
    restoredGraph.youngGeneration.shortTermMemory[0].masking.audit.runtimePhase,
    "sleep",
  );
  assert.equal(
    restoredGraph.youngGeneration.shortTermMemory[0].record.memoryId,
    "stm-masked",
  );
});

test("inspection access does not resurrect stale masked memories into later retrieval results after restore", () => {
  const graph = createMemoryGraph(createIdentity(), {
    workingMemory: [
      {
        record: {
          memoryId: "wm-live",
          content: "Keep the active rollout checkpoint available during runtime work.",
        },
      },
    ],
    shortTermMemory: [
      {
        record: {
          memoryId: "stm-stale",
          summary: "Older rollout summary retained only for offline consolidation.",
        },
        inactiveForRetrieval: true,
        masking: {
          maskedAt: "2026-04-12T10:05:00Z",
          maskedBy: "offline-consolidation",
          reason: "stale-window",
          maskedOriginalContent: {
            value: "Older rollout summary retained only for offline consolidation.",
            sourceField: "summary",
            capturedAt: "2026-04-12T10:05:00Z",
          },
          audit: {
            auditRecordId: "mask-stale-restore-1",
            policyVersion: "stale-memory-v2",
            runtimePhase: "sleep",
            recordedAt: "2026-04-12T10:05:00Z",
            actor: "offline-consolidation",
          },
          provenance: {
            source: "offline-suggestion",
            auditRecordId: "mask-stale-restore-1",
          },
        },
      },
    ],
    importanceIndex: [
      {
        entryId: "importance-wm-live",
        agentId: "agent-007",
        memoryId: "wm-live",
        memoryKind: MEMORY_NODE_KINDS.workingMemory,
        signals: {
          taskRelevance: 0.94,
        },
        lastUpdatedAt: "2026-04-12T10:00:00Z",
      },
      {
        entryId: "importance-stm-stale",
        agentId: "agent-007",
        memoryId: "stm-stale",
        memoryKind: MEMORY_NODE_KINDS.shortTermMemory,
        signals: {
          recallPriority: 0.18,
        },
        lastUpdatedAt: "2026-04-12T09:40:00Z",
      },
    ],
  });
  const savedState = JSON.parse(JSON.stringify(saveYoungGenerationGraphState(graph)));
  const restoredGraph = loadYoungGenerationGraphState(
    createMemoryGraph(graph.oldGeneration.immutableIdentity),
    savedState,
  );
  const retrievalBeforeInspection = createYoungGenerationRetrievalView(restoredGraph);
  const inspectionView = createYoungGenerationInspectionView(restoredGraph);
  const retrievalAfterInspection = createYoungGenerationRetrievalView(restoredGraph);

  assert.deepEqual(
    retrievalBeforeInspection.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.equal(retrievalBeforeInspection.shortTermMemory.length, 0);
  assert.deepEqual(
    retrievalBeforeInspection.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-live"],
  );
  assert.equal(savedState.youngGeneration.shortTermMemory[0].inactiveForRetrieval, true);
  assert.deepEqual(
    inspectionView.shortTermMemory.map((memory) => memory.record.memoryId),
    ["stm-stale"],
  );
  assert.equal(
    inspectionView.shortTermMemory[0].record.summary,
    "Older rollout summary retained only for offline consolidation.",
  );
  assert.deepEqual(
    inspectionView.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-live", "importance-stm-stale"],
  );
  assert.deepEqual(
    retrievalAfterInspection.workingMemory.map((memory) => memory.record.memoryId),
    ["wm-live"],
  );
  assert.equal(retrievalAfterInspection.shortTermMemory.length, 0);
  assert.deepEqual(
    retrievalAfterInspection.importanceIndex.map((entry) => entry.entryId),
    ["importance-wm-live"],
  );
});
