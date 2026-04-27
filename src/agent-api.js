import { consolidateHippocampalEpisode } from "./hippocampus-consolidation.js";
import { evaluateWeightedPageRank } from "./pagerank.js";
import { sanitizeHippocampusBoundaryPayload } from "./hippocampus-secret-policy.js";
import { evaluateIdleWindowAuthorization } from "./runtime-phase.js";

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

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeRequiredString = (value, label) => {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeNonNegativeNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return numericValue;
};

const normalizePositiveInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return value;
};

const normalizeOptionalStringList = (value, label) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return value.map((entry, index) =>
    normalizeRequiredString(entry, `${label}[${index}]`),
  );
};

const normalizeSignals = (value) => {
  if (!isPlainObject(value)) {
    return freezeDeep({});
  }

  return freezeDeep(
    Object.fromEntries(
      Object.entries(value).map(([signalName, signalValue]) => [
        normalizeRequiredString(signalName, "event signal name"),
        normalizeNonNegativeNumber(signalValue, `event signals.${signalName}`),
      ]),
    ),
  );
};

const scoreSignals = (signals) => {
  const signalValues = Object.values(signals);

  if (signalValues.length === 0) {
    return 1;
  }

  return Math.max(
    Number.EPSILON,
    signalValues.reduce((total, signalValue) => total + signalValue, 0) /
      signalValues.length,
  );
};

const normalizeEventKind = (value) =>
  normalizeRequiredString(value ?? "observation", "event.kind");

const normalizeAgentBrainEvent = (event, index) => {
  if (!isPlainObject(event)) {
    throw new TypeError(`events[${index}] must be an object`);
  }

  const memoryId = normalizeRequiredString(event.id ?? event.memoryId, `events[${index}].id`);
  const content = normalizeRequiredString(event.content, `events[${index}].content`);
  const signals = normalizeSignals(event.signals);

  return freezeDeep({
    memoryId,
    eventId: memoryId,
    kind: normalizeEventKind(event.kind),
    content,
    summary:
      event.summary === undefined || event.summary === null
        ? content
        : normalizeRequiredString(event.summary, `events[${index}].summary`),
    references: normalizeOptionalStringList(
      event.references ?? event.referenceIds,
      `events[${index}].references`,
    ),
    signals,
    signalScore: scoreSignals(signals),
    identity: isPlainObject(event.identity) ? { ...event.identity } : null,
    metadata: isPlainObject(event.metadata) ? { ...event.metadata } : {},
  });
};

const normalizeToolCall = (toolCall, index) => {
  if (!isPlainObject(toolCall)) {
    throw new TypeError(`toolCalls[${index}] must be an object`);
  }

  return freezeDeep({
    id: normalizeRequiredString(toolCall.id ?? `tool-call-${index + 1}`, `toolCalls[${index}].id`),
    toolName: normalizeRequiredString(
      toolCall.toolName ?? toolCall.name ?? "agent.tool",
      `toolCalls[${index}].toolName`,
    ),
    sourceEventIds: normalizeOptionalStringList(
      toolCall.sourceEventIds ?? toolCall.sourceMemoryIds,
      `toolCalls[${index}].sourceEventIds`,
    ),
    referencedEventIds: normalizeOptionalStringList(
      toolCall.referencedEventIds ?? toolCall.targetEventIds ?? toolCall.referencedMemoryIds,
      `toolCalls[${index}].referencedEventIds`,
    ),
    weight: normalizeNonNegativeNumber(toolCall.weight ?? 1, `toolCalls[${index}].weight`),
  });
};

const createReferenceEdge = ({ from, to, weight, relation, evidenceId }) =>
  freezeDeep({
    from,
    to,
    weight,
    relation,
    evidenceId,
  });

const getNodeSessionId = (node) => {
  const sessionId = node.metadata?.sessionId ?? node.metadata?.session_id;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
};

const CONCEPT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "been",
  "being",
  "could",
  "from",
  "have",
  "help",
  "into",
  "needs",
  "note",
  "only",
  "provider",
  "remember",
  "should",
  "that",
  "their",
  "there",
  "this",
  "turn",
  "user",
  "using",
  "wants",
  "were",
  "when",
  "with",
  "work",
]);

