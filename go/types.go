package brain

const (
	BrainLibraryName = "@zep/brain-go"

	SchemaIDYoungGenerationGraphState = "agent_brain_young_generation_graph_state"
	SchemaIDOldGenerationGraphState   = "agent_brain_old_generation_graph_state"
	SchemaIDLongTermMemoryEntry       = "agent_brain_long_term_memory_entry"
	SchemaVersion                     = "1.0.0"

	NodeKindAgentBrain          = "agent_brain"
	NodeKindYoungGeneration     = "young_generation"
	NodeKindOldGeneration       = "old_generation"
	NodeKindWorkingMemory       = "working_memory"
	NodeKindShortTermMemory     = "short_term_memory"
	NodeKindImportanceIndex     = "importance_index"
	NodeKindLongTermMemory      = "long_term_memory"
	NodeKindArchivedMemory      = "archived_memory"
	NodeKindMemoryEvidence      = "memory_evidence"
	NodeKindConsolidationRecord = "consolidation_record"
	NodeKindImmutableIdentity   = "immutable_identity"

	RelationWorkingMemoryReference   = "working_memory_reference"
	RelationWorkingToShortTerm       = "working_to_short_term_capture"
	RelationImportanceToWorking      = "importance_to_working_memory"
	RelationImportanceToShortTerm    = "importance_to_short_term_memory"
	RelationShortTermRecall          = "short_term_recall"
	RelationShortTermAssociation     = "short_term_association"
	RelationMemoryAssociation        = "association"
	RelationSupportedByEvidence      = "supported_by_evidence"
	RelationCreatedByConsolidation   = "created_by_consolidation"
	RelationSupersedes               = "supersedes"
	ConsolidationOperationPromote    = "promote"
	ConsolidationOperationReinforce  = "reinforce"
	ConsolidationOperationPreserve   = "preserve"
	ConsolidationOperationSupersede  = "supersede"
	ConsolidationStatusRuntimeSeeded = "runtime_seeded"
	ConsolidationStatusPromoted      = "promoted"
	ConsolidationStatusReinforced    = "reinforced"
	ConsolidationStatusPreserved     = "preserved"
	ConsolidationStatusSuperseded    = "superseded"

	MemoryCategorySemantic     = "semantic"
	MemoryCategoryEpisodic     = "episodic"
	MemoryCategoryProcedural   = "procedural"
	MemoryCategoryLearnedTrait = "learned_trait"
	MemoryCategoryObservation  = "observation"

	YoungLifecycleActive   = "active"
	YoungLifecycleInactive = "inactive"
	YoungLifecycleArchived = "archived"
)

var (
	BrainLibraryModules = []string{
		"memory-graph",
		"consolidation",
		"batch-planning",
		"identity-guard",
	}

	ProtectedIdentityFields = []string{
		"agentId",
		"persona",
		"role",
		"durableMission",
		"safetyConstraints",
		"ownership",
		"nonNegotiablePreferences",
		"runtimeInvariants",
		"protectedCoreFacts",
	}
)

type ProvenanceRecord struct {
	Source     string   `json:"source"`
	ObservedAt string   `json:"observedAt,omitempty"`
	Evidence   []string `json:"evidence,omitempty"`
	Actor      string   `json:"actor,omitempty"`
}

type OldGenerationTemporalContext struct {
	FirstObservedAt string `json:"firstObservedAt,omitempty"`
	LastObservedAt  string `json:"lastObservedAt,omitempty"`
	StabilizedAt    string `json:"stabilizedAt,omitempty"`
	ConsolidatedAt  string `json:"consolidatedAt,omitempty"`
	LastAccessedAt  string `json:"lastAccessedAt,omitempty"`
	SupersededAt    string `json:"supersededAt,omitempty"`
}

type OldGenerationSalience struct {
	Score           *float64           `json:"score,omitempty"`
	Signals         map[string]float64 `json:"signals,omitempty"`
	SignalCount     int                `json:"signalCount"`
	LastEvaluatedAt string             `json:"lastEvaluatedAt,omitempty"`
	SourceEntryID   string             `json:"sourceEntryId,omitempty"`
}

type OldGenerationConsolidationState struct {
	Status                         string   `json:"status"`
	LastOperation                  string   `json:"lastOperation,omitempty"`
	JournalRecordID                string   `json:"journalRecordId,omitempty"`
	PolicyVersion                  string   `json:"policyVersion,omitempty"`
	SourceMemoryIDs                []string `json:"sourceMemoryIds,omitempty"`
	PreservedIdentityFields        []string `json:"preservedIdentityFields,omitempty"`
	ProtectedFromIdentityPromotion *bool    `json:"protectedFromIdentityPromotion,omitempty"`
}

