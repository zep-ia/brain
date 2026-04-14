package brain

import (
	"fmt"
	"sort"
	"strings"
)

var DefaultStaleMemoryWeights = StaleMemoryWeights{
	Recency:         0.4,
	AccessFrequency: 0.25,
	RetentionValue:  0.35,
}

type StaleMemoryWeights struct {
	Recency         float64 `json:"recency"`
	AccessFrequency float64 `json:"accessFrequency"`
	RetentionValue  float64 `json:"retentionValue"`
}

type StaleMemoryInput struct {
	MemoryID       string         `json:"memoryId"`
	CreatedAt      string         `json:"createdAt"`
	LastAccessedAt string         `json:"lastAccessedAt"`
	AccessCount    int            `json:"accessCount"`
	RetentionValue float64        `json:"retentionValue"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type StaleMemoryBreakdown struct {
	Recency         float64 `json:"recency"`
	AccessFrequency float64 `json:"accessFrequency"`
	RetentionValue  float64 `json:"retentionValue"`
}

type StaleMemoryEvaluation struct {
	MemoryID       string               `json:"memoryId"`
	Metadata       map[string]any       `json:"metadata,omitempty"`
	CreatedAt      string               `json:"createdAt"`
	LastAccessedAt string               `json:"lastAccessedAt"`
	AccessCount    int                  `json:"accessCount"`
	RetentionValue float64              `json:"retentionValue"`
	RecencyMS      int64                `json:"recencyMs"`
	StaleScore     float64              `json:"staleScore"`
	StaleCandidate bool                 `json:"staleCandidate"`
	Reasons        []string             `json:"reasons"`
	Breakdown      StaleMemoryBreakdown `json:"breakdown"`
}

type StaleMemoryEvaluationOptions struct {
	Now                      string
	MinimumRecencyMS         int64
	RecencyHorizonMS         int64
	AccessFrequencyCapPerDay float64
	StaleThreshold           float64
	Weights                  StaleMemoryWeights
	Memories                 []StaleMemoryInput
}

type StaleMemoryEvaluationResult struct {
	EvaluatedAt              string                  `json:"evaluatedAt"`
	EvaluationMode           string                  `json:"evaluationMode"`
	MinimumRecencyMS         int64                   `json:"minimumRecencyMs"`
	RecencyHorizonMS         int64                   `json:"recencyHorizonMs"`
	AccessFrequencyCapPerDay float64                 `json:"accessFrequencyCapPerDay"`
	StaleThreshold           float64                 `json:"staleThreshold"`
	Weights                  StaleMemoryWeights      `json:"weights"`
	ScoredMemories           []StaleMemoryEvaluation `json:"scoredMemories"`
	StaleCandidates          []StaleMemoryEvaluation `json:"staleCandidates"`
	StaleCandidateCount      int                     `json:"staleCandidateCount"`
}

type StaleMemoryMaskingDecision struct {
	MemoryID             string                         `json:"memoryId"`
	MemoryKind           string                         `json:"memoryKind,omitempty"`
	InactiveForRetrieval bool                           `json:"inactiveForRetrieval"`
	Masking              YoungGenerationMaskingMetadata `json:"masking"`
	SourceEvaluation     StaleMemoryEvaluation          `json:"sourceEvaluation"`
}

type StaleMemoryMaskingDecisionOptions struct {
	Evaluation StaleMemoryEvaluationResult
	MaskedAt   string
	MaskedBy   string
	Reason     string
	Provenance map[string]any
}

type StaleMemoryMaskingDecisionResult struct {
	DecisionMode           string                       `json:"decisionMode"`
	MaskedAt               string                       `json:"maskedAt"`
	MaskedBy               string                       `json:"maskedBy"`
	Reason                 string                       `json:"reason"`
	MaskedDecisions        []StaleMemoryMaskingDecision `json:"maskedDecisions"`
	MaskedDecisionCount    int                          `json:"maskedDecisionCount"`
	DeferredCandidates     []StaleMemoryEvaluation      `json:"deferredCandidates"`
	DeferredCandidateCount int                          `json:"deferredCandidateCount"`
}

func EvaluateStaleMemories(options StaleMemoryEvaluationOptions) (StaleMemoryEvaluationResult, error) {
	now, err := parseRequiredTime(options.Now, "now")
	if err != nil {
		return StaleMemoryEvaluationResult{}, err
	}
	if options.MinimumRecencyMS <= 0 {
		options.MinimumRecencyMS = 7 * 24 * 60 * 60 * 1000
	}
	if options.RecencyHorizonMS <= 0 {
		options.RecencyHorizonMS = 30 * 24 * 60 * 60 * 1000
	}
	if options.AccessFrequencyCapPerDay <= 0 {
		options.AccessFrequencyCapPerDay = 4
	}
	if options.StaleThreshold <= 0 {
		options.StaleThreshold = 0.65
	}
	if options.Weights == (StaleMemoryWeights{}) {
		options.Weights = DefaultStaleMemoryWeights
	}
	result := StaleMemoryEvaluationResult{
		EvaluatedAt:              now.UTC().Format(timeFormat()),
		EvaluationMode:           "offline-suggestion-only",
		MinimumRecencyMS:         options.MinimumRecencyMS,
		RecencyHorizonMS:         options.RecencyHorizonMS,
		AccessFrequencyCapPerDay: options.AccessFrequencyCapPerDay,
		StaleThreshold:           options.StaleThreshold,
		Weights:                  options.Weights,
		ScoredMemories:           []StaleMemoryEvaluation{},
		StaleCandidates:          []StaleMemoryEvaluation{},
	}
	for _, memory := range options.Memories {
		createdAt, err := parseRequiredTime(memory.CreatedAt, "createdAt")
		if err != nil {
			return StaleMemoryEvaluationResult{}, err
		}
		lastAccessedAt, err := parseRequiredTime(memory.LastAccessedAt, "lastAccessedAt")
		if err != nil {
			return StaleMemoryEvaluationResult{}, err
		}
		if lastAccessedAt.Before(createdAt) {
			return StaleMemoryEvaluationResult{}, fmt.Errorf("lastAccessedAt must not be earlier than createdAt")
		}
		recencyMS := now.Sub(lastAccessedAt).Milliseconds()
		recencyScore := clamp01(float64(recencyMS) / float64(options.RecencyHorizonMS))
		ageDays := maxFloat64(float64(now.Sub(createdAt).Hours()/24), 1)
		accessPerDay := float64(memory.AccessCount) / ageDays
		accessScore := clamp01(1 - (accessPerDay / options.AccessFrequencyCapPerDay))
		retentionScore := clamp01(1 - memory.RetentionValue)
		staleScore := round4(
			recencyScore*options.Weights.Recency +
				accessScore*options.Weights.AccessFrequency +
				retentionScore*options.Weights.RetentionValue,
		)
		reasons := []string{}
		if recencyScore >= 0.5 {
			reasons = append(reasons, "stale-recency")
		}
		if accessScore >= 0.5 {
			reasons = append(reasons, "low-access-frequency")
		}
		if retentionScore >= 0.5 {
			reasons = append(reasons, "low-retention-value")
		}
		evaluation := StaleMemoryEvaluation{
			MemoryID:       memory.MemoryID,
			Metadata:       copyMap(memory.Metadata),
			CreatedAt:      mustNormalizeTimeString(memory.CreatedAt),
			LastAccessedAt: mustNormalizeTimeString(memory.LastAccessedAt),
			AccessCount:    memory.AccessCount,
			RetentionValue: clamp01(memory.RetentionValue),
			RecencyMS:      recencyMS,
			StaleScore:     staleScore,
			StaleCandidate: recencyMS >= options.MinimumRecencyMS && staleScore >= options.StaleThreshold,
			Reasons:        reasons,
			Breakdown: StaleMemoryBreakdown{
				Recency:         round4(recencyScore),
				AccessFrequency: round4(accessScore),
				RetentionValue:  round4(retentionScore),
			},
		}
		result.ScoredMemories = append(result.ScoredMemories, evaluation)
		if evaluation.StaleCandidate {
			result.StaleCandidates = append(result.StaleCandidates, evaluation)
		}
	}
	sort.SliceStable(result.ScoredMemories, func(i, j int) bool {
		return result.ScoredMemories[i].StaleScore > result.ScoredMemories[j].StaleScore
	})
	sort.SliceStable(result.StaleCandidates, func(i, j int) bool {
		return result.StaleCandidates[i].StaleScore > result.StaleCandidates[j].StaleScore
	})
	result.StaleCandidateCount = len(result.StaleCandidates)
	return result, nil
}

func CreateStaleMemoryMaskingDecisions(options StaleMemoryMaskingDecisionOptions) StaleMemoryMaskingDecisionResult {
	maskedAt := options.MaskedAt
	if strings.TrimSpace(maskedAt) == "" {
		maskedAt = options.Evaluation.EvaluatedAt
	}
	maskedAt = mustNormalizeTimeString(maskedAt)
	maskedBy := coalesceString(options.MaskedBy, "offline-consolidation")
	reason := coalesceString(options.Reason, "stale-low-value")
	result := StaleMemoryMaskingDecisionResult{
		DecisionMode:       "offline-suggestion-only",
		MaskedAt:           maskedAt,
		MaskedBy:           maskedBy,
		Reason:             reason,
		MaskedDecisions:    []StaleMemoryMaskingDecision{},
		DeferredCandidates: []StaleMemoryEvaluation{},
	}
	for _, candidate := range options.Evaluation.StaleCandidates {
		memoryKind, _ := candidate.Metadata["memoryKind"].(string)
		if candidate.RetentionValue <= 0.5 {
			result.MaskedDecisions = append(result.MaskedDecisions, StaleMemoryMaskingDecision{
				MemoryID:             candidate.MemoryID,
				MemoryKind:           memoryKind,
				InactiveForRetrieval: true,
				Masking: YoungGenerationMaskingMetadata{
					IsMasked:      true,
					MaskedAt:      maskedAt,
					MaskUpdatedAt: maskedAt,
					MaskedBy:      maskedBy,
					Reason:        reason,
					Provenance: mergeMaps(options.Provenance, map[string]any{
						"sourceEvaluationAt": options.Evaluation.EvaluatedAt,
					}),
					Audit: &YoungGenerationMaskingAuditMetadata{
						RuntimePhase:         stringFromMap(options.Provenance, "runtimePhase"),
						RecordedAt:           maskedAt,
						Actor:                maskedBy,
						SourceEvaluationMode: options.Evaluation.EvaluationMode,
					},
				},
				SourceEvaluation: candidate,
			})
		} else {
			result.DeferredCandidates = append(result.DeferredCandidates, candidate)
		}
	}
	result.MaskedDecisionCount = len(result.MaskedDecisions)
	result.DeferredCandidateCount = len(result.DeferredCandidates)
	return result
}

func mergeMaps(values ...map[string]any) map[string]any {
	result := map[string]any{}
	for _, value := range values {
		for key, entry := range value {
			result[key] = entry
		}
	}
	return result
}

func stringFromMap(value map[string]any, key string) string {
	raw, _ := value[key].(string)
	return raw
}

func maxFloat64(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func timeFormat() string {
	return "2006-01-02T15:04:05Z"
}
