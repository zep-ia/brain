package brain

import (
	"fmt"
	"strings"
)

type TeamIdleIdentityScope struct {
	AgentID string `json:"agentId"`
	Persona string `json:"persona,omitempty"`
	Role    string `json:"role,omitempty"`
}

type TeamIdleOverwriteTarget struct {
	Scope    string `json:"scope"`
	TargetID string `json:"targetId"`
	AgentID  string `json:"agentId"`
}

type TeamIdleConsolidationAgentInput struct {
	AgentID              string
	RuntimePhase         any
	InactivitySuggestion *IdleWindowSuggestion
	IdentityScope        *TeamIdleIdentityScope
	OverwriteTargets     []TeamIdleOverwriteTarget
}

type TeamIdleConsolidationAgentPlan struct {
	AgentID                   string                    `json:"agentId"`
	Authorization             IdleWindowAuthorization   `json:"authorization"`
	IdentityScope             TeamIdleIdentityScope     `json:"identityScope"`
	IdentityIsolationKey      string                    `json:"identityIsolationKey"`
	SharedIdentity            bool                      `json:"sharedIdentity"`
	OverwriteNamespace        string                    `json:"overwriteNamespace"`
	OverwriteTargets          []TeamIdleOverwriteTarget `json:"overwriteTargets"`
	SafetyViolations          []string                  `json:"safetyViolations"`
	BatchEligible             bool                      `json:"batchEligible"`
	BlockedReason             string                    `json:"blockedReason,omitempty"`
	RequiresIndependentWrites bool                      `json:"requiresIndependentWrites"`
}

type TeamIdleConsolidationBatchGroup struct {
	BatchID            string                           `json:"batchId"`
	CoordinationSignal string                           `json:"coordinationSignal"`
	ExecutionMode      string                           `json:"executionMode"`
	IsolationMode      string                           `json:"isolationMode"`
	WriteIsolationMode string                           `json:"writeIsolationMode"`
	AgentIDs           []string                         `json:"agentIds"`
	Agents             []TeamIdleConsolidationAgentPlan `json:"agents"`
	BatchPlan          OfflineBatchPlan                 `json:"batchPlan"`
}

type TeamIdleConsolidationBatchPlan struct {
	TeamIdle           bool                              `json:"teamIdle"`
	CoordinationSignal string                            `json:"coordinationSignal"`
	WindowAuthority    string                            `json:"windowAuthority"`
	DefaultBatchLimit  OfflineBatchLimit                 `json:"defaultBatchLimit"`
	EligibleAgents     []TeamIdleConsolidationAgentPlan  `json:"eligibleAgents"`
	BlockedAgents      []TeamIdleConsolidationAgentPlan  `json:"blockedAgents"`
	EligibleCount      int                               `json:"eligibleCount"`
	BlockedCount       int                               `json:"blockedCount"`
	BatchWindowOpen    bool                              `json:"batchWindowOpen"`
	BatchCount         int                               `json:"batchCount"`
	Batches            []TeamIdleConsolidationBatchGroup `json:"batches"`
}

