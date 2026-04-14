package brain

import "fmt"

const (
	DefaultOfflineConsolidationPresetID = "idle-balanced-consolidation"
	StageYoungGenerationTriage          = "young-generation-triage"
	StageYoungGenerationPromotion       = "young-generation-promotion"
	StageOldGenerationReinforcement     = "old-generation-reinforcement"
	StageArchivedMemoryReview           = "archived-memory-review"
	StageLearnedTraitPreservation       = "learned-trait-preservation"
)

var OfflineConsolidationBatchPlanSafeOperations = map[string]string{
	StageYoungGenerationTriage:      "offline-consolidation-young-generation-triage",
	StageYoungGenerationPromotion:   "offline-consolidation-young-generation-promotion",
	StageOldGenerationReinforcement: "offline-consolidation-old-generation-reinforcement",
	StageArchivedMemoryReview:       "offline-consolidation-archived-memory-review",
	StageLearnedTraitPreservation:   "offline-consolidation-learned-trait-preservation",
}

type OfflineConsolidationPlanBuilderPreset struct {
	PresetID                           string   `json:"presetId"`
	Version                            string   `json:"version"`
	DisplayName                        string   `json:"displayName"`
	Description                        string   `json:"description"`
	RuntimeWindow                      string   `json:"runtimeWindow"`
	Intensity                          string   `json:"intensity"`
	GenerationCoverage                 []string `json:"generationCoverage"`
	CandidateSources                   []string `json:"candidateSources"`
	PlanningGoals                      []string `json:"planningGoals"`
	BatchProfileID                     string   `json:"batchProfileId"`
	ContractLayer                      string   `json:"contractLayer"`
	OutputPlanAPI                      string   `json:"outputPlanApi"`
	AuthorizationModel                 string   `json:"authorizationModel"`
	HeuristicsPolicy                   string   `json:"heuristicsPolicy"`
	TeamCoordinationPolicy             string   `json:"teamCoordinationPolicy"`
	Scope                              string   `json:"scope"`
	ImmutableIdentityPolicy            string   `json:"immutableIdentityPolicy"`
	LearnedTraitPolicy                 string   `json:"learnedTraitPolicy"`
	AllowIdentityPromotion             bool     `json:"allowIdentityPromotion"`
	WorkingLoopIsolation               string   `json:"workingLoopIsolation"`
	NumericThroughputBenchmarkRequired bool     `json:"numericThroughputBenchmarkRequired"`
	Notes                              string   `json:"notes,omitempty"`
}

type OfflineConsolidationPlanBuilderPresetCatalog struct {
	CatalogID       string                                           `json:"catalogId"`
	Version         string                                           `json:"version"`
	DefaultPresetID string                                           `json:"defaultPresetId"`
	PresetIDs       []string                                         `json:"presetIds"`
	Presets         map[string]OfflineConsolidationPlanBuilderPreset `json:"presets"`
}

type OfflineConsolidationPlanBuilderRequest struct {
	RequestID            string                                `json:"requestId"`
	Version              string                                `json:"version"`
	AgentID              string                                `json:"agentId"`
	PresetCatalogID      string                                `json:"presetCatalogId"`
	PresetID             string                                `json:"presetId"`
	PresetVersion        string                                `json:"presetVersion"`
	Preset               OfflineConsolidationPlanBuilderPreset `json:"preset"`
	RuntimeWindow        string                                `json:"runtimeWindow"`
	RuntimePhase         *RuntimePhase                         `json:"runtimePhase,omitempty"`
	InactivitySuggestion *IdleWindowSuggestion                 `json:"inactivitySuggestion,omitempty"`
	TeamIdle             bool                                  `json:"teamIdle"`
	CoordinationHint     string                                `json:"coordinationHint"`
	PriorityMemoryIDs    []string                              `json:"priorityMemoryIds"`
	BatchProfileID       string                                `json:"batchProfileId"`
}

type OfflineConsolidationBatchPlanRequestRejection struct {
	Stage         string `json:"stage"`
	ReasonCode    string `json:"reasonCode"`
	BlockedReason string `json:"blockedReason,omitempty"`
	Message       string `json:"message"`
	RequestID     string `json:"requestId,omitempty"`
	AgentID       string `json:"agentId,omitempty"`
	PlanID        string `json:"planId,omitempty"`
	RuntimeWindow string `json:"runtimeWindow,omitempty"`
}