const extractConceptTokens = (node) => {
  const tokens = new Set();
  const combinedText = `${node.kind} ${node.summary} ${node.content}`.toLowerCase();
  for (const token of combinedText.match(/[a-z][a-z0-9_-]{3,}/g) ?? []) {
    if (!CONCEPT_STOP_WORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
};

const countSharedConceptTokens = (leftTokens, rightTokens) => {
  let count = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      count += 1;
    }
  }
  return count;
};

const buildAgentBrainEdges = (nodes, toolCalls) => {
  const nodeIdSet = new Set(nodes.map((node) => node.memoryId));
  const edges = [];
  const edgeKeys = new Set();
  const addEdge = (edge) => {
    if (edge.from === edge.to) {
      return;
    }
    const edgeKey = `${edge.from}\u0000${edge.to}\u0000${edge.relation}\u0000${edge.evidenceId}`;
    if (edgeKeys.has(edgeKey)) {
      return;
    }
    edgeKeys.add(edgeKey);
    edges.push(createReferenceEdge(edge));
  };

  nodes.forEach((node) => {
    node.references.forEach((referenceId) => {
      if (!nodeIdSet.has(referenceId) || referenceId === node.memoryId) {
        return;
      }

      addEdge({
        from: node.memoryId,
        to: referenceId,
        weight: 1,
        relation: "event-reference",
        evidenceId: `${node.memoryId}->${referenceId}`,
      });
    });
  });

  const nodesBySessionId = new Map();
  nodes.forEach((node) => {
    const sessionId = getNodeSessionId(node);
    if (!sessionId) {
      return;
    }
    const sessionNodes = nodesBySessionId.get(sessionId) ?? [];
    sessionNodes.push(node);
    nodesBySessionId.set(sessionId, sessionNodes);
  });

  nodesBySessionId.forEach((sessionNodes, sessionId) => {
    for (let index = 1; index < sessionNodes.length; index += 1) {
      const previousNode = sessionNodes[index - 1];
      const node = sessionNodes[index];
      addEdge({
        from: previousNode.memoryId,
        to: node.memoryId,
        weight: 0.7,
        relation: "session-continuity",
        evidenceId: `${sessionId}:${previousNode.memoryId}->${node.memoryId}`,
      });
      addEdge({
        from: node.memoryId,
        to: previousNode.memoryId,
        weight: 0.35,
        relation: "session-continuity:reverse",
        evidenceId: `${sessionId}:${node.memoryId}->${previousNode.memoryId}`,
      });
    }
  });

  const conceptTokensByMemoryId = new Map(
    nodes.map((node) => [node.memoryId, extractConceptTokens(node)]),
  );
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const sharedConceptCount = countSharedConceptTokens(
        conceptTokensByMemoryId.get(left.memoryId),
        conceptTokensByMemoryId.get(right.memoryId),
      );
      if (sharedConceptCount < 2) {
        continue;
      }
      const weight = Math.min(1, 0.25 + sharedConceptCount * 0.1);
      addEdge({
        from: left.memoryId,
        to: right.memoryId,
        weight,
        relation: "shared-concept",
        evidenceId: `${left.memoryId}<->${right.memoryId}:shared-${sharedConceptCount}`,
      });
      addEdge({
        from: right.memoryId,
        to: left.memoryId,
        weight,
        relation: "shared-concept",
        evidenceId: `${right.memoryId}<->${left.memoryId}:shared-${sharedConceptCount}`,
      });
    }
  }

  toolCalls.forEach((toolCall) => {
    toolCall.sourceEventIds.forEach((sourceEventId) => {
      toolCall.referencedEventIds.forEach((referencedEventId) => {
        if (
          !nodeIdSet.has(sourceEventId) ||
          !nodeIdSet.has(referencedEventId) ||
          sourceEventId === referencedEventId
        ) {
          return;
        }

        addEdge({
          from: sourceEventId,
          to: referencedEventId,
          weight: toolCall.weight,
          relation: `tool-call:${toolCall.toolName}`,
          evidenceId: toolCall.id,
        });
        addEdge({
          from: referencedEventId,
          to: sourceEventId,
          weight: toolCall.weight,
          relation: `tool-call:${toolCall.toolName}:reverse`,
          evidenceId: toolCall.id,
        });
      });
    });
  });

  return freezeDeep(edges);
};

