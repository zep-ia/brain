import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import OLD_GENERATION_DOMAIN


class ArchivedMemorySchemaTest(unittest.TestCase):
    def test_archived_memory_schema_requires_identity_lineage_and_restore_timestamps(self) -> None:
        archived_memory = OLD_GENERATION_DOMAIN.node_types["archived_memory_item"]

        self.assertEqual(archived_memory.generation, "old")
        self.assertEqual(archived_memory.live_mutability, "offline_consolidation_only")
        self.assertIn("node_id", archived_memory.required_properties)
        self.assertIn("archive_id", archived_memory.required_properties)
        self.assertIn("agent_id", archived_memory.required_properties)
        self.assertIn("original_generation", archived_memory.required_properties)
        self.assertIn("original_memory_kind", archived_memory.required_properties)
        self.assertIn("original_memory_id", archived_memory.required_properties)
        self.assertIn("archival_reason", archived_memory.required_properties)
        self.assertIn("archived_at", archived_memory.required_properties)
        self.assertIn("snapshot", archived_memory.required_properties)
        self.assertIn("provenance", archived_memory.required_properties)
        self.assertIn("temporal_context", archived_memory.required_properties)
        self.assertIn("consolidation_state", archived_memory.required_properties)
        self.assertEqual(archived_memory.property_types["node_id"], "string")
        self.assertEqual(archived_memory.property_types["archive_id"], "string")
        self.assertEqual(archived_memory.property_types["agent_id"], "string")
        self.assertEqual(archived_memory.property_types["original_node_id"], "optional[string]")
        self.assertEqual(
            archived_memory.property_types["original_provenance"],
            "optional[object]",
        )
        self.assertEqual(archived_memory.property_types["archived_at"], "datetime")
        self.assertEqual(
            archived_memory.property_types["last_restored_at"],
            "optional[datetime]",
        )
        self.assertEqual(archived_memory.property_types["temporal_context"], "object")
        self.assertEqual(archived_memory.property_types["consolidation_state"], "object")
        self.assertIn(
            "must not be regenerated",
            archived_memory.property_notes["original_memory_id"],
        )
        self.assertIn(
            "Required preserved source-memory snapshot used for restore-safe",
            archived_memory.property_notes["snapshot"],
        )
        self.assertIn(
            "tracking when the memory was archived and any later restore activity",
            archived_memory.property_notes["temporal_context"],
        )
        self.assertIn(
            "offline archival preservation decision",
            archived_memory.property_notes["consolidation_state"],
        )
