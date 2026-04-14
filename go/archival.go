package brain

import (
	"encoding/json"
	"fmt"
)

type ArchivalTransitionCandidate struct {
	MemoryID           string               `json:"memoryId"`
	OriginalGeneration string               `json:"originalGeneration"`
	OriginalMemoryKind string               `json:"originalMemoryKind"`
	SourceCollection   string               `json:"sourceCollection"`
	SourceNodeID       string               `json:"sourceNodeId,omitempty"`
	StaleScore         float64              `json:"staleScore"`
	RetentionValue     float64              `json:"retentionValue"`
	RecencyMS          int64                `json:"recencyMs"`
	Reasons            []string             `json:"reasons"`
	Breakdown          StaleMemoryBreakdown `json:"breakdown"`
	Metadata           map[string]any       `json:"metadata,omitempty"`
}

type ArchivalTransitionAppliedMemory struct {
	ArchivalTransitionCandidate
	ArchiveID                    string         `json:"archiveId"`
	ArchivedMemory               ArchivedMemory `json:"archivedMemory"`
	DetachedEdgeCount            int            `json:"detachedEdgeCount"`
	DetachedImportanceEntryCount int            `json:"detachedImportanceEntryCount"`
}

type ArchivalTransitionDeferredCandidate struct {
	ArchivalTransitionCandidate
	DeferredReason string `json:"deferredReason"`
}

type ArchivalTransitionOptions struct {
	Evaluation           StaleMemoryEvaluationResult
	RuntimePhase         any
	ArchivedAt           string
	ArchivedBy           string
	ArchivalReason       string
	ArchivableReasons    []string
	PolicyVersion        string
	TeamIdle             bool
	InactivitySuggestion *IdleWindowSuggestion
	Provenance           map[string]any
}

type ArchivalTransitionResult struct {
	AgentID                  string                                `json:"agentId"`
	SourceEvaluationAt       string                                `json:"sourceEvaluationAt"`
	SourceEvaluationMode     string                                `json:"sourceEvaluationMode"`
	ArchivedAt               string                                `json:"archivedAt"`
	ArchivedBy               string                                `json:"archivedBy"`
	ArchivalReason           string                                `json:"archivalReason"`
	ArchivableReasons        []string                              `json:"archivableReasons"`
	Authorization            IdleWindowAuthorization               `json:"authorization"`
	ArchivableCandidates     []ArchivalTransitionCandidate         `json:"archivableCandidates"`
	ArchivableCandidateCount int                                   `json:"archivableCandidateCount"`
	ArchivedTransitions      []ArchivalTransitionAppliedMemory     `json:"archivedTransitions"`
	ArchivedCount            int                                   `json:"archivedCount"`
	DeferredCandidates       []ArchivalTransitionDeferredCandidate `json:"deferredCandidates"`
	DeferredCount            int                                   `json:"deferredCount"`
	Applied                  bool                                  `json:"applied"`
	NextGraph                MemoryGraph                           `json:"nextGraph"`
}

