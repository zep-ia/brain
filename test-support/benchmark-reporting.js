import { isDeepStrictEqual } from "node:util";

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

const roundMetric = (value, precision = 3) => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Number(numericValue.toFixed(precision));
};

const divideAndRound = (numerator, denominator, precision = 3) => {
  if (
    typeof numerator !== "number" ||
    !Number.isFinite(numerator) ||
    typeof denominator !== "number" ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return roundMetric(numerator / denominator, precision);
};

const computeDirectedLinkDensity = (nodeCount, edgeCount) => {
  if (nodeCount <= 1) {
    return 0;
  }

  return roundMetric(edgeCount / (nodeCount * (nodeCount - 1)), 4);
};

const normalizeStageElapsedMs = (stageElapsedMs) => {
  if (!isPlainObject(stageElapsedMs)) {
    return freezeDeep({});
  }

  return freezeDeep(
    Object.fromEntries(
      Object.entries(stageElapsedMs).map(([stageName, elapsedMs]) => [
        stageName,
        roundMetric(elapsedMs),
      ]),
    ),
  );
};

export const collectMemoryGraphCounts = (graph) => {
  if (!graph || typeof graph !== "object") {
    throw new TypeError("memory graph counts require a graph object");
  }

  const workingMemoryCount = graph.youngGeneration?.workingMemory?.length ?? 0;
  const shortTermMemoryCount = graph.youngGeneration?.shortTermMemory?.length ?? 0;
  const hippocampusEntryCount = graph.youngGeneration?.importanceIndex?.length ?? 0;
  const longTermMemoryCount = graph.oldGeneration?.longTermMemory?.length ?? 0;
  const archivedMemoryCount = graph.oldGeneration?.archivedMemory?.length ?? 0;
  const memoryEvidenceCount = graph.oldGeneration?.memoryEvidence?.length ?? 0;
  const consolidationJournalCount =
    graph.oldGeneration?.consolidationJournal?.length ?? 0;
  const graphEdgeCount = graph.edges?.length ?? 0;

  return freezeDeep({
    workingMemoryCount,
    shortTermMemoryCount,
    hippocampusEntryCount,
    longTermMemoryCount,
    archivedMemoryCount,
    memoryEvidenceCount,
    consolidationJournalCount,
    graphEdgeCount,
    totalRecordCount:
      workingMemoryCount +
      shortTermMemoryCount +
      hippocampusEntryCount +
      longTermMemoryCount +
      archivedMemoryCount +
      memoryEvidenceCount +
      consolidationJournalCount,
  });
};

export const analyzeCandidateGraphTopology = ({ candidates = [], edges = [] } = {}) => {
  if (!Array.isArray(candidates)) {
    throw new TypeError("benchmark topology candidates must be an array");
  }

  if (!Array.isArray(edges)) {
    throw new TypeError("benchmark topology edges must be an array");
  }

  const candidateIds = candidates.map((candidate, index) => {
    const candidateId = candidate?.candidateId;

    if (typeof candidateId !== "string" || candidateId.length === 0) {
      throw new TypeError(
        `benchmark topology candidates[${index}].candidateId must be a non-empty string`,
      );
    }

    return candidateId;
  });

  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("benchmark topology candidate ids must be unique");
  }

  const undirectedAdjacency = new Map(
    candidateIds.map((candidateId) => [candidateId, new Set()]),
  );
  const inDegreeByCandidateId = new Map(
    candidateIds.map((candidateId) => [candidateId, 0]),
  );
  const outDegreeByCandidateId = new Map(
    candidateIds.map((candidateId) => [candidateId, 0]),
  );
  let danglingEdgeCount = 0;

  edges.forEach((edge, index) => {
    const fromCandidateId = edge?.fromCandidateId;
    const toCandidateId = edge?.toCandidateId;

    if (
      typeof fromCandidateId !== "string" ||
      typeof toCandidateId !== "string"
    ) {
      throw new TypeError(
        `benchmark topology edges[${index}] must include string candidate ids`,
      );
    }

    if (
      !undirectedAdjacency.has(fromCandidateId) ||
      !undirectedAdjacency.has(toCandidateId)
    ) {
      danglingEdgeCount += 1;
      return;
    }

    outDegreeByCandidateId.set(
      fromCandidateId,
      outDegreeByCandidateId.get(fromCandidateId) + 1,
    );
    inDegreeByCandidateId.set(
      toCandidateId,
      inDegreeByCandidateId.get(toCandidateId) + 1,
    );
    undirectedAdjacency.get(fromCandidateId).add(toCandidateId);
    undirectedAdjacency.get(toCandidateId).add(fromCandidateId);
  });

  const visited = new Set();
  let weaklyConnectedComponentCount = 0;
  let largestWeaklyConnectedComponentSize = 0;

  candidateIds.forEach((candidateId) => {
    if (visited.has(candidateId)) {
      return;
    }

    weaklyConnectedComponentCount += 1;
    const stack = [candidateId];
    let componentSize = 0;
    visited.add(candidateId);

    while (stack.length > 0) {
      const currentCandidateId = stack.pop();
      componentSize += 1;
      undirectedAdjacency.get(currentCandidateId).forEach((neighborCandidateId) => {
        if (visited.has(neighborCandidateId)) {
          return;
        }

        visited.add(neighborCandidateId);
        stack.push(neighborCandidateId);
      });
    }

    largestWeaklyConnectedComponentSize = Math.max(
      largestWeaklyConnectedComponentSize,
      componentSize,
    );
  });

  const outDegrees = [...outDegreeByCandidateId.values()];
  const inDegrees = [...inDegreeByCandidateId.values()];
  const undirectedDegrees = [...undirectedAdjacency.values()].map(
    (neighbors) => neighbors.size,
  );

  return freezeDeep({
    candidateCount: candidateIds.length,
    edgeCount: edges.length,
    pageRankLinkDensity: computeDirectedLinkDensity(candidateIds.length, edges.length),
    weaklyConnectedComponentCount,
    largestWeaklyConnectedComponentSize,
    isolatedCandidateCount: undirectedDegrees.filter((degree) => degree === 0).length,
    danglingCandidateCount: outDegrees.filter((degree) => degree === 0).length,
    danglingEdgeCount,
    averageOutDegree: divideAndRound(edges.length, candidateIds.length),
    averageInDegree: divideAndRound(edges.length, candidateIds.length),
    averageUndirectedDegree: divideAndRound(
      undirectedDegrees.reduce((runningTotal, degree) => runningTotal + degree, 0),
      candidateIds.length,
    ),
    maxOutDegree: outDegrees.length === 0 ? 0 : Math.max(...outDegrees),
    maxInDegree: inDegrees.length === 0 ? 0 : Math.max(...inDegrees),
  });
};

