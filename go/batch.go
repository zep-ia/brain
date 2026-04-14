package brain

import (
	"context"
	"fmt"
	"sort"
	"sync"
)

type OfflineBatchLimit struct {
	LimitID                            string `json:"limitId"`
	TargetProfile                      string `json:"targetProfile"`
	AcceleratorClass                   string `json:"acceleratorClass"`
	OrderingStrategy                   string `json:"orderingStrategy"`
	MaxAgentsPerBatch                  int    `json:"maxAgentsPerBatch"`
	MaxWorkUnitsPerBatch               int    `json:"maxWorkUnitsPerBatch"`
	MaxOverwriteTargetsPerBatch        int    `json:"maxOverwriteTargetsPerBatch"`
	MaxOverwriteTargetsPerWorkUnit     int    `json:"maxOverwriteTargetsPerWorkUnit"`
	MaxIdentityScopesPerBatch          int    `json:"maxIdentityScopesPerBatch"`
	RequiresRuntimeAuthorization       bool   `json:"requiresRuntimeAuthorization"`
	HeuristicsAuthorizeExecution       bool   `json:"heuristicsAuthorizeExecution"`
	TeamIdleCoordinatesOnly            bool   `json:"teamIdleCoordinatesOnly"`
	IdentityIsolationMode              string `json:"identityIsolationMode"`
	RequiresIndependentWrites          bool   `json:"requiresIndependentWrites"`
	ExecutionMode                      string `json:"executionMode"`
	ExecutorBinding                    string `json:"executorBinding"`
	LiveWorkingLoopCoupling            string `json:"liveWorkingLoopCoupling"`
	NumericThroughputBenchmarkRequired bool   `json:"numericThroughputBenchmarkRequired"`
	Notes                              string `json:"notes,omitempty"`
}

var DefaultB200OfflineBatchLimit = OfflineBatchLimit{
	LimitID:                      "b200-style-offline-batch-limit",
	TargetProfile:                "b200-style",
	AcceleratorClass:             "b200-style",
	OrderingStrategy:             "priority-descending-then-sequence",
	RequiresRuntimeAuthorization: true,
	HeuristicsAuthorizeExecution: false,
	TeamIdleCoordinatesOnly:      true,
	IdentityIsolationMode:        "agent-scoped",
	RequiresIndependentWrites:    true,
	ExecutionMode:                "offline-plan-only",
	ExecutorBinding:              "external",
	LiveWorkingLoopCoupling:      "offline-decoupled",
}

type OfflineBatchWorkUnit struct {
	WorkUnitID                   string                    `json:"workUnitId"`
	BatchID                      string                    `json:"batchId,omitempty"`
	AgentID                      string                    `json:"agentId"`
	Operation                    string                    `json:"operation"`
	CoordinationSignal           string                    `json:"coordinationSignal"`
	ExecutionMode                string                    `json:"executionMode"`
	ExecutorBinding              string                    `json:"executorBinding"`
	LiveWorkingLoopCoupling      string                    `json:"liveWorkingLoopCoupling"`
	IdentityIsolationMode        string                    `json:"identityIsolationMode"`
	IdentityScopeKey             string                    `json:"identityScopeKey"`
	OverwriteNamespace           string                    `json:"overwriteNamespace"`
	OverwriteTargets             []string                  `json:"overwriteTargets"`
	OverwriteTargetCount         int                       `json:"overwriteTargetCount"`
	RuntimePhase                 string                    `json:"runtimePhase,omitempty"`
	Order                        OfflineBatchWorkOrder     `json:"order"`
	CapacityCost                 OfflineBatchCapacityUsage `json:"capacityCost"`
	RequiresRuntimeAuthorization bool                      `json:"requiresRuntimeAuthorization"`
	Metadata                     map[string]any            `json:"metadata,omitempty"`
}

