import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';

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

/* ── Diff parser (used for file list + stats only) ────────── */

function parseDiff(raw) {
  if (!raw?.trim()) return [];
  const files = [];
  const sections = raw.split(/^diff --git /m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    let oldPath = '', newPath = '';
    let i = 1;
    let isBinary = false;

    const pm = (lines[0] || '').match(/^a\/(.+) b\/(.+)$/);
    if (pm) { oldPath = pm[1]; newPath = pm[2]; }

    while (i < lines.length && !lines[i].startsWith('@@')) {
      if (lines[i].startsWith('--- a/')) oldPath = lines[i].slice(6);
      else if (lines[i].startsWith('+++ b/')) newPath = lines[i].slice(6);
      else if (lines[i].includes('Binary files')) isBinary = true;
      i++;
    }

    if (isBinary) {
      files.push({ path: newPath || oldPath, isBinary: true, additions: 0, deletions: 0 });
      continue;
    }

    let fileAdd = 0, fileDel = 0;
    while (i < lines.length) {
      if (!lines[i].startsWith('@@')) { i++; continue; }
      i++;
      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git')) {
        const rl = lines[i++];
        if (rl.startsWith('-')) fileDel++;
        else if (rl.startsWith('+')) fileAdd++;
      }
    }

    files.push({ path: newPath || oldPath, isBinary: false, additions: fileAdd, deletions: fileDel });
  }
  return files;
}

/* ── File tree (Project tab) ──────────────────────────────── */

