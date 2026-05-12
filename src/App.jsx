import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, FolderOpen, Search, PowerOff, Plus, StopCircle, Trash2, Folder, ArrowLeft, ChevronRight, Bot, Terminal, Palette, Info, Mail, Zap, LayoutGrid } from 'lucide-react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useReactFlow,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

import WorktreeNode from './components/WorktreeNode.jsx';
import CreateModal from './components/CreateModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import { COLORS, ICONS } from './repoMeta.js';

const nodeTypes = { worktree: WorktreeNode };

function FlowController({ apiRef }) {
  const { fitView, getNodes } = useReactFlow();
  useEffect(() => {
    apiRef.current = { fitView, getNodes };
  });
  return null;
}

function AgentSelect({ onSelect }) {
  return (
    <div className="agent-select-screen">
      <div className="agent-select-box">
        <div className="agent-select-logo">wooop</div>
        <p className="agent-select-label">Choose your AI agent</p>
        <div className="agent-select-options">
          <button className="agent-select-btn" onClick={() => onSelect('claude')}>
            <span className="agent-select-name">Claude</span>
            <span className="agent-select-sub">Anthropic</span>
          </button>
          <button className="agent-select-btn" onClick={() => onSelect('copilot')}>
            <span className="agent-select-name">Copilot</span>
            <span className="agent-select-sub">GitHub</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AddRepoModal({ onClose, onAdded }) {
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [icon, setIcon] = useState('code');
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    if (repoPath.trim()) {
      const parts = repoPath.trim().replace(/\/$/, '').split(/[/\\]/);
      setName(parts[parts.length - 1] || '');
    }
  }, [repoPath]);

  const handlePickFolder = async () => {
    setPicking(true);
    try {
      const res = await fetch('/api/pick-folder');
      const data = await res.json();
      if (data.path) setRepoPath(data.path);
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!repoPath.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: repoPath.trim(), name: name.trim() || undefined, color, icon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAdded(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--add-repo" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header modal-header--repo">
          <div>
            <div className="modal-title">Add Project</div>
            <div className="modal-subtitle">Register a local git repository to manage its worktrees.</div>
          </div>
          <button className="btn-icon modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body--repo">
            <div className="repo-field">
              <label className="repo-field-label">Path</label>
              <div className="repo-path-row">
                <input
                  className="input"
                  type="text"
                  placeholder="/Users/you/projects/my-app"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  autoFocus
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn-browse"
                  onClick={handlePickFolder}
                  disabled={picking}
                  title="Browse for folder"
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            </div>

            <div className="repo-field">
              <label className="repo-field-label">Name</label>
              <input
                className="input"
                type="text"
                placeholder="my-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="repo-field">
              <label className="repo-field-label">Color</label>
              <div className="color-grid">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-dot ${color === c ? 'color-dot--selected' : ''}`}
                    style={{ '--dot-color': c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="repo-field">
              <label className="repo-field-label">Icon</label>
              <div className="icon-grid">
                {ICONS.map((ic) => (
                  <button
                    key={ic.id}
                    type="button"
                    className={`icon-btn ${icon === ic.id ? 'icon-btn--selected' : ''}`}
                    onClick={() => setIcon(ic.id)}
                  >
                    <ic.Icon size={16} />
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="form-error">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || !repoPath.trim()}>
              {loading ? 'Adding…' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsModal({ agent, onAgentChange, onClose, onShutdown, theme, onThemeChange }) {
  const [view, setView] = useState(null);
  const [sessions, setSessions] = useState([]);

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') { if (view) setView(null); else onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, view]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const killSession = async (sessionId) => {
    await fetch('/api/worktrees/kill-terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    fetchSessions();
  };

  const killAll = async () => {
    await fetch('/api/sessions/kill-all', { method: 'POST' });
    fetchSessions();
  };

  const VIEW_LABELS = { agent: 'Agent', sessions: 'Sessions', appearance: 'Appearance', about: 'About' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sv2-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header / breadcrumb */}
        <div className="sv2-header">
          <div className="sv2-header-left">
            {view && (
              <button className="sv2-back" onClick={() => setView(null)}>
                <ArrowLeft size={14} />
              </button>
            )}
            <div className="sv2-breadcrumb">
              {view ? (
                <>
                  <span className="sv2-crumb sv2-crumb--parent" onClick={() => setView(null)}>Settings</span>
                  <ChevronRight size={11} className="sv2-crumb-sep" />
                  <span className="sv2-crumb sv2-crumb--current">{VIEW_LABELS[view]}</span>
                </>
              ) : (
                <span className="sv2-crumb sv2-crumb--current">Settings</span>
              )}
            </div>
          </div>
          <button className="btn-icon modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="sv2-body">

          {/* ── Home ── */}
          {!view && (
            <div className="sv2-home">
              <div className="sv2-nav-group">

                <button className="sv2-nav-item" onClick={() => setView('agent')}>
                  <span className="sv2-nav-icon"><Bot size={16} /></span>
                  <div className="sv2-nav-text">
                    <span className="sv2-nav-title">Agent</span>
                    <span className="sv2-nav-sub">AI model for your worktrees</span>
                  </div>
                  <span className="sv2-nav-value">{agent === 'claude' ? 'Claude' : 'Copilot'}</span>
                  <ChevronRight size={13} className="sv2-nav-arrow" />
                </button>

                <button className="sv2-nav-item" onClick={() => setView('sessions')}>
                  <span className="sv2-nav-icon"><Terminal size={16} /></span>
                  <div className="sv2-nav-text">
                    <span className="sv2-nav-title">Sessions</span>
                    <span className="sv2-nav-sub">Manage active terminal sessions</span>
                  </div>
                  {sessions.length > 0 && (
                    <span className="sv2-nav-badge">{sessions.length}</span>
                  )}
                  <ChevronRight size={13} className="sv2-nav-arrow" />
                </button>

                <button className="sv2-nav-item" onClick={() => setView('appearance')}>
                  <span className="sv2-nav-icon"><Palette size={16} /></span>
                  <div className="sv2-nav-text">
                    <span className="sv2-nav-title">Appearance</span>
                    <span className="sv2-nav-sub">Theme and display preferences</span>
                  </div>
                  <span className="sv2-nav-value">{theme === 'light' ? 'Light' : 'Dark'}</span>
                  <ChevronRight size={13} className="sv2-nav-arrow" />
                </button>

                <button className="sv2-nav-item" onClick={() => setView('about')}>
                  <span className="sv2-nav-icon"><Info size={16} /></span>
                  <div className="sv2-nav-text">
                    <span className="sv2-nav-title">About</span>
                    <span className="sv2-nav-sub">Version, feedback &amp; contact</span>
                  </div>
                  <ChevronRight size={13} className="sv2-nav-arrow" />
                </button>

              </div>

              <div className="sv2-danger-zone">
                <button className="sv2-shutdown-btn" onClick={onShutdown}>
                  <PowerOff size={13} />
                  Shut down server
                </button>
                <span className="sv2-danger-hint">Kills all sessions and stops wooop</span>
              </div>
            </div>
          )}

          {/* ── Agent ── */}
          {view === 'agent' && (
            <div className="sv2-section">
              <div className="sv2-field">
                <span className="sv2-field-label">AI Agent</span>
                <span className="sv2-field-sub">The model that launches when you open a worktree terminal</span>
                <div className="sv2-agent-options">
                  <button
                    className={`sv2-agent-opt ${agent === 'claude' ? 'sv2-agent-opt--active' : ''}`}
                    onClick={() => onAgentChange('claude')}
                  >
                    <span className="sv2-agent-name">Claude</span>
                    <span className="sv2-agent-by">Anthropic</span>
                  </button>
                  <button
                    className={`sv2-agent-opt ${agent === 'copilot' ? 'sv2-agent-opt--active' : ''}`}
                    onClick={() => onAgentChange('copilot')}
                  >
                    <span className="sv2-agent-name">Copilot</span>
                    <span className="sv2-agent-by">GitHub</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Sessions ── */}
          {view === 'sessions' && (
            <div className="sv2-section">
              <div className="sv2-sessions-header">
                <span className="sv2-sessions-count">
                  {sessions.length === 0 ? 'No active sessions' : `${sessions.length} active`}
                </span>
                {sessions.length > 0 && (
                  <button className="btn-danger btn-danger--sm" onClick={killAll}>
                    <Trash2 size={12} /> Kill All
                  </button>
                )}
              </div>
              {sessions.length === 0 ? (
                <div className="sv2-empty">
                  <Terminal size={28} className="sv2-empty-icon" />
                  <span>No terminal sessions running</span>
                </div>
              ) : (
                <div className="sv2-session-list">
                  {sessions.map((s) => (
                    <div key={s.sessionId} className="sv2-session-item">
                      <span className="sv2-session-dot" />
                      <div className="sv2-session-info">
                        <span className="sv2-session-title">{s.title}</span>
                        <span className="sv2-session-meta">PID {s.pid} · {s.wtPath.split('/').pop()}</span>
                      </div>
                      <button
                        className="btn-icon btn-icon--sm"
                        onClick={() => killSession(s.sessionId)}
                        title="Kill session"
                      >
                        <StopCircle size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Appearance ── */}
          {view === 'appearance' && (
            <div className="sv2-section">
              <div className="sv2-field">
                <span className="sv2-field-label">Theme</span>
                <span className="sv2-field-sub">Choose your preferred color scheme</span>
                <div className="sv2-theme-options">
                  {['dark', 'light'].map((t) => (
                    <button
                      key={t}
                      className={`sv2-theme-opt ${theme === t ? 'sv2-theme-opt--active' : ''}`}
                      onClick={() => onThemeChange(t)}
                    >
                      <div className={`sv2-theme-preview sv2-theme-preview--${t}`}>
                        <div className="sv2-tp-bar" />
                        <div className="sv2-tp-lines">
                          <div className={`sv2-tp-line sv2-tp-line--accent-${t}`} />
                          <div className="sv2-tp-line sv2-tp-line--long" />
                          <div className="sv2-tp-line sv2-tp-line--short" />
                          <div className="sv2-tp-line sv2-tp-line--med" />
                        </div>
                      </div>
                      <div className="sv2-theme-footer">
                        <span className="sv2-theme-label">{t === 'dark' ? 'Dark' : 'Light'}</span>
                        {theme === t && <span className="sv2-theme-tick">✓</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── About ── */}
          {view === 'about' && (
            <div className="sv2-about">
              <div className="sv2-about-logo">
                <Zap size={20} />
                <span>wooop</span>
              </div>
              <span className="sv2-about-badge">Beta</span>
              <p className="sv2-about-tagline">
                Thanks for trying wooop! We're actively building and improving —
                your early support means a lot to us.
              </p>
              <div className="sv2-about-divider" />
              <div className="sv2-about-contact">
                <Mail size={13} className="sv2-about-contact-icon" />
                <span>Questions or feedback?</span>
                <a href="mailto:thisisritikrana@gmail.com" className="sv2-about-link">thisisritikrana@gmail.com</a>
              </div>
              <span className="sv2-about-version">v0.1.0-beta</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [repoName, setRepoName] = useState('');
  const [repoRoot, setRepoRoot] = useState('');
  const [worktrees, setWorktrees] = useState([]);
  const [repos, setRepos] = useState([]);
  const [fatalError, setFatalError] = useState(null);
  const [noGitRepo, setNoGitRepo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(
    () => localStorage.getItem('wooop-sidebar') !== 'collapsed'
  );
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [agent, setAgent] = useState(() => localStorage.getItem('wooop-agent') || 'claude');
  const [agentChosen, setAgentChosen] = useState(() => !!localStorage.getItem('wooop-agent'));
  const [shuttingDown, setShuttingDown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const flowApiRef = useRef(null);
  const searchRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const pendingCreatedRef = useRef(null);
  const [allWorktrees, setAllWorktrees] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('wooop-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleThemeChange = useCallback((t) => {
    setTheme(t);
    localStorage.setItem('wooop-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const handleShutdown = useCallback(async () => {
    setShowSettings(false);
    setShuttingDown(true);
    await fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
  }, []);

  const handleAgentSelect = useCallback((a) => {
    setAgent(a);
    localStorage.setItem('wooop-agent', a);
    setAgentChosen(true);
  }, []);

  const handleAgentChange = useCallback((a) => {
    setAgent(a);
    localStorage.setItem('wooop-agent', a);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('wooop-sidebar', next ? 'expanded' : 'collapsed');
      return next;
    });
  }, []);

  const fetchAllWorktrees = useCallback(async () => {
    const res = await fetch('/api/all-worktrees');
    if (res.ok) {
      const data = await res.json();
      setAllWorktrees(data.worktrees);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
  }, []);

  const fetchRepos = useCallback(async () => {
    const res = await fetch('/api/repos');
    const data = await res.json();
    if (res.ok) {
      setRepos(data.repos);
      setRepoRoot(data.active);
    }
    fetchAllWorktrees();
  }, [fetchAllWorktrees]);

  const fetchWorktrees = useCallback(async () => {
    try {
      const res = await fetch('/api/worktrees');
      if (!res.ok) {
        let data;
        try { data = await res.json(); } catch { data = {}; }
        const msg = data.error || `Server error ${res.status}`;
        if (!msg.includes('Not a git repository')) setFatalError(msg);
        return;
      }
      const data = await res.json();
      setWorktrees(data.worktrees);
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setFatalError('Cannot connect to wooop server. Make sure you ran: node server.js');
      } else {
        setFatalError(err.message);
      }
    }
  }, []);

  const handleDelete = useCallback(
    async (wtPath, force = false) => {
      const res = await fetch('/api/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtPath, force }),
      });
      const data = await res.json();
      if (res.ok) { fetchWorktrees(); fetchAllWorktrees(); return null; }
      return data;
    },
    [fetchWorktrees, fetchAllWorktrees]
  );

  const handleOpenCopilot = useCallback(
    async (wtPath) => {
      const res = await fetch('/api/worktrees/open-copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtPath, agent }),
      });
      const data = await res.json();
      setTimeout(fetchWorktrees, 600);
      return data.sessionId;
    },
    [fetchWorktrees, agent]
  );

  const handleNewSession = useCallback(
    async (wtPath) => {
      const res = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtPath, agent }),
      });
      const data = await res.json();
      setTimeout(fetchWorktrees, 600);
      return data.sessionId;
    },
    [fetchWorktrees, agent]
  );

  const handleKillTerminal = useCallback(
    async (sessionId) => {
      await fetch('/api/worktrees/kill-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      setTimeout(fetchWorktrees, 300);
    },
    [fetchWorktrees]
  );

  const handleSwitchRepo = useCallback(async (repoPath) => {
    const res = await fetch('/api/repos/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    });
    const data = await res.json();
    if (res.ok) {
      setRepoName(data.repoName);
      setRepoRoot(data.root);
      setFatalError(null);
      setNoGitRepo(false);
      fetchWorktrees();
    }
  }, [fetchWorktrees]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allWorktrees.filter((wt) =>
      (wt.branch || '').toLowerCase().includes(q) ||
      (wt.name || '').toLowerCase().includes(q) ||
      wt.repoName.toLowerCase().includes(q) ||
      wt.path.toLowerCase().includes(q)
    );
  }, [searchQuery, allWorktrees]);

  const navigateToNode = useCallback((nodeId, repoPath) => {
    setSearchQuery('');
    setSearchOpen(false);
    setSearchIndex(0);
    if (repoPath && repoPath !== repoRoot) {
      pendingFocusRef.current = nodeId;
      handleSwitchRepo(repoPath);
    } else if (flowApiRef.current) {
      flowApiRef.current.fitView({ nodes: [{ id: nodeId }], duration: 400, padding: 0.5 });
    }
  }, [repoRoot, handleSwitchRepo]);

  const handleSearchKey = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = searchResults[searchIndex];
      if (hit) navigateToNode(hit.path, hit.repoPath);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchOpen(false);
    }
  }, [searchResults, searchIndex, navigateToNode]);

  const handleAddRepo = useCallback(async () => {
    setShowAddRepo(false);
    await fetchRepos();
  }, [fetchRepos]);

  const handleRemoveRepo = useCallback(async (repoPath) => {
    await fetch('/api/repos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    });
    fetchRepos();
  }, [fetchRepos]);

  // Sync worktrees → ReactFlow nodes
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const wtMap = new Map(worktrees.map((wt) => [wt.path, wt]));

      const buildData = (wt) => ({
        ...wt, agent, theme,
        onDelete: handleDelete,
        onOpenCopilot: handleOpenCopilot,
        onKillTerminal: handleKillTerminal,
        onNewSession: handleNewSession,
      });

      // Keep existing nodes in their current prev order so drag z-stacking is preserved
      const result = prev
        .filter((n) => wtMap.has(n.id))
        .map((n) => ({ ...n, data: buildData(wtMap.get(n.id)) }));

      // Append genuinely new nodes at the end (renders on top)
      worktrees.forEach((wt) => {
        if (prevMap.has(wt.path)) return;
        const existing = result.map((n) => n.position).filter(Boolean);
        let position = wt.position;
        if (!position) {
          if (existing.length === 0) {
            position = { x: 80, y: 80 };
          } else {
            const maxY = Math.max(...existing.map((p) => p.y));
            const avgX = Math.round(existing.reduce((s, p) => s + p.x, 0) / existing.length);
            position = { x: avgX, y: maxY + 220 };
          }
        }
        result.push({ id: wt.path, type: 'worktree', position, data: buildData(wt) });
      });

      return result;
    });
  }, [worktrees, agent, theme, handleDelete, handleOpenCopilot, handleKillTerminal, handleNewSession, setNodes]);

  const handleNodeDragStop = useCallback((_event, node) => {
    fetch('/api/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wtPath: node.id, position: node.position }),
    });
  }, []);

  const handleAutoArrange = useCallback(() => {
    const allNodes = flowApiRef.current?.getNodes?.() ?? nodes;
    if (allNodes.length === 0) return;

    const GAP = 40;
    const COLS = Math.min(3, Math.ceil(Math.sqrt(allNodes.length)));
    const sorted = [...allNodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

    const dimMap = new Map();
    document.querySelectorAll('.react-flow__node').forEach((el) => {
      const id = el.getAttribute('data-id');
      if (!id) return;
      const card = el.querySelector('.card');
      dimMap.set(id, {
        w: card ? card.offsetWidth : el.offsetWidth,
        h: card ? card.offsetHeight : el.offsetHeight,
      });
    });
    const getDims = (id) => dimMap.get(id) ?? { w: 560, h: 220 };

    const posMap = new Map();
    let y = 80;
    for (let r = 0; r < sorted.length; r += COLS) {
      const row = sorted.slice(r, r + COLS);
      const rowH = Math.max(...row.map((n) => getDims(n.id).h));
      let x = 80;
      row.forEach((n) => {
        posMap.set(n.id, { x, y });
        x += getDims(n.id).w + GAP;
      });
      y += rowH + GAP;
    }

    setNodes((prev) => prev.map((n) => {
      const pos = posMap.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));

    posMap.forEach((position, wtPath) => {
      fetch('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtPath, position }),
      });
    });

    setTimeout(() => flowApiRef.current?.fitView({ duration: 400, padding: 0.25 }), 100);
  }, [nodes, setNodes]);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) { setRepoName(d.repoName); setNoGitRepo(false); }
        else if (d.error?.includes('Not a git repository')) setNoGitRepo(true);
        else setFatalError(d.error);
      })
      .catch(() => setFatalError('Cannot connect to server'));

    fetchWorktrees();
    fetchRepos();
    fetchAllWorktrees();
    fetchSessions();
    const t = setInterval(() => { fetchWorktrees(); fetchSessions(); }, 5000);
    return () => clearInterval(t);
  }, [fetchWorktrees, fetchRepos, fetchAllWorktrees, fetchSessions]);

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // After a new worktree is created, fit all nodes into view
  useEffect(() => {
    if (pendingCreatedRef.current && nodes.some((n) => n.id === pendingCreatedRef.current)) {
      pendingCreatedRef.current = null;
      setTimeout(() => {
        flowApiRef.current?.fitView({ duration: 400, padding: 0.25 });
      }, 400);
    }
  }, [nodes]);

  // After a cross-repo switch, nodes re-render — fire the deferred focus
  useEffect(() => {
    if (pendingFocusRef.current && nodes.length > 0) {
      const target = pendingFocusRef.current;
      if (nodes.some((n) => n.id === target)) {
        pendingFocusRef.current = null;
        setTimeout(() => {
          flowApiRef.current?.fitView({ nodes: [{ id: target }], duration: 400, padding: 0.5 });
        }, 150);
      }
    }
  }, [nodes]);

  if (!agentChosen) {
    return <AgentSelect onSelect={handleAgentSelect} />;
  }

  if (shuttingDown) {
    return (
      <div className="shutdown-screen">
        <div className="shutdown-box">
          <div className="shutdown-icon"><PowerOff size={28} /></div>
          <div className="shutdown-title">Server stopped</div>
          <div className="shutdown-sub">All terminal sessions have been killed. You can close this tab.</div>
        </div>
      </div>
    );
  }

  if (noGitRepo) {
    return (
      <div className="app">
        <Sidebar
          repos={repos}
          activeRepo={repoRoot}
          expanded={sidebarExpanded}
          onToggle={toggleSidebar}
          onSwitch={handleSwitchRepo}
          onAddRepo={() => setShowAddRepo(true)}
          onRemoveRepo={handleRemoveRepo}
          onSettings={() => setShowSettings(true)}
          allWorktrees={allWorktrees}
          sessions={sessions}
          onNavigate={navigateToNode}
        />
        <div className="no-repo-screen">
          <div className="no-repo-box">
            <div className="error-icon">⚠</div>
            <h2>No repository selected</h2>
            <p>wooop needs a git repository to manage worktrees.</p>
            {repos.length > 0 && (
              <p className="hint">Select a repository from the sidebar, or add a new one.</p>
            )}
            <button className="btn-agent" onClick={() => setShowAddRepo(true)}>
              Add Repository
            </button>
          </div>
        </div>
        {showAddRepo && (
          <AddRepoModal
            onClose={() => setShowAddRepo(false)}
            onAdded={async (data) => {
              setShowAddRepo(false);
              await handleSwitchRepo(data.path);
              fetchRepos();
            }}
          />
        )}
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="error-page">
        <div className="error-icon">⚠</div>
        <h2>Cannot start</h2>
        <p>{fatalError}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        repos={repos}
        activeRepo={repoRoot}
        expanded={sidebarExpanded}
        onToggle={toggleSidebar}
        onSwitch={handleSwitchRepo}
        onAddRepo={() => setShowAddRepo(true)}
        onRemoveRepo={handleRemoveRepo}
        onSettings={() => setShowSettings(true)}
        allWorktrees={allWorktrees}
        sessions={sessions}
        onNavigate={navigateToNode}
      />

      <div className="app-main">
        <header className="header">
          <div className="header-repo">
            <Folder size={14} className="header-folder-icon" />
            <span className="repo-label">{repoName || '—'}</span>
          </div>
          <div className="search-wrap" ref={searchRef}>
            <Search size={13} className="search-icon-glyph" />
            <input
              className="search-input"
              type="text"
              placeholder="Search worktrees…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
                setSearchIndex(0);
              }}
              onFocus={() => { if (searchQuery) setSearchOpen(true); }}
              onKeyDown={handleSearchKey}
              spellCheck={false}
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map((wt, i) => (
                  <button
                    key={wt.path}
                    className={`search-result ${i === searchIndex ? 'search-result--active' : ''}`}
                    onClick={() => navigateToNode(wt.path, wt.repoPath)}
                    onMouseEnter={() => setSearchIndex(i)}
                  >
                    <div className="search-result-top">
                      <span className="search-result-branch">{wt.branch || wt.name || wt.path.split('/').pop()}</span>
                      {wt.repoPath !== repoRoot && (
                        <span className="search-result-repo">{wt.repoName}</span>
                      )}
                    </div>
                    <span className="search-result-path">{wt.path}</span>
                  </button>
                ))}
              </div>
            )}
            {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
              <div className="search-dropdown">
                <div className="search-empty">No worktrees match</div>
              </div>
            )}
          </div>
          <button className="btn-refresh" onClick={handleAutoArrange} title="Auto arrange"><LayoutGrid size={14} /></button>

          <span className="wt-count">
            {worktrees.length} worktree{worktrees.length !== 1 ? 's' : ''}
          </span>
        </header>

        <div className="flow-wrap">
          <ReactFlow
            nodes={nodes}
            edges={[]}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            onNodeDragStop={handleNodeDragStop}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            preventScrolling={true}
          >
            <FlowController apiRef={flowApiRef} />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={theme === 'light' ? '#d4d4d8' : '#1e1e1e'} />
            <Controls showInteractive={false} />
            <Panel position="bottom-center">
              <button className="btn-add-float" onClick={() => setCreating(true)}>
                <Plus size={14} /> New Worktree
              </button>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={(newPath) => {
            setCreating(false);
            if (newPath) pendingCreatedRef.current = newPath;
            fetchWorktrees();
            fetchAllWorktrees();
          }}
        />
      )}

      {showAddRepo && (
        <AddRepoModal onClose={() => setShowAddRepo(false)} onAdded={handleAddRepo} />
      )}

      {showSettings && (
        <SettingsModal
          agent={agent}
          onAgentChange={handleAgentChange}
          onClose={() => setShowSettings(false)}
          onShutdown={handleShutdown}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}
    </div>
  );
}
