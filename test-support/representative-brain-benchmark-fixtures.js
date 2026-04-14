import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
  createOldGenerationNodeId,
  createRuntimePhase,
} from "../src/index.js";

const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const DEFAULT_AGENT_ID = "agent-007";
const DEFAULT_CHANGED_AT = "2026-04-14T06:20:00Z";
const DEFAULT_STABILIZED_AT = "2026-04-12T09:00:00Z";
const DEFAULT_OBSERVED_AT = "2026-04-14T05:40:00Z";
const WORKING_MEMORY_TOKEN_CAP = 1_000_000;

const CLUSTER_TEMPLATES = freezeDeep([
  {
    slug: "delivery",
    workingFocus: "rollout blockers and sequencing dependencies",
    shortTermFocus: "handoff notes from the last deployment window",
    durableFocus: "release policy refinements",
    evidenceFocus: "delivery checkpoint confirmations",
    learnedTrait: "release-discipline",
    emphasis: 0.94,
  },
  {
    slug: "safety",
    workingFocus: "secret-boundary enforcement and tenant isolation",
    shortTermFocus: "recent secret-detection and pruning outcomes",
    durableFocus: "hippocampus pruning rules",
    evidenceFocus: "security guardrail observations",
    learnedTrait: "boundary-vigilance",
    emphasis: 0.98,
  },
  {
    slug: "customer",
    workingFocus: "active customer blockers and support context",
    shortTermFocus: "recent user preference and handoff episodes",
    durableFocus: "stable account-specific preferences",
    evidenceFocus: "customer conversation excerpts",
    learnedTrait: "context-preservation",
    emphasis: 0.9,
  },
  {
    slug: "operations",
    workingFocus: "runtime authority and idle-window coordination",
    shortTermFocus: "batching signals from recent channel activity",
    durableFocus: "offline consolidation runbooks",
    evidenceFocus: "runtime-phase audit facts",
    learnedTrait: "offline-discipline",
    emphasis: 0.92,
  },
  {
    slug: "policy",
    workingFocus: "citation, retention, and archival policy decisions",
    shortTermFocus: "recent policy exceptions and overrides",
    durableFocus: "durable memory governance rules",
    evidenceFocus: "policy review excerpts",
    learnedTrait: "policy-consistency",
    emphasis: 0.89,
  },
  {
    slug: "tooling",
    workingFocus: "tool-call traces and co-reference links",
    shortTermFocus: "recent tool usage patterns and replay notes",
    durableFocus: "tool weighting heuristics",
    evidenceFocus: "tool trace observations",
    learnedTrait: "evidence-seeking",
    emphasis: 0.87,
  },
]);

const JOURNAL_OPERATIONS = freezeDeep([
  "promote",
  "reinforce",
  "supersede",
  "preserve",
]);

const clampScore = (value, minimum = 0.01, maximum = 0.99) =>
  Number(Math.min(maximum, Math.max(minimum, value)).toFixed(2));

const offsetIso = (baseIso, deltaMinutes) =>
  new Date(
    Date.parse(baseIso) + deltaMinutes * 60 * 1000,
  ).toISOString();

const createConversationProvenance = (observedAt, evidenceId) => ({
  source: "conversation",
  observedAt,
  evidence: [evidenceId],
});

const createOfflineProvenance = (observedAt, evidenceId) => ({
  source: "idle-window",
  observedAt,
  evidence: [evidenceId],
});

const createIdentity = (agentId, scenario) => ({
  agentId,
  persona: "neuroplastic memory steward",
  role: "runtime-memory-authority",
  durableMission:
    "Retain high-salience channel context while pruning secrets before hippocampus promotion.",
  safetyConstraints: [
    "never leak secrets into long-term memory",
    "preserve immutable memory ids through every consolidation step",
    "consolidate only inside caller-authorized idle windows",
  ],
  ownership: ["zepia-channel-memory-domain"],
  nonNegotiablePreferences: ["retain provenance", "respect tenant isolation"],
  runtimeInvariants: {
    deployment: "sandbox",
    tenant: "zep",
    benchmarkScenario: scenario.scenarioId,
  },
  protectedCoreFacts: [
    `${agentId} remains the sole memory authority for this benchmark fixture.`,
  ],
});

