package brain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type ConsolidationSignalCapture struct {
	Score            float64            `json:"score"`
	Signals          map[string]float64 `json:"signals"`
	SignalCount      int                `json:"signalCount"`
	CapturedAt       string             `json:"capturedAt"`
	SourceCollection string             `json:"sourceCollection,omitempty"`
	SourceRecordIDs  []string           `json:"sourceRecordIds,omitempty"`
	Provenance       map[string]any     `json:"provenance,omitempty"`
}

type ConsolidationGenerationSignalSet struct {
	Importance *ConsolidationSignalCapture `json:"importance,omitempty"`
	Stability  *ConsolidationSignalCapture `json:"stability,omitempty"`
}

type ConsolidationPromotionCandidate struct {
	CandidateID           string `json:"candidateId"`
	AgentID               string `json:"agentId"`
	SourceMemoryID        string `json:"sourceMemoryId"`
	SourceMemoryKind      string `json:"sourceMemoryKind"`
	TargetMemoryID        string `json:"targetMemoryId,omitempty"`
	TargetNodeKind        string `json:"targetNodeKind"`
	LearnedTraitCandidate bool   `json:"learnedTraitCandidate"`
	Signals               struct {
		YoungGeneration ConsolidationGenerationSignalSet `json:"youngGeneration"`
		OldGeneration   ConsolidationGenerationSignalSet `json:"oldGeneration"`
	} `json:"signals"`
	SignalCoverage []string       `json:"signalCoverage"`
	Provenance     map[string]any `json:"provenance,omitempty"`
}

type ConsolidationPromotionThresholds struct {
	MinimumPromotionScore       float64 `json:"minimumPromotionScore"`
	MinimumYoungImportanceScore float64 `json:"minimumYoungImportanceScore"`
	MinimumYoungStabilityScore  float64 `json:"minimumYoungStabilityScore"`
	MinimumOldImportanceScore   float64 `json:"minimumOldImportanceScore"`
	MinimumOldStabilityScore    float64 `json:"minimumOldStabilityScore"`
}

type ConsolidationPromotionWeights struct {
	YoungImportance float64 `json:"youngImportance"`
	YoungStability  float64 `json:"youngStability"`
	OldImportance   float64 `json:"oldImportance"`
	OldStability    float64 `json:"oldStability"`
}

type ConsolidationPromotionPolicy struct {
	PolicyID                      string                           `json:"policyId"`
	Version                       string                           `json:"version"`
	TargetNodeKind                string                           `json:"targetNodeKind"`
	RequiresRuntimeAuthorization  bool                             `json:"requiresRuntimeAuthorization"`
	AllowedRuntimePhases          []string                         `json:"allowedRuntimePhases"`
	InactivityHeuristicsAuthorize bool                             `json:"inactivityHeuristicsAuthorize"`
	TeamIdleCoordinatesOnly       bool                             `json:"teamIdleCoordinatesOnly"`
	AllowIdentityPromotion        bool                             `json:"allowIdentityPromotion"`
	LearnedTraitsTargetNodeKind   string                           `json:"learnedTraitsTargetNodeKind"`
	ProtectedIdentityFields       []string                         `json:"protectedIdentityFields"`
	RequiredSignals               []string                         `json:"requiredSignals"`
	Thresholds                    ConsolidationPromotionThresholds `json:"thresholds"`
	Weights                       ConsolidationPromotionWeights    `json:"weights"`
}

