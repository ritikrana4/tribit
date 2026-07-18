package tribitserver

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type ClaudeMDFile struct {
	Path    string `json:"path"`
	Label   string `json:"label"`
	Content string `json:"content"`
	Scope   string `json:"scope"` // "global" | "project" | "subdir"
}

type MemoryFile struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

type ContextData struct {
	ClaudeMDFiles []ClaudeMDFile `json:"claudeMdFiles"`
	MemoryFiles   []MemoryFile   `json:"memoryFiles"`
}

func registerContextRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/context", handleGetContext)
	mux.HandleFunc("POST /api/context/save", handleSaveContextFile)
}

func handleGetContext(w http.ResponseWriter, r *http.Request) {
	wtPath := r.URL.Query().Get("wtPath")
	if wtPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "wtPath required"})
		return
	}

	homeDir, _ := os.UserHomeDir()
	claudeMdFiles := []ClaudeMDFile{}
	memoryFiles := []MemoryFile{}

	// 1. Global CLAUDE.md: ~/.claude/CLAUDE.md
	globalPath := filepath.Join(homeDir, ".claude", "CLAUDE.md")
	seen := map[string]bool{globalPath: true}
	if content, err := os.ReadFile(globalPath); err == nil {
		claudeMdFiles = append(claudeMdFiles, ClaudeMDFile{
			Path:    globalPath,
			Label:   "~/.claude/CLAUDE.md",
			Content: string(content),
			Scope:   "global",
		})
	}

	// 2. Resolve git root so we can tag the project-level CLAUDE.md correctly
	gitRoot, _ := GetMainRepoRoot(wtPath)

	// 3. Walk up from wtPath collecting CLAUDE.md files, stopping at git root
	current := wtPath
	for i := 0; i < 20; i++ {
		claudeMdPath := filepath.Join(current, "CLAUDE.md")
		if !seen[claudeMdPath] {
			seen[claudeMdPath] = true
			if content, err := os.ReadFile(claudeMdPath); err == nil {
				scope := "subdir"
				if current == gitRoot || (gitRoot == "" && current == wtPath) {
					scope = "project"
				}
				label := claudeMdPath
				if homeDir != "" && strings.HasPrefix(claudeMdPath, homeDir) {
					label = "~" + claudeMdPath[len(homeDir):]
				}
				claudeMdFiles = append(claudeMdFiles, ClaudeMDFile{
					Path:    claudeMdPath,
					Label:   label,
					Content: string(content),
					Scope:   scope,
				})
			}
		}
		parent := filepath.Dir(current)
		if parent == current || current == gitRoot {
			break
		}
		current = parent
	}

	// 4. Memory files — Claude Code tracks memory at the git root level
	projectPath := wtPath
	if gitRoot != "" {
		projectPath = gitRoot
	}
	memoryDir := claudeMemoryDir(homeDir, projectPath)
	if entries, err := os.ReadDir(memoryDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
				continue
			}
			filePath := filepath.Join(memoryDir, entry.Name())
			content, err := os.ReadFile(filePath)
			if err != nil {
				continue
			}
			memoryFiles = append(memoryFiles, MemoryFile{
				Path:    filePath,
				Name:    entry.Name(),
				Content: string(content),
			})
		}
	}

	writeJSON(w, http.StatusOK, ContextData{
		ClaudeMDFiles: claudeMdFiles,
		MemoryFiles:   memoryFiles,
	})
}

func handleSaveContextFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid JSON"})
		return
	}
	if body.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "path required"})
		return
	}
	if err := os.WriteFile(body.Path, []byte(body.Content), 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

// claudeMemoryDir returns Claude Code's memory directory for a given project path.
// Claude Code sanitizes the path by replacing "/" with "-".
func claudeMemoryDir(homeDir, projectPath string) string {
	sanitized := strings.ReplaceAll(projectPath, "/", "-")
	return filepath.Join(homeDir, ".claude", "projects", sanitized, "memory")
}