const createValidationCheck = ({
  label,
  passed,
  expected,
  observed,
  comparator,
}) =>
  freezeDeep({
    label,
    comparator,
    passed: Boolean(passed),
    expected,
    observed,
  });

export const createBenchmarkEqualityCheck = (label, expected, observed) =>
  createValidationCheck({
    label,
    comparator: "equal",
    expected,
    observed,
    passed: isDeepStrictEqual(observed, expected),
  });

export const createBenchmarkRangeCheck = (label, observed, range = {}) => {
  const minimum = range?.min ?? null;
  const maximum = range?.max ?? null;
  const passed =
    (minimum === null || observed >= minimum) &&
    (maximum === null || observed <= maximum);

  return createValidationCheck({
    label,
    comparator: "range",
    expected: freezeDeep({
      min: minimum,
      max: maximum,
    }),
    observed,
    passed,
  });
};

export const createBenchmarkValidationSummary = ({ benchmarkId, checks }) => {
  if (typeof benchmarkId !== "string" || benchmarkId.length === 0) {
    throw new TypeError("benchmark validation summary requires a benchmark id");
  }

  if (!isPlainObject(checks)) {
    throw new TypeError("benchmark validation summary requires a checks object");
  }

  const failedCheckLabels = Object.values(checks)
    .filter((check) => check?.passed === false)
    .map((check) => check.label);

  return freezeDeep({
    benchmarkId,
    passed: failedCheckLabels.length === 0,
    failedCheckLabels,
    checks,
  });
};

export const createComparableBenchmarkPerformanceMetrics = ({
  wallClockElapsedMs,
  reconstructionElapsedMs = null,
  recordCount = 0,
  candidateCount = 0,
  edgeCount = 0,
  selectedPromotionCount = 0,
  stageElapsedMs = null,
} = {}) => {
  const normalizedWallClockElapsedMs = roundMetric(wallClockElapsedMs);
  const normalizedReconstructionElapsedMs = roundMetric(reconstructionElapsedMs);

  return freezeDeep({
    wallClockElapsedMs: normalizedWallClockElapsedMs,
    reconstructionElapsedMs: normalizedReconstructionElapsedMs,
    wallClockPerRecordMs: divideAndRound(
      normalizedWallClockElapsedMs,
      recordCount,
      6,
    ),
    wallClockPerCandidateMs: divideAndRound(
      normalizedWallClockElapsedMs,
      candidateCount,
      6,
    ),
    wallClockPerEdgeMs: divideAndRound(
      normalizedWallClockElapsedMs,
      edgeCount,
      6,
    ),
    recordsPerSecond: divideAndRound(recordCount * 1000, normalizedWallClockElapsedMs),
    candidatesPerSecond: divideAndRound(
      candidateCount * 1000,
      normalizedWallClockElapsedMs,
    ),
    edgesPerSecond: divideAndRound(edgeCount * 1000, normalizedWallClockElapsedMs),
    promotionsPerSecond: divideAndRound(
      selectedPromotionCount * 1000,
      normalizedWallClockElapsedMs,
    ),
    profiledRecordsPerSecond: divideAndRound(
      recordCount * 1000,
      normalizedReconstructionElapsedMs,
    ),
    profiledCandidatesPerSecond: divideAndRound(
      candidateCount * 1000,
      normalizedReconstructionElapsedMs,
    ),
    profiledEdgesPerSecond: divideAndRound(
      edgeCount * 1000,
      normalizedReconstructionElapsedMs,
    ),
    stageElapsedMs: normalizeStageElapsedMs(stageElapsedMs),
  });
};
