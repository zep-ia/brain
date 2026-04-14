import { readFileSync } from "node:fs";

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

const normalizeOptionalString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredString(value, label);
};

const normalizeNullableNonNegativeInteger = (
  value,
  label,
  defaultValue = null,
) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer or null`);
  }

  return value;
};

const normalizeAgentTopKOverrides = (value, label) => {
  if (value === undefined || value === null) {
    return freezeDeep({});
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return freezeDeep(
    Object.fromEntries(
      Object.entries(value)
        .map(([agentId, agentConfig]) => {
          const normalizedAgentId = normalizeRequiredString(
            agentId,
            `${label} agentId`,
          );

          if (!isPlainObject(agentConfig)) {
            throw new TypeError(`${label}.${normalizedAgentId} must be an object`);
          }

          return [
            normalizedAgentId,
            freezeDeep({
              topK: normalizeNullableNonNegativeInteger(
                agentConfig.topK,
                `${label}.${normalizedAgentId}.topK`,
                undefined,
              ),
            }),
          ];
        })
        .sort(([leftAgentId], [rightAgentId]) =>
          leftAgentId.localeCompare(rightAgentId),
        ),
    ),
  );
};

const normalizeZepiaConsolidationTopKDocument = (
  value,
  label,
  configPath = null,
) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const source =
    isPlainObject(value.consolidationConfig) ? value.consolidationConfig : value;

  return freezeDeep({
    configPath,
    topK: normalizeNullableNonNegativeInteger(source.topK, `${label}.topK`),
    agents: normalizeAgentTopKOverrides(source.agents, `${label}.agents`),
  });
};

const loadZepiaConsolidationTopKConfiguration = (configPath) => {
  const normalizedPath = normalizeRequiredString(
    configPath,
    "Zepia consolidation topK consolidationConfigPath",
  );
  let rawConfig;

  try {
    rawConfig = readFileSync(normalizedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read Zepia consolidation topK config "${normalizedPath}": ${error.message}`,
    );
  }

  let parsedConfig;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    throw new TypeError(
      `Zepia consolidation topK config "${normalizedPath}" must be valid JSON`,
    );
  }

  return normalizeZepiaConsolidationTopKDocument(
    parsedConfig,
    `Zepia consolidation topK config "${normalizedPath}"`,
    normalizedPath,
  );
};

export const resolveZepiaConsolidationTopK = (input) => {
  if (!isPlainObject(input)) {
    throw new TypeError("Zepia consolidation topK input must be an object");
  }

  const agentId = normalizeRequiredString(
    input.agentId,
    "Zepia consolidation topK agentId",
  );
  const consolidationConfigPath = normalizeOptionalString(
    input.consolidationConfigPath,
    "Zepia consolidation topK consolidationConfigPath",
  );
  const fileConfiguration =
    consolidationConfigPath === null
      ? normalizeZepiaConsolidationTopKDocument(
          {},
          "Zepia consolidation topK defaults",
        )
      : loadZepiaConsolidationTopKConfiguration(consolidationConfigPath);
  const agentConfiguration = fileConfiguration.agents[agentId] ?? null;
  const topK =
    input.topK === undefined
      ? agentConfiguration?.topK === undefined
        ? fileConfiguration.topK
        : agentConfiguration.topK
      : normalizeNullableNonNegativeInteger(
          input.topK,
          "Zepia consolidation topK topK",
        );

  return freezeDeep({
    agentId,
    configPath: fileConfiguration.configPath,
    topK,
  });
};
