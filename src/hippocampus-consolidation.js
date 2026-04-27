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

const normalizeOptionalString = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeNonNegativeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
};

const normalizeSignals = (value) => {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([signalName]) => typeof signalName === "string" && signalName.trim())
      .map(([signalName, signalValue]) => [
        signalName.trim(),
        normalizeNonNegativeNumber(signalValue),
      ]),
  );
};

const normalizeReferences = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
};

const stripRecalledMemoryContext = (content) =>
  content
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isInternalReflectionPrompt = (content) =>
  /^Review the conversation above and consider whether a skill should be saved or updated\.?/i.test(
    content.trim(),
  ) ||
  /Only act when something is genuinely worth saving/i.test(content) ||
  /SURVEY the existing skill landscape/i.test(content);

const hasDurableSignal = (signals) =>
  Object.entries(signals).some(([signalName, signalValue]) => {
    const normalizedName = signalName.toLowerCase();
    return (
      signalValue > 0 &&
      (
        normalizedName.includes("preference") ||
        normalizedName.includes("correction") ||
        normalizedName.includes("decision") ||
        normalizedName.includes("memory") ||
        normalizedName.includes("durable") ||
        normalizedName.includes("project") ||
        normalizedName.includes("recurrence")
      )
    );
  });

const calculateImportance = (signals, role) => {
  const signalValues = Object.values(signals);
  const signalAverage =
    signalValues.length === 0
      ? 0
      : signalValues.reduce((total, value) => total + value, 0) / signalValues.length;
  const roleBoost = role === "user" ? 0.15 : 0;
  return Number(Math.min(1, Math.max(0.01, signalAverage + roleBoost)).toFixed(4));
};

const looksLikeDurableFact = (content) =>
  /\b(user|caller)\s+(prefers|expects|wants|asked|requires|needs)\b/i.test(content) ||
  /\b(remember|decision|decided|should|must|needs?|requires?|preference|project|memory|hippocampus|consolidation)\b/i.test(
    content,
  );

const createContentFingerprint = (content) =>
  content.toLowerCase().replace(/\s+/g, " ").trim();

const normalizeEvent = (event, index) => {
  if (!isPlainObject(event)) {
    throw new TypeError(`events[${index}] must be an object`);
  }

  const id = normalizeRequiredString(event.id ?? event.memoryId, `events[${index}].id`);
  const rawContent = normalizeRequiredString(event.content, `events[${index}].content`);
  const content = stripRecalledMemoryContext(rawContent);
  const signals = normalizeSignals(event.signals);
  const role = normalizeOptionalString(event.role ?? event.metadata?.role).toLowerCase() || "event";
  const kind = normalizeOptionalString(event.kind ?? event.type) || "observation";

  return {
    id,
    role,
    kind,
    content,
    originalContent: rawContent,
    summary: normalizeOptionalString(event.summary) || content,
    references: normalizeReferences(event.references ?? event.referenceIds),
    signals,
    metadata: isPlainObject(event.metadata) ? { ...event.metadata } : {},
  };
};

const createDroppedEvent = (event, reason) => ({
  id: event.id,
  role: event.role,
  kind: event.kind,
  reason,
});

export const DEFAULT_HIPPOCAMPUS_CONSOLIDATION_OPTIONS = freezeDeep({
  dropAssistantEchoesWithoutDurableSignal: true,
  stripRecalledMemoryContext: true,
  dedupeContent: true,
});

export const consolidateHippocampalEpisode = (input = {}) => {
  const normalizedInput = isPlainObject(input) ? input : {};
  const agentId = normalizeRequiredString(normalizedInput.agentId, "agentId");
  const sessionId = normalizeOptionalString(normalizedInput.sessionId) || null;
  const events = Array.isArray(normalizedInput.events) ? normalizedInput.events : [];

  const filteredEvents = [];
  const droppedEvents = [];
  const seenFingerprints = new Set();

  events.map(normalizeEvent).forEach((event) => {
    if (!event.content) {
      droppedEvents.push(createDroppedEvent(event, "empty-after-sanitization"));
      return;
    }

    if (["system", "developer", "internal"].includes(event.role) || event.kind === "internal") {
      droppedEvents.push(createDroppedEvent(event, "internal-event"));
      return;
    }

    if (isInternalReflectionPrompt(event.content)) {
      droppedEvents.push(createDroppedEvent(event, "internal-reflection-prompt"));
      return;
    }

    if (event.role === "assistant" && !hasDurableSignal(event.signals)) {
      droppedEvents.push(createDroppedEvent(event, "assistant-echo-without-durable-signal"));
      return;
    }

    const fingerprint = createContentFingerprint(event.content);
    if (seenFingerprints.has(fingerprint)) {
      droppedEvents.push(createDroppedEvent(event, "duplicate-content"));
      return;
    }
    seenFingerprints.add(fingerprint);

    const importance = calculateImportance(event.signals, event.role);
    const durability = looksLikeDurableFact(event.content) || hasDurableSignal(event.signals) ? 1 : 0.1;
    filteredEvents.push({
      id: event.id,
      kind: event.kind,
      role: event.role,
      content: event.content,
      summary: event.summary === event.originalContent ? event.content : stripRecalledMemoryContext(event.summary),
      references: event.references,
      signals: {
        ...event.signals,
        hippocampalDurability: durability,
        hippocampalImportance: importance,
      },
      metadata: {
        ...event.metadata,
        role: event.role,
        sessionId: event.metadata.sessionId ?? sessionId ?? undefined,
        hippocampus: {
          filtered: true,
          recalledContextStripped: event.content !== event.originalContent,
          importance,
        },
      },
    });
  });

  const promotedEvents = filteredEvents
    .filter((event) => event.role === "user" || hasDurableSignal(event.signals) || looksLikeDurableFact(event.content))
    .map((event) => freezeDeep({
      id: event.id,
      kind: event.kind === "conversation" ? "episodic_fact" : event.kind,
      content: event.content,
      summary: event.summary,
      references: event.references,
      signals: event.signals,
      metadata: {
        ...event.metadata,
        hippocampus: {
          ...event.metadata.hippocampus,
          promoted: true,
          promotionReason: "hippocampus-filtered-durable-event",
        },
      },
    }));

  return freezeDeep({
    apiKind: "hippocampus_consolidation_result",
    schemaVersion: "1.0.0",
    agentId,
    sessionId,
    filteredEvents: filteredEvents.map(freezeDeep),
    promotedEvents,
    droppedEvents: droppedEvents.map(freezeDeep),
  });
};
