package brain

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type MemoryGraphOptions struct {
	WorkingMemory        []YoungGenerationMemory
	ShortTermMemory      []YoungGenerationMemory
	ImportanceIndex      []ImportanceIndexEntry
	LongTermMemory       []LongTermMemory
	ArchivedMemory       []ArchivedMemory
	MemoryEvidence       []MemoryEvidence
	ConsolidationJournal []ConsolidationRecord
	Edges                []OldGenerationEdge
}

type ImportanceIndexQuery struct {
	AccessMode         string
	AgentID            string
	MemoryID           string
	MemoryKind         string
	MinImportanceScore float64
	SignalName         string
	MinSignalValue     float64
	Limit              int
	SortBy             string
}

type OldGenerationNodeLookup struct {
	NodeID     string
	MemoryID   string
	ArchiveID  string
	EvidenceID string
	RecordID   string
	Kind       string
}

type OldGenerationAccessOptions struct {
	AccessMode string
}

type OldGenerationRelationshipWalkOptions struct {
	AccessMode string
	Direction  string
	MaxDepth   int
}

type OldGenerationWalkStep struct {
	NodeID   string `json:"nodeId"`
	Kind     string `json:"kind"`
	Depth    int    `json:"depth"`
	EdgeID   string `json:"edgeId"`
	Relation string `json:"relation"`
}

type OldGenerationRelationshipWalkResult struct {
	RootNodeID string                  `json:"rootNodeId"`
	Steps      []OldGenerationWalkStep `json:"steps"`
}

func CreateOldGenerationNodeID(nodeKind string, agentID string, localID string) string {
	return fmt.Sprintf("old/%s/%s/%s", urlToken(agentID), urlToken(nodeKind), urlToken(localID))
}

func CreateOldGenerationEdgeID(agentID, relation, from, to string) string {
	return fmt.Sprintf("old/%s/edge/%s/%s->%s", urlToken(agentID), urlToken(relation), urlToken(from), urlToken(to))
}

func urlToken(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "/", "%2F")
	value = strings.ReplaceAll(value, " ", "%20")
	return value
}

func CreateImmutableIdentity(input ImmutableIdentity) (ImmutableIdentity, error) {
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return ImmutableIdentity{}, err
	}
	persona, err := normalizeRequiredString(input.Persona, "persona")
	if err != nil {
		return ImmutableIdentity{}, err
	}
	role, err := normalizeRequiredString(input.Role, "role")
	if err != nil {
		return ImmutableIdentity{}, err
	}
	mission, err := normalizeRequiredString(input.DurableMission, "durableMission")
	if err != nil {
		return ImmutableIdentity{}, err
	}
	nodeID := normalizeOptionalString(input.NodeID)
	if nodeID == "" {
		nodeID = CreateOldGenerationNodeID(NodeKindImmutableIdentity, agentID, "self")
	}
	state := normalizeConsolidationState(input.ConsolidationState)
	if state.Status == "" {
		state.Status = ConsolidationStatusRuntimeSeeded
		state.PreservedIdentityFields = copyStrings(ProtectedIdentityFields)
	}
	return ImmutableIdentity{
		NodeID:                   nodeID,
		AgentID:                  agentID,
		Persona:                  persona,
		Role:                     role,
		DurableMission:           mission,
		SafetyConstraints:        uniqueSortedStrings(input.SafetyConstraints),
		Ownership:                uniqueSortedStrings(input.Ownership),
		NonNegotiablePreferences: uniqueSortedStrings(input.NonNegotiablePreferences),
		RuntimeInvariants:        copyMap(input.RuntimeInvariants),
		ProtectedCoreFacts:       uniqueSortedStrings(input.ProtectedCoreFacts),
		Provenance:               copyMap(input.Provenance),
		TemporalContext:          normalizeTemporalContext(input.TemporalContext),
		ConsolidationState:       state,
	}, nil
}

