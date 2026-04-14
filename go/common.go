package brain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

func normalizeRequiredString(value, label string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", fmt.Errorf("%s must not be empty", label)
	}
	return normalized, nil
}

func normalizeOptionalString(value string) string {
	return strings.TrimSpace(value)
}

func normalizeToken(value, label string) (string, error) {
	normalized, err := normalizeRequiredString(value, label)
	if err != nil {
		return "", err
	}
	return strings.ToLower(normalized), nil
}

func normalizeTimeString(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format(time.RFC3339), nil
}

func mustNormalizeTimeString(value string) string {
	normalized, err := normalizeTimeString(value)
	if err != nil {
		return value
	}
	return normalized
}

func parseRequiredTime(value, label string) (time.Time, error) {
	normalized, err := normalizeTimeString(value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be RFC3339: %w", label, err)
	}
	if normalized == "" {
		return time.Time{}, fmt.Errorf("%s must not be empty", label)
	}
	return time.Parse(time.RFC3339, normalized)
}

func copyStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	next := append([]string(nil), values...)
	return next
}

func uniqueSortedStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			seen[normalized] = struct{}{}
		}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func copyMap(value map[string]any) map[string]any {
	if len(value) == 0 {
		return map[string]any{}
	}
	raw, _ := json.Marshal(value)
	var next map[string]any
	if err := json.Unmarshal(raw, &next); err != nil {
		return map[string]any{}
	}
	return next
}

func copyStringMap(value map[string]string) map[string]string {
	if len(value) == 0 {
		return map[string]string{}
	}
	next := make(map[string]string, len(value))
	for key, entry := range value {
		next[key] = entry
	}
	return next
}

func averageSignalScore(signals map[string]float64) float64 {
	if len(signals) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range signals {
		total += clamp01(value)
	}
	return round4(total / float64(len(signals)))
}

func clamp01(value float64) float64 {
	switch {
	case value < 0:
		return 0
	case value > 1:
		return 1
	default:
		return value
	}
}

func round4(value float64) float64 {
	return float64(int(value*10000+0.5)) / 10000
}

func nonNegativeInt(value int, label string) (int, error) {
	if value < 0 {
		return 0, fmt.Errorf("%s must be non-negative", label)
	}
	return value, nil
}

func positiveOrZero(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func copyContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

var errNotFound = errors.New("not found")
