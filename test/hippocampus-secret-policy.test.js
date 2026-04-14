import test from "node:test";
import assert from "node:assert/strict";

import {
  HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS,
  HIPPOCAMPUS_SECRET_DETECTOR_IDS,
  MEMORY_NODE_KINDS,
  createHippocampusSecretRedactionPolicy,
  createMemoryGraph,
  createRuntimePhase,
  planConsolidationPromotions,
  sanitizeHippocampusBoundaryPayload,
  serializePromotionSelectionToLongTermMemoryEntry,
} from "../src/index.js";
import {
  TEST_HIPPOCAMPUS_SECRETS,
  createInactiveShortTermMemoryEnvelope,
  createShortTermSecretFixture,
} from "../test-support/hippocampus-secret-fixtures.js";

const createIdentity = () => ({
  agentId: "agent-007",
  persona: "deliberate analyst",
  role: "researcher",
  durableMission: "Protect user context quality.",
  safetyConstraints: ["never overwrite identity", "stay offline while consolidating"],
  ownership: ["customer-insight-domain"],
  nonNegotiablePreferences: ["preserve provenance"],
  runtimeInvariants: {
    deployment: "sandbox",
    tenant: "zep",
  },
  protectedCoreFacts: ["agent-007 belongs to tenant zep"],
});

const createPromotionCandidate = (sourceMemoryId, overrides = {}) => ({
  candidateId: `promo-${sourceMemoryId}`,
  agentId: "agent-007",
  sourceMemoryId,
  sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  signals: {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-14T10:05:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: [`importance-${sourceMemoryId}`],
        signals: {
          taskRelevance: 0.95,
          userSpecificity: 0.91,
        },
      },
      stability: {
        capturedAt: "2026-04-14T10:05:00Z",
        sourceCollection: "shortTermMemory",
        sourceRecordIds: [sourceMemoryId],
        signals: {
          repeatedRecall: 0.88,
          crossEpisodeConsistency: 0.9,
        },
      },
    },
  },
  ...overrides,
});

test("hippocampus boundary sanitizer redacts secrets without leaking raw values", () => {
  const fixture = createShortTermSecretFixture({
    memoryId: "stm-secret-1",
    redactionPlaceholder: "[SANITIZED]",
  });
  const policy = createHippocampusSecretRedactionPolicy({
    redactionPlaceholder: "[SANITIZED]",
  });
  const result = sanitizeHippocampusBoundaryPayload(fixture.sanitizerPayload, {
    direction: "input",
    policy,
  });
  const serializedResult = JSON.stringify(result);

  assert.deepEqual(HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS, ["input", "output"]);
  assert.ok(HIPPOCAMPUS_SECRET_DETECTOR_IDS.includes("openai-api-key"));
  assert.equal(result.direction, "input");
  assert.equal(result.policyId, "hippocampus-secret-redaction-policy");
  assert.deepEqual(result.sanitizedPayload, fixture.expectedSanitizedPayload);
  fixture.expectedRedactedPaths.forEach((path) => {
    assert.ok(result.redactedPaths.includes(path));
  });
  assert.ok(result.findingCount >= 5);
  assert.equal(
    fixture.sanitizerPayload.metadata.password,
    TEST_HIPPOCAMPUS_SECRETS.password,
  );

  fixture.rawSecretValues.forEach((secret) => {
    assert.equal(serializedResult.includes(secret), false);
  });
  assert.ok(
    result.findings.every(
      (finding) =>
        finding.fingerprint.startsWith("sha256:") &&
        !JSON.stringify(finding).includes(TEST_HIPPOCAMPUS_SECRETS.openAiApiKey),
    ),
  );
});

test("hippocampus boundary sanitizer reports unredactable secrets in immutable identity fields", () => {
  const payload = {
    content: {
      memoryId: TEST_HIPPOCAMPUS_SECRETS.openAiApiKey,
      category: "semantic",
      content: "Safe durable note.",
      summary: "Safe durable note.",
    },
    metadata: {
      agentId: "agent-007",
      nodeId: `old/agent-007/long_term_memory/${TEST_HIPPOCAMPUS_SECRETS.openAiApiKey}`,
    },
  };

  const result = sanitizeHippocampusBoundaryPayload(payload, {
    direction: "output",
  });

  assert.equal(result.detected, true);
  assert.equal(result.hasUnredactableSecrets, true);
  assert.equal(result.redactedPathCount, 0);
  assert.equal(result.unredactableFindingCount, 2);
  assert.deepEqual(result.unredactablePaths, [
    "content.memoryId",
    "metadata.nodeId",
  ]);
  assert.equal(
    result.sanitizedPayload.content.memoryId,
    TEST_HIPPOCAMPUS_SECRETS.openAiApiKey,
  );
  assert.equal(result.sanitizedPayload.metadata.nodeId, payload.metadata.nodeId);
  assert.deepEqual(
    result.findings.map((finding) => finding.action),
    ["blocked", "blocked"],
  );
});