type OfflineConsolidationBatchPlanRequestResult struct {
	Status        string                                         `json:"status"`
	SafeToExecute bool                                           `json:"safeToExecute"`
	Request       *OfflineConsolidationPlanBuilderRequest        `json:"request,omitempty"`
	Plan          *OfflineBatchPlan                              `json:"plan,omitempty"`
	Rejection     *OfflineConsolidationBatchPlanRequestRejection `json:"rejection,omitempty"`
}

func defaultPresetCatalog() OfflineConsolidationPlanBuilderPresetCatalog {
	presets := []OfflineConsolidationPlanBuilderPreset{
		{
			PresetID:           "idle-young-triage",
			Version:            SchemaVersion,
			DisplayName:        "Idle Young Triage",
			Description:        "Mask and triage young-generation memory during caller-authorized idle windows.",
			RuntimeWindow:      "idle",
			Intensity:          "conservative",
			GenerationCoverage: []string{"young"},
			CandidateSources:   []string{"young-working-memory", "young-short-term-memory"},
			PlanningGoals:      []string{"mask-stale-young-memory"},
			BatchProfileID:     "b200-style",
		},
		{
			PresetID:           DefaultOfflineConsolidationPresetID,
			Version:            SchemaVersion,
			DisplayName:        "Idle Balanced Consolidation",
			Description:        "Perform young-generation triage, promotion, and reinforcement in idle/rest/break windows.",
			RuntimeWindow:      "idle",
			Intensity:          "balanced",
			GenerationCoverage: []string{"young", "old"},
			CandidateSources:   []string{"young-working-memory", "young-short-term-memory", "old-long-term-memory"},
			PlanningGoals:      []string{"mask-stale-young-memory", "promote-stable-young-memory", "reinforce-old-memory"},
			BatchProfileID:     "b200-style",
		},
		{
			PresetID:           "sleep-extended-maintenance",
			Version:            SchemaVersion,
			DisplayName:        "Sleep Extended Maintenance",
			Description:        "Run the full consolidation and archive maintenance flow during sleep windows.",
			RuntimeWindow:      "sleep",
			Intensity:          "extended",
			GenerationCoverage: []string{"young", "old"},
			CandidateSources:   []string{"young-working-memory", "young-short-term-memory", "old-long-term-memory", "old-archived-memory"},
			PlanningGoals:      []string{"mask-stale-young-memory", "archive-stale-memory", "promote-stable-young-memory", "reinforce-old-memory", "review-superseded-memory", "preserve-learned-traits"},
			BatchProfileID:     "b200-style",
		},
		{
			PresetID:           "learned-trait-only",
			Version:            SchemaVersion,
			DisplayName:        "Learned Trait Preservation",
			Description:        "Preserve learned traits during offline maintenance without identity promotion.",
			RuntimeWindow:      "sleep",
			Intensity:          "conservative",
			GenerationCoverage: []string{"old"},
			CandidateSources:   []string{"old-long-term-memory"},
			PlanningGoals:      []string{"preserve-learned-traits"},
			BatchProfileID:     "b200-style",
		},
	}
	catalog := OfflineConsolidationPlanBuilderPresetCatalog{
		CatalogID:       "default-offline-consolidation-preset-catalog",
		Version:         SchemaVersion,
		DefaultPresetID: DefaultOfflineConsolidationPresetID,
		PresetIDs:       []string{},
		Presets:         map[string]OfflineConsolidationPlanBuilderPreset{},
	}
	for _, preset := range presets {
		preset.ContractLayer = "plan-builder"
		preset.OutputPlanAPI = "offline-batch-plan"
		preset.AuthorizationModel = "runtime-phase-only"
		preset.HeuristicsPolicy = "suggest-only"
		preset.TeamCoordinationPolicy = "batch-only"
		preset.Scope = "agent-scoped"
		preset.ImmutableIdentityPolicy = "runtime-invariants-only"
		preset.LearnedTraitPolicy = "long-term-memory-only"
		preset.WorkingLoopIsolation = "offline-decoupled"
		catalog.Presets[preset.PresetID] = preset
		catalog.PresetIDs = append(catalog.PresetIDs, preset.PresetID)
	}
	return catalog
}

func ResolveOfflineConsolidationPlanBuilderPreset(presetID string, catalog *OfflineConsolidationPlanBuilderPresetCatalog) (OfflineConsolidationPlanBuilderPreset, error) {
	activeCatalog := defaultPresetCatalog()
	if catalog != nil {
		activeCatalog = *catalog
	}
	if presetID == "" {
		presetID = activeCatalog.DefaultPresetID
	}
	preset, ok := activeCatalog.Presets[presetID]
	if !ok {
		return OfflineConsolidationPlanBuilderPreset{}, fmt.Errorf("unknown offline consolidation presetId: %s", presetID)
	}
	return preset, nil
}

