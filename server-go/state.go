package tribitserver

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// repoDir is the active repo directory (changes when user switches repos)
var repoDir string

// gitRoot is the computed git common dir parent for the current repoDir
var gitRoot string
var repoMu sync.RWMutex

// MetaEntry stores per-worktree metadata persisted in .tribit-meta.json
type MetaEntry struct {
	Description string      `json:"description,omitempty"`
	Position    interface{} `json:"position,omitempty"`
}

// GetRepoDir returns the current repo directory (thread-safe)
func GetRepoDir() string {
	repoMu.RLock()
	defer repoMu.RUnlock()
	return repoDir
}

// GetGitRoot returns the current git root (thread-safe)
func GetGitRoot() string {
	repoMu.RLock()
	defer repoMu.RUnlock()
	return gitRoot
}

// SetRepoDir updates repoDir and recomputes gitRoot
func SetRepoDir(dir string) {
	repoMu.Lock()
	defer repoMu.Unlock()
	repoDir = dir
	root, err := computeGitRoot(dir)
	if err != nil {
		gitRoot = ""
	} else {
		gitRoot = root
	}
}

// computeGitRoot runs git rev-parse --git-common-dir and resolves the parent
func computeGitRoot(cwd string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--git-common-dir")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	common := strings.TrimSpace(string(out))
	var abs string
	if filepath.IsAbs(common) {
		abs = common
	} else {
		abs = filepath.Join(cwd, common)
	}
	return filepath.Dir(abs), nil
}

// ── Status cache ─────────────────────────────────────────────────────────────

type statusCacheEntry struct {
	result    WorktreeStatus
	expiresAt time.Time
}

var (
	statusCacheMu sync.RWMutex
	statusCacheMap = make(map[string]statusCacheEntry)
)

const statusTTL = 3 * time.Second

// InvalidateStatusCache clears all status cache entries
func InvalidateStatusCache() {
	statusCacheMu.Lock()
	statusCacheMap = make(map[string]statusCacheEntry)
	statusCacheMu.Unlock()
}

func getStatusCacheEntry(wtPath string) (WorktreeStatus, bool) {
	statusCacheMu.RLock()
	defer statusCacheMu.RUnlock()
	e, ok := statusCacheMap[wtPath]
	if !ok || time.Now().After(e.expiresAt) {
		return WorktreeStatus{}, false
	}
	return e.result, true
}

func setStatusCacheEntry(wtPath string, s WorktreeStatus) {
	statusCacheMu.Lock()
	statusCacheMap[wtPath] = statusCacheEntry{result: s, expiresAt: time.Now().Add(statusTTL)}
	statusCacheMu.Unlock()
}

func deleteStatusCacheEntry(wtPath string) {
	statusCacheMu.Lock()
	delete(statusCacheMap, wtPath)
	statusCacheMu.Unlock()
}

// ── Branch base cache ─────────────────────────────────────────────────────────

type branchCacheEntry struct {
	base      string
	expiresAt time.Time
}

var (
	branchCacheMu  sync.RWMutex
	branchCacheMap = make(map[string]branchCacheEntry)
)

const branchBaseTTL = 60 * time.Second

func getBranchCacheEntry(key string) (string, bool) {
	branchCacheMu.RLock()
	defer branchCacheMu.RUnlock()
	e, ok := branchCacheMap[key]
	if !ok || time.Now().After(e.expiresAt) {
		return "", false
	}
	return e.base, true
}

func setBranchCacheEntry(key, base string) {
	branchCacheMu.Lock()
	branchCacheMap[key] = branchCacheEntry{base: base, expiresAt: time.Now().Add(branchBaseTTL)}
	branchCacheMu.Unlock()
}

// ── Meta file ─────────────────────────────────────────────────────────────────

func getMetaPath(root string) string {
	cmd := exec.Command("git", "rev-parse", "--git-common-dir")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return filepath.Join(root, ".git", "tribit-meta.json")
	}
	common := strings.TrimSpace(string(out))
	var abs string
	if filepath.IsAbs(common) {
		abs = common
	} else {
		abs = filepath.Join(root, common)
	}
	return filepath.Join(abs, "tribit-meta.json")
}

// ReadMeta reads the tribit-meta.json from the git common dir
func ReadMeta(root string) map[string]MetaEntry {
	p := getMetaPath(root)
	data, err := os.ReadFile(p)
	if err != nil {
		return map[string]MetaEntry{}
	}
	var m map[string]MetaEntry
	if err := json.Unmarshal(data, &m); err != nil {
		return map[string]MetaEntry{}
	}
	return m
}

// SaveMeta writes the tribit-meta.json to the git common dir
func SaveMeta(root string, meta map[string]MetaEntry) {
	p := getMetaPath(root)
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(p, data, 0644)
}
