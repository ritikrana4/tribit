package tribitserver

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

func registerRepoRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/repos", handleListRepos)
	mux.HandleFunc("POST /api/repos", handleAddRepo)
	mux.HandleFunc("DELETE /api/repos", handleDeleteRepo)
	mux.HandleFunc("POST /api/repos/switch", handleSwitchRepo)
	mux.HandleFunc("GET /api/all-worktrees", handleAllWorktrees)
	mux.HandleFunc("POST /api/open-folder", handleOpenFolder)
	mux.HandleFunc("POST /api/open-vscode", handleOpenVSCode)
	mux.HandleFunc("GET /api/pick-folder", handlePickFolder)
}

func handleListRepos(w http.ResponseWriter, r *http.Request) {
	root := GetGitRoot()
	active := root
	if active == "" {
		active = GetRepoDir()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"repos":  ReadRepos(),
		"active": active,
	})
}

func handleAddRepo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepoPath string `json:"repoPath"`
		Name     string `json:"name"`
		Color    string `json:"color"`
		Icon     string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	rp := stringTrimSpace(body.RepoPath)
	if rp == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "repoPath required"})
		return
	}

	// Expand ~
	if strings.HasPrefix(rp, "~/") {
		home, _ := os.UserHomeDir()
		rp = filepath.Join(home, rp[2:])
	}
	abs, _ := filepath.Abs(rp)

	root, err := GetMainRepoRoot(abs)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "Not a git repository: " + abs,
		})
		return
	}

	repos := ReadRepos()
	idx := -1
	for i, rep := range repos {
		if rep.Path == root {
			idx = i
			break
		}
	}

	name := stringTrimSpace(body.Name)
	color := body.Color
	icon := body.Icon

	var entry Repo
	if idx >= 0 {
		existing := repos[idx]
		if name == "" {
			name = existing.Name
		}
		if color == "" {
			color = existing.Color
		}
		if icon == "" {
			icon = existing.Icon
		}
		entry = Repo{Path: root, Name: name, Color: color, Icon: icon}
		repos[idx] = entry
	} else {
		if name == "" {
			name = filepath.Base(root)
		}
		entry = Repo{Path: root, Name: name, Color: color, Icon: icon}
		repos = append(repos, entry)
	}
	SaveRepos(repos)
	writeJSON(w, http.StatusOK, entry)
}

func handleDeleteRepo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepoPath string `json:"repoPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.RepoPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "repoPath required"})
		return
	}

	repos := ReadRepos()
	var filtered []Repo
	for _, rep := range repos {
		if rep.Path != body.RepoPath {
			filtered = append(filtered, rep)
		}
	}
	if filtered == nil {
		filtered = []Repo{}
	}
	SaveRepos(filtered)
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleSwitchRepo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RepoPath string `json:"repoPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.RepoPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "repoPath required"})
		return
	}

	SetRepoDir(body.RepoPath)
	root := GetGitRoot()
	if root == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Not a git repository"})
		return
	}

	repos := ReadRepos()
	found := false
	for _, rep := range repos {
		if rep.Path == root {
			found = true
			break
		}
	}
	if !found {
		repos = append(repos, Repo{Path: root, Name: filepath.Base(root)})
		SaveRepos(repos)
	}

	InvalidateStatusCache()
	SetupWatchers(root)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"root":     root,
		"repoName": filepath.Base(root),
	})
}

func handleAllWorktrees(w http.ResponseWriter, r *http.Request) {
	repos := ReadRepos()

	type repoWt struct {
		Path     string `json:"path"`
		Branch   string `json:"branch"`
		Name     string `json:"name"`
		RepoPath string `json:"repoPath"`
		RepoName string `json:"repoName"`
	}

	type repoResult struct {
		idx     int
		results []repoWt
	}

	resultsCh := make([][]repoWt, len(repos))
	var wg sync.WaitGroup

	for i, repo := range repos {
		wg.Add(1)
		go func(idx int, repo Repo) {
			defer wg.Done()
			wts, err := ParseWorktreeList(repo.Path)
			if err != nil {
				resultsCh[idx] = []repoWt{}
				return
			}
			rn := repo.Name
			if rn == "" {
				rn = filepath.Base(repo.Path)
			}
			var items []repoWt
			for _, wt := range wts {
				name := wt.Branch
				if name == "" {
					name = filepath.Base(wt.Path)
				}
				items = append(items, repoWt{
					Path:     wt.Path,
					Branch:   wt.Branch,
					Name:     name,
					RepoPath: repo.Path,
					RepoName: rn,
				})
			}
			resultsCh[idx] = items
		}(i, repo)
	}

	wg.Wait()

	var flat []repoWt
	for _, items := range resultsCh {
		flat = append(flat, items...)
	}
	if flat == nil {
		flat = []repoWt{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"worktrees": flat})
}

func handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DirPath string `json:"dirPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.DirPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "dirPath required"})
		return
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", body.DirPath)
	case "windows":
		cmd = exec.Command("explorer", body.DirPath)
	default:
		cmd = exec.Command("xdg-open", body.DirPath)
	}
	_ = cmd.Start()

	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handleOpenVSCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DirPath string `json:"dirPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "Invalid JSON"})
		return
	}

	if body.DirPath == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "dirPath required"})
		return
	}

	cmd := exec.Command("code", body.DirPath)
	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": `VS Code not found. Install the "code" CLI via VS Code > Shell Command > Install.`,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}

func handlePickFolder(w http.ResponseWriter, r *http.Request) {
	switch runtime.GOOS {
	case "darwin":
		script := "try\n  set f to POSIX path of (choose folder with prompt \"Select a git repository:\")\n  return f\non error\n  return \"\"\nend try"
		tmpFile := filepath.Join(os.TempDir(), "tribit-pick.scpt")
		_ = os.WriteFile(tmpFile, []byte(script), 0644)
		out, _ := exec.Command("osascript", tmpFile).Output()
		_ = os.Remove(tmpFile)
		p := strings.TrimRight(strings.TrimSpace(string(out)), "/")
		if p == "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{"path": nil})
		} else {
			writeJSON(w, http.StatusOK, map[string]interface{}{"path": p})
		}
	case "windows":
		ps := `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Select a git repository'; $d.ValidateNames = $false; $d.CheckFileExists = $false; $d.CheckPathExists = $true; $d.FileName = 'Select Folder'; if ($d.ShowDialog() -eq 'OK') { [IO.Path]::GetDirectoryName($d.FileName) }`
		out, _ := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps).Output()
		p := strings.TrimSpace(string(out))
		if p == "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{"path": nil})
		} else {
			writeJSON(w, http.StatusOK, map[string]interface{}{"path": p})
		}
	default:
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"path":  nil,
			"error": "Folder picker not supported on this platform",
		})
	}
}