func ArchiveStaleMemories(graph MemoryGraph, options ArchivalTransitionOptions) (ArchivalTransitionResult, error) {
	authorization, err := EvaluateIdleWindowAuthorization(graph.AgentID, options.RuntimePhase, options.InactivitySuggestion, options.TeamIdle)
	if err != nil {
		return ArchivalTransitionResult{}, err
	}
	archivedAt := coalesceString(options.ArchivedAt, options.Evaluation.EvaluatedAt)
	archivedBy := coalesceString(options.ArchivedBy, "offline-consolidation")
	archivalReason := coalesceString(options.ArchivalReason, "stale-low-value")
	archivableReasons := options.ArchivableReasons
	if len(archivableReasons) == 0 {
		archivableReasons = []string{"stale-recency", "low-access-frequency", "low-retention-value"}
	}
	result := ArchivalTransitionResult{
		AgentID:              graph.AgentID,
		SourceEvaluationAt:   options.Evaluation.EvaluatedAt,
		SourceEvaluationMode: options.Evaluation.EvaluationMode,
		ArchivedAt:           archivedAt,
		ArchivedBy:           archivedBy,
		ArchivalReason:       archivalReason,
		ArchivableReasons:    copyStrings(archivableReasons),
		Authorization:        authorization,
		ArchivableCandidates: []ArchivalTransitionCandidate{},
		ArchivedTransitions:  []ArchivalTransitionAppliedMemory{},
		DeferredCandidates:   []ArchivalTransitionDeferredCandidate{},
		NextGraph:            graph,
	}
	for _, candidate := range options.Evaluation.StaleCandidates {
		sourceCollection := ""
		originalGeneration := NodeKindYoungGeneration
		originalMemoryKind, _ := candidate.Metadata["memoryKind"].(string)
		sourceNodeID := ""
		recordSnapshot := map[string]any{}
		detachedImportanceCount := 0
		detachedEdgeCount := 0
		transitionCandidate := ArchivalTransitionCandidate{
			MemoryID:           candidate.MemoryID,
			OriginalGeneration: originalGeneration,
			OriginalMemoryKind: originalMemoryKind,
			SourceCollection:   sourceCollection,
			SourceNodeID:       sourceNodeID,
			StaleScore:         candidate.StaleScore,
			RetentionValue:     candidate.RetentionValue,
			RecencyMS:          candidate.RecencyMS,
			Reasons:            copyStrings(candidate.Reasons),
			Breakdown:          candidate.Breakdown,
			Metadata:           copyMap(candidate.Metadata),
		}
		if memory, collection := findYoungMemory(graph, originalMemoryKind, candidate.MemoryID); memory != nil {
			transitionCandidate.SourceCollection = collection
			recordSnapshot = mapFromStruct(*memory)
			if !memory.InactiveForRetrieval {
				result.DeferredCandidates = append(result.DeferredCandidates, ArchivalTransitionDeferredCandidate{
					ArchivalTransitionCandidate: transitionCandidate,
					DeferredReason:              "active-set-memory",
				})
				continue
			}
		} else if memory := LookupLongTermMemory(graph, candidate.MemoryID); memory != nil {
			transitionCandidate.OriginalGeneration = NodeKindOldGeneration
			transitionCandidate.OriginalMemoryKind = NodeKindLongTermMemory
			transitionCandidate.SourceCollection = "longTermMemory"
			transitionCandidate.SourceNodeID = memory.NodeID
			recordSnapshot = mapFromStruct(*memory)
		} else {
			result.DeferredCandidates = append(result.DeferredCandidates, ArchivalTransitionDeferredCandidate{
				ArchivalTransitionCandidate: transitionCandidate,
				DeferredReason:              "source-memory-not-found",
			})
			continue
		}
		result.ArchivableCandidates = append(result.ArchivableCandidates, transitionCandidate)
		if !authorization.Eligible {
			result.DeferredCandidates = append(result.DeferredCandidates, ArchivalTransitionDeferredCandidate{
				ArchivalTransitionCandidate: transitionCandidate,
				DeferredReason:              authorization.BlockedReason,
			})
			continue
		}
		archiveID := fmt.Sprintf("archive:%s:%s:%s:%s", transitionCandidate.OriginalGeneration, transitionCandidate.OriginalMemoryKind, candidate.MemoryID, mustNormalizeTimeString(archivedAt))
		archiveNodeID := CreateOldGenerationNodeID(NodeKindArchivedMemory, graph.AgentID, archiveID)
		archivedMemory := ArchivedMemory{
			NodeID:             archiveNodeID,
			ArchiveID:          archiveID,
			AgentID:            graph.AgentID,
			OriginalGeneration: transitionCandidate.OriginalGeneration,
			OriginalMemoryKind: transitionCandidate.OriginalMemoryKind,
			OriginalMemoryID:   candidate.MemoryID,
			OriginalNodeID:     transitionCandidate.SourceNodeID,
			ArchivalReason:     archivalReason,
			ArchivedAt:         mustNormalizeTimeString(archivedAt),
			Snapshot:           recordSnapshot,
			Provenance:         mergeMaps(options.Provenance, map[string]any{"archivedBy": archivedBy}),
			TemporalContext: OldGenerationTemporalContext{
				ConsolidatedAt: mustNormalizeTimeString(archivedAt),
				LastAccessedAt: candidate.LastAccessedAt,
			},
			ConsolidationState: OldGenerationConsolidationState{
				Status:          ConsolidationStatusPreserved,
				LastOperation:   ConsolidationOperationPreserve,
				PolicyVersion:   coalesceString(options.PolicyVersion, SchemaVersion),
				SourceMemoryIDs: []string{candidate.MemoryID},
			},
			RecoveryContext: map[string]any{
				"detachedImportanceEntryCount": detachedImportanceCount,
				"detachedEdgeCount":            detachedEdgeCount,
			},
		}
		nextGraph := result.NextGraph
		nextGraph.OldGeneration.ArchivedMemory = append(nextGraph.OldGeneration.ArchivedMemory, archivedMemory)
		nextGraph.YoungGeneration.WorkingMemory = filterYoungMemory(nextGraph.YoungGeneration.WorkingMemory, candidate.MemoryID)
		nextGraph.YoungGeneration.ShortTermMemory = filterYoungMemory(nextGraph.YoungGeneration.ShortTermMemory, candidate.MemoryID)
		nextGraph.OldGeneration.LongTermMemory = filterLongTermMemory(nextGraph.OldGeneration.LongTermMemory, candidate.MemoryID)
		nextGraph.YoungGeneration.ImportanceIndex, detachedImportanceCount = filterImportanceIndex(nextGraph.YoungGeneration.ImportanceIndex, candidate.MemoryID)
		result.NextGraph = nextGraph
		result.ArchivedTransitions = append(result.ArchivedTransitions, ArchivalTransitionAppliedMemory{
			ArchivalTransitionCandidate:  transitionCandidate,
			ArchiveID:                    archiveID,
			ArchivedMemory:               archivedMemory,
			DetachedEdgeCount:            detachedEdgeCount,
			DetachedImportanceEntryCount: detachedImportanceCount,
		})
	}
	result.ArchivableCandidateCount = len(result.ArchivableCandidates)
	result.ArchivedCount = len(result.ArchivedTransitions)
	result.DeferredCount = len(result.DeferredCandidates)
	result.Applied = authorization.Eligible && result.ArchivedCount > 0
	return result, nil
}

func filterYoungMemory(values []YoungGenerationMemory, memoryID string) []YoungGenerationMemory {
	result := make([]YoungGenerationMemory, 0, len(values))
	for _, value := range values {
		if value.Record.MemoryID != memoryID {
			result = append(result, value)
		}
	}
	return result
}

func filterLongTermMemory(values []LongTermMemory, memoryID string) []LongTermMemory {
	result := make([]LongTermMemory, 0, len(values))
	for _, value := range values {
		if value.MemoryID != memoryID {
			result = append(result, value)
		}
	}
	return result
}

func filterImportanceIndex(values []ImportanceIndexEntry, memoryID string) ([]ImportanceIndexEntry, int) {
	result := make([]ImportanceIndexEntry, 0, len(values))
	detached := 0
	for _, value := range values {
		if value.MemoryID != memoryID {
			result = append(result, value)
		} else {
			detached++
		}
	}
	return result, detached
}

func mapFromStruct(value any) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}