type OfflineBatchWorkOrder struct {
	Priority int    `json:"priority"`
	Sequence int    `json:"sequence"`
	SortKey  string `json:"sortKey"`
}

type OfflineBatchCapacityUsage struct {
	AgentCount                             int `json:"agentCount"`
	WorkUnitCount                          int `json:"workUnitCount"`
	OverwriteTargetCount                   int `json:"overwriteTargetCount"`
	IdentityScopeCount                     int `json:"identityScopeCount"`
	MaxOverwriteTargetsPerWorkUnitObserved int `json:"maxOverwriteTargetsPerWorkUnitObserved"`
}

type OfflineBatchPlan struct {
	PlanID                       string                    `json:"planId"`
	CoordinationSignal           string                    `json:"coordinationSignal"`
	ExecutionMode                string                    `json:"executionMode"`
	ExecutorBinding              string                    `json:"executorBinding"`
	LiveWorkingLoopCoupling      string                    `json:"liveWorkingLoopCoupling"`
	Limit                        OfflineBatchLimit         `json:"limit"`
	WorkUnits                    []OfflineBatchWorkUnit    `json:"workUnits"`
	WorkUnitCount                int                       `json:"workUnitCount"`
	OrderedWorkUnitIDs           []string                  `json:"orderedWorkUnitIds"`
	AgentIDs                     []string                  `json:"agentIds"`
	AgentCount                   int                       `json:"agentCount"`
	CapacityUsage                OfflineBatchCapacityUsage `json:"capacityUsage"`
	CapacityViolations           []string                  `json:"capacityViolations"`
	WithinCapacity               bool                      `json:"withinCapacity"`
	RequiresRuntimeAuthorization bool                      `json:"requiresRuntimeAuthorization"`
	HeuristicsAuthorizeExecution bool                      `json:"heuristicsAuthorizeExecution"`
	Metadata                     map[string]any            `json:"metadata,omitempty"`
}

type OfflineBatchExecutionBlockedWorkUnit struct {
	WorkUnitID         string   `json:"workUnitId"`
	AgentID            string   `json:"agentId"`
	IdentityScopeKey   string   `json:"identityScopeKey"`
	OverwriteNamespace string   `json:"overwriteNamespace"`
	BlockedReason      string   `json:"blockedReason,omitempty"`
	Violations         []string `json:"violations"`
}

type OfflineBatchExecutionSlice struct {
	SliceID   string           `json:"sliceId"`
	Sequence  int              `json:"sequence"`
	BatchPlan OfflineBatchPlan `json:"batchPlan"`
}

type OfflineBatchExecutionSchedule struct {
	PlanID                       string                                 `json:"planId"`
	CoordinationSignal           string                                 `json:"coordinationSignal"`
	ExecutionMode                string                                 `json:"executionMode"`
	ExecutorBinding              string                                 `json:"executorBinding"`
	LiveWorkingLoopCoupling      string                                 `json:"liveWorkingLoopCoupling"`
	SchedulingStrategy           string                                 `json:"schedulingStrategy"`
	Limit                        OfflineBatchLimit                      `json:"limit"`
	SourcePlan                   OfflineBatchPlan                       `json:"sourcePlan"`
	SourcePlanWithinCapacity     bool                                   `json:"sourcePlanWithinCapacity"`
	SourcePlanCapacityViolations []string                               `json:"sourcePlanCapacityViolations"`
	ScheduledWorkUnitIDs         []string                               `json:"scheduledWorkUnitIds"`
	ScheduledWorkUnitCount       int                                    `json:"scheduledWorkUnitCount"`
	BlockedWorkUnits             []OfflineBatchExecutionBlockedWorkUnit `json:"blockedWorkUnits"`
	BlockedWorkUnitCount         int                                    `json:"blockedWorkUnitCount"`
	Slices                       []OfflineBatchExecutionSlice           `json:"slices"`
	SliceCount                   int                                    `json:"sliceCount"`
	Executable                   bool                                   `json:"executable"`
	RequiresRuntimeAuthorization bool                                   `json:"requiresRuntimeAuthorization"`
	HeuristicsAuthorizeExecution bool                                   `json:"heuristicsAuthorizeExecution"`
}