var DefaultConsolidationPromotionPolicy = ConsolidationPromotionPolicy{
	PolicyID:                      "offline-promotion-policy",
	Version:                       SchemaVersion,
	TargetNodeKind:                NodeKindLongTermMemory,
	RequiresRuntimeAuthorization:  true,
	AllowedRuntimePhases:          AuthorizedIdlePhases,
	InactivityHeuristicsAuthorize: false,
	TeamIdleCoordinatesOnly:       true,
	AllowIdentityPromotion:        false,
	LearnedTraitsTargetNodeKind:   NodeKindLongTermMemory,
	ProtectedIdentityFields:       copyStrings(ProtectedIdentityFields),
	RequiredSignals: []string{
		"youngGeneration.importance",
		"youngGeneration.stability",
	},
	Thresholds: ConsolidationPromotionThresholds{
		MinimumPromotionScore:       0.65,
		MinimumYoungImportanceScore: 0.65,
		MinimumYoungStabilityScore:  0.65,
		MinimumOldImportanceScore:   0,
		MinimumOldStabilityScore:    0,
	},
	Weights: ConsolidationPromotionWeights{
		YoungImportance: 0.4,
		YoungStability:  0.35,
		OldImportance:   0.15,
		OldStability:    0.1,
	},
}

type ConsolidationPromotionCriterionResult struct {
	SignalPath       string   `json:"signalPath"`
	Required         bool     `json:"required"`
	Available        bool     `json:"available"`
	Score            *float64 `json:"score,omitempty"`
	Threshold        float64  `json:"threshold"`
	Weight           float64  `json:"weight"`
	MeetsThreshold   *bool    `json:"meetsThreshold,omitempty"`
	SignalCount      int      `json:"signalCount"`
	CapturedAt       string   `json:"capturedAt,omitempty"`
	SourceCollection string   `json:"sourceCollection,omitempty"`
	SourceRecordIDs  []string `json:"sourceRecordIds,omitempty"`
}

type ConsolidationPromotionCriteriaSummary struct {
	TotalCriteria          int      `json:"totalCriteria"`
	RequiredCriteria       int      `json:"requiredCriteria"`
	OptionalCriteria       int      `json:"optionalCriteria"`
	AvailableCriteria      int      `json:"availableCriteria"`
	SatisfiedCriteria      int      `json:"satisfiedCriteria"`
	BlockedCriteria        int      `json:"blockedCriteria"`
	MissingRequiredSignals []string `json:"missingRequiredSignals"`
}

type ConsolidationPromotionEvaluation struct {
	CandidateID              string                                  `json:"candidateId"`
	AgentID                  string                                  `json:"agentId"`
	SourceMemoryID           string                                  `json:"sourceMemoryId"`
	SourceMemoryKind         string                                  `json:"sourceMemoryKind"`
	TargetMemoryID           string                                  `json:"targetMemoryId,omitempty"`
	TargetNodeKind           string                                  `json:"targetNodeKind"`
	LearnedTraitCandidate    bool                                    `json:"learnedTraitCandidate"`
	PolicyID                 string                                  `json:"policyId"`
	PolicyVersion            string                                  `json:"policyVersion"`
	EvaluatedAt              string                                  `json:"evaluatedAt"`
	SignalCoverage           []string                                `json:"signalCoverage"`
	RequiredSignals          []string                                `json:"requiredSignals"`
	Criteria                 []ConsolidationPromotionCriterionResult `json:"criteria"`
	CriteriaSummary          ConsolidationPromotionCriteriaSummary   `json:"criteriaSummary"`
	PromotionScore           float64                                 `json:"promotionScore"`
	MinimumPromotionScoreMet bool                                    `json:"minimumPromotionScoreMet"`
	Eligible                 bool                                    `json:"eligible"`
	EligibleForPromotion     bool                                    `json:"eligibleForPromotion"`
	Decision                 string                                  `json:"decision"`
	RecommendedOperation     string                                  `json:"recommendedOperation"`
	BlockedReasons           []string                                `json:"blockedReasons"`
}

type ConsolidationPromotionPlanSelection struct {
	Candidate        ConsolidationPromotionCandidate  `json:"candidate"`
	Evaluation       ConsolidationPromotionEvaluation `json:"evaluation"`
	SourceCollection string                           `json:"sourceCollection"`
	TargetMemoryID   string                           `json:"targetMemoryId,omitempty"`
	TargetNodeID     string                           `json:"targetNodeId,omitempty"`
	OutputMemoryID   string                           `json:"outputMemoryId"`
	OutputNodeID     string                           `json:"outputNodeId"`
}

