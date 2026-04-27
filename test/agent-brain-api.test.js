import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS,
  buildAgentBrainMemoryGraph,
  consolidateHippocampalEpisode,
  runAgentBrainExperiment,
} from "../src/index.js";

test("agent brain API ranks generic Hermes events without Zepia-specific inputs", () => {
  const graph = buildAgentBrainMemoryGraph({
    agentId: "hermes-agent",
    events: [
      {
        id: "evt-1",
        content: "User prefers project-aware Gmail labels.",
        kind: "conversation",
        signals: { userCorrection: 0.9, projectRelevance: 0.8 },
        references: ["evt-2"],
      },
      {
        id: "evt-2",
        content: "Daily morning Google Workspace workflow should run around 9 AM.",
        kind: "workflow",
        signals: { projectRelevance: 0.9, recurrence: 0.9 },
        references: ["evt-1"],
      },
      {
        id: "evt-3",
        content: "Temporary debug note with low value.",
        kind: "observation",
        signals: { projectRelevance: 0.1 },
      },
    ],
    toolCalls: [
      {
        id: "tool-1",
        sourceEventIds: ["evt-1"],
        referencedEventIds: ["evt-2"],
        toolName: "gmail.label.apply",
        weight: 2,
      },
    ],
  });

  assert.equal(graph.apiKind, "agent_brain_api_graph");
  assert.equal(graph.agentId, "hermes-agent");
  assert.equal(graph.nodes.length, 3);
  assert.ok(graph.edges.length >= 3);
  assert.equal(graph.zepiaCoupling, "none");
});

test("agent brain hippocampus demotes low-value user prompts from long-term promotion", () => {
  const hippocampus = consolidateHippocampalEpisode({
    agentId: "hermes-agent",
    sessionId: "session-quality",
    events: [
      {
        id: "durable-config",
        content:
          "Hermes local config is set to memory.provider=brain and PR #16224 includes brain_status graph metrics.",
        kind: "memory_write",
        role: "memory",
        signals: { durable: 1 },
      },
      {
        id: "low-value-writing-prompt",
        content: "[JQ] 책을 쓰면 좋은점에 대해 설명해봐\n\n그리고 draft좀 작성해줘",
        kind: "message",
        role: "user",
      },
      {
        id: "low-value-status-check",
        content: "[JQ] 오케이 자신있어?",
        kind: "message",
        role: "user",
      },
    ],
  });

  assert.deepEqual(
    hippocampus.promotedEvents.map((event) => event.id),
    ["durable-config"],
  );
  assert.ok(hippocampus.filteredEvents.some((event) => event.id === "low-value-writing-prompt"));
});

test("agent brain API derives graph edges from session continuity and shared concepts", () => {
  const graph = buildAgentBrainMemoryGraph({
    agentId: "hermes-agent",
    events: [
      {
        id: "turn-1-user",
        content: "User wants the Brain memory provider to remember hippocampus consolidation work.",
        kind: "message",
        metadata: { role: "user", sessionId: "session-a" },
      },
      {
        id: "turn-1-assistant",
        content: "Implemented hippocampus consolidation for the Brain memory provider.",
        kind: "message",
        metadata: { role: "assistant", sessionId: "session-a" },
      },
      {
        id: "turn-2-user",
        content: "Improve the Brain memory graph so PageRank has useful edges.",
        kind: "message",
        metadata: { role: "user", sessionId: "session-a" },
      },
      {
        id: "other-session",
        content: "Unrelated lunch note.",
        kind: "observation",
        metadata: { role: "user", sessionId: "session-b" },
      },
    ],
  });

  const relations = new Set(graph.edges.map((edge) => edge.relation));
  assert.ok(relations.has("session-continuity"));
  assert.ok(relations.has("shared-concept"));
  assert.ok(graph.edges.every((edge) => edge.from !== edge.to));
  assert.ok(graph.edges.some((edge) => edge.from === "turn-1-user" && edge.to === "turn-1-assistant"));
  assert.equal(graph.edges.some((edge) => edge.from === "other-session" || edge.to === "other-session"), false);
});

test("agent brain hippocampus experiment produces connected graph without explicit references", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    hippocampus: { enabled: true },
    topK: 2,
    events: [
      {
        id: "evt-user-1",
        content: "Remember that Hermes Brain needs hippocampus consolidation for durable memory.",
        kind: "message",
        metadata: { role: "user", sessionId: "session-a" },
      },
      {
        id: "evt-user-2",
        content: "Improve Hermes Brain graph edges so PageRank can link related memory events.",
        kind: "message",
        metadata: { role: "user", sessionId: "session-a" },
      },
      {
        id: "evt-assistant-noise",
        content: "I can help with that.",
        kind: "message",
        metadata: { role: "assistant", sessionId: "session-a" },
      },
    ],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.hippocampus.enabled, true);
  assert.ok(result.graph.edges.length > 0);
  assert.ok(result.graph.edges.some((edge) => edge.relation === "session-continuity"));
  assert.equal(result.graph.nodes.some((node) => node.memoryId === "evt-assistant-noise"), false);
});

