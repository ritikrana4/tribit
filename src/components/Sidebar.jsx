import { ICONS } from '../repoMeta.js';

function getIconLabel(iconId, repoName) {
  return ICONS.find((ic) => ic.id === iconId)?.label || repoName.charAt(0).toUpperCase();
}

export default function Sidebar({ repos, activeRepo, expanded, onToggle, onSwitch, onAddRepo, onRemoveRepo, onSettings }) {
  return (
    <aside className={`sidebar ${expanded ? 'sidebar--expanded' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggle} title={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? '‹' : '›'}
        </button>
      </div>

      <div className="sidebar-repos">
        {expanded && <span className="sidebar-section-label">Repos</span>}
        {repos.map((repo) => {
          const isActive = repo.path === activeRepo;
          const iconLabel = getIconLabel(repo.icon, repo.name);
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
                  {iconLabel}
                </span>
                {expanded && <span className="sidebar-item-label">{repo.name}</span>}
              </button>
              {expanded && !isActive && (
                <button
                  className="sidebar-item-remove"
                  onClick={() => onRemoveRepo(repo.path)}
                  title="Remove from list"
                >×</button>
              )}
            </div>
          );
        })}
        <button className="sidebar-item sidebar-item--add" onClick={onAddRepo} title="Add repository">
          <span className="sidebar-item-icon sidebar-item-icon--add">+</span>
          {expanded && <span className="sidebar-item-label">Add repo</span>}
        </button>
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={onSettings} title="Settings">
          <span className="sidebar-item-icon sidebar-item-icon--plain">⚙</span>
          {expanded && <span className="sidebar-item-label">Settings</span>}
        </button>
      </div>
    </aside>
  );
}