type OfflineBatchExecutionContext struct {
	PlanID             string            `json:"planId"`
	CoordinationSignal string            `json:"coordinationSignal"`
	SchedulingStrategy string            `json:"schedulingStrategy"`
	SliceID            string            `json:"sliceId"`
	SliceSequence      int               `json:"sliceSequence"`
	SlicePlan          OfflineBatchPlan  `json:"slicePlan"`
	Limit              OfflineBatchLimit `json:"limit"`
	AuthorizationMode  string            `json:"authorizationMode"`
}

type OfflineBatchWorkUnitDispatchContext struct {
	OfflineBatchExecutionContext
	RuntimePhase  *RuntimePhase           `json:"runtimePhase,omitempty"`
	Authorization IdleWindowAuthorization `json:"authorization"`
}

type OfflineBatchExecutionOptions struct {
	DispatchWorkUnit       func(workUnit OfflineBatchWorkUnit, dispatchContext OfflineBatchWorkUnitDispatchContext) (any, error)
	ResolveRuntimePhase    func(workUnit OfflineBatchWorkUnit, slice OfflineBatchExecutionSlice, schedule OfflineBatchExecutionSchedule) any
	MaxConcurrentWorkUnits int
}

type OfflineBatchExecutionError struct {
	Name    string `json:"name"`
	Message string `json:"message"`
}

type OfflineBatchWorkUnitExecutionResult struct {
	WorkUnitID        string                      `json:"workUnitId"`
	AgentID           string                      `json:"agentId"`
	SliceID           string                      `json:"sliceId"`
	SliceSequence     int                         `json:"sliceSequence"`
	Status            string                      `json:"status"`
	AuthorizationMode string                      `json:"authorizationMode"`
	RuntimePhase      string                      `json:"runtimePhase,omitempty"`
	Authorization     IdleWindowAuthorization     `json:"authorization"`
	BlockedReason     string                      `json:"blockedReason,omitempty"`
	Output            any                         `json:"output,omitempty"`
	Error             *OfflineBatchExecutionError `json:"error,omitempty"`
}

type OfflineBatchExecutionResult struct {
	PlanID            string                                `json:"planId"`
	Status            string                                `json:"status"`
	AuthorizationMode string                                `json:"authorizationMode"`
	Schedule          OfflineBatchExecutionSchedule         `json:"schedule"`
	Results           []OfflineBatchWorkUnitExecutionResult `json:"results"`
	DispatchedCount   int                                   `json:"dispatchedCount"`
	ExecutedCount     int                                   `json:"executedCount"`
	BlockedCount      int                                   `json:"blockedCount"`
	FailedCount       int                                   `json:"failedCount"`
}

func CreateOfflineBatchLimit(input OfflineBatchLimit) OfflineBatchLimit {
	limit := DefaultB200OfflineBatchLimit
	if input.LimitID != "" {
		limit.LimitID = input.LimitID
	}
	if input.TargetProfile != "" {
		limit.TargetProfile = input.TargetProfile
	}
	if input.AcceleratorClass != "" {
		limit.AcceleratorClass = input.AcceleratorClass
	}
	if input.OrderingStrategy != "" {
		limit.OrderingStrategy = input.OrderingStrategy
	}
	if input.MaxAgentsPerBatch != 0 {
		limit.MaxAgentsPerBatch = input.MaxAgentsPerBatch
	}
	if input.MaxWorkUnitsPerBatch != 0 {
		limit.MaxWorkUnitsPerBatch = input.MaxWorkUnitsPerBatch
	}
	if input.MaxOverwriteTargetsPerBatch != 0 {
		limit.MaxOverwriteTargetsPerBatch = input.MaxOverwriteTargetsPerBatch
	}
	if input.MaxOverwriteTargetsPerWorkUnit != 0 {
		limit.MaxOverwriteTargetsPerWorkUnit = input.MaxOverwriteTargetsPerWorkUnit
	}
	if input.MaxIdentityScopesPerBatch != 0 {
		limit.MaxIdentityScopesPerBatch = input.MaxIdentityScopesPerBatch
	}
	if input.Notes != "" {
		limit.Notes = input.Notes
	}
	return limit
}