func CreateYoungGenerationMemory(input YoungGenerationMemory) (YoungGenerationMemory, error) {
	memoryID, err := normalizeRequiredString(input.Record.MemoryID, "memoryId")
	if err != nil {
		return YoungGenerationMemory{}, err
	}
	record := input.Record
	record.MemoryID = memoryID
	record.Provenance = copyMap(record.Provenance)
	record.Metadata = copyMap(record.Metadata)
	lifecycle := normalizeYoungLifecycle(input.Lifecycle, input.InactiveForRetrieval)
	masking := normalizeMaskingMetadata(input.Masking, input.InactiveForRetrieval, record)
	return YoungGenerationMemory{
		Record:               record,
		InactiveForRetrieval: input.InactiveForRetrieval,
		Masking:              masking,
		Lifecycle:            lifecycle,
	}, nil
}

func normalizeMaskingMetadata(input YoungGenerationMaskingMetadata, inactive bool, record MemoryRecord) YoungGenerationMaskingMetadata {
	result := input
	if inactive && result.MaskedAt == "" {
		result.MaskedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if result.IsMasked || inactive {
		result.IsMasked = true
		if result.MaskUpdatedAt == "" {
			result.MaskUpdatedAt = result.MaskedAt
		}
		if result.MaskedOriginalContent == nil {
			sourceField := "content"
			value := record.Content
			if value == "" {
				sourceField = "summary"
				value = record.Summary
			}
			if value == "" {
				sourceField = "detail"
				value = record.Detail
			}
			if value != "" {
				result.MaskedOriginalContent = &YoungGenerationMaskedOriginalContent{
					Value:       value,
					SourceField: sourceField,
					CapturedAt:  result.MaskedAt,
				}
			}
		}
		if result.Audit == nil {
			result.Audit = &YoungGenerationMaskingAuditMetadata{
				Actor:      coalesceString(result.MaskedBy, "offline-consolidation"),
				RecordedAt: result.MaskedAt,
			}
		}
	}
	result.Provenance = copyMap(result.Provenance)
	return result
}

func normalizeYoungLifecycle(input YoungGenerationMemoryLifecycle, inactive bool) YoungGenerationMemoryLifecycle {
	result := input
	if result.State == "" {
		if inactive {
			result.State = YoungLifecycleInactive
		} else {
			result.State = YoungLifecycleActive
		}
	}
	if result.ArchiveLinkage != nil {
		next := *result.ArchiveLinkage
		result.ArchiveLinkage = &next
	}
	return result
}

func coalesceString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeTemporalContext(input OldGenerationTemporalContext) OldGenerationTemporalContext {
	return OldGenerationTemporalContext{
		FirstObservedAt: mustNormalizeTimeString(input.FirstObservedAt),
		LastObservedAt:  mustNormalizeTimeString(input.LastObservedAt),
		StabilizedAt:    mustNormalizeTimeString(input.StabilizedAt),
		ConsolidatedAt:  mustNormalizeTimeString(input.ConsolidatedAt),
		LastAccessedAt:  mustNormalizeTimeString(input.LastAccessedAt),
		SupersededAt:    mustNormalizeTimeString(input.SupersededAt),
	}
}

func normalizeSalience(input OldGenerationSalience) OldGenerationSalience {
	result := input
	result.Signals = make(map[string]float64, len(input.Signals))
	for key, value := range input.Signals {
		result.Signals[key] = clamp01(value)
	}
	if input.Score == nil && len(result.Signals) > 0 {
		score := averageSignalScore(result.Signals)
		result.Score = &score
	}
	result.SignalCount = len(result.Signals)
	result.LastEvaluatedAt = mustNormalizeTimeString(result.LastEvaluatedAt)
	return result
}

func normalizeConsolidationState(input OldGenerationConsolidationState) OldGenerationConsolidationState {
	result := input
	if result.Status == "" {
		result.Status = ConsolidationStatusRuntimeSeeded
	}
	result.SourceMemoryIDs = uniqueSortedStrings(result.SourceMemoryIDs)
	result.PreservedIdentityFields = uniqueSortedStrings(result.PreservedIdentityFields)
	return result
}

func CreateLongTermMemory(input LongTermMemory) (LongTermMemory, error) {
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return LongTermMemory{}, err
	}
	memoryID, err := normalizeRequiredString(input.MemoryID, "memoryId")
	if err != nil {
		return LongTermMemory{}, err
	}
	category, err := normalizeRequiredString(input.Category, "category")
	if err != nil {
		return LongTermMemory{}, err
	}
	content, err := normalizeRequiredString(input.Content, "content")
	if err != nil {
		return LongTermMemory{}, err
	}
	summary := input.Summary
	if strings.TrimSpace(summary) == "" {
		summary = content
	}
	nodeID := normalizeOptionalString(input.NodeID)
	if nodeID == "" {
		nodeID = CreateOldGenerationNodeID(NodeKindLongTermMemory, agentID, memoryID)
	}
	result := input
	result.NodeID = nodeID
	result.AgentID = agentID
	result.MemoryID = memoryID
	result.Category = strings.ToLower(category)
	result.Content = content
	result.Summary = summary
	result.Provenance = copyMap(input.Provenance)
	result.StabilizedAt = mustNormalizeTimeString(input.StabilizedAt)
	result.TemporalContext = normalizeTemporalContext(input.TemporalContext)
	result.Salience = normalizeSalience(input.Salience)
	result.ConsolidationState = normalizeConsolidationState(input.ConsolidationState)
	if result.Category == MemoryCategoryLearnedTrait && result.LearnedTrait != nil {
		result.LearnedTrait = &LearnedTraitMemory{
			Label:                          strings.TrimSpace(result.LearnedTrait.Label),
			Confidence:                     clamp01(result.LearnedTrait.Confidence),
			Provenance:                     copyMap(result.LearnedTrait.Provenance),
			ProtectedFromIdentityPromotion: true,
		}
		protected := true
		result.ConsolidationState.ProtectedFromIdentityPromotion = &protected
	}
	return result, nil
}