test("promotion planning sanitizes hippocampus input before logical-identity matching", () => {
  const sourceMemoryId = "stm-secret-source";
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveShortTermMemoryEnvelope(sourceMemoryId, {
        content: `Recovery credential ${TEST_HIPPOCAMPUS_SECRETS.openAiApiKey}`,
        summary: `Recovery credential ${TEST_HIPPOCAMPUS_SECRETS.openAiApiKey}`,
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:00:00Z",
          evidence: ["turn-secret-source"],
        },
      }),
    ],
    longTermMemory: [
      {
        agentId: "agent-007",
        memoryId: "ltm-secret-durable",
        category: "episodic",
        content: "Recovery credential [REDACTED_SECRET]",
        summary: "Recovery credential [REDACTED_SECRET]",
        confidence: 0.92,
        stabilizedAt: "2026-04-14T10:06:00Z",
        provenance: {
          source: "offline-consolidation",
          observedAt: "2026-04-14T10:06:00Z",
          evidence: ["ltm-secret-durable"],
        },
        consolidationState: {
          sourceMemoryIds: [sourceMemoryId],
        },
      },
    ],
  });

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate(sourceMemoryId)],
  });

  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "conflicting-logical-identity",
  );
  assert.equal(
    plan.deferredCandidates[0].targetMemoryId,
    "ltm-secret-durable",
  );
});

test("promotion planning fail-closes hippocampus boundary rejections before durable promotion", () => {
  const sourceMemoryId = TEST_HIPPOCAMPUS_SECRETS.openAiApiKey;
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveShortTermMemoryEnvelope(sourceMemoryId, {
        content: "Safe note body that would otherwise be promoted.",
        summary: "Safe note body that would otherwise be promoted.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:08:00Z",
          evidence: ["turn-boundary-rejection"],
        },
      }),
    ],
  });

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate(sourceMemoryId)],
  });

  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "hippocampus-boundary-rejected",
  );
});

test("promotion planning fail-closes hippocampus boundary sanitizer errors before durable promotion", () => {
  const sourceMemoryId = "stm-boundary-sanitizer-error";
  const baseGraph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveShortTermMemoryEnvelope(sourceMemoryId, {
        content: "Safe note body that should never bypass boundary sanitization.",
        summary: "Safe note body that should never bypass boundary sanitization.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:08:30Z",
          evidence: ["turn-boundary-sanitizer-error"],
        },
      }),
    ],
  });
  const throwingProvenance = {
    source: "conversation",
    observedAt: "2026-04-14T10:08:30Z",
    evidence: ["turn-boundary-sanitizer-error"],
  };

  Object.defineProperty(throwingProvenance, "connection", {
    enumerable: true,
    get() {
      throw new Error("forced hippocampus sanitizer failure");
    },
  });

  const graph = {
    ...baseGraph,
    youngGeneration: {
      ...baseGraph.youngGeneration,
      shortTermMemory: [
        {
          ...baseGraph.youngGeneration.shortTermMemory[0],
          record: {
            ...baseGraph.youngGeneration.shortTermMemory[0].record,
            provenance: throwingProvenance,
          },
        },
      ],
    },
  };

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate(sourceMemoryId)],
  });

  assert.equal(plan.selectedPromotionCount, 0);
  assert.equal(plan.deferredCount, 1);
  assert.equal(
    plan.deferredCandidates[0].deferredReason,
    "hippocampus-boundary-error",
  );
});

