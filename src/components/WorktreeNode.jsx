import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Maximize2, Minimize2, X, Plus, StopCircle, GripVertical, ExternalLink, Code2, Folder, ChevronDown, ChevronUp } from 'lucide-react';
import TerminalView from './TerminalView.jsx';
import DiffViewer from './DiffViewer.jsx';
import MonacoPanel from './MonacoPanel.jsx';

export default function WorktreeNode({ data }) {
  const {
    onDelete, onOpenCopilot, onKillTerminal, onNewSession,
    agent = 'claude', theme = 'dark', ...worktree
  } = data;

  const [phase, setPhase] = useState('idle');
  const [deleteError, setDeleteError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [killConfirmId, setKillConfirmId] = useState(null);
  const [vscodeError, setVscodeError] = useState(null);
  const [termCollapsed, setTermCollapsed] = useState(false);
  const [cardWidth, setCardWidth] = useState(560);
  const [termHeight, setTermHeight] = useState(280);
  const resizeDrag = useRef(null);
  const cardRef = useRef(null);
  const pendingNewSessionRef = useRef(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const stopWheel = (e) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { passive: true });
    return () => el.removeEventListener('wheel', stopWheel);
  }, []);

  const sessions = worktree.sessions || [];

  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null);
      pendingNewSessionRef.current = null;
    } else if (pendingNewSessionRef.current && sessions.find((s) => s.sessionId === pendingNewSessionRef.current)) {
      setActiveSessionId(pendingNewSessionRef.current);
      pendingNewSessionRef.current = null;
    } else if (!sessions.find((s) => s.sessionId === activeSessionId)) {
      setActiveSessionId(sessions[sessions.length - 1].sessionId);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (killConfirmId && !sessions.find((s) => s.sessionId === killConfirmId)) {
      setKillConfirmId(null);
    }
  }, [sessions, killConfirmId]);

  useEffect(() => {
    if (!fullscreen) return;
    const h = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

  const handleDeleteClick = async () => {
    if (phase === 'idle') {
      setPhase('confirm');
      setTimeout(() => setPhase((p) => (p === 'confirm' ? 'idle' : p)), 3000);
      return;
    }
    if (phase === 'confirm' || phase === 'forceNeeded') {
      setPhase('deleting');
      setDeleteError(null);
      const result = await onDelete(worktree.path, phase === 'forceNeeded');
      if (result?.error) {
        setDeleteError(result.error);
        setPhase(result.canForce ? 'forceNeeded' : 'idle');
      } else {
        setPhase('idle');
      }
    }
  };

  const handleOpen = async () => {
    setOpening(true);
    const sessionId = await onOpenCopilot(worktree.path);
    if (sessionId) pendingNewSessionRef.current = sessionId;
    setTimeout(() => setOpening(false), 600);
  };

  const handleNewSession = async () => {
    const sessionId = await onNewSession(worktree.path);
    if (sessionId) pendingNewSessionRef.current = sessionId;
  };

  const handleKill = async (sid) => {
    await onKillTerminal(sid);
  };

  const handleOpenVscode = async () => {
    const res = await fetch('/api/open-vscode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath: worktree.path }),
    });
    if (!res.ok) {
      const data = await res.json();
      setVscodeError(data.error);
      setTimeout(() => setVscodeError(null), 4000);
    }
  };

  const handleResizeMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDrag.current = { startX: e.clientX, startY: e.clientY, startW: cardWidth, startH: termHeight };
    const onMove = (e) => {
      const { startX, startY, startW, startH } = resizeDrag.current;
      setCardWidth(Math.max(360, startW + (e.clientX - startX)));
      setTermHeight(Math.max(120, startH + (e.clientY - startY)));
    };
    const onUp = () => {
      resizeDrag.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const deleteLabel = phase === 'confirm' ? 'Delete?' : phase === 'forceNeeded' ? 'Force?' : phase === 'deleting' ? '···' : null;

  // Inline JSX helpers — plain variables, NOT inner components, so React never unmounts terminals
  const sessionTabs = (
    <div className="card-session-tabs">
      {sessions.map((s, i) => (
        killConfirmId === s.sessionId ? (
          <div key={s.sessionId} className="nodrag card-session-kill-confirm">
            <span className="card-session-kill-label">Kill Agent {i + 1}?</span>
            <button
              className="nodrag card-session-kill-yes"
              onClick={() => { handleKill(s.sessionId); setKillConfirmId(null); }}
            >
              Kill
            </button>
            <button
              className="nodrag card-session-kill-no"
              onClick={() => setKillConfirmId(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div
            key={s.sessionId}
            className={`nodrag card-session-tab-wrap ${s.sessionId === activeSessionId ? 'card-session-tab-wrap--active' : ''}`}
          >
            <button
              className="nodrag card-session-tab"
              onClick={() => setActiveSessionId(s.sessionId)}
              title={`PID ${s.pid}`}
            >
              {s.customName || `Agent ${i + 1}`}
            </button>
            <button
              className="nodrag card-session-tab-kill"
              title="Kill this agent"
              onClick={() => { if (!killConfirmId) setKillConfirmId(s.sessionId); }}
              disabled={!!killConfirmId}
            >
              <StopCircle size={13} />
            </button>
          </div>
        )
      ))}
      <button className="nodrag card-session-tab card-session-tab--new" onClick={handleNewSession} title="Add new agent in this worktree">
        <Plus size={12} />
      </button>
    </div>
  );

  const terminalInstances = sessions.map((s) => (
    <TerminalView key={s.sessionId} sessionId={s.sessionId} isVisible={s.sessionId === activeSessionId} theme={theme} />
  ));

  return (
    <>
      <div ref={cardRef} className={`card ${worktree.isMain ? 'card--main' : ''}`} style={{ width: cardWidth }}>
        <div className="card-header">
          <div className="card-title">
            <button
              className="nodrag card-path-icon"
              title={worktree.path}
              onClick={() => fetch('/api/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: worktree.path }),
              })}
            >
              <Folder size={13} />
              <span className="card-path-tooltip">{worktree.path}</span>
            </button>
            <GitBranch size={13} className="branch-glyph" />
            <span className="branch-name">{worktree.branch || worktree.name}</span>
            {worktree.isMain && <span className="badge">main</span>}
            {worktree.detached && <span className="badge badge--warn">detached</span>}
          </div>
          <div className="card-header-actions">
            {sessions.length > 0 && (
              <button
                className="nodrag btn-icon"
                onClick={() => setTermCollapsed((c) => !c)}
                title={termCollapsed ? 'Show terminal' : 'Hide terminal'}
              >
                {termCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            )}
            <button className="nodrag btn-icon btn-icon--expand" onClick={() => setFullscreen(true)} title="Expand">
              <Maximize2 size={17} />
            </button>
            {!worktree.isMain && (
              <button
                className={`nodrag btn-icon ${phase === 'confirm' ? 'btn-icon--warn' : ''} ${phase === 'forceNeeded' ? 'btn-icon--danger' : ''}`}
                onClick={handleDeleteClick}
                disabled={phase === 'deleting'}
              >
                {deleteLabel ?? <X size={15} />}
              </button>
            )}
          </div>
        </div>

        {worktree.baseBranch && (
          <div className="card-base-branch">
            <GitBranch size={11} className="card-base-branch-icon" />
            <span>from</span>
            <span className="card-base-branch-name">{worktree.baseBranch}</span>
          </div>
        )}
        {worktree.description && <div className="card-description">{worktree.description}</div>}
        {deleteError && <div className="inline-error">{deleteError}</div>}
        {vscodeError && <div className="inline-error">{vscodeError}</div>}

        <div className="card-meta">
          {worktree.status === 'dirty' ? (
            <>
              <span className="card-diff-summary">
                <span className="card-diff-files">{worktree.filesChanged} {worktree.filesChanged === 1 ? 'file' : 'files'}</span>
                <span className="stat-add">+{worktree.additions}</span>
                <span className="stat-del">-{worktree.deletions}</span>
              </span>
              <button className="nodrag btn-changes" onClick={() => setShowDiff(true)}>Changes</button>
              <button className="nodrag btn-changes btn-changes--editor" onClick={handleOpenVscode}>
                <Code2 size={12} /> View In Editor
              </button>
            </>
          ) : (
            <>
              <span className="card-diff-summary">
                <span className="card-diff-files">0 files</span>
                <span className="stat-add">+0</span>
                <span className="stat-del">-0</span>
              </span>
              <button className="nodrag btn-changes" onClick={() => setShowDiff(true)}>Changes</button>
              <button className="nodrag btn-changes btn-changes--editor" onClick={handleOpenVscode}>
                <Code2 size={12} /> View In Editor
              </button>
            </>
          )}
        </div>

        {sessions.length > 0 ? (
          <div className="card-terminal-section">
            {sessionTabs}
            {!termCollapsed && (
              !fullscreen ? (
                <div className="nodrag nopan card-inline-terminal" style={{ height: termHeight }} onMouseDown={(e) => e.stopPropagation()}>
                  {terminalInstances}
                </div>
              ) : (
                <div className="card-terminal-placeholder">↗ Expanded</div>
              )
            )}
          </div>
        ) : (
          <div className="card-actions">
            <button className="nodrag btn-agent" onClick={handleOpen} disabled={opening}>
              {opening ? 'Opening…' : 'Open Agent'}
            </button>
          </div>
        )}

        <div className="nodrag card-resize-handle" onMouseDown={handleResizeMouseDown}>
          <GripVertical size={14} />
        </div>
      </div>

      {showDiff && (
        <DiffViewer
          repoPath={worktree.path}
          branch={worktree.branch || worktree.name}
          onClose={() => setShowDiff(false)}
        />
      )}

      {showEditor && (
        <MonacoPanel
          repoPath={worktree.path}
          branch={worktree.branch || worktree.name}
          onClose={() => setShowEditor(false)}
        />
      )}

      {fullscreen && createPortal(
        <div className="card-fs-overlay" onClick={(e) => { if (e.target === e.currentTarget) setFullscreen(false); }}>
          <div className="card-fs-wrap">
            <div className="card-fs-header">
              <div className="card-title">
                <button
                  className="nodrag card-path-icon"
                  title={worktree.path}
                  onClick={() => fetch('/api/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dirPath: worktree.path }),
                  })}
                >
                  <Folder size={13} />
                  <span className="card-path-tooltip">{worktree.path}</span>
                </button>
                <GitBranch size={13} className="branch-glyph" />
                <span className="branch-name">{worktree.branch || worktree.name}</span>
                {worktree.isMain && <span className="badge">main</span>}
                {worktree.detached && <span className="badge badge--warn">detached</span>}
              </div>
              <div className="card-fs-header-meta">
                {worktree.status === 'dirty' ? (
                  <>
                    <span className="card-diff-summary">
                      <span className="card-diff-files">{worktree.filesChanged} {worktree.filesChanged === 1 ? 'file' : 'files'}</span>
                      <span className="stat-add">+{worktree.additions}</span>
                      <span className="stat-del">-{worktree.deletions}</span>
                    </span>
                    <button className="btn-changes" onClick={() => setShowDiff(true)}>Changes</button>
                    <button className="btn-changes btn-changes--editor" onClick={handleOpenVscode}>
                      <Code2 size={12} /> View In Editor
                    </button>
                  </>
                ) : (
                  <>
                    <span className="card-diff-summary">
                      <span className="card-diff-files">0 files</span>
                      <span className="stat-add">+0</span>
                      <span className="stat-del">-0</span>
                    </span>
                    <button className="btn-changes" onClick={() => setShowDiff(true)}>Changes</button>
                    <button className="btn-changes btn-changes--editor" onClick={handleOpenVscode}>
                      <Code2 size={12} /> View In Editor
                    </button>
                  </>
                )}
              </div>
              <button className="btn-icon" onClick={() => setFullscreen(false)} title="Minimize (Esc)">
                <Minimize2 size={16} />
              </button>
            </div>
            {sessions.length > 0 ? (
              <>
                {sessionTabs}
                <div className="card-fs-terminal">{terminalInstances}</div>
              </>
            ) : (
              <div className="card-fs-empty">
                <button className="btn-agent btn-agent--lg" onClick={handleOpen} disabled={opening}>
                  {opening ? 'Opening…' : 'Open Agent'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
