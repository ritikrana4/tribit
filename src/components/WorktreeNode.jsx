import { useState, useEffect, useRef } from 'react';

export default function WorktreeNode({ data }) {
  const { onDelete, onOpenCopilot, onKillTerminal, onNewSession, onSwitchSession, onRenameSession, agent = 'claude', ...worktree } = data;
  const [phase, setPhase] = useState('idle');
  const [deleteError, setDeleteError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);

  // Collapse dropdown on click outside the card
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [expanded]);

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

  const handleOpenCopilot = async () => {
    setOpening(true);
    await onOpenCopilot(worktree.path);
    setTimeout(() => setOpening(false), 600);
  };

  const handleNewSession = async () => {
    setOpening(true);
    await onNewSession(worktree.path);
    setTimeout(() => setOpening(false), 600);
  };

  const deleteLabel = {
    idle: '×',
    confirm: 'Delete?',
    deleting: '···',
    forceNeeded: 'Force?',
  }[phase];

  const sessions = worktree.sessions || [];
  const hasMultiple = sessions.length > 1;

  return (
    <div ref={cardRef} className={`card ${worktree.isMain ? 'card--main' : ''}`}>
      <div className="card-header">
        <div className="card-title">
          <span className="branch-glyph">⎇</span>
          <span className="branch-name">{worktree.branch || worktree.name}</span>
          {worktree.isMain && <span className="badge">main</span>}
          {worktree.detached && <span className="badge badge--warn">detached</span>}
        </div>
        {!worktree.isMain && (
          <button
            className={`nodrag btn-icon ${phase === 'confirm' ? 'btn-icon--warn' : ''} ${phase === 'forceNeeded' ? 'btn-icon--danger' : ''}`}
            onClick={handleDeleteClick}
            disabled={phase === 'deleting'}
          >
            {deleteLabel}
          </button>
        )}
      </div>

      <div className="card-path">{worktree.path}</div>

      {worktree.description && (
        <div className="card-description">{worktree.description}</div>
      )}

      {deleteError && phase !== 'forceNeeded' && (
        <div className="inline-error">{deleteError}</div>
      )}

      <div className="card-meta">
        <span className={`status-dot status-dot--${worktree.status}`} />
        <span className="meta-text">{worktree.status}</span>
        {worktree.head && <span className="meta-sha">{worktree.head.slice(0, 7)}</span>}
      </div>

      <div className="card-actions">
        <button
          className={`nodrag btn-copilot ${worktree.hasTerminal ? 'btn-copilot--active' : ''}`}
          onClick={handleOpenCopilot}
          disabled={opening}
        >
          {opening
            ? 'Opening…'
            : worktree.hasTerminal
              ? `↑ Focus ${agent === 'copilot' ? 'Copilot' : 'Claude'}`
              : `Open ${agent === 'copilot' ? 'Copilot' : 'Claude'}`}
        </button>
      </div>

      {worktree.hasTerminal && (
        <div className="session-row">
          <span className="session-id">◉ PID {worktree.sessionPid}</span>
          {hasMultiple && (
            <button
              className="nodrag btn-session-expand"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? 'Collapse sessions' : 'Expand sessions'}
            >
              {expanded ? '▾' : '▸'} {sessions.length}
            </button>
          )}
          <button
            className="nodrag btn-session-add"
            onClick={handleNewSession}
            disabled={opening}
            title="New session"
          >
            +
          </button>
        </div>
      )}

      {expanded && hasMultiple && (
        <div className="session-list">
          {sessions.map((s, i) => (
            <div key={s.sessionId} className="session-item">
              <SessionLabel
                session={s}
                index={i}
                onSwitch={() => onSwitchSession(worktree.path, s.sessionId)}
                onRename={(name) => onRenameSession(s.sessionId, name)}
              />
              <button
                className="nodrag btn-session-kill"
                onClick={() => onKillTerminal(s.sessionId)}
                title="Kill this session"
              >
                ■
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionLabel({ session, index, onSwitch, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.customName || '');

  const label = session.customName || `#${index + 1} · PID ${session.pid}`;

  const handleSubmit = () => {
    onRename(value.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="nodrag session-rename-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        spellCheck={false}
        placeholder={`#${index + 1}`}
      />
    );
  }

  return (
    <>
      <button
        className="nodrag btn-session-switch"
        onClick={onSwitch}
        title="Switch to this session"
      >
        {label}
      </button>
      <button
        className="nodrag btn-session-edit"
        onClick={() => setEditing(true)}
        title="Rename session"
      >
        ✎
      </button>
    </>
  );
}
