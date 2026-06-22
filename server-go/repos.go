package tribitserver

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Repo represents a stored repository entry
type Repo struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

func reposFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".tribit", "repos.json")
}

// ReadRepos reads the repos.json file from ~/.tribit/
func ReadRepos() []Repo {
	data, err := os.ReadFile(reposFilePath())
	if err != nil {
		return []Repo{}
	}
	var repos []Repo
	if err := json.Unmarshal(data, &repos); err != nil {
		return []Repo{}
	}
	return repos
}

// SaveRepos writes repos to ~/.tribit/repos.json, creating the dir if needed
func SaveRepos(repos []Repo) {
	p := reposFilePath()
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	data, err := json.MarshalIndent(repos, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(p, data, 0644)
}
