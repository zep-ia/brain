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

const buildAgentBrainEdges = (nodes, toolCalls) => {
  const nodeIdSet = new Set(nodes.map((node) => node.memoryId));
  const edges = [];

  nodes.forEach((node) => {
    node.references.forEach((referenceId) => {
      if (!nodeIdSet.has(referenceId) || referenceId === node.memoryId) {
        return;
      }

      edges.push(
        createReferenceEdge({
          from: node.memoryId,
          to: referenceId,
          weight: 1,
          relation: "event-reference",
          evidenceId: `${node.memoryId}->${referenceId}`,
        }),
      );
    });
  });

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

        edges.push(
          createReferenceEdge({
            from: sourceEventId,
            to: referencedEventId,
            weight: toolCall.weight,
            relation: `tool-call:${toolCall.toolName}`,
            evidenceId: toolCall.id,
          }),
        );
        edges.push(
          createReferenceEdge({
            from: referencedEventId,
            to: sourceEventId,
            weight: toolCall.weight,
            relation: `tool-call:${toolCall.toolName}:reverse`,
            evidenceId: toolCall.id,
          }),
        );
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
  const rawGraph = buildAgentBrainMemoryGraph(normalizedInput);
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
