import { ChevronLeft, Plus, X, Settings, Zap } from 'lucide-react';
import { ICONS } from '../repoMeta.js';

function RepoIcon({ iconId, repoName, size = 15 }) {
  const match = ICONS.find((ic) => ic.id === iconId);
  if (match) return <match.Icon size={size} />;
  return <span>{repoName.charAt(0).toUpperCase()}</span>;
}

export default function Sidebar({ repos, activeRepo, expanded, onToggle, onSwitch, onAddRepo, onRemoveRepo, onSettings }) {
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
          return (
            <div
              key={repo.path}
              className={`sidebar-item-wrap ${isActive ? 'sidebar-item-wrap--active' : ''}`}
            >
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
              </button>
              {expanded && !isActive && (
                <button
                  className="sidebar-item-remove"
                  onClick={() => onRemoveRepo(repo.path)}
                  title="Remove from list"
                ><X size={12} /></button>
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
