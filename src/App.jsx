import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { RefreshCw, X, FolderOpen, Search, PowerOff, Plus, StopCircle, Trash2, Folder } from 'lucide-react';
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
  const { fitView } = useReactFlow();
  useEffect(() => {
    apiRef.current = { fitView };
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

function SettingsModal({ agent, onAgentChange, onClose, onShutdown }) {
  const [sessions, setSessions] = useState([]);

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="btn-icon modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">

          {/* Agent */}
          <div className="settings-row">
            <span className="settings-label">AI Agent</span>
            <div className="agent-toggle">
              <button className={`agent-btn ${agent === 'claude' ? 'agent-btn--active' : ''}`} onClick={() => onAgentChange('claude')}>Claude</button>
              <button className={`agent-btn ${agent === 'copilot' ? 'agent-btn--active' : ''}`} onClick={() => onAgentChange('copilot')}>Copilot</button>
            </div>
          </div>

          {/* Terminal sessions */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-label">
                Terminal Sessions
                {sessions.length > 0 && <span className="settings-count">{sessions.length}</span>}
              </span>
              {sessions.length > 0 && (
                <button className="btn-danger btn-danger--sm" onClick={killAll} title="Kill all sessions">
                  <Trash2 size={12} /> Kill All
                </button>
              )}
            </div>

            {sessions.length === 0 ? (
              <div className="settings-empty">No active terminal sessions</div>
            ) : (
              <div className="session-list-settings">
                {sessions.map((s) => (
                  <div key={s.sessionId} className="session-list-item">
                    <div className="session-list-info">
                      <span className="session-list-title">{s.title}</span>
                      <span className="session-list-meta">PID {s.pid} · {s.wtPath.split('/').pop()}</span>
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

          {/* Shutdown */}
          <div className="settings-row settings-row--danger">
            <div>
              <span className="settings-label">Shut down server</span>
              <span className="settings-hint">Kills all terminal sessions and stops wooop.</span>
            </div>
            <button className="btn-danger" onClick={onShutdown}>Shut down</button>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
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
  const [allWorktrees, setAllWorktrees] = useState([]);

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
        let msg;
        try { msg = (await res.json()).error; } catch { msg = `Server error ${res.status}`; }
        setFatalError(msg);
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
      if (res.ok) { fetchWorktrees(); return null; }
      return data;
    },
    [fetchWorktrees]
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
      return worktrees.map((wt, i) => ({
        id: wt.path,
        type: 'worktree',
        position: prevMap.get(wt.path)?.position ?? wt.position ?? { x: i * 310, y: 80 },
        data: {
          ...wt,
          agent,
          onDelete: handleDelete,
          onOpenCopilot: handleOpenCopilot,
          onKillTerminal: handleKillTerminal,
          onNewSession: handleNewSession,
        },
      }));
    });
  }, [worktrees, agent, handleDelete, handleOpenCopilot, handleKillTerminal, handleNewSession, setNodes]);

  const handleNodeDragStop = useCallback((_event, node) => {
    fetch('/api/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wtPath: node.id, position: node.position }),
    });
  }, []);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setRepoName(d.repoName);
        else setFatalError(d.error);
      })
      .catch(() => setFatalError('Cannot connect to server'));

    fetchWorktrees();
    fetchRepos();
    fetchAllWorktrees();
    const t = setInterval(fetchWorktrees, 5000);
    return () => clearInterval(t);
  }, [fetchWorktrees, fetchRepos, fetchAllWorktrees]);

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  if (fatalError) {
    return (
      <div className="error-page">
        <div className="error-icon">⚠</div>
        <h2>Cannot start</h2>
        <p>{fatalError}</p>
        <p className="hint">Make sure you ran <code>wooop</code> from inside a git repository.</p>
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

          <span className="wt-count">
            {worktrees.length} worktree{worktrees.length !== 1 ? 's' : ''}
          </span>
          <button className="btn-refresh" onClick={fetchWorktrees} title="Refresh"><RefreshCw size={14} /></button>
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
          >
            <FlowController apiRef={flowApiRef} />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e1e1e" />
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
          onCreated={() => { setCreating(false); fetchWorktrees(); }}
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
        />
      )}
    </div>
  );
}
