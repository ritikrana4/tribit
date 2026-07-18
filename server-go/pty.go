package tribitserver

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const maxScrollback = 50 * 1024 // 50 KB

// Session represents a live PTY terminal session
type Session struct {
	SessionID    string
	WtPath       string
	Title        string
	CustomName   string
	PTY          *os.File
	Cmd          *exec.Cmd
	Alive        bool
	CreatedAt    int64 // Unix ms
	LastActivity int64 // Unix ms
	scrollback   []byte
	clients      sync.Map // *websocket.Conn -> struct{}
	mu           sync.Mutex
}

// sessions holds all sessions by sessionID
var sessions sync.Map // string -> *Session

// sessionCounter for generating unique IDs
var sessionCounter uint64

func newSessionID() string {
	id := atomic.AddUint64(&sessionCounter, 1)
	return fmt.Sprintf("session-%d-%d", time.Now().UnixNano(), id)
}

// sendToClients sends msg to all connected WebSocket clients of a session
func sendToClients(s *Session, msg []byte) {
	s.clients.Range(func(k, _ interface{}) bool {
		if ws, ok := k.(*websocket.Conn); ok {
			_ = ws.WriteMessage(websocket.TextMessage, msg)
		}
		return true
	})
}

// CreateSession spawns a new PTY session in wtPath, optionally running an agent command
func CreateSession(wtPath, agent string) *Session {
	shell := os.Getenv("SHELL")
	if shell == "" {
		if runtime.GOOS == "windows" {
			shell = "powershell.exe"
		} else {
			shell = "zsh"
		}
	}

	// Use -l (login shell) so ~/.zprofile / ~/.bash_profile are sourced, giving
	// the session the user's full PATH (homebrew, nvm, claude, etc.).
	var shellArgs []string
	if runtime.GOOS != "windows" {
		shellArgs = []string{"-l"}
	}

	cmd := exec.Command(shell, shellArgs...)
	cmd.Dir = wtPath
	cmd.Env = append(os.Environ(), "TRIBIT=1")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		// fallback: try sh -l
		cmd = exec.Command("sh", "-l")
		cmd.Dir = wtPath
		cmd.Env = append(os.Environ(), "TRIBIT=1")
		ptmx, err = pty.Start(cmd)
		if err != nil {
			return nil
		}
	}

	now := time.Now().UnixMilli()
	s := &Session{
		SessionID:    newSessionID(),
		WtPath:       wtPath,
		Title:        filepath.Base(wtPath),
		PTY:          ptmx,
		Cmd:          cmd,
		Alive:        true,
		CreatedAt:    now,
		LastActivity: now,
	}

	// Send agent command after 500ms
	if agent != "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			s.mu.Lock()
			if s.Alive {
				_, _ = fmt.Fprintf(s.PTY, "%s\r", agent)
			}
			s.mu.Unlock()
		}()
	}

	// Output relay goroutine
	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := ptmx.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])

				s.mu.Lock()
				s.scrollback = append(s.scrollback, chunk...)
				if len(s.scrollback) > maxScrollback {
					s.scrollback = s.scrollback[len(s.scrollback)-maxScrollback:]
				}
				s.mu.Unlock()
				atomic.StoreInt64(&s.LastActivity, time.Now().UnixMilli())

				msg, _ := json.Marshal(map[string]interface{}{
					"type": "output",
					"data": string(chunk),
				})
				sendToClients(s, msg)
			}
			if readErr != nil {
				break
			}
		}

		// Process exited
		s.mu.Lock()
		s.Alive = false
		s.mu.Unlock()

		exitMsg, _ := json.Marshal(map[string]interface{}{
			"type":     "exit",
			"exitCode": 0,
		})
		sendToClients(s, exitMsg)
		DebouncedBroadcast()
	}()

	return s
}

// IsAlive checks if the session's process is still running
func IsAlive(s *Session) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	alive := s.Alive
	s.mu.Unlock()
	return alive
}

// GetSessionsForWorktree returns alive sessions for a given worktree path
func GetSessionsForWorktree(wtPath string) []*Session {
	var results []*Session
	var toDelete []string

	sessions.Range(func(k, v interface{}) bool {
		id := k.(string)
		s := v.(*Session)
		if s.WtPath != wtPath {
			return true
		}
		if IsAlive(s) {
			results = append(results, s)
		} else {
			toDelete = append(toDelete, id)
		}
		return true
	})

	for _, id := range toDelete {
		sessions.Delete(id)
	}

	// Sort by creation time (insertion sort — typically small slice)
	for i := 1; i < len(results); i++ {
		for j := i; j > 0 && results[j].CreatedAt < results[j-1].CreatedAt; j-- {
			results[j], results[j-1] = results[j-1], results[j]
		}
	}
	return results
}

// KillAllSessions kills all active PTY processes
func KillAllSessions() {
	sessions.Range(func(_, v interface{}) bool {
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
		return true
	})
}

// GetScrollback returns a copy of the session's scrollback buffer as string
func GetScrollback(s *Session) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return string(s.scrollback)
}

// AddWSClient registers a WebSocket connection for the session
func AddWSClient(s *Session, ws *websocket.Conn) {
	s.clients.Store(ws, struct{}{})
}

// RemoveWSClient removes a WebSocket connection from the session
func RemoveWSClient(s *Session, ws *websocket.Conn) {
	s.clients.Delete(ws)
}