func CreateOldGenerationEdge(input OldGenerationEdge) (OldGenerationEdge, error) {
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return OldGenerationEdge{}, err
	}
	from, err := normalizeRequiredString(input.From, "from")
	if err != nil {
		return OldGenerationEdge{}, err
	}
	to, err := normalizeRequiredString(input.To, "to")
	if err != nil {
		return OldGenerationEdge{}, err
	}
	relation, err := normalizeRequiredString(input.Relation, "relation")
	if err != nil {
		return OldGenerationEdge{}, err
	}
	edgeID := normalizeOptionalString(input.EdgeID)
	if edgeID == "" {
		edgeID = CreateOldGenerationEdgeID(agentID, relation, from, to)
	}
	return OldGenerationEdge{
		EdgeID:             edgeID,
		AgentID:            agentID,
		From:               from,
		To:                 to,
		Relation:           relation,
		Provenance:         copyMap(input.Provenance),
		TemporalContext:    normalizeTemporalContext(input.TemporalContext),
		ConsolidationState: normalizeConsolidationState(input.ConsolidationState),
	}, nil
}

func CreateImportanceIndexEntry(input ImportanceIndexEntry) (ImportanceIndexEntry, error) {
	entryID, err := normalizeRequiredString(input.EntryID, "entryId")
	if err != nil {
		return ImportanceIndexEntry{}, err
	}
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return ImportanceIndexEntry{}, err
	}
	memoryID, err := normalizeRequiredString(input.MemoryID, "memoryId")
	if err != nil {
		return ImportanceIndexEntry{}, err
	}
	memoryKind, err := normalizeRequiredString(input.MemoryKind, "memoryKind")
	if err != nil {
		return ImportanceIndexEntry{}, err
	}
	signals := make(map[string]float64, len(input.Signals))
	for key, value := range input.Signals {
		if normalized := strings.TrimSpace(key); normalized != "" {
			signals[normalized] = clamp01(value)
		}
	}
	return ImportanceIndexEntry{
		EntryID:         entryID,
		AgentID:         agentID,
		MemoryID:        memoryID,
		MemoryKind:      memoryKind,
		Signals:         signals,
		LastUpdatedAt:   mustNormalizeTimeString(input.LastUpdatedAt),
		Provenance:      copyMap(input.Provenance),
		SignalCount:     len(signals),
		ImportanceScore: averageSignalScore(signals),
	}, nil
}

