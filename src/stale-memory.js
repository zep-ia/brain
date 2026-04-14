const DAY_IN_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MINIMUM_RECENCY_MS = DAY_IN_MS;
const DEFAULT_STALE_THRESHOLD = 0.65;
const DEFAULT_MASKED_BY = "offline-consolidation";
const DEFAULT_MASKING_REASON = "stale-low-value";
const DEFAULT_MASKABLE_REASONS = Object.freeze(["low-retention-value"]);
const YOUNG_GENERATION_MEMORY_KINDS = Object.freeze([
  "working_memory",
  "short_term_memory",
]);

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

const cloneObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
};

const roundScore = (value) => Number(value.toFixed(6));

const clampUnitInterval = (value) => Math.min(Math.max(value, 0), 1);

const normalizeNonEmptyString = (value, label) => {
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
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }

  return value;
};

const normalizePositiveNumber = (value, label) => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }

  return value;
};

const normalizeUnitInterval = (value, label) => {
  const normalizedValue = normalizeNonNegativeNumber(value, label);

  if (normalizedValue > 1) {
    throw new TypeError(`${label} must be between 0 and 1`);
  }

  return normalizedValue;
};

const normalizeNonEmptyStringArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  return freezeDeep(value.map((entry, index) => normalizeNonEmptyString(entry, `${label}[${index}]`)));
};

const normalizeTimestampMs = (value, label) => {
  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    throw new TypeError(`${label} must be a valid date-like value`);
  }

  return timestamp;
};

const toIsoTimestamp = (timestampMs) => new Date(timestampMs).toISOString();

export const DEFAULT_STALE_MEMORY_WEIGHTS = freezeDeep({
  recency: 0.4,
  accessFrequency: 0.25,
  retentionValue: 0.35,
});

const normalizeWeights = (weights = {}) => {
  const mergedWeights = {
    ...DEFAULT_STALE_MEMORY_WEIGHTS,
    ...(weights ?? {}),
  };

  const recency = normalizeNonNegativeNumber(mergedWeights.recency, "weights.recency");
  const accessFrequency = normalizeNonNegativeNumber(
    mergedWeights.accessFrequency,
    "weights.accessFrequency",
  );
  const retentionValue = normalizeNonNegativeNumber(
    mergedWeights.retentionValue,
    "weights.retentionValue",
  );
  const totalWeight = recency + accessFrequency + retentionValue;

  if (totalWeight <= 0) {
    throw new TypeError("weights must contain at least one positive value");
  }

  return freezeDeep({
    recency: roundScore(recency / totalWeight),
    accessFrequency: roundScore(accessFrequency / totalWeight),
    retentionValue: roundScore(retentionValue / totalWeight),
  });
};

const normalizeMemory = (memory, nowMs) => {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    throw new TypeError("memory entries must be objects");
  }

  const createdAtMs = normalizeTimestampMs(memory.createdAt, "memory createdAt");
  const lastAccessedAtMs =
    memory.lastAccessedAt === undefined || memory.lastAccessedAt === null
      ? createdAtMs
      : normalizeTimestampMs(memory.lastAccessedAt, "memory lastAccessedAt");

  if (lastAccessedAtMs < createdAtMs) {
    throw new TypeError("memory lastAccessedAt must not be earlier than createdAt");
  }

  if (createdAtMs > nowMs) {
    throw new TypeError("memory createdAt must not be in the future");
  }

  if (lastAccessedAtMs > nowMs) {
    throw new TypeError("memory lastAccessedAt must not be in the future");
  }

  return {
    memoryId: normalizeNonEmptyString(memory.memoryId, "memoryId"),
    createdAt: toIsoTimestamp(createdAtMs),
    createdAtMs,
    lastAccessedAt: toIsoTimestamp(lastAccessedAtMs),
    lastAccessedAtMs,
    accessCount: normalizeNonNegativeNumber(
      memory.accessCount ?? 0,
      "memory accessCount",
    ),
    retentionValue: normalizeUnitInterval(
      memory.retentionValue,
      "memory retentionValue",
    ),
    metadata:
      memory.metadata === undefined || memory.metadata === null
        ? null
        : cloneObject(memory.metadata),
  };
};

const compareScoredMemories = (left, right) => {
  if (right.staleScore !== left.staleScore) {
    return right.staleScore - left.staleScore;
  }

  return left.memoryId.localeCompare(right.memoryId);
};

const buildReasons = (breakdown) => {
  const reasons = [];

  if (breakdown.recency >= 0.66) {
    reasons.push("stale-recency");
  }

  if (breakdown.accessFrequency >= 0.66) {
    reasons.push("low-access-frequency");
  }

  if (breakdown.retentionValue >= 0.66) {
    reasons.push("low-retention-value");
  }

  return reasons;
};