func CreateOfflineBatchWorkUnit(input OfflineBatchWorkUnit) (OfflineBatchWorkUnit, error) {
	workUnitID, err := normalizeRequiredString(input.WorkUnitID, "workUnitId")
	if err != nil {
		return OfflineBatchWorkUnit{}, err
	}
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return OfflineBatchWorkUnit{}, err
	}
	runtimePhase := normalizeOptionalString(input.RuntimePhase)
	identityScopeKey := coalesceString(input.IdentityScopeKey, fmt.Sprintf("agent:%s", agentID))
	overwriteNamespace := coalesceString(input.OverwriteNamespace, identityScopeKey)
	overwriteTargets := uniqueSortedStrings(input.OverwriteTargets)
	order := input.Order
	if order.SortKey == "" {
		order.SortKey = fmt.Sprintf("%s:%s", agentID, workUnitID)
	}
	return OfflineBatchWorkUnit{
		WorkUnitID:                   workUnitID,
		BatchID:                      normalizeOptionalString(input.BatchID),
		AgentID:                      agentID,
		Operation:                    coalesceString(input.Operation, "offline-consolidation"),
		CoordinationSignal:           coalesceString(input.CoordinationSignal, "independent"),
		ExecutionMode:                "offline-plan-only",
		ExecutorBinding:              "external",
		LiveWorkingLoopCoupling:      "offline-decoupled",
		IdentityIsolationMode:        "agent-scoped",
		IdentityScopeKey:             identityScopeKey,
		OverwriteNamespace:           overwriteNamespace,
		OverwriteTargets:             overwriteTargets,
		OverwriteTargetCount:         len(overwriteTargets),
		RuntimePhase:                 runtimePhase,
		Order:                        order,
		CapacityCost:                 OfflineBatchCapacityUsage{AgentCount: 1, WorkUnitCount: 1, OverwriteTargetCount: len(overwriteTargets), IdentityScopeCount: 1, MaxOverwriteTargetsPerWorkUnitObserved: len(overwriteTargets)},
		RequiresRuntimeAuthorization: true,
		Metadata:                     copyMap(input.Metadata),
	}, nil
}