func CreateMemoryGraph(identityInput ImmutableIdentity, options MemoryGraphOptions) (MemoryGraph, error) {
	identity, err := CreateImmutableIdentity(identityInput)
	if err != nil {
		return MemoryGraph{}, err
	}
	graph := MemoryGraph{
		AgentID: identity.AgentID,
		YoungGeneration: YoungGeneration{
			Generation:      NodeKindYoungGeneration,
			WorkingMemory:   []YoungGenerationMemory{},
			ShortTermMemory: []YoungGenerationMemory{},
			ImportanceIndex: []ImportanceIndexEntry{},
		},
		OldGeneration: OldGeneration{
			Generation:           NodeKindOldGeneration,
			LongTermMemory:       []LongTermMemory{},
			ArchivedMemory:       []ArchivedMemory{},
			MemoryEvidence:       []MemoryEvidence{},
			ConsolidationJournal: []ConsolidationRecord{},
			ImmutableIdentity:    identity,
		},
		Edges: []OldGenerationEdge{},
	}
	for _, memory := range options.WorkingMemory {
		created, err := CreateYoungGenerationMemory(memory)
		if err != nil {
			return MemoryGraph{}, err
		}
		graph.YoungGeneration.WorkingMemory = append(graph.YoungGeneration.WorkingMemory, created)
	}
	for _, memory := range options.ShortTermMemory {
		created, err := CreateYoungGenerationMemory(memory)
		if err != nil {
			return MemoryGraph{}, err
		}
		graph.YoungGeneration.ShortTermMemory = append(graph.YoungGeneration.ShortTermMemory, created)
	}
	for _, entry := range options.ImportanceIndex {
		created, err := CreateImportanceIndexEntry(entry)
		if err != nil {
			return MemoryGraph{}, err
		}
		graph.YoungGeneration.ImportanceIndex = append(graph.YoungGeneration.ImportanceIndex, created)
	}
	for _, memory := range options.LongTermMemory {
		created, err := CreateLongTermMemory(memory)
		if err != nil {
			return MemoryGraph{}, err
		}
		graph.OldGeneration.LongTermMemory = append(graph.OldGeneration.LongTermMemory, created)
	}
	graph.OldGeneration.ArchivedMemory = append([]ArchivedMemory(nil), options.ArchivedMemory...)
	graph.OldGeneration.MemoryEvidence = append([]MemoryEvidence(nil), options.MemoryEvidence...)
	graph.OldGeneration.ConsolidationJournal = append([]ConsolidationRecord(nil), options.ConsolidationJournal...)
	for _, edge := range options.Edges {
		created, err := CreateOldGenerationEdge(edge)
		if err != nil {
			return MemoryGraph{}, err
		}
		graph.Edges = append(graph.Edges, created)
	}
	return graph, nil
}

func PutImportanceIndexEntry(graph MemoryGraph, input ImportanceIndexEntry) (MemoryGraph, error) {
	entry, err := CreateImportanceIndexEntry(input)
	if err != nil {
		return MemoryGraph{}, err
	}
	next := graph
	replaced := false
	for index, existing := range next.YoungGeneration.ImportanceIndex {
		if existing.AgentID == entry.AgentID && existing.MemoryID == entry.MemoryID && existing.MemoryKind == entry.MemoryKind {
			next.YoungGeneration.ImportanceIndex[index] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		next.YoungGeneration.ImportanceIndex = append(next.YoungGeneration.ImportanceIndex, entry)
	}
	return next, nil
}

func QueryImportanceIndex(graph MemoryGraph, query ImportanceIndexQuery) []ImportanceIndexEntry {
	accessMode := query.AccessMode
	if accessMode == "" {
		accessMode = "retrieval"
	}
	activeKeys := activeYoungMemoryKeys(graph)
	result := make([]ImportanceIndexEntry, 0)
	for _, entry := range graph.YoungGeneration.ImportanceIndex {
		if query.AgentID != "" && entry.AgentID != query.AgentID {
			continue
		}
		if query.MemoryID != "" && entry.MemoryID != query.MemoryID {
			continue
		}
		if query.MemoryKind != "" && entry.MemoryKind != query.MemoryKind {
			continue
		}
		if query.MinImportanceScore > 0 && entry.ImportanceScore < query.MinImportanceScore {
			continue
		}
		if query.SignalName != "" {
			if signalValue, ok := entry.Signals[query.SignalName]; !ok || signalValue < query.MinSignalValue {
				continue
			}
		}
		if accessMode == "retrieval" && !activeKeys[fmt.Sprintf("%s:%s", entry.MemoryKind, entry.MemoryID)] {
			continue
		}
		result = append(result, entry)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if query.SortBy == "lastUpdatedAtDesc" {
			return result[i].LastUpdatedAt > result[j].LastUpdatedAt
		}
		if result[i].ImportanceScore == result[j].ImportanceScore {
			return result[i].LastUpdatedAt > result[j].LastUpdatedAt
		}
		return result[i].ImportanceScore > result[j].ImportanceScore
	})
	if query.Limit > 0 && len(result) > query.Limit {
		return result[:query.Limit]
	}
	return result
}

