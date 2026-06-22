package tribitserver

import (
	"regexp"
	"strings"
	"time"
)

// stringTrimSpace trims whitespace from a string
func stringTrimSpace(s string) string {
	return strings.TrimSpace(s)
}

// sanitizeBranchName replaces disallowed characters with hyphens
var sanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9_./-]`)

func sanitizeBranchName(name string) string {
	return sanitizeRe.ReplaceAllString(strings.TrimSpace(name), "-")
}

// splitLines splits a string into lines, filtering empty strings
func splitLines(s string) []string {
	return strings.Split(s, "\n")
}

// hasSuffix returns true if s ends with suffix
func hasSuffix(s, suffix string) bool {
	return strings.HasSuffix(s, suffix)
}

// containsAny returns true if s contains any of the given substrings
func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// nowMs returns current time as Unix milliseconds
func nowMs() int64 {
	return time.Now().UnixMilli()
}
