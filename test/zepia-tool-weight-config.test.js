import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingestZepiaToolCallTracking } from "../src/index.js";

const createTempConfigFile = (t, document) => {
  const directory = mkdtempSync(join(tmpdir(), "brain-tool-weights-"));
  const configPath = join(directory, "tool-weights.json");

  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(configPath, JSON.stringify(document, null, 2));
  return configPath;
};

const createWeightedTrackingFixture = (configPath, overrides = {}) =>
  ingestZepiaToolCallTracking({
    agentId: "agent-007",
    sessionId: "session-config-1",
    toolWeightConfigPath: configPath,
    toolCalls: [
      {
        toolCallId: "tool-call-1",
        toolName: "github.search_code",
        calledAt: "2026-04-14T01:00:00Z",
        sourceMemoryId: "wm-1",
        referencedMemoryIds: ["stm-1"],
      },
      {
        toolCallId: "tool-call-2",
        toolName: "brain.query_graph",
        calledAt: "2026-04-14T01:01:00Z",
        sourceMemoryId: "wm-2",
        referencedMemoryIds: ["ltm-2"],
      },
      {
        toolCallId: "tool-call-3",
        toolName: "unconfigured.tool",
        calledAt: "2026-04-14T01:02:00Z",
        sourceMemoryId: "wm-3",
        referencedMemoryIds: ["stm-3"],
      },
    ],
    ...overrides,
  });

test("ingestZepiaToolCallTracking loads tool edge weights from a flat JSON config file", (t) => {
  const configPath = createTempConfigFile(t, {
    defaultToolWeight: 0.75,
    toolWeights: {
      "brain.query_graph": 2.5,
      "github.search_code": 1.8,
    },
  });
  const result = createWeightedTrackingFixture(configPath);
  const edgeWeightsByToolCallId = Object.fromEntries(
    result.toolCalls.map((toolCall) => [
      toolCall.toolCallId,
      toolCall.coReferenceEdges.map((edge) => edge.edgeWeight),
    ]),
  );

  assert.deepEqual(edgeWeightsByToolCallId, {
    "tool-call-1": [1.8, 1.8],
    "tool-call-2": [2.5, 2.5],
    "tool-call-3": [0.75, 0.75],
  });
});

test("ingestZepiaToolCallTracking supports consolidationConfig wrappers and inline overrides", (t) => {
  const configPath = createTempConfigFile(t, {
    consolidationConfig: {
      defaultToolWeight: 0.4,
      toolWeights: {
        "brain.query_graph": 1.2,
        "github.search_code": 0.9,
      },
    },
  });
  const result = createWeightedTrackingFixture(configPath, {
    defaultToolWeight: 0.6,
    toolWeights: {
      "github.search_code": 3.1,
    },
  });
  const edgeWeightsByToolCallId = Object.fromEntries(
    result.toolCalls.map((toolCall) => [
      toolCall.toolCallId,
      toolCall.coReferenceEdges.map((edge) => edge.edgeWeight),
    ]),
  );

  assert.deepEqual(edgeWeightsByToolCallId, {
    "tool-call-1": [3.1, 3.1],
    "tool-call-2": [1.2, 1.2],
    "tool-call-3": [0.6, 0.6],
  });
});

test("ingestZepiaToolCallTracking rejects invalid tool weight config files", (t) => {
  const invalidJsonPath = createTempConfigFile(t, {
    toolWeights: {
      "github.search_code": 1.8,
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "brain-tool-weights-invalid-"));
  const malformedConfigPath = join(directory, "malformed.json");

  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(malformedConfigPath, "{not-json");

  assert.throws(
    () =>
      createWeightedTrackingFixture(malformedConfigPath, {
        toolCalls: [
          {
            toolCallId: "tool-call-invalid-json",
            toolName: "github.search_code",
            calledAt: "2026-04-14T01:00:00Z",
            sourceMemoryId: "wm-1",
            referencedMemoryIds: ["stm-1"],
          },
        ],
      }),
    /must be valid JSON/,
  );

  assert.throws(
    () =>
      createWeightedTrackingFixture(invalidJsonPath, {
        toolWeights: {
          "github.search_code": -1,
        },
      }),
    /toolWeights\.github\.search_code must be a non-negative number/,
  );
});
