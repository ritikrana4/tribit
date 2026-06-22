package tribitserver

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "__pycache__": true,
	".next": true, ".nuxt": true, "dist": true, ".cache": true,
	"coverage": true, ".turbo": true, "out": true, "build": true,
}

func registerFileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/diff", handleDiff)
	mux.HandleFunc("GET /api/files/tree", handleFilesTree)
	mux.HandleFunc("GET /api/files/read", handleFilesRead)
	mux.HandleFunc("POST /api/files/write", handleFilesWrite)
	mux.HandleFunc("GET /api/git/original", handleGitOriginal)
}

func handleDiff(w http.ResponseWriter, r *http.Request) {
	repoPath := r.URL.Query().Get("repoPath")
	if repoPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "repoPath required"})
		return
	}

	diff := ""
	out, err := runGit([]string{"diff", "HEAD"}, repoPath)
	if err == nil {
		diff = out
	} else {
		out2, err2 := runGit([]string{"diff", "--cached"}, repoPath)
		if err2 == nil {
			diff = out2
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"diff": diff})
}

type fileTreeNode struct {
	Type     string         `json:"type"`
	Name     string         `json:"name"`
	Path     string         `json:"path"`
	Children []fileTreeNode `json:"children,omitempty"`
}

func buildTree(dirPath string, maxDepth, depth int) []fileTreeNode {
	if depth > maxDepth {
		return nil
	}
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil
	}

	var dirs, files []fileTreeNode
	for _, e := range entries {
		if skipDirs[e.Name()] {
			continue
		}
		full := filepath.Join(dirPath, e.Name())
		if e.IsDir() {
			children := buildTree(full, maxDepth, depth+1)
			if children == nil {
				children = []fileTreeNode{}
			}
			dirs = append(dirs, fileTreeNode{Type: "dir", Name: e.Name(), Path: full, Children: children})
		} else if e.Type().IsRegular() {
			files = append(files, fileTreeNode{Type: "file", Name: e.Name(), Path: full})
		}
	}

	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })

	return append(dirs, files...)
}

func handleFilesTree(w http.ResponseWriter, r *http.Request) {
	dirPath := r.URL.Query().Get("dirPath")
	if dirPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "dirPath required"})
		return
	}

	tree := buildTree(dirPath, 8, 0)
	if tree == nil {
		tree = []fileTreeNode{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"tree": tree})
}

func handleFilesRead(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("filePath")
	if filePath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "filePath required"})
		return
	}

	info, err := os.Stat(filePath)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": err.Error()})
		return
	}
	if info.Size() > 2*1024*1024 {
		writeJSON(w, http.StatusOK, map[string]interface{}{"error": "File too large"})
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"content": string(data)})
}

func handleFilesWrite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath string  `json:"filePath"`
		Content  *string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.FilePath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "filePath required"})
		return
	}

	content := ""
	if body.Content != nil {
		content = *body.Content
	}

	if err := os.WriteFile(body.FilePath, []byte(content), 0644); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleGitOriginal(w http.ResponseWriter, r *http.Request) {
	repoPath := r.URL.Query().Get("repoPath")
	filePath := r.URL.Query().Get("filePath")
	if repoPath == "" || filePath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "repoPath and filePath required"})
		return
	}

	out, err := runGit([]string{"show", "HEAD:" + filePath}, repoPath)
	if err != nil {
		// new file — not yet committed
		writeJSON(w, http.StatusOK, map[string]interface{}{"content": ""})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"content": out})
}
