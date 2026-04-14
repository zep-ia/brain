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

const normalizePositiveNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }

  return numericValue;
};

const normalizeNonNegativeNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return numericValue;
};

const normalizeTimestampToEpochMilliseconds = (value, label) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${label} must be a valid Date`);
    }

    return value.getTime();
  }

  if (typeof value === "number") {
    const normalizedDate = new Date(value);

    if (Number.isNaN(normalizedDate.getTime())) {
      throw new TypeError(`${label} must be a valid timestamp`);
    }

    return normalizedDate.getTime();
  }

  if (typeof value === "string") {
    const normalizedValue = normalizeRequiredString(value, label);
    const normalizedDate = new Date(normalizedValue);

    if (Number.isNaN(normalizedDate.getTime())) {
      throw new TypeError(`${label} must be a valid ISO timestamp`);
    }

    return normalizedDate.getTime();
  }

  throw new TypeError(`${label} must be a string, number, or Date`);
};

const normalizeOptionalTimestampToEpochMilliseconds = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeTimestampToEpochMilliseconds(value, label);
};

const applyTemporalEdgeDecay = (weight, timestampMs, decayLambda, evaluatedAtMs) => {
  if (timestampMs === null || decayLambda === 0) {
    return weight;
  }

  const elapsedMs = Math.max(0, evaluatedAtMs - timestampMs);

  return weight * Math.exp(-decayLambda * elapsedMs);
};

const normalizePositiveInteger = (value, label) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return value;
};

const normalizeOpenUnitIntervalNumber = (value, label) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue >= 1) {
    throw new TypeError(`${label} must be a number greater than 0 and less than 1`);
  }

  return numericValue;
};

const normalizeNodeIds = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("weighted PageRank nodes must be a non-empty array");
  }

  const seenNodeIds = new Set();
  const nodeIds = value.map((nodeId, index) => {
    const normalizedNodeId = normalizeRequiredString(
      nodeId,
      `weighted PageRank nodes[${index}]`,
    );

    if (seenNodeIds.has(normalizedNodeId)) {
      throw new TypeError(
        `weighted PageRank nodes[${index}] must be unique; duplicate "${normalizedNodeId}" received`,
      );
    }

    seenNodeIds.add(normalizedNodeId);
    return normalizedNodeId;
  });

  return freezeDeep(nodeIds);
};

const normalizePersonalization = (nodeIds, personalization) => {
  if (personalization === undefined || personalization === null) {
    const uniformWeight = 1 / nodeIds.length;

    return freezeDeep(
      Object.fromEntries(nodeIds.map((nodeId) => [nodeId, uniformWeight])),
    );
  }

  if (!isPlainObject(personalization)) {
    throw new TypeError("weighted PageRank personalization must be an object");
  }

  Object.keys(personalization).forEach((nodeId) => {
    if (!nodeIds.includes(nodeId)) {
      throw new TypeError(
        `weighted PageRank personalization contains unknown node "${nodeId}"`,
      );
    }
  });

  const rawWeights = Object.fromEntries(
    nodeIds.map((nodeId) => [
      nodeId,
      normalizeNonNegativeNumber(
        personalization[nodeId] ?? 0,
        `weighted PageRank personalization.${nodeId}`,
      ),
    ]),
  );
  const totalWeight = Object.values(rawWeights).reduce(
    (runningTotal, weight) => runningTotal + weight,
    0,
  );

  if (totalWeight <= 0) {
    throw new TypeError(
      "weighted PageRank personalization must contain at least one positive weight",
    );
  }

  return freezeDeep(
    Object.fromEntries(
      nodeIds.map((nodeId) => [nodeId, rawWeights[nodeId] / totalWeight]),
    ),
  );
};

const normalizeEdges = (edges, nodeIdSet, options = {}) => {
  if (edges === undefined || edges === null) {
    return freezeDeep([]);
  }

  if (!Array.isArray(edges)) {
    throw new TypeError("weighted PageRank edges must be an array");
  }

  const decayLambda = normalizeNonNegativeNumber(
    options.decayLambda ?? 0,
    "weighted PageRank decayLambda",
  );
  const evaluatedAtMs =
    options.evaluatedAtMs === undefined || options.evaluatedAtMs === null
      ? Date.now()
      : normalizeTimestampToEpochMilliseconds(
          options.evaluatedAtMs,
          "weighted PageRank evaluatedAt",
        );

  return freezeDeep(
    edges.flatMap((edge, index) => {
      if (!isPlainObject(edge)) {
        throw new TypeError(`weighted PageRank edges[${index}] must be an object`);
      }

      const from = normalizeRequiredString(
        edge.from,
        `weighted PageRank edges[${index}].from`,
      );
      const to = normalizeRequiredString(
        edge.to,
        `weighted PageRank edges[${index}].to`,
      );

      if (!nodeIdSet.has(from)) {
        throw new TypeError(
          `weighted PageRank edges[${index}].from must reference a known node`,
        );
      }

      if (!nodeIdSet.has(to)) {
        throw new TypeError(
          `weighted PageRank edges[${index}].to must reference a known node`,
        );
      }

      const weight =
        edge.weight === undefined
          ? 1
          : normalizeNonNegativeNumber(
              edge.weight,
              `weighted PageRank edges[${index}].weight`,
            );
      const timestampMs = normalizeOptionalTimestampToEpochMilliseconds(
        edge.timestamp,
        `weighted PageRank edges[${index}].timestamp`,
      );
      const effectiveWeight = applyTemporalEdgeDecay(
        weight,
        timestampMs,
        decayLambda,
        evaluatedAtMs,
      );

      if (effectiveWeight === 0) {
        return [];
      }

      return [{ from, to, weight: effectiveWeight }];
    }),
  );
};

export const DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR = 0.85;
export const DEFAULT_WEIGHTED_PAGERANK_MAX_ITERATIONS = 100;
export const DEFAULT_WEIGHTED_PAGERANK_TOLERANCE = 1e-9;

export const evaluateWeightedPageRank = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("weighted PageRank input must be an object");
  }

  const nodeIds = normalizeNodeIds(input.nodes);
  const nodeIdSet = new Set(nodeIds);
  const decayLambda = normalizeNonNegativeNumber(
    input.decayLambda ?? 0,
    "weighted PageRank decayLambda",
  );
  const evaluatedAtMs =
    input.evaluatedAt === undefined || input.evaluatedAt === null
      ? Date.now()
      : normalizeTimestampToEpochMilliseconds(
          input.evaluatedAt,
          "weighted PageRank evaluatedAt",
        );
  const edges = normalizeEdges(input.edges, nodeIdSet, {
    decayLambda,
    evaluatedAtMs,
  });
  const dampingFactor = normalizeOpenUnitIntervalNumber(
    input.dampingFactor ?? DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR,
    "weighted PageRank dampingFactor",
  );
  const maxIterations = normalizePositiveInteger(
    input.maxIterations ?? DEFAULT_WEIGHTED_PAGERANK_MAX_ITERATIONS,
    "weighted PageRank maxIterations",
  );
  const tolerance = normalizePositiveNumber(
    input.tolerance ?? DEFAULT_WEIGHTED_PAGERANK_TOLERANCE,
    "weighted PageRank tolerance",
  );
  const personalization = normalizePersonalization(
    nodeIds,
    input.personalization,
  );
  const outgoingWeightByNodeId = Object.fromEntries(
    nodeIds.map((nodeId) => [nodeId, 0]),
  );

  edges.forEach((edge) => {
    outgoingWeightByNodeId[edge.from] += edge.weight;
  });

  let scores = Object.fromEntries(
    nodeIds.map((nodeId) => [nodeId, personalization[nodeId]]),
  );
  let converged = false;
  let iterations = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const nextScores = Object.fromEntries(
      nodeIds.map((nodeId) => [
        nodeId,
        (1 - dampingFactor) * personalization[nodeId],
      ]),
    );
    let sinkMass = 0;

    nodeIds.forEach((nodeId) => {
      if (outgoingWeightByNodeId[nodeId] === 0) {
        sinkMass += scores[nodeId];
      }
    });

    if (sinkMass > 0) {
      nodeIds.forEach((nodeId) => {
        nextScores[nodeId] += dampingFactor * sinkMass * personalization[nodeId];
      });
    }

    edges.forEach((edge) => {
      nextScores[edge.to] +=
        dampingFactor *
        scores[edge.from] *
        (edge.weight / outgoingWeightByNodeId[edge.from]);
    });

    const delta = nodeIds.reduce(
      (runningTotal, nodeId) =>
        runningTotal + Math.abs(nextScores[nodeId] - scores[nodeId]),
      0,
    );

    scores = nextScores;
    iterations = iteration + 1;

    if (delta <= tolerance) {
      converged = true;
      break;
    }
  }

  const totalScore = nodeIds.reduce(
    (runningTotal, nodeId) => runningTotal + scores[nodeId],
    0,
  );
  const normalizedScores =
    totalScore > 0
      ? Object.fromEntries(
          nodeIds.map((nodeId) => [nodeId, scores[nodeId] / totalScore]),
        )
      : Object.fromEntries(
          nodeIds.map((nodeId) => [nodeId, personalization[nodeId]]),
        );
  const rankedNodeIds = [...nodeIds].sort(
    (leftNodeId, rightNodeId) =>
      normalizedScores[rightNodeId] - normalizedScores[leftNodeId] ||
      leftNodeId.localeCompare(rightNodeId),
  );

  return freezeDeep({
    dampingFactor,
    tolerance,
    maxIterations,
    iterations,
    converged,
    nodeCount: nodeIds.length,
    edgeCount: edges.length,
    rankedNodeIds,
    personalization,
    scores: normalizedScores,
    totalScore: nodeIds.reduce(
      (runningTotal, nodeId) => runningTotal + normalizedScores[nodeId],
      0,
    ),
  });
};
