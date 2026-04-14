import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import (
    DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA_V1,
    OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
    DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
    MEMORY_GRAPH_SCHEMA_V1,
    OFFLINE_BATCH_LIMIT_SCHEMA_V1,
    OFFLINE_BATCH_ORDERING_STRATEGIES,
    OFFLINE_BATCH_PLAN_SCHEMA_V1,
    OFFLINE_BATCH_WORK_UNIT_SCHEMA_V1,
    schema_snapshot,
)


class OfflineBatchSchemaTest(unittest.TestCase):
    def test_request_schema_publishes_pre_execution_runtime_and_safety_guards(
        self,
    ) -> None:
        fields = OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA_V1["field_definitions"]

        self.assertEqual(
            OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
            ("idle", "sleep"),
        )
        self.assertEqual(
            OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
            ("independent", "team-idle"),
        )
        self.assertEqual(
            OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA_V1["schema_id"],
            "agent_brain_offline_consolidation_request",
        )
        self.assertEqual(fields["runtimeWindow"]["values"], ("idle", "sleep"))
        self.assertEqual(
            fields["coordinationHint"]["values"],
            ("independent", "team-idle"),
        )
        self.assertEqual(fields["authorizationModel"]["const"], "runtime-phase-only")
        self.assertEqual(fields["heuristicsPolicy"]["const"], "suggest-only")
        self.assertEqual(fields["teamCoordinationPolicy"]["const"], "batch-only")
        self.assertFalse(fields["allowIdentityPromotion"]["const"])
        self.assertEqual(fields["scope"]["const"], "agent-scoped")
        self.assertEqual(
            fields["workingLoopIsolation"]["const"],
            "offline-decoupled",
        )

    def test_limit_schema_declares_runtime_authorized_offline_constraints(self) -> None:
        fields = OFFLINE_BATCH_LIMIT_SCHEMA_V1["field_definitions"]

        self.assertEqual(
            OFFLINE_BATCH_LIMIT_SCHEMA_V1["schema_id"],
            "agent_brain_offline_batch_limit",
        )
        self.assertEqual(
            OFFLINE_BATCH_ORDERING_STRATEGIES,
            ("priority-descending-then-sequence", "sequence-only"),
        )
        self.assertEqual(
            DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
            "priority-descending-then-sequence",
        )
        self.assertTrue(fields["requiresRuntimeAuthorization"]["const"])
        self.assertFalse(fields["heuristicsAuthorizeExecution"]["const"])
        self.assertEqual(fields["identityIsolationMode"]["const"], "agent-scoped")
        self.assertEqual(fields["executorBinding"]["const"], "external")
        self.assertEqual(
            fields["liveWorkingLoopCoupling"]["const"],
            "offline-decoupled",
        )

    def test_default_b200_limit_keeps_architecture_level_constraints_without_benchmarks(
        self,
    ) -> None:
        self.assertEqual(
            DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1["targetProfile"],
            "b200-style",
        )
        self.assertEqual(
            DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1["acceleratorClass"],
            "b200-style",
        )
        self.assertFalse(
            DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1["numericThroughputBenchmarkRequired"]
        )
        self.assertIsNone(DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1["maxAgentsPerBatch"])

    def test_work_unit_and_plan_schema_capture_ordering_and_capacity_without_executor_fields(
        self,
    ) -> None:
        work_unit_fields = OFFLINE_BATCH_WORK_UNIT_SCHEMA_V1["field_definitions"]
        plan_fields = OFFLINE_BATCH_PLAN_SCHEMA_V1["field_definitions"]

        self.assertIn("order", work_unit_fields)
        self.assertIn("capacityCost", work_unit_fields)
        self.assertTrue(work_unit_fields["requiresRuntimeAuthorization"]["const"])
        self.assertNotIn("executor", work_unit_fields)
        self.assertNotIn("execute", work_unit_fields)

        self.assertIn("limit", plan_fields)
        self.assertIn("workUnits", plan_fields)
        self.assertIn("capacityUsage", plan_fields)
        self.assertIn("capacityViolations", plan_fields)
        self.assertFalse(plan_fields["heuristicsAuthorizeExecution"]["const"])

    def test_contract_snapshot_publishes_offline_batch_types(self) -> None:
        snapshot = schema_snapshot()
        contracts = snapshot["contracts"]

        self.assertIs(
            MEMORY_GRAPH_SCHEMA_V1["contracts"]["offline_batch_limit"],
            OFFLINE_BATCH_LIMIT_SCHEMA_V1,
        )
        self.assertIn("offline_batch_limit", contracts)
        self.assertIn("offline_consolidation_request", contracts)
        self.assertIn("default_b200_offline_batch_limit", contracts)
        self.assertIn("offline_batch_work_unit", contracts)
        self.assertIn("offline_batch_plan", contracts)


if __name__ == "__main__":
    unittest.main()
