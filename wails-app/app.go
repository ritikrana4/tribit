package main

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	tribitserver "tribit-server"
)

type App struct {
	ctx       context.Context
	server    *http.Server
	port      int
	distFS    fs.FS
	navigated bool
}

func NewApp(distFS fs.FS) *App {
	return &App{distFS: distFS}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	cwd := os.Getenv("TRIBIT_CWD")
	if cwd == "" {
		cwd, _ = os.Getwd()
	}

	port, err := tribitserver.FindFreePort(7700)
	if err != nil {
		return
	}
	a.port = port

	mux := tribitserver.NewMux(cwd, a.distFS)
	a.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}
	go func() { _ = a.server.ListenAndServe() }()
}

// initWailsJS disables right-click and back/forward navigation in the webview.
const initWailsJS = `
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', function(){ history.pushState(null, '', window.location.href); });
`

func (a *App) onDomReady(ctx context.Context) {
	// OnDomReady fires on every page load. After the initial navigation to
	// http://localhost:PORT?wails=1, subsequent firings just re-apply the setup.
	if a.navigated {
		runtime.WindowExecJS(ctx, initWailsJS)
		return
	}
	if runtime.Environment(ctx).BuildType == "dev" {
		// In dev mode there is no navigation, so set the marker here instead.
		runtime.WindowExecJS(ctx, `document.documentElement.setAttribute('data-wails','');`+initWailsJS)
		return
	}
	a.navigated = true

	// ?wails=1 is read synchronously by main.jsx before React renders, which
	// lets Wails-specific CSS apply without any async race condition.
	url := fmt.Sprintf("http://localhost:%d/?wails=1", a.port)
	for i := 0; i < 50; i++ {
		resp, err := http.Get("http://localhost:" + fmt.Sprintf("%d", a.port) + "/api/status")
		if err == nil {
			resp.Body.Close()
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	runtime.WindowExecJS(ctx, fmt.Sprintf(`window.location.href = %q`, url))
}

func (a *App) shutdown(ctx context.Context) {
	tribitserver.CloseWatchers()
	tribitserver.KillAllSessions()
	if a.server != nil {
		shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = a.server.Shutdown(shutCtx)
	}
}