const normalizeBreakdown = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep({
    recency: normalizeUnitInterval(value.recency, `${label}.recency`),
    accessFrequency: normalizeUnitInterval(
      value.accessFrequency,
      `${label}.accessFrequency`,
    ),
    retentionValue: normalizeUnitInterval(
      value.retentionValue,
      `${label}.retentionValue`,
    ),
  });
};

const normalizeScoredMemory = (memory, label) => {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep({
    memoryId: normalizeNonEmptyString(memory.memoryId, `${label}.memoryId`),
    createdAt: toIsoTimestamp(normalizeTimestampMs(memory.createdAt, `${label}.createdAt`)),
    lastAccessedAt: toIsoTimestamp(
      normalizeTimestampMs(memory.lastAccessedAt, `${label}.lastAccessedAt`),
    ),
    ageMs: normalizeNonNegativeNumber(memory.ageMs, `${label}.ageMs`),
    recencyMs: normalizeNonNegativeNumber(memory.recencyMs, `${label}.recencyMs`),
    accessCount: normalizeNonNegativeNumber(memory.accessCount, `${label}.accessCount`),
    accessFrequencyPerDay: normalizeNonNegativeNumber(
      memory.accessFrequencyPerDay,
      `${label}.accessFrequencyPerDay`,
    ),
    retentionValue: normalizeUnitInterval(
      memory.retentionValue,
      `${label}.retentionValue`,
    ),
    staleScore: normalizeUnitInterval(memory.staleScore, `${label}.staleScore`),
    staleCandidate: Boolean(memory.staleCandidate),
    breakdown: normalizeBreakdown(memory.breakdown, `${label}.breakdown`),
    reasons: normalizeNonEmptyStringArray(memory.reasons ?? [], `${label}.reasons`),
    metadata:
      memory.metadata === undefined || memory.metadata === null
        ? null
        : cloneObject(memory.metadata),
  });
};

const normalizeYoungGenerationMemoryKind = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  return YOUNG_GENERATION_MEMORY_KINDS.includes(metadata.memoryKind)
    ? metadata.memoryKind
    : null;
};

export const evaluateStaleMemories = (options = {}) => {
  const nowMs =
    options.now === undefined ? Date.now() : normalizeTimestampMs(options.now, "now");
  const staleThreshold = normalizeUnitInterval(
    options.staleThreshold ?? DEFAULT_STALE_THRESHOLD,
    "staleThreshold",
  );
  const minimumRecencyMs = normalizeNonNegativeNumber(
    options.minimumRecencyMs ?? DEFAULT_MINIMUM_RECENCY_MS,
    "minimumRecencyMs",
  );
  const weights = normalizeWeights(options.weights);
  const memoryInputs = options.memories ?? [];

  if (!Array.isArray(memoryInputs)) {
    throw new TypeError("memories must be an array");
  }

  const normalizedMemories = memoryInputs.map((memory) =>
    normalizeMemory(memory, nowMs),
  );
  const recencyValues = normalizedMemories.map(
    (memory) => nowMs - memory.lastAccessedAtMs,
  );
  const recencyHorizonMs =
    options.recencyHorizonMs === undefined || options.recencyHorizonMs === null
      ? Math.max(minimumRecencyMs, DAY_IN_MS, ...recencyValues)
      : normalizePositiveNumber(options.recencyHorizonMs, "recencyHorizonMs");
  const accessFrequenciesPerDay = normalizedMemories.map((memory) => {
    const ageInDays = Math.max((nowMs - memory.createdAtMs) / DAY_IN_MS, 1);
    return memory.accessCount / ageInDays;
  });
  const accessFrequencyCapPerDay =
    options.accessFrequencyCapPerDay === undefined ||
    options.accessFrequencyCapPerDay === null
      ? Math.max(1, ...accessFrequenciesPerDay)
      : normalizePositiveNumber(
          options.accessFrequencyCapPerDay,
          "accessFrequencyCapPerDay",
        );
  const evaluatedAt = toIsoTimestamp(nowMs);

  const scoredMemories = normalizedMemories
    .map((memory, index) => {
      const ageMs = nowMs - memory.createdAtMs;
      const recencyMs = nowMs - memory.lastAccessedAtMs;
      const accessFrequencyPerDay = accessFrequenciesPerDay[index];
      const breakdown = freezeDeep({
        recency: roundScore(clampUnitInterval(recencyMs / recencyHorizonMs)),
        accessFrequency: roundScore(
          1 - clampUnitInterval(accessFrequencyPerDay / accessFrequencyCapPerDay),
        ),
        retentionValue: roundScore(1 - memory.retentionValue),
      });
      const staleScore = roundScore(
        breakdown.recency * weights.recency +
          breakdown.accessFrequency * weights.accessFrequency +
          breakdown.retentionValue * weights.retentionValue,
      );
      const staleCandidate =
        recencyMs >= minimumRecencyMs && staleScore >= staleThreshold;

      return freezeDeep({
        memoryId: memory.memoryId,
        createdAt: memory.createdAt,
        lastAccessedAt: memory.lastAccessedAt,
        ageMs,
        recencyMs,
        accessCount: memory.accessCount,
        accessFrequencyPerDay: roundScore(accessFrequencyPerDay),
        retentionValue: memory.retentionValue,
        staleScore,
        staleCandidate,
        breakdown,
        reasons: buildReasons(breakdown),
        metadata: memory.metadata,
      });
    })
    .sort(compareScoredMemories);
  const staleCandidates = scoredMemories.filter((memory) => memory.staleCandidate);

  return freezeDeep({
    evaluatedAt,
    staleThreshold,
    minimumRecencyMs,
    recencyHorizonMs,
    accessFrequencyCapPerDay: roundScore(accessFrequencyCapPerDay),
    weights,
    scoredMemories,
    staleCandidates,
    staleCandidateCount: staleCandidates.length,
    evaluationMode: "offline-suggestion-only",
  });
};

