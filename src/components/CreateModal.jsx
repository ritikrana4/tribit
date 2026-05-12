import { useState, useEffect } from 'react';

export default function CreateModal({ onClose, onCreated }) {
  const [branch, setBranch] = useState('');
  const [description, setDescription] = useState('');
  const [isNewBranch, setIsNewBranch] = useState(true);
  const [fromBranch, setFromBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [showBranchList, setShowBranchList] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    fetch('/api/branches')
      .then((r) => r.json())
      .then((data) => {
        setBranches(data.branches || []);
        if (data.current) {
          setFromBranch(data.current);
          setBranchFilter(data.current);
        }
      })
      .catch(() => {});
  }, []);

  const filteredBranches = branches.filter((b) =>
    b.toLowerCase().includes(branchFilter.toLowerCase())
  );

  const handleSelectBranch = (b) => {
    setFromBranch(b);
    setBranchFilter(b);
    setShowBranchList(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!branch.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: branch.trim(),
          isNewBranch,
          description,
          fromBranch: isNewBranch ? fromBranch : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.path);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New Worktree</span>
          <button className="btn-icon modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field-row">
              <input
                className="input"
                type="text"
                placeholder="branch-name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                autoFocus
                spellCheck={false}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isNewBranch}
                  onChange={(e) => setIsNewBranch(e.target.checked)}
                />
                new branch
              </label>
            </div>

            {isNewBranch && branches.length > 0 && (
              <div className="from-branch-wrap">
                <label className="from-branch-label">From</label>
                <div className="from-branch-picker">
                  <input
                    className="input"
                    type="text"
                    placeholder="base branch…"
                    value={branchFilter}
                    onChange={(e) => {
                      setBranchFilter(e.target.value);
                      setFromBranch(e.target.value);
                      setShowBranchList(true);
                    }}
                    onFocus={() => setShowBranchList(true)}
                    onBlur={() => setTimeout(() => setShowBranchList(false), 150)}
                    spellCheck={false}
                  />
                  {showBranchList && filteredBranches.length > 0 && (
                    <div className="branch-dropdown">
                      {filteredBranches.map((b) => (
                        <button
                          key={b}
                          type="button"
                          className={`branch-option ${b === fromBranch ? 'branch-option--active' : ''}`}
                          onMouseDown={() => handleSelectBranch(b)}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <input
              className="input"
              type="text"
              placeholder="description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck={false}
            />
            {error && <div className="form-error">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || !branch.trim()}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