func CreateOfflineConsolidationPlanBuilderRequest(requestID string, agentID string, presetID string, runtimePhase any, inactivitySuggestion *IdleWindowSuggestion, teamIdle bool, priorityMemoryIDs []string, catalog *OfflineConsolidationPlanBuilderPresetCatalog) (OfflineConsolidationPlanBuilderRequest, error) {
	normalizedRequestID, err := normalizeRequiredString(requestID, "requestId")
	if err != nil {
		return OfflineConsolidationPlanBuilderRequest{}, err
	}
	normalizedAgentID, err := normalizeRequiredString(agentID, "agentId")
	if err != nil {
		return OfflineConsolidationPlanBuilderRequest{}, err
	}
	preset, err := ResolveOfflineConsolidationPlanBuilderPreset(presetID, catalog)
	if err != nil {
		return OfflineConsolidationPlanBuilderRequest{}, err
	}
	normalizedRuntimePhase, err := normalizeRuntimePhaseInput(runtimePhase)
	if err != nil {
		return OfflineConsolidationPlanBuilderRequest{}, err
	}
	if preset.RuntimeWindow == "sleep" && (normalizedRuntimePhase == nil || normalizedRuntimePhase.Value != "sleep") {
		return OfflineConsolidationPlanBuilderRequest{}, fmt.Errorf("sleep presets require runtimePhase sleep")
	}
	return OfflineConsolidationPlanBuilderRequest{
		RequestID:            normalizedRequestID,
		Version:              SchemaVersion,
		AgentID:              normalizedAgentID,
		PresetCatalogID:      coalesceString(defaultPresetCatalog().CatalogID, "default-offline-consolidation-preset-catalog"),
		PresetID:             preset.PresetID,
		PresetVersion:        preset.Version,
		Preset:               preset,
		RuntimeWindow:        preset.RuntimeWindow,
		RuntimePhase:         normalizedRuntimePhase,
		InactivitySuggestion: inactivitySuggestion,
		TeamIdle:             teamIdle,
		CoordinationHint:     map[bool]string{true: "team-idle", false: "independent"}[teamIdle],
		PriorityMemoryIDs:    uniqueSortedStrings(priorityMemoryIDs),
		BatchProfileID:       preset.BatchProfileID,
	}, nil
}

func stageIDsForPreset(presetID string) []string {
	switch presetID {
	case "idle-young-triage":
		return []string{StageYoungGenerationTriage}
	case "sleep-extended-maintenance":
		return []string{
			StageYoungGenerationTriage,
			StageYoungGenerationPromotion,
			StageOldGenerationReinforcement,
			StageArchivedMemoryReview,
			StageLearnedTraitPreservation,
		}
	case "learned-trait-only":
		return []string{StageLearnedTraitPreservation}
	default:
		return []string{
			StageYoungGenerationTriage,
			StageYoungGenerationPromotion,
			StageOldGenerationReinforcement,
		}
	}
}

func BuildOfflineConsolidationBatchPlan(request OfflineConsolidationPlanBuilderRequest, planID string, batchLimit *OfflineBatchLimit) (OfflineBatchPlan, error) {
	limit := DefaultB200OfflineBatchLimit
	if batchLimit != nil {
		limit = *batchLimit
	}
	workUnits := []OfflineBatchWorkUnit{}
	stageIDs := stageIDsForPreset(request.PresetID)
	for sequence, stageID := range stageIDs {
		unit, err := CreateOfflineBatchWorkUnit(OfflineBatchWorkUnit{
			WorkUnitID:         fmt.Sprintf("%s/%s", coalesceString(planID, request.RequestID), stageID),
			AgentID:            request.AgentID,
			Operation:          OfflineConsolidationBatchPlanSafeOperations[stageID],
			CoordinationSignal: request.CoordinationHint,
			RuntimePhase:       request.RuntimePhase.Value,
			Order: OfflineBatchWorkOrder{
				Priority: len(stageIDs) - sequence,
				Sequence: sequence,
				SortKey:  fmt.Sprintf("%02d:%s", sequence, stageID),
			},
			Metadata: map[string]any{
				"requestId":         request.RequestID,
				"presetId":          request.PresetID,
				"runtimeWindow":     request.RuntimeWindow,
				"stageId":           stageID,
				"priorityMemoryIds": request.PriorityMemoryIDs,
			},
			OverwriteTargets: []string{
				fmt.Sprintf("agent:%s:stage:%s", request.AgentID, stageID),
			},
		})
		if err != nil {
			return OfflineBatchPlan{}, err
		}
		workUnits = append(workUnits, unit)
	}
	return CreateOfflineBatchPlan(OfflineBatchPlan{
		PlanID:             coalesceString(planID, fmt.Sprintf("%s-plan", request.RequestID)),
		CoordinationSignal: request.CoordinationHint,
		Limit:              limit,
		WorkUnits:          workUnits,
		Metadata: map[string]any{
			"requestId":      request.RequestID,
			"presetId":       request.PresetID,
			"runtimeWindow":  request.RuntimeWindow,
			"batchProfileId": request.BatchProfileID,
		},
	})
}

