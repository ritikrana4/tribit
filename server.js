'use strict';

const express = require('express');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');

const { randomUUID } = require('crypto');
const os = require('os');

const app = express();
app.use(express.json());

let REPO_DIR = process.env.WOOOP_CWD || process.cwd();

/* ── Repos config (~/.wooop/repos.json) ──────────────── */

const REPOS_FILE = path.join(os.homedir(), '.wooop', 'repos.json');

function readRepos() {
  try { return JSON.parse(fs.readFileSync(REPOS_FILE, 'utf8')); }
  catch { return []; }
}

function saveRepos(repos) {
  const dir = path.dirname(REPOS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REPOS_FILE, JSON.stringify(repos, null, 2));
}

// Register current repo on startup
(function initRepos() {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd: REPO_DIR }).toString().trim();
    const repos = readRepos();
    if (!repos.find((r) => r.path === root)) {
      repos.push({ path: root, name: path.basename(root) });
      saveRepos(repos);
    }
  } catch {}
})();

// sessionId (UUID) -> { ptyProcess, scrollback, wsClients, title, wtPath, alive, createdAt, lastActivity }
const terminalSessions = new Map();
const MAX_SCROLLBACK = 50000;

/* ── Git helpers ─────────────────────────────────────────── */

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: REPO_DIR })
      .toString()
      .trim()
      .replace(/\//g, path.sep);
  } catch {
    return null;
  }
}

function getBranchBase(wtPath, currentBranch) {
  try {
    const lines = execSync(
      `git reflog show --format="%gs" "${currentBranch}"`,
      { cwd: wtPath, timeout: 3000 }
    ).toString().trim().split('\n').reverse(); // oldest first

    for (const line of lines) {
      // "branch: Created from refs/heads/main" or "branch: Created from main"
      const created = line.match(/branch: Created from (?:refs\/heads\/)?(.+)/);
      if (created) return created[1].trim();
      // "checkout: moving from main to feature/auth"
      const checkout = line.match(/checkout: moving from (.+) to /);
      if (checkout) return checkout[1].trim();
    }
    return null;
  } catch { return null; }
}

function parseWorktreeList(root) {
  const output = execSync('git worktree list --porcelain', { cwd: root }).toString();
  const entries = [];
  for (const block of output.trim().split(/\n\n+/)) {
    const wt = {};
    for (const line of block.trim().split('\n')) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) wt.head = line.slice(5).trim();
      else if (line.startsWith('branch '))
        wt.branch = line.slice(7).trim().replace('refs/heads/', '');
      else if (line === 'bare') wt.bare = true;
      else if (line === 'detached') wt.detached = true;
    }
    if (wt.path) entries.push(wt);
  }
  return entries;
}

function getWorktreeStatus(wtPath) {
  try {
    const out = execSync('git status --porcelain', { cwd: wtPath, timeout: 3000 }).toString();
    if (!out.trim()) return { status: 'clean', filesChanged: 0, additions: 0, deletions: 0 };
    try {
      const stat = execSync('git diff --shortstat HEAD', { cwd: wtPath, timeout: 3000 }).toString().trim();
      const fm = stat.match(/(\d+) file/);
      const am = stat.match(/(\d+) insertion/);
      const dm = stat.match(/(\d+) deletion/);
      return {
        status: 'dirty',
        filesChanged: fm ? +fm[1] : 0,
        additions: am ? +am[1] : 0,
        deletions: dm ? +dm[1] : 0,
      };
    } catch {
      return { status: 'dirty', filesChanged: 0, additions: 0, deletions: 0 };
    }
  } catch {
    return { status: 'unknown', filesChanged: 0, additions: 0, deletions: 0 };
  }
}

/* ── Metadata (persisted in .git/wooop-meta.json) ────────── */

function getMetaPath(root) {
  const gitDir = execSync('git rev-parse --git-common-dir', { cwd: root })
    .toString()
    .trim();
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  return path.join(absGitDir, 'wooop-meta.json');
}

