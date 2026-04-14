"""Memory graph schema definitions for the reusable agent brain library."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Mapping


@dataclass(frozen=True)
class OwnershipBoundary:
    """Declares who owns a graph segment and what crossing rules apply."""

    name: str
    scope: str
    owner_field: str
    cross_agent_reads: str
    cross_agent_writes: str
    cross_agent_merge: str
    identity_promotion: str
    team_idle_behavior: str
    notes: str


@dataclass(frozen=True)
class NodeTypeSchema:
    """Describes a graph node type inside a memory domain."""

    name: str
    generation: str
    description: str
    ownership_boundary: str
    required_properties: tuple[str, ...]
    allowed_outbound_edges: tuple[str, ...]
    allowed_inbound_edges: tuple[str, ...]
    live_mutability: str
    property_types: Mapping[str, str] = field(default_factory=dict)
    property_notes: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class EdgeTypeSchema:
    """Describes a valid directed relationship between memory nodes."""

    name: str
    source: str
    target: str
    description: str
    ownership_boundary: str
    cross_agent_allowed: bool
    consolidation_visible: bool
    required_properties: tuple[str, ...] = ()
    property_types: Mapping[str, str] = field(default_factory=dict)
    property_notes: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class DomainSchema:
    """Groups node, edge, and ownership rules for one memory domain."""

    name: str
    description: str
    ownership_boundaries: Mapping[str, OwnershipBoundary] = field(default_factory=dict)
    node_types: Mapping[str, NodeTypeSchema] = field(default_factory=dict)
    edge_types: Mapping[str, EdgeTypeSchema] = field(default_factory=dict)


YOUNG_GENERATION_BOUNDARY = OwnershipBoundary(
    name="young_generation_agent_boundary",
    scope="agent_scoped",
    owner_field="agent_id",
    cross_agent_reads="forbidden",
    cross_agent_writes="forbidden",
    cross_agent_merge="forbidden",
    identity_promotion="forbidden",
    team_idle_behavior=(
        "team idle may batch eligible agents for offline processing, but it does not "
        "create shared memory ownership or authorization"
    ),
    notes=(
        "All young-generation nodes and edges remain strictly attached to a single "
        "agent. Learned traits may later consolidate into long-term memory, but they "
        "must never be promoted into immutable identity."
    ),
)


YOUNG_GENERATION_DOMAIN = DomainSchema(
    name="young_generation",
    description=(
        "Agent-scoped volatile memory domain that separates live working context from "
        "recent episodic traces prior to any offline consolidation."
    ),
    ownership_boundaries={
        YOUNG_GENERATION_BOUNDARY.name: YOUNG_GENERATION_BOUNDARY,
    },
    node_types={
        "working_memory_item": NodeTypeSchema(
            name="working_memory_item",
            generation="young",
            description=(
                "Live task context held during active work. Items are ephemeral, "
                "high-churn, and only valid inside the owning agent boundary."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            required_properties=(
                "memory_record",
                "inactive_for_retrieval",
                "masking_metadata",
                "lifecycle_metadata",
            ),
            allowed_outbound_edges=(
                "working_memory_reference",
                "working_to_short_term_capture",
            ),
            allowed_inbound_edges=(
                "working_memory_reference",
                "short_term_recall",
            ),
            live_mutability="mutable_during_active_runtime",
            property_types={
                "memory_record": "object{memory_id: string, ...}",
                "inactive_for_retrieval": "bool",
                "masking_metadata": (
                    "object{is_masked: bool, masked_at: optional[datetime], "
                    "unmasked_at: optional[datetime], mask_updated_at: "
                    "optional[datetime], masking_reason: optional[string], "
                    "masked_original_content: optional[object], "
                    "audit_metadata: optional[object], provenance: optional[object]}"
                ),
                "lifecycle_metadata": (
                    "object{state: enum[active|inactive|archived], "
                    "inactive_at: optional[datetime], "
                    "inactive_reason: optional[string], "
                    "archive_linkage: optional[object{archive_id: optional[string], "
                    "archive_node_id: optional[string], archived_at: optional[datetime]}]}"
                ),
            },
            property_notes={
                "memory_record": (
                    "Preserves the full underlying working-memory payload, including "
                    "the canonical stable memory_id field plus agent-scoped live "
                    "context fields. The memory_id is assigned once, must never be "
                    "regenerated, and must never be reassigned even when the memory "
                    "is masked from retrieval."
                ),
                "inactive_for_retrieval": (
                    "Explicit retrieval guard. True means the working-memory item "
                    "remains stored but must not participate in live retrieval."
                ),
                "masking_metadata": (
                    "Stores non-destructive masking state such as whether the item is "
                    "masked, the preserved masked_original_content snapshot, masking "
                    "reason, mask-related timestamps, and structured audit_metadata."
                ),
                "lifecycle_metadata": (
                    "Tracks whether the stored memory is active, retrieval-inactive, "
                    "or archived, and preserves archive_linkage metadata when an "
                    "offline archival record takes ownership of the durable copy."
                ),
            },
        ),
        "short_term_memory_item": NodeTypeSchema(
            name="short_term_memory_item",
            generation="young",
            description=(
                "Recent episodic or distilled memories retained after live work leaves "
                "the immediate focus window and before offline consolidation decides "
                "masking, archival, or promotion."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            required_properties=(
                "memory_record",
                "inactive_for_retrieval",
                "masking_metadata",
                "lifecycle_metadata",
            ),
            allowed_outbound_edges=(
                "short_term_recall",
                "short_term_association",
            ),
            allowed_inbound_edges=(
                "working_to_short_term_capture",
                "short_term_association",
            ),
            live_mutability="append_only_during_active_runtime",
            property_types={
                "memory_record": "object{memory_id: string, ...}",
                "inactive_for_retrieval": "bool",
                "masking_metadata": (
                    "object{is_masked: bool, masked_at: optional[datetime], "
                    "unmasked_at: optional[datetime], mask_updated_at: "
                    "optional[datetime], masking_reason: optional[string], "
                    "masked_original_content: optional[object], "
                    "audit_metadata: optional[object], provenance: optional[object]}"
                ),
                "lifecycle_metadata": (
                    "object{state: enum[active|inactive|archived], "
                    "inactive_at: optional[datetime], "
                    "inactive_reason: optional[string], "
                    "archive_linkage: optional[object{archive_id: optional[string], "
                    "archive_node_id: optional[string], archived_at: optional[datetime]}]}"
                ),
            },
            property_notes={
                "memory_record": (
                    "Preserves the full short-term memory payload, including the "
                    "canonical stable memory_id field, summary, provenance, and any "
                    "caller-defined episodic fields. The memory_id is assigned once, "
                    "must never be regenerated, and must never be reassigned."
                ),
                "inactive_for_retrieval": (
                    "Explicit retrieval guard. True means the short-term memory item "
                    "stays stored but should be skipped by active retrieval."
                ),
                "masking_metadata": (
                    "Captures non-destructive masking details, including "
                    "masked_original_content, masking reason, mask timestamps, and "
                    "audit_metadata, while preserving the underlying short-term memory "
                    "record for later offline handling."
                ),
                "lifecycle_metadata": (
                    "Tracks whether the short-term memory remains active, has become "
                    "retrieval-inactive, or now points at a durable archived-memory "
                    "record through archive_linkage metadata."
                ),
            },
        ),
        "importance_index_item": NodeTypeSchema(
            name="importance_index_item",
            generation="young",
            description=(
                "Hippocampus-like importance metadata that scores young-generation "
                "memories without copying their base content into the index."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            required_properties=(
                "index_id",
                "agent_id",
                "memory_id",
                "memory_kind",
                "signals",
                "importance_score",
                "signal_count",
                "updated_at",
            ),
            allowed_outbound_edges=(
                "importance_to_working_memory",
                "importance_to_short_term_memory",
            ),
            allowed_inbound_edges=(),
            live_mutability="mutable_during_active_runtime",
            property_types={
                "index_id": "string",
                "agent_id": "string",
                "memory_id": "string",
                "memory_kind": "string",
                "signals": "object[float]",
                "importance_score": "float",
                "signal_count": "integer",
                "updated_at": "datetime",
                "provenance": "optional[object]",
            },
            property_notes={
                "memory_kind": (
                    "References either a working_memory_item or short_term_memory_item "
                    "without duplicating the underlying memory payload."
                ),
                "signals": (
                    "Stores normalized salience signals such as relevance, repetition, "
                    "or novelty separately from the referenced memory content."
                ),
                "importance_score": (
                    "Derived aggregate score used by later offline consolidation for "
                    "masking, archival, or promotion decisions."
                ),
            },
        ),
    },
    edge_types={
        "working_memory_reference": EdgeTypeSchema(
            name="working_memory_reference",
            source="working_memory_item",
            target="working_memory_item",
            description=(
                "Links concurrent live context items that belong to the same agent and "
                "current task horizon."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=False,
        ),
        "working_to_short_term_capture": EdgeTypeSchema(
            name="working_to_short_term_capture",
            source="working_memory_item",
            target="short_term_memory_item",
            description=(
                "Captures a recent live context outcome into the agent's short-term "
                "episodic store without leaving the young generation."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
        ),
        "importance_to_working_memory": EdgeTypeSchema(
            name="importance_to_working_memory",
            source="importance_index_item",
            target="working_memory_item",
            description=(
                "Attaches hippocampus-like importance metadata to a live working-memory "
                "item without merging the metadata into the item's content."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
        ),
        "importance_to_short_term_memory": EdgeTypeSchema(
            name="importance_to_short_term_memory",
            source="importance_index_item",
            target="short_term_memory_item",
            description=(
                "Attaches importance metadata to a short-term episodic memory so "
                "offline consolidation can query salience separately from the summary."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
        ),
        "short_term_recall": EdgeTypeSchema(
            name="short_term_recall",
            source="short_term_memory_item",
            target="working_memory_item",
            description=(
                "Rehydrates a recent episode back into working memory for the same "
                "agent when runtime work requires recall."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=False,
        ),
        "short_term_association": EdgeTypeSchema(
            name="short_term_association",
            source="short_term_memory_item",
            target="short_term_memory_item",
            description=(
                "Associates related short-term episodes so later offline consolidation "
                "can score stability without merging identity across agents."
            ),
            ownership_boundary=YOUNG_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
        ),
    },
)


OLD_GENERATION_BOUNDARY = OwnershipBoundary(
    name="old_generation_agent_boundary",
    scope="agent_scoped",
    owner_field="agent_id",
    cross_agent_reads="forbidden",
    cross_agent_writes="forbidden",
    cross_agent_merge="forbidden",
    identity_promotion=(
        "only_runtime_supplied_invariants_and_protected_core_facts_may_exist_in_identity"
    ),
    team_idle_behavior=(
        "team idle may coordinate batch eligibility, but each agent consolidates into "
        "its own old-generation memory and immutable identity boundary"
    ),
    notes=(
        "Old-generation storage is split across durable long-term memory, explicit "
        "evidence and consolidation audit artifacts, and a dedicated immutable "
        "identity node. Learned traits remain inside long-term memory with provenance "
        "and confidence and must never be merged into identity."
    ),
)


OLD_GENERATION_MEMORY_CLASSES = (
    "semantic",
    "episodic",
    "procedural",
    "learned_trait",
    "observation",
)


OLD_GENERATION_EVIDENCE_KINDS = (
    "conversation_excerpt",
    "tool_output",
    "document_excerpt",
    "runtime_trace",
    "human_feedback",
)


OLD_GENERATION_CONSOLIDATION_OPERATIONS = (
    "promote",
    "reinforce",
    "supersede",
    "preserve",
)


OLD_GENERATION_CONSOLIDATION_STATES = (
    "runtime_seeded",
    "promoted",
    "reinforced",
    "preserved",
    "superseded",
)


OLD_GENERATION_ARCHIVE_SOURCE_GENERATIONS = (
    "young_generation",
    "old_generation",
)


OLD_GENERATION_ARCHIVE_SOURCE_MEMORY_KINDS = (
    "working_memory",
    "short_term_memory",
    "long_term_memory",
)


OLD_GENERATION_IDENTIFIER_SCHEME = {
    "version": "1.0.0",
    "delimiter": "/",
    "identity_local_id": "self",
    "memory_item_stable_id_field": "memory_id",
    "node_id_pattern": "old/{agent_id}/{node_kind}/{local_id}",
    "edge_id_pattern": (
        "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}"
    ),
    "node_id_fields": {
        "long_term_memory_item": "memory_id",
        "archived_memory_item": "archive_id",
        "memory_evidence_item": "evidence_id",
        "consolidation_record_item": "record_id",
        "immutable_identity_item": "self",
    },
}

MEMORY_ITEM_IDENTITY_SCHEMA_V1 = {
    "schema_id": "agent_brain_memory_item_identity",
    "schema_version": "1.0.0",
    "stable_id_field": "memory_id",
    "mutable": False,
    "regeneration": "forbidden",
    "reassignment": "forbidden",
    "description": (
        "Canonical stable-memory identity contract shared by young- and old-generation "
        "memory items."
    ),
    "rules": (
        'Every memory item carries exactly one stable "memory_id" field.',
        "A memory item keeps the same memory_id across young-generation storage, "
        "old-generation promotion, archival metadata, and persistence round-trips.",
        "A memory_id must never be regenerated for an existing memory item.",
        "A memory_id must never be reassigned to represent a different memory item.",
    ),
}


OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS = {
    "long_term_memory_association": {
        "source": "long_term_memory_item",
        "target": "long_term_memory_item",
    },
    "long_term_memory_supported_by_evidence": {
        "source": "long_term_memory_item",
        "target": "memory_evidence_item",
    },
    "long_term_memory_created_by_consolidation": {
        "source": "long_term_memory_item",
        "target": "consolidation_record_item",
    },
    "long_term_memory_supersedes": {
        "source": "long_term_memory_item",
        "target": "long_term_memory_item",
    },
}


OLD_GENERATION_GRAPH_INVARIANTS = (
    "old-generation node ids must be canonical, agent-scoped, and unique within one graph",
    "old-generation edges must use canonical ids, stay inside one agent boundary, and reference existing old-generation nodes",
    "immutable identity is isolated from all old-generation edges and never participates in durable relations",
    "learned traits remain in long-term memory and must keep identity-promotion protection enabled",
    "archived memories must preserve original generation, source identity, archival reason, and archive timing metadata",
    "supersedes edges cannot self-reference, cannot create cycles, and cannot assign multiple successors to the same historical memory",
)


OLD_GENERATION_GRAPH_RULES = {
    "version": "1.0.0",
    "identity_node_type": "immutable_identity_item",
    "allowed_edge_combinations": OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS,
    "invariants": OLD_GENERATION_GRAPH_INVARIANTS,
}


OLD_GENERATION_DOMAIN = DomainSchema(
    name="old_generation",
    description=(
        "Agent-scoped durable memory domain that stores canonical long-term memories, "
        "restore-safe archived memories, their evidence and consolidation audit trail, "
        "and immutable identity preserved across consolidation cycles."
    ),
    ownership_boundaries={
        OLD_GENERATION_BOUNDARY.name: OLD_GENERATION_BOUNDARY,
    },
    node_types={
        "long_term_memory_item": NodeTypeSchema(
            name="long_term_memory_item",
            generation="old",
            description=(
                "Stable long-term memory retained after offline consolidation. This is "
                "the only old-generation location where learned traits may live."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            required_properties=(
                "node_id",
                "memory_id",
                "agent_id",
                "memory_class",
                "content",
                "summary",
                "confidence",
                "provenance",
                "temporal_context",
                "salience",
                "consolidation_state",
                "stabilized_at",
            ),
            allowed_outbound_edges=(
                "long_term_memory_association",
                "long_term_memory_supported_by_evidence",
                "long_term_memory_created_by_consolidation",
                "long_term_memory_supersedes",
            ),
            allowed_inbound_edges=(
                "long_term_memory_association",
                "long_term_memory_supersedes",
            ),
            live_mutability="offline_consolidation_only",
            property_types={
                "node_id": "string",
                "memory_id": "string",
                "agent_id": "string",
                "memory_class": "string",
                "content": "string",
                "summary": "string",
                "confidence": "float",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "object",
                "consolidation_state": "object",
                "stabilized_at": "datetime",
                "trait_label": "optional[string]",
                "trait_promotion_blocked": "optional[bool]",
            },
            property_notes={
                "node_id": (
                    "Canonical durable node identifier using the scheme "
                    "old/{agent_id}/long_term_memory/{memory_id}."
                ),
                "memory_id": (
                    "Canonical stable memory identity field. It is assigned once per "
                    "memory, must never be regenerated, and must never be reassigned "
                    "to a different memory."
                ),
                "memory_class": (
                    "Expected durable classes are semantic, episodic, procedural, "
                    "learned_trait, and observation."
                ),
                "summary": (
                    "Canonical durable summary used for retrieval and old-generation "
                    "association without reloading the full content payload."
                ),
                "confidence": "Required for all long-term memories, including learned traits.",
                "provenance": "Required audit trail for all promoted or preserved memories.",
                "temporal_context": (
                    "Required object containing first or last observation time plus "
                    "stabilization, consolidation, access, and supersession timestamps."
                ),
                "salience": (
                    "Required durable salience summary storing promotion-era score and "
                    "signals without coupling retrieval to the live young-generation index."
                ),
                "consolidation_state": (
                    "Required state object recording status, last operation, source "
                    "memories, policy version, and learned-trait identity protection."
                ),
                "trait_promotion_blocked": (
                    "When present, learned-trait records must keep this flag true to prevent "
                    "identity promotion."
                ),
            },
        ),
        "archived_memory_item": NodeTypeSchema(
            name="archived_memory_item",
            generation="old",
            description=(
                "Restore-safe archived memory snapshot retained offline with stable "
                "source identity, archival reason, and timing metadata."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            required_properties=(
                "node_id",
                "archive_id",
                "agent_id",
                "original_generation",
                "original_memory_kind",
                "original_memory_id",
                "archival_reason",
                "archived_at",
                "snapshot",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            allowed_outbound_edges=(),
            allowed_inbound_edges=(),
            live_mutability="offline_consolidation_only",
            property_types={
                "node_id": "string",
                "archive_id": "string",
                "agent_id": "string",
                "original_generation": "string",
                "original_memory_kind": "string",
                "original_memory_id": "string",
                "original_node_id": "optional[string]",
                "original_provenance": "optional[object]",
                "archival_reason": "string",
                "archived_at": "datetime",
                "last_restored_at": "optional[datetime]",
                "snapshot": "object",
                "provenance": "object",
                "temporal_context": "object",
                "consolidation_state": "object",
            },
            property_notes={
                "node_id": (
                    "Canonical durable node identifier using the scheme "
                    "old/{agent_id}/archived_memory/{archive_id}."
                ),
                "original_generation": (
                    "Expected source generations are young_generation and old_generation."
                ),
                "original_memory_kind": (
                    "Expected source memory kinds are working_memory, short_term_memory, "
                    "and long_term_memory."
                ),
                "original_memory_id": (
                    "Preserved canonical stable source memory_id captured from the "
                    "archived memory. It must not be regenerated or reassigned during "
                    "archival."
                ),
                "original_node_id": (
                    "Optional canonical source node identifier. Required only when the "
                    "archived source came from old-generation long-term memory."
                ),
                "original_provenance": (
                    "Optional stable source provenance captured from the archived memory "
                    "before archival."
                ),
                "archival_reason": (
                    "Required caller-visible explanation for why the memory was archived "
                    "rather than kept in active retrieval scope."
                ),
                "snapshot": (
                    "Required preserved source-memory snapshot used for restore-safe "
                    "rehydration without inventing identity."
                ),
                "provenance": (
                    "Required audit trail for the archive operation itself."
                ),
                "temporal_context": (
                    "Required object tracking when the memory was archived and any later "
                    "restore activity."
                ),
                "consolidation_state": (
                    "Required state object describing the offline archival preservation "
                    "decision without mutating immutable identity."
                ),
            },
        ),
        "memory_evidence_item": NodeTypeSchema(
            name="memory_evidence_item",
            generation="old",
            description=(
                "Durable evidence artifact that supports a long-term memory claim without "
                "copying the memory into immutable identity."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            required_properties=(
                "node_id",
                "evidence_id",
                "agent_id",
                "kind",
                "source",
                "observed_at",
                "detail",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            allowed_outbound_edges=(),
            allowed_inbound_edges=("long_term_memory_supported_by_evidence",),
            live_mutability="offline_consolidation_only",
            property_types={
                "node_id": "string",
                "evidence_id": "string",
                "agent_id": "string",
                "kind": "string",
                "source": "string",
                "observed_at": "datetime",
                "detail": "string",
                "reference": "optional[string]",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "node_id": (
                    "Canonical durable node identifier using the scheme "
                    "old/{agent_id}/memory_evidence/{evidence_id}."
                ),
                "kind": (
                    "Expected evidence kinds are conversation_excerpt, tool_output, "
                    "document_excerpt, runtime_trace, and human_feedback."
                ),
                "reference": (
                    "Optional external locator such as a trace id, turn id, or document "
                    "fragment reference."
                ),
                "temporal_context": (
                    "Required object tracking the evidence observation window and any later "
                    "consolidation or supersession timestamps."
                ),
                "salience": (
                    "Optional durable salience override when evidence weight needs explicit "
                    "retention outside the live importance index."
                ),
                "consolidation_state": (
                    "Required state object recording whether the evidence remains preserved "
                    "or was superseded by a newer supporting artifact."
                ),
            },
        ),
        "consolidation_record_item": NodeTypeSchema(
            name="consolidation_record_item",
            generation="old",
            description=(
                "Offline consolidation audit record that explains which runtime-authorized "
                "idle or sleep window promoted or reinforced a long-term memory."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            required_properties=(
                "node_id",
                "record_id",
                "agent_id",
                "operation",
                "runtime_phase",
                "consolidated_at",
                "source_memory_ids",
                "policy_version",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            allowed_outbound_edges=(),
            allowed_inbound_edges=("long_term_memory_created_by_consolidation",),
            live_mutability="offline_consolidation_only",
            property_types={
                "node_id": "string",
                "record_id": "string",
                "agent_id": "string",
                "operation": "string",
                "runtime_phase": "string",
                "consolidated_at": "datetime",
                "source_memory_ids": "list[string]",
                "policy_version": "string",
                "preserved_identity_fields": "optional[list[string]]",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "node_id": (
                    "Canonical durable node identifier using the scheme "
                    "old/{agent_id}/consolidation_record/{record_id}."
                ),
                "operation": (
                    "Expected consolidation operations are promote, reinforce, "
                    "supersede, and preserve."
                ),
                "preserved_identity_fields": (
                    "Optional audit list recording which protected identity fields were "
                    "explicitly preserved during the consolidation pass."
                ),
                "temporal_context": (
                    "Required object tracking when the consolidation record was created and "
                    "which runtime-authorized idle or sleep window produced it."
                ),
                "salience": (
                    "Optional durable salience annotation for ranking or auditing record "
                    "importance without coupling to the live working loop."
                ),
                "consolidation_state": (
                    "Required state object mirroring the journaled operation, source "
                    "memories, and preserved identity fields for audit replay."
                ),
            },
        ),
        "immutable_identity_item": NodeTypeSchema(
            name="immutable_identity_item",
            generation="old",
            description=(
                "Protected identity facts supplied by runtime invariants and other "
                "non-negotiable core facts. Consolidation must preserve this node."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            required_properties=(
                "node_id",
                "agent_id",
                "persona",
                "role",
                "durable_mission",
                "safety_constraints",
                "ownership",
                "non_negotiable_preferences",
                "runtime_invariants",
                "protected_core_facts",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            allowed_outbound_edges=(),
            allowed_inbound_edges=(),
            live_mutability="runtime_authority_only",
            property_types={
                "node_id": "string",
                "agent_id": "string",
                "persona": "string",
                "role": "string",
                "durable_mission": "string",
                "safety_constraints": "list[string]",
                "ownership": "list[string]",
                "non_negotiable_preferences": "list[string]",
                "runtime_invariants": "object",
                "protected_core_facts": "list[string]",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "node_id": (
                    "Canonical durable node identifier using the scheme "
                    "old/{agent_id}/immutable_identity/self."
                ),
                "runtime_invariants": (
                    "Identity inputs must be supplied by runtime authority rather than "
                    "learned from consolidation output."
                ),
                "protected_core_facts": (
                    "Includes protected facts such as agent id, persona, role, durable "
                    "mission, safety constraints, ownership, and non-negotiable preferences."
                ),
                "provenance": (
                    "Runtime-authority provenance describing where immutable identity facts "
                    "were asserted. Consolidation must never invent this metadata."
                ),
                "temporal_context": (
                    "Required object recording runtime assertion timing without treating "
                    "identity as a learned or salience-ranked memory."
                ),
                "salience": (
                    "Optional and typically absent. Identity is protected by runtime "
                    "authority rather than retrieval salience."
                ),
                "consolidation_state": (
                    "Required state object that must remain runtime_seeded and must never "
                    "reflect learned traits or cross-agent merges."
                ),
            },
        ),
    },
    edge_types={
        "long_term_memory_association": EdgeTypeSchema(
            name="long_term_memory_association",
            source="long_term_memory_item",
            target="long_term_memory_item",
            description=(
                "Associates durable memories that should remain retrievable together "
                "without implying replacement, identity mutation, or cross-agent scope."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
            required_properties=(
                "edge_id",
                "agent_id",
                "source_node_id",
                "target_node_id",
                "relation",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            property_types={
                "edge_id": "string",
                "agent_id": "string",
                "source_node_id": "string",
                "target_node_id": "string",
                "relation": "string",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "edge_id": (
                    "Canonical durable edge identifier using the scheme "
                    "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}."
                ),
                "temporal_context": (
                    "Required object tracking when the association was observed, "
                    "consolidated, accessed, or superseded."
                ),
                "salience": (
                    "Optional durable salience annotation when an association itself "
                    "carries retrieval weight."
                ),
                "consolidation_state": (
                    "Required state object recording whether the association is currently "
                    "preserved or superseded."
                ),
            },
        ),
        "long_term_memory_supported_by_evidence": EdgeTypeSchema(
            name="long_term_memory_supported_by_evidence",
            source="long_term_memory_item",
            target="memory_evidence_item",
            description=(
                "Attaches explicit evidence to a long-term memory so confidence and "
                "provenance remain auditable inside the owning agent boundary."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
            required_properties=(
                "edge_id",
                "agent_id",
                "source_node_id",
                "target_node_id",
                "relation",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            property_types={
                "edge_id": "string",
                "agent_id": "string",
                "source_node_id": "string",
                "target_node_id": "string",
                "relation": "string",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "edge_id": (
                    "Canonical durable edge identifier using the scheme "
                    "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}."
                ),
                "temporal_context": (
                    "Required object tracking when the evidence link was observed or "
                    "refreshed during consolidation."
                ),
                "salience": (
                    "Optional durable weight describing how strongly the evidence supports "
                    "the linked memory."
                ),
                "consolidation_state": (
                    "Required state object recording whether the supporting evidence link "
                    "remains current or has been superseded."
                ),
            },
        ),
        "long_term_memory_created_by_consolidation": EdgeTypeSchema(
            name="long_term_memory_created_by_consolidation",
            source="long_term_memory_item",
            target="consolidation_record_item",
            description=(
                "Links a durable memory to the offline consolidation record that "
                "promoted, reinforced, or preserved it."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
            required_properties=(
                "edge_id",
                "agent_id",
                "source_node_id",
                "target_node_id",
                "relation",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            property_types={
                "edge_id": "string",
                "agent_id": "string",
                "source_node_id": "string",
                "target_node_id": "string",
                "relation": "string",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "edge_id": (
                    "Canonical durable edge identifier using the scheme "
                    "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}."
                ),
                "temporal_context": (
                    "Required object tracking the offline window that wrote or refreshed "
                    "the long-term memory record."
                ),
                "salience": (
                    "Optional durable audit weight for prioritizing consolidation-path "
                    "inspection in batch analysis."
                ),
                "consolidation_state": (
                    "Required state object referencing the consolidation journal entry, "
                    "policy version, and source memories."
                ),
            },
        ),
        "long_term_memory_supersedes": EdgeTypeSchema(
            name="long_term_memory_supersedes",
            source="long_term_memory_item",
            target="long_term_memory_item",
            description=(
                "Marks that one durable memory has become the canonical replacement for "
                "an older memory while keeping the prior memory available for audit."
            ),
            ownership_boundary=OLD_GENERATION_BOUNDARY.name,
            cross_agent_allowed=False,
            consolidation_visible=True,
            required_properties=(
                "edge_id",
                "agent_id",
                "source_node_id",
                "target_node_id",
                "relation",
                "provenance",
                "temporal_context",
                "consolidation_state",
            ),
            property_types={
                "edge_id": "string",
                "agent_id": "string",
                "source_node_id": "string",
                "target_node_id": "string",
                "relation": "string",
                "provenance": "object",
                "temporal_context": "object",
                "salience": "optional[object]",
                "consolidation_state": "object",
            },
            property_notes={
                "edge_id": (
                    "Canonical durable edge identifier using the scheme "
                    "old/{agent_id}/edge/{relation}/{source_node_id}->{target_node_id}."
                ),
                "temporal_context": (
                    "Required object capturing when the supersession became canonical and "
                    "when the replaced memory should be treated as historical."
                ),
                "salience": (
                    "Optional durable priority hint when multiple supersession chains need "
                    "to be replayed or audited."
                ),
                "consolidation_state": (
                    "Required state object that must mark the relation as superseded while "
                    "preserving full audit history."
                ),
            },
        ),
    },
)


MEMORY_GRAPH_SCHEMA_V1 = {
    "schema_version": "1.0.0",
    "domains": {
        YOUNG_GENERATION_DOMAIN.name: YOUNG_GENERATION_DOMAIN,
        OLD_GENERATION_DOMAIN.name: OLD_GENERATION_DOMAIN,
    },
    "snapshots": {},
}


YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1 = {
    "schema_id": "agent_brain_young_generation_graph_state",
    "schema_version": "1.0.0",
    "description": (
        "Versioned public snapshot schema for persisting young-generation graph state "
        "and restoring it without relying on internal-only APIs."
    ),
    "field_definitions": {
        "schemaId": {
            "type": "string",
            "required": True,
        },
        "schemaVersion": {
            "type": "string",
            "required": True,
        },
        "constructionMetadata": {
            "type": "object",
            "required": True,
            "fields": {
                "agentId": {
                    "type": "string",
                    "required": True,
                },
                "savedAt": {
                    "type": "datetime",
                    "required": True,
                },
                "sourceGraphSchemaId": {
                    "type": "string",
                    "required": True,
                },
                "sourceGraphSchemaVersion": {
                    "type": "string",
                    "required": True,
                },
                "youngGenerationNodeKind": {
                    "type": "string",
                    "required": True,
                },
                "workingMemoryNodeKind": {
                    "type": "string",
                    "required": True,
                },
                "shortTermMemoryNodeKind": {
                    "type": "string",
                    "required": True,
                },
                "importanceIndexNodeKind": {
                    "type": "string",
                    "required": True,
                },
            },
        },
        "youngGeneration": {
            "type": "domain",
            "required": True,
            "domain_name": YOUNG_GENERATION_DOMAIN.name,
        },
        "edges": {
            "type": "collection",
            "required": True,
            "edge_type_names": tuple(YOUNG_GENERATION_DOMAIN.edge_types.keys()),
        },
    },
    "node_types": {
        node_name: asdict(node_schema)
        for node_name, node_schema in YOUNG_GENERATION_DOMAIN.node_types.items()
    },
    "edge_types": {
        edge_name: asdict(edge_schema)
        for edge_name, edge_schema in YOUNG_GENERATION_DOMAIN.edge_types.items()
    },
}

MEMORY_GRAPH_SCHEMA_V1["snapshots"][
    "young_generation_graph_state"
] = YOUNG_GENERATION_GRAPH_STATE_SCHEMA_V1

LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS = (
    "memoryId",
    "category",
    "content",
    "summary",
)

LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS = (
    "nodeId",
    "agentId",
    "confidence",
    "provenance",
    "stabilizedAt",
    "temporalContext",
    "salience",
    "consolidationState",
)

LONG_TERM_MEMORY_RECORD_CONTRACT_V1 = {
    "schema_id": "agent_brain_long_term_memory_entry",
    "schema_version": "1.0.0",
    "node_kind": "long_term_memory",
    "required_content_fields": LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
    "required_metadata_fields": LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
    "optional_metadata_fields": ("learnedTrait",),
    "learned_trait_category_requires_metadata": True,
    "learned_traits_remain_protected_from_identity_promotion": True,
}

LONG_TERM_MEMORY_PERSISTENCE_SCHEMA_V1 = {
    "schema_id": LONG_TERM_MEMORY_RECORD_CONTRACT_V1["schema_id"],
    "schema_version": LONG_TERM_MEMORY_RECORD_CONTRACT_V1["schema_version"],
    "description": (
        "Versioned per-entry persistence contract for serializing one long-term memory "
        "with explicit content and metadata sections."
    ),
    "field_definitions": {
        "schemaId": {
            "type": "string",
            "required": True,
            "const": LONG_TERM_MEMORY_RECORD_CONTRACT_V1["schema_id"],
        },
        "schemaVersion": {
            "type": "string",
            "required": True,
            "const": LONG_TERM_MEMORY_RECORD_CONTRACT_V1["schema_version"],
        },
        "nodeKind": {
            "type": "string",
            "required": True,
            "const": LONG_TERM_MEMORY_RECORD_CONTRACT_V1["node_kind"],
        },
        "content": {
            "type": "object",
            "required": True,
            "required_fields": LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS,
            "fields": {
                "memoryId": {
                    "type": "string",
                    "required": True,
                },
                "category": {
                    "type": "string",
                    "required": True,
                    "values": OLD_GENERATION_MEMORY_CLASSES,
                },
                "content": {
                    "type": "string",
                    "required": True,
                },
                "summary": {
                    "type": "string",
                    "required": True,
                },
            },
        },
        "metadata": {
            "type": "object",
            "required": True,
            "required_fields": LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS,
            "fields": {
                "nodeId": {
                    "type": "string",
                    "required": True,
                },
                "agentId": {
                    "type": "string",
                    "required": True,
                },
                "confidence": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
                "provenance": {
                    "type": "object",
                    "required": True,
                },
                "stabilizedAt": {
                    "type": "datetime",
                    "required": True,
                },
                "temporalContext": {
                    "type": "object",
                    "required": True,
                },
                "salience": {
                    "type": "object",
                    "required": True,
                },
                "consolidationState": {
                    "type": "object",
                    "required": True,
                },
                "learnedTrait": {
                    "type": "optional[object]",
                    "required": False,
                    "fields": {
                        "label": {
                            "type": "string",
                            "required": True,
                        },
                        "confidence": {
                            "type": "float",
                            "required": True,
                            "min": 0,
                            "max": 1,
                        },
                        "provenance": {
                            "type": "object",
                            "required": True,
                        },
                        "protectedFromIdentityPromotion": {
                            "type": "bool",
                            "required": True,
                            "const": True,
                        },
                    },
                },
            },
        },
    },
}

CONSOLIDATION_SIGNAL_DIMENSIONS = ("importance", "stability")

CONSOLIDATION_SIGNAL_GENERATIONS = ("youngGeneration", "oldGeneration")

CONSOLIDATION_PROMOTION_SIGNAL_PATHS = tuple(
    f"{generation}.{dimension}"
    for generation in CONSOLIDATION_SIGNAL_GENERATIONS
    for dimension in CONSOLIDATION_SIGNAL_DIMENSIONS
)

CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1 = {
    "type": "object",
    "description": (
        "Explicit importance or stability signal capture retained separately from "
        "live and durable memory content."
    ),
    "fields": {
        "score": {
            "type": "float",
            "required": True,
            "min": 0,
            "max": 1,
        },
        "signals": {
            "type": "object[float]",
            "required": True,
        },
        "signalCount": {
            "type": "integer",
            "required": True,
            "min": 1,
        },
        "capturedAt": {
            "type": "datetime",
            "required": True,
        },
        "sourceCollection": {
            "type": "optional[string]",
            "required": False,
        },
        "sourceRecordIds": {
            "type": "optional[list[string]]",
            "required": False,
        },
        "provenance": {
            "type": "optional[object]",
            "required": False,
        },
    },
}

CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA_V1 = {
    "type": "object",
    "description": (
        "Generation-scoped signal envelope that keeps importance and stability "
        "separate for promotion policy evaluation."
    ),
    "fields": {
        "importance": {
            "type": "optional[object]",
            "required": False,
            "schema": CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1,
        },
        "stability": {
            "type": "optional[object]",
            "required": False,
            "schema": CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA_V1,
        },
    },
}

CONSOLIDATION_PROMOTION_INPUT_SCHEMA_V1 = {
    "schema_id": "agent_brain_consolidation_promotion_input",
    "schema_version": "1.0.0",
    "description": (
        "Caller-supplied promotion candidate contract carrying explicit young- and "
        "old-generation importance and stability captures for offline evaluation."
    ),
    "field_definitions": {
        "candidateId": {
            "type": "string",
            "required": True,
        },
        "agentId": {
            "type": "string",
            "required": True,
        },
        "sourceMemoryId": {
            "type": "string",
            "required": True,
        },
        "sourceMemoryKind": {
            "type": "string",
            "required": True,
            "values": (
                "working_memory",
                "short_term_memory",
            ),
        },
        "targetMemoryId": {
            "type": "optional[string]",
            "required": False,
        },
        "targetNodeKind": {
            "type": "string",
            "required": True,
            "const": "long_term_memory",
        },
        "learnedTraitCandidate": {
            "type": "bool",
            "required": False,
        },
        "signals": {
            "type": "object",
            "required": True,
            "fields": {
                "youngGeneration": {
                    "type": "object",
                    "required": True,
                    "schema": CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA_V1,
                    "required_fields": (
                        "importance",
                        "stability",
                    ),
                },
                "oldGeneration": {
                    "type": "optional[object]",
                    "required": False,
                    "schema": CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA_V1,
                },
            },
        },
        "provenance": {
            "type": "optional[object]",
            "required": False,
        },
    },
}

CONSOLIDATION_PROMOTION_POLICY_SCHEMA_V1 = {
    "schema_id": "agent_brain_consolidation_promotion_policy",
    "schema_version": "1.0.0",
    "description": (
        "Reusable promotion policy for offline consolidation. Runtime-phase "
        "authorization remains a separate caller-controlled gate."
    ),
    "field_definitions": {
        "policyId": {
            "type": "string",
            "required": True,
        },
        "version": {
            "type": "string",
            "required": True,
        },
        "targetNodeKind": {
            "type": "string",
            "required": True,
            "const": "long_term_memory",
        },
        "requiresRuntimeAuthorization": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "allowedRuntimePhases": {
            "type": "list[string]",
            "required": True,
            "values": (
                "idle",
                "rest",
                "break",
                "sleep",
            ),
        },
        "inactivityHeuristicsAuthorize": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "teamIdleCoordinatesOnly": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "allowIdentityPromotion": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "learnedTraitsTargetNodeKind": {
            "type": "string",
            "required": True,
            "const": "long_term_memory",
        },
        "protectedIdentityFields": {
            "type": "list[string]",
            "required": True,
            "values": (
                "agentId",
                "persona",
                "role",
                "durableMission",
                "safetyConstraints",
                "ownership",
                "nonNegotiablePreferences",
                "runtimeInvariants",
                "protectedCoreFacts",
            ),
        },
        "requiredSignals": {
            "type": "list[string]",
            "required": True,
            "values": CONSOLIDATION_PROMOTION_SIGNAL_PATHS,
        },
        "thresholds": {
            "type": "object",
            "required": True,
            "fields": {
                "minimumPromotionScore": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
                "minimumYoungImportanceScore": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
                "minimumYoungStabilityScore": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
                "minimumOldImportanceScore": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
                "minimumOldStabilityScore": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                    "max": 1,
                },
            },
        },
        "weights": {
            "type": "object",
            "required": True,
            "fields": {
                "youngImportance": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                },
                "youngStability": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                },
                "oldImportance": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                },
                "oldStability": {
                    "type": "float",
                    "required": True,
                    "min": 0,
                },
            },
        },
    },
}

OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS = (
    "idle",
    "sleep",
)

OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS = (
    "independent",
    "team-idle",
)

OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA_V1 = {
    "schema_id": "agent_brain_offline_consolidation_request",
    "schema_version": "1.0.0",
    "description": (
        "Normalized caller-facing request contract for offline consolidation planning. "
        "It stays data-only, rejects unsafe execution overrides, and remains separate "
        "from the shared batch-plan API."
    ),
    "field_definitions": {
        "requestId": {
            "type": "string",
            "required": True,
        },
        "version": {
            "type": "string",
            "required": True,
        },
        "agentId": {
            "type": "string",
            "required": True,
        },
        "presetCatalogId": {
            "type": "string",
            "required": True,
        },
        "presetId": {
            "type": "string",
            "required": True,
        },
        "presetVersion": {
            "type": "string",
            "required": True,
        },
        "preset": {
            "type": "object",
            "required": True,
        },
        "runtimeWindow": {
            "type": "string",
            "required": True,
            "values": OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS,
        },
        "runtimePhase": {
            "type": "optional[object]",
            "required": True,
        },
        "inactivitySuggestion": {
            "type": "optional[object]",
            "required": True,
        },
        "teamIdle": {
            "type": "bool",
            "required": True,
        },
        "coordinationHint": {
            "type": "string",
            "required": True,
            "values": OFFLINE_CONSOLIDATION_PLAN_BUILDER_COORDINATION_HINTS,
        },
        "priorityMemoryIds": {
            "type": "list[string]",
            "required": True,
        },
        "batchProfileId": {
            "type": "string",
            "required": True,
        },
        "contractLayer": {
            "type": "string",
            "required": True,
            "const": "plan-builder",
        },
        "outputPlanApi": {
            "type": "string",
            "required": True,
            "const": "offline-batch-plan",
        },
        "authorizationModel": {
            "type": "string",
            "required": True,
            "const": "runtime-phase-only",
        },
        "heuristicsPolicy": {
            "type": "string",
            "required": True,
            "const": "suggest-only",
        },
        "teamCoordinationPolicy": {
            "type": "string",
            "required": True,
            "const": "batch-only",
        },
        "scope": {
            "type": "string",
            "required": True,
            "const": "agent-scoped",
        },
        "immutableIdentityPolicy": {
            "type": "string",
            "required": True,
            "const": "runtime-invariants-only",
        },
        "learnedTraitPolicy": {
            "type": "string",
            "required": True,
            "const": "long-term-memory-only",
        },
        "allowIdentityPromotion": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "workingLoopIsolation": {
            "type": "string",
            "required": True,
            "const": "offline-decoupled",
        },
        "numericThroughputBenchmarkRequired": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "metadata": {
            "type": "optional[object]",
            "required": True,
        },
    },
}

OFFLINE_BATCH_ORDERING_STRATEGIES = (
    "priority-descending-then-sequence",
    "sequence-only",
)

DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY = OFFLINE_BATCH_ORDERING_STRATEGIES[0]

OFFLINE_BATCH_LIMIT_SCHEMA_V1 = {
    "schema_id": "agent_brain_offline_batch_limit",
    "schema_version": "1.0.0",
    "description": (
        "Data-only capacity envelope for offline batch execution. It constrains "
        "agent-scoped work without embedding executor callbacks or scheduler authority."
    ),
    "field_definitions": {
        "limitId": {
            "type": "string",
            "required": True,
        },
        "targetProfile": {
            "type": "string",
            "required": True,
        },
        "acceleratorClass": {
            "type": "string",
            "required": True,
        },
        "orderingStrategy": {
            "type": "string",
            "required": True,
            "values": OFFLINE_BATCH_ORDERING_STRATEGIES,
        },
        "maxAgentsPerBatch": {
            "type": "optional[integer]",
            "required": True,
            "min": 1,
        },
        "maxWorkUnitsPerBatch": {
            "type": "optional[integer]",
            "required": True,
            "min": 1,
        },
        "maxOverwriteTargetsPerBatch": {
            "type": "optional[integer]",
            "required": True,
            "min": 1,
        },
        "maxOverwriteTargetsPerWorkUnit": {
            "type": "optional[integer]",
            "required": True,
            "min": 1,
        },
        "maxIdentityScopesPerBatch": {
            "type": "optional[integer]",
            "required": True,
            "min": 1,
        },
        "requiresRuntimeAuthorization": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "heuristicsAuthorizeExecution": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "teamIdleCoordinatesOnly": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "identityIsolationMode": {
            "type": "string",
            "required": True,
            "const": "agent-scoped",
        },
        "requiresIndependentWrites": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "executionMode": {
            "type": "string",
            "required": True,
            "const": "offline-plan-only",
        },
        "executorBinding": {
            "type": "string",
            "required": True,
            "const": "external",
        },
        "liveWorkingLoopCoupling": {
            "type": "string",
            "required": True,
            "const": "offline-decoupled",
        },
        "numericThroughputBenchmarkRequired": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "notes": {
            "type": "optional[string]",
            "required": True,
        },
    },
}

DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1 = {
    "limitId": "b200-style-offline-batch-limit",
    "targetProfile": "b200-style",
    "acceleratorClass": "b200-style",
    "orderingStrategy": DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY,
    "maxAgentsPerBatch": None,
    "maxWorkUnitsPerBatch": None,
    "maxOverwriteTargetsPerBatch": None,
    "maxOverwriteTargetsPerWorkUnit": None,
    "maxIdentityScopesPerBatch": None,
    "requiresRuntimeAuthorization": True,
    "heuristicsAuthorizeExecution": False,
    "teamIdleCoordinatesOnly": True,
    "identityIsolationMode": "agent-scoped",
    "requiresIndependentWrites": True,
    "executionMode": "offline-plan-only",
    "executorBinding": "external",
    "liveWorkingLoopCoupling": "offline-decoupled",
    "numericThroughputBenchmarkRequired": False,
    "notes": (
        "Architecture-level batch limit profile for B200-style offline consolidation. "
        "Numeric throughput benchmarks remain intentionally unspecified in this iteration."
    ),
}

OFFLINE_BATCH_WORK_UNIT_SCHEMA_V1 = {
    "schema_id": "agent_brain_offline_batch_work_unit",
    "schema_version": "1.0.0",
    "description": (
        "One agent-scoped offline work unit ordered for batch processing. The payload is "
        "pure data and must not carry executor callbacks or inline execution logic."
    ),
    "field_definitions": {
        "workUnitId": {
            "type": "string",
            "required": True,
        },
        "batchId": {
            "type": "optional[string]",
            "required": True,
        },
        "agentId": {
            "type": "string",
            "required": True,
        },
        "operation": {
            "type": "string",
            "required": True,
        },
        "coordinationSignal": {
            "type": "string",
            "required": True,
        },
        "runtimePhase": {
            "type": "optional[string]",
            "required": True,
        },
        "executionMode": {
            "type": "string",
            "required": True,
            "const": "offline-plan-only",
        },
        "executorBinding": {
            "type": "string",
            "required": True,
            "const": "external",
        },
        "liveWorkingLoopCoupling": {
            "type": "string",
            "required": True,
            "const": "offline-decoupled",
        },
        "identityIsolationMode": {
            "type": "string",
            "required": True,
            "const": "agent-scoped",
        },
        "identityScopeKey": {
            "type": "string",
            "required": True,
        },
        "overwriteNamespace": {
            "type": "string",
            "required": True,
        },
        "overwriteTargets": {
            "type": "list[string]",
            "required": True,
        },
        "overwriteTargetCount": {
            "type": "integer",
            "required": True,
            "min": 0,
        },
        "order": {
            "type": "object",
            "required": True,
            "fields": {
                "priority": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "sequence": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "sortKey": {
                    "type": "string",
                    "required": True,
                },
            },
        },
        "capacityCost": {
            "type": "object",
            "required": True,
            "fields": {
                "agentCount": {
                    "type": "integer",
                    "required": True,
                    "const": 1,
                },
                "workUnitCount": {
                    "type": "integer",
                    "required": True,
                    "const": 1,
                },
                "overwriteTargetCount": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "identityScopeCount": {
                    "type": "integer",
                    "required": True,
                    "const": 1,
                },
            },
        },
        "requiresRuntimeAuthorization": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "metadata": {
            "type": "optional[object]",
            "required": True,
        },
    },
}

OFFLINE_BATCH_PLAN_SCHEMA_V1 = {
    "schema_id": "agent_brain_offline_batch_plan",
    "schema_version": "1.0.0",
    "description": (
        "Ordered batch plan for offline consolidation. It captures limits, work-unit "
        "ordering, and capacity checks while remaining decoupled from any executor "
        "implementation."
    ),
    "field_definitions": {
        "planId": {
            "type": "string",
            "required": True,
        },
        "coordinationSignal": {
            "type": "string",
            "required": True,
        },
        "executionMode": {
            "type": "string",
            "required": True,
            "const": "offline-plan-only",
        },
        "executorBinding": {
            "type": "string",
            "required": True,
            "const": "external",
        },
        "liveWorkingLoopCoupling": {
            "type": "string",
            "required": True,
            "const": "offline-decoupled",
        },
        "limit": {
            "type": "object",
            "required": True,
            "schema_ref": OFFLINE_BATCH_LIMIT_SCHEMA_V1["schema_id"],
        },
        "workUnits": {
            "type": "list[object]",
            "required": True,
            "schema_ref": OFFLINE_BATCH_WORK_UNIT_SCHEMA_V1["schema_id"],
        },
        "workUnitCount": {
            "type": "integer",
            "required": True,
            "min": 0,
        },
        "orderedWorkUnitIds": {
            "type": "list[string]",
            "required": True,
        },
        "agentIds": {
            "type": "list[string]",
            "required": True,
        },
        "agentCount": {
            "type": "integer",
            "required": True,
            "min": 0,
        },
        "capacityUsage": {
            "type": "object",
            "required": True,
            "fields": {
                "agentCount": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "workUnitCount": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "overwriteTargetCount": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "identityScopeCount": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
                "maxOverwriteTargetsPerWorkUnitObserved": {
                    "type": "integer",
                    "required": True,
                    "min": 0,
                },
            },
        },
        "capacityViolations": {
            "type": "list[string]",
            "required": True,
        },
        "withinCapacity": {
            "type": "bool",
            "required": True,
        },
        "requiresRuntimeAuthorization": {
            "type": "bool",
            "required": True,
            "const": True,
        },
        "heuristicsAuthorizeExecution": {
            "type": "bool",
            "required": True,
            "const": False,
        },
        "metadata": {
            "type": "optional[object]",
            "required": True,
        },
    },
}

MEMORY_GRAPH_SCHEMA_V1["contracts"] = {
    "memory_item_identity": MEMORY_ITEM_IDENTITY_SCHEMA_V1,
    "long_term_memory_record_contract": LONG_TERM_MEMORY_RECORD_CONTRACT_V1,
    "long_term_memory_persistence_entry": LONG_TERM_MEMORY_PERSISTENCE_SCHEMA_V1,
    "consolidation_promotion_input": CONSOLIDATION_PROMOTION_INPUT_SCHEMA_V1,
    "consolidation_promotion_policy": CONSOLIDATION_PROMOTION_POLICY_SCHEMA_V1,
    "offline_consolidation_request": OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA_V1,
    "offline_batch_limit": OFFLINE_BATCH_LIMIT_SCHEMA_V1,
    "default_b200_offline_batch_limit": DEFAULT_B200_OFFLINE_BATCH_LIMIT_V1,
    "offline_batch_work_unit": OFFLINE_BATCH_WORK_UNIT_SCHEMA_V1,
    "offline_batch_plan": OFFLINE_BATCH_PLAN_SCHEMA_V1,
}


def validate_domain_schema(domain: DomainSchema) -> None:
    """Raises ValueError when a domain refers to unknown nodes, edges, or boundaries."""

    boundary_names = set(domain.ownership_boundaries.keys())
    node_names = set(domain.node_types.keys())
    edge_names = set(domain.edge_types.keys())

    for node in domain.node_types.values():
        if node.ownership_boundary not in boundary_names:
            raise ValueError(
                f"Node type {node.name} refers to unknown boundary {node.ownership_boundary}"
            )

        for edge_name in (*node.allowed_outbound_edges, *node.allowed_inbound_edges):
            if edge_name not in edge_names:
                raise ValueError(f"Node type {node.name} refers to unknown edge {edge_name}")

        missing_property_types = [
            property_name
            for property_name in node.required_properties
            if property_name not in node.property_types
        ]
        if missing_property_types:
            raise ValueError(
                f"Node type {node.name} is missing property types for {missing_property_types}"
            )

    for edge in domain.edge_types.values():
        if edge.source not in node_names:
            raise ValueError(f"Edge type {edge.name} has unknown source {edge.source}")
        if edge.target not in node_names:
            raise ValueError(f"Edge type {edge.name} has unknown target {edge.target}")
        if edge.ownership_boundary not in boundary_names:
            raise ValueError(
                f"Edge type {edge.name} refers to unknown boundary {edge.ownership_boundary}"
            )
        missing_property_types = [
            property_name
            for property_name in edge.required_properties
            if property_name not in edge.property_types
        ]
        if missing_property_types:
            raise ValueError(
                f"Edge type {edge.name} is missing property types for {missing_property_types}"
            )


def validate_old_generation_graph_rules(domain: DomainSchema = OLD_GENERATION_DOMAIN) -> None:
    """Raises ValueError when old-generation graph rules drift from the schema."""

    validate_domain_schema(domain)

    identity = domain.node_types["immutable_identity_item"]
    if identity.allowed_outbound_edges or identity.allowed_inbound_edges:
        raise ValueError("Immutable identity must remain isolated from all old-generation edges.")

    for edge_name, expected_combination in OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS.items():
        edge = domain.edge_types.get(edge_name)
        if edge is None:
            raise ValueError(f"Missing old-generation edge type {edge_name}")
        if edge.source != expected_combination["source"]:
            raise ValueError(
                f"Edge type {edge_name} must use source {expected_combination['source']}"
            )
        if edge.target != expected_combination["target"]:
            raise ValueError(
                f"Edge type {edge_name} must use target {expected_combination['target']}"
            )
        if "immutable_identity_item" in (edge.source, edge.target):
            raise ValueError(
                f"Old-generation edge type {edge_name} cannot connect immutable identity"
            )

    supersedes = domain.edge_types["long_term_memory_supersedes"]
    if supersedes.source != "long_term_memory_item" or supersedes.target != "long_term_memory_item":
        raise ValueError("Old-generation supersedes edges must connect long-term memory nodes only.")


def schema_snapshot() -> dict[str, object]:
    """Returns a serializable snapshot of the current memory graph schema."""

    domains = {
        domain_name: asdict(domain_schema)
        for domain_name, domain_schema in MEMORY_GRAPH_SCHEMA_V1["domains"].items()
    }
    return {
        "schema_version": MEMORY_GRAPH_SCHEMA_V1["schema_version"],
        "domains": domains,
        "snapshots": MEMORY_GRAPH_SCHEMA_V1["snapshots"],
        "contracts": MEMORY_GRAPH_SCHEMA_V1.get("contracts", {}),
    }