func ValidateOfflineConsolidationBatchPlan(plan OfflineBatchPlan) error {
	if !plan.RequiresRuntimeAuthorization || plan.HeuristicsAuthorizeExecution {
		return fmt.Errorf("offline consolidation batch plan must remain runtime authorized and heuristic blocked")
	}
	for _, unit := range plan.WorkUnits {
		if unit.Operation == "" {
			return fmt.Errorf("work unit operation is required")
		}
	}
	return nil
}

func RequestOfflineConsolidationBatchPlan(requestID string, agentID string, presetID string, runtimePhase any, inactivitySuggestion *IdleWindowSuggestion, teamIdle bool, priorityMemoryIDs []string, batchLimit *OfflineBatchLimit) OfflineConsolidationBatchPlanRequestResult {
	request, err := CreateOfflineConsolidationPlanBuilderRequest(requestID, agentID, presetID, runtimePhase, inactivitySuggestion, teamIdle, priorityMemoryIDs, nil)
	if err != nil {
		return OfflineConsolidationBatchPlanRequestResult{
			Status:        "rejected",
			SafeToExecute: false,
			Rejection: &OfflineConsolidationBatchPlanRequestRejection{
				Stage:      "request-validation",
				ReasonCode: "invalid-request",
				Message:    err.Error(),
				RequestID:  requestID,
				AgentID:    agentID,
			},
		}
	}
	authorization, authErr := EvaluateIdleWindowAuthorization(agentID, request.RuntimePhase, request.InactivitySuggestion, teamIdle)
	if authErr != nil || !authorization.Eligible {
		blockedReason := ""
		if authErr != nil {
			blockedReason = authErr.Error()
		} else {
			blockedReason = authorization.BlockedReason
		}
		return OfflineConsolidationBatchPlanRequestResult{
			Status:        "rejected",
			SafeToExecute: false,
			Request:       &request,
			Rejection: &OfflineConsolidationBatchPlanRequestRejection{
				Stage:         "runtime-authorization",
				ReasonCode:    "runtime-window-blocked",
				BlockedReason: blockedReason,
				Message:       "runtime authorization blocked offline consolidation plan generation",
				RequestID:     request.RequestID,
				AgentID:       request.AgentID,
				RuntimeWindow: request.RuntimeWindow,
			},
		}
	}
	plan, err := BuildOfflineConsolidationBatchPlan(request, "", batchLimit)
	if err != nil {
		return OfflineConsolidationBatchPlanRequestResult{
			Status:        "rejected",
			SafeToExecute: false,
			Request:       &request,
			Rejection: &OfflineConsolidationBatchPlanRequestRejection{
				Stage:      "plan-translation",
				ReasonCode: "plan-build-failed",
				Message:    err.Error(),
				RequestID:  request.RequestID,
				AgentID:    request.AgentID,
			},
		}
	}
	if err := ValidateOfflineConsolidationBatchPlan(plan); err != nil {
		return OfflineConsolidationBatchPlanRequestResult{
			Status:        "rejected",
			SafeToExecute: false,
			Request:       &request,
			Rejection: &OfflineConsolidationBatchPlanRequestRejection{
				Stage:      "plan-validation",
				ReasonCode: "invalid-output-plan",
				Message:    err.Error(),
				RequestID:  request.RequestID,
				AgentID:    request.AgentID,
				PlanID:     plan.PlanID,
			},
		}
	}
	return OfflineConsolidationBatchPlanRequestResult{
		Status:        "validated",
		SafeToExecute: true,
		Request:       &request,
		Plan:          &plan,
	}
}