function readMeta(root) {
  try {
    return JSON.parse(fs.readFileSync(getMetaPath(root), 'utf8'));
  } catch {
    return {};
  }
}

function saveMeta(root, meta) {
  fs.writeFileSync(getMetaPath(root), JSON.stringify(meta, null, 2));
}

/* ── Embedded PTY session management ─────────────────────── */

function isSessionAlive(session) {
  if (!session || !session.ptyProcess) return false;
  try {
    process.kill(session.ptyProcess.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createPtySession(wtPath, agent = 'claude') {
  const shell = process.platform === 'win32'
    ? 'powershell.exe'
    : (process.env.SHELL || 'zsh');
  const sessionId = randomUUID();
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: wtPath,
    env: { ...process.env, WOOOP: '1' },
  });

  if (agent) {
    setTimeout(() => {
      ptyProcess.write(agent + '\r');
    }, 500);
  }

  const session = {
    sessionId,
    ptyProcess,
    scrollback: '',
    wsClients: new Set(),
    title: path.basename(wtPath),
    wtPath,
    alive: true,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  ptyProcess.onData((data) => {
    // Append to scrollback buffer
    session.scrollback += data;
    if (session.scrollback.length > MAX_SCROLLBACK) {
      session.scrollback = session.scrollback.slice(-MAX_SCROLLBACK);
    }
    session.lastActivity = Date.now();
    for (const ws of session.wsClients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.alive = false;
    session.scrollback += `\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`;
    for (const ws of session.wsClients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', exitCode }));
    }
  });

  return session;
}

/* ── Session helpers ─────────────────────────────────────── */

function getSessionsForWorktree(wtPath) {
  const results = [];
  for (const [id, session] of terminalSessions) {
    if (session.wtPath === wtPath) {
      if (isSessionAlive(session)) {
        results.push(session);
      } else {
        terminalSessions.delete(id);
      }
    }
  }
  // Sort by lastActivity descending (most recent first)
  results.sort((a, b) => b.lastActivity - a.lastActivity);
  return results;
}

/* ── Static file serving (production build) ─────────────── */

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

/* ── API Routes ─────────────────────────────────────────── */

app.get('/api/status', (_req, res) => {
  const root = getGitRoot();
  if (!root) {
    return res
      .status(400)
      .json({ error: 'Not a git repository. Run wooop from inside a git repo.' });
  }
  res.json({ root, repoName: path.basename(root), ok: true });
});

app.get('/api/worktrees', (_req, res) => {
  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });

  try {
    const meta = readMeta(root);
    const worktrees = parseWorktreeList(root).map((wt, i) => {
      const sessions = getSessionsForWorktree(wt.path);
      const latest = sessions[0] || null;

      const wtStatus = getWorktreeStatus(wt.path);
      return {
        ...wt,
        name: wt.branch || path.basename(wt.path),
        isMain: i === 0,
        ...wtStatus,
        hasTerminal: sessions.length > 0,
        sessionCount: sessions.length,
        // Latest session info (for the card display)
        sessionId: latest?.sessionId || null,
        sessionPid: latest?.ptyProcess.pid?.toString() || null,
        // All sessions for dropdown
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          pid: s.ptyProcess.pid,
          alive: s.alive,
          customName: s.customName || null,
          createdAt: s.createdAt,
          lastActivity: s.lastActivity,
        })),
        description: meta[wt.path]?.description || '',
        position: meta[wt.path]?.position || null,
        baseBranch: wt.branch ? getBranchBase(wt.path, wt.branch) : null,
      };
    });
    res.json({ worktrees, root });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/branches', (_req, res) => {
  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });
  try {
    const raw = execSync('git branch -a "--format=%(refname:short)"', { cwd: root }).toString();
    const branches = raw.split('\n')
      .map((b) => b.trim())
      .filter((b) => b && !b.endsWith('/HEAD'));
    let current = '';
    try { current = execSync('git branch --show-current', { cwd: root }).toString().trim(); } catch {}
    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/diff', (req, res) => {
  const { repoPath } = req.query;
  if (!repoPath) return res.status(400).json({ error: 'repoPath required' });
  try {
    let diff = '';
    try {
      diff = execSync('git diff HEAD', { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).toString();
    } catch {
      try {
        diff = execSync('git diff --cached', { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).toString();
      } catch {}
    }
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/worktrees', (req, res) => {
  const { branch, isNewBranch, description, fromBranch } = req.body;
  if (!branch?.trim())
    return res.status(400).json({ error: 'Branch name is required' });

  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });

  const sanitized = branch.trim().replace(/[^a-zA-Z0-9_./-]/g, '-');
  const wtPath = path.join(path.dirname(root), sanitized);

  try {
    const from = fromBranch?.trim() ? ` "${fromBranch.trim()}"` : '';
    const cmd = isNewBranch
      ? `git worktree add -b "${sanitized}" "${wtPath}"${from}`
      : `git worktree add "${wtPath}" "${sanitized}"`;
    execSync(cmd, { cwd: root, stdio: 'pipe' });

    if (description?.trim()) {
      const meta = readMeta(root);
      meta[wtPath] = { description: description.trim() };
      saveMeta(root, meta);
    }
    res.json({ path: wtPath, branch: sanitized });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message;
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/worktrees', (req, res) => {
  const { wtPath, force } = req.body;
  if (!wtPath) return res.status(400).json({ error: 'path is required' });

  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });

  try {
    const forceFlag = force ? ' --force' : '';
    execSync(`git worktree remove${forceFlag} "${wtPath}"`, {
      cwd: root,
      stdio: 'pipe',
    });
    // Kill all terminal sessions for this worktree
    for (const [id, session] of terminalSessions) {
      if (session.wtPath === wtPath) {
        if (session.ptyProcess) try { session.ptyProcess.kill(); } catch {}
        terminalSessions.delete(id);
      }
    }

    const meta = readMeta(root);
    delete meta[wtPath];
    saveMeta(root, meta);
    res.json({ ok: true });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message;
    const canForce =
      msg.includes('modified') || msg.includes('changes') || msg.includes('dirty');
    res.status(500).json({ error: msg, canForce });
  }
});

