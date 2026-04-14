import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import (
    YOUNG_GENERATION_DOMAIN,
    YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1,
    schema_snapshot,
    validate_domain_schema,
)


class YoungGenerationSchemaTest(unittest.TestCase):
    def test_domain_declares_working_short_term_and_importance_nodes(self) -> None:
        node_types = YOUNG_GENERATION_DOMAIN.node_types

        self.assertIn("working_memory_item", node_types)
        self.assertIn("short_term_memory_item", node_types)
        self.assertIn("importance_index_item", node_types)
        self.assertEqual(node_types["working_memory_item"].generation, "young")
        self.assertEqual(node_types["short_term_memory_item"].generation, "young")
        self.assertEqual(node_types["importance_index_item"].generation, "young")

    def test_importance_index_separates_signals_from_memory_content(self) -> None:
        importance_node = YOUNG_GENERATION_DOMAIN.node_types["importance_index_item"]

        self.assertIn("signals", importance_node.required_properties)
        self.assertIn("importance_score", importance_node.required_properties)
        self.assertIn("memory_kind", importance_node.required_properties)
        self.assertNotIn("content", importance_node.required_properties)
        self.assertNotIn("summary", importance_node.required_properties)
        self.assertEqual(
            importance_node.property_notes["memory_kind"],
            "References either a working_memory_item or short_term_memory_item "
            "without duplicating the underlying memory payload.",
        )

    def test_working_and_short_term_nodes_preserve_records_with_masking_state(self) -> None:
        working_node = YOUNG_GENERATION_DOMAIN.node_types["working_memory_item"]
        short_term_node = YOUNG_GENERATION_DOMAIN.node_types["short_term_memory_item"]

        self.assertEqual(
            working_node.property_types["memory_record"],
            "object{memory_id: string, ...}",
        )
        self.assertEqual(
            working_node.property_types["inactive_for_retrieval"],
            "bool",
        )
        self.assertIn(
            "masked_original_content",
            working_node.property_types["masking_metadata"],
        )
        self.assertIn("lifecycle_metadata", working_node.required_properties)
        self.assertIn("lifecycle_metadata", short_term_node.required_properties)
        self.assertIn(
            "archive_linkage",
            working_node.property_types["lifecycle_metadata"],
        )
        self.assertIn("memory_record", working_node.required_properties)
        self.assertIn("inactive_for_retrieval", short_term_node.required_properties)
        self.assertIn("masking_metadata", short_term_node.required_properties)
        self.assertIn(
            "canonical stable memory_id field",
            working_node.property_notes["memory_record"],
        )
        self.assertIn(
            "must never be regenerated",
            working_node.property_notes["memory_record"],
        )
        self.assertIn(
            "masked_original_content",
            short_term_node.property_notes["masking_metadata"],
        )
        self.assertIn(
            "must never be reassigned",
            short_term_node.property_notes["memory_record"],
        )
        self.assertIn(
            "audit_metadata",
            working_node.property_notes["masking_metadata"],
        )
        self.assertIn(
            "mask-related timestamps",
            working_node.property_notes["masking_metadata"],
        )
        self.assertIn(
            "archive_linkage",
            working_node.property_notes["lifecycle_metadata"],
        )

    def test_domain_edges_stay_inside_same_agent_boundary(self) -> None:
        boundary_name = "young_generation_agent_boundary"
        for edge in YOUNG_GENERATION_DOMAIN.edge_types.values():
            self.assertEqual(edge.ownership_boundary, boundary_name)
            self.assertFalse(edge.cross_agent_allowed)

    def test_importance_edges_attach_to_working_and_short_term_nodes(self) -> None:
        importance_edges = YOUNG_GENERATION_DOMAIN.edge_types

        self.assertEqual(
            importance_edges["importance_to_working_memory"].source,
            "importance_index_item",
        )
        self.assertEqual(
            importance_edges["importance_to_working_memory"].target,
            "working_memory_item",
        )
        self.assertEqual(
            importance_edges["importance_to_short_term_memory"].source,
            "importance_index_item",
        )
        self.assertEqual(
            importance_edges["importance_to_short_term_memory"].target,
            "short_term_memory_item",
        )

    def test_boundary_protects_identity_and_cross_agent_merge(self) -> None:
        boundary = YOUNG_GENERATION_DOMAIN.ownership_boundaries[
            "young_generation_agent_boundary"
        ]

        self.assertEqual(boundary.owner_field, "agent_id")
        self.assertEqual(boundary.cross_agent_merge, "forbidden")
        self.assertEqual(boundary.identity_promotion, "forbidden")

    def test_public_graph_state_schema_is_versioned_and_lists_construction_metadata(
        self,
    ) -> None:
        field_definitions = YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1["field_definitions"]

        self.assertEqual(
            YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1["schema_id"],
            "agent_brain_young_generation_graph_state",
        )
        self.assertEqual(
            YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1["schema_version"],
            "1.0.0",
        )
        self.assertIn("constructionMetadata", field_definitions)
        self.assertTrue(field_definitions["constructionMetadata"]["required"])
        self.assertIn(
            "working_to_short_term_capture",
            YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1["edge_types"],
        )
        self.assertEqual(
            YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1["node_types"][
                "importance_index_item"
            ]["generation"],
            "young",
        )

    def test_schema_snapshot_is_serializable_and_contains_domain(self) -> None:
        snapshot = schema_snapshot()

        self.assertEqual(snapshot["schema_version"], "1.0.0")
        self.assertIn("young_generation", snapshot["domains"])
        self.assertIn("young_generation_graph_state", snapshot["snapshots"])

    def test_domain_validation_accepts_current_schema(self) -> None:
        validate_domain_schema(YOUNG_GENERATION_DOMAIN)


if __name__ == "__main__":
    unittest.main()
