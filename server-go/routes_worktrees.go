package tribitserver

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"sync"
)

func registerWorktreeRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/worktrees", handleListWorktrees)
	mux.HandleFunc("POST /api/worktrees", handleCreateWorktree)
	mux.HandleFunc("DELETE /api/worktrees", handleDeleteWorktree)
	mux.HandleFunc("PATCH /api/positions", handleUpdatePosition)
	mux.HandleFunc("POST /api/worktrees/open-copilot", handleOpenCopilot)
	mux.HandleFunc("POST /api/worktrees/kill-terminal", handleKillTerminal)
	mux.HandleFunc("GET /api/branches", handleListBranches)
}

// worktreeResponse is the JSON shape for a single worktree in the list response
type worktreeResponse struct {
	Path         string      `json:"path"`
	Branch       string      `json:"branch"`
	Head         string      `json:"head"`
	Bare         bool        `json:"bare"`
	Detached     bool        `json:"detached"`
	IsMain       bool        `json:"isMain"`
	Name         string      `json:"name"`
	Status       string      `json:"status"`
	FilesChanged int         `json:"filesChanged"`
	Additions    int         `json:"additions"`
	Deletions    int         `json:"deletions"`
	HasTerminal  bool        `json:"hasTerminal"`
	SessionCount int         `json:"sessionCount"`
	SessionID    interface{} `json:"sessionId"`
	SessionPID   interface{} `json:"sessionPid"`
	Sessions     interface{} `json:"sessions"`
	Description  string      `json:"description"`
	Position     interface{} `json:"position"`
	BaseBranch   interface{} `json:"baseBranch"`
}

type sessionInfo struct {
	SessionID    string      `json:"sessionId"`
	PID          int         `json:"pid"`
	Alive        bool        `json:"alive"`
	CustomName   interface{} `json:"customName"`
	CreatedAt    int64       `json:"createdAt"`
	LastActivity int64       `json:"lastActivity"`
}

func handleListWorktrees(w http.ResponseWriter, r *http.Request) {
	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	meta := ReadMeta(root)
	wts, err := ParseWorktreeList(root)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}

	type result struct {
		idx int
		wt  worktreeResponse
	}

	results := make([]worktreeResponse, len(wts))
	var wg sync.WaitGroup

	for i, wt := range wts {
		wg.Add(1)
		go func(idx int, wt WorktreeEntry) {
			defer wg.Done()

			wtSessions := GetSessionsForWorktree(wt.Path)
			var latest *Session
			if len(wtSessions) > 0 {
				latest = wtSessions[0]
			}

			// Concurrent status + branch base
			statusCh := make(chan WorktreeStatus, 1)
			baseCh := make(chan string, 1)

			go func() {
				statusCh <- GetWorktreeStatusCached(wt.Path)
			}()
			go func() {
				if wt.Branch != "" {
					baseCh <- GetBranchBaseCached(wt.Path, wt.Branch)
				} else {
					baseCh <- ""
				}
			}()

			wtStatus := <-statusCh
			baseBranch := <-baseCh

			name := wt.Branch
			if name == "" {
				name = filepath.Base(wt.Path)
			}

			// Build session infos
			sessInfos := make([]sessionInfo, 0, len(wtSessions))
			for _, s := range wtSessions {
				var cn interface{} = nil
				if s.CustomName != "" {
					cn = s.CustomName
				}
				pid := 0
				if s.Cmd != nil && s.Cmd.Process != nil {
					pid = s.Cmd.Process.Pid
				}
				sessInfos = append(sessInfos, sessionInfo{
					SessionID:    s.SessionID,
					PID:          pid,
					Alive:        s.Alive,
					CustomName:   cn,
					CreatedAt:    s.CreatedAt,
					LastActivity: s.LastActivity,
				})
			}

			var sessionID interface{} = nil
			var sessionPID interface{} = nil
			if latest != nil {
				sessionID = latest.SessionID
				if latest.Cmd != nil && latest.Cmd.Process != nil {
					sessionPID = latest.Cmd.Process.Pid
				}
			}

			m := meta[wt.Path]
			var pos interface{} = nil
			if m.Position != nil {
				pos = m.Position
			}

			var bb interface{} = nil
			if baseBranch != "" {
				bb = baseBranch
			}

			results[idx] = worktreeResponse{
				Path:         wt.Path,
				Branch:       wt.Branch,
				Head:         wt.Head,
				Bare:         wt.Bare,
				Detached:     wt.Detached,
				IsMain:       idx == 0,
				Name:         name,
				Status:       wtStatus.Status,
				FilesChanged: wtStatus.FilesChanged,
				Additions:    wtStatus.Additions,
				Deletions:    wtStatus.Deletions,
				HasTerminal:  len(wtSessions) > 0,
				SessionCount: len(wtSessions),
				SessionID:    sessionID,
				SessionPID:   sessionPID,
				Sessions:     sessInfos,
				Description:  m.Description,
				Position:     pos,
				BaseBranch:   bb,
			}
		}(i, wt)
	}

	wg.Wait()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"worktrees": results,
		"root":      root,
	})
}