app.patch('/api/positions', (req, res) => {
  const { wtPath, position } = req.body;
  if (!wtPath || !position)
    return res.status(400).json({ error: 'wtPath and position required' });

  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });

  const meta = readMeta(root);
  if (!meta[wtPath]) meta[wtPath] = {};
  meta[wtPath].position = position;
  saveMeta(root, meta);
  res.json({ ok: true });
});

app.post('/api/worktrees/open-copilot', (req, res) => {
  const { wtPath, sessionId: requestedSessionId, agent = 'claude' } = req.body;
  if (!wtPath) return res.status(400).json({ error: 'path is required' });

  const root = getGitRoot();
  let title = path.basename(wtPath);
  if (root) {
    try {
      const wts = parseWorktreeList(root);
      const match = wts.find((w) => w.path === wtPath);
      if (match) title = match.branch || path.basename(match.path);
    } catch {}
  }

  // If a specific session was requested, focus it
  if (requestedSessionId) {
    const existing = terminalSessions.get(requestedSessionId);
    if (isSessionAlive(existing)) {
      existing.lastActivity = Date.now();
      return res.json({ action: 'existing', sessionId: requestedSessionId, title });
    }
  }

  // Otherwise focus the latest active session for this worktree
  const sessions = getSessionsForWorktree(wtPath);
  if (sessions.length > 0) {
    const latest = sessions[0];
    latest.lastActivity = Date.now();
    return res.json({ action: 'existing', sessionId: latest.sessionId, title });
  }

  // No sessions — create a new one
  const session = createPtySession(wtPath, agent);
  session.title = title;
  terminalSessions.set(session.sessionId, session);

  res.json({ action: 'created', sessionId: session.sessionId, title });
});