export const createStaleMemoryMaskingDecisions = (options = {}) => {
  const normalizedOptions =
    options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const evaluation = normalizedOptions.evaluation;

  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    throw new TypeError("evaluation must be an object");
  }

  if (!Array.isArray(evaluation.staleCandidates)) {
    throw new TypeError("evaluation.staleCandidates must be an array");
  }

  const sourceEvaluationAt = toIsoTimestamp(
    normalizeTimestampMs(evaluation.evaluatedAt, "evaluation.evaluatedAt"),
  );
  const sourceEvaluationMode = normalizeNonEmptyString(
    evaluation.evaluationMode,
    "evaluation.evaluationMode",
  );
  const maskedAt = toIsoTimestamp(
    normalizedOptions.maskedAt === undefined
      ? normalizeTimestampMs(sourceEvaluationAt, "evaluation.evaluatedAt")
      : normalizeTimestampMs(normalizedOptions.maskedAt, "maskedAt"),
  );
  const maskedBy = normalizeNonEmptyString(
    normalizedOptions.maskedBy ?? DEFAULT_MASKED_BY,
    "maskedBy",
  );
  const reason = normalizeNonEmptyString(
    normalizedOptions.reason ?? DEFAULT_MASKING_REASON,
    "reason",
  );
  const maskableReasons = normalizeNonEmptyStringArray(
    normalizedOptions.maskableReasons ?? DEFAULT_MASKABLE_REASONS,
    "maskableReasons",
  );
  const provenance =
    normalizedOptions.provenance === undefined || normalizedOptions.provenance === null
      ? null
      : cloneObject(normalizedOptions.provenance);
  const staleCandidates = evaluation.staleCandidates
    .map((memory, index) =>
      normalizeScoredMemory(memory, `evaluation.staleCandidates[${index}]`),
    )
    .filter((memory) => memory.staleCandidate);
  const shouldMaskMemory = (memory) =>
    maskableReasons.some((maskableReason) => memory.reasons.includes(maskableReason));
  const maskedDecisions = staleCandidates
    .filter(shouldMaskMemory)
    .map((memory) =>
      freezeDeep({
        memoryId: memory.memoryId,
        memoryKind: normalizeYoungGenerationMemoryKind(memory.metadata),
        staleScore: memory.staleScore,
        retentionValue: memory.retentionValue,
        recencyMs: memory.recencyMs,
        reasons: memory.reasons,
        breakdown: memory.breakdown,
        metadata: memory.metadata,
        inactiveForRetrieval: true,
        masking: freezeDeep({
          isMasked: true,
          maskedAt,
          unmaskedAt: null,
          maskUpdatedAt: maskedAt,
          maskedBy,
          reason,
          maskedOriginalContent: null,
          audit: freezeDeep({
            auditRecordId: provenance?.auditRecordId ?? null,
            policyVersion: provenance?.policyVersion ?? null,
            runtimePhase: provenance?.runtimePhase ?? null,
            sourceEvaluationAt,
            sourceEvaluationMode,
            recordedAt: maskedAt,
            actor: maskedBy,
            metadata: provenance ? freezeDeep(cloneObject(provenance)) : null,
          }),
          provenance: freezeDeep({
            source: "stale-memory-masking-stage",
            sourceEvaluationAt,
            sourceEvaluationMode,
            ...(provenance ?? {}),
          }),
        }),
      }),
    );
  const deferredCandidates = staleCandidates.filter(
    (memory) => !shouldMaskMemory(memory),
  );

  return freezeDeep({
    sourceEvaluationAt,
    sourceEvaluationMode,
    maskedAt,
    maskedBy,
    reason,
    maskableReasons,
    maskedDecisions,
    maskedDecisionCount: maskedDecisions.length,
    deferredCandidates,
    deferredCandidateCount: deferredCandidates.length,
    decisionMode: "offline-suggestion-only",
  });
};