type ConsolidationPromotionPlanDeferredCandidate struct {
	Candidate        ConsolidationPromotionCandidate   `json:"candidate"`
	Evaluation       *ConsolidationPromotionEvaluation `json:"evaluation,omitempty"`
	SourceCollection string                            `json:"sourceCollection,omitempty"`
	TargetMemoryID   string                            `json:"targetMemoryId,omitempty"`
	TargetNodeID     string                            `json:"targetNodeId,omitempty"`
	OutputMemoryID   string                            `json:"outputMemoryId,omitempty"`
	OutputNodeID     string                            `json:"outputNodeId,omitempty"`
	DeferredReason   string                            `json:"deferredReason"`
}

type ConsolidationPromotionPlanOptions struct {
	Candidates           []ConsolidationPromotionCandidate
	RuntimePhase         any
	InactivitySuggestion *IdleWindowSuggestion
	TeamIdle             bool
	Policy               *ConsolidationPromotionPolicy
}

type ConsolidationPromotionPlan struct {
	AgentID                 string                                        `json:"agentId"`
	PolicyID                string                                        `json:"policyId"`
	PolicyVersion           string                                        `json:"policyVersion"`
	Authorization           IdleWindowAuthorization                       `json:"authorization"`
	PromotionCandidateCount int                                           `json:"promotionCandidateCount"`
	SelectedPromotions      []ConsolidationPromotionPlanSelection         `json:"selectedPromotions"`
	SelectedPromotionCount  int                                           `json:"selectedPromotionCount"`
	DeferredCandidates      []ConsolidationPromotionPlanDeferredCandidate `json:"deferredCandidates"`
	DeferredCount           int                                           `json:"deferredCount"`
	BatchEligible           bool                                          `json:"batchEligible"`
	SelectionMode           string                                        `json:"selectionMode"`
}

func CreateConsolidationSignalCapture(input ConsolidationSignalCapture) ConsolidationSignalCapture {
	signals := make(map[string]float64, len(input.Signals))
	for key, value := range input.Signals {
		if normalized := strings.TrimSpace(key); normalized != "" {
			signals[normalized] = clamp01(value)
		}
	}
	score := input.Score
	if score == 0 && len(signals) > 0 {
		score = averageSignalScore(signals)
	}
	return ConsolidationSignalCapture{
		Score:            round4(score),
		Signals:          signals,
		SignalCount:      len(signals),
		CapturedAt:       mustNormalizeTimeString(input.CapturedAt),
		SourceCollection: normalizeOptionalString(input.SourceCollection),
		SourceRecordIDs:  uniqueSortedStrings(input.SourceRecordIDs),
		Provenance:       copyMap(input.Provenance),
	}
}

func CreateConsolidationPromotionCandidate(input ConsolidationPromotionCandidate) (ConsolidationPromotionCandidate, error) {
	candidateID, err := normalizeRequiredString(input.CandidateID, "candidateId")
	if err != nil {
		return ConsolidationPromotionCandidate{}, err
	}
	agentID, err := normalizeRequiredString(input.AgentID, "agentId")
	if err != nil {
		return ConsolidationPromotionCandidate{}, err
	}
	sourceMemoryID, err := normalizeRequiredString(input.SourceMemoryID, "sourceMemoryId")
	if err != nil {
		return ConsolidationPromotionCandidate{}, err
	}
	sourceMemoryKind, err := normalizeRequiredString(input.SourceMemoryKind, "sourceMemoryKind")
	if err != nil {
		return ConsolidationPromotionCandidate{}, err
	}
	next := input
	next.CandidateID = candidateID
	next.AgentID = agentID
	next.SourceMemoryID = sourceMemoryID
	next.SourceMemoryKind = sourceMemoryKind
	next.TargetNodeKind = coalesceString(input.TargetNodeKind, NodeKindLongTermMemory)
	next.Signals.YoungGeneration.Importance = signalCapturePtr(input.Signals.YoungGeneration.Importance)
	next.Signals.YoungGeneration.Stability = signalCapturePtr(input.Signals.YoungGeneration.Stability)
	next.Signals.OldGeneration.Importance = signalCapturePtr(input.Signals.OldGeneration.Importance)
	next.Signals.OldGeneration.Stability = signalCapturePtr(input.Signals.OldGeneration.Stability)
	next.SignalCoverage = uniqueSortedStrings(signalCoverage(next))
	next.Provenance = copyMap(input.Provenance)
	return next, nil
}

