package tribitserver

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// gitResult holds the output and error from an async git command
type gitResult struct {
	out string
	err error
}

// runGit runs a git command synchronously with a 10s timeout
func runGit(args []string, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// runGitAsync runs git in a goroutine and returns a result channel
func runGitAsync(args []string, cwd string) <-chan gitResult {
	ch := make(chan gitResult, 1)
	go func() {
		out, err := runGit(args, cwd)
		ch <- gitResult{out: out, err: err}
	}()
	return ch
}

// GetMainRepoRoot resolves any worktree path back to the primary repo root
func GetMainRepoRoot(cwd string) (string, error) {
	return computeGitRoot(cwd)
}

// WorktreeEntry represents a single git worktree
type WorktreeEntry struct {
	Path     string `json:"path"`
	Branch   string `json:"branch"`
	Head     string `json:"head"`
	Bare     bool   `json:"bare"`
	Detached bool   `json:"detached"`
}

// parseWorktreeOutput parses the porcelain output of git worktree list
func parseWorktreeOutput(output string) []WorktreeEntry {
	var entries []WorktreeEntry
	blocks := strings.Split(strings.TrimSpace(output), "\n\n")
	for _, block := range blocks {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}
		var wt WorktreeEntry
		for _, line := range strings.Split(block, "\n") {
			switch {
			case strings.HasPrefix(line, "worktree "):
				wt.Path = strings.TrimSpace(line[9:])
			case strings.HasPrefix(line, "HEAD "):
				wt.Head = strings.TrimSpace(line[5:])
			case strings.HasPrefix(line, "branch "):
				br := strings.TrimSpace(line[7:])
				wt.Branch = strings.TrimPrefix(br, "refs/heads/")
			case line == "bare":
				wt.Bare = true
			case line == "detached":
				wt.Detached = true
			}
		}
		if wt.Path != "" {
			entries = append(entries, wt)
		}
	}
	return entries
}

// ParseWorktreeList runs git worktree list --porcelain and parses the output
func ParseWorktreeList(root string) ([]WorktreeEntry, error) {
	out, err := runGit([]string{"worktree", "list", "--porcelain"}, root)
	if err != nil {
		return nil, err
	}
	return parseWorktreeOutput(out), nil
}

// WorktreeStatus holds git status information for a worktree
type WorktreeStatus struct {
	Status       string `json:"status"`
	FilesChanged int    `json:"filesChanged"`
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
}

// GetWorktreeStatus runs git status --porcelain and git diff --shortstat HEAD
func GetWorktreeStatus(wtPath string) WorktreeStatus {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = wtPath
	out, err := cmd.Output()
	if err != nil {
		return WorktreeStatus{Status: "unknown"}
	}
	if strings.TrimSpace(string(out)) == "" {
		return WorktreeStatus{Status: "clean"}
	}

	// dirty — get shortstat
	ctx2, cancel2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel2()
	cmd2 := exec.CommandContext(ctx2, "git", "diff", "--shortstat", "HEAD")
	cmd2.Dir = wtPath
	s, err := cmd2.Output()
	if err != nil {
		return WorktreeStatus{Status: "dirty"}
	}
	return parseShortstat(strings.TrimSpace(string(s)))
}

var (
	reFiles = regexp.MustCompile(`(\d+) file`)
	reIns   = regexp.MustCompile(`(\d+) insertion`)
	reDel   = regexp.MustCompile(`(\d+) deletion`)
)

func parseShortstat(s string) WorktreeStatus {
	ws := WorktreeStatus{Status: "dirty"}
	if m := reFiles.FindStringSubmatch(s); m != nil {
		ws.FilesChanged, _ = strconv.Atoi(m[1])
	}
	if m := reIns.FindStringSubmatch(s); m != nil {
		ws.Additions, _ = strconv.Atoi(m[1])
	}
	if m := reDel.FindStringSubmatch(s); m != nil {
		ws.Deletions, _ = strconv.Atoi(m[1])
	}
	return ws
}

// GetWorktreeStatusCached returns status using the 3s TTL cache
func GetWorktreeStatusCached(wtPath string) WorktreeStatus {
	if s, ok := getStatusCacheEntry(wtPath); ok {
		return s
	}
	s := GetWorktreeStatus(wtPath)
	setStatusCacheEntry(wtPath, s)
	return s
}

// GetBranchBase walks the reflog to find the branch creation point
func GetBranchBase(wtPath, branch string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "reflog", "show", "--format=%gs", branch)
	cmd.Dir = wtPath
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	// reverse to get oldest first
	for i, j := 0, len(lines)-1; i < j; i, j = i+1, j-1 {
		lines[i], lines[j] = lines[j], lines[i]
	}
	reCreated := regexp.MustCompile(`branch: Created from (?:refs/heads/)?(.+)`)
	reCheckout := regexp.MustCompile(`checkout: moving from (.+) to `)
	for _, line := range lines {
		if m := reCreated.FindStringSubmatch(line); m != nil {
			return strings.TrimSpace(m[1])
		}
		if m := reCheckout.FindStringSubmatch(line); m != nil {
			return strings.TrimSpace(m[1])
		}
	}
	return ""
}

// GetBranchBaseCached returns the branch base using the 60s TTL cache
func GetBranchBaseCached(wtPath, branch string) string {
	key := wtPath + ":" + branch
	if base, ok := getBranchCacheEntry(key); ok {
		return base
	}
	base := GetBranchBase(wtPath, branch)
	setBranchCacheEntry(key, base)
	return base
}
