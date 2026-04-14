import { createHash } from "node:crypto";

const HIPPOCAMPUS_SECRET_POLICY_VERSION = "1.0.0";
const DEFAULT_HIPPOCAMPUS_SECRET_POLICY_ID =
  "hippocampus-secret-redaction-policy";
const DEFAULT_HIPPOCAMPUS_SECRET_PLACEHOLDER = "[REDACTED_SECRET]";

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

const cloneValueDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneValueDeep);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneValueDeep(nestedValue),
      ]),
    );
  }

  return value;
};

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

const normalizeStringList = (value, label) => {
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

const createUniqueStringList = (values) => [...new Set(values)];

export const HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS = freezeDeep([
  "input",
  "output",
]);

const HIPPOCAMPUS_SECRET_EXCLUDED_FIELD_NAMES = freezeDeep([
  "agentId",
  "archiveId",
  "archiveNodeId",
  "auditRecordId",
  "candidateId",
  "entryId",
  "evidenceId",
  "memoryId",
  "nodeId",
  "outputMemoryId",
  "outputNodeId",
  "planId",
  "policyId",
  "recordId",
  "requestId",
  "sourceMemoryId",
  "sourceMemoryIds",
  "sourceRecordIds",
  "stageId",
  "targetMemoryId",
  "targetNodeId",
]);

const SECRET_FIELD_NAME_PATTERN =
  /(?:^|[_-])(?:access[_-]?key|api[_-]?key|auth(?:orization|[_-]?token)?|bearer|client[_-]?secret|cookie|pass(?:word|wd)?|private[_-]?key|secret|token)(?:$|[_-])/i;

const createSecretRedactionDetector = ({
  detectorId,
  pattern,
  replacer,
  extractSecret,
}) =>
  freezeDeep({
    detectorId,
    pattern,
    replacer,
    extractSecret,
  });

const HIPPOCAMPUS_TEXT_SECRET_DETECTORS = freezeDeep([
  createSecretRedactionDetector({
    detectorId: "private-key-block",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "openai-api-key",
    pattern: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "github-token",
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9._-]{5,}\.[A-Za-z0-9._-]{5,}\b/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacer: (_match, _captures, placeholder) => placeholder,
    extractSecret: (match) => match,
  }),
  createSecretRedactionDetector({
    detectorId: "bearer-token",
    pattern: /\b(Bearer\s+)([A-Za-z0-9._=-]{12,})\b/gi,
    replacer: (_match, [prefix], placeholder) => `${prefix}${placeholder}`,
    extractSecret: (_match, captures) => captures[1],
  }),
  createSecretRedactionDetector({
    detectorId: "inline-secret-assignment",
    pattern:
      /\b((?:access[_-]?key|api[_-]?key|authorization|client[_-]?secret|pass(?:word|wd)?|secret|token)\b\s*[:=]\s*)(["']?)([^\s"'`,;]+)(\2)/gi,
    replacer: (_match, [prefix, quote, _value, closingQuote], placeholder) =>
      `${prefix}${quote}${placeholder}${closingQuote}`,
    extractSecret: (_match, captures) => captures[2],
  }),
]);

export const HIPPOCAMPUS_SECRET_DETECTOR_IDS = freezeDeep([
  "secret-field-name",
  ...HIPPOCAMPUS_TEXT_SECRET_DETECTORS.map((detector) => detector.detectorId),
]);

const HIPPOCAMPUS_TEXT_SECRET_DETECTOR_MAP = new Map(
  HIPPOCAMPUS_TEXT_SECRET_DETECTORS.map((detector) => [
    detector.detectorId,
    detector,
  ]),
);

const normalizeBoundaryDirection = (value) => {
  const direction = normalizeRequiredString(
    value ?? "input",
    "hippocampus boundary direction",
  );

  if (!HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS.includes(direction)) {
    throw new TypeError(
      `hippocampus boundary direction must be one of ${HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS.join(", ")}`,
    );
  }

  return direction;
};

const normalizeDetectorIds = (value) => {
  const detectorIds = createUniqueStringList(
    normalizeStringList(
      value ?? HIPPOCAMPUS_SECRET_DETECTOR_IDS,
      "hippocampus secret detectorIds",
    ),
  );

  detectorIds.forEach((detectorId) => {
    if (!HIPPOCAMPUS_SECRET_DETECTOR_IDS.includes(detectorId)) {
      throw new TypeError(
        `Unknown hippocampus secret detector "${detectorId}".`,
      );
    }
  });

  if (detectorIds.length === 0) {
    throw new TypeError(
      "hippocampus secret detectorIds must include at least one detector",
    );
  }

  return freezeDeep(detectorIds);
};

const normalizeExcludedFieldNames = (value) =>
  freezeDeep(
    createUniqueStringList([
      ...HIPPOCAMPUS_SECRET_EXCLUDED_FIELD_NAMES,
      ...normalizeStringList(
        value ?? [],
        "hippocampus secret excludedFieldNames",
      ),
    ]),
  );

export const createHippocampusSecretRedactionPolicy = (input = {}) => {
  const normalizedInput = isPlainObject(input) ? input : {};

  return freezeDeep({
    policyId: normalizeRequiredString(
      normalizedInput.policyId ?? DEFAULT_HIPPOCAMPUS_SECRET_POLICY_ID,
      "hippocampus secret policyId",
    ),
    version: HIPPOCAMPUS_SECRET_POLICY_VERSION,
    directions: HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS,
    redactionPlaceholder: normalizeRequiredString(
      normalizedInput.redactionPlaceholder ??
        DEFAULT_HIPPOCAMPUS_SECRET_PLACEHOLDER,
      "hippocampus secret redactionPlaceholder",
    ),
    detectorIds: normalizeDetectorIds(normalizedInput.detectorIds),
    excludedFieldNames: normalizeExcludedFieldNames(
      normalizedInput.excludedFieldNames,
    ),
    secretFieldNamePattern: SECRET_FIELD_NAME_PATTERN.source,
  });
};

export const DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY =
  createHippocampusSecretRedactionPolicy();

const formatPath = (segments) =>
  segments.length === 0
    ? "$"
    : segments
        .map((segment, index) =>
          typeof segment === "number"
            ? `[${segment}]`
            : index === 0
              ? segment
              : `.${segment}`,
        )
        .join("");

const createSecretFingerprint = (secretValue) =>
  `sha256:${createHash("sha256")
    .update(secretValue)
    .digest("hex")
    .slice(0, 16)}`;

const createRedactionFinding = ({
  detectorId,
  direction,
  path,
  secretValue,
  replacementValue,
}) =>
  freezeDeep({
    detectorId,
    direction,
    path,
    fingerprint: createSecretFingerprint(secretValue),
    matchCount: 1,
    originalLength: String(secretValue).length,
    replacementLength: replacementValue.length,
    action: "redacted",
  });

const createBlockedSecretFinding = ({
  detectorId,
  direction,
  path,
  secretValue,
}) =>
  freezeDeep({
    detectorId,
    direction,
    path,
    fingerprint: createSecretFingerprint(secretValue),
    matchCount: 1,
    originalLength: String(secretValue).length,
    replacementLength: 0,
    action: "blocked",
  });

const cloneDetectorPattern = (pattern) => new RegExp(pattern.source, pattern.flags);

const sanitizeStringValue = (
  value,
  path,
  direction,
  enabledDetectorIds,
  placeholder,
  findings,
  redactedPaths,
) => {
  let sanitizedValue = value;
  const pathLabel = formatPath(path);

  HIPPOCAMPUS_TEXT_SECRET_DETECTORS.forEach((detector) => {
    if (!enabledDetectorIds.has(detector.detectorId)) {
      return;
    }

    const pattern = cloneDetectorPattern(detector.pattern);
    sanitizedValue = sanitizedValue.replace(
      pattern,
      (match, ...replaceArgs) => {
        const captures = replaceArgs.slice(0, -2);
        const secretValue = detector.extractSecret(match, captures);
        const replacementValue = detector.replacer(
          match,
          captures,
          placeholder,
        );

        findings.push(
          createRedactionFinding({
            detectorId: detector.detectorId,
            direction,
            path: pathLabel,
            secretValue,
            replacementValue,
          }),
        );
        redactedPaths.add(pathLabel);

        return replacementValue;
      },
    );
  });

  return sanitizedValue;
};

const detectUnredactableStringSecrets = (
  value,
  path,
  direction,
  enabledDetectorIds,
  findings,
  unredactablePaths,
) => {
  const pathLabel = formatPath(path);

  HIPPOCAMPUS_TEXT_SECRET_DETECTORS.forEach((detector) => {
    if (!enabledDetectorIds.has(detector.detectorId)) {
      return;
    }

    const pattern = cloneDetectorPattern(detector.pattern);
    value.replace(pattern, (match, ...replaceArgs) => {
      const captures = replaceArgs.slice(0, -2);
      const secretValue = detector.extractSecret(match, captures);

      findings.push(
        createBlockedSecretFinding({
          detectorId: detector.detectorId,
          direction,
          path: pathLabel,
          secretValue,
        }),
      );
      unredactablePaths.add(pathLabel);

      return match;
    });
  });
};

const sanitizeForcedSecretValue = (
  value,
  path,
  direction,
  enabledDetectorIds,
  placeholder,
  findings,
  redactedPaths,
) => {
  if (!enabledDetectorIds.has("secret-field-name")) {
    return value;
  }

  const normalizedValue = String(value);

  if (!normalizedValue || normalizedValue === placeholder) {
    return value;
  }

  const pathLabel = formatPath(path);
  findings.push(
    createRedactionFinding({
      detectorId: "secret-field-name",
      direction,
      path: pathLabel,
      secretValue: normalizedValue,
      replacementValue: placeholder,
    }),
  );
  redactedPaths.add(pathLabel);
  return placeholder;
};

const shouldExcludeFieldName = (fieldName, excludedFieldNames) =>
  excludedFieldNames.has(fieldName.toLowerCase());

const isSecretFieldName = (fieldName, excludedFieldNames) =>
  !shouldExcludeFieldName(fieldName, excludedFieldNames) &&
  SECRET_FIELD_NAME_PATTERN.test(fieldName);

const getNearestFieldName = (path) => {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (typeof path[index] === "string") {
      return path[index];
    }
  }

  return null;
};

const sanitizeBoundaryValue = (
  value,
  context,
  state,
) => {
  if (typeof value === "string") {
    const nearestFieldName = getNearestFieldName(context.path);

    if (
      nearestFieldName &&
      shouldExcludeFieldName(nearestFieldName, state.excludedFieldNames)
    ) {
      detectUnredactableStringSecrets(
        value,
        context.path,
        state.direction,
        state.enabledDetectorIds,
        state.findings,
        state.unredactablePaths,
      );
      return value;
    }

    if (context.forceSecretRedaction) {
      return sanitizeForcedSecretValue(
        value,
        context.path,
        state.direction,
        state.enabledDetectorIds,
        state.placeholder,
        state.findings,
        state.redactedPaths,
      );
    }

    return sanitizeStringValue(
      value,
      context.path,
      state.direction,
      state.enabledDetectorIds,
      state.placeholder,
      state.findings,
      state.redactedPaths,
    );
  }

  if (
    context.forceSecretRedaction &&
    (typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint")
  ) {
    return sanitizeForcedSecretValue(
      value,
      context.path,
      state.direction,
      state.enabledDetectorIds,
      state.placeholder,
      state.findings,
      state.redactedPaths,
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (state.seen.has(value)) {
    return state.seen.get(value);
  }

  if (Array.isArray(value)) {
    const nextArray = [];
    state.seen.set(value, nextArray);

    value.forEach((entry, index) => {
      nextArray[index] = sanitizeBoundaryValue(
        entry,
        {
          path: [...context.path, index],
          forceSecretRedaction: context.forceSecretRedaction,
        },
        state,
      );
    });

    return nextArray;
  }

  if (!isPlainObject(value)) {
    return cloneValueDeep(value);
  }

  const nextObject = {};
  state.seen.set(value, nextObject);

  Object.entries(value).forEach(([key, nestedValue]) => {
    nextObject[key] = sanitizeBoundaryValue(
      nestedValue,
      {
        path: [...context.path, key],
        forceSecretRedaction:
          context.forceSecretRedaction ||
          isSecretFieldName(key, state.excludedFieldNames),
      },
      state,
    );
  });

  return nextObject;
};

export const sanitizeHippocampusBoundaryPayload = (
  payload,
  options = {},
) => {
  const normalizedOptions = isPlainObject(options) ? options : {};
  const policy = createHippocampusSecretRedactionPolicy(
    normalizedOptions.policy ?? DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY,
  );
  const findings = [];
  const redactedPaths = new Set();
  const unredactablePaths = new Set();
  const sanitizedPayload = sanitizeBoundaryValue(
    payload,
    {
      path: [],
      forceSecretRedaction: false,
    },
    {
      direction: normalizeBoundaryDirection(normalizedOptions.direction),
      enabledDetectorIds: new Set(policy.detectorIds),
      excludedFieldNames: new Set(
        policy.excludedFieldNames.map((fieldName) => fieldName.toLowerCase()),
      ),
      placeholder: policy.redactionPlaceholder,
      findings,
      redactedPaths,
      unredactablePaths,
      seen: new WeakMap(),
    },
  );

  return freezeDeep({
    policyId: policy.policyId,
    policyVersion: policy.version,
    direction: normalizeBoundaryDirection(normalizedOptions.direction),
    sanitizedAt: new Date().toISOString(),
    detected: findings.length > 0,
    hasUnredactableSecrets: unredactablePaths.size > 0,
    findingCount: findings.length,
    redactedPathCount: redactedPaths.size,
    unredactableFindingCount: findings.filter(
      (finding) => finding.action === "blocked",
    ).length,
    redactedPaths: freezeDeep([...redactedPaths]),
    unredactablePaths: freezeDeep([...unredactablePaths]),
    findings: freezeDeep(findings),
    sanitizedPayload: freezeDeep(sanitizedPayload),
  });
};
