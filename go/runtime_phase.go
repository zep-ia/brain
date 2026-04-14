package brain

import "fmt"

var AuthorizedIdlePhases = []string{"idle", "rest", "break", "sleep"}

type RuntimePhase struct {
	Value     string `json:"value"`
	Authority string `json:"authority"`
	ChangedAt string `json:"changedAt,omitempty"`
	Note      string `json:"note,omitempty"`
}

type IdleWindowSuggestion struct {
	Source                  string `json:"source"`
	SuggestedPhase          string `json:"suggestedPhase"`
	InactivityMS            int64  `json:"inactivityMs"`
	IdleThresholdMS         int64  `json:"idleThresholdMs,omitempty"`
	ThresholdReached        bool   `json:"thresholdReached"`
	AuthorizesConsolidation bool   `json:"authorizesConsolidation"`
	Note                    string `json:"note,omitempty"`
}

type IdleWindowAuthorization struct {
	AgentID                  string                `json:"agentId"`
	RuntimePhase             *RuntimePhase         `json:"runtimePhase,omitempty"`
	InactivitySuggestion     *IdleWindowSuggestion `json:"inactivitySuggestion,omitempty"`
	TeamIdle                 bool                  `json:"teamIdle"`
	Eligible                 bool                  `json:"eligible"`
	OpensConsolidation       bool                  `json:"opensConsolidation"`
	DecisionSource           string                `json:"decisionSource,omitempty"`
	BlockedReason            string                `json:"blockedReason,omitempty"`
	RequiresOfflineExecution bool                  `json:"requiresOfflineExecution"`
}

type IdleWindowPlanAgent struct {
	AgentID              string
	RuntimePhase         any
	InactivitySuggestion *IdleWindowSuggestion
}

type IdleWindowConsolidationPlan struct {
	TeamIdle        bool                      `json:"teamIdle"`
	WindowAuthority string                    `json:"windowAuthority"`
	EligibleAgents  []IdleWindowAuthorization `json:"eligibleAgents"`
	BlockedAgents   []IdleWindowAuthorization `json:"blockedAgents"`
	EligibleCount   int                       `json:"eligibleCount"`
	BlockedCount    int                       `json:"blockedCount"`
	BatchWindowOpen bool                      `json:"batchWindowOpen"`
}

func CreateRuntimePhase(value string, authority string, changedAt string, note string) (RuntimePhase, error) {
	normalizedValue, err := normalizeToken(value, "runtime phase")
	if err != nil {
		return RuntimePhase{}, err
	}
	if authority == "" {
		authority = "caller"
	}
	normalizedAuthority, err := normalizeToken(authority, "runtime phase authority")
	if err != nil {
		return RuntimePhase{}, err
	}
	normalizedChangedAt, err := normalizeTimeString(changedAt)
	if err != nil {
		return RuntimePhase{}, fmt.Errorf("changedAt must be RFC3339: %w", err)
	}
	return RuntimePhase{
		Value:     normalizedValue,
		Authority: normalizedAuthority,
		ChangedAt: normalizedChangedAt,
		Note:      normalizeOptionalString(note),
	}, nil
}

func CreateIdleWindowSuggestion(source string, suggestedPhase string, inactivityMS int64, idleThresholdMS int64, note string) (IdleWindowSuggestion, error) {
	if source == "" {
		source = "runtime-inactivity-heuristic"
	}
	normalizedSource, err := normalizeToken(source, "idle window suggestion source")
	if err != nil {
		return IdleWindowSuggestion{}, err
	}
	if suggestedPhase == "" {
		suggestedPhase = "idle"
	}
	normalizedPhase, err := normalizeToken(suggestedPhase, "idle window suggestion phase")
	if err != nil {
		return IdleWindowSuggestion{}, err
	}
	if inactivityMS < 0 || idleThresholdMS < 0 {
		return IdleWindowSuggestion{}, fmt.Errorf("idle window timing must be non-negative")
	}
	return IdleWindowSuggestion{
		Source:                  normalizedSource,
		SuggestedPhase:          normalizedPhase,
		InactivityMS:            inactivityMS,
		IdleThresholdMS:         idleThresholdMS,
		ThresholdReached:        idleThresholdMS == 0 || inactivityMS >= idleThresholdMS,
		AuthorizesConsolidation: false,
		Note:                    normalizeOptionalString(note),
	}, nil
}

func normalizeRuntimePhaseInput(input any) (*RuntimePhase, error) {
	switch value := input.(type) {
	case nil:
		return nil, nil
	case RuntimePhase:
		copied := value
		return &copied, nil
	case *RuntimePhase:
		if value == nil {
			return nil, nil
		}
		copied := *value
		return &copied, nil
	case string:
		created, err := CreateRuntimePhase(value, "caller", "", "")
		if err != nil {
			return nil, err
		}
		return &created, nil
	default:
		return nil, fmt.Errorf("unsupported runtime phase input %T", input)
	}
}

func evaluateBlockedReason(runtimePhase *RuntimePhase) string {
	if runtimePhase == nil {
		return "missing-runtime-phase"
	}
	if runtimePhase.Authority != "caller" {
		return "runtime-phase-not-caller-controlled"
	}
	if !containsString(AuthorizedIdlePhases, runtimePhase.Value) {
		return "runtime-phase-not-idle-window"
	}
	return ""
}

func EvaluateIdleWindowAuthorization(agentID string, runtimePhase any, inactivitySuggestion *IdleWindowSuggestion, teamIdle bool) (IdleWindowAuthorization, error) {
	normalizedAgentID, err := normalizeRequiredString(agentID, "agentId")
	if err != nil {
		return IdleWindowAuthorization{}, err
	}
	normalizedPhase, err := normalizeRuntimePhaseInput(runtimePhase)
	if err != nil {
		return IdleWindowAuthorization{}, err
	}
	blockedReason := evaluateBlockedReason(normalizedPhase)
	eligible := blockedReason == ""
	return IdleWindowAuthorization{
		AgentID:                  normalizedAgentID,
		RuntimePhase:             normalizedPhase,
		InactivitySuggestion:     inactivitySuggestion,
		TeamIdle:                 teamIdle,
		Eligible:                 eligible,
		OpensConsolidation:       eligible,
		DecisionSource:           map[bool]string{true: "runtime-phase", false: ""}[eligible],
		BlockedReason:            blockedReason,
		RequiresOfflineExecution: true,
	}, nil
}

func PlanIdleWindowConsolidation(teamIdle bool, agents []IdleWindowPlanAgent) (IdleWindowConsolidationPlan, error) {
	plan := IdleWindowConsolidationPlan{
		TeamIdle:        teamIdle,
		WindowAuthority: "runtime-phase",
		EligibleAgents:  []IdleWindowAuthorization{},
		BlockedAgents:   []IdleWindowAuthorization{},
	}
	for _, agent := range agents {
		decision, err := EvaluateIdleWindowAuthorization(agent.AgentID, agent.RuntimePhase, agent.InactivitySuggestion, teamIdle)
		if err != nil {
			return IdleWindowConsolidationPlan{}, err
		}
		if decision.Eligible {
			plan.EligibleAgents = append(plan.EligibleAgents, decision)
		} else {
			plan.BlockedAgents = append(plan.BlockedAgents, decision)
		}
	}
	plan.EligibleCount = len(plan.EligibleAgents)
	plan.BlockedCount = len(plan.BlockedAgents)
	plan.BatchWindowOpen = plan.EligibleCount > 0
	return plan, nil
}