func activeYoungMemoryKeys(graph MemoryGraph) map[string]bool {
	keys := make(map[string]bool)
	for _, memory := range graph.YoungGeneration.WorkingMemory {
		if !memory.InactiveForRetrieval {
			keys[fmt.Sprintf("%s:%s", NodeKindWorkingMemory, memory.Record.MemoryID)] = true
		}
	}
	for _, memory := range graph.YoungGeneration.ShortTermMemory {
		if !memory.InactiveForRetrieval {
			keys[fmt.Sprintf("%s:%s", NodeKindShortTermMemory, memory.Record.MemoryID)] = true
		}
	}
	return keys
}

func CreateYoungGenerationRetrievalView(graph MemoryGraph) YoungGeneration {
	view := YoungGeneration{
		Generation:      NodeKindYoungGeneration,
		WorkingMemory:   []YoungGenerationMemory{},
		ShortTermMemory: []YoungGenerationMemory{},
		ImportanceIndex: []ImportanceIndexEntry{},
	}
	for _, memory := range graph.YoungGeneration.WorkingMemory {
		if !memory.InactiveForRetrieval {
			view.WorkingMemory = append(view.WorkingMemory, memory)
		}
	}
	for _, memory := range graph.YoungGeneration.ShortTermMemory {
		if !memory.InactiveForRetrieval {
			view.ShortTermMemory = append(view.ShortTermMemory, memory)
		}
	}
	view.ImportanceIndex = QueryImportanceIndex(graph, ImportanceIndexQuery{AccessMode: "retrieval"})
	return view
}

func CreateYoungGenerationAdministrativeView(graph MemoryGraph) YoungGeneration {
	return graph.YoungGeneration
}

func CreateYoungGenerationInspectionView(graph MemoryGraph) YoungGeneration {
	view := graph.YoungGeneration
	rehydrate := func(memory YoungGenerationMemory) YoungGenerationMemory {
		if memory.Masking.MaskedOriginalContent == nil {
			return memory
		}
		record := memory.Record
		switch memory.Masking.MaskedOriginalContent.SourceField {
		case "summary":
			if record.Summary == "" {
				record.Summary = memory.Masking.MaskedOriginalContent.Value
			}
		case "detail":
			if record.Detail == "" {
				record.Detail = memory.Masking.MaskedOriginalContent.Value
			}
		default:
			if record.Content == "" {
				record.Content = memory.Masking.MaskedOriginalContent.Value
			}
		}
		memory.Record = record
		return memory
	}
	for index, memory := range view.WorkingMemory {
		view.WorkingMemory[index] = rehydrate(memory)
	}
	for index, memory := range view.ShortTermMemory {
		view.ShortTermMemory[index] = rehydrate(memory)
	}
	return view
}