type ImmutableIdentity struct {
	NodeID                   string                          `json:"nodeId"`
	AgentID                  string                          `json:"agentId"`
	Persona                  string                          `json:"persona"`
	Role                     string                          `json:"role"`
	DurableMission           string                          `json:"durableMission"`
	SafetyConstraints        []string                        `json:"safetyConstraints"`
	Ownership                []string                        `json:"ownership"`
	NonNegotiablePreferences []string                        `json:"nonNegotiablePreferences"`
	RuntimeInvariants        map[string]any                  `json:"runtimeInvariants"`
	ProtectedCoreFacts       []string                        `json:"protectedCoreFacts"`
	Provenance               map[string]any                  `json:"provenance,omitempty"`
	TemporalContext          OldGenerationTemporalContext    `json:"temporalContext"`
	ConsolidationState       OldGenerationConsolidationState `json:"consolidationState"`
}

type MemoryRecord struct {
	MemoryID   string         `json:"memoryId"`
	Content    string         `json:"content,omitempty"`
	Summary    string         `json:"summary,omitempty"`
	Detail     string         `json:"detail,omitempty"`
	Provenance map[string]any `json:"provenance,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type YoungGenerationMaskedOriginalContent struct {
	Value       string `json:"value,omitempty"`
	SourceField string `json:"sourceField,omitempty"`
	CapturedAt  string `json:"capturedAt,omitempty"`
}

type YoungGenerationMaskingAuditMetadata struct {
	AuditRecordID        string `json:"auditRecordId,omitempty"`
	PolicyVersion        string `json:"policyVersion,omitempty"`
	RuntimePhase         string `json:"runtimePhase,omitempty"`
	RecordedAt           string `json:"recordedAt,omitempty"`
	Actor                string `json:"actor,omitempty"`
	SourceEvaluationMode string `json:"sourceEvaluationMode,omitempty"`
}

type YoungGenerationMaskingMetadata struct {
	IsMasked              bool                                  `json:"isMasked"`
	MaskedAt              string                                `json:"maskedAt,omitempty"`
	UnmaskedAt            string                                `json:"unmaskedAt,omitempty"`
	MaskUpdatedAt         string                                `json:"maskUpdatedAt,omitempty"`
	MaskedBy              string                                `json:"maskedBy,omitempty"`
	Reason                string                                `json:"reason,omitempty"`
	MaskedOriginalContent *YoungGenerationMaskedOriginalContent `json:"maskedOriginalContent,omitempty"`
	Audit                 *YoungGenerationMaskingAuditMetadata  `json:"audit,omitempty"`
	Provenance            map[string]any                        `json:"provenance,omitempty"`
}

type YoungGenerationArchiveLinkage struct {
	ArchiveID     string `json:"archiveId,omitempty"`
	ArchiveNodeID string `json:"archiveNodeId,omitempty"`
	ArchivedAt    string `json:"archivedAt,omitempty"`
}

type YoungGenerationMemoryLifecycle struct {
	State          string                         `json:"state"`
	InactiveAt     string                         `json:"inactiveAt,omitempty"`
	InactiveReason string                         `json:"inactiveReason,omitempty"`
	ArchiveLinkage *YoungGenerationArchiveLinkage `json:"archiveLinkage,omitempty"`
}

type YoungGenerationMemory struct {
	Record               MemoryRecord                   `json:"record"`
	InactiveForRetrieval bool                           `json:"inactiveForRetrieval"`
	Masking              YoungGenerationMaskingMetadata `json:"masking"`
	Lifecycle            YoungGenerationMemoryLifecycle `json:"lifecycle"`
}

type ImportanceIndexEntry struct {
	EntryID         string             `json:"entryId"`
	AgentID         string             `json:"agentId"`
	MemoryID        string             `json:"memoryId"`
	MemoryKind      string             `json:"memoryKind"`
	Signals         map[string]float64 `json:"signals"`
	LastUpdatedAt   string             `json:"lastUpdatedAt"`
	Provenance      map[string]any     `json:"provenance,omitempty"`
	SignalCount     int                `json:"signalCount"`
	ImportanceScore float64            `json:"importanceScore"`
}

type YoungGeneration struct {
	Generation      string                  `json:"generation"`
	WorkingMemory   []YoungGenerationMemory `json:"workingMemory"`
	ShortTermMemory []YoungGenerationMemory `json:"shortTermMemory"`
	ImportanceIndex []ImportanceIndexEntry  `json:"importanceIndex"`
}

type LearnedTraitMemory struct {
	Label                          string         `json:"label"`
	Confidence                     float64        `json:"confidence"`
	Provenance                     map[string]any `json:"provenance,omitempty"`
	ProtectedFromIdentityPromotion bool           `json:"protectedFromIdentityPromotion"`
}

type LongTermMemory struct {
	NodeID             string                          `json:"nodeId"`
	AgentID            string                          `json:"agentId"`
	MemoryID           string                          `json:"memoryId"`
	Category           string                          `json:"category"`
	Content            string                          `json:"content"`
	Summary            string                          `json:"summary"`
	Confidence         float64                         `json:"confidence"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	StabilizedAt       string                          `json:"stabilizedAt"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	Salience           OldGenerationSalience           `json:"salience"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
	LearnedTrait       *LearnedTraitMemory             `json:"learnedTrait,omitempty"`
}