const createScenarioToken = (scenarioId) =>
  String(scenarioId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createPaddedOrdinal = (value) => String(value).padStart(3, "0");

const createSpreadIndices = (totalCount, selectedCount) => {
  if (totalCount <= 0 || selectedCount <= 0) {
    return freezeDeep([]);
  }

  return freezeDeep(
    [...new Set(
      Array.from({ length: Math.min(totalCount, selectedCount) }, (_, index) =>
        Math.floor((index * totalCount) / Math.min(totalCount, selectedCount)),
      ),
    )],
  );
};

const createYoungNodeScoreProfile = ({
  cluster,
  globalIndex,
  candidateCount,
  sourceMemoryKind,
}) => {
  const remainingWeight =
    1 -
    globalIndex /
      Math.max(1, candidateCount - 1);
  const kindBias =
    sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory ? 0.08 : 0.04;
  const importance = clampScore(
    0.52 + cluster.emphasis * 0.22 + remainingWeight * 0.17 + kindBias,
  );
  const stability = clampScore(
    0.46 +
      cluster.emphasis * 0.21 +
      (sourceMemoryKind === MEMORY_NODE_KINDS.shortTermMemory ? 0.05 : 0.02) +
      (1 - (globalIndex % 9) / 14) * 0.08,
  );
  const durableSalience = clampScore(importance - 0.06 + cluster.emphasis * 0.06);
  const reinforcement = clampScore(stability - 0.05 + cluster.emphasis * 0.05);

  return freezeDeep({
    importance,
    stability,
    durableSalience,
    reinforcement,
  });
};

const createWorkingMemoryEnvelope = ({
  agentId,
  scenario,
  cluster,
  memoryId,
  ordinal,
  observedAt,
}) =>
  freezeDeep({
    record: {
      memoryId,
      content:
        `Working memory ${ordinal} for ${scenario.label}: ${agentId} is actively ` +
        `tracking ${cluster.workingFocus} while keeping PageRank-driven promotion ` +
        `aligned with idle-triggered consolidation.`,
      summary:
        `${scenario.label} keeps ${cluster.slug} context ${ordinal} in the live ` +
        `task horizon until the next idle trigger.`,
      provenance: createConversationProvenance(observedAt, `turn-${memoryId}`),
    },
    inactiveForRetrieval: true,
    masking: {
      maskedAt: DEFAULT_CHANGED_AT,
      maskedBy: "benchmark-idle-window",
      reason: "queued-for-hippocampus-scoring",
    },
    lifecycle: {
      state: "inactive",
      inactiveAt: DEFAULT_CHANGED_AT,
      inactiveReason: "queued-for-hippocampus-scoring",
    },
  });

const createShortTermMemoryEnvelope = ({
  agentId,
  scenario,
  cluster,
  memoryId,
  ordinal,
  observedAt,
}) =>
  freezeDeep({
    record: {
      memoryId,
      summary:
        `${scenario.label} short-term episode ${ordinal} captures ${cluster.shortTermFocus}.`,
      detail:
        `Short-term memory ${ordinal} for ${agentId} preserves ${cluster.shortTermFocus} ` +
        `so the hippocampus buffer can evaluate reinforcement, temporal decay, and ` +
        `co-reference connectivity before Top-K promotion.`,
      provenance: createConversationProvenance(observedAt, `turn-${memoryId}`),
    },
    inactiveForRetrieval: true,
    masking: {
      maskedAt: DEFAULT_CHANGED_AT,
      maskedBy: "benchmark-idle-window",
      reason: "queued-for-hippocampus-scoring",
    },
    lifecycle: {
      state: "inactive",
      inactiveAt: DEFAULT_CHANGED_AT,
      inactiveReason: "queued-for-hippocampus-scoring",
    },
  });

const createImportanceEntry = ({ agentId, memoryId, sourceMemoryKind, scoreProfile, observedAt }) =>
  freezeDeep({
    entryId: `importance-${memoryId}`,
    agentId,
    memoryId,
    memoryKind: sourceMemoryKind,
    signals:
      sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
        ? {
            taskRelevance: scoreProfile.importance,
            recency: clampScore(scoreProfile.importance - 0.1),
            channelImpact: clampScore(scoreProfile.durableSalience - 0.07),
          }
        : {
            recallPriority: scoreProfile.importance,
            episodeSpecificity: clampScore(scoreProfile.importance - 0.08),
            retentionResistance: clampScore(scoreProfile.stability - 0.05),
          },
    lastUpdatedAt: observedAt,
  });

const createYoungNodeDescriptor = ({
  scenario,
  scenarioToken,
  cluster,
  agentId,
  sourceMemoryKind,
  globalIndex,
  clusterOrdinal,
  hasDurableTarget,
}) => {
  const kindToken =
    sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory ? "wm" : "stm";
  const memoryId =
    `${kindToken}-${scenarioToken}-${cluster.slug}-${createPaddedOrdinal(clusterOrdinal)}`;
  const candidateCount =
    scenario.volumeProfile.workingMemoryCount +
    scenario.volumeProfile.shortTermMemoryCount;
  const observedAt = offsetIso(DEFAULT_OBSERVED_AT, globalIndex * -3);
  const scoreProfile = createYoungNodeScoreProfile({
    cluster,
    globalIndex,
    candidateCount,
    sourceMemoryKind,
  });
  const memoryEnvelope =
    sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
      ? createWorkingMemoryEnvelope({
          agentId,
          scenario,
          cluster,
          memoryId,
          ordinal: createPaddedOrdinal(clusterOrdinal),
          observedAt,
        })
      : createShortTermMemoryEnvelope({
          agentId,
          scenario,
          cluster,
          memoryId,
          ordinal: createPaddedOrdinal(clusterOrdinal),
          observedAt,
        });

  return freezeDeep({
    candidateId: `promo-${memoryId}`,
    clusterSlug: cluster.slug,
    clusterOrdinal,
    sourceMemoryKind,
    memoryId,
    observedAt,
    scoreProfile,
    hasDurableTarget,
    memoryEnvelope,
  });
};

const createDurableLongTermMemory = ({
  agentId,
  scenario,
  cluster,
  sourceMemoryId,
  sourceOrdinal,
  scoreProfile,
}) =>
  freezeDeep({
    memoryId: sourceMemoryId,
    category: "semantic",
    content:
      `Durable memory for ${scenario.label} keeps ${cluster.durableFocus} anchored to ` +
      `memory id ${sourceMemoryId} so future idle batches can reinforce the same node.`,
    summary:
      `Durable ${cluster.slug} memory derived from source ${createPaddedOrdinal(sourceOrdinal)}.`,
    confidence: clampScore(scoreProfile.durableSalience + 0.02),
    stabilizedAt: DEFAULT_STABILIZED_AT,
    provenance: createConversationProvenance(
      DEFAULT_STABILIZED_AT,
      `turn-${sourceMemoryId}`,
    ),
    salience: {
      score: clampScore(scoreProfile.durableSalience + 0.02),
      signals: {
        durableSalience: scoreProfile.durableSalience,
        reinforcement: scoreProfile.reinforcement,
      },
      lastEvaluatedAt: DEFAULT_STABILIZED_AT,
    },
    consolidationState: {
      status: "promoted",
      lastOperation: "promote",
      journalRecordId: `consolidation-${sourceMemoryId}`,
      policyVersion: "benchmark-fixture-v1",
      sourceMemoryIds: [sourceMemoryId],
    },
  });

const createBackgroundLongTermMemory = ({
  scenario,
  scenarioToken,
  cluster,
  ordinal,
}) => {
  const memoryId =
    `ltm-${scenarioToken}-${cluster.slug}-${createPaddedOrdinal(ordinal)}`;
  const confidence = clampScore(0.64 + cluster.emphasis * 0.2 - (ordinal % 7) * 0.01);
  const category = ordinal % 11 === 0 ? "learned_trait" : "semantic";

  return freezeDeep({
    memoryId,
    category,
    content:
      `Long-term memory ${createPaddedOrdinal(ordinal)} preserves ${cluster.durableFocus} ` +
      `for ${scenario.label} after repeated reinforcement across sessions.`,
    summary:
      `${scenario.label} durable ${cluster.slug} memory ${createPaddedOrdinal(ordinal)}.`,
    confidence,
    stabilizedAt: DEFAULT_STABILIZED_AT,
    provenance: createConversationProvenance(
      DEFAULT_STABILIZED_AT,
      `turn-${memoryId}`,
    ),
    salience: {
      score: confidence,
      signals: {
        durableSalience: confidence,
      },
      lastEvaluatedAt: DEFAULT_STABILIZED_AT,
    },
    consolidationState: {
      status: "promoted",
      lastOperation: "promote",
      journalRecordId: `consolidation-${memoryId}`,
      policyVersion: "benchmark-fixture-v1",
      sourceMemoryIds: [`background-${memoryId}`],
    },
    ...(category === "learned_trait"
      ? {
          learnedTrait: {
            label: cluster.learnedTrait,
            confidence,
            protectedFromIdentityPromotion: true,
            provenance: createConversationProvenance(
              DEFAULT_STABILIZED_AT,
              `turn-${memoryId}`,
            ),
          },
        }
      : {}),
  });
};

const createArchivedMemory = ({
  agentId,
  scenario,
  scenarioToken,
  cluster,
  ordinal,
  sourceMemoryId,
}) => {
  const originalMemoryId =
    `ltm-${scenarioToken}-${cluster.slug}-historical-${createPaddedOrdinal(ordinal)}`;
  const archivedAt = offsetIso(DEFAULT_STABILIZED_AT, ordinal * 12);

  return freezeDeep({
    archiveId: `archive-${scenarioToken}-${cluster.slug}-${createPaddedOrdinal(ordinal)}`,
    agentId,
    originalGeneration: MEMORY_NODE_KINDS.oldGeneration,
    originalMemoryKind: MEMORY_NODE_KINDS.longTermMemory,
    originalMemoryId,
    originalNodeId: createOldGenerationNodeId(
      MEMORY_NODE_KINDS.longTermMemory,
      agentId,
      originalMemoryId,
    ),
    archivalReason: "superseded-old-memory",
    archivedAt,
    snapshot: {
      memoryId: originalMemoryId,
      category: "semantic",
      content:
        `Archived durable memory ${createPaddedOrdinal(ordinal)} for ${scenario.label} ` +
        `was superseded after newer evidence accumulated around ${cluster.durableFocus}.`,
      summary:
        `${scenario.label} archived ${cluster.slug} durable memory ${createPaddedOrdinal(ordinal)}.`,
      confidence: clampScore(0.54 + cluster.emphasis * 0.14),
      stabilizedAt: offsetIso(DEFAULT_STABILIZED_AT, ordinal * 10),
      provenance: createConversationProvenance(
        offsetIso(DEFAULT_STABILIZED_AT, ordinal * 10),
        `turn-${originalMemoryId}`,
      ),
    },
    provenance: createOfflineProvenance(
      archivedAt,
      `archive-${scenarioToken}-${createPaddedOrdinal(ordinal)}`,
    ),
    consolidationState: {
      status: "preserved",
      lastOperation: "preserve",
      journalRecordId: `journal-${scenarioToken}-${createPaddedOrdinal(ordinal)}`,
      policyVersion: "benchmark-fixture-v1",
      sourceMemoryIds: [sourceMemoryId],
    },
  });
};

const createMemoryEvidence = ({ scenario, scenarioToken, cluster, ordinal }) => {
  const evidenceId =
    `evidence-${scenarioToken}-${cluster.slug}-${createPaddedOrdinal(ordinal)}`;
  const observedAt = offsetIso(DEFAULT_OBSERVED_AT, ordinal * -5);

  return freezeDeep({
    evidenceId,
    kind: "conversation_excerpt",
    source: "conversation",
    observedAt,
    detail:
      `Evidence ${createPaddedOrdinal(ordinal)} for ${scenario.label} observed ` +
      `${cluster.evidenceFocus} and reinforced the benchmark connectivity graph.`,
    reference: `turn-${evidenceId}`,
    provenance: createConversationProvenance(observedAt, `turn-${evidenceId}`),
  });
};

const createConsolidationJournalRecord = ({
  scenario,
  scenarioToken,
  ordinal,
  sourceMemoryIds,
}) => {
  const recordId = `journal-${scenarioToken}-${createPaddedOrdinal(ordinal)}`;
  const consolidatedAt = offsetIso(DEFAULT_CHANGED_AT, ordinal * -7);

  return freezeDeep({
    recordId,
    operation: JOURNAL_OPERATIONS[ordinal % JOURNAL_OPERATIONS.length],
    runtimePhase: "idle",
    consolidatedAt,
    sourceMemoryIds,
    policyVersion: "benchmark-fixture-v1",
    preservedIdentityFields: ["agentId", "persona", "role", "durableMission"],
    provenance: createOfflineProvenance(consolidatedAt, recordId),
  });
};

const createPromotionCandidate = ({ agentId, descriptor }) =>
  freezeDeep({
    candidateId: descriptor.candidateId,
    agentId,
    sourceMemoryId: descriptor.memoryId,
    sourceMemoryKind: descriptor.sourceMemoryKind,
    targetMemoryId: descriptor.hasDurableTarget ? descriptor.memoryId : null,
    signals: {
      youngGeneration: {
        importance: {
          capturedAt: descriptor.observedAt,
          sourceCollection: "importanceIndex",
          sourceRecordIds: [`importance-${descriptor.memoryId}`],
          signals:
            descriptor.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
              ? {
                  taskRelevance: descriptor.scoreProfile.importance,
                  recency: clampScore(descriptor.scoreProfile.importance - 0.1),
                  channelImpact: clampScore(descriptor.scoreProfile.durableSalience - 0.07),
                }
              : {
                  recallPriority: descriptor.scoreProfile.importance,
                  episodeSpecificity: clampScore(descriptor.scoreProfile.importance - 0.08),
                  retentionResistance: clampScore(descriptor.scoreProfile.stability - 0.05),
                },
        },
        stability: {
          capturedAt: descriptor.observedAt,
          sourceCollection:
            descriptor.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
              ? "workingMemory"
              : "shortTermMemory",
          sourceRecordIds: [descriptor.memoryId],
          signals: {
            repeatedRecall: descriptor.scoreProfile.stability,
            crossEpisodeConsistency: clampScore(descriptor.scoreProfile.stability - 0.04),
          },
        },
      },
      ...(descriptor.hasDurableTarget
        ? {
            oldGeneration: {
              importance: {
                capturedAt: DEFAULT_STABILIZED_AT,
                sourceCollection: "longTermMemory",
                sourceRecordIds: [descriptor.memoryId],
                signals: {
                  durableSalience: descriptor.scoreProfile.durableSalience,
                },
              },
              stability: {
                capturedAt: DEFAULT_STABILIZED_AT,
                sourceCollection: "consolidationJournal",
                sourceRecordIds: [`consolidation-${descriptor.memoryId}`],
                signals: {
                  reinforcementCount: descriptor.scoreProfile.reinforcement,
                },
              },
            },
          }
        : {}),
    },
  });

const addEdge = (edgeMap, fromCandidateId, toCandidateId, weight) => {
  if (fromCandidateId === toCandidateId) {
    return;
  }

  const edgeKey = `${fromCandidateId}->${toCandidateId}`;
  const nextWeight = clampScore(weight, 0.05, 4);
  const previousWeight = edgeMap.get(edgeKey) ?? null;

  if (previousWeight === null || nextWeight > previousWeight) {
    edgeMap.set(edgeKey, nextWeight);
  }
};

const computeLinkDensity = (nodeCount, edgeCount) => {
  if (nodeCount <= 1) {
    return 0;
  }

  return Number((edgeCount / (nodeCount * (nodeCount - 1))).toFixed(4));
};

const ensureMinimumLinkDensity = (edgeMap, candidateDescriptors, connectivityProfile) => {
  const minimumEdgeCount = Math.ceil(
    connectivityProfile.densityRange.min *
      candidateDescriptors.length *
      Math.max(0, candidateDescriptors.length - 1),
  );
  let stride = Math.max(2, Math.floor(connectivityProfile.shortcutStride / 2));

  while (edgeMap.size < minimumEdgeCount && stride < candidateDescriptors.length) {
    candidateDescriptors.forEach((descriptor, index) => {
      if (edgeMap.size >= minimumEdgeCount) {
        return;
      }

      const target =
        candidateDescriptors[(index + stride) % candidateDescriptors.length];

      if (descriptor.clusterSlug !== target.clusterSlug) {
        addEdge(edgeMap, descriptor.candidateId, target.candidateId, 0.42);
      }
    });
    stride += 1;
  }
};

const createPageRankEdges = (candidateDescriptors, connectivityProfile) => {
  const edgeMap = new Map();
  const groups = Object.values(
    candidateDescriptors.reduce((collection, descriptor) => {
      if (!collection[descriptor.clusterSlug]) {
        collection[descriptor.clusterSlug] = [];
      }

      collection[descriptor.clusterSlug].push(descriptor);
      return collection;
    }, {}),
  );
  const anchors = groups.map((group) => group[0]).filter(Boolean);

  groups.forEach((group) => {
    const anchor = group[0];

    group.slice(1).forEach((descriptor) => {
      addEdge(edgeMap, anchor.candidateId, descriptor.candidateId, 1.36);
      addEdge(edgeMap, descriptor.candidateId, anchor.candidateId, 1.18);
    });

    group.forEach((descriptor, index) => {
      for (let offset = 1; offset <= connectivityProfile.neighborWindow; offset += 1) {
        const target = group[(index + offset) % group.length];
        addEdge(
          edgeMap,
          descriptor.candidateId,
          target.candidateId,
          1.08 - offset * 0.04,
        );
      }
    });
  });

  anchors.forEach((anchor, anchorIndex) => {
    for (let span = 1; span <= connectivityProfile.bridgeSpan; span += 1) {
      const target = anchors[(anchorIndex + span) % anchors.length];
      const weight = 0.9 - (span - 1) * 0.08;

      addEdge(edgeMap, anchor.candidateId, target.candidateId, weight);

      if (connectivityProfile.reciprocalAnchorEdges) {
        addEdge(edgeMap, target.candidateId, anchor.candidateId, weight - 0.06);
      }
    }
  });

  groups.forEach((group, groupIndex) => {
    const bridgeAnchor = anchors[(groupIndex + 1) % anchors.length];

    group.forEach((descriptor, index) => {
      if ((index + 1) % connectivityProfile.memberBridgeEvery === 0) {
        addEdge(edgeMap, descriptor.candidateId, bridgeAnchor.candidateId, 0.74);
      }
    });
  });

  candidateDescriptors.forEach((descriptor, index) => {
    const target =
      candidateDescriptors[
        (index + connectivityProfile.shortcutStride) %
          candidateDescriptors.length
      ];

    if (descriptor.clusterSlug !== target.clusterSlug) {
      addEdge(edgeMap, descriptor.candidateId, target.candidateId, 0.64);
    }
  });

  ensureMinimumLinkDensity(edgeMap, candidateDescriptors, connectivityProfile);

  return freezeDeep(
    [...edgeMap.entries()]
      .map(([edgeKey, weight]) => {
        const [fromCandidateId, toCandidateId] = edgeKey.split("->");
        return {
          fromCandidateId,
          toCandidateId,
          weight,
        };
      })
      .sort((left, right) =>
        `${left.fromCandidateId}:${left.toCandidateId}`.localeCompare(
          `${right.fromCandidateId}:${right.toCandidateId}`,
        ),
      ),
  );
};

const createConnectivityDistribution = (candidateDescriptors, pageRankEdges) => {
  const descriptorsByCandidateId = new Map(
    candidateDescriptors.map((descriptor) => [descriptor.candidateId, descriptor]),
  );
  const clusterAnchors = new Set(
    Object.values(
      candidateDescriptors.reduce((collection, descriptor) => {
        if (!collection[descriptor.clusterSlug]) {
          collection[descriptor.clusterSlug] = descriptor.candidateId;
        }
        return collection;
      }, {}),
    ),
  );
  const distribution = {
    intraClusterEdges: 0,
    crossClusterEdges: 0,
    anchorFanOutEdges: 0,
    peerEdges: 0,
    anchorBridgeEdges: 0,
    longRangeEdges: 0,
  };

  pageRankEdges.forEach((edge) => {
    const from = descriptorsByCandidateId.get(edge.fromCandidateId);
    const to = descriptorsByCandidateId.get(edge.toCandidateId);
    const sameCluster = from.clusterSlug === to.clusterSlug;
    const anchorInvolved =
      clusterAnchors.has(edge.fromCandidateId) || clusterAnchors.has(edge.toCandidateId);

    if (sameCluster) {
      distribution.intraClusterEdges += 1;
      if (anchorInvolved) {
        distribution.anchorFanOutEdges += 1;
      } else {
        distribution.peerEdges += 1;
      }
      return;
    }

    distribution.crossClusterEdges += 1;
    if (anchorInvolved) {
      distribution.anchorBridgeEdges += 1;
    } else {
      distribution.longRangeEdges += 1;
    }
  });

  return freezeDeep(distribution);
};

export const REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS = freezeDeep({
  "support-burst-sparse": {
    scenarioId: "support-burst-sparse",
    label: "Support Burst",
    description:
      "Short support-heavy burst with a compact durable history and sparse co-reference bridges.",
    topK: 8,
    durableTargetCoverage: 0.42,
    volumeProfile: {
      workingMemoryCount: 18,
      shortTermMemoryCount: 54,
      longTermMemoryCount: 64,
      archivedMemoryCount: 16,
      memoryEvidenceCount: 24,
      consolidationJournalCount: 12,
    },
    tokenProfile: {
      averageWorkingTokens: 210,
      averageShortTermTokens: 130,
      averageLongTermTokens: 110,
    },
    connectivityProfile: {
      densityLabel: "sparse",
      clusterCount: 4,
      neighborWindow: 2,
      bridgeSpan: 1,
      memberBridgeEvery: 7,
      shortcutStride: 13,
      reciprocalAnchorEdges: true,
      densityRange: {
        min: 0.05,
        max: 0.08,
      },
    },
  },
  "handoff-wave-moderate": {
    scenarioId: "handoff-wave-moderate",
    label: "Handoff Wave",
    description:
      "Cross-shift handoffs with deeper short-term buffers, more durable memory overlap, and moderate community links.",
    topK: 12,
    durableTargetCoverage: 0.5,
    volumeProfile: {
      workingMemoryCount: 32,
      shortTermMemoryCount: 88,
      longTermMemoryCount: 128,
      archivedMemoryCount: 32,
      memoryEvidenceCount: 48,
      consolidationJournalCount: 20,
    },
    tokenProfile: {
      averageWorkingTokens: 240,
      averageShortTermTokens: 145,
      averageLongTermTokens: 120,
    },
    connectivityProfile: {
      densityLabel: "moderate",
      clusterCount: 5,
      neighborWindow: 6,
      bridgeSpan: 2,
      memberBridgeEvery: 5,
      shortcutStride: 11,
      reciprocalAnchorEdges: true,
      densityRange: {
        min: 0.08,
        max: 0.12,
      },
    },
  },
  "channel-history-dense": {
    scenarioId: "channel-history-dense",
    label: "Channel History",
    description:
      "Long-lived channel history with broad durable recall, dense co-reference structure, and substantial archival residue.",
    topK: 16,
    durableTargetCoverage: 0.55,
    volumeProfile: {
      workingMemoryCount: 48,
      shortTermMemoryCount: 112,
      longTermMemoryCount: 224,
      archivedMemoryCount: 48,
      memoryEvidenceCount: 64,
      consolidationJournalCount: 28,
    },
    tokenProfile: {
      averageWorkingTokens: 260,
      averageShortTermTokens: 165,
      averageLongTermTokens: 125,
    },
    connectivityProfile: {
      densityLabel: "dense",
      clusterCount: 6,
      neighborWindow: 18,
      bridgeSpan: 3,
      memberBridgeEvery: 4,
      shortcutStride: 9,
      reciprocalAnchorEdges: true,
      densityRange: {
        min: 0.12,
        max: 0.18,
      },
    },
  },
});

export const createRepresentativeBrainBenchmarkFixture = (options = {}) => {
  const scenarioId = options.scenario ?? "handoff-wave-moderate";
  const scenario = REPRESENTATIVE_BRAIN_BENCHMARK_SCENARIOS[scenarioId];

  if (!scenario) {
    throw new TypeError(`Unknown brain benchmark scenario "${scenarioId}"`);
  }

  const agentId = options.agentId ?? DEFAULT_AGENT_ID;
  const identity = createIdentity(agentId, scenario);
  const scenarioToken = createScenarioToken(scenarioId);
  const candidateCount =
    scenario.volumeProfile.workingMemoryCount +
    scenario.volumeProfile.shortTermMemoryCount;
  const durableTargetCount = Math.min(
    scenario.volumeProfile.longTermMemoryCount,
    Math.round(candidateCount * scenario.durableTargetCoverage),
  );
  const durableTargetIndices = new Set(
    createSpreadIndices(candidateCount, durableTargetCount),
  );
  const clusterCount = Math.min(
    scenario.connectivityProfile.clusterCount,
    CLUSTER_TEMPLATES.length,
  );
  const clusterOrdinals = new Map();
  const candidateDescriptors = [];
  let globalIndex = 0;

  const pushYoungDescriptor = (sourceMemoryKind) => {
    const cluster = CLUSTER_TEMPLATES[globalIndex % clusterCount];
    const clusterOrdinal = (clusterOrdinals.get(cluster.slug) ?? 0) + 1;
    clusterOrdinals.set(cluster.slug, clusterOrdinal);
    candidateDescriptors.push(
      createYoungNodeDescriptor({
        scenario,
        scenarioToken,
        cluster,
        agentId,
        sourceMemoryKind,
        globalIndex,
        clusterOrdinal,
        hasDurableTarget: durableTargetIndices.has(globalIndex),
      }),
    );
    globalIndex += 1;
  };

  for (
    let index = 0;
    index < scenario.volumeProfile.workingMemoryCount;
    index += 1
  ) {
    pushYoungDescriptor(MEMORY_NODE_KINDS.workingMemory);
  }

  for (
    let index = 0;
    index < scenario.volumeProfile.shortTermMemoryCount;
    index += 1
  ) {
    pushYoungDescriptor(MEMORY_NODE_KINDS.shortTermMemory);
  }

  const workingMemory = freezeDeep(
    candidateDescriptors
      .filter(
        (descriptor) =>
          descriptor.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory,
      )
      .map((descriptor) => descriptor.memoryEnvelope),
  );
  const shortTermMemory = freezeDeep(
    candidateDescriptors
      .filter(
        (descriptor) =>
          descriptor.sourceMemoryKind === MEMORY_NODE_KINDS.shortTermMemory,
      )
      .map((descriptor) => descriptor.memoryEnvelope),
  );
  const importanceIndex = freezeDeep(
    candidateDescriptors.map((descriptor) =>
      createImportanceEntry({
        agentId,
        memoryId: descriptor.memoryId,
        sourceMemoryKind: descriptor.sourceMemoryKind,
        scoreProfile: descriptor.scoreProfile,
        observedAt: descriptor.observedAt,
      }),
    ),
  );
  const durableTargetMemories = candidateDescriptors
    .filter((descriptor) => descriptor.hasDurableTarget)
    .map((descriptor, index) =>
      createDurableLongTermMemory({
        agentId,
        scenario,
        cluster:
          CLUSTER_TEMPLATES.find(
            (cluster) => cluster.slug === descriptor.clusterSlug,
          ) ?? CLUSTER_TEMPLATES[index % clusterCount],
        sourceMemoryId: descriptor.memoryId,
        sourceOrdinal: index + 1,
        scoreProfile: descriptor.scoreProfile,
      }),
    );
  const backgroundLongTermCount =
    scenario.volumeProfile.longTermMemoryCount - durableTargetMemories.length;
  const backgroundLongTermMemories = Array.from(
    { length: backgroundLongTermCount },
    (_, index) =>
      createBackgroundLongTermMemory({
        scenario,
        scenarioToken,
        cluster: CLUSTER_TEMPLATES[index % clusterCount],
        ordinal: index + 1,
      }),
  );
  const longTermMemory = freezeDeep([
    ...durableTargetMemories,
    ...backgroundLongTermMemories,
  ]);
  const consolidationJournal = freezeDeep(
    Array.from(
      { length: scenario.volumeProfile.consolidationJournalCount },
      (_, index) =>
        createConsolidationJournalRecord({
          scenario,
          scenarioToken,
          ordinal: index + 1,
          sourceMemoryIds: [
            candidateDescriptors[index % candidateDescriptors.length].memoryId,
          ],
        }),
    ),
  );
  const archivedMemory = freezeDeep(
    Array.from({ length: scenario.volumeProfile.archivedMemoryCount }, (_, index) =>
      createArchivedMemory({
        agentId,
        scenario,
        scenarioToken,
        cluster: CLUSTER_TEMPLATES[index % clusterCount],
        ordinal: index + 1,
        sourceMemoryId:
          candidateDescriptors[index % candidateDescriptors.length].memoryId,
      }),
    ),
  );
  const memoryEvidence = freezeDeep(
    Array.from({ length: scenario.volumeProfile.memoryEvidenceCount }, (_, index) =>
      createMemoryEvidence({
        scenario,
        scenarioToken,
        cluster: CLUSTER_TEMPLATES[index % clusterCount],
        ordinal: index + 1,
      }),
    ),
  );
  const candidates = freezeDeep(
    candidateDescriptors.map((descriptor) =>
      createPromotionCandidate({ agentId, descriptor }),
    ),
  );
  const pageRankEdges = createPageRankEdges(
    candidateDescriptors,
    scenario.connectivityProfile,
  );
  const graph = createMemoryGraph(identity, {
    workingMemory,
    shortTermMemory,
    importanceIndex,
    longTermMemory,
    archivedMemory,
    memoryEvidence,
    consolidationJournal,
  });
  const connectivityDistribution = createConnectivityDistribution(
    candidateDescriptors,
    pageRankEdges,
  );
  const pageRankLinkDensity = computeLinkDensity(
    candidates.length,
    pageRankEdges.length,
  );
  const estimatedWorkingTokens =
    scenario.volumeProfile.workingMemoryCount *
    scenario.tokenProfile.averageWorkingTokens;
  const estimatedShortTermTokens =
    scenario.volumeProfile.shortTermMemoryCount *
    scenario.tokenProfile.averageShortTermTokens;
  const estimatedYoungGenerationTokens =
    estimatedWorkingTokens + estimatedShortTermTokens;
  const estimatedLongTermTokens =
    scenario.volumeProfile.longTermMemoryCount *
    scenario.tokenProfile.averageLongTermTokens;

  return freezeDeep({
    scenarioId,
    scenario,
    identity,
    runtime: {
      runtimePhase: createRuntimePhase("idle", {
        authority: "caller",
        changedAt: DEFAULT_CHANGED_AT,
        note: `Representative brain benchmark scenario "${scenarioId}" is ready for idle-triggered consolidation.`,
      }),
    },
    graph,
    candidates,
    pageRankEdges,
    sourceMemoryIds: freezeDeep(
      candidateDescriptors.map((descriptor) => descriptor.memoryId),
    ),
    candidateTopology: freezeDeep(
      candidateDescriptors.map((descriptor, index) => ({
        candidateId: descriptor.candidateId,
        sourceMemoryId: descriptor.memoryId,
        sourceMemoryKind: descriptor.sourceMemoryKind,
        clusterSlug: descriptor.clusterSlug,
        clusterOrdinal: descriptor.clusterOrdinal,
        hasDurableTarget: descriptor.hasDurableTarget,
      })),
    ),
    metrics: freezeDeep({
      topK: scenario.topK,
      workingMemoryCount: graph.youngGeneration.workingMemory.length,
      shortTermMemoryCount: graph.youngGeneration.shortTermMemory.length,
      hippocampusEntryCount: graph.youngGeneration.importanceIndex.length,
      longTermMemoryCount: graph.oldGeneration.longTermMemory.length,
      archivedMemoryCount: graph.oldGeneration.archivedMemory.length,
      memoryEvidenceCount: graph.oldGeneration.memoryEvidence.length,
      consolidationJournalCount: graph.oldGeneration.consolidationJournal.length,
      totalRecordCount:
        graph.youngGeneration.workingMemory.length +
        graph.youngGeneration.shortTermMemory.length +
        graph.youngGeneration.importanceIndex.length +
        graph.oldGeneration.longTermMemory.length +
        graph.oldGeneration.archivedMemory.length +
        graph.oldGeneration.memoryEvidence.length +
        graph.oldGeneration.consolidationJournal.length,
      pageRankCandidateCount: candidates.length,
      pageRankEdgeCount: pageRankEdges.length,
      pageRankLinkDensity,
      connectivityDistribution,
      estimatedWorkingTokens,
      estimatedShortTermTokens,
      estimatedYoungGenerationTokens,
      estimatedLongTermTokens,
      withinWorkingMemoryTokenCap:
        estimatedYoungGenerationTokens <= WORKING_MEMORY_TOKEN_CAP,
      durableTargetCount: durableTargetMemories.length,
      durableTargetCoverage: Number(
        (durableTargetMemories.length / candidates.length).toFixed(4),
      ),
      densityLabel: scenario.connectivityProfile.densityLabel,
    }),
  });
};