func signalCapturePtr(input *ConsolidationSignalCapture) *ConsolidationSignalCapture {
	if input == nil {
		return nil
	}
	created := CreateConsolidationSignalCapture(*input)
	return &created
}

func signalCoverage(candidate ConsolidationPromotionCandidate) []string {
	coverage := []string{}
	if candidate.Signals.YoungGeneration.Importance != nil {
		coverage = append(coverage, "youngGeneration.importance")
	}
	if candidate.Signals.YoungGeneration.Stability != nil {
		coverage = append(coverage, "youngGeneration.stability")
	}
	if candidate.Signals.OldGeneration.Importance != nil {
		coverage = append(coverage, "oldGeneration.importance")
	}
	if candidate.Signals.OldGeneration.Stability != nil {
		coverage = append(coverage, "oldGeneration.stability")
	}
	return coverage
}

func EvaluateConsolidationPromotionEligibility(input ConsolidationPromotionCandidate, policy *ConsolidationPromotionPolicy) (ConsolidationPromotionEvaluation, error) {
	candidate, err := CreateConsolidationPromotionCandidate(input)
	if err != nil {
		return ConsolidationPromotionEvaluation{}, err
	}
	activePolicy := DefaultConsolidationPromotionPolicy
	if policy != nil {
		activePolicy = *policy
	}
	type signalSpec struct {
		path      string
		required  bool
		threshold float64
		weight    float64
		signal    *ConsolidationSignalCapture
	}
	specs := []signalSpec{
		{path: "youngGeneration.importance", required: true, threshold: activePolicy.Thresholds.MinimumYoungImportanceScore, weight: activePolicy.Weights.YoungImportance, signal: candidate.Signals.YoungGeneration.Importance},
		{path: "youngGeneration.stability", required: true, threshold: activePolicy.Thresholds.MinimumYoungStabilityScore, weight: activePolicy.Weights.YoungStability, signal: candidate.Signals.YoungGeneration.Stability},
		{path: "oldGeneration.importance", required: false, threshold: activePolicy.Thresholds.MinimumOldImportanceScore, weight: activePolicy.Weights.OldImportance, signal: candidate.Signals.OldGeneration.Importance},
		{path: "oldGeneration.stability", required: false, threshold: activePolicy.Thresholds.MinimumOldStabilityScore, weight: activePolicy.Weights.OldStability, signal: candidate.Signals.OldGeneration.Stability},
	}
	criteria := make([]ConsolidationPromotionCriterionResult, 0, len(specs))
	missingRequiredSignals := []string{}
	satisfiedCriteria := 0
	availableCriteria := 0
	promotionScore := 0.0
	blockedReasons := []string{}
	for _, spec := range specs {
		criterion := ConsolidationPromotionCriterionResult{
			SignalPath: spec.path,
			Required:   spec.required,
			Threshold:  spec.threshold,
			Weight:     spec.weight,
		}
		if spec.signal != nil {
			score := spec.signal.Score
			meets := score >= spec.threshold
			criterion.Available = true
			criterion.Score = &score
			criterion.MeetsThreshold = &meets
			criterion.SignalCount = spec.signal.SignalCount
			criterion.CapturedAt = spec.signal.CapturedAt
			criterion.SourceCollection = spec.signal.SourceCollection
			criterion.SourceRecordIDs = copyStrings(spec.signal.SourceRecordIDs)
			availableCriteria++
			if meets {
				satisfiedCriteria++
			}
			promotionScore += score * spec.weight
		} else if spec.required {
			missingRequiredSignals = append(missingRequiredSignals, spec.path)
		}
		criteria = append(criteria, criterion)
	}
	promotionScore = round4(promotionScore)
	minimumPromotionScoreMet := promotionScore >= activePolicy.Thresholds.MinimumPromotionScore
	if len(missingRequiredSignals) > 0 {
		blockedReasons = append(blockedReasons, "missing-required-signals")
	}
	if !minimumPromotionScoreMet {
		blockedReasons = append(blockedReasons, "promotion-score-below-threshold")
	}
	for _, criterion := range criteria {
		if criterion.Required && criterion.MeetsThreshold != nil && !*criterion.MeetsThreshold {
			blockedReasons = append(blockedReasons, fmt.Sprintf("%s-below-threshold", criterion.SignalPath))
		}
	}
	if candidate.LearnedTraitCandidate && !activePolicy.AllowIdentityPromotion {
		blockedReasons = append(blockedReasons, "learned-traits-remain-long-term-memory-only")
	}
	blockedReasons = uniqueSortedStrings(blockedReasons)
	eligible := len(blockedReasons) == 0
	return ConsolidationPromotionEvaluation{
		CandidateID:           candidate.CandidateID,
		AgentID:               candidate.AgentID,
		SourceMemoryID:        candidate.SourceMemoryID,
		SourceMemoryKind:      candidate.SourceMemoryKind,
		TargetMemoryID:        candidate.TargetMemoryID,
		TargetNodeKind:        candidate.TargetNodeKind,
		LearnedTraitCandidate: candidate.LearnedTraitCandidate,
		PolicyID:              activePolicy.PolicyID,
		PolicyVersion:         activePolicy.Version,
		EvaluatedAt:           mustNormalizeTimeString(time.Now().UTC().Format(time.RFC3339)),
		SignalCoverage:        copyStrings(candidate.SignalCoverage),
		RequiredSignals:       copyStrings(activePolicy.RequiredSignals),
		Criteria:              criteria,
		CriteriaSummary: ConsolidationPromotionCriteriaSummary{
			TotalCriteria:          len(criteria),
			RequiredCriteria:       2,
			OptionalCriteria:       len(criteria) - 2,
			AvailableCriteria:      availableCriteria,
			SatisfiedCriteria:      satisfiedCriteria,
			BlockedCriteria:        len(criteria) - satisfiedCriteria,
			MissingRequiredSignals: missingRequiredSignals,
		},
		PromotionScore:           promotionScore,
		MinimumPromotionScoreMet: minimumPromotionScoreMet,
		Eligible:                 eligible,
		EligibleForPromotion:     eligible,
		Decision:                 map[bool]string{true: "promote", false: "defer"}[eligible],
		RecommendedOperation:     map[bool]string{true: "promote", false: "defer"}[eligible],
		BlockedReasons:           blockedReasons,
	}, nil
}