func SaveYoungGenerationGraphState(graph MemoryGraph) YoungGenerationGraphState {
	now := time.Now().UTC().Format(time.RFC3339)
	return YoungGenerationGraphState{
		SchemaID:      SchemaIDYoungGenerationGraphState,
		SchemaVersion: SchemaVersion,
		ConstructionMetadata: YoungGenerationConstructionMetadata{
			AgentID:                  graph.AgentID,
			SavedAt:                  now,
			SourceGraphSchemaID:      NodeKindAgentBrain,
			SourceGraphSchemaVersion: SchemaVersion,
			YoungGenerationNodeKind:  NodeKindYoungGeneration,
			WorkingMemoryNodeKind:    NodeKindWorkingMemory,
			ShortTermMemoryNodeKind:  NodeKindShortTermMemory,
			ImportanceIndexNodeKind:  NodeKindImportanceIndex,
		},
		YoungGeneration: graph.YoungGeneration,
		Edges:           GetYoungGenerationSnapshotEdges(graph),
	}
}

func GetYoungGenerationSnapshotEdges(graph MemoryGraph) []OldGenerationEdge {
	edges := make([]OldGenerationEdge, 0)
	for _, entry := range graph.YoungGeneration.ImportanceIndex {
		targetKind := NodeKindWorkingMemory
		relation := RelationImportanceToWorking
		if entry.MemoryKind == NodeKindShortTermMemory {
			targetKind = NodeKindShortTermMemory
			relation = RelationImportanceToShortTerm
		}
		edge, _ := CreateOldGenerationEdge(OldGenerationEdge{
			AgentID:  graph.AgentID,
			From:     fmt.Sprintf("young/%s/importance_index/%s", urlToken(graph.AgentID), urlToken(entry.EntryID)),
			To:       fmt.Sprintf("young/%s/%s/%s", urlToken(graph.AgentID), urlToken(targetKind), urlToken(entry.MemoryID)),
			Relation: relation,
		})
		edges = append(edges, edge)
	}
	return edges
}

func LoadYoungGenerationGraphState(shell MemoryGraph, state YoungGenerationGraphState) (MemoryGraph, error) {
	if state.ConstructionMetadata.AgentID != "" && state.ConstructionMetadata.AgentID != shell.AgentID {
		return MemoryGraph{}, fmt.Errorf("young generation state agentId mismatch")
	}
	next := shell
	next.YoungGeneration = state.YoungGeneration
	return next, nil
}

func SaveOldGenerationGraphState(graph MemoryGraph) OldGenerationGraphState {
	now := time.Now().UTC().Format(time.RFC3339)
	return OldGenerationGraphState{
		SchemaID:      SchemaIDOldGenerationGraphState,
		SchemaVersion: SchemaVersion,
		ConstructionMetadata: OldGenerationConstructionMetadata{
			AgentID:                     graph.AgentID,
			SavedAt:                     now,
			SourceGraphSchemaID:         NodeKindAgentBrain,
			SourceGraphSchemaVersion:    SchemaVersion,
			OldGenerationNodeKind:       NodeKindOldGeneration,
			LongTermMemoryNodeKind:      NodeKindLongTermMemory,
			ArchivedMemoryNodeKind:      NodeKindArchivedMemory,
			MemoryEvidenceNodeKind:      NodeKindMemoryEvidence,
			ConsolidationRecordNodeKind: NodeKindConsolidationRecord,
			ImmutableIdentityNodeKind:   NodeKindImmutableIdentity,
		},
		OldGeneration: graph.OldGeneration,
		Edges:         graph.Edges,
	}
}

func LoadOldGenerationGraphState(shell MemoryGraph, state OldGenerationGraphState) (MemoryGraph, error) {
	if state.ConstructionMetadata.AgentID != "" && state.ConstructionMetadata.AgentID != shell.AgentID {
		return MemoryGraph{}, fmt.Errorf("old generation state agentId mismatch")
	}
	if !protectedIdentityMatches(shell.OldGeneration.ImmutableIdentity, state.OldGeneration.ImmutableIdentity) {
		return MemoryGraph{}, fmt.Errorf("old generation immutable identity drift detected")
	}
	next := shell
	next.OldGeneration.LongTermMemory = state.OldGeneration.LongTermMemory
	next.OldGeneration.ArchivedMemory = state.OldGeneration.ArchivedMemory
	next.OldGeneration.MemoryEvidence = state.OldGeneration.MemoryEvidence
	next.OldGeneration.ConsolidationJournal = state.OldGeneration.ConsolidationJournal
	next.Edges = state.Edges
	return next, nil
}