app.post('/api/sessions/create', (req, res) => {
  const { wtPath, agent = 'claude' } = req.body;
  if (!wtPath) return res.status(400).json({ error: 'path is required' });

  const root = getGitRoot();
  let title = path.basename(wtPath);
  if (root) {
    try {
      const wts = parseWorktreeList(root);
      const match = wts.find((w) => w.path === wtPath);
      if (match) title = match.branch || path.basename(match.path);
    } catch {}
  }

  const session = createPtySession(wtPath, agent);
  session.title = title;
  terminalSessions.set(session.sessionId, session);

  const count = getSessionsForWorktree(wtPath).length;
  res.json({ sessionId: session.sessionId, title, sessionNumber: count });
});

app.post('/api/worktrees/kill-terminal', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = terminalSessions.get(sessionId);
  if (session?.ptyProcess) {
    session.ptyProcess.kill();
  }
  terminalSessions.delete(sessionId);
  res.json({ ok: true });
});

app.post('/api/sessions/kill-all', (_req, res) => {
  for (const [id, session] of terminalSessions) {
    if (session.ptyProcess) try { session.ptyProcess.kill(); } catch {}
    terminalSessions.delete(id);
  }
  res.json({ ok: true });
});

app.patch('/api/sessions/rename', (req, res) => {
  const { sessionId, name } = req.body;
  if (!sessionId || name === undefined) return res.status(400).json({ error: 'sessionId and name required' });

  const session = terminalSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.customName = name.trim() || null;
  res.json({ ok: true });
});

app.get('/api/sessions', (_req, res) => {
  const sessions = [];
  for (const [id, session] of terminalSessions) {
    if (isSessionAlive(session)) {
      sessions.push({
        sessionId: id,
        wtPath: session.wtPath,
        title: session.title,
        pid: session.ptyProcess.pid,
        alive: session.alive,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      });
    } else {
      terminalSessions.delete(id);
    }
  }
  res.json({ sessions });
});

/* ── Repos API ───────────────────────────────────────────── */

app.get('/api/all-worktrees', (_req, res) => {
  const repos = readRepos();
  const result = [];
  for (const repo of repos) {
    try {
      const wts = parseWorktreeList(repo.path);
      for (const wt of wts) {
        result.push({
          path: wt.path,
          branch: wt.branch || null,
          name: wt.branch || path.basename(wt.path),
          repoPath: repo.path,
          repoName: repo.name || path.basename(repo.path),
        });
      }
    } catch {}
  }
  res.json({ worktrees: result });
});

app.get('/api/repos', (_req, res) => {
  const repos = readRepos();
  const root = getGitRoot();
  res.json({ repos, active: root || REPO_DIR });
});

app.post('/api/open-folder', (req, res) => {
  const { dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'dirPath required' });
  const cmd = process.platform === 'win32' ? `explorer "${dirPath}"` : process.platform === 'darwin' ? `open "${dirPath}"` : `xdg-open "${dirPath}"`;
  exec(cmd, () => res.json({ ok: true }));
});

app.post('/api/open-vscode', (req, res) => {
  const { dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'dirPath required' });
  exec(`code "${dirPath}"`, (err) => {
    if (err) return res.status(500).json({ error: 'VS Code not found. Install the "code" CLI via VS Code > Shell Command > Install.' });
    res.json({ ok: true });
  });
});

app.get('/api/pick-folder', (_req, res) => {
  if (process.platform !== 'darwin') {
    return res.json({ path: null, error: 'Native folder picker is macOS only' });
  }
  const script = `try\n  set f to POSIX path of (choose folder with prompt "Select a git repository:")\n  return f\non error\n  return ""\nend try`;
  const tmp = path.join(os.tmpdir(), `wooop-pick-${Date.now()}.scpt`);
  fs.writeFileSync(tmp, script);
  exec(`osascript "${tmp}"`, (err, stdout) => {
    try { fs.unlinkSync(tmp); } catch {}
    const picked = stdout.trim().replace(/\/$/, '');
    res.json({ path: picked || null });
  });
});