func findYoungMemory(graph MemoryGraph, kind string, memoryID string) (*YoungGenerationMemory, string) {
	for _, memory := range graph.YoungGeneration.WorkingMemory {
		if memory.Record.MemoryID == memoryID && kind == NodeKindWorkingMemory {
			copied := memory
			return &copied, "workingMemory"
		}
	}
	for _, memory := range graph.YoungGeneration.ShortTermMemory {
		if memory.Record.MemoryID == memoryID && kind == NodeKindShortTermMemory {
			copied := memory
			return &copied, "shortTermMemory"
		}
	}
	return nil, ""
}

func PlanConsolidationPromotions(graph MemoryGraph, options ConsolidationPromotionPlanOptions) (ConsolidationPromotionPlan, error) {
	activePolicy := DefaultConsolidationPromotionPolicy
	if options.Policy != nil {
		activePolicy = *options.Policy
	}
	authorization, err := EvaluateIdleWindowAuthorization(graph.AgentID, options.RuntimePhase, options.InactivitySuggestion, options.TeamIdle)
	if err != nil {
		return ConsolidationPromotionPlan{}, err
	}
	plan := ConsolidationPromotionPlan{
		AgentID:                 graph.AgentID,
		PolicyID:                activePolicy.PolicyID,
		PolicyVersion:           activePolicy.Version,
		Authorization:           authorization,
		PromotionCandidateCount: len(options.Candidates),
		SelectedPromotions:      []ConsolidationPromotionPlanSelection{},
		DeferredCandidates:      []ConsolidationPromotionPlanDeferredCandidate{},
		SelectionMode:           "offline-promotion-selection",
	}
	for _, rawCandidate := range options.Candidates {
		candidate, err := CreateConsolidationPromotionCandidate(rawCandidate)
		if err != nil {
			return ConsolidationPromotionPlan{}, err
		}
		if !authorization.Eligible {
			plan.DeferredCandidates = append(plan.DeferredCandidates, ConsolidationPromotionPlanDeferredCandidate{
				Candidate:      candidate,
				DeferredReason: authorization.BlockedReason,
			})
			continue
		}
		sourceMemory, sourceCollection := findYoungMemory(graph, candidate.SourceMemoryKind, candidate.SourceMemoryID)
		if sourceMemory == nil {
			plan.DeferredCandidates = append(plan.DeferredCandidates, ConsolidationPromotionPlanDeferredCandidate{
				Candidate:        candidate,
				DeferredReason:   "source-memory-not-found",
				SourceCollection: sourceCollection,
			})
			continue
		}
		if !sourceMemory.InactiveForRetrieval {
			plan.DeferredCandidates = append(plan.DeferredCandidates, ConsolidationPromotionPlanDeferredCandidate{
				Candidate:        candidate,
				DeferredReason:   "active-set-memory",
				SourceCollection: sourceCollection,
			})
			continue
		}
		evaluation, err := EvaluateConsolidationPromotionEligibility(candidate, &activePolicy)
		if err != nil {
			return ConsolidationPromotionPlan{}, err
		}
		if !evaluation.Eligible {
			plan.DeferredCandidates = append(plan.DeferredCandidates, ConsolidationPromotionPlanDeferredCandidate{
				Candidate:        candidate,
				Evaluation:       &evaluation,
				DeferredReason:   "promotion-policy-blocked",
				SourceCollection: sourceCollection,
			})
			continue
		}
		outputMemoryID := coalesceString(candidate.TargetMemoryID, candidate.SourceMemoryID)
		if candidate.TargetMemoryID == "" {
			if existing := LookupLongTermMemory(graph, candidate.SourceMemoryID); existing != nil {
				outputMemoryID = existing.MemoryID
			}
		}
		outputNodeID := CreateOldGenerationNodeID(NodeKindLongTermMemory, candidate.AgentID, outputMemoryID)
		plan.SelectedPromotions = append(plan.SelectedPromotions, ConsolidationPromotionPlanSelection{
			Candidate:        candidate,
			Evaluation:       evaluation,
			SourceCollection: sourceCollection,
			TargetMemoryID:   candidate.TargetMemoryID,
			TargetNodeID:     nodeIDOrEmpty(LookupLongTermMemory(graph, candidate.TargetMemoryID)),
			OutputMemoryID:   outputMemoryID,
			OutputNodeID:     outputNodeID,
		})
	}
	sort.SliceStable(plan.SelectedPromotions, func(i, j int) bool {
		return plan.SelectedPromotions[i].Evaluation.PromotionScore > plan.SelectedPromotions[j].Evaluation.PromotionScore
	})
	plan.SelectedPromotionCount = len(plan.SelectedPromotions)
	plan.DeferredCount = len(plan.DeferredCandidates)
	plan.BatchEligible = authorization.Eligible && plan.SelectedPromotionCount > 0
	return plan, nil
}

func nodeIDOrEmpty(memory *LongTermMemory) string {
	if memory == nil {
		return ""
	}
	return memory.NodeID
}