func protectedIdentityMatches(left, right ImmutableIdentity) bool {
	if left.AgentID != right.AgentID || left.Persona != right.Persona || left.Role != right.Role || left.DurableMission != right.DurableMission {
		return false
	}
	if strings.Join(uniqueSortedStrings(left.SafetyConstraints), "|") != strings.Join(uniqueSortedStrings(right.SafetyConstraints), "|") {
		return false
	}
	if strings.Join(uniqueSortedStrings(left.Ownership), "|") != strings.Join(uniqueSortedStrings(right.Ownership), "|") {
		return false
	}
	if strings.Join(uniqueSortedStrings(left.NonNegotiablePreferences), "|") != strings.Join(uniqueSortedStrings(right.NonNegotiablePreferences), "|") {
		return false
	}
	if strings.Join(uniqueSortedStrings(left.ProtectedCoreFacts), "|") != strings.Join(uniqueSortedStrings(right.ProtectedCoreFacts), "|") {
		return false
	}
	rawLeft, _ := json.Marshal(left.RuntimeInvariants)
	rawRight, _ := json.Marshal(right.RuntimeInvariants)
	return string(rawLeft) == string(rawRight)
}

func LookupLongTermMemory(graph MemoryGraph, memoryID string) *LongTermMemory {
	for _, memory := range graph.OldGeneration.LongTermMemory {
		if memory.MemoryID == memoryID {
			copied := memory
			return &copied
		}
	}
	return nil
}

func LookupArchivedMemory(graph MemoryGraph, archiveID string) *ArchivedMemory {
	for _, memory := range graph.OldGeneration.ArchivedMemory {
		if memory.ArchiveID == archiveID {
			copied := memory
			return &copied
		}
	}
	return nil
}

func LookupMemoryEvidence(graph MemoryGraph, evidenceID string) *MemoryEvidence {
	for _, evidence := range graph.OldGeneration.MemoryEvidence {
		if evidence.EvidenceID == evidenceID {
			copied := evidence
			return &copied
		}
	}
	return nil
}

func LookupConsolidationRecord(graph MemoryGraph, recordID string) *ConsolidationRecord {
	for _, record := range graph.OldGeneration.ConsolidationJournal {
		if record.RecordID == recordID {
			copied := record
			return &copied
		}
	}
	return nil
}

func LookupOldGenerationNode(graph MemoryGraph, lookup OldGenerationNodeLookup, options OldGenerationAccessOptions) (string, any, error) {
	if lookup.MemoryID != "" {
		if memory := LookupLongTermMemory(graph, lookup.MemoryID); memory != nil {
			return NodeKindLongTermMemory, *memory, nil
		}
	}
	if lookup.ArchiveID != "" {
		if archive := LookupArchivedMemory(graph, lookup.ArchiveID); archive != nil {
			return NodeKindArchivedMemory, *archive, nil
		}
	}
	if lookup.EvidenceID != "" {
		if evidence := LookupMemoryEvidence(graph, lookup.EvidenceID); evidence != nil {
			return NodeKindMemoryEvidence, *evidence, nil
		}
	}
	if lookup.RecordID != "" {
		if record := LookupConsolidationRecord(graph, lookup.RecordID); record != nil {
			return NodeKindConsolidationRecord, *record, nil
		}
	}
	if lookup.Kind == NodeKindImmutableIdentity || lookup.NodeID == graph.OldGeneration.ImmutableIdentity.NodeID {
		if options.AccessMode == "administrative" {
			return NodeKindImmutableIdentity, graph.OldGeneration.ImmutableIdentity, nil
		}
		return "", nil, errNotFound
	}
	for _, memory := range graph.OldGeneration.LongTermMemory {
		if lookup.NodeID != "" && memory.NodeID == lookup.NodeID {
			return NodeKindLongTermMemory, memory, nil
		}
	}
	for _, archive := range graph.OldGeneration.ArchivedMemory {
		if lookup.NodeID != "" && archive.NodeID == lookup.NodeID {
			return NodeKindArchivedMemory, archive, nil
		}
	}
	return "", nil, errNotFound
}

