import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Editor from '@monaco-editor/react';
import { Minimize2, ChevronRight, ChevronDown, File, Folder, FolderOpen, Save, X } from 'lucide-react';

function getLang(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript',
    py: 'python', pyw: 'python',
    rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', json5: 'json',
    yaml: 'yaml', yml: 'yaml',
    md: 'markdown', mdx: 'markdown',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    sql: 'sql', xml: 'xml', svg: 'xml',
    env: 'plaintext', txt: 'plaintext', log: 'plaintext',
    graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile', toml: 'ini',
  }[ext] ?? 'plaintext';
}

function TreeNode({ node, depth, onFileClick, activeFilePath }) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === 'file') {
    return (
      <button
        className={`me-tree-file ${node.path === activeFilePath ? 'me-tree-file--active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onFileClick(node)}
        title={node.path}
      >
        <File size={12} className="me-tree-icon" />
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        className="me-tree-dir"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {open
          ? <FolderOpen size={12} className="me-tree-icon me-tree-icon--dir" />
          : <Folder size={12} className="me-tree-icon me-tree-icon--dir" />}
        {node.name}
      </button>
      {open && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} activeFilePath={activeFilePath} />
      ))}
    </div>
  );
}

export default function MonacoPanel({ repoPath, branch, onClose }) {
  const [tree, setTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTreeLoading(true);
    setTreeError(null);
    fetch(`/api/files/tree?dirPath=${encodeURIComponent(repoPath)}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { setTree(d.tree || []); setTreeLoading(false); })
      .catch((e) => { setTreeError(e.message); setTreeLoading(false); });
  }, [repoPath]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const openFile = useCallback(async (node) => {
    const existing = tabs.find((t) => t.path === node.path);
    if (existing) { setActiveTab(node.path); return; }
    try {
      const res = await fetch(`/api/files/read?filePath=${encodeURIComponent(node.path)}`);
      const data = await res.json();
      if (data.error) return;
      setTabs((prev) => [...prev, { path: node.path, name: node.name, content: data.content, dirty: false }]);
      setActiveTab(node.path);
    } catch {}
  }, [tabs]);

  const closeTab = (tabPath, e) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== tabPath);
      if (activeTab === tabPath) setActiveTab(next[next.length - 1]?.path ?? null);
      return next;
    });
  };

  const handleEditorChange = (value) => {
    setTabs((prev) => prev.map((t) => t.path === activeTab ? { ...t, content: value, dirty: true } : t));
  };

  const saveActive = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activeTab);
    if (!tab || !tab.dirty) return;
    setSaving(true);
    try {
      await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: tab.path, content: tab.content }),
      });
      setTabs((prev) => prev.map((t) => t.path === activeTab ? { ...t, dirty: false } : t));
    } finally {
      setSaving(false);
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveActive(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveActive]);

  const activeTabData = tabs.find((t) => t.path === activeTab) ?? null;

  return createPortal(
    <div className="me-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="me-wrap">

        <div className="me-header">
          <span className="me-title">{branch}</span>
          <div className="me-tabs">
            {tabs.map((tab) => (
              <div
                key={tab.path}
                className={`me-tab ${tab.path === activeTab ? 'me-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.path)}
                title={tab.path}
              >
                <span>{tab.name}</span>
                {tab.dirty && <span className="me-tab-dot" />}
                <button className="me-tab-close" onClick={(e) => closeTab(tab.path, e)}><X size={10} /></button>
              </div>
            ))}
          </div>
          <div className="me-header-right">
            {activeTabData?.dirty && (
              <button className="me-save-btn" onClick={saveActive} disabled={saving} title="Save (Cmd+S)">
                <Save size={13} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button className="btn-icon" onClick={onClose} title="Close (Esc)">
              <Minimize2 size={16} />
            </button>
          </div>
        </div>

        <div className="me-body">
          <div className="me-sidebar">
            <div className="me-sidebar-label">EXPLORER</div>
            {treeLoading && <div className="me-sidebar-state">Loading…</div>}
            {treeError && <div className="me-sidebar-state me-sidebar-state--error">Failed to load</div>}
            {!treeLoading && !treeError && tree.length === 0 && <div className="me-sidebar-state">No files found</div>}
            {tree.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} onFileClick={openFile} activeFilePath={activeTab} />
            ))}
          </div>

          <div className="me-editor-area">
            {activeTabData ? (
              <Editor
                key={activeTabData.path}
                theme="vs-dark"
                language={getLang(activeTabData.name)}
                value={activeTabData.content}
                onChange={handleEditorChange}
                options={{
                  fontSize: 13,
                  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 16 },
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  wordWrap: 'off',
                }}
              />
            ) : (
              <div className="me-empty">Select a file from the explorer</div>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}
