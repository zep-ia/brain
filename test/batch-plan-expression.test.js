import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBatchPlanExpression,
  parseBatchPlanExpression,
  tokenizeBatchPlanExpression,
} from "../src/batch-plan-expression.js";

test("batch-plan expression tokenizer supports comparisons, operators, and existing batch token shapes", () => {
  const tokens = tokenizeBatchPlanExpression(
    "runtimePhase:idle && (coordinationSignal:team-idle || operation:offline-consolidation-young-generation-triage) && overwriteTarget:long-term-memory:ltm-1",
  );

  assert.deepEqual(
    tokens.map((token) =>
      token.type === "comparison"
        ? {
            type: token.type,
            field: token.field,
            value: token.value,
          }
        : {
            type: token.type,
          },
    ),
    [
      {
        type: "comparison",
        field: "runtimePhase",
        value: "idle",
      },
      { type: "and" },
      { type: "open-paren" },
      {
        type: "comparison",
        field: "coordinationSignal",
        value: "team-idle",
      },
      { type: "or" },
      {
        type: "comparison",
        field: "operation",
        value: "offline-consolidation-young-generation-triage",
      },
      { type: "close-paren" },
      { type: "and" },
      {
        type: "comparison",
        field: "overwriteTarget",
        value: "long-term-memory:ltm-1",
      },
    ],
  );
});

test("batch-plan expression parser respects not, and, or precedence and grouping", () => {
  const expression =
    "!runtimePhase:active && (coordinationSignal:team-idle || runtimePhase:sleep)";

  assert.deepEqual(parseBatchPlanExpression(expression), {
    type: "and",
    left: {
      type: "not",
      operand: {
        type: "comparison",
        field: "runtimePhase",
        value: "active",
      },
    },
    right: {
      type: "or",
      left: {
        type: "comparison",
        field: "coordinationSignal",
        value: "team-idle",
      },
      right: {
        type: "comparison",
        field: "runtimePhase",
        value: "sleep",
      },
    },
  });
});

test("batch-plan expression parser accepts compact token combinations without spaces", () => {
  assert.deepEqual(
    parseBatchPlanExpression(
      "agentId:agent-alpha&&runtimePhase:idle||runtimePhase:sleep",
    ),
    {
      type: "or",
      left: {
        type: "and",
        left: {
          type: "comparison",
          field: "agentId",
          value: "agent-alpha",
        },
        right: {
          type: "comparison",
          field: "runtimePhase",
          value: "idle",
        },
      },
      right: {
        type: "comparison",
        field: "runtimePhase",
        value: "sleep",
      },
    },
  );
});

test("batch-plan expression normalizer emits one canonical form for equivalent whitespace, grouping, and operand order", () => {
  const expressions = [
    " runtimePhase:idle&&coordinationSignal:team-idle ",
    "(coordinationSignal:team-idle) && runtimePhase:idle",
    "coordinationSignal:team-idle && (runtimePhase:idle)",
  ];

  assert.deepEqual(
    expressions.map((expression) => normalizeBatchPlanExpression(expression)),
    [
      "coordinationSignal:team-idle && runtimePhase:idle",
      "coordinationSignal:team-idle && runtimePhase:idle",
      "coordinationSignal:team-idle && runtimePhase:idle",
    ],
  );
});

test("batch-plan expression normalizer applies stable ordering while preserving precedence-driven parentheses defaults", () => {
  assert.equal(
    normalizeBatchPlanExpression(
      "runtimePhase:sleep || (runtimePhase:idle && agentId:agent-alpha)",
    ),
    "runtimePhase:sleep || agentId:agent-alpha && runtimePhase:idle",
  );

  assert.equal(
    normalizeBatchPlanExpression(
      "(operation:offline-consolidation || coordinationSignal:team-idle) && runtimePhase:idle",
    ),
    "runtimePhase:idle && (coordinationSignal:team-idle || operation:offline-consolidation)",
  );
});

test("batch-plan expression parser fails closed on malformed expressions", () => {
  assert.throws(
    () => tokenizeBatchPlanExpression(" "),
    /batchPlanExpression must not be empty/,
  );
  assert.throws(
    () => parseBatchPlanExpression("runtimePhase:"),
    /value must not be empty/,
  );
  assert.throws(
    () => parseBatchPlanExpression("runtimePhase:idle && && coordinationSignal:team-idle"),
    /Unexpected token && while parsing batch-plan expression/,
  );
  assert.throws(
    () => parseBatchPlanExpression("(runtimePhase:idle || runtimePhase:sleep"),
    /unclosed "\(" group/,
  );
  assert.throws(
    () => parseBatchPlanExpression("runtimePhase:idle)"),
    /Unexpected trailing token \)/,
  );
  assert.throws(
    () => normalizeBatchPlanExpression("runtimePhase:idle &&"),
    /Unexpected end of batch-plan expression while parsing a primary clause/,
  );
});
