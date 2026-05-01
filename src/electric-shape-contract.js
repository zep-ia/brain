const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

const cloneShape = (shape) => ({
  ...shape,
  parameters: [...shape.parameters],
});

const ELECTRIC_POSTGRES_SHAPES = freezeDeep([
  {
    shapeName: "agent_events_by_session",
    table: "agent_events",
    whereTemplate: "session_id = $session_id",
    parameters: ["sessionId"],
    accessScope: "session",
  },
  {
    shapeName: "memory_candidates_by_agent",
    table: "memory_candidates",
    whereTemplate: "agent_id = $agent_id and status in ('pending', 'deferred')",
    parameters: ["agentId"],
    accessScope: "agent",
  },
  {
    shapeName: "long_term_memory_by_agent",
    table: "long_term_memory",
    whereTemplate: "agent_id = $agent_id",
    parameters: ["agentId"],
    accessScope: "agent",
  },
  {
    shapeName: "active_consolidation_jobs",
    table: "consolidation_jobs",
    whereTemplate: "status in ('queued', 'running', 'blocked')",
    parameters: [],
    accessScope: "service",
  },
  {
    shapeName: "stream_checkpoints_by_agent",
    table: "stream_checkpoints",
    whereTemplate: "agent_id = $agent_id",
    parameters: ["agentId"],
    accessScope: "agent",
  },
]);

export const ELECTRIC_POSTGRES_SHAPE_CONTRACT_SCHEMA_ID =
  "agent_brain_electric_postgres_shape_contract";

export const createElectricPostgresShapeContract = () =>
  freezeDeep({
    schemaId: ELECTRIC_POSTGRES_SHAPE_CONTRACT_SCHEMA_ID,
    schemaVersion: "1.0.0",
    description:
      "Electric Postgres read-sync shape contract; durable writes remain owned by the brain/backend write path.",
    readSyncPlane: "electric-postgres-shapes",
    writeAuthority: false,
    shapes: ELECTRIC_POSTGRES_SHAPES.map(cloneShape),
  });
