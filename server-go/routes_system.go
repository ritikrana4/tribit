package tribitserver

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func registerSystemRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/status", handleStatus)
	mux.HandleFunc("POST /api/git-init", handleGitInit)
	mux.HandleFunc("GET /api/events", handleEvents)
	mux.HandleFunc("POST /api/shutdown", handleShutdown)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Not a git repository. Run tribit from inside a git repo.",
			"cwd":   GetRepoDir(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"root":     root,
		"repoName": filepath.Base(root),
		"ok":       true,
	})
}

func handleGitInit(w http.ResponseWriter, r *http.Request) {
	repoDir := GetRepoDir()
	out, err := runGit([]string{"init"}, repoDir)
	_ = out
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	repos := ReadRepos()
	found := false
	for _, rep := range repos {
		if rep.Path == repoDir {
			found = true
			break
		}
	}
	if !found {
		repos = append(repos, Repo{
			Path: repoDir,
			Name: filepath.Base(repoDir),
		})
		SaveRepos(repos)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":   true,
		"path": repoDir,
	})
}

func handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if f, ok := w.(http.Flusher); ok {
		_, _ = w.Write([]byte("data: connected\n\n"))
		f.Flush()
	}

	AddSSEClient(w)
	defer RemoveSSEClient(w)

	<-r.Context().Done()
}

func handleShutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	go func() {
		time.Sleep(150 * time.Millisecond)
		KillAllSessions()
		os.Exit(0)
	}()
}

// writeJSON writes a JSON response with the given status code
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
