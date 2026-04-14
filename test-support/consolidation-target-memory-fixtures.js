import {
  MEMORY_NODE_KINDS,
  createMemoryGraph,
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
const DEFAULT_CHANGED_AT = "2026-04-14T03:00:00Z";
const DEFAULT_SIGNAL_CAPTURED_AT = "2026-04-14T02:45:00Z";
const DEFAULT_STABILIZED_AT = "2026-04-14T01:30:00Z";

const SOURCE_MEMORY_KIND_TO_COLLECTION = freezeDeep({
  [MEMORY_NODE_KINDS.workingMemory]: "workingMemory",
  [MEMORY_NODE_KINDS.shortTermMemory]: "shortTermMemory",
});

const TOPIC_CATALOG = freezeDeep({
  "rollout-blocker": {
    slug: "rollout-blocker",
    cluster: "delivery",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: true,
    content:
      "Keep the rollout blocker tied to invoice verification in the active graph until the dependency clears.",
    summary: "Rollout blocked by invoice verification dependency.",
    importance: 0.95,
    stability: 0.88,
    durableSalience: 0.79,
    reinforcement: 0.75,
  },
  "citation-policy": {
    slug: "citation-policy",
    cluster: "policy",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: true,
    content:
      "Preserve the stricter citation rule whenever the answer summarizes multi-source findings.",
    summary: "Stricter citation rule for multi-source summaries.",
    importance: 0.9,
    stability: 0.83,
    durableSalience: 0.76,
    reinforcement: 0.72,
  },
  "secret-boundary": {
    slug: "secret-boundary",
    cluster: "safety",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: true,
    content:
      "Prune secrets before hippocampus indexing and never allow raw credentials into durable memory.",
    summary: "Prune secrets before hippocampus indexing.",
    importance: 0.94,
    stability: 0.87,
    durableSalience: 0.8,
    reinforcement: 0.76,
  },
  "scheduler-window": {
    slug: "scheduler-window",
    cluster: "operations",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: false,
    content:
      "Scheduler idle windows remain advisory until the caller opens a real offline phase.",
    summary: "Scheduler idle windows are advisory only.",
    importance: 0.72,
    stability: 0.79,
    durableSalience: 0.59,
    reinforcement: 0.6,
  },
  "user-region-preference": {
    slug: "user-region-preference",
    cluster: "customer",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: true,
    content:
      "Keep the user's regional formatting preference when composing operational guidance.",
    summary: "User prefers region-specific operational guidance.",
    importance: 0.84,
    stability: 0.82,
    durableSalience: 0.7,
    reinforcement: 0.69,
  },
  "release-freeze-exception": {
    slug: "release-freeze-exception",
    cluster: "delivery",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: false,
    content:
      "Track the release-freeze exception so the deployment reasoning remains anchored to the approved override.",
    summary: "Release-freeze exception must remain attached to deployment reasoning.",
    importance: 0.8,
    stability: 0.78,
    durableSalience: 0.66,
    reinforcement: 0.65,
  },
  "archival-threshold": {
    slug: "archival-threshold",
    cluster: "policy",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: false,
    content:
      "Unpromoted memories stay in working or short-term memory until the next idle trigger evaluates them again.",
    summary: "Unpromoted memories persist until the next idle trigger.",
    importance: 0.74,
    stability: 0.75,
    durableSalience: 0.6,
    reinforcement: 0.61,
  },
  "team-idle-signal": {
    slug: "team-idle-signal",
    cluster: "operations",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: false,
    content:
      "Team-idle is a batching signal, not shared authority over another agent's consolidation boundary.",
    summary: "Team idle does not grant shared consolidation authority.",
    importance: 0.77,
    stability: 0.81,
    durableSalience: 0.63,
    reinforcement: 0.62,
  },
  "credential-rotation": {
    slug: "credential-rotation",
    cluster: "safety",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: true,
    content:
      "Rotate compromised credentials and store only the remediation fact, never the credential itself.",
    summary: "Store remediation facts, never raw credentials.",
    importance: 0.89,
    stability: 0.8,
    durableSalience: 0.74,
    reinforcement: 0.7,
  },
  "custom-agent-routing": {
    slug: "custom-agent-routing",
    cluster: "operations",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: false,
    content:
      "Brain remains the memory authority even when OpenClaw and custom agents enter the same zepia channel.",
    summary: "Brain is the shared memory authority across channel agents.",
    importance: 0.82,
    stability: 0.76,
    durableSalience: 0.67,
    reinforcement: 0.64,
  },
  "onboarding-blocker": {
    slug: "onboarding-blocker",
    cluster: "customer",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: false,
    content:
      "Escalate onboarding blockers when the workspace bootstrap fails before the local runtime can recover.",
    summary: "Escalate onboarding blockers when bootstrap fails.",
    importance: 0.75,
    stability: 0.73,
    durableSalience: 0.62,
    reinforcement: 0.6,
  },
  "evidence-trait": {
    slug: "evidence-trait",
    cluster: "policy",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: true,
    content:
      "Preserve the evidence-seeking behavior as a learned durable trait without elevating it into immutable identity.",
    summary: "Evidence-seeking behavior stays durable but non-identity.",
    importance: 0.88,
    stability: 0.9,
    durableSalience: 0.77,
    reinforcement: 0.74,
  },
  "support-handoff": {
    slug: "support-handoff",
    cluster: "customer",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: false,
    content:
      "Carry support-handoff context long enough for the next agent to complete the unresolved user task.",
    summary: "Retain support-handoff context across agent changes.",
    importance: 0.78,
    stability: 0.77,
    durableSalience: 0.64,
    reinforcement: 0.62,
  },
  "incident-playbook": {
    slug: "incident-playbook",
    cluster: "operations",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: true,
    content:
      "Preserve the incident playbook refinement that isolates the rollback checklist from live execution authority.",
    summary: "Incident playbook isolates rollback checklist from live authority.",
    importance: 0.86,
    stability: 0.84,
    durableSalience: 0.73,
    reinforcement: 0.71,
  },
  "retention-window": {
    slug: "retention-window",
    cluster: "policy",
    sourceMemoryKind: MEMORY_NODE_KINDS.workingMemory,
    hasDurableTarget: false,
    content:
      "Keep working-memory retention bounded by the 1M token cap and let importance scoring decide durable promotion.",
    summary: "Working memory stays bounded by the 1M token cap.",
    importance: 0.73,
    stability: 0.74,
    durableSalience: 0.6,
    reinforcement: 0.59,
  },
  "funnel-dropoff": {
    slug: "funnel-dropoff",
    cluster: "customer",
    sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
    hasDurableTarget: false,
    content:
      "Retain the funnel drop-off pattern until the next idle batch decides whether the signal is durable.",
    summary: "Funnel drop-off pattern waits for the next idle batch.",
    importance: 0.79,
    stability: 0.75,
    durableSalience: 0.63,
    reinforcement: 0.61,
  },
});

const BACKGROUND_TARGET_CATALOG = freezeDeep([
  {
    slug: "tenant-scope-boundary",
    cluster: "safety",
    category: "semantic",
    content:
      "Long-term memory remains tenant-scoped even when many agents share the same infrastructure batch.",
    summary: "Durable memory remains tenant-scoped across shared infrastructure.",
    confidence: 0.86,
  },
  {
    slug: "offline-executor-runbook",
    cluster: "operations",
    category: "semantic",
    content:
      "Offline executors may dispatch authorized work, but they cannot infer or mint authorization on their own.",
    summary: "Offline executors dispatch work but never mint authorization.",
    confidence: 0.84,
  },
  {
    slug: "regional-formatting-preference",
    cluster: "customer",
    category: "semantic",
    content:
      "Regional formatting preferences persist as durable context after repeated reinforcement across sessions.",
    summary: "Regional formatting preferences persist after repeated reinforcement.",
    confidence: 0.81,
  },
  {
    slug: "citation-evidence-style",
    cluster: "policy",
    category: "semantic",
    content:
      "User-facing summaries cite evidence when the answer synthesizes information from multiple durable memories.",
    summary: "Multi-source durable summaries keep citation evidence attached.",
    confidence: 0.85,
  },
]);

export const REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS = freezeDeep({
  "small-sparse": {
    presetId: "small-sparse",
    graphSize: "small",
    linkDensity: "sparse",
    topK: 2,
    sourceTopicSlugs: [
      "rollout-blocker",
      "citation-policy",
      "secret-boundary",
      "scheduler-window",
      "user-region-preference",
      "release-freeze-exception",
    ],
    backgroundTargetCount: 2,
    edgeMode: "sparse",
  },
  "medium-moderate": {
    presetId: "medium-moderate",
    graphSize: "medium",
    linkDensity: "moderate",
    topK: 3,
    sourceTopicSlugs: [
      "rollout-blocker",
      "citation-policy",
      "secret-boundary",
      "scheduler-window",
      "user-region-preference",
      "release-freeze-exception",
      "archival-threshold",
      "team-idle-signal",
      "credential-rotation",
      "custom-agent-routing",
    ],
    backgroundTargetCount: 3,
    edgeMode: "moderate",
  },
  "large-dense": {
    presetId: "large-dense",
    graphSize: "large",
    linkDensity: "dense",
    topK: 5,
    sourceTopicSlugs: [
      "rollout-blocker",
      "citation-policy",
      "secret-boundary",
      "scheduler-window",
      "user-region-preference",
      "release-freeze-exception",
      "archival-threshold",
      "team-idle-signal",
      "credential-rotation",
      "custom-agent-routing",
      "onboarding-blocker",
      "evidence-trait",
      "support-handoff",
      "incident-playbook",
    ],
    backgroundTargetCount: 4,
    edgeMode: "dense",
  },
});

const INCREMENTAL_TARGET_MEMORY_SET_SCENARIO = freezeDeep({
  scenarioId: "incremental-update",
  base: {
    presetId: "incremental-base",
    graphSize: "medium",
    linkDensity: "moderate",
    topK: 3,
    sourceTopicSlugs: [
      "rollout-blocker",
      "citation-policy",
      "secret-boundary",
      "scheduler-window",
      "user-region-preference",
      "archival-threshold",
      "team-idle-signal",
      "credential-rotation",
    ],
    backgroundTargetCount: 3,
    edgeMode: "moderate",
  },
  next: {
    presetId: "incremental-next",
    graphSize: "medium",
    linkDensity: "moderate",
    topK: 3,
    sourceTopicSlugs: [
      "rollout-blocker",
      "citation-policy",
      "secret-boundary",
      "user-region-preference",
      "archival-threshold",
      "team-idle-signal",
      "credential-rotation",
      "incident-playbook",
      "retention-window",
    ],
    backgroundTargetCount: 3,
    edgeMode: "moderate",
    topicOverrides: {
      "secret-boundary": {
        content:
          "Prune secrets before hippocampus indexing, then keep only the sanitized remediation fact in durable memory.",
        summary: "Prune secrets and keep only sanitized remediation facts.",
        importance: 0.97,
        stability: 0.9,
      },
      "archival-threshold": {
        importance: 0.79,
        stability: 0.8,
      },
    },
    edgeOverrides: [
      {
        fromSlug: "rollout-blocker",
        toSlug: "secret-boundary",
        weight: 2.3,
      },
      {
        fromSlug: "team-idle-signal",
        toSlug: "retention-window",
        weight: 1.7,
      },
      {
        fromSlug: "citation-policy",
        toSlug: "incident-playbook",
        weight: 1.6,
      },
    ],
  },
});

const createIdentity = (agentId = DEFAULT_AGENT_ID) => ({
  agentId,
  persona: "deliberate analyst",
  role: "researcher",
  durableMission:
    "Protect user context quality while keeping durable memory aligned with runtime authority.",
  safetyConstraints: [
    "never overwrite immutable identity",
    "prune secrets before durable promotion",
  ],
  ownership: ["channel-memory-domain"],
  nonNegotiablePreferences: ["preserve provenance", "keep memory ids stable"],
  runtimeInvariants: {
    deployment: "sandbox",
    tenant: "zep",
  },
  protectedCoreFacts: ["agent-007 stays inside tenant-scoped memory boundaries"],
});

const getSourceMemoryId = (slug) => `memory-${slug}`;
const getCandidateId = (slug) => `promo-${slug}`;

const createConversationProvenance = (slug, observedAt = DEFAULT_SIGNAL_CAPTURED_AT) => ({
  source: "conversation",
  observedAt,
  evidence: [`turn-${slug}`],
});

const createInactiveYoungMemoryEnvelope = (topic) => {
  const observedAt = DEFAULT_SIGNAL_CAPTURED_AT;
  const inactiveAt = DEFAULT_CHANGED_AT;
  const record =
    topic.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
      ? {
          memoryId: getSourceMemoryId(topic.slug),
          content: topic.content,
          summary: topic.summary,
          provenance: createConversationProvenance(topic.slug, observedAt),
        }
      : {
          memoryId: getSourceMemoryId(topic.slug),
          summary: topic.summary,
          detail: topic.content,
          provenance: createConversationProvenance(topic.slug, observedAt),
        };

  return freezeDeep({
    record,
    inactiveForRetrieval: true,
    masking: {
      maskedAt: inactiveAt,
      maskedBy: "offline-consolidation",
      reason: "queued-for-idle-trigger",
    },
    lifecycle: {
      state: "inactive",
      inactiveAt,
      inactiveReason: "queued-for-idle-trigger",
    },
  });
};

const createImportanceEntry = (agentId, topic) =>
  freezeDeep({
    entryId: `importance-${topic.slug}`,
    agentId,
    memoryId: getSourceMemoryId(topic.slug),
    memoryKind: topic.sourceMemoryKind,
    signals:
      topic.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
        ? {
            taskRelevance: topic.importance,
            recency: Number(Math.max(0.45, topic.importance - 0.1).toFixed(2)),
          }
        : {
            recallPriority: topic.importance,
            episodeSpecificity: Number(Math.max(0.4, topic.importance - 0.08).toFixed(2)),
          },
    lastUpdatedAt: DEFAULT_SIGNAL_CAPTURED_AT,
  });

const createExistingTargetMemory = (agentId, topic) =>
  freezeDeep({
    memoryId: getSourceMemoryId(topic.slug),
    category: topic.slug === "evidence-trait" ? "learned_trait" : "semantic",
    content: topic.content,
    summary: topic.summary,
    confidence: Number(Math.max(topic.durableSalience, topic.importance - 0.1).toFixed(2)),
    stabilizedAt: DEFAULT_STABILIZED_AT,
    provenance: createConversationProvenance(topic.slug, DEFAULT_STABILIZED_AT),
    salience: {
      score: topic.durableSalience,
      signals: {
        durableSalience: topic.durableSalience,
      },
      lastEvaluatedAt: DEFAULT_STABILIZED_AT,
    },
    consolidationState: {
      status: "promoted",
      lastOperation: "promote",
      journalRecordId: `consolidation-${topic.slug}`,
      policyVersion: "fixture-v1",
      sourceMemoryIds: [getSourceMemoryId(topic.slug)],
    },
    ...(topic.slug === "evidence-trait"
      ? {
          learnedTrait: {
            label: "evidence-seeking",
            confidence: topic.stability,
            protectedFromIdentityPromotion: true,
            provenance: createConversationProvenance(topic.slug, DEFAULT_STABILIZED_AT),
          },
        }
      : {}),
  });

const createBackgroundTargetMemory = (agentId, topic) =>
  freezeDeep({
    memoryId: `ltm-background-${topic.slug}`,
    category: topic.category,
    content: topic.content,
    summary: topic.summary,
    confidence: topic.confidence,
    stabilizedAt: DEFAULT_STABILIZED_AT,
    provenance: createConversationProvenance(topic.slug, DEFAULT_STABILIZED_AT),
    salience: {
      score: topic.confidence,
      signals: {
        durableSalience: topic.confidence,
      },
      lastEvaluatedAt: DEFAULT_STABILIZED_AT,
    },
    consolidationState: {
      status: "promoted",
      lastOperation: "promote",
      journalRecordId: `consolidation-background-${topic.slug}`,
      policyVersion: "fixture-v1",
      sourceMemoryIds: [`background-${topic.slug}`],
    },
  });

const createPromotionCandidate = (agentId, topic) => {
  const youngGenerationSignals =
    topic.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory
      ? {
          importance: {
            capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
            sourceCollection: "importanceIndex",
            sourceRecordIds: [`importance-${topic.slug}`],
            signals: {
              taskRelevance: topic.importance,
              recency: Number(Math.max(0.45, topic.importance - 0.1).toFixed(2)),
            },
          },
          stability: {
            capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
            sourceCollection: "workingMemory",
            sourceRecordIds: [getSourceMemoryId(topic.slug)],
            signals: {
              repeatedRecall: topic.stability,
              crossEpisodeConsistency: Number(
                Math.max(0.45, topic.stability - 0.06).toFixed(2),
              ),
            },
          },
        }
      : {
          importance: {
            capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
            sourceCollection: "importanceIndex",
            sourceRecordIds: [`importance-${topic.slug}`],
            signals: {
              recallPriority: topic.importance,
              episodeSpecificity: Number(
                Math.max(0.42, topic.importance - 0.08).toFixed(2),
              ),
            },
          },
          stability: {
            capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
            sourceCollection: "shortTermMemory",
            sourceRecordIds: [getSourceMemoryId(topic.slug)],
            signals: {
              repeatedRecall: topic.stability,
              crossEpisodeConsistency: Number(
                Math.max(0.45, topic.stability - 0.05).toFixed(2),
              ),
            },
          },
        };

  return freezeDeep({
    candidateId: getCandidateId(topic.slug),
    agentId,
    sourceMemoryId: getSourceMemoryId(topic.slug),
    sourceMemoryKind: topic.sourceMemoryKind,
    targetMemoryId: topic.hasDurableTarget ? getSourceMemoryId(topic.slug) : null,
    ...(topic.slug === "evidence-trait" ? { learnedTraitCandidate: true } : {}),
    signals: {
      youngGeneration: youngGenerationSignals,
      ...(topic.hasDurableTarget
        ? {
            oldGeneration: {
              importance: {
                capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
                sourceCollection: "longTermMemory",
                sourceRecordIds: [getSourceMemoryId(topic.slug)],
                signals: {
                  durableSalience: topic.durableSalience,
                },
              },
              stability: {
                capturedAt: DEFAULT_SIGNAL_CAPTURED_AT,
                sourceCollection: "consolidationJournal",
                sourceRecordIds: [`consolidation-${topic.slug}`],
                signals: {
                  reinforcementCount: topic.reinforcement,
                },
              },
            },
          }
        : {}),
    },
  });
};

const normalizeTopics = (slugs, overrides = {}) =>
  freezeDeep(
    slugs.map((slug) => {
      const topic = TOPIC_CATALOG[slug];

      if (!topic) {
        throw new TypeError(`Unknown representative target memory topic "${slug}"`);
      }

      return freezeDeep({
        ...topic,
        ...(overrides[slug] ?? {}),
      });
    }),
  );

const createTopicGroups = (topics) =>
  Object.values(
    topics.reduce((groups, topic) => {
      if (!groups[topic.cluster]) {
        groups[topic.cluster] = [];
      }

      groups[topic.cluster].push(topic);
      return groups;
    }, {}),
  );

const addEdge = (edgeMap, fromSlug, toSlug, weight) => {
  if (fromSlug === toSlug) {
    return;
  }

  const key = `${fromSlug}->${toSlug}`;
  const nextWeight = Number(weight.toFixed(2));
  const previousWeight = edgeMap.get(key) ?? null;

  if (previousWeight === null || nextWeight > previousWeight) {
    edgeMap.set(key, nextWeight);
  }
};

const createSparseEdges = (groups) => {
  const edgeMap = new Map();

  groups.forEach((group) => {
    for (let index = 0; index < group.length - 1; index += 1) {
      addEdge(edgeMap, group[index].slug, group[index + 1].slug, 1.2);
    }
  });

  const anchors = groups.map((group) => group[0]).filter(Boolean);

  for (let index = 0; index < anchors.length; index += 1) {
    const from = anchors[index];
    const to = anchors[(index + 1) % anchors.length];

    if (from && to) {
      addEdge(edgeMap, from.slug, to.slug, 0.85);
    }
  }

  return edgeMap;
};

const createModerateEdges = (groups) => {
  const edgeMap = createSparseEdges(groups);
  const anchors = groups.map((group) => group[0]).filter(Boolean);

  groups.forEach((group) => {
    group.forEach((source, sourceIndex) => {
      group.forEach((target, targetIndex) => {
        if (sourceIndex === targetIndex) {
          return;
        }

        addEdge(
          edgeMap,
          source.slug,
          target.slug,
          1.05 - Math.min(Math.abs(sourceIndex - targetIndex) * 0.08, 0.24),
        );
      });
    });
  });

  anchors.forEach((source, sourceIndex) => {
    anchors.forEach((target, targetIndex) => {
      if (sourceIndex === targetIndex) {
        return;
      }

      addEdge(edgeMap, source.slug, target.slug, 0.72);
    });
  });

  groups.forEach((group, groupIndex) => {
    const anchor = anchors[(groupIndex + 1) % anchors.length] ?? null;

    if (!anchor) {
      return;
    }

    group.slice(1).forEach((topic) => {
      addEdge(edgeMap, topic.slug, anchor.slug, 0.67);
    });
  });

  return edgeMap;
};

const createDenseEdges = (groups) => {
  const edgeMap = createModerateEdges(groups);
  const anchors = groups.map((group) => group[0]).filter(Boolean);

  groups.forEach((group, groupIndex) => {
    const otherAnchors = anchors.filter((_, anchorIndex) => anchorIndex !== groupIndex);

    group.forEach((topic) => {
      otherAnchors.forEach((anchor) => {
        addEdge(edgeMap, topic.slug, anchor.slug, 0.63);
      });
    });
  });

  groups.forEach((group, groupIndex) => {
    const nextGroup = groups[(groupIndex + 1) % groups.length] ?? [];

    group.forEach((source) => {
      nextGroup.forEach((target) => {
        addEdge(edgeMap, source.slug, target.slug, 0.58);
      });
    });
  });

  return edgeMap;
};

const createPageRankEdges = (topics, edgeMode, edgeOverrides = []) => {
  const groups = createTopicGroups(topics);
  let edgeMap;

  switch (edgeMode) {
    case "sparse":
      edgeMap = createSparseEdges(groups);
      break;
    case "moderate":
      edgeMap = createModerateEdges(groups);
      break;
    case "dense":
      edgeMap = createDenseEdges(groups);
      break;
    default:
      throw new TypeError(`Unsupported representative target memory edge mode "${edgeMode}"`);
  }

  edgeOverrides.forEach(({ fromSlug, toSlug, weight }) => {
    if (!topics.some((topic) => topic.slug === fromSlug)) {
      return;
    }

    if (!topics.some((topic) => topic.slug === toSlug)) {
      return;
    }

    addEdge(edgeMap, fromSlug, toSlug, weight);
  });

  return freezeDeep(
    [...edgeMap.entries()]
      .map(([key, weight]) => {
        const [fromSlug, toSlug] = key.split("->");

        return {
          fromCandidateId: getCandidateId(fromSlug),
          toCandidateId: getCandidateId(toSlug),
          weight,
        };
      })
      .sort((left, right) => {
        const leftKey = `${left.fromCandidateId}:${left.toCandidateId}`;
        const rightKey = `${right.fromCandidateId}:${right.toCandidateId}`;
        return leftKey.localeCompare(rightKey);
      }),
  );
};

const computeLinkDensity = (candidateCount, edgeCount) => {
  if (candidateCount <= 1) {
    return 0;
  }

  return Number((edgeCount / (candidateCount * (candidateCount - 1))).toFixed(4));
};

const createRepresentativeFixture = ({
  presetId,
  graphSize,
  linkDensity,
  topK,
  sourceTopicSlugs,
  backgroundTargetCount,
  edgeMode,
  topicOverrides = {},
  edgeOverrides = [],
  agentId = DEFAULT_AGENT_ID,
}) => {
  const identity = createIdentity(agentId);
  const topics = normalizeTopics(sourceTopicSlugs, topicOverrides);
  const workingMemory = [];
  const shortTermMemory = [];
  const importanceIndex = [];
  const existingTargetMemories = [];

  topics.forEach((topic) => {
    const envelope = createInactiveYoungMemoryEnvelope(topic);

    if (topic.sourceMemoryKind === MEMORY_NODE_KINDS.workingMemory) {
      workingMemory.push(envelope);
    } else {
      shortTermMemory.push(envelope);
    }

    importanceIndex.push(createImportanceEntry(agentId, topic));

    if (topic.hasDurableTarget) {
      existingTargetMemories.push(createExistingTargetMemory(agentId, topic));
    }
  });

  const backgroundTargetMemories = BACKGROUND_TARGET_CATALOG.slice(
    0,
    backgroundTargetCount,
  ).map((topic) => createBackgroundTargetMemory(agentId, topic));
  const longTermMemory = freezeDeep([
    ...existingTargetMemories,
    ...backgroundTargetMemories,
  ]);
  const graph = createMemoryGraph(identity, {
    workingMemory,
    shortTermMemory,
    importanceIndex,
    longTermMemory,
  });
  const candidates = freezeDeep(
    topics.map((topic) => createPromotionCandidate(agentId, topic)),
  );
  const pageRankEdges = createPageRankEdges(topics, edgeMode, edgeOverrides);
  const sourceMemoryIds = freezeDeep(
    topics.map((topic) => getSourceMemoryId(topic.slug)),
  );
  const targetMemoryIds = freezeDeep(
    longTermMemory.map((memory) => memory.memoryId),
  );

  return freezeDeep({
    presetId,
    identity,
    runtime: {
      runtimePhase: createRuntimePhase("idle", {
        authority: "caller",
        changedAt: DEFAULT_CHANGED_AT,
        note: `Representative target memory fixture "${presetId}" is running in an idle window.`,
      }),
    },
    graph,
    candidates,
    pageRankEdges,
    sourceMemoryIds,
    targetMemoryIds,
    topicNodes: freezeDeep(
      topics.map((topic) => ({
        slug: topic.slug,
        cluster: topic.cluster,
        candidateId: getCandidateId(topic.slug),
        sourceMemoryId: getSourceMemoryId(topic.slug),
        sourceMemoryKind: topic.sourceMemoryKind,
        hasDurableTarget: topic.hasDurableTarget,
      })),
    ),
    metrics: freezeDeep({
      graphSize,
      linkDensity,
      sourceMemoryCount: topics.length,
      workingMemoryCount: workingMemory.length,
      shortTermMemoryCount: shortTermMemory.length,
      existingTargetCount: existingTargetMemories.length,
      backgroundTargetCount: backgroundTargetMemories.length,
      durableTargetCount: longTermMemory.length,
      pageRankEdgeCount: pageRankEdges.length,
      pageRankLinkDensity: computeLinkDensity(topics.length, pageRankEdges.length),
      topK,
    }),
  });
};

export const createRepresentativeTargetMemorySetFixture = (options = {}) => {
  const presetId = options.preset ?? "medium-moderate";
  const preset = REPRESENTATIVE_TARGET_MEMORY_SET_PRESETS[presetId];

  if (!preset) {
    throw new TypeError(
      `Unknown representative target memory preset "${presetId}"`,
    );
  }

  return createRepresentativeFixture({
    ...preset,
    agentId: options.agentId ?? DEFAULT_AGENT_ID,
  });
};

const createEdgeMap = (edges) =>
  new Map(
    edges.map((edge) => [
      `${edge.fromCandidateId}->${edge.toCandidateId}`,
      edge.weight,
    ]),
  );

const findTopicRecord = (fixture, sourceMemoryId) => {
  const collectionName = fixture.topicNodes.find(
    (topic) => topic.sourceMemoryId === sourceMemoryId,
  )?.sourceMemoryKind;
  const collectionKey = SOURCE_MEMORY_KIND_TO_COLLECTION[collectionName] ?? null;

  if (!collectionKey) {
    return null;
  }

  const entry = fixture.graph.youngGeneration[collectionKey].find(
    (memoryEnvelope) => memoryEnvelope.record.memoryId === sourceMemoryId,
  );

  return entry?.record ?? null;
};

export const createIncrementalTargetMemorySetFixture = (options = {}) => {
  const agentId = options.agentId ?? DEFAULT_AGENT_ID;
  const base = createRepresentativeFixture({
    ...INCREMENTAL_TARGET_MEMORY_SET_SCENARIO.base,
    agentId,
  });
  const next = createRepresentativeFixture({
    ...INCREMENTAL_TARGET_MEMORY_SET_SCENARIO.next,
    agentId,
  });
  const baseSourceIds = new Set(base.sourceMemoryIds);
  const nextSourceIds = new Set(next.sourceMemoryIds);
  const baseEdgeMap = createEdgeMap(base.pageRankEdges);
  const nextEdgeMap = createEdgeMap(next.pageRankEdges);
  const retainedSourceMemoryIds = [...baseSourceIds].filter((memoryId) =>
    nextSourceIds.has(memoryId),
  );
  const modifiedSourceMemoryIds = retainedSourceMemoryIds.filter((memoryId) => {
    const baseCandidate = base.candidates.find(
      (candidate) => candidate.sourceMemoryId === memoryId,
    );
    const nextCandidate = next.candidates.find(
      (candidate) => candidate.sourceMemoryId === memoryId,
    );
    const baseRecord = findTopicRecord(base, memoryId);
    const nextRecord = findTopicRecord(next, memoryId);

    return (
      JSON.stringify(baseCandidate) !== JSON.stringify(nextCandidate) ||
      JSON.stringify(baseRecord) !== JSON.stringify(nextRecord)
    );
  });

  return freezeDeep({
    scenarioId: INCREMENTAL_TARGET_MEMORY_SET_SCENARIO.scenarioId,
    base,
    next,
    delta: {
      addedSourceMemoryIds: freezeDeep(
        next.sourceMemoryIds.filter((memoryId) => !baseSourceIds.has(memoryId)),
      ),
      removedSourceMemoryIds: freezeDeep(
        base.sourceMemoryIds.filter((memoryId) => !nextSourceIds.has(memoryId)),
      ),
      retainedSourceMemoryIds: freezeDeep(retainedSourceMemoryIds),
      modifiedSourceMemoryIds: freezeDeep(modifiedSourceMemoryIds),
      addedEdgePairs: freezeDeep(
        next.pageRankEdges
          .filter(
            (edge) =>
              !baseEdgeMap.has(`${edge.fromCandidateId}->${edge.toCandidateId}`),
          )
          .map((edge) => `${edge.fromCandidateId}->${edge.toCandidateId}`),
      ),
      removedEdgePairs: freezeDeep(
        base.pageRankEdges
          .filter(
            (edge) =>
              !nextEdgeMap.has(`${edge.fromCandidateId}->${edge.toCandidateId}`),
          )
          .map((edge) => `${edge.fromCandidateId}->${edge.toCandidateId}`),
      ),
      reweightedEdgePairs: freezeDeep(
        base.pageRankEdges
          .filter((edge) => {
            const key = `${edge.fromCandidateId}->${edge.toCandidateId}`;
            return nextEdgeMap.has(key) && nextEdgeMap.get(key) !== edge.weight;
          })
          .map((edge) => `${edge.fromCandidateId}->${edge.toCandidateId}`),
      ),
    },
  });
};
