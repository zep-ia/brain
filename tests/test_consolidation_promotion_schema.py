import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import (
    CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA_V1,
    CONSOLIDATION_PROMOTION_INPUT_SCHEMA_V1,
    CONSOLIDATION_PROMOTION_POLICY_SCHEMA_V1,
    CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1,
    CONSOLIDATION_SIGNAL_DIMENSIONS,
    CONSOLIDATION_SIGNAL_GENERATIONS,
    schema_snapshot,
)


class ConsolidationPromotionSchemaTest(unittest.TestCase):
    def test_signal_capture_schema_requires_explicit_score_signals_and_timestamps(
        self,
    ) -> None:
        self.assertEqual(CONSOLIDATION_SIGNAL_DIMENSIONS, ("importance", "stability"))
        self.assertEqual(
            CONSOLIDATION_SIGNAL_GENERATIONS,
            ("youngGeneration", "oldGeneration"),
        )
        self.assertEqual(CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1["type"], "object")
        self.assertTrue(CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1["fields"]["score"]["required"])
        self.assertTrue(
            CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1["fields"]["signals"]["required"]
        )
        self.assertEqual(
            CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1["fields"]["signalCount"]["min"],
            1,
        )
        self.assertTrue(
            CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1["fields"]["capturedAt"]["required"]
        )

    def test_promotion_input_schema_requires_young_importance_and_stability(self) -> None:
        self.assertEqual(
            CONSOLIDATION_PROMOTION_INPUT_SCHEMA_V1["schema_id"],
            "agent_brain_consolidation_promotion_input",
        )
        signal_fields = CONSOLIDATION_PROMOTION_INPUT_SCHEMA_V1["field_definitions"][
            "signals"
        ]["fields"]

        self.assertTrue(signal_fields["youngGeneration"]["required"])
        self.assertEqual(
            signal_fields["youngGeneration"]["required_fields"],
            ("importance", "stability"),
        )
        self.assertFalse(signal_fields["oldGeneration"]["required"])
        self.assertEqual(
            signal_fields["oldGeneration"]["schema"],
            CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA_V1,
        )

    def test_promotion_policy_schema_publishes_runtime_and_identity_guards(self) -> None:
        field_definitions = CONSOLIDATION_PROMOTION_POLICY_SCHEMA_V1["field_definitions"]

        self.assertEqual(
            CONSOLIDATION_PROMOTION_POLICY_SCHEMA_V1["schema_id"],
            "agent_brain_consolidation_promotion_policy",
        )
        self.assertTrue(field_definitions["requiresRuntimeAuthorization"]["const"])
        self.assertFalse(field_definitions["inactivityHeuristicsAuthorize"]["const"])
        self.assertTrue(field_definitions["teamIdleCoordinatesOnly"]["const"])
        self.assertFalse(field_definitions["allowIdentityPromotion"]["const"])
        self.assertEqual(
            field_definitions["targetNodeKind"]["const"],
            "long_term_memory",
        )
        self.assertEqual(
            field_definitions["learnedTraitsTargetNodeKind"]["const"],
            "long_term_memory",
        )
        self.assertIn("agentId", field_definitions["protectedIdentityFields"]["values"])
        self.assertIn(
            "youngGeneration.importance",
            field_definitions["requiredSignals"]["values"],
        )

    def test_schema_snapshot_exposes_consolidation_contracts(self) -> None:
        snapshot = schema_snapshot()

        self.assertIn("contracts", snapshot)
        self.assertIn("consolidation_promotion_input", snapshot["contracts"])
        self.assertIn("consolidation_promotion_policy", snapshot["contracts"])


if __name__ == "__main__":
    unittest.main()
