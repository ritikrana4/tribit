# wooop

Git worktree manager with a web UI and Copilot CLI integration.

Run `wooop` from any git repo → get a visual canvas of all your worktrees → launch and manage Copilot sessions in each one.

## Stack

- **Backend**: Express (Node.js), node-pty, WebSocket (ws)
- **Frontend**: React 18 + Vite + ReactFlow
- **Terminal**: xterm.js embedded in the browser, backed by server-side pty
- **Platform**: Windows-first, macOS/Linux fallback

## Usage

```bash
# From inside any git repo:
cd my-repo
node /path/to/woop/bin/wooop

# Or install globally:
npm install -g /path/to/woop
wooop
```

Server starts on port 7700 (auto-increments if busy) and opens the browser.

For development:

```bash
cd woop
npm install
npm run dev     # Express on 7700 + Vite on 5173
```

---

## Features — Live

### Worktree Canvas
- ReactFlow-based drag-and-drop canvas showing all git worktrees as cards
- Each card displays: branch name, full path, git status (clean/dirty), HEAD SHA
- Card positions persist across sessions in `.git/wooop-meta.json`
- Auto-refresh every 5 seconds + manual refresh button

### Worktree Lifecycle
- **Create**: "+ New Worktree" button opens a modal — enter branch name, choose new or existing branch, add optional description
- **Delete**: Two-click confirmation on cards; detects dirty worktrees and offers force-delete option
- **Descriptions**: Optional text per worktree, stored in metadata

### Embedded Terminal with Copilot
- "Open Copilot" button spawns a server-side pty (PowerShell on Windows) and auto-runs `copilot`
- Terminal rendered inline via xterm.js in a side panel — full interactive TUI support
- **Tabbed multi-terminal**: open Copilot in multiple worktrees simultaneously, switch between tabs
- **Multiple sessions per worktree**: click "+" next to the PID to spawn additional sessions for the same worktree (e.g., Copilot in one, shell in another)
- **Session dropdown**: when a worktree has 2+ sessions, a dropdown toggle appears showing all active sessions with options to switch, rename, or kill each one. Collapses automatically on click outside.
- **Rename sessions**: click the ✎ icon in the session dropdown to give a session a custom name for easy identification
- **Kill terminal**: stop button (■) per session kills the server-side pty process
- **Session persistence**: closing a tab only disconnects the WebSocket; reopening reconnects with full scrollback history
- **Survives browser refresh**: pty processes live on the server, WebSocket reconnects seamlessly
- Active session indicator (green button + PID of latest session) on worktree cards
- Tab status dots: green (connected), amber (connecting), red (error), grey (disconnected)
- Panel resize syncs pty dimensions so TUI apps render correctly
- Ctrl+Esc closes the terminal panel

### CLI
- `bin/wooop` entry point: starts the server, auto-opens the browser
- `WOOOP_CWD` env var to override the target repo directory

---

