package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const DefaultLongTermMemoryPersistenceKeyPrefix = "agent-brain/long-term-memory"

type SerializedLongTermMemoryEntry struct {
	SchemaID      string                            `json:"schemaId"`
	SchemaVersion string                            `json:"schemaVersion"`
	NodeKind      string                            `json:"nodeKind"`
	Content       LongTermMemoryPersistenceContent  `json:"content"`
	Metadata      LongTermMemoryPersistenceMetadata `json:"metadata"`
}

type LongTermMemoryPersistenceContent struct {
	MemoryID string `json:"memoryId"`
	Category string `json:"category"`
	Content  string `json:"content"`
	Summary  string `json:"summary"`
}

type LongTermMemoryPersistenceMetadata struct {
	NodeID             string                          `json:"nodeId"`
	AgentID            string                          `json:"agentId"`
	Confidence         float64                         `json:"confidence"`
	Provenance         map[string]any                  `json:"provenance,omitempty"`
	StabilizedAt       string                          `json:"stabilizedAt"`
	TemporalContext    OldGenerationTemporalContext    `json:"temporalContext"`
	Salience           OldGenerationSalience           `json:"salience"`
	ConsolidationState OldGenerationConsolidationState `json:"consolidationState"`
	LearnedTrait       *LearnedTraitMemory             `json:"learnedTrait,omitempty"`
}

type LongTermMemoryLogicalIdentity struct {
	Version           string   `json:"version"`
	StableMemoryID    string   `json:"stableMemoryId"`
	NodeID            string   `json:"nodeId,omitempty"`
	AgentID           string   `json:"agentId"`
	Category          string   `json:"category"`
	Content           string   `json:"content"`
	Summary           string   `json:"summary"`
	LineageMemoryIDs  []string `json:"lineageMemoryIds"`
	LearnedTraitLabel string   `json:"learnedTraitLabel,omitempty"`
	Key               string   `json:"key"`
}

type LongTermMemoryLogicalIdentityMatchResult struct {
	Status               string                        `json:"status"`
	Strategy             string                        `json:"strategy"`
	LogicalIdentity      LongTermMemoryLogicalIdentity `json:"logicalIdentity"`
	MatchCount           int                           `json:"matchCount"`
	MatchedMemoryID      string                        `json:"matchedMemoryId,omitempty"`
	MatchedNodeID        string                        `json:"matchedNodeId,omitempty"`
	ConflictingMemoryIDs []string                      `json:"conflictingMemoryIds,omitempty"`
}

type LongTermMemoryStorageListEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type LongTermMemoryStorageAdapter interface {
	Read(ctx context.Context, key string) (string, error)
	Write(ctx context.Context, request LongTermMemoryStorageWriteRequest) error
	List(ctx context.Context, keyPrefix string, agentID string) ([]LongTermMemoryStorageListEntry, error)
}

type LongTermMemoryStorageWriteRequest struct {
	Key         string                        `json:"key"`
	KeyPrefix   string                        `json:"keyPrefix"`
	RecordName  string                        `json:"recordName"`
	AgentID     string                        `json:"agentId"`
	MemoryID    string                        `json:"memoryId"`
	NodeID      string                        `json:"nodeId"`
	ContentType string                        `json:"contentType"`
	Value       string                        `json:"value"`
	Entry       SerializedLongTermMemoryEntry `json:"entry"`
	Overwrite   bool                          `json:"overwrite"`
}

type PersistLongTermMemoryEntryRequest struct {
	Storage      LongTermMemoryStorageAdapter
	Entry        SerializedLongTermMemoryEntry
	RuntimePhase any
	TeamIdle     bool
	KeyPrefix    string
}

type PersistLongTermMemoryEntryResult struct {
	Key             string                        `json:"key"`
	RecordName      string                        `json:"recordName"`
	SerializedEntry string                        `json:"serializedEntry"`
	Entry           SerializedLongTermMemoryEntry `json:"entry"`
	Authorization   IdleWindowAuthorization       `json:"authorization"`
}

func SerializeLongTermMemoryEntry(input LongTermMemory) (SerializedLongTermMemoryEntry, error) {
	memory, err := CreateLongTermMemory(input)
	if err != nil {
		return SerializedLongTermMemoryEntry{}, err
	}
	return SerializedLongTermMemoryEntry{
		SchemaID:      SchemaIDLongTermMemoryEntry,
		SchemaVersion: SchemaVersion,
		NodeKind:      NodeKindLongTermMemory,
		Content: LongTermMemoryPersistenceContent{
			MemoryID: memory.MemoryID,
			Category: memory.Category,
			Content:  memory.Content,
			Summary:  memory.Summary,
		},
		Metadata: LongTermMemoryPersistenceMetadata{
			NodeID:             memory.NodeID,
			AgentID:            memory.AgentID,
			Confidence:         memory.Confidence,
			Provenance:         copyMap(memory.Provenance),
			StabilizedAt:       memory.StabilizedAt,
			TemporalContext:    memory.TemporalContext,
			Salience:           memory.Salience,
			ConsolidationState: memory.ConsolidationState,
			LearnedTrait:       memory.LearnedTrait,
		},
	}, nil
}

