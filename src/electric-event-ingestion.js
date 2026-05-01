const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

const normalizeRequiredString = (value, label) => {
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${label} must not be empty`);
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${label} must not be empty`);
  }

  return normalizedValue;
};

const normalizeOffset = (value, label) => {
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${label} must be present`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be finite`);
    }

    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new TypeError(`${label} must be present`);
    }

    return normalizedValue;
  }

  throw new TypeError(`${label} must be a string or number`);
};

const normalizeOptionalString = (value, label) => {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeRequiredString(value, label);
};

const compareOffsets = (left, right) => {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, { numeric: true });
};

const clonePayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(clonePayload);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, clonePayload(nestedValue)]),
    );
  }

  return value;
};

const createCheckpointKey = ({ agentId, syncSource, streamId }) =>
  JSON.stringify([agentId, syncSource, streamId]);

/**
 * Converts Electric stream events into normalized brain event rows plus
 * checkpoint intents. The returned checkpoint intents are safe to persist only
 * after a separate durable memory write path confirms success.
 */
export const ingestElectricEventBatch = (events, options = {}) => {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }

  if (!isPlainObject(options)) {
    throw new TypeError("options must be an object");
  }

  const hasDurableWriteResult =
    Object.hasOwn(options, "durableWriteResult") &&
    options.durableWriteResult !== undefined &&
    options.durableWriteResult !== null;
  const durableWriteResult = hasDurableWriteResult
    ? clonePayload(options.durableWriteResult)
    : null;
  const durableWriteCommitted =
    isPlainObject(durableWriteResult) && durableWriteResult.committed === true;
  const checkpointStatus = durableWriteCommitted ? "committable" : "pending";

  const rows = [];
  const checkpointMap = new Map();

  events.forEach((event, index) => {
    if (!isPlainObject(event)) {
      throw new TypeError(`events[${index}] must be an object`);
    }

    const agentId = normalizeRequiredString(event.agentId, `events[${index}].agentId`);
    const syncSource = normalizeRequiredString(
      event.syncSource ?? options.syncSource ?? "electric",
      `events[${index}].syncSource`,
    );
    const streamId = normalizeRequiredString(event.streamId, `events[${index}].streamId`);
    const offset = normalizeOffset(event.offset, `events[${index}].offset`);
    const eventType = normalizeRequiredString(
      event.eventType ?? event.type ?? "electric-event",
      `events[${index}].eventType`,
    );
    const observedAt = normalizeOptionalString(
      event.observedAt ?? options.observedAt ?? null,
      `events[${index}].observedAt`,
    );

    const row = {
      agentId,
      syncSource,
      streamId,
      offset,
      eventType,
      payload: clonePayload(event.payload ?? {}),
      observedAt,
    };
    rows.push(row);

    const checkpointKey = createCheckpointKey(row);
    const currentCheckpoint = checkpointMap.get(checkpointKey);

    if (!currentCheckpoint) {
      checkpointMap.set(checkpointKey, {
        agentId,
        syncSource,
        streamId,
        fromOffset: offset,
        toOffset: offset,
        status: checkpointStatus,
        committable: durableWriteCommitted,
        durableWriteResult,
      });
      return;
    }

    if (compareOffsets(offset, currentCheckpoint.fromOffset) < 0) {
      currentCheckpoint.fromOffset = offset;
    }

    if (compareOffsets(offset, currentCheckpoint.toOffset) > 0) {
      currentCheckpoint.toOffset = offset;
    }
  });

  return freezeDeep({
    rows,
    checkpointIntents: [...checkpointMap.values()],
  });
};