func handleCreateWorktree(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Branch      string `json:"branch"`
		IsNewBranch bool   `json:"isNewBranch"`
		Description string `json:"description"`
		FromBranch  string `json:"fromBranch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	branch := stringTrimSpace(body.Branch)
	if branch == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Branch name is required"})
		return
	}

	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	sanitized := sanitizeBranchName(branch)
	wtPath := filepath.Join(filepath.Dir(root), sanitized)

	var args []string
	if body.IsNewBranch {
		from := stringTrimSpace(body.FromBranch)
		if from != "" {
			args = []string{"worktree", "add", "-b", sanitized, wtPath, from}
		} else {
			args = []string{"worktree", "add", "-b", sanitized, wtPath}
		}
	} else {
		args = []string{"worktree", "add", wtPath, sanitized}
	}

	_, err := runGit(args, root)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}

	if desc := stringTrimSpace(body.Description); desc != "" {
		meta := ReadMeta(root)
		entry := meta[wtPath]
		entry.Description = desc
		meta[wtPath] = entry
		SaveMeta(root, meta)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"path":   wtPath,
		"branch": sanitized,
	})
}

func handleDeleteWorktree(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WtPath string `json:"wtPath"`
		Force  bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.WtPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "path is required"})
		return
	}

	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	args := []string{"worktree", "remove"}
	if body.Force {
		args = append(args, "--force")
	}
	args = append(args, body.WtPath)

	_, err := runGit(args, root)
	if err != nil {
		msg := err.Error()
		canForce := containsAny(msg, "modified", "changes", "dirty")
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error":    msg,
			"canForce": canForce,
		})
		return
	}

	// Kill sessions for this worktree
	sessions.Range(func(k, v interface{}) bool {
		id := k.(string)
		s := v.(*Session)
		if s.WtPath == body.WtPath {
			s.mu.Lock()
			s.Alive = false
			s.mu.Unlock()
			if s.PTY != nil {
				_ = s.PTY.Close()
			}
			if s.Cmd != nil && s.Cmd.Process != nil {
				_ = s.Cmd.Process.Kill()
			}
			sessions.Delete(id)
		}
		return true
	})

	// Clean meta
	meta := ReadMeta(root)
	delete(meta, body.WtPath)
	SaveMeta(root, meta)

	// Invalidate status cache entry
	deleteStatusCacheEntry(body.WtPath)

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleUpdatePosition(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WtPath   string      `json:"wtPath"`
		Position interface{} `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.WtPath == "" || body.Position == nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "wtPath and position required"})
		return
	}

	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	meta := ReadMeta(root)
	entry := meta[body.WtPath]
	entry.Position = body.Position
	meta[body.WtPath] = entry
	SaveMeta(root, meta)

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleOpenCopilot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WtPath    string `json:"wtPath"`
		SessionID string `json:"sessionId"`
		Agent     string `json:"agent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.WtPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "path is required"})
		return
	}

	agent := body.Agent
	if agent == "" {
		agent = "claude"
	}

	root := GetGitRoot()
	title := filepath.Base(body.WtPath)
	if root != "" {
		wts, err := ParseWorktreeList(root)
		if err == nil {
			for _, wt := range wts {
				if wt.Path == body.WtPath {
					if wt.Branch != "" {
						title = wt.Branch
					}
					break
				}
			}
		}
	}

	// Check requested session
	if body.SessionID != "" {
		if v, ok := sessions.Load(body.SessionID); ok {
			s := v.(*Session)
			if IsAlive(s) {
				s.LastActivity = nowMs()
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"action":    "existing",
					"sessionId": body.SessionID,
					"title":     title,
				})
				return
			}
		}
	}

	// Check existing sessions for this worktree
	existing := GetSessionsForWorktree(body.WtPath)
	if len(existing) > 0 {
		existing[0].LastActivity = nowMs()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"action":    "existing",
			"sessionId": existing[0].SessionID,
			"title":     title,
		})
		return
	}

	// Create new session
	s := CreateSession(body.WtPath, agent)
	if s == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "Failed to create session"})
		return
	}
	s.Title = title
	sessions.Store(s.SessionID, s)
	DebouncedBroadcast()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"action":    "created",
		"sessionId": s.SessionID,
		"title":     title,
	})
}

func handleKillTerminal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "sessionId is required"})
		return
	}

	if v, ok := sessions.Load(body.SessionID); ok {
		s := v.(*Session)
		s.mu.Lock()
		s.Alive = false
		s.mu.Unlock()
		if s.PTY != nil {
			_ = s.PTY.Close()
		}
		if s.Cmd != nil && s.Cmd.Process != nil {
			_ = s.Cmd.Process.Kill()
		}
	}
	sessions.Delete(body.SessionID)
	DebouncedBroadcast()

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleListBranches(w http.ResponseWriter, r *http.Request) {
	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	out, err := runGit([]string{"branch", "-a", "--format=%(refname:short)"}, root)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}

	var branches []string
	for _, b := range splitLines(out) {
		b = stringTrimSpace(b)
		if b != "" && !hasSuffix(b, "/HEAD") {
			branches = append(branches, b)
		}
	}

	current := ""
	cur, err2 := runGit([]string{"branch", "--show-current"}, root)
	if err2 == nil {
		current = stringTrimSpace(cur)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"branches": branches,
		"current":  current,
	})
}
