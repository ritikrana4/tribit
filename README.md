# tribit

A visual git worktree manager with an embedded AI terminal — packaged as a native desktop app.

## What it does

- **Worktree canvas** — drag-and-drop cards showing every git worktree, their branch, status, and HEAD
- **Embedded terminal** — open a full interactive terminal inside any worktree
- **AI agent integration** — auto-launches your chosen AI agent (Claude, GitHub Copilot, etc.) in each terminal
- **Multi-session** — run multiple terminal sessions per worktree simultaneously, with tab switching
- **Session persistence** — terminal sessions survive app restarts with full scrollback history
- **Multi-repo** — add and switch between multiple git repositories from the sidebar
- **Diff viewer** — VS Code-style diff viewer with file tree

## Install

Download the latest release for your platform from the [Releases](../../releases) page:

- **Mac** — download `tribit-mac.dmg`, open it, drag tribit to Applications
- **Windows** — download the `.exe` installer and run it

## Build from source

**Requirements:** Go 1.22+, Node.js 20+, [Wails v2](https://wails.io/docs/gettingstarted/installation)

```bash
git clone https://github.com/ritikrana4/tribit.git
cd tribit
npm install
npm run build        # builds the desktop app
```

The built app will be at `wails-app/build/bin/tribit.app` (Mac) or `wails-app/build/bin/tribit.exe` (Windows).

For development with live reload:

```bash
npm run dev
```

## Release

Push a git tag to trigger an automated GitHub Actions build for Mac and Windows:

```bash
git tag v1.2.8
git push origin v1.2.8
```

This produces a `tribit-mac.dmg` and a Windows `.exe` installer, published automatically to GitHub Releases.

## Author

**Ritik Rana**
