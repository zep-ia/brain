import { DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY } from "../src/index.js";

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

export const TEST_HIPPOCAMPUS_SECRETS = freezeDeep({
  openAiApiKey: "sk-proj-1234567890abcdefghijklmnopqrstuvABCDE",
  githubToken: "ghp_1234567890abcdefghijklmnopqrstuvABCDE",
  jwt:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.signaturevalue1234567890",
  privateKey: [
    "-----BEGIN PRIVATE KEY-----",
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...",
    "-----END PRIVATE KEY-----",
  ].join("\n"),
  password: "swordfish-123",
});

export const TEST_HIPPOCAMPUS_SECRET_VALUES = freezeDeep(
  Object.values(TEST_HIPPOCAMPUS_SECRETS),
);

const createInactiveShortTermMemoryLifecycle = (inactiveAt) => ({
  state: "inactive",
  inactiveAt,
  inactiveReason: "queued-for-offline-consolidation",
});

const createInactiveShortTermMemoryMasking = (inactiveAt) => ({
  maskedAt: inactiveAt,
  maskedBy: "offline-consolidation",
  reason: "queued-for-offline-consolidation",
});

export const createInactiveShortTermMemoryEnvelope = (
  memoryId,
  record,
  {
    inactiveAt = "2026-04-14T10:00:00Z",
    lifecycle = createInactiveShortTermMemoryLifecycle(inactiveAt),
    masking = createInactiveShortTermMemoryMasking(inactiveAt),
  } = {},
) =>
  freezeDeep({
    record: {
      memoryId,
      ...record,
    },
    inactiveForRetrieval: true,
    masking,
    lifecycle,
  });

const createMultiPatternSecretTextSet = (redactionPlaceholder) =>
  freezeDeep({
    raw: {
      content: [
        `OpenAI ${TEST_HIPPOCAMPUS_SECRETS.openAiApiKey}`,
        TEST_HIPPOCAMPUS_SECRETS.privateKey,
        `JWT ${TEST_HIPPOCAMPUS_SECRETS.jwt}`,
      ].join("\n"),
      summary: `GitHub token ${TEST_HIPPOCAMPUS_SECRETS.githubToken}`,
      detail: [
        `OpenAI ${TEST_HIPPOCAMPUS_SECRETS.openAiApiKey}`,
        TEST_HIPPOCAMPUS_SECRETS.privateKey,
        `JWT ${TEST_HIPPOCAMPUS_SECRETS.jwt}`,
        `password=${TEST_HIPPOCAMPUS_SECRETS.password}`,
      ].join("\n"),
      provenanceConnection: `Authorization: Bearer ${TEST_HIPPOCAMPUS_SECRETS.jwt}`,
      password: TEST_HIPPOCAMPUS_SECRETS.password,
      apiKey: TEST_HIPPOCAMPUS_SECRETS.openAiApiKey,
    },
    sanitized: {
      content: [
        `OpenAI ${redactionPlaceholder}`,
        redactionPlaceholder,
        `JWT ${redactionPlaceholder}`,
      ].join("\n"),
      summary: `GitHub token ${redactionPlaceholder}`,
      detail: [
        `OpenAI ${redactionPlaceholder}`,
        redactionPlaceholder,
        `JWT ${redactionPlaceholder}`,
        `password=${redactionPlaceholder}`,
      ].join("\n"),
      provenanceConnection: `Authorization: ${redactionPlaceholder} ${redactionPlaceholder}`,
      password: redactionPlaceholder,
      apiKey: redactionPlaceholder,
    },
  });

export const createShortTermSecretFixture = ({
  memoryId = "stm-secret-fixture",
  observedAt = "2026-04-14T10:00:00Z",
  inactiveAt = observedAt,
  evidenceId = `turn-${memoryId}`,
  redactionPlaceholder = DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY.redactionPlaceholder,
} = {}) => {
  const text = createMultiPatternSecretTextSet(redactionPlaceholder);
  const provenance = freezeDeep({
    source: "conversation",
    observedAt,
    evidence: [evidenceId],
    connection: text.raw.provenanceConnection,
  });
  const sanitizedProvenance = freezeDeep({
    source: "conversation",
    observedAt,
    evidence: [evidenceId],
    connection: text.sanitized.provenanceConnection,
  });

  return freezeDeep({
    memoryId,
    evidenceId,
    observedAt,
    redactionPlaceholder,
    secrets: TEST_HIPPOCAMPUS_SECRETS,
    rawSecretValues: TEST_HIPPOCAMPUS_SECRET_VALUES,
    shortTermMemory: createInactiveShortTermMemoryEnvelope(
      memoryId,
      {
        summary: text.raw.summary,
        detail: text.raw.detail,
        tags: ["security", "sanitization"],
        provenance,
      },
      { inactiveAt },
    ),
    expectedSanitizedShortTermMemory: createInactiveShortTermMemoryEnvelope(
      memoryId,
      {
        summary: text.sanitized.summary,
        detail: text.sanitized.detail,
        tags: ["security", "sanitization"],
        provenance: sanitizedProvenance,
      },
      { inactiveAt },
    ),
    promotionShortTermMemory: createInactiveShortTermMemoryEnvelope(
      memoryId,
      {
        content: text.raw.content,
        summary: text.raw.summary,
        provenance,
      },
      { inactiveAt },
    ),
    expectedSerializedLongTerm: freezeDeep({
      content: text.sanitized.content,
      summary: text.sanitized.summary,
      provenanceConnection: text.sanitized.provenanceConnection,
    }),
    sanitizerPayload: freezeDeep({
      record: {
        memoryId,
        content: text.raw.content,
        summary: text.raw.summary,
        detail: text.raw.detail,
        provenance,
      },
      metadata: {
        password: text.raw.password,
        credentials: {
          apiKey: text.raw.apiKey,
        },
      },
    }),
    expectedSanitizedPayload: freezeDeep({
      record: {
        memoryId,
        content: text.sanitized.content,
        summary: text.sanitized.summary,
        detail: text.sanitized.detail,
        provenance: sanitizedProvenance,
      },
      metadata: {
        password: text.sanitized.password,
        credentials: {
          apiKey: text.sanitized.apiKey,
        },
      },
    }),
    expectedRedactedPaths: freezeDeep([
      "record.content",
      "record.summary",
      "record.detail",
      "record.provenance.connection",
      "metadata.password",
      "metadata.credentials.apiKey",
    ]),
  });
};