const normalizeRuntime = (runtime = {}) => {
  const normalizedRuntime = isPlainObject(runtime) ? runtime : {};

  return freezeDeep({
    phase: normalizeRequiredString(normalizedRuntime.phase ?? "active", "runtime.phase"),
    authority: normalizeRequiredString(
      normalizedRuntime.authority ?? "caller",
      "runtime.authority",
    ),
  });
};

const authorizeRuntime = (agentId, runtime) => {
  const authorization = evaluateIdleWindowAuthorization({
    agentId,
    runtimePhase: {
      phase: runtime.phase,
      authority: runtime.authority,
    },
  });

  return freezeDeep({
    authorized: Boolean(authorization.eligible),
    phase: runtime.phase,
    authority: runtime.authority,
    reason: authorization.blockedReason ?? null,
    source: "agent-brain-api",
  });
};

const createPersonalizationVector = (nodes) =>
  freezeDeep(
    Object.fromEntries(nodes.map((node) => [node.memoryId, node.signalScore])),
  );

export const AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS = 90;
export const AGENT_BRAIN_API_DEFAULT_TOP_K = 5;

const normalizeOptionalObjectList = (value, label) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return value;
};

const assertUniqueMemoryIds = (nodes) => {
  const seenMemoryIds = new Set();

  nodes.forEach((node) => {
    if (seenMemoryIds.has(node.memoryId)) {
      throw new TypeError(`events contain duplicate memory id: ${node.memoryId}`);
    }

    seenMemoryIds.add(node.memoryId);
  });
};

export const buildAgentBrainMemoryGraph = (input = {}) => {
  const normalizedInput = isPlainObject(input) ? input : {};
  const agentId = normalizeRequiredString(normalizedInput.agentId, "agentId");
  const events = normalizeOptionalObjectList(normalizedInput.events, "events");
  const toolCalls = normalizeOptionalObjectList(normalizedInput.toolCalls, "toolCalls");
  const nodes = events.map(normalizeAgentBrainEvent);
  assertUniqueMemoryIds(nodes);
  const normalizedToolCalls = toolCalls.map(normalizeToolCall);

  return freezeDeep({
    apiKind: "agent_brain_api_graph",
    schemaVersion: "1.0.0",
    agentId,
    zepiaCoupling: "none",
    nodes,
    toolCalls: normalizedToolCalls,
    edges: buildAgentBrainEdges(nodes, normalizedToolCalls),
  });
};