func CreateOfflineBatchPlan(input OfflineBatchPlan) (OfflineBatchPlan, error) {
	planID, err := normalizeRequiredString(input.PlanID, "planId")
	if err != nil {
		return OfflineBatchPlan{}, err
	}
	limit := CreateOfflineBatchLimit(input.Limit)
	workUnits := make([]OfflineBatchWorkUnit, 0, len(input.WorkUnits))
	for _, rawUnit := range input.WorkUnits {
		unit, err := CreateOfflineBatchWorkUnit(rawUnit)
		if err != nil {
			return OfflineBatchPlan{}, err
		}
		workUnits = append(workUnits, unit)
	}
	sort.SliceStable(workUnits, func(i, j int) bool {
		if limit.OrderingStrategy == "sequence-only" {
			return workUnits[i].Order.Sequence < workUnits[j].Order.Sequence
		}
		if workUnits[i].Order.Priority == workUnits[j].Order.Priority {
			return workUnits[i].Order.Sequence < workUnits[j].Order.Sequence
		}
		return workUnits[i].Order.Priority > workUnits[j].Order.Priority
	})
	agentIDs := []string{}
	identityScopes := map[string]struct{}{}
	overwriteCount := 0
	maxPerUnit := 0
	orderedIDs := []string{}
	for _, workUnit := range workUnits {
		agentIDs = append(agentIDs, workUnit.AgentID)
		orderedIDs = append(orderedIDs, workUnit.WorkUnitID)
		identityScopes[workUnit.IdentityScopeKey] = struct{}{}
		overwriteCount += workUnit.OverwriteTargetCount
		if workUnit.OverwriteTargetCount > maxPerUnit {
			maxPerUnit = workUnit.OverwriteTargetCount
		}
	}
	agentIDs = uniqueSortedStrings(agentIDs)
	violations := []string{}
	capacityUsage := OfflineBatchCapacityUsage{
		AgentCount:                             len(agentIDs),
		WorkUnitCount:                          len(workUnits),
		OverwriteTargetCount:                   overwriteCount,
		IdentityScopeCount:                     len(identityScopes),
		MaxOverwriteTargetsPerWorkUnitObserved: maxPerUnit,
	}
	if limit.MaxAgentsPerBatch > 0 && capacityUsage.AgentCount > limit.MaxAgentsPerBatch {
		violations = append(violations, "max-agents-per-batch-exceeded")
	}
	if limit.MaxWorkUnitsPerBatch > 0 && capacityUsage.WorkUnitCount > limit.MaxWorkUnitsPerBatch {
		violations = append(violations, "max-work-units-per-batch-exceeded")
	}
	if limit.MaxOverwriteTargetsPerBatch > 0 && capacityUsage.OverwriteTargetCount > limit.MaxOverwriteTargetsPerBatch {
		violations = append(violations, "max-overwrite-targets-per-batch-exceeded")
	}
	if limit.MaxOverwriteTargetsPerWorkUnit > 0 && capacityUsage.MaxOverwriteTargetsPerWorkUnitObserved > limit.MaxOverwriteTargetsPerWorkUnit {
		violations = append(violations, "max-overwrite-targets-per-work-unit-exceeded")
	}
	if limit.MaxIdentityScopesPerBatch > 0 && capacityUsage.IdentityScopeCount > limit.MaxIdentityScopesPerBatch {
		violations = append(violations, "max-identity-scopes-per-batch-exceeded")
	}
	return OfflineBatchPlan{
		PlanID:                       planID,
		CoordinationSignal:           coalesceString(input.CoordinationSignal, "independent"),
		ExecutionMode:                "offline-plan-only",
		ExecutorBinding:              "external",
		LiveWorkingLoopCoupling:      "offline-decoupled",
		Limit:                        limit,
		WorkUnits:                    workUnits,
		WorkUnitCount:                len(workUnits),
		OrderedWorkUnitIDs:           orderedIDs,
		AgentIDs:                     agentIDs,
		AgentCount:                   len(agentIDs),
		CapacityUsage:                capacityUsage,
		CapacityViolations:           uniqueSortedStrings(violations),
		WithinCapacity:               len(violations) == 0,
		RequiresRuntimeAuthorization: true,
		HeuristicsAuthorizeExecution: false,
		Metadata:                     copyMap(input.Metadata),
	}, nil
}

