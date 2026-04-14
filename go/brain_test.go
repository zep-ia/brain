package brain

import (
	"context"
	"strings"
	"testing"
)

func testIdentity() ImmutableIdentity {
	return ImmutableIdentity{
		AgentID:                  "agent-007",
		Persona:                  "deliberate analyst",
		Role:                     "researcher",
		DurableMission:           "Protect user context quality.",
		SafetyConstraints:        []string{"never overwrite identity"},
		Ownership:                []string{"customer-insight-domain"},
		NonNegotiablePreferences: []string{"preserve provenance"},
		RuntimeInvariants: map[string]any{
			"tenant": "zep",
		},
		ProtectedCoreFacts: []string{"agent-007 belongs to tenant zep"},
	}
}

func testGraph(t *testing.T) MemoryGraph {
	t.Helper()
	graph, err := CreateMemoryGraph(testIdentity(), MemoryGraphOptions{
		WorkingMemory: []YoungGenerationMemory{
			{
				Record: MemoryRecord{
					MemoryID: "wm-active",
					Content:  "Draft the rollout plan before noon.",
				},
			},
			{
				Record: MemoryRecord{
					MemoryID: "wm-masked",
					Content:  "Preserve this masked insight for offline review.",
				},
				InactiveForRetrieval: true,
				Masking: YoungGenerationMaskingMetadata{
					MaskedAt: "2026-04-12T10:00:00Z",
					MaskedBy: "offline-consolidation",
					Reason:   "stale-window",
				},
				Lifecycle: YoungGenerationMemoryLifecycle{
					State:          YoungLifecycleInactive,
					InactiveAt:     "2026-04-12T10:00:00Z",
					InactiveReason: "stale-window",
				},
			},
		},
		ShortTermMemory: []YoungGenerationMemory{
			{
				Record: MemoryRecord{
					MemoryID: "stm-hidden",
					Summary:  "Original summary retained for offline consolidation.",
				},
				InactiveForRetrieval: true,
				Masking: YoungGenerationMaskingMetadata{
					MaskedAt: "2026-04-12T10:00:00Z",
					MaskedBy: "offline-consolidation",
					Reason:   "stale-window",
				},
				Lifecycle: YoungGenerationMemoryLifecycle{
					State:          YoungLifecycleInactive,
					InactiveAt:     "2026-04-12T10:00:00Z",
					InactiveReason: "stale-window",
				},
			},
		},
		ImportanceIndex: []ImportanceIndexEntry{
			{
				EntryID:       "importance-wm-active",
				AgentID:       "agent-007",
				MemoryID:      "wm-active",
				MemoryKind:    NodeKindWorkingMemory,
				Signals:       map[string]float64{"taskRelevance": 0.9},
				LastUpdatedAt: "2026-04-12T10:00:00Z",
			},
		},
		LongTermMemory: []LongTermMemory{
			{
				AgentID:      "agent-007",
				MemoryID:     "ltm-policy",
				Category:     MemoryCategorySemantic,
				Content:      "Existing durable rollout policy.",
				Summary:      "Existing durable rollout policy.",
				Confidence:   0.9,
				StabilizedAt: "2026-04-12T09:00:00Z",
			},
		},
		Edges: []OldGenerationEdge{
			{
				AgentID:  "agent-007",
				From:     CreateOldGenerationNodeID(NodeKindLongTermMemory, "agent-007", "ltm-policy"),
				To:       CreateOldGenerationNodeID(NodeKindImmutableIdentity, "agent-007", "self"),
				Relation: RelationMemoryAssociation,
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMemoryGraph failed: %v", err)
	}
	return graph
}

type memoryStorage struct {
	values map[string]string
}

func (m *memoryStorage) Read(ctx context.Context, key string) (string, error) {
	return m.values[key], nil
}

func (m *memoryStorage) Write(ctx context.Context, request LongTermMemoryStorageWriteRequest) error {
	if m.values == nil {
		m.values = map[string]string{}
	}
	m.values[request.Key] = request.Value
	return nil
}

func (m *memoryStorage) List(ctx context.Context, keyPrefix string, agentID string) ([]LongTermMemoryStorageListEntry, error) {
	entries := []LongTermMemoryStorageListEntry{}
	for key, value := range m.values {
		if strings.HasPrefix(key, keyPrefix+"/"+urlToken(agentID)+"/") {
			entries = append(entries, LongTermMemoryStorageListEntry{Key: key, Value: value})
		}
	}
	return entries, nil
}

func TestMemoryGraphViewsAndPersistence(t *testing.T) {
	graph := testGraph(t)

	retrieval := CreateYoungGenerationRetrievalView(graph)
	if len(retrieval.WorkingMemory) != 1 {
		t.Fatalf("expected one retrieval-visible working memory, got %d", len(retrieval.WorkingMemory))
	}
	if len(retrieval.ShortTermMemory) != 0 {
		t.Fatalf("expected hidden short-term memory to be filtered")
	}

	inspection := CreateYoungGenerationInspectionView(graph)
	if inspection.ShortTermMemory[0].Record.Summary == "" {
		t.Fatalf("inspection view should rehydrate masked summary")
	}

	savedYoung := SaveYoungGenerationGraphState(graph)
	shell, err := CreateMemoryGraph(graph.OldGeneration.ImmutableIdentity, MemoryGraphOptions{
		LongTermMemory: graph.OldGeneration.LongTermMemory,
	})
	if err != nil {
		t.Fatal(err)
	}
	restoredYoung, err := LoadYoungGenerationGraphState(shell, savedYoung)
	if err != nil {
		t.Fatal(err)
	}
	if restoredYoung.YoungGeneration.WorkingMemory[0].Record.MemoryID != "wm-active" {
		t.Fatalf("unexpected restored working memory")
	}

	savedOld := SaveOldGenerationGraphState(graph)
	restoredOld, err := LoadOldGenerationGraphState(restoredYoung, savedOld)
	if err != nil {
		t.Fatal(err)
	}
	if LookupLongTermMemory(restoredOld, "ltm-policy") == nil {
		t.Fatalf("expected durable memory after old-generation restore")
	}
}

func TestStaleMemoryAndMasking(t *testing.T) {
	result, err := EvaluateStaleMemories(StaleMemoryEvaluationOptions{
		Now:                      "2026-04-12T12:00:00Z",
		MinimumRecencyMS:         7 * 24 * 60 * 60 * 1000,
		RecencyHorizonMS:         30 * 24 * 60 * 60 * 1000,
		AccessFrequencyCapPerDay: 1,
		StaleThreshold:           0.65,
		Memories: []StaleMemoryInput{
			{
				MemoryID:       "old-cold-low-value",
				CreatedAt:      "2026-02-20T12:00:00Z",
				LastAccessedAt: "2026-03-01T12:00:00Z",
				AccessCount:    0,
				RetentionValue: 0.15,
				Metadata:       map[string]any{"memoryKind": NodeKindShortTermMemory},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.StaleCandidateCount != 1 {
		t.Fatalf("expected one stale candidate")
	}
	masking := CreateStaleMemoryMaskingDecisions(StaleMemoryMaskingDecisionOptions{
		Evaluation: result,
		MaskedAt:   "2026-04-12T12:05:00Z",
		MaskedBy:   "idle-consolidation-suggester",
		Provenance: map[string]any{"runtimePhase": "idle"},
	})
	if masking.MaskedDecisionCount != 1 {
		t.Fatalf("expected one masking decision")
	}
	if !masking.MaskedDecisions[0].InactiveForRetrieval {
		t.Fatalf("expected inactiveForRetrieval to be set")
	}
}

func TestPromotionSerializationAndPersistence(t *testing.T) {
	graph := testGraph(t)
	candidate, err := CreateConsolidationPromotionCandidate(ConsolidationPromotionCandidate{
		CandidateID:      "promo-wm-masked",
		AgentID:          "agent-007",
		SourceMemoryID:   "wm-masked",
		SourceMemoryKind: NodeKindWorkingMemory,
		Signals: struct {
			YoungGeneration ConsolidationGenerationSignalSet `json:"youngGeneration"`
			OldGeneration   ConsolidationGenerationSignalSet `json:"oldGeneration"`
		}{
			YoungGeneration: ConsolidationGenerationSignalSet{
				Importance: &ConsolidationSignalCapture{
					CapturedAt: "2026-04-12T10:10:00Z",
					Signals:    map[string]float64{"taskRelevance": 0.96, "userSpecificity": 0.94},
				},
				Stability: &ConsolidationSignalCapture{
					CapturedAt: "2026-04-12T10:10:00Z",
					Signals:    map[string]float64{"repeatedRecall": 0.95, "crossEpisodeConsistency": 0.93},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanConsolidationPromotions(graph, ConsolidationPromotionPlanOptions{
		Candidates:   []ConsolidationPromotionCandidate{candidate},
		RuntimePhase: "idle",
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.SelectedPromotionCount != 1 {
		t.Fatalf("expected one selected promotion, got %d", plan.SelectedPromotionCount)
	}
	entry, err := SerializePromotionSelectionToLongTermMemoryEntry(plan.SelectedPromotions[0], graph.YoungGeneration.WorkingMemory[1])
	if err != nil {
		t.Fatal(err)
	}
	storage := &memoryStorage{}
	persisted, err := PersistLongTermMemoryEntry(context.Background(), PersistLongTermMemoryEntryRequest{
		Storage:      storage,
		Entry:        entry,
		RuntimePhase: "sleep",
	})
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Key == "" || len(storage.values) != 1 {
		t.Fatalf("expected durable write to occur")
	}
	decoded, err := DeserializeLongTermMemoryEntry(entry)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.MemoryID != "wm-masked" {
		t.Fatalf("expected canonical memory id preservation")
	}
}

func TestArchivalTransition(t *testing.T) {
	graph := testGraph(t)
	evaluation, err := EvaluateStaleMemories(StaleMemoryEvaluationOptions{
		Now:                      "2026-04-13T12:00:00Z",
		MinimumRecencyMS:         6 * 60 * 60 * 1000,
		RecencyHorizonMS:         7 * 24 * 60 * 60 * 1000,
		AccessFrequencyCapPerDay: 1,
		StaleThreshold:           0.65,
		Memories: []StaleMemoryInput{
			{
				MemoryID:       "stm-hidden",
				CreatedAt:      "2026-04-10T12:00:00Z",
				LastAccessedAt: "2026-04-10T12:00:00Z",
				AccessCount:    0,
				RetentionValue: 0.1,
				Metadata:       map[string]any{"memoryKind": NodeKindShortTermMemory},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	archived, err := ArchiveStaleMemories(graph, ArchivalTransitionOptions{
		Evaluation:   evaluation,
		RuntimePhase: "sleep",
		ArchivedAt:   "2026-04-13T12:05:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchivedCount != 1 {
		t.Fatalf("expected one archived memory")
	}
	if LookupArchivedMemory(archived.NextGraph, archived.ArchivedTransitions[0].ArchiveID) == nil {
		t.Fatalf("expected archived memory lookup to succeed")
	}
}

func TestPlanBuilderAndBatchExecution(t *testing.T) {
	request, err := CreateOfflineConsolidationPlanBuilderRequest(
		"request-1",
		"agent-007",
		"sleep-extended-maintenance",
		"sleep",
		nil,
		true,
		[]string{"wm-masked"},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := BuildOfflineConsolidationBatchPlan(request, "plan-1", &OfflineBatchLimit{
		MaxAgentsPerBatch:              1,
		MaxWorkUnitsPerBatch:           2,
		MaxOverwriteTargetsPerBatch:    2,
		MaxOverwriteTargetsPerWorkUnit: 1,
		MaxIdentityScopesPerBatch:      1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.WorkUnits) != 5 {
		t.Fatalf("expected full sleep maintenance stage set")
	}
	schedule, err := ScheduleOfflineBatchExecution(plan)
	if err != nil {
		t.Fatal(err)
	}
	if schedule.SliceCount < 2 {
		t.Fatalf("expected plan slicing under constrained batch limit")
	}
	execution, err := ExecuteOfflineBatchPlan(context.Background(), plan, OfflineBatchExecutionOptions{
		MaxConcurrentWorkUnits: 1,
		DispatchWorkUnit: func(workUnit OfflineBatchWorkUnit, dispatchContext OfflineBatchWorkUnitDispatchContext) (any, error) {
			return map[string]any{"handledWorkUnitId": workUnit.WorkUnitID}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if execution.ExecutedCount != len(plan.WorkUnits) {
		t.Fatalf("expected all work units to execute, got %d", execution.ExecutedCount)
	}
}

func TestTeamIdleBatchAndServiceContract(t *testing.T) {
	batch, err := PlanTeamIdleConsolidationBatch(true, []TeamIdleConsolidationAgentInput{
		{
			AgentID:      "agent-alpha",
			RuntimePhase: "idle",
			OverwriteTargets: []TeamIdleOverwriteTarget{
				{Scope: "long-term-memory", TargetID: "ltm-1"},
			},
		},
		{
			AgentID:      "agent-bravo",
			RuntimePhase: "sleep",
			OverwriteTargets: []TeamIdleOverwriteTarget{
				{Scope: "archived-memory", TargetID: "archive-1"},
			},
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if batch.EligibleCount != 2 || batch.BatchCount != 1 {
		t.Fatalf("expected one team-idle batch with two eligible agents")
	}
	svc := LocalBrainService{}
	auth, err := svc.EvaluateIdleWindow(context.Background(), "agent-alpha", "idle", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if !auth.Eligible {
		t.Fatalf("expected service authorization to allow idle")
	}
}