type ArchivedMemory struct {
	NodeID             string                          `json:"nodeId"`
	ArchiveID          string                          `json:"archiveId"`
	AgentID            string                          `json:"agentId"`
	OriginalGeneration string                          `json:"originalGeneration"`
	OriginalMemoryKind string                          `json:"originalMemoryKind"`
	OriginalMemoryID   string                          `json:"originalMemoryId"`
	OriginalNodeID     string                          `json:"originalNodeId,omitempty"`
	ArchivalReason     string                          `json:"archivalReason"`
	ArchivedAt         string                          `json:"archivedAt"`
	Snapshot           map[string]any                  `json:"snapshot"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
	RecoveryContext    map[string]any                  `json:"recoveryContext,omitempty"`
}

type MemoryEvidence struct {
	NodeID             string                          `json:"nodeId"`
	AgentID            string                          `json:"agentId"`
	EvidenceID         string                          `json:"evidenceId"`
	Kind               string                          `json:"kind"`
	Content            string                          `json:"content"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
}

type ConsolidationRecord struct {
	NodeID             string                          `json:"nodeId"`
	AgentID            string                          `json:"agentId"`
	RecordID           string                          `json:"recordId"`
	Operation          string                          `json:"operation"`
	SourceMemoryIDs    []string                        `json:"sourceMemoryIds,omitempty"`
	TargetMemoryID     string                          `json:"targetMemoryId,omitempty"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
}

type OldGenerationEdge struct {
	EdgeID             string                          `json:"edgeId"`
	AgentID            string                          `json:"agentId"`
	From               string                          `json:"from"`
	To                 string                          `json:"to"`
	Relation           string                          `json:"relation"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
}

type OldGeneration struct {
	Generation           string                `json:"generation"`
	LongTermMemory       []LongTermMemory      `json:"longTermMemory"`
	ArchivedMemory       []ArchivedMemory      `json:"archivedMemory"`
	MemoryEvidence       []MemoryEvidence      `json:"memoryEvidence"`
	ConsolidationJournal []ConsolidationRecord `json:"consolidationJournal"`
	ImmutableIdentity    ImmutableIdentity     `json:"immutableIdentity"`
}

type MemoryGraph struct {
	AgentID         string              `json:"agentId"`
	YoungGeneration YoungGeneration     `json:"youngGeneration"`
	OldGeneration   OldGeneration       `json:"oldGeneration"`
	Edges           []OldGenerationEdge `json:"edges"`
}

type YoungGenerationConstructionMetadata struct {
	AgentID                  string `json:"agentId"`
	SavedAt                  string `json:"savedAt"`
	SourceGraphSchemaID      string `json:"sourceGraphSchemaId"`
	SourceGraphSchemaVersion string `json:"sourceGraphSchemaVersion"`
	YoungGenerationNodeKind  string `json:"youngGenerationNodeKind"`
	WorkingMemoryNodeKind    string `json:"workingMemoryNodeKind"`
	ShortTermMemoryNodeKind  string `json:"shortTermMemoryNodeKind"`
	ImportanceIndexNodeKind  string `json:"importanceIndexNodeKind"`
}

type OldGenerationConstructionMetadata struct {
	AgentID                     string `json:"agentId"`
	SavedAt                     string `json:"savedAt"`
	SourceGraphSchemaID         string `json:"sourceGraphSchemaId"`
	SourceGraphSchemaVersion    string `json:"sourceGraphSchemaVersion"`
	OldGenerationNodeKind       string `json:"oldGenerationNodeKind"`
	LongTermMemoryNodeKind      string `json:"longTermMemoryNodeKind"`
	ArchivedMemoryNodeKind      string `json:"archivedMemoryNodeKind"`
	MemoryEvidenceNodeKind      string `json:"memoryEvidenceNodeKind"`
	ConsolidationRecordNodeKind string `json:"consolidationRecordNodeKind"`
	ImmutableIdentityNodeKind   string `json:"immutableIdentityNodeKind"`
}

type YoungGenerationGraphState struct {
	SchemaID             string                              `json:"schemaId"`
	SchemaVersion        string                              `json:"schemaVersion"`
	ConstructionMetadata YoungGenerationConstructionMetadata `json:"constructionMetadata"`
	YoungGeneration      YoungGeneration                     `json:"youngGeneration"`
	Edges                []OldGenerationEdge                 `json:"edges"`
}

type OldGenerationGraphState struct {
	SchemaID             string                            `json:"schemaId"`
	SchemaVersion        string                            `json:"schemaVersion"`
	ConstructionMetadata OldGenerationConstructionMetadata `json:"constructionMetadata"`
	OldGeneration        OldGeneration                     `json:"oldGeneration"`
	Edges                []OldGenerationEdge               `json:"edges"`
}
