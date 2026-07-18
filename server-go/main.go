package tribitserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// NewMux creates the HTTP mux with all routes registered and state initialized for cwd.
// An optional fs.FS may be passed to serve static assets from an embedded filesystem
// (e.g. in the Wails desktop app); omit it to serve from disk instead.
func NewMux(cwd string, distFS ...fs.FS) *http.ServeMux {
	_ = os.Setenv("TRIBIT_CWD", cwd)
	SetRepoDir(cwd)
	initRepo()

	mux := http.NewServeMux()
	registerSystemRoutes(mux)
	registerWorktreeRoutes(mux)
	registerSessionRoutes(mux)
	registerRepoRoutes(mux)
	registerFileRoutes(mux)
	registerContextRoutes(mux)
	mux.HandleFunc("GET /ws/terminal", handleWSTerminal)

	var embeddedFS fs.FS
	if len(distFS) > 0 && distFS[0] != nil {
		embeddedFS = distFS[0]
	}

	if embeddedFS != nil {
		fileServer := http.FileServerFS(embeddedFS)
		mux.Handle("GET /assets/", fileServer)
		mux.Handle("GET /favicon.ico", fileServer)
		mux.HandleFunc("/", spaFallbackFS(embeddedFS))
	} else {
		distPath := locateDistDir()
		if _, err := os.Stat(distPath); err == nil {
			fileServer := http.FileServer(http.Dir(distPath))
			mux.Handle("GET /assets/", fileServer)
			mux.Handle("GET /favicon.ico", fileServer)
		}
		mux.HandleFunc("/", spaFallback(distPath))
	}

	return mux
}

// Run is the CLI entry point: reads env, starts the HTTP server, blocks until signal.
func Run() {
	cwd := os.Getenv("TRIBIT_CWD")
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			cwd = "."
		}
	}

	defaultPort := 7700
	if p := os.Getenv("PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			defaultPort = n
		}
	}
	port, err := FindFreePort(defaultPort)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to find free port: %v\n", err)
		os.Exit(1)
	}

	mux := NewMux(cwd)
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		CloseWatchers()
		KillAllSessions()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		os.Exit(0)
	}()

	fmt.Printf("tribit listening on :%d\n", port)

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

// FindFreePort finds a free TCP port starting from start.
func FindFreePort(start int) (int, error) {
	for port := start; port < start+100; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			_ = ln.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no free port found in range %d-%d", start, start+100)
}

// ── private helpers ───────────────────────────────────────────────────────────

func initRepo() {
	root := GetGitRoot()
	if root == "" {
		return
	}
	repos := ReadRepos()
	for _, r := range repos {
		if r.Path == root {
			SetupWatchers(root)
			return
		}
	}
	repos = append(repos, Repo{
		Path: root,
		Name: filepath.Base(root),
	})
	SaveRepos(repos)
	SetupWatchers(root)
}

func locateDistDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "dist"
	}
	dir := filepath.Dir(exe)
	for i := 0; i < 5; i++ {
		candidate := filepath.Join(dir, "dist")
		if _, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil {
			return candidate
		}
		dir = filepath.Dir(dir)
	}
	return filepath.Join(filepath.Dir(exe), "dist")
}

func spaFallback(distPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws/terminal" {
			http.NotFound(w, r)
			return
		}
		idx := filepath.Join(distPath, "index.html")
		if _, err := os.Stat(idx); err == nil {
			http.ServeFile(w, r, idx)
			return
		}
		http.Error(w, "Run `npm run build` first, or `npm run dev` for development.", http.StatusNotFound)
	}
}

func spaFallbackFS(fsys fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws/terminal" {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.Error(w, "index.html not found in embedded assets", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
	}
}

func handleWSTerminal(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		http.Error(w, "sessionId required", http.StatusBadRequest)
		return
	}

	v, ok := sessions.Load(sessionID)
	if !ok {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_ = ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "No active session"),
			time.Now().Add(time.Second))
		_ = ws.Close()
		return
	}

	s := v.(*Session)
	if !IsAlive(s) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_ = ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "No active session"),
			time.Now().Add(time.Second))
		_ = ws.Close()
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	s.LastActivity = nowMs()
	AddWSClient(s, ws)
	defer RemoveWSClient(s, ws)

	if sb := GetScrollback(s); sb != "" {
		msg, _ := json.Marshal(map[string]interface{}{
			"type": "scrollback",
			"data": sb,
		})
		_ = ws.WriteMessage(websocket.TextMessage, msg)
	}

	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if IsAlive(s) && s.PTY != nil {
				_, _ = s.PTY.WriteString(msg.Data)
			}
		case "resize":
			if s.PTY != nil {
				_ = pty.Setsize(s.PTY, &pty.Winsize{
					Rows: msg.Rows,
					Cols: msg.Cols,
				})
			}
		}
	}
}