func ScheduleOfflineBatchExecution(plan OfflineBatchPlan) (OfflineBatchExecutionSchedule, error) {
	normalizedPlan, err := CreateOfflineBatchPlan(plan)
	if err != nil {
		return OfflineBatchExecutionSchedule{}, err
	}
	blocked := []OfflineBatchExecutionBlockedWorkUnit{}
	identityOwners := map[string]string{}
	namespaceOwners := map[string]string{}
	for _, unit := range normalizedPlan.WorkUnits {
		violations := []string{}
		if ownerAgentID, exists := identityOwners[unit.IdentityScopeKey]; exists && ownerAgentID != unit.AgentID {
			violations = append(violations, "shared-identity-scope")
		}
		identityOwners[unit.IdentityScopeKey] = unit.AgentID
		if ownerAgentID, exists := namespaceOwners[unit.OverwriteNamespace]; exists && ownerAgentID != unit.AgentID {
			violations = append(violations, "cross-agent-overwrite-target")
		}
		namespaceOwners[unit.OverwriteNamespace] = unit.AgentID
		if normalizedPlan.Limit.MaxOverwriteTargetsPerWorkUnit > 0 && unit.OverwriteTargetCount > normalizedPlan.Limit.MaxOverwriteTargetsPerWorkUnit {
			violations = append(violations, "max-overwrite-targets-per-work-unit-exceeded")
		}
		if len(violations) > 0 {
			blocked = append(blocked, OfflineBatchExecutionBlockedWorkUnit{
				WorkUnitID:         unit.WorkUnitID,
				AgentID:            unit.AgentID,
				IdentityScopeKey:   unit.IdentityScopeKey,
				OverwriteNamespace: unit.OverwriteNamespace,
				BlockedReason:      violations[0],
				Violations:         uniqueSortedStrings(violations),
			})
		}
	}
	schedule := OfflineBatchExecutionSchedule{
		PlanID:                       normalizedPlan.PlanID,
		CoordinationSignal:           normalizedPlan.CoordinationSignal,
		ExecutionMode:                "offline-external-dispatch",
		ExecutorBinding:              "caller-supplied",
		LiveWorkingLoopCoupling:      "offline-decoupled",
		SchedulingStrategy:           "ordered-slice-packing",
		Limit:                        normalizedPlan.Limit,
		SourcePlan:                   normalizedPlan,
		SourcePlanWithinCapacity:     normalizedPlan.WithinCapacity,
		SourcePlanCapacityViolations: copyStrings(normalizedPlan.CapacityViolations),
		ScheduledWorkUnitIDs:         []string{},
		BlockedWorkUnits:             blocked,
		RequiresRuntimeAuthorization: true,
		HeuristicsAuthorizeExecution: false,
	}
	if len(blocked) > 0 {
		schedule.Executable = false
		schedule.BlockedWorkUnitCount = len(blocked)
		return schedule, nil
	}
	currentUnits := []OfflineBatchWorkUnit{}
	currentAgents := map[string]struct{}{}
	currentOverwriteTargets := 0
	currentIdentityScopes := map[string]struct{}{}
	flush := func(sequence int) error {
		if len(currentUnits) == 0 {
			return nil
		}
		slicePlan, err := CreateOfflineBatchPlan(OfflineBatchPlan{
			PlanID:             fmt.Sprintf("%s:slice:%d", normalizedPlan.PlanID, sequence+1),
			CoordinationSignal: normalizedPlan.CoordinationSignal,
			Limit:              normalizedPlan.Limit,
			WorkUnits:          currentUnits,
			Metadata:           mergeMaps(normalizedPlan.Metadata, map[string]any{"sourcePlanId": normalizedPlan.PlanID}),
		})
		if err != nil {
			return err
		}
		schedule.Slices = append(schedule.Slices, OfflineBatchExecutionSlice{
			SliceID:   slicePlan.PlanID,
			Sequence:  sequence,
			BatchPlan: slicePlan,
		})
		currentUnits = []OfflineBatchWorkUnit{}
		currentAgents = map[string]struct{}{}
		currentOverwriteTargets = 0
		currentIdentityScopes = map[string]struct{}{}
		return nil
	}
	sequence := 0
	for _, unit := range normalizedPlan.WorkUnits {
		canFit := true
		if normalizedPlan.Limit.MaxAgentsPerBatch > 0 {
			agentCount := len(currentAgents)
			if _, exists := currentAgents[unit.AgentID]; !exists {
				agentCount++
			}
			if agentCount > normalizedPlan.Limit.MaxAgentsPerBatch {
				canFit = false
			}
		}
		if normalizedPlan.Limit.MaxWorkUnitsPerBatch > 0 && len(currentUnits)+1 > normalizedPlan.Limit.MaxWorkUnitsPerBatch {
			canFit = false
		}
		if normalizedPlan.Limit.MaxOverwriteTargetsPerBatch > 0 && currentOverwriteTargets+unit.OverwriteTargetCount > normalizedPlan.Limit.MaxOverwriteTargetsPerBatch {
			canFit = false
		}
		identityScopeCount := len(currentIdentityScopes)
		if _, exists := currentIdentityScopes[unit.IdentityScopeKey]; !exists {
			identityScopeCount++
		}
		if normalizedPlan.Limit.MaxIdentityScopesPerBatch > 0 && identityScopeCount > normalizedPlan.Limit.MaxIdentityScopesPerBatch {
			canFit = false
		}
		if !canFit {
			if err := flush(sequence); err != nil {
				return OfflineBatchExecutionSchedule{}, err
			}
			sequence++
		}
		currentUnits = append(currentUnits, unit)
		currentAgents[unit.AgentID] = struct{}{}
		currentIdentityScopes[unit.IdentityScopeKey] = struct{}{}
		currentOverwriteTargets += unit.OverwriteTargetCount
		schedule.ScheduledWorkUnitIDs = append(schedule.ScheduledWorkUnitIDs, unit.WorkUnitID)
	}
	if err := flush(sequence); err != nil {
		return OfflineBatchExecutionSchedule{}, err
	}
	schedule.ScheduledWorkUnitCount = len(schedule.ScheduledWorkUnitIDs)
	schedule.BlockedWorkUnitCount = len(schedule.BlockedWorkUnits)
	schedule.SliceCount = len(schedule.Slices)
	schedule.Executable = true
	return schedule, nil
}