test("agent brain experiment diversifies long-term candidates by suppressing near-duplicate durable summaries", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    topK: 2,
    hippocampus: { enabled: true },
    events: [
      {
        id: "newer-hermes-summary",
        role: "memory",
        kind: "memory_write",
        content:
          "Hermes local config is set to memory.provider=brain with brain repo path and PR #16224 includes hippocampus payload enablement, local noise filtering, and brain_status graph metrics.",
        signals: { durable: 1, projectRelevance: 1 },
      },
      {
        id: "older-hermes-summary",
        role: "memory",
        kind: "memory_write",
        content:
          "Hermes local config is set to memory.provider=brain with brain repo path and PR #16224 includes hippocampus payload enablement and local noise filtering.",
        signals: { durable: 0.9, projectRelevance: 0.9 },
      },
      {
        id: "zep-brain-summary",
        role: "memory",
        kind: "memory_write",
        content:
          "zep-ia/brain PR #3 adds session-continuity graph edges and shared-concept linking for PageRank recall quality.",
        signals: { durable: 0.8, projectRelevance: 0.8 },
      },
    ],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    result.longTermCandidates.map((candidate) => candidate.memoryId),
    ["newer-hermes-summary", "zep-brain-summary"],
  );
});

test("agent brain experiment defaults to 90 PageRank iterations and returns top long-term candidates", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    topK: 2,
    events: [
      {
        id: "evt-1",
        content: "Remember SNUTI context through calendar integration.",
        kind: "semantic",
        signals: { projectRelevance: 1, recurrence: 0.7 },
        references: ["evt-2"],
      },
      {
        id: "evt-2",
        content: "Gmail automation should infer project context from ongoing conversations.",
        kind: "procedural",
        signals: { projectRelevance: 1, userCorrection: 0.8 },
        references: ["evt-1"],
      },
      {
        id: "evt-3",
        content: "One-off scratch note.",
        kind: "observation",
        signals: { projectRelevance: 0.05 },
      },
    ],
  });

  assert.equal(AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS, 90);
  assert.equal(result.iterationsRequested, 90);
  assert.equal(result.pageRank.iterationsCompleted <= 90, true);
  assert.equal(result.runtimeAuthorization.authorized, true);
  assert.equal(result.longTermCandidates.length, 2);
  assert.deepEqual(
    result.longTermCandidates.map((candidate) => candidate.memoryId),
    ["evt-2", "evt-1"],
  );
});

test("agent brain experiment honors custom iteration budgets in promotion metadata", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    iterations: 7,
    runtime: { phase: "idle", authority: "caller" },
    events: [
      {
        id: "evt-custom",
        content: "Custom iteration budget should be observable by callers.",
        signals: { projectRelevance: 1 },
      },
    ],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.iterationsRequested, 7);
  assert.equal(result.pageRank.maxIterations, 7);
  assert.equal(result.pageRank.iterationsCompleted <= 7, true);
  assert.equal(
    result.longTermCandidates[0].promotionReason,
    "top-k-page-rank-after-7-iteration-agent-experiment",
  );
});

test("agent brain graph rejects malformed collection inputs and duplicate memory ids", () => {
  assert.throws(
    () => buildAgentBrainMemoryGraph({ agentId: "hermes-agent", events: {} }),
    /events must be an array/,
  );
  assert.throws(
    () => buildAgentBrainMemoryGraph({ agentId: "hermes-agent", toolCalls: {} }),
    /toolCalls must be an array/,
  );
  assert.throws(
    () =>
      buildAgentBrainMemoryGraph({
        agentId: "hermes-agent",
        events: [
          { id: "evt-1", content: "First copy." },
          { id: "evt-1", content: "Duplicate copy." },
        ],
      }),
    /duplicate memory id: evt-1/,
  );
});

test("agent brain experiment fail-closes when graph identity fields contain unredactable secrets", () => {
  const secretId = ["sk", "proj", "1234567890abcdefghijklmnopqrstuv"].join("-");
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    events: [
      {
        id: secretId,
        content: "Deploy token must not become a memory identifier.",
        kind: "semantic",
        signals: { projectRelevance: 1, recurrence: 1 },
      },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.graphSecretBoundary.hasUnredactableSecrets, true);
  assert.equal(result.graph, null);
  assert.equal(result.longTermCandidates.length, 0);
});

test("agent brain experiment blocks non-caller runtime authorities", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "scheduler" },
    events: [
      {
        id: "evt-1",
        content: "Should not consolidate from scheduler-only authority.",
        signals: { projectRelevance: 1 },
      },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeAuthorization.authorized, false);
  assert.equal(result.longTermCandidates.length, 0);
});

test("agent brain experiment blocks default active runtime consolidation", () => {
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    events: [
      {
        id: "evt-active",
        content: "Active runtime should capture only, not consolidate.",
        signals: { projectRelevance: 1 },
      },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeAuthorization.phase, "active");
  assert.equal(result.runtimeAuthorization.authorized, false);
  assert.equal(result.longTermCandidates.length, 0);
});

test("agent brain experiment redacts secrets from every returned event-derived payload", () => {
  const secret = ["sk", "proj", "1234567890abcdefghijklmnopqrstuv"].join("-");
  const result = runAgentBrainExperiment({
    agentId: "hermes-agent",
    runtime: { phase: "idle", authority: "caller" },
    events: [
      {
        id: "evt-redactable",
        content: `A redactable key ${secret} appeared in conversation text.`,
        signals: { projectRelevance: 1 },
      },
    ],
  });

  const serialized = JSON.stringify(result);
  assert.equal(result.status, "completed");
  assert.equal(serialized.includes(secret), false);
  assert.equal(result.graphSecretBoundary.detected, true);
});
