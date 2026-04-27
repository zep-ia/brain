import assert from "node:assert/strict";
import test from "node:test";

import {
  consolidateHippocampalEpisode,
  runAgentBrainExperiment,
} from "../src/index.js";

test("hippocampus consolidation filters recalled context, internal prompts, assistant echoes, and duplicates", () => {
  const result = consolidateHippocampalEpisode({
    agentId: "hermes-agent",
    sessionId: "discord-thread-1",
    events: [
      {
        id: "evt-user-context",
        role: "user",
        kind: "conversation",
        content:
          "[JQ] PR 올려줘\n\n<memory-context>\n## Brain Memory\nraw recalled assistant answer\n</memory-context>",
        signals: { userIntent: 1, projectRelevance: 0.8 },
      },
      {
        id: "evt-skill-reflection",
        role: "user",
        kind: "conversation",
        content:
          "Review the conversation above and consider whether a skill should be saved or updated.",
      },
      {
        id: "evt-assistant-echo",
        role: "assistant",
        kind: "conversation",
        content:
          "맞아. 현재 Brain provider는 raw event capture라서 PageRank edge가 0이고 score가 균등해.",
      },
      {
        id: "evt-durable-fact",
        role: "user",
        kind: "conversation",
        content:
          "User wants Hermes Brain memory to add a hippocampus layer before long-term promotion.",
        signals: { userPreference: 1, projectRelevance: 1 },
      },
      {
        id: "evt-durable-fact-copy",
        role: "user",
        kind: "conversation",
        content:
          "User wants Hermes Brain memory to add a hippocampus layer before long-term promotion.",
        signals: { userPreference: 1, projectRelevance: 1 },
      },
    ],
  });

  assert.equal(result.apiKind, "hippocampus_consolidation_result");
  assert.equal(result.filteredEvents.length, 2);
  assert.deepEqual(
    result.filteredEvents.map((event) => event.id),
    ["evt-user-context", "evt-durable-fact"],
  );
  assert.equal(result.filteredEvents[0].content.includes("<memory-context>"), false);
  assert.equal(result.filteredEvents[0].content.includes("raw recalled assistant answer"), false);
  assert.ok(result.droppedEvents.some((event) => event.reason === "internal-reflection-prompt"));
  assert.ok(result.droppedEvents.some((event) => event.reason === "assistant-echo-without-durable-signal"));
  assert.ok(result.droppedEvents.some((event) => event.reason === "duplicate-content"));
  assert.equal(result.promotedEvents.length, 2);
  assert.equal(result.promotedEvents.every((event) => event.metadata?.hippocampus?.promoted === true), true);
});

test("agent brain experiment can route events through hippocampus before PageRank promotion", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    topK: 5,
    hippocampus: { enabled: true },
    events: [
      {
        id: "raw-1",
        role: "user",
        content:
          "[JQ] 체크해봐\n<memory-context>\nold recalled context should not be promoted\n</memory-context>",
        signals: { userIntent: 1 },
      },
      {
        id: "raw-2",
        role: "assistant",
        content: "Long assistant explanation that should not be durable by default.",
      },
      {
        id: "raw-3",
        role: "user",
        content:
          "User prefers extracted durable facts over raw assistant responses in Brain memory.",
        signals: { userPreference: 1, projectRelevance: 1 },
      },
    ],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.hippocampus.enabled, true);
  assert.equal(result.hippocampus.droppedEvents.length, 1);
  assert.equal(result.graph.nodes.length, 2);
  assert.equal(JSON.stringify(result).includes("<memory-context>"), false);
  assert.equal(JSON.stringify(result).includes("old recalled context should not be promoted"), false);
  assert.deepEqual(
    result.longTermCandidates.map((candidate) => candidate.memoryId),
    ["raw-3", "raw-1"],
  );
});
