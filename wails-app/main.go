package main

import (
	"embed"
	"io/fs"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend
var rawAssets embed.FS

func main() {
	// Strip the "frontend/" prefix so the FS root contains index.html, assets/, etc.
	frontendFS, _ := fs.Sub(rawAssets, "frontend")

	// distFS is the sub-tree used by the HTTP server for static file serving.
	// In production this contains the built React app; in dev it's a placeholder
	// (the webview loads from the Vite dev server instead).
	distFS, _ := fs.Sub(frontendFS, "dist")

	app := NewApp(distFS)
	err := wails.Run(&options.App{
		Title:            "tribit",
		Width:            1280,
		Height:           820,
		MinWidth:         800,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 15, G: 17, B: 23, A: 1},
		AssetServer: &assetserver.Options{
			Assets: frontendFS,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		OnDomReady: app.onDomReady,
		Bind:       []interface{}{app},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarDefault(),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			Theme:                             windows.Dark,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
