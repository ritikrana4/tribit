# tribit

A visual git worktree manager with an embedded AI terminal.

Run `npx tribit` from any git repo and get a canvas of all your worktrees — create, delete, and manage them visually, with a full terminal and AI agent (Claude, Copilot, etc.) running inside each one.

## What it does

- **Worktree canvas** — drag-and-drop cards showing every git worktree, their branch, status, and HEAD
- **Embedded terminal** — open a full interactive terminal inside any worktree, directly in the browser
- **AI agent integration** — auto-launches your chosen AI agent (Claude, GitHub Copilot, etc.) in each terminal
- **Multi-session** — run multiple terminal sessions per worktree simultaneously, with tab switching
- **Session persistence** — terminal sessions survive browser refresh; reconnects with full scrollback history
- **Multi-repo** — add and switch between multiple git repositories from the sidebar

## How to run

```bash
# From inside any git repo:
cd your-repo
npx tribit
```

## Author

**Ritik Rana**
