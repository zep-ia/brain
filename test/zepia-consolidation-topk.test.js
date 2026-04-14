import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MEMORY_NODE_KINDS,
  resolveZepiaConsolidationTopK,
  selectTopKConsolidationPromotions,
} from "../src/index.js";

const createTempConfigFile = (t, document) => {
  const directory = mkdtempSync(join(tmpdir(), "brain-topk-config-"));
  const configPath = join(directory, "consolidation-config.json");

  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(configPath, JSON.stringify(document, null, 2));
  return configPath;
};

const createPromotionCandidate = (candidateId, importanceScore, stabilityScore) => ({
  candidateId,
  agentId: "agent-007",
  sourceMemoryId: `${candidateId}-memory`,
  sourceMemoryKind: MEMORY_NODE_KINDS.shortTermMemory,
  signals: {
    youngGeneration: {
      importance: {
        capturedAt: "2026-04-14T01:00:00Z",
        sourceCollection: "importanceIndex",
        sourceRecordIds: [`importance-${candidateId}`],
        signals: {
          taskRelevance: importanceScore,
        },
      },
      stability: {
        capturedAt: "2026-04-14T01:00:00Z",
        sourceCollection: "shortTermMemory",
        sourceRecordIds: [`${candidateId}-memory`],
        signals: {
          repeatedRecall: stabilityScore,
        },
      },
    },
  },
});

test("resolveZepiaConsolidationTopK loads per-agent topK from a flat config file", (t) => {
  const configPath = createTempConfigFile(t, {
    topK: 3,
    agents: {
      "agent-007": {
        topK: 1,
      },
      "agent-999": {
        topK: 2,
      },
    },
  });
  const resolution = resolveZepiaConsolidationTopK({
    agentId: "agent-007",
    consolidationConfigPath: configPath,
  });
  const selection = selectTopKConsolidationPromotions({
    candidates: [
      createPromotionCandidate("promo-a", 0.9, 0.8),
      createPromotionCandidate("promo-b", 0.8, 0.7),
      createPromotionCandidate("promo-c", 0.6, 0.6),
    ],
    ...(resolution.topK === null ? {} : { topK: resolution.topK }),
  });

  assert.equal(resolution.agentId, "agent-007");
  assert.equal(resolution.configPath, configPath);
  assert.equal(resolution.topK, 1);
  assert.deepEqual(
    selection.selectedCandidates.map((entry) => entry.candidateId),
    ["promo-a"],
  );
  assert.deepEqual(
    selection.overflowCandidates.map((entry) => entry.candidateId),
    ["promo-b", "promo-c"],
  );
});

test("resolveZepiaConsolidationTopK supports consolidationConfig wrappers and inline overrides", (t) => {
  const configPath = createTempConfigFile(t, {
    consolidationConfig: {
      topK: 4,
      agents: {
        "agent-007": {
          topK: 2,
        },
      },
    },
  });
  const agentScopedResolution = resolveZepiaConsolidationTopK({
    agentId: "agent-007",
    consolidationConfigPath: configPath,
  });
  const inlineOverrideResolution = resolveZepiaConsolidationTopK({
    agentId: "agent-007",
    consolidationConfigPath: configPath,
    topK: 5,
  });
  const inlineDisableResolution = resolveZepiaConsolidationTopK({
    agentId: "agent-007",
    consolidationConfigPath: configPath,
    topK: null,
  });

  assert.equal(agentScopedResolution.topK, 2);
  assert.equal(inlineOverrideResolution.topK, 5);
  assert.equal(inlineDisableResolution.topK, null);
});

test("resolveZepiaConsolidationTopK falls back to the shared config topK for agents without overrides", (t) => {
  const configPath = createTempConfigFile(t, {
    consolidationConfig: {
      topK: 6,
      agents: {
        "agent-007": {
          topK: 2,
        },
      },
    },
  });
  const resolution = resolveZepiaConsolidationTopK({
    agentId: "agent-123",
    consolidationConfigPath: configPath,
  });

  assert.equal(resolution.topK, 6);
});

test("resolveZepiaConsolidationTopK rejects invalid config files and invalid topK values", (t) => {
  const invalidValuePath = createTempConfigFile(t, {
    consolidationConfig: {
      agents: {
        "agent-007": {
          topK: 1.5,
        },
      },
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "brain-topk-invalid-"));
  const malformedConfigPath = join(directory, "malformed.json");

  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(malformedConfigPath, "{not-json");

  assert.throws(
    () =>
      resolveZepiaConsolidationTopK({
        agentId: "agent-007",
        consolidationConfigPath: malformedConfigPath,
      }),
    /must be valid JSON/,
  );

  assert.throws(
    () =>
      resolveZepiaConsolidationTopK({
        agentId: "agent-007",
        consolidationConfigPath: invalidValuePath,
      }),
    /agents\.agent-007\.topK must be a non-negative integer or null/,
  );

  assert.throws(
    () =>
      resolveZepiaConsolidationTopK({
        agentId: "agent-007",
        topK: -1,
      }),
    /topK must be a non-negative integer or null/,
  );
});