func PlanTeamIdleConsolidationBatch(teamIdle bool, agents []TeamIdleConsolidationAgentInput, batchLimit *OfflineBatchLimit) (TeamIdleConsolidationBatchPlan, error) {
	defaultLimit := DefaultB200OfflineBatchLimit
	if batchLimit != nil {
		defaultLimit = *batchLimit
	}
	result := TeamIdleConsolidationBatchPlan{
		TeamIdle:           teamIdle,
		CoordinationSignal: map[bool]string{true: "team-idle", false: "independent"}[teamIdle],
		WindowAuthority:    "runtime-phase",
		DefaultBatchLimit:  defaultLimit,
		EligibleAgents:     []TeamIdleConsolidationAgentPlan{},
		BlockedAgents:      []TeamIdleConsolidationAgentPlan{},
		Batches:            []TeamIdleConsolidationBatchGroup{},
	}
	seenAgents := map[string]struct{}{}
	for _, agent := range agents {
		authorization, err := EvaluateIdleWindowAuthorization(agent.AgentID, agent.RuntimePhase, agent.InactivitySuggestion, teamIdle)
		if err != nil {
			return TeamIdleConsolidationBatchPlan{}, err
		}
		identityScope := TeamIdleIdentityScope{AgentID: agent.AgentID}
		if agent.IdentityScope != nil {
			identityScope = *agent.IdentityScope
			if identityScope.AgentID == "" {
				identityScope.AgentID = agent.AgentID
			}
		}
		violations := []string{}
		if identityScope.AgentID != agent.AgentID {
			violations = append(violations, "shared-identity-scope")
		}
		if _, exists := seenAgents[agent.AgentID]; exists {
			violations = append(violations, "duplicate-agent-batch-entry")
		}
		seenAgents[agent.AgentID] = struct{}{}
		overwriteTargets := []TeamIdleOverwriteTarget{}
		for _, target := range agent.OverwriteTargets {
			next := target
			if next.AgentID == "" {
				next.AgentID = agent.AgentID
			}
			if next.AgentID != agent.AgentID {
				violations = append(violations, "cross-agent-overwrite-target")
			}
			overwriteTargets = append(overwriteTargets, next)
		}
		plan := TeamIdleConsolidationAgentPlan{
			AgentID:                   agent.AgentID,
			Authorization:             authorization,
			IdentityScope:             identityScope,
			IdentityIsolationKey:      fmt.Sprintf("agent:%s", agent.AgentID),
			SharedIdentity:            false,
			OverwriteNamespace:        fmt.Sprintf("agent:%s", agent.AgentID),
			OverwriteTargets:          overwriteTargets,
			SafetyViolations:          uniqueSortedStrings(violations),
			BatchEligible:             authorization.Eligible && len(violations) == 0,
			RequiresIndependentWrites: true,
		}
		if !plan.BatchEligible {
			plan.BlockedReason = firstString(plan.SafetyViolations, authorization.BlockedReason)
			result.BlockedAgents = append(result.BlockedAgents, plan)
			continue
		}
		result.EligibleAgents = append(result.EligibleAgents, plan)
	}
	result.EligibleCount = len(result.EligibleAgents)
	result.BlockedCount = len(result.BlockedAgents)
	result.BatchWindowOpen = result.EligibleCount > 0
	if result.EligibleCount > 0 {
		workUnits := []OfflineBatchWorkUnit{}
		batchID := fmt.Sprintf("team-idle-batch-1:%s", strings.Join(agentIDs(result.EligibleAgents), ","))
		for _, plan := range result.EligibleAgents {
			targets := []string{}
			for _, target := range plan.OverwriteTargets {
				targets = append(targets, fmt.Sprintf("%s:%s", target.Scope, target.TargetID))
			}
			unit, err := CreateOfflineBatchWorkUnit(OfflineBatchWorkUnit{
				WorkUnitID:         fmt.Sprintf("%s/agent/%s", batchID, plan.AgentID),
				AgentID:            plan.AgentID,
				CoordinationSignal: result.CoordinationSignal,
				RuntimePhase:       plan.Authorization.RuntimePhase.Value,
				IdentityScopeKey:   plan.IdentityIsolationKey,
				OverwriteNamespace: plan.OverwriteNamespace,
				OverwriteTargets:   targets,
			})
			if err != nil {
				return TeamIdleConsolidationBatchPlan{}, err
			}
			workUnits = append(workUnits, unit)
		}
		batchPlan, err := CreateOfflineBatchPlan(OfflineBatchPlan{
			PlanID:             batchID,
			CoordinationSignal: result.CoordinationSignal,
			Limit:              defaultLimit,
			WorkUnits:          workUnits,
		})
		if err != nil {
			return TeamIdleConsolidationBatchPlan{}, err
		}
		result.Batches = append(result.Batches, TeamIdleConsolidationBatchGroup{
			BatchID:            batchPlan.PlanID,
			CoordinationSignal: result.CoordinationSignal,
			ExecutionMode:      "offline-independent",
			IsolationMode:      "agent-scoped",
			WriteIsolationMode: "agent-scoped",
			AgentIDs:           agentIDs(result.EligibleAgents),
			Agents:             result.EligibleAgents,
			BatchPlan:          batchPlan,
		})
	}
	result.BatchCount = len(result.Batches)
	return result, nil
}

func agentIDs(values []TeamIdleConsolidationAgentPlan) []string {
	ids := make([]string, 0, len(values))
	for _, value := range values {
		ids = append(ids, value.AgentID)
	}
	return ids
}

func firstString(values []string, fallback string) string {
	if len(values) > 0 {
		return values[0]
	}
	return fallback
}