func DeserializeLongTermMemoryEntry(entry SerializedLongTermMemoryEntry) (LongTermMemory, error) {
	if entry.SchemaID != SchemaIDLongTermMemoryEntry {
		return LongTermMemory{}, fmt.Errorf("unsupported long-term memory schema id: %s", entry.SchemaID)
	}
	return CreateLongTermMemory(LongTermMemory{
		NodeID:             entry.Metadata.NodeID,
		AgentID:            entry.Metadata.AgentID,
		MemoryID:           entry.Content.MemoryID,
		Category:           entry.Content.Category,
		Content:            entry.Content.Content,
		Summary:            entry.Content.Summary,
		Confidence:         entry.Metadata.Confidence,
		Provenance:         entry.Metadata.Provenance,
		StabilizedAt:       entry.Metadata.StabilizedAt,
		TemporalContext:    entry.Metadata.TemporalContext,
		Salience:           entry.Metadata.Salience,
		ConsolidationState: entry.Metadata.ConsolidationState,
		LearnedTrait:       entry.Metadata.LearnedTrait,
	})
}

func CreateLongTermMemoryLogicalIdentity(input LongTermMemory) LongTermMemoryLogicalIdentity {
	lineage := uniqueSortedStrings(input.ConsolidationState.SourceMemoryIDs)
	label := ""
	if input.LearnedTrait != nil {
		label = input.LearnedTrait.Label
	}
	key := fmt.Sprintf("%s|%s|%s|%s|%s|%s", input.AgentID, input.Category, input.Content, input.Summary, strings.Join(lineage, ","), label)
	return LongTermMemoryLogicalIdentity{
		Version:           SchemaVersion,
		StableMemoryID:    input.MemoryID,
		NodeID:            input.NodeID,
		AgentID:           input.AgentID,
		Category:          input.Category,
		Content:           input.Content,
		Summary:           input.Summary,
		LineageMemoryIDs:  lineage,
		LearnedTraitLabel: label,
		Key:               key,
	}
}

func MatchLongTermMemoryLogicalIdentity(records []LongTermMemory, input LongTermMemory) LongTermMemoryLogicalIdentityMatchResult {
	target := CreateLongTermMemoryLogicalIdentity(input)
	matches := []LongTermMemory{}
	conflicting := []string{}
	for _, record := range records {
		identity := CreateLongTermMemoryLogicalIdentity(record)
		if record.MemoryID == input.MemoryID {
			matches = append(matches, record)
			continue
		}
		if identity.Key == target.Key {
			conflicting = append(conflicting, record.MemoryID)
		}
	}
	switch {
	case len(matches) == 1:
		return LongTermMemoryLogicalIdentityMatchResult{
			Status:          "matched",
			Strategy:        "stable-memory-id",
			LogicalIdentity: target,
			MatchCount:      1,
			MatchedMemoryID: matches[0].MemoryID,
			MatchedNodeID:   matches[0].NodeID,
		}
	case len(conflicting) > 0:
		return LongTermMemoryLogicalIdentityMatchResult{
			Status:               "conflicting-stable-memory-id",
			Strategy:             "logical-identity",
			LogicalIdentity:      target,
			MatchCount:           len(conflicting),
			ConflictingMemoryIDs: uniqueSortedStrings(conflicting),
		}
	default:
		return LongTermMemoryLogicalIdentityMatchResult{
			Status:          "unmatched",
			Strategy:        "logical-identity",
			LogicalIdentity: target,
		}
	}
}

