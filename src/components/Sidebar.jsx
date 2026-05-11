import { useState } from 'react';
import { ChevronLeft, ChevronDown, Plus, X, Settings, Zap, GitBranch } from 'lucide-react';
import { ICONS } from '../repoMeta.js';

function RepoIcon({ iconId, repoName, size = 15 }) {
  const match = ICONS.find((ic) => ic.id === iconId);
  if (match) return <match.Icon size={size} />;
  return <span>{repoName.charAt(0).toUpperCase()}</span>;
}

export default function Sidebar({
  repos,
  activeRepo,
  expanded,
  onToggle,
  onSwitch,
  onAddRepo,
  onRemoveRepo,
  onSettings,
  allWorktrees = [],
  sessions = [],
  onNavigate,
}) {
  const [collapsedRepos, setCollapsedRepos] = useState(new Set());

  const toggleTree = (repoPath, e) => {
    e.stopPropagation();
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) next.delete(repoPath);
      else next.add(repoPath);
      return next;
    });
  };

  return (
    <aside className={`sidebar ${expanded ? 'sidebar--expanded' : ''}`}>
      <div className="sidebar-header">
        {expanded ? (
          <>
            <div className="sidebar-brand">
              <Zap size={14} className="sidebar-brand-zap" />
              <span className="sidebar-brand-text">wooop</span>
            </div>
            <button className="sidebar-toggle" onClick={onToggle} title="Collapse">
              <ChevronLeft size={15} />
            </button>
          </>
        ) : (
          <button className="sidebar-logo-btn" onClick={onToggle} title="Expand">
            <div className="sidebar-logo-mark">
              <span className="sidebar-logo-w">W</span>
              <Zap size={7} className="sidebar-logo-zap" />
            </div>
          </button>
        )}
      </div>

      <div className="sidebar-repos">
        {expanded && <span className="sidebar-section-label">Repos</span>}
        {repos.map((repo) => {
          const isActive = repo.path === activeRepo;
          const accentColor = repo.color || '#6b7280';
          const repoWorktrees = expanded
            ? allWorktrees.filter((wt) => wt.repoPath === repo.path)
            : [];
          const treeOpen = !collapsedRepos.has(repo.path);
          const totalAgents = repoWorktrees.reduce(
            (n, wt) => n + sessions.filter((s) => s.wtPath === wt.path).length,
            0
          );

          return (
            <div key={repo.path} className="sidebar-repo-section">
              <div className={`sidebar-item-wrap ${isActive ? 'sidebar-item-wrap--active' : ''}`}>
                <button
                  className="sidebar-item"
                  onClick={() => onSwitch(repo.path)}
                  title={repo.path}
                >
                  <span
                    className="sidebar-item-icon"
                    style={{
                      background: `${accentColor}22`,
                      color: accentColor,
                      border: `1px solid ${isActive ? accentColor + '55' : 'transparent'}`,
                    }}
                  >
                    <RepoIcon iconId={repo.icon} repoName={repo.name} />
                  </span>
                  {expanded && <span className="sidebar-item-label">{repo.name}</span>}
                  {expanded && totalAgents > 0 && (
                    <span className="sidebar-repo-agents">{totalAgents}</span>
                  )}
                </button>

                {expanded && repoWorktrees.length > 0 && (
                  <button
                    className={`sidebar-repo-chevron ${treeOpen ? '' : 'sidebar-repo-chevron--collapsed'}`}
                    onClick={(e) => toggleTree(repo.path, e)}
                    title={treeOpen ? 'Collapse worktrees' : 'Expand worktrees'}
                  >
                    <ChevronDown size={11} />
                  </button>
                )}

                {expanded && !isActive && (
                  <button
                    className="sidebar-item-remove"
                    onClick={() => onRemoveRepo(repo.path)}
                    title="Remove from list"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {expanded && treeOpen && repoWorktrees.length > 0 && (
                <div className="sidebar-wt-group">
                  {repoWorktrees.map((wt) => {
                    const wtSessions = sessions.filter((s) => s.wtPath === wt.path);
                    return (
                      <div key={wt.path} className="sidebar-wt-item">
                        <button
                          className="sidebar-wt-btn"
                          onClick={() => onNavigate?.(wt.path, wt.repoPath)}
                          title={wt.path}
                        >
                          <GitBranch size={9} className="sidebar-wt-icon" />
                          <span className="sidebar-wt-label">{wt.name}</span>
                          {wtSessions.length > 0 && (
                            <span className="sidebar-wt-count">{wtSessions.length}</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <button className="sidebar-item sidebar-item--add" onClick={onAddRepo} title="Add repository">
          <span className="sidebar-item-icon sidebar-item-icon--add"><Plus size={15} /></span>
          {expanded && <span className="sidebar-item-label">Add repo</span>}
        </button>
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={onSettings} title="Settings">
          <span className="sidebar-item-icon sidebar-item-icon--plain"><Settings size={15} /></span>
          {expanded && <span className="sidebar-item-label">Settings</span>}
        </button>
      </div>
    </aside>
  );
}
