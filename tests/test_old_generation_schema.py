import unittest

from _bootstrap import ensure_package_parent_on_path

ensure_package_parent_on_path()

from brain.schema import (
    DomainSchema,
    EdgeTypeSchema,
    MEMORY_ITEM_IDENTITY_SCHEMA_V1,
    OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
    OLD_GENERATION_CONSOLIDATION_OPERATIONS,
    OLD_GENERATION_CONSOLIDATION_STATES,
    OLD_GENERATION_DOMAIN,
    OLD_GENERATION_EVIDENCE_KINDS,
    OLD_GENERATION_GRAPH_INVARIANTS,
    OLD_GENERATION_GRAPH_RULES,
    OLD_GENERATION_IDENTIFIER_SCHEME,
    OLD_GENERATION_MEMORY_CLASSES,
    schema_snapshot,
    validate_domain_schema,
    validate_old_generation_graph_rules,
)


class OldGenerationSchemaTest(unittest.TestCase):
    def test_domain_declares_old_generation_taxonomy_nodes(self) -> None:
        node_types = OLD_GENERATION_DOMAIN.node_types

        self.assertIn("long_term_memory_item", node_types)
        self.assertIn("archived_memory_item", node_types)
        self.assertIn("memory_evidence_item", node_types)
        self.assertIn("consolidation_record_item", node_types)
        self.assertIn("immutable_identity_item", node_types)
        self.assertEqual(node_types["long_term_memory_item"].generation, "old")
        self.assertEqual(node_types["archived_memory_item"].generation, "old")
        self.assertEqual(node_types["memory_evidence_item"].generation, "old")
        self.assertEqual(node_types["consolidation_record_item"].generation, "old")
        self.assertEqual(node_types["immutable_identity_item"].generation, "old")

    def test_long_term_memory_shape_requires_summary_confidence_and_provenance(self) -> None:
        long_term_memory = OLD_GENERATION_DOMAIN.node_types["long_term_memory_item"]

        self.assertIn("node_id", long_term_memory.required_properties)
        self.assertIn("memory_id", long_term_memory.required_properties)
        self.assertIn("memory_class", long_term_memory.required_properties)
        self.assertIn("summary", long_term_memory.required_properties)
        self.assertIn("confidence", long_term_memory.required_properties)
        self.assertIn("provenance", long_term_memory.required_properties)
        self.assertIn("temporal_context", long_term_memory.required_properties)
        self.assertIn("salience", long_term_memory.required_properties)
        self.assertIn("consolidation_state", long_term_memory.required_properties)
        self.assertEqual(long_term_memory.property_types["node_id"], "string")
        self.assertEqual(long_term_memory.property_types["memory_id"], "string")
        self.assertEqual(long_term_memory.property_types["summary"], "string")
        self.assertEqual(long_term_memory.property_types["confidence"], "float")
        self.assertEqual(long_term_memory.property_types["provenance"], "object")
        self.assertEqual(long_term_memory.property_types["temporal_context"], "object")
        self.assertEqual(long_term_memory.property_types["salience"], "object")
        self.assertEqual(long_term_memory.property_types["consolidation_state"], "object")
        self.assertIn("trait_promotion_blocked", long_term_memory.property_types)
        self.assertEqual(
            long_term_memory.property_notes["memory_class"],
            "Expected durable classes are semantic, episodic, procedural, learned_trait, and observation.",
        )
        self.assertIn(
            "must never be regenerated",
            long_term_memory.property_notes["memory_id"],
        )
        self.assertIn(
            "must never be reassigned",
            long_term_memory.property_notes["memory_id"],
        )

    def test_archived_memory_shape_requires_restore_safe_origin_metadata(self) -> None:
        archived_memory = OLD_GENERATION_DOMAIN.node_types["archived_memory_item"]

        self.assertIn("node_id", archived_memory.required_properties)
        self.assertIn("archive_id", archived_memory.required_properties)
        self.assertIn("original_generation", archived_memory.required_properties)
        self.assertIn("original_memory_kind", archived_memory.required_properties)
        self.assertIn("original_memory_id", archived_memory.required_properties)
        self.assertIn("archival_reason", archived_memory.required_properties)
        self.assertIn("archived_at", archived_memory.required_properties)
        self.assertIn("snapshot", archived_memory.required_properties)
        self.assertIn("provenance", archived_memory.required_properties)
        self.assertEqual(archived_memory.property_types["archive_id"], "string")
        self.assertEqual(archived_memory.property_types["original_node_id"], "optional[string]")
        self.assertEqual(archived_memory.property_types["original_provenance"], "optional[object]")
        self.assertEqual(archived_memory.property_types["snapshot"], "object")
        self.assertEqual(
            archived_memory.property_notes["original_generation"],
            "Expected source generations are young_generation and old_generation.",
        )
        self.assertIn(
            "must not be regenerated",
            archived_memory.property_notes["original_memory_id"],
        )

    def test_old_generation_support_nodes_capture_evidence_and_consolidation_audit(self) -> None:
        evidence = OLD_GENERATION_DOMAIN.node_types["memory_evidence_item"]
        record = OLD_GENERATION_DOMAIN.node_types["consolidation_record_item"]

        self.assertEqual(evidence.required_properties[0], "node_id")
        self.assertIn("evidence_id", evidence.required_properties)
        self.assertIn("kind", evidence.required_properties)
        self.assertIn("provenance", evidence.required_properties)
        self.assertIn("temporal_context", evidence.required_properties)
        self.assertIn("consolidation_state", evidence.required_properties)
        self.assertEqual(evidence.property_types["reference"], "optional[string]")
        self.assertEqual(evidence.property_types["salience"], "optional[object]")
        self.assertEqual(record.live_mutability, "offline_consolidation_only")
        self.assertIn("node_id", record.required_properties)
        self.assertIn("operation", record.required_properties)
        self.assertIn("runtime_phase", record.required_properties)
        self.assertEqual(record.property_types["source_memory_ids"], "list[string]")
        self.assertIn("preserved_identity_fields", record.property_types)
        self.assertEqual(record.property_types["temporal_context"], "object")
        self.assertEqual(record.property_types["consolidation_state"], "object")

    def test_old_generation_boundary_preserves_agent_scope(self) -> None:
        boundary = OLD_GENERATION_DOMAIN.ownership_boundaries[
            "old_generation_agent_boundary"
        ]

        self.assertEqual(boundary.owner_field, "agent_id")
        self.assertEqual(boundary.cross_agent_merge, "forbidden")
        self.assertEqual(
            boundary.identity_promotion,
            "only_runtime_supplied_invariants_and_protected_core_facts_may_exist_in_identity",
        )

    def test_old_generation_edge_taxonomy_stays_inside_agent_boundary(self) -> None:
        edge_types = OLD_GENERATION_DOMAIN.edge_types

        self.assertIn("long_term_memory_supported_by_evidence", edge_types)
        self.assertIn("long_term_memory_created_by_consolidation", edge_types)
        self.assertIn("long_term_memory_supersedes", edge_types)
        self.assertEqual(
            edge_types["long_term_memory_supported_by_evidence"].target,
            "memory_evidence_item",
        )
        self.assertEqual(
            edge_types["long_term_memory_created_by_consolidation"].target,
            "consolidation_record_item",
        )
        self.assertEqual(
            edge_types["long_term_memory_supersedes"].target,
            "long_term_memory_item",
        )
        for edge in edge_types.values():
            self.assertEqual(edge.ownership_boundary, "old_generation_agent_boundary")
            self.assertFalse(edge.cross_agent_allowed)

    def test_immutable_identity_is_runtime_scoped_isolated_and_excludes_learned_traits(
        self,
    ) -> None:
        identity = OLD_GENERATION_DOMAIN.node_types["immutable_identity_item"]

        self.assertEqual(identity.live_mutability, "runtime_authority_only")
        self.assertIn("node_id", identity.required_properties)
        self.assertIn("runtime_invariants", identity.required_properties)
        self.assertIn("protected_core_facts", identity.required_properties)
        self.assertIn("provenance", identity.required_properties)
        self.assertIn("temporal_context", identity.required_properties)
        self.assertIn("consolidation_state", identity.required_properties)
        self.assertEqual(identity.allowed_outbound_edges, ())
        self.assertEqual(identity.allowed_inbound_edges, ())
        self.assertNotIn("learned_traits", identity.required_properties)
        self.assertNotIn("trait_label", identity.required_properties)

    def test_old_generation_identifier_scheme_maps_local_ids_per_node_kind(self) -> None:
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["memory_item_stable_id_field"],
            MEMORY_ITEM_IDENTITY_SCHEMA_V1["stable_id_field"],
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_pattern"],
            "old/{agent_id}/{node_kind}/{local_id}",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["edge_id_pattern"],
            "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_fields"]["long_term_memory_item"],
            "memory_id",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_fields"]["archived_memory_item"],
            "archive_id",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_fields"]["memory_evidence_item"],
            "evidence_id",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_fields"][
                "consolidation_record_item"
            ],
            "record_id",
        )
        self.assertEqual(
            OLD_GENERATION_IDENTIFIER_SCHEME["node_id_fields"]["immutable_identity_item"],
            "self",
        )

    def test_old_generation_taxonomy_constants_match_documented_classes(self) -> None:
        self.assertEqual(
            OLD_GENERATION_MEMORY_CLASSES,
            ("semantic", "episodic", "procedural", "learned_trait", "observation"),
        )
        self.assertEqual(
            OLD_GENERATION_EVIDENCE_KINDS,
            (
                "conversation_excerpt",
                "tool_output",
                "document_excerpt",
                "runtime_trace",
                "human_feedback",
            ),
        )
        self.assertEqual(
            OLD_GENERATION_CONSOLIDATION_OPERATIONS,
            ("promote", "reinforce", "supersede", "preserve"),
        )
        self.assertEqual(
            OLD_GENERATION_CONSOLIDATION_STATES,
            ("runtime_seeded", "promoted", "reinforced", "preserved", "superseded"),
        )

    def test_old_generation_edges_require_identifier_and_metadata_fields(self) -> None:
        edge = OLD_GENERATION_DOMAIN.edge_types["long_term_memory_supported_by_evidence"]

        self.assertIn("edge_id", edge.required_properties)
        self.assertIn("agent_id", edge.required_properties)
        self.assertIn("provenance", edge.required_properties)
        self.assertIn("temporal_context", edge.required_properties)
        self.assertIn("consolidation_state", edge.required_properties)
        self.assertEqual(edge.property_types["edge_id"], "string")
        self.assertEqual(edge.property_types["salience"], "optional[object]")
        self.assertIn("source_node_id", edge.property_types)
        self.assertIn("target_node_id", edge.property_types)
        self.assertIn("edge_id", edge.property_notes)

    def test_schema_snapshot_contains_old_generation_domain(self) -> None:
        snapshot = schema_snapshot()

        self.assertEqual(snapshot["schema_version"], "1.0.0")
        self.assertIn("old_generation", snapshot["domains"])

    def test_old_generation_graph_rules_publish_allowed_combinations_and_invariants(
        self,
    ) -> None:
        self.assertEqual(
            OLD_GENERATION_GRAPH_RULES["identity_node_type"],
            "immutable_identity_item",
        )
        self.assertEqual(
            OLD_GENERATION_GRAPH_RULES["allowed_edge_combinations"],
            OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
        )
        self.assertEqual(
            OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS[
                "long_term_memory_supported_by_evidence"
            ],
            {
                "source": "long_term_memory_item",
                "target": "memory_evidence_item",
            },
        )
        self.assertTrue(
            any(
                "immutable identity is isolated" in invariant
                for invariant in OLD_GENERATION_GRAPH_INVARIANTS
            )
        )
        self.assertTrue(
            any("cannot create cycles" in invariant for invariant in OLD_GENERATION_GRAPH_INVARIANTS)
        )

    def test_domain_validation_accepts_current_schema(self) -> None:
        validate_domain_schema(OLD_GENERATION_DOMAIN)

    def test_old_generation_graph_rule_validation_accepts_current_schema(self) -> None:
        validate_old_generation_graph_rules(OLD_GENERATION_DOMAIN)

    def test_old_generation_graph_rule_validation_rejects_identity_edge_target(
        self,
    ) -> None:
        supported_by_evidence = OLD_GENERATION_DOMAIN.edge_types[
            "long_term_memory_supported_by_evidence"
        ]
        invalid_domain = DomainSchema(
            name=OLD_GENERATION_DOMAIN.name,
            description=OLD_GENERATION_DOMAIN.description,
            ownership_boundaries=OLD_GENERATION_DOMAIN.ownership_boundaries,
            node_types=OLD_GENERATION_DOMAIN.node_types,
            edge_types={
                **OLD_GENERATION_DOMAIN.edge_types,
                "long_term_memory_supported_by_evidence": EdgeTypeSchema(
                    name=supported_by_evidence.name,
                    source=supported_by_evidence.source,
                    target="immutable_identity_item",
                    description=supported_by_evidence.description,
                    ownership_boundary=supported_by_evidence.ownership_boundary,
                    cross_agent_allowed=supported_by_evidence.cross_agent_allowed,
                    consolidation_visible=supported_by_evidence.consolidation_visible,
                    required_properties=supported_by_evidence.required_properties,
                    property_types=supported_by_evidence.property_types,
                    property_notes=supported_by_evidence.property_notes,
                ),
            },
        )

        with self.assertRaisesRegex(ValueError, "target memory_evidence_item"):
            validate_old_generation_graph_rules(invalid_domain)


if __name__ == "__main__":
    unittest.main()
