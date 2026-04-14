package brain

import "context"

type BrainService interface {
	EvaluateIdleWindow(ctx context.Context, agentID string, runtimePhase any, inactivitySuggestion *IdleWindowSuggestion, teamIdle bool) (IdleWindowAuthorization, error)
	RequestOfflineConsolidationPlan(ctx context.Context, request OfflineConsolidationPlanBuilderRequest, batchLimit *OfflineBatchLimit) (OfflineConsolidationBatchPlanRequestResult, error)
	ExecuteOfflineBatchPlan(ctx context.Context, plan OfflineBatchPlan, options OfflineBatchExecutionOptions) (OfflineBatchExecutionResult, error)
	PersistLongTermMemory(ctx context.Context, request PersistLongTermMemoryEntryRequest) (PersistLongTermMemoryEntryResult, error)
}

type LocalBrainService struct{}

func (LocalBrainService) EvaluateIdleWindow(ctx context.Context, agentID string, runtimePhase any, inactivitySuggestion *IdleWindowSuggestion, teamIdle bool) (IdleWindowAuthorization, error) {
	return EvaluateIdleWindowAuthorization(agentID, runtimePhase, inactivitySuggestion, teamIdle)
}

func (LocalBrainService) RequestOfflineConsolidationPlan(ctx context.Context, request OfflineConsolidationPlanBuilderRequest, batchLimit *OfflineBatchLimit) (OfflineConsolidationBatchPlanRequestResult, error) {
	result := RequestOfflineConsolidationBatchPlan(
		request.RequestID,
		request.AgentID,
		request.PresetID,
		request.RuntimePhase,
		request.InactivitySuggestion,
		request.TeamIdle,
		request.PriorityMemoryIDs,
		batchLimit,
	)
	return result, nil
}

func (LocalBrainService) ExecuteOfflineBatchPlan(ctx context.Context, plan OfflineBatchPlan, options OfflineBatchExecutionOptions) (OfflineBatchExecutionResult, error) {
	return ExecuteOfflineBatchPlan(ctx, plan, options)
}

func (LocalBrainService) PersistLongTermMemory(ctx context.Context, request PersistLongTermMemoryEntryRequest) (PersistLongTermMemoryEntryResult, error) {
	return PersistLongTermMemoryEntry(ctx, request)
}