func SerializePromotionSelectionToLongTermMemoryEntry(selection ConsolidationPromotionPlanSelection, memory YoungGenerationMemory) (SerializedLongTermMemoryEntry, error) {
	content := coalesceString(memory.Record.Content, memory.Record.Summary, memory.Record.Detail)
	if memory.Masking.MaskedOriginalContent != nil && content == "" {
		content = memory.Masking.MaskedOriginalContent.Value
	}
	summary := coalesceString(memory.Record.Summary, content)
	entry, err := SerializeLongTermMemoryEntry(LongTermMemory{
		NodeID:     selection.OutputNodeID,
		AgentID:    selection.Candidate.AgentID,
		MemoryID:   selection.OutputMemoryID,
		Category:   MemoryCategorySemantic,
		Content:    content,
		Summary:    summary,
		Confidence: clamp01(selection.Evaluation.PromotionScore),
		Provenance: mergeMaps(memory.Record.Provenance, map[string]any{
			"sourceSelectionId": selection.Candidate.CandidateID,
		}),
		StabilizedAt: selection.Evaluation.EvaluatedAt,
		TemporalContext: OldGenerationTemporalContext{
			FirstObservedAt: selection.Evaluation.EvaluatedAt,
			LastObservedAt:  selection.Evaluation.EvaluatedAt,
			StabilizedAt:    selection.Evaluation.EvaluatedAt,
			ConsolidatedAt:  selection.Evaluation.EvaluatedAt,
		},
		Salience: OldGenerationSalience{
			Signals: map[string]float64{
				"promotionScore": selection.Evaluation.PromotionScore,
			},
		},
		ConsolidationState: OldGenerationConsolidationState{
			Status:          ConsolidationStatusPromoted,
			LastOperation:   ConsolidationOperationPromote,
			PolicyVersion:   selection.Evaluation.PolicyVersion,
			SourceMemoryIDs: []string{memory.Record.MemoryID},
		},
	})
	if err != nil {
		return SerializedLongTermMemoryEntry{}, err
	}
	if entry.Content.MemoryID != memory.Record.MemoryID {
		return SerializedLongTermMemoryEntry{}, fmt.Errorf("canonical memoryId mutation during promotion serialization")
	}
	return entry, nil
}

func RewritePromotionSelectionToLongTermMemoryEntry(selection ConsolidationPromotionPlanSelection, originalMemory YoungGenerationMemory, rewrittenEntry SerializedLongTermMemoryEntry) (SerializedLongTermMemoryEntry, error) {
	if rewrittenEntry.Content.MemoryID != selection.OutputMemoryID || rewrittenEntry.Metadata.AgentID != selection.Candidate.AgentID || rewrittenEntry.Metadata.NodeID != selection.OutputNodeID {
		return SerializedLongTermMemoryEntry{}, fmt.Errorf("canonical id rewrite blocked")
	}
	if rewrittenEntry.Content.MemoryID != originalMemory.Record.MemoryID {
		return SerializedLongTermMemoryEntry{}, fmt.Errorf("source memoryId rewrite blocked")
	}
	return rewrittenEntry, nil
}

func CreateLongTermMemoryPersistenceRecordName(entry SerializedLongTermMemoryEntry) string {
	return fmt.Sprintf("%s.json", entry.Content.MemoryID)
}

func CreateLongTermMemoryPersistenceKey(entry SerializedLongTermMemoryEntry, keyPrefix string) string {
	if keyPrefix == "" {
		keyPrefix = DefaultLongTermMemoryPersistenceKeyPrefix
	}
	return fmt.Sprintf("%s/%s/%s", keyPrefix, urlToken(entry.Metadata.AgentID), CreateLongTermMemoryPersistenceRecordName(entry))
}

func PersistLongTermMemoryEntry(ctx context.Context, request PersistLongTermMemoryEntryRequest) (PersistLongTermMemoryEntryResult, error) {
	if request.Storage == nil {
		return PersistLongTermMemoryEntryResult{}, fmt.Errorf("storage is required")
	}
	authorization, err := EvaluateIdleWindowAuthorization(request.Entry.Metadata.AgentID, request.RuntimePhase, nil, request.TeamIdle)
	if err != nil {
		return PersistLongTermMemoryEntryResult{}, err
	}
	if !authorization.Eligible {
		return PersistLongTermMemoryEntryResult{}, fmt.Errorf("runtime authorization blocked durable persistence: %s", authorization.BlockedReason)
	}
	key := CreateLongTermMemoryPersistenceKey(request.Entry, request.KeyPrefix)
	raw, err := json.MarshalIndent(request.Entry, "", "  ")
	if err != nil {
		return PersistLongTermMemoryEntryResult{}, err
	}
	err = request.Storage.Write(copyContext(ctx), LongTermMemoryStorageWriteRequest{
		Key:         key,
		KeyPrefix:   coalesceString(request.KeyPrefix, DefaultLongTermMemoryPersistenceKeyPrefix),
		RecordName:  CreateLongTermMemoryPersistenceRecordName(request.Entry),
		AgentID:     request.Entry.Metadata.AgentID,
		MemoryID:    request.Entry.Content.MemoryID,
		NodeID:      request.Entry.Metadata.NodeID,
		ContentType: "application/json",
		Value:       string(raw),
		Entry:       request.Entry,
		Overwrite:   true,
	})
	if err != nil {
		return PersistLongTermMemoryEntryResult{}, err
	}
	return PersistLongTermMemoryEntryResult{
		Key:             key,
		RecordName:      CreateLongTermMemoryPersistenceRecordName(request.Entry),
		SerializedEntry: string(raw),
		Entry:           request.Entry,
		Authorization:   authorization,
	}, nil
}
