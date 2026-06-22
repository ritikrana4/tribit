package tribitserver

import (
	"encoding/json"
	"net/http"
	"path/filepath"
)

func registerSessionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions", handleListSessions)
	mux.HandleFunc("POST /api/sessions/create", handleCreateSession)
	mux.HandleFunc("POST /api/sessions/kill-all", handleKillAllSessions)
	mux.HandleFunc("PATCH /api/sessions/rename", handleRenameSession)
}

func handleListSessions(w http.ResponseWriter, r *http.Request) {
	var result []map[string]interface{}
	var toDelete []string

	sessions.Range(func(k, v interface{}) bool {
		id := k.(string)
		s := v.(*Session)
		if !IsAlive(s) {
			toDelete = append(toDelete, id)
			return true
		}
		pid := 0
		if s.Cmd != nil && s.Cmd.Process != nil {
			pid = s.Cmd.Process.Pid
		}
		result = append(result, map[string]interface{}{
			"sessionId":    s.SessionID,
			"wtPath":       s.WtPath,
			"title":        s.Title,
			"pid":          pid,
			"alive":        s.Alive,
			"createdAt":    s.CreatedAt,
			"lastActivity": s.LastActivity,
		})
		return true
	})

	for _, id := range toDelete {
		sessions.Delete(id)
	}

	if result == nil {
		result = []map[string]interface{}{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"sessions": result})
}

func handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WtPath string `json:"wtPath"`
		Agent  string `json:"agent"`
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

	s := CreateSession(body.WtPath, agent)
	if s == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": "Failed to create session"})
		return
	}
	s.Title = title
	sessions.Store(s.SessionID, s)
	DebouncedBroadcast()

	sessionNumber := len(GetSessionsForWorktree(body.WtPath))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sessionId":     s.SessionID,
		"title":         title,
		"sessionNumber": sessionNumber,
	})
}

func handleKillAllSessions(w http.ResponseWriter, r *http.Request) {
	sessions.Range(func(k, v interface{}) bool {
		id := k.(string)
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
		sessions.Delete(id)
		return true
	})
	DebouncedBroadcast()
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleRenameSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"sessionId"`
		Name      string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "sessionId and name required"})
		return
	}

	v, ok := sessions.Load(body.SessionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{"error": "Session not found"})
		return
	}
	s := v.(*Session)
	name := stringTrimSpace(body.Name)
	if name == "" {
		s.CustomName = ""
	} else {
		s.CustomName = name
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}