func ExecuteOfflineBatchPlan(ctx context.Context, plan OfflineBatchPlan, options OfflineBatchExecutionOptions) (OfflineBatchExecutionResult, error) {
	schedule, err := ScheduleOfflineBatchExecution(plan)
	if err != nil {
		return OfflineBatchExecutionResult{}, err
	}
	result := OfflineBatchExecutionResult{
		PlanID:   schedule.PlanID,
		Schedule: schedule,
		Results:  []OfflineBatchWorkUnitExecutionResult{},
	}
	if !schedule.Executable {
		result.Status = "blocked-by-schedule"
		result.BlockedCount = len(schedule.BlockedWorkUnits)
		return result, nil
	}
	concurrency := options.MaxConcurrentWorkUnits
	if concurrency <= 0 {
		concurrency = maxInt(1, schedule.Limit.MaxAgentsPerBatch)
	}
	if options.DispatchWorkUnit == nil {
		options.DispatchWorkUnit = func(workUnit OfflineBatchWorkUnit, dispatchContext OfflineBatchWorkUnitDispatchContext) (any, error) {
			return map[string]any{"handledWorkUnitId": workUnit.WorkUnitID}, nil
		}
	}
	authorizationMode := "plan-runtime-phase"
	if options.ResolveRuntimePhase != nil {
		authorizationMode = "execution-runtime-phase"
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	for _, slice := range schedule.Slices {
		for _, workUnit := range slice.BatchPlan.WorkUnits {
			wg.Add(1)
			sem <- struct{}{}
			go func(slice OfflineBatchExecutionSlice, workUnit OfflineBatchWorkUnit) {
				defer wg.Done()
				defer func() { <-sem }()
				runtimePhaseInput := any(workUnit.RuntimePhase)
				if options.ResolveRuntimePhase != nil {
					runtimePhaseInput = options.ResolveRuntimePhase(workUnit, slice, schedule)
				}
				authorization, authErr := EvaluateIdleWindowAuthorization(workUnit.AgentID, runtimePhaseInput, nil, schedule.CoordinationSignal == "team-idle")
				if authErr != nil {
					mu.Lock()
					result.Results = append(result.Results, OfflineBatchWorkUnitExecutionResult{
						WorkUnitID:        workUnit.WorkUnitID,
						AgentID:           workUnit.AgentID,
						SliceID:           slice.SliceID,
						SliceSequence:     slice.Sequence,
						Status:            "failed",
						AuthorizationMode: authorizationMode,
						Error:             &OfflineBatchExecutionError{Name: "authorization_error", Message: authErr.Error()},
					})
					result.FailedCount++
					mu.Unlock()
					return
				}
				phaseValue := ""
				if authorization.RuntimePhase != nil {
					phaseValue = authorization.RuntimePhase.Value
				}
				if !authorization.Eligible {
					mu.Lock()
					result.Results = append(result.Results, OfflineBatchWorkUnitExecutionResult{
						WorkUnitID:        workUnit.WorkUnitID,
						AgentID:           workUnit.AgentID,
						SliceID:           slice.SliceID,
						SliceSequence:     slice.Sequence,
						Status:            "blocked",
						AuthorizationMode: authorizationMode,
						RuntimePhase:      phaseValue,
						Authorization:     authorization,
						BlockedReason:     authorization.BlockedReason,
					})
					result.BlockedCount++
					mu.Unlock()
					return
				}
				output, dispatchErr := options.DispatchWorkUnit(workUnit, OfflineBatchWorkUnitDispatchContext{
					OfflineBatchExecutionContext: OfflineBatchExecutionContext{
						PlanID:             schedule.PlanID,
						CoordinationSignal: schedule.CoordinationSignal,
						SchedulingStrategy: schedule.SchedulingStrategy,
						SliceID:            slice.SliceID,
						SliceSequence:      slice.Sequence,
						SlicePlan:          slice.BatchPlan,
						Limit:              schedule.Limit,
						AuthorizationMode:  authorizationMode,
					},
					RuntimePhase:  authorization.RuntimePhase,
					Authorization: authorization,
				})
				mu.Lock()
				defer mu.Unlock()
				if dispatchErr != nil {
					result.Results = append(result.Results, OfflineBatchWorkUnitExecutionResult{
						WorkUnitID:        workUnit.WorkUnitID,
						AgentID:           workUnit.AgentID,
						SliceID:           slice.SliceID,
						SliceSequence:     slice.Sequence,
						Status:            "failed",
						AuthorizationMode: authorizationMode,
						RuntimePhase:      phaseValue,
						Authorization:     authorization,
						Error:             &OfflineBatchExecutionError{Name: "dispatch_error", Message: dispatchErr.Error()},
					})
					result.FailedCount++
					return
				}
				result.Results = append(result.Results, OfflineBatchWorkUnitExecutionResult{
					WorkUnitID:        workUnit.WorkUnitID,
					AgentID:           workUnit.AgentID,
					SliceID:           slice.SliceID,
					SliceSequence:     slice.Sequence,
					Status:            "executed",
					AuthorizationMode: authorizationMode,
					RuntimePhase:      phaseValue,
					Authorization:     authorization,
					Output:            output,
				})
				result.DispatchedCount++
				result.ExecutedCount++
			}(slice, workUnit)
		}
	}
	wg.Wait()
	result.AuthorizationMode = authorizationMode
	switch {
	case result.FailedCount > 0:
		result.Status = "completed-with-errors"
	case result.BlockedCount > 0:
		result.Status = "completed-with-blocked-work-units"
	default:
		result.Status = "completed"
	}
	sort.SliceStable(result.Results, func(i, j int) bool {
		if result.Results[i].SliceSequence == result.Results[j].SliceSequence {
			return result.Results[i].WorkUnitID < result.Results[j].WorkUnitID
		}
		return result.Results[i].SliceSequence < result.Results[j].SliceSequence
	})
	return result, nil
}

func maxInt(values ...int) int {
	max := 0
	for _, value := range values {
		if value > max {
			max = value
		}
	}
	if max == 0 {
		return 1
	}
	return max
}
