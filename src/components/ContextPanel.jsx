import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, FileText, Brain } from 'lucide-react';
import Editor from '@monaco-editor/react';

const MONACO_OPTIONS = {
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  padding: { top: 12 },
  lineNumbers: 'on',
  wordWrap: 'on',
  contextmenu: false,
};

function parseMemoryFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { type: 'unknown', name: null };
  const block = match[1];
  const typeMatch = block.match(/^type:\s*(.+)$/m);
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  return {
    type: typeMatch ? typeMatch[1].trim() : 'unknown',
    name: nameMatch ? nameMatch[1].trim() : null,
  };
}

const SCOPE_STYLES = {
  global:  { bg: 'rgba(124,92,252,0.12)', color: '#7c5cfc', border: 'rgba(124,92,252,0.28)' },
  project: { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e', border: 'rgba(34,197,94,0.28)' },
  subdir:  { bg: 'rgba(136,136,136,0.1)', color: '#888',    border: 'rgba(136,136,136,0.2)' },
};

const TYPE_STYLES = {
  user:      { bg: 'rgba(124,92,252,0.12)', color: '#7c5cfc', border: 'rgba(124,92,252,0.28)' },
  feedback:  { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b', border: 'rgba(245,158,11,0.28)' },
  project:   { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e', border: 'rgba(34,197,94,0.28)' },
  reference: { bg: 'rgba(56,189,248,0.1)',  color: '#38bdf8', border: 'rgba(56,189,248,0.28)' },
  unknown:   { bg: 'rgba(136,136,136,0.1)', color: '#888',    border: 'rgba(136,136,136,0.2)' },
};

function InlineBadge({ label, style }) {
  return (
    <span className="cp-badge" style={{ background: style.bg, color: style.color, borderColor: style.border }}>
      {label}
    </span>
  );
}

export default function ContextPanel({ wtPath, branch, onClose }) {
  const [activeTab, setActiveTab] = useState('claudemd');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [claudeMdFiles, setClaudeMdFiles] = useState([]);
  const [memoryFiles, setMemoryFiles] = useState([]);
  const [selectedClaudeMd, setSelectedClaudeMd] = useState(null);
  const [selectedMemory, setSelectedMemory] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [creating, setCreating] = useState(false);

  const monacoTheme = (localStorage.getItem('tribit-theme') || 'dark') === 'light' ? 'light' : 'vs-dark';

  useEffect(() => {
    fetch(`/api/context?wtPath=${encodeURIComponent(wtPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        const mdFiles = data.claudeMdFiles || [];
        const mFiles = data.memoryFiles || [];
        setClaudeMdFiles(mdFiles);
        setMemoryFiles(mFiles);
        if (mdFiles.length > 0) {
          setSelectedClaudeMd(mdFiles[0]);
          setEditContent(mdFiles[0].content);
        }
        if (mFiles.length > 0) setSelectedMemory(mFiles[0]);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [wtPath]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const selectClaudeMd = (f) => {
    setSelectedClaudeMd(f);
    setEditContent(f.content);
    setSaveMsg(null);
  };

  const handleSave = async () => {
    if (!selectedClaudeMd) return;
    setSaving(true);
    try {
      const res = await fetch('/api/context/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedClaudeMd.path, content: editContent }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveMsg('Saved');
        setClaudeMdFiles((prev) =>
          prev.map((f) => f.path === selectedClaudeMd.path ? { ...f, content: editContent } : f)
        );
        setSelectedClaudeMd((f) => ({ ...f, content: editContent }));
      } else {
        setSaveMsg('Error: ' + (data.error || 'unknown'));
      }
    } catch (e) {
      setSaveMsg('Error: ' + e.message);
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleCreateProjectClaudeMd = async () => {
    setCreating(true);
    const newPath = `${wtPath}/CLAUDE.md`;
    const content = '# Project Context\n\nAdd context here to guide Claude\'s behavior in this project.\n';
    try {
      const res = await fetch('/api/context/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, content }),
      });
      const data = await res.json();
      if (data.ok) {
        const newFile = { path: newPath, label: 'CLAUDE.md', content, scope: 'project' };
        setClaudeMdFiles((prev) => [...prev, newFile]);
        setSelectedClaudeMd(newFile);
        setEditContent(content);
      }
    } catch (_) {}
    setCreating(false);
  };

  return createPortal(
    <div className="dv-overlay">
      <div className="dv-wrap">

        <div className="dv-header">
          <span className="dv-title">Context</span>
          <span className="cp-branch">{branch}</span>
          <button className="btn-icon dv-close-btn" onClick={onClose} title="Close (Esc)">
            <Minimize2 size={16} />
          </button>
        </div>

        <div className="dv-tabs">
          <button
            className={`dv-tab ${activeTab === 'claudemd' ? 'dv-tab--active' : ''}`}
            onClick={() => setActiveTab('claudemd')}
          >
            CLAUDE.md
            {claudeMdFiles.length > 0 && <span className="cp-tab-count">{claudeMdFiles.length}</span>}
          </button>
          <button
            className={`dv-tab ${activeTab === 'memory' ? 'dv-tab--active' : ''}`}
            onClick={() => setActiveTab('memory')}
          >
            Memory
            {memoryFiles.length > 0 && <span className="cp-tab-count">{memoryFiles.length}</span>}
          </button>
        </div>

        <div className="dv-body">
          {loading && <div className="dv-state">Loading context…</div>}
          {!loading && error && <div className="dv-state dv-state--error">Error: {error}</div>}

          {/* ── CLAUDE.md tab ── */}
          {!loading && !error && activeTab === 'claudemd' && (
            <>
              <div className="dv-sidebar cp-sidebar">
                {claudeMdFiles.length === 0 ? (
                  <div className="cp-empty">
                    <FileText size={22} className="cp-empty-icon" />
                    <span className="cp-empty-text">No CLAUDE.md found</span>
                  </div>
                ) : (
                  claudeMdFiles.map((f) => (
                    <button
                      key={f.path}
                      className={`cp-file-btn ${selectedClaudeMd?.path === f.path ? 'cp-file-btn--active' : ''}`}
                      onClick={() => selectClaudeMd(f)}
                    >
                      <InlineBadge label={f.scope} style={SCOPE_STYLES[f.scope] || SCOPE_STYLES.subdir} />
                      <span className="cp-file-label">{f.label}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="dv-area">
                {!selectedClaudeMd ? (
                  <div className="cp-create-state">
                    <FileText size={28} className="cp-create-icon" />
                    <p className="cp-create-text">
                      CLAUDE.md files let you give Claude persistent context about your project — conventions, architecture, key files, and things to avoid.
                    </p>
                    <button className="cp-create-btn" onClick={handleCreateProjectClaudeMd} disabled={creating}>
                      {creating ? 'Creating…' : 'Create CLAUDE.md for this worktree'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="dv-file-header">
                      <span>{selectedClaudeMd.label}</span>
                      <div className="cp-save-area">
                        {saveMsg && (
                          <span className={`cp-save-msg ${saveMsg.startsWith('Error') ? 'cp-save-msg--error' : ''}`}>
                            {saveMsg}
                          </span>
                        )}
                        <button className="cp-save-btn" onClick={handleSave} disabled={saving}>
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <div className="dv-monaco-wrap">
                      <Editor
                        key={selectedClaudeMd.path}
                        theme={monacoTheme}
                        language="markdown"
                        value={editContent}
                        onChange={(v) => setEditContent(v ?? '')}
                        options={MONACO_OPTIONS}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Memory tab ── */}
          {!loading && !error && activeTab === 'memory' && (
            <>
              <div className="dv-sidebar cp-sidebar">
                {memoryFiles.length === 0 ? (
                  <div className="cp-empty">
                    <Brain size={22} className="cp-empty-icon" />
                    <span className="cp-empty-text">No memory yet</span>
                  </div>
                ) : (
                  memoryFiles.map((f) => {
                    const { type, name } = parseMemoryFrontmatter(f.content);
                    return (
                      <button
                        key={f.path}
                        className={`cp-file-btn ${selectedMemory?.path === f.path ? 'cp-file-btn--active' : ''}`}
                        onClick={() => setSelectedMemory(f)}
                      >
                        <InlineBadge label={type} style={TYPE_STYLES[type] || TYPE_STYLES.unknown} />
                        <span className="cp-file-label">{name || f.name.replace(/\.md$/, '')}</span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="dv-area">
                {!selectedMemory ? (
                  <div className="dv-state">
                    Claude Code writes memory files here automatically as you work together. They appear once you start a Claude session in this project.
                  </div>
                ) : (
                  <>
                    <div className="dv-file-header">
                      <span>{selectedMemory.name}</span>
                      <span className="cp-readonly-label">read-only</span>
                    </div>
                    <div className="dv-monaco-wrap">
                      <Editor
                        key={selectedMemory.path}
                        theme={monacoTheme}
                        language="markdown"
                        value={selectedMemory.content}
                        options={{ ...MONACO_OPTIONS, readOnly: true }}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