export const runAgentBrainExperiment = (input = {}) => {
  const normalizedInput = isPlainObject(input) ? input : {};
  const iterationsRequested = normalizePositiveInteger(
    normalizedInput.iterations ?? AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS,
    "iterations",
  );
  const topK = normalizePositiveInteger(
    normalizedInput.topK ?? AGENT_BRAIN_API_DEFAULT_TOP_K,
    "topK",
  );
  const runtime = normalizeRuntime(normalizedInput.runtime);
  const hippocampusEnabled = Boolean(normalizedInput.hippocampus?.enabled);
  const hippocampus = hippocampusEnabled
    ? consolidateHippocampalEpisode({
        agentId: normalizedInput.agentId,
        sessionId: normalizedInput.sessionId,
        events: normalizedInput.events,
      })
    : null;
  const graphInput = hippocampusEnabled
    ? {
        ...normalizedInput,
        events: hippocampus.promotedEvents,
      }
    : normalizedInput;
  const rawGraph = buildAgentBrainMemoryGraph(graphInput);
  const graphBoundary = sanitizeHippocampusBoundaryPayload(rawGraph, {
    direction: "input",
    policy: {
      policyId: "agent-brain-api-graph-secret-boundary",
      excludedFieldNames: ["identity", "apiKey", "token", "secret"],
    },
  });
  const runtimeAuthorization = authorizeRuntime(rawGraph.agentId, runtime);

  if (graphBoundary.hasUnredactableSecrets) {
    return freezeDeep({
      apiKind: "agent_brain_experiment_result",
      status: "blocked",
      agentId: rawGraph.agentId,
      iterationsRequested,
      runtimeAuthorization,
      hippocampus: hippocampusEnabled ? { enabled: true, ...hippocampus } : { enabled: false },
      graph: null,
      pageRank: null,
      rankedMemories: [],
      longTermCandidates: [],
      graphSecretBoundary: graphBoundary,
      secretBoundary: graphBoundary,
    });
  }

  const graph = graphBoundary.sanitizedPayload;

  if (graph.nodes.length === 0) {
    return freezeDeep({
      apiKind: "agent_brain_experiment_result",
      status: runtimeAuthorization.authorized ? "completed" : "blocked",
      agentId: graph.agentId,
      iterationsRequested,
      runtimeAuthorization,
      hippocampus: hippocampusEnabled ? { enabled: true, ...hippocampus } : { enabled: false },
      graph,
      pageRank: null,
      rankedMemories: [],
      longTermCandidates: [],
      graphSecretBoundary: graphBoundary,
      secretBoundary: null,
    });
  }

  if (!runtimeAuthorization.authorized) {
    return freezeDeep({
      apiKind: "agent_brain_experiment_result",
      status: "blocked",
      agentId: graph.agentId,
      iterationsRequested,
      runtimeAuthorization,
      hippocampus: hippocampusEnabled ? { enabled: true, ...hippocampus } : { enabled: false },
      graph,
      pageRank: null,
      rankedMemories: [],
      longTermCandidates: [],
      graphSecretBoundary: graphBoundary,
      secretBoundary: null,
    });
  }

  const pageRank = evaluateWeightedPageRank({
    nodes: graph.nodes.map((node) => node.memoryId),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
    })),
    personalization: createPersonalizationVector(graph.nodes),
    maxIterations: iterationsRequested,
  });
  const experimentPageRank = freezeDeep({
    ...pageRank,
    iterationsCompleted: pageRank.iterations,
  });
  const scoreByMemoryId = new Map(
    Object.entries(experimentPageRank.scores).map(([memoryId, score]) => [memoryId, score]),
  );
  const rankedMemories = graph.nodes
    .map((node) => ({
      memoryId: node.memoryId,
      kind: node.kind,
      content: node.content,
      summary: node.summary,
      score: scoreByMemoryId.get(node.memoryId) ?? 0,
      signalScore: node.signalScore,
      signals: node.signals,
      identity: node.identity,
      metadata: node.metadata,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.signalScore - left.signalScore ||
        left.memoryId.localeCompare(right.memoryId),
    );

  const selectedCandidates = rankedMemories.slice(0, topK);
  const secretBoundary = sanitizeHippocampusBoundaryPayload(selectedCandidates, {
    direction: "output",
    policy: {
      policyId: "agent-brain-api-secret-boundary",
      excludedFieldNames: ["identity", "apiKey", "token", "secret"],
    },
  });

  if (secretBoundary.hasUnredactableSecrets) {
    return freezeDeep({
      apiKind: "agent_brain_experiment_result",
      status: "blocked",
      agentId: graph.agentId,
      iterationsRequested,
      runtimeAuthorization,
      hippocampus: hippocampusEnabled ? { enabled: true, ...hippocampus } : { enabled: false },
      graph,
      pageRank: experimentPageRank,
      rankedMemories,
      longTermCandidates: [],
      graphSecretBoundary: graphBoundary,
      secretBoundary,
    });
  }

  return freezeDeep({
    apiKind: "agent_brain_experiment_result",
    status: "completed",
    agentId: graph.agentId,
    iterationsRequested,
    runtimeAuthorization,
    hippocampus: hippocampusEnabled ? { enabled: true, ...hippocampus } : { enabled: false },
    graph,
    pageRank: experimentPageRank,
    rankedMemories,
    longTermCandidates: secretBoundary.sanitizedPayload.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      promotionReason: `top-k-page-rank-after-${iterationsRequested}-iteration-agent-experiment`,
    })),
    graphSecretBoundary: graphBoundary,
    secretBoundary,
  });
};