function FileTreeNode({ node, depth, onFileClick, activeFilePath }) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === 'file') {
    return (
      <button
        className={`dv-tree-file ${node.path === activeFilePath ? 'dv-tree-file--active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onFileClick(node)}
        title={node.path}
      >
        <File size={13} className="dv-tree-icon" />
        <span className="dv-tree-name">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        className="dv-tree-dir"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dv-tree-chevron">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {open
          ? <FolderOpen size={13} className="dv-tree-icon dv-tree-icon--folder" />
          : <Folder size={13} className="dv-tree-icon dv-tree-icon--folder" />}
        <span className="dv-tree-name">{node.name}</span>
      </button>
      {open && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          onFileClick={onFileClick}
          activeFilePath={activeFilePath}
        />
      ))}
    </div>
  );
}

/* ── Main DiffViewer ──────────────────────────────────────── */

const MONACO_OPTIONS = {
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  padding: { top: 12 },
  lineNumbers: 'on',
  renderLineHighlight: 'line',
  wordWrap: 'off',
  contextmenu: false,
};

export default function DiffViewer({ repoPath, branch, onClose }) {
  const [activeTab, setActiveTab] = useState('changes');
  const monacoTheme = (localStorage.getItem('tribit-theme') || 'dark') === 'light' ? 'light' : 'vs-dark';

  // Changes tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diffOriginal, setDiffOriginal] = useState('');
  const [diffModified, setDiffModified] = useState('');
  const [diffContentLoading, setDiffContentLoading] = useState(false);

  // Project tab
  const [fileTree, setFileTree] = useState([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState(null);
  const [selectedTreePath, setSelectedTreePath] = useState(null);
  const [treeFileContent, setTreeFileContent] = useState(null);
  const [treeFileLoading, setTreeFileLoading] = useState(false);

  // Load changed-file list
  useEffect(() => {
    fetch(`/api/diff?repoPath=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        const parsed = parseDiff(data.diff);
        setFiles(parsed);
        if (parsed.length > 0) setSelectedFile(parsed[0].path);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [repoPath]);

  // Load original + modified when selected file changes
  useEffect(() => {
    if (!selectedFile || activeTab !== 'changes') return;
    setDiffContentLoading(true);
    const fullPath = `${repoPath}/${selectedFile}`;
    Promise.all([
      fetch(`/api/git/original?repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(selectedFile)}`).then((r) => r.json()),
      fetch(`/api/files/read?filePath=${encodeURIComponent(fullPath)}`).then((r) => r.json()),
    ]).then(([orig, mod]) => {
      setDiffOriginal(orig.content ?? '');
      setDiffModified(mod.content ?? '');
      setDiffContentLoading(false);
    }).catch(() => {
      setDiffOriginal('');
      setDiffModified('');
      setDiffContentLoading(false);
    });
  }, [selectedFile, repoPath, activeTab]);

  // Load project file tree
  useEffect(() => {
    if (activeTab !== 'project') return;
    if (fileTree.length > 0 || fileTreeLoading) return;
    setFileTreeLoading(true);
    setFileTreeError(null);
    fetch(`/api/files/tree?dirPath=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((data) => { setFileTree(data.tree || []); setFileTreeLoading(false); })
      .catch((e) => { setFileTreeError(e.message); setFileTreeLoading(false); });
  }, [activeTab, repoPath, fileTree.length, fileTreeLoading]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleTreeFileClick = useCallback(async (node) => {
    if (selectedTreePath === node.path) return;
    setSelectedTreePath(node.path);
    setTreeFileContent(null);
    setTreeFileLoading(true);
    try {
      const res = await fetch(`/api/files/read?filePath=${encodeURIComponent(node.path)}`);
      const data = await res.json();
      setTreeFileContent(data.error ? { error: data.error } : { name: node.name, content: data.content });
    } catch (e) {
      setTreeFileContent({ error: e.message });
    }
    setTreeFileLoading(false);
  }, [selectedTreePath]);

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const currentFile = files.find((f) => f.path === selectedFile) || null;

  return createPortal(
    <div className="dv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dv-wrap">

        {/* Header */}
        <div className="dv-header">
          <span className="dv-title">{branch}</span>
          {activeTab === 'changes' && (
            <div className="dv-totals">
              <span className="stat-add">+{totalAdd}</span>
              <span className="stat-del">-{totalDel}</span>
              <span className="dv-file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
            </div>
          )}
          <button className="btn-icon dv-close-btn" onClick={onClose} title="Close (Esc)"><Minimize2 size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="dv-tabs">
          <button className={`dv-tab ${activeTab === 'project' ? 'dv-tab--active' : ''}`} onClick={() => setActiveTab('project')}>
            Project
          </button>
          <button className={`dv-tab ${activeTab === 'changes' ? 'dv-tab--active' : ''}`} onClick={() => setActiveTab('changes')}>
            Changes
            {files.length > 0 && (
              <span className="dv-tab-stats">
                <span className="stat-add">+{totalAdd}</span>
                <span className="stat-del">-{totalDel}</span>
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="dv-body">

          {/* ── Project tab ── */}
          {activeTab === 'project' && (
            <>
              <div className="dv-sidebar dv-sidebar--tree">
                {fileTreeLoading && <div className="dv-state">Loading…</div>}
                {fileTreeError && <div className="dv-state dv-state--error">Failed to load</div>}
                {!fileTreeLoading && !fileTreeError && fileTree.length === 0 && (
                  <div className="dv-state">No files found</div>
                )}
                {fileTree.map((node) => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    onFileClick={handleTreeFileClick}
                    activeFilePath={selectedTreePath}
                  />
                ))}
              </div>

              <div className="dv-area">
                {!selectedTreePath && <div className="dv-state">Select a file to view its contents</div>}
                {selectedTreePath && treeFileLoading && <div className="dv-state">Loading…</div>}
                {selectedTreePath && !treeFileLoading && treeFileContent?.error && (
                  <div className="dv-state dv-state--error">{treeFileContent.error}</div>
                )}
                {selectedTreePath && !treeFileLoading && treeFileContent?.content != null && (
                  <>
                    <div className="dv-file-header"><span>{selectedTreePath}</span></div>
                    <div className="dv-monaco-wrap">
                      <Editor
                        key={selectedTreePath}
                        theme={monacoTheme}
                        language={getLang(treeFileContent.name)}
                        value={treeFileContent.content}
                        options={{ ...MONACO_OPTIONS, readOnly: true }}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Changes tab ── */}
          {activeTab === 'changes' && (
            <>
              <div className="dv-sidebar">
                {files.map((f) => {
                  const name = f.path.split('/').pop();
                  const dir = f.path.split('/').slice(0, -1).join('/');
                  return (
                    <button
                      key={f.path}
                      className={`dv-file-btn ${f.path === selectedFile ? 'dv-file-btn--active' : ''}`}
                      onClick={() => setSelectedFile(f.path)}
                      title={f.path}
                    >
                      <div className="dv-file-top">
                        <span className="dv-file-name">{name}</span>
                        <span className="dv-file-badge">M</span>
                      </div>
                      {dir && <span className="dv-file-dir">{dir}</span>}
                      <div className="dv-file-stats">
                        <span className="stat-add">+{f.additions}</span>
                        <span className="stat-del">-{f.deletions}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="dv-area">
                {loading && <div className="dv-state">Loading diff…</div>}
                {error && <div className="dv-state dv-state--error">Error: {error}</div>}
                {!loading && !error && files.length === 0 && (
                  <div className="dv-state">No uncommitted changes</div>
                )}
                {currentFile && (
                  <>
                    <div className="dv-file-header">
                      <span>{currentFile.path}</span>
                      {currentFile.isBinary && <span className="dv-file-count">Binary</span>}
                      {!currentFile.isBinary && (
                        <span className="dv-file-header-stats">
                          <span className="stat-add">+{currentFile.additions}</span>
                          <span className="stat-del">-{currentFile.deletions}</span>
                        </span>
                      )}
                    </div>
                    {currentFile.isBinary
                      ? <div className="dv-state">Binary file — no preview</div>
                      : diffContentLoading
                        ? <div className="dv-state">Loading…</div>
                        : (
                          <div className="dv-monaco-wrap">
                            <DiffEditor
                              key={currentFile.path}
                              theme={monacoTheme}
                              language={getLang(currentFile.path.split('/').pop())}
                              original={diffOriginal}
                              modified={diffModified}
                              options={{
                                ...MONACO_OPTIONS,
                                readOnly: true,
                                renderSideBySide: true,
                                ignoreTrimWhitespace: false,
                              }}
                            />
                          </div>
                        )
                    }
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
