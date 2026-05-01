import assert from "node:assert/strict";
import test from "node:test";

import { createElectricPostgresShapeContract } from "../src/index.js";

const shapeByName = (contract, shapeName) =>
  contract.shapes.find((shape) => shape.shapeName === shapeName);

test("shape table list contains required Electric Postgres tables", () => {
  const contract = createElectricPostgresShapeContract();
  const tables = contract.shapes.map((shape) => shape.table);

  assert.deepEqual(
    new Set(tables),
    new Set([
      "agent_events",
      "memory_candidates",
      "long_term_memory",
      "consolidation_jobs",
      "stream_checkpoints",
    ]),
  );
});

test("memory candidate shape is agent-scoped", () => {
  const contract = createElectricPostgresShapeContract();
  const shape = shapeByName(contract, "memory_candidates_by_agent");

  assert.equal(shape.table, "memory_candidates");
  assert.equal(shape.accessScope, "agent");
  assert.equal(shape.whereTemplate, "agent_id = $agent_id and status in ('pending', 'deferred')");
  assert.deepEqual(shape.parameters, ["agentId"]);
});

test("long-term memory shape is agent-scoped", () => {
  const contract = createElectricPostgresShapeContract();
  const shape = shapeByName(contract, "long_term_memory_by_agent");

  assert.equal(shape.table, "long_term_memory");
  assert.equal(shape.accessScope, "agent");
  assert.equal(shape.whereTemplate, "agent_id = $agent_id");
  assert.deepEqual(shape.parameters, ["agentId"]);
});

test("shape contract is pure and deeply frozen", () => {
  const first = createElectricPostgresShapeContract();
  const second = createElectricPostgresShapeContract();

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.shapes), true);
  assert.equal(Object.isFrozen(first.shapes[0]), true);
  assert.equal(Object.isFrozen(first.shapes[0].parameters), true);
  assert.equal(first.writeAuthority, false);
  assert.match(first.description, /read-sync/i);
});
