package tribitserver

import (
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// sseClients holds all active SSE response writers
var sseClients sync.Map // http.ResponseWriter -> struct{}

// AddSSEClient registers an SSE client
func AddSSEClient(w http.ResponseWriter) {
	sseClients.Store(w, struct{}{})
}

// RemoveSSEClient removes an SSE client
func RemoveSSEClient(w http.ResponseWriter) {
	sseClients.Delete(w)
}

// Broadcast sends "data: update\n\n" to all SSE clients
func Broadcast() {
	var dead []http.ResponseWriter
	sseClients.Range(func(k, _ interface{}) bool {
		w := k.(http.ResponseWriter)
		_, err := w.Write([]byte("data: update\n\n"))
		if err != nil {
			dead = append(dead, w)
			return true
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return true
	})
	for _, w := range dead {
		sseClients.Delete(w)
	}
}

// DebouncedBroadcast coalesces rapid events into a single broadcast with 200ms debounce
var (
	debMu    sync.Mutex
	debTimer *time.Timer
)

func DebouncedBroadcast() {
	debMu.Lock()
	defer debMu.Unlock()
	if debTimer != nil {
		debTimer.Stop()
	}
	debTimer = time.AfterFunc(200*time.Millisecond, func() {
		debMu.Lock()
		debTimer = nil
		debMu.Unlock()
		Broadcast()
	})
}

// watcher holds the active fsnotify watcher
var (
	watcherMu sync.Mutex
	watcher   *fsnotify.Watcher
)

// SetupWatchers watches root/.git/ for changes, calling DebouncedBroadcast on any event
func SetupWatchers(root string) {
	watcherMu.Lock()
	defer watcherMu.Unlock()

	// Close any existing watcher
	if watcher != nil {
		_ = watcher.Close()
		watcher = nil
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	watcher = w

	onChange := func() {
		InvalidateStatusCache()
		DebouncedBroadcast()
	}

	go func() {
		for {
			select {
			case _, ok := <-w.Events:
				if !ok {
					return
				}
				onChange()
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}()

	gitDir := root + "/.git"

	if runtime.GOOS != "linux" {
		// macOS and Windows support recursive watching
		_ = w.Add(gitDir)
	} else {
		// Linux: watch specific files/dirs
		tryWatch := func(p string) {
			_ = w.Add(p)
		}
		tryWatch(gitDir + "/HEAD")
		tryWatch(gitDir + "/index")
		tryWatch(gitDir + "/refs/heads")

		// Watch worktrees subdirectories
		wtDir := gitDir + "/worktrees"
		entries, err := os.ReadDir(wtDir)
		if err == nil {
			tryWatch(wtDir)
			for _, e := range entries {
				if e.IsDir() {
					tryWatch(wtDir + "/" + e.Name() + "/HEAD")
					tryWatch(wtDir + "/" + e.Name() + "/index")
				}
			}
		}
	}
}

// CloseWatchers closes the active watcher
func CloseWatchers() {
	watcherMu.Lock()
	defer watcherMu.Unlock()
	if watcher != nil {
		_ = watcher.Close()
		watcher = nil
	}
}
