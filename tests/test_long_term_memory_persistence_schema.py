import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import (
    LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
    LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
    LONG_TERM_MEMORY_PERSISTENCE_SCHEMA_V1,
    LONG_TERM_MEMORY_RECORD_CONTRACT_V1,
    MEMORY_ITEM_IDENTITY_SCHEMA_V1,
    schema_snapshot,
)


class LongTermMemoryPersistenceSchemaTest(unittest.TestCase):
    def test_record_contract_lists_required_content_and_metadata_fields(self) -> None:
        self.assertEqual(
            LONG_TERM_MEMORY_RECORD_CONTRACT_V1["schema_id"],
            "agent_brain_long_term_memory_entry",
        )
        self.assertEqual(
            LONG_TERM_MEMORY_RECORD_CONTRACT_V1["node_kind"],
            "long_term_memory",
        )
        self.assertEqual(
            LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
            ("memoryId", "category", "content", "summary"),
        )
        self.assertEqual(
            LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
            (
                "nodeId",
                "agentId",
                "confidence",
                "provenance",
                "stabilizedAt",
                "temporalContext",
                "salience",
                "consolidationState",
            ),
        )

    def test_persistence_schema_requires_explicit_content_and_metadata_sections(
        self,
    ) -> None:
        field_definitions = LONG_TERM_MEMORY_PERSISTENCE_SCHEMA_V1["field_definitions"]

        self.assertEqual(
            LONG_TERM_MEMORY_PERSISTENCE_SCHEMA_V1["schema_id"],
            "agent_brain_long_term_memory_entry",
        )
        self.assertEqual(field_definitions["schemaId"]["const"], "agent_brain_long_term_memory_entry")
        self.assertEqual(field_definitions["schemaVersion"]["const"], "1.0.0")
        self.assertEqual(field_definitions["nodeKind"]["const"], "long_term_memory")
        self.assertEqual(
            field_definitions["content"]["required_fields"],
            LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
        )
        self.assertEqual(
            field_definitions["metadata"]["required_fields"],
            LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
        )
        self.assertTrue(field_definitions["metadata"]["fields"]["salience"]["required"])
        self.assertTrue(
            field_definitions["metadata"]["fields"]["consolidationState"]["required"]
        )
        self.assertEqual(
            field_definitions["metadata"]["fields"]["learnedTrait"]["fields"][
                "protectedFromIdentityPromotion"
            ]["const"],
            True,
        )

    def test_schema_snapshot_exposes_long_term_memory_persistence_contract(self) -> None:
        snapshot = schema_snapshot()

        self.assertIn("contracts", snapshot)
        self.assertIn("memory_item_identity", snapshot["contracts"])
        self.assertIn("long_term_memory_record_contract", snapshot["contracts"])
        self.assertIn("long_term_memory_persistence_entry", snapshot["contracts"])
        self.assertEqual(
            snapshot["contracts"]["memory_item_identity"]["stable_id_field"],
            MEMORY_ITEM_IDENTITY_SCHEMA_V1["stable_id_field"],
        )


if __name__ == "__main__":
    unittest.main()