test("Top-K promotion planning preflights every ranked candidate through the hippocampus boundary before returning durable writes", () => {
  const unsafeSourceMemoryId = TEST_HIPPOCAMPUS_SECRETS.openAiApiKey;
  const safeSourceMemoryIds = ["stm-safe-topk-1", "stm-safe-topk-2"];
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      createInactiveShortTermMemoryEnvelope(unsafeSourceMemoryId, {
        content: "Safe body with an unsafe immutable source memory id.",
        summary: "Unsafe immutable source memory id should fail the boundary.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:09:00Z",
          evidence: ["turn-topk-unsafe"],
        },
      }),
      createInactiveShortTermMemoryEnvelope(safeSourceMemoryIds[0], {
        content: "High-signal safe memory that should survive Top-K preflight.",
        summary: "High-signal safe memory that should survive Top-K preflight.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:09:30Z",
          evidence: ["turn-topk-safe-1"],
        },
      }),
      createInactiveShortTermMemoryEnvelope(safeSourceMemoryIds[1], {
        content: "Fallback safe memory that should backfill the rejected slot.",
        summary: "Fallback safe memory that should backfill the rejected slot.",
        provenance: {
          source: "conversation",
          observedAt: "2026-04-14T10:09:45Z",
          evidence: ["turn-topk-safe-2"],
        },
      }),
    ],
  });

  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    topK: 2,
    candidates: [
      createPromotionCandidate(unsafeSourceMemoryId, {
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-14T10:12:00Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-topk-unsafe"],
              signals: {
                taskRelevance: 0.99,
                userSpecificity: 0.97,
              },
            },
            stability: {
              capturedAt: "2026-04-14T10:12:00Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: [unsafeSourceMemoryId],
              signals: {
                repeatedRecall: 0.94,
                crossEpisodeConsistency: 0.92,
              },
            },
          },
        },
      }),
      createPromotionCandidate(safeSourceMemoryIds[0], {
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-14T10:12:10Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-topk-safe-1"],
              signals: {
                taskRelevance: 0.91,
                userSpecificity: 0.89,
              },
            },
            stability: {
              capturedAt: "2026-04-14T10:12:10Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: [safeSourceMemoryIds[0]],
              signals: {
                repeatedRecall: 0.9,
                crossEpisodeConsistency: 0.88,
              },
            },
          },
        },
      }),
      createPromotionCandidate(safeSourceMemoryIds[1], {
        signals: {
          youngGeneration: {
            importance: {
              capturedAt: "2026-04-14T10:12:20Z",
              sourceCollection: "importanceIndex",
              sourceRecordIds: ["importance-topk-safe-2"],
              signals: {
                taskRelevance: 0.86,
                userSpecificity: 0.84,
              },
            },
            stability: {
              capturedAt: "2026-04-14T10:12:20Z",
              sourceCollection: "shortTermMemory",
              sourceRecordIds: [safeSourceMemoryIds[1]],
              signals: {
                repeatedRecall: 0.87,
                crossEpisodeConsistency: 0.85,
              },
            },
          },
        },
      }),
    ],
  });
  const deferredById = Object.fromEntries(
    plan.deferredCandidates.map((entry) => [entry.candidate.candidateId, entry]),
  );

  assert.equal(plan.selectedPromotionCount, 2);
  assert.deepEqual(
    plan.selectedPromotions.map((selection) => selection.candidate.sourceMemoryId),
    safeSourceMemoryIds,
  );
  assert.equal(
    deferredById[`promo-${unsafeSourceMemoryId}`].deferredReason,
    "hippocampus-boundary-rejected",
  );
  assert.ok(
    !Object.values(deferredById).some(
      (entry) => entry.deferredReason === "top-k-overflow",
    ),
  );
});

test("promotion serialization redacts secrets at the hippocampus output boundary", () => {
  const fixture = createShortTermSecretFixture({
    memoryId: "stm-secret-output",
    observedAt: "2026-04-14T10:10:00Z",
    evidenceId: "turn-secret-output",
  });
  const graph = createMemoryGraph(createIdentity(), {
    shortTermMemory: [
      fixture.promotionShortTermMemory,
    ],
  });
  const plan = planConsolidationPromotions(graph, {
    runtimePhase: createRuntimePhase("idle"),
    candidates: [createPromotionCandidate(fixture.memoryId)],
  });
  const serializedEntry = serializePromotionSelectionToLongTermMemoryEntry({
    selection: plan.selectedPromotions[0],
    memory: graph.youngGeneration.shortTermMemory[0],
  });
  const serializedText = JSON.stringify(serializedEntry);

  assert.equal(plan.selectedPromotionCount, 1);
  assert.equal(serializedEntry.content.memoryId, fixture.memoryId);
  assert.equal(
    serializedEntry.content.content,
    fixture.expectedSerializedLongTerm.content,
  );
  assert.equal(
    serializedEntry.content.summary,
    fixture.expectedSerializedLongTerm.summary,
  );
  assert.equal(
    serializedEntry.metadata.provenance.connection,
    fixture.expectedSerializedLongTerm.provenanceConnection,
  );

  fixture.rawSecretValues.forEach((secret) => {
    assert.equal(serializedText.includes(secret), false);
  });
});