func WalkOldGenerationRelationships(graph MemoryGraph, lookup OldGenerationNodeLookup, options OldGenerationRelationshipWalkOptions) (OldGenerationRelationshipWalkResult, error) {
	kind, node, err := LookupOldGenerationNode(graph, lookup, OldGenerationAccessOptions{AccessMode: options.AccessMode})
	if err != nil {
		return OldGenerationRelationshipWalkResult{}, err
	}
	rootNodeID := nodeIDFromNode(kind, node)
	maxDepth := options.MaxDepth
	if maxDepth <= 0 {
		maxDepth = 2
	}
	direction := options.Direction
	if direction == "" {
		direction = "outbound"
	}
	result := OldGenerationRelationshipWalkResult{
		RootNodeID: rootNodeID,
		Steps:      []OldGenerationWalkStep{},
	}
	type queueItem struct {
		nodeID string
		depth  int
	}
	queue := []queueItem{{nodeID: rootNodeID, depth: 0}}
	visited := map[string]bool{rootNodeID: true}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.depth >= maxDepth {
			continue
		}
		for _, edge := range graph.Edges {
			match := false
			nextNodeID := ""
			if direction != "inbound" && edge.From == current.nodeID {
				match = true
				nextNodeID = edge.To
			}
			if direction == "inbound" && edge.To == current.nodeID {
				match = true
				nextNodeID = edge.From
			}
			if !match {
				continue
			}
			result.Steps = append(result.Steps, OldGenerationWalkStep{
				NodeID:   nextNodeID,
				Kind:     inferNodeKind(nextNodeID),
				Depth:    current.depth + 1,
				EdgeID:   edge.EdgeID,
				Relation: edge.Relation,
			})
			if !visited[nextNodeID] {
				visited[nextNodeID] = true
				queue = append(queue, queueItem{nodeID: nextNodeID, depth: current.depth + 1})
			}
		}
	}
	return result, nil
}

func nodeIDFromNode(kind string, node any) string {
	switch typed := node.(type) {
	case LongTermMemory:
		return typed.NodeID
	case ArchivedMemory:
		return typed.NodeID
	case MemoryEvidence:
		return typed.NodeID
	case ConsolidationRecord:
		return typed.NodeID
	case ImmutableIdentity:
		return typed.NodeID
	default:
		return fmt.Sprintf("%s/%T", kind, node)
	}
}

func inferNodeKind(nodeID string) string {
	switch {
	case strings.Contains(nodeID, "/long_term_memory/"):
		return NodeKindLongTermMemory
	case strings.Contains(nodeID, "/archived_memory/"):
		return NodeKindArchivedMemory
	case strings.Contains(nodeID, "/memory_evidence/"):
		return NodeKindMemoryEvidence
	case strings.Contains(nodeID, "/consolidation_record/"):
		return NodeKindConsolidationRecord
	case strings.Contains(nodeID, "/immutable_identity/"):
		return NodeKindImmutableIdentity
	default:
		return ""
	}
}

func ValidateOldGenerationGraph(graph MemoryGraph) error {
	nodeIDs := map[string]struct{}{graph.OldGeneration.ImmutableIdentity.NodeID: {}}
	for _, memory := range graph.OldGeneration.LongTermMemory {
		if _, exists := nodeIDs[memory.NodeID]; exists {
			return fmt.Errorf("duplicate old-generation node id: %s", memory.NodeID)
		}
		nodeIDs[memory.NodeID] = struct{}{}
	}
	for _, archive := range graph.OldGeneration.ArchivedMemory {
		if _, exists := nodeIDs[archive.NodeID]; exists {
			return fmt.Errorf("duplicate old-generation node id: %s", archive.NodeID)
		}
		nodeIDs[archive.NodeID] = struct{}{}
	}
	for _, edge := range graph.Edges {
		if _, ok := nodeIDs[edge.From]; !ok {
			return fmt.Errorf("orphaned old-generation edge source: %s", edge.From)
		}
		if _, ok := nodeIDs[edge.To]; !ok {
			return fmt.Errorf("orphaned old-generation edge target: %s", edge.To)
		}
	}
	return nil
}