app.post('/api/repos', (req, res) => {
  const { repoPath, name, color, icon } = req.body;
  if (!repoPath?.trim()) return res.status(400).json({ error: 'repoPath required' });
  const abs = path.resolve(repoPath.trim().replace(/^~/, os.homedir()));
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd: abs }).toString().trim();
    const repos = readRepos();
    const existing = repos.findIndex((r) => r.path === root);
    const entry = {
      path: root,
      name: name?.trim() || (existing >= 0 ? repos[existing].name : path.basename(root)),
      color: color || (existing >= 0 ? repos[existing].color : null),
      icon: icon || (existing >= 0 ? repos[existing].icon : null),
    };
    if (existing >= 0) repos[existing] = entry;
    else repos.push(entry);
    saveRepos(repos);
    res.json(entry);
  } catch {
    res.status(400).json({ error: `Not a git repository: ${abs}` });
  }
});

app.delete('/api/repos', (req, res) => {
  const { repoPath } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'repoPath required' });
  saveRepos(readRepos().filter((r) => r.path !== repoPath));
  res.json({ ok: true });
});

app.post('/api/repos/switch', (req, res) => {
  const { repoPath } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'repoPath required' });

  REPO_DIR = repoPath;
  const root = getGitRoot();
  if (!root) return res.status(400).json({ error: 'Not a git repository' });

  const repos = readRepos();
  if (!repos.find((r) => r.path === root)) {
    repos.push({ path: root, name: path.basename(root) });
    saveRepos(repos);
  }

  res.json({ ok: true, root, repoName: path.basename(root) });
});

app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  setTimeout(() => { killAllSessions(); process.exit(0); }, 150);
});

/* ── SPA fallback ────────────────────────────────────────── */

app.get('*', (_req, res) => {
  const index = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).send('Run `npm run build` first, or `npm run dev` for development.');
  }
});

/* ── Server startup ──────────────────────────────────────── */

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
  });
}

const DEFAULT_PORT = parseInt(process.env.PORT || '7700', 10);

const ready = findAvailablePort(DEFAULT_PORT).then(
  (port) =>
    new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(`\n  wooop  →  http://localhost:${port}\n`);
        resolve(port);
      });

      // WebSocket server for terminal I/O
      const wss = new WebSocketServer({ server, path: '/ws/terminal' });

      wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        const sessionId = url.searchParams.get('sessionId');

        if (!sessionId) {
          ws.close(4000, 'sessionId query param required');
          return;
        }

        const session = terminalSessions.get(sessionId);
        if (!session || !isSessionAlive(session)) {
          ws.close(4001, 'No active session with this ID');
          return;
        }

        session.lastActivity = Date.now();

        // Register this WS client
        session.wsClients.add(ws);

        // Send scrollback buffer so reconnecting clients see history
        if (session.scrollback) {
          ws.send(JSON.stringify({ type: 'scrollback', data: session.scrollback }));
        }

        // Forward input from browser to pty
        ws.on('message', (msg) => {
          try {
            const parsed = JSON.parse(msg.toString());
            if (parsed.type === 'input' && session.alive) {
              session.ptyProcess.write(parsed.data);
            } else if (parsed.type === 'resize' && session.alive) {
              session.ptyProcess.resize(parsed.cols, parsed.rows);
            }
          } catch {}
        });

        ws.on('close', () => {
          session.wsClients.delete(ws);
        });
      });
    })
);

// Cleanup on exit
function killAllSessions() {
  for (const [, session] of terminalSessions) {
    if (session.ptyProcess) {
      try { session.ptyProcess.kill(); } catch {}
    }
  }
}

process.on('exit', killAllSessions);
process.on('SIGINT', () => { killAllSessions(); process.exit(0); });
process.on('SIGTERM', () => { killAllSessions(); process.exit(0); });

module.exports = { app, ready };
