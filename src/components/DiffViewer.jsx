import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Minimize2, Copy, Trash2, MessageSquare, Plus } from 'lucide-react';

/* ── Diff parser ──────────────────────────────────────────── */

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
      files.push({ path: newPath || oldPath, isBinary: true, hunks: [], additions: 0, deletions: 0 });
      continue;
    }

    const hunks = [];
    let fileAdd = 0, fileDel = 0;

    while (i < lines.length) {
      if (!lines[i].startsWith('@@')) { i++; continue; }
      const m = lines[i].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (!m) { i++; continue; }
      const oldStart = parseInt(m[1]);
      const newStart = parseInt(m[2]);
      const context = m[3]?.trim() || '';
      i++;

      let oldLn = oldStart, newLn = newStart;
      const typed = [];

      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git')) {
        const rl = lines[i++];
        if (rl.startsWith('-')) {
          typed.push({ type: 'removed', oldLn: oldLn++, content: rl.slice(1) });
          fileDel++;
        } else if (rl.startsWith('+')) {
          typed.push({ type: 'added', newLn: newLn++, content: rl.slice(1) });
          fileAdd++;
        } else if (rl.startsWith(' ')) {
          typed.push({ type: 'context', oldLn: oldLn++, newLn: newLn++, content: rl.slice(1) });
        }
      }

      hunks.push({ oldStart, newStart, context, rows: toSideBySide(typed) });
    }

    files.push({ path: newPath || oldPath, isBinary: false, hunks, additions: fileAdd, deletions: fileDel });
  }
  return files;
}

function toSideBySide(lines) {
  const rows = [];
  let rem = [], add = [];

  const flush = () => {
    const n = Math.max(rem.length, add.length);
    for (let i = 0; i < n; i++) rows.push({ left: rem[i] || null, right: add[i] || null });
    rem = []; add = [];
  };

  for (const l of lines) {
    if (l.type === 'context') { flush(); rows.push({ left: l, right: l }); }
    else if (l.type === 'removed') rem.push(l);
    else if (l.type === 'added') add.push(l);
  }
  flush();
  return rows;
}

/* ── Comment form ─────────────────────────────────────────── */

function CommentForm({ onSave, onCancel }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className="dv-comment-form">
      <textarea
        ref={ref}
        className="dv-comment-input"
        placeholder="Add a comment… (Enter to save, Shift+Enter for newline)"
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) onSave(text); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="dv-comment-form-actions">
        <button className="dv-btn-primary" onClick={() => text.trim() && onSave(text)} disabled={!text.trim()}>Save</button>
        <button className="dv-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ── DiffRow ──────────────────────────────────────────────── */

function DiffRow({ row, fileComments, selectedFile, addingComment, setAddingComment, addComment, removeComment }) {
  const leftLn = row.left?.oldLn;
  const rightLn = row.right?.newLn;
  const isCtx = row.left?.type === 'context';

  const leftBg = isCtx ? '' : row.left ? 'dv-removed' : 'dv-empty';
  const rightBg = isCtx ? '' : row.right ? 'dv-added' : 'dv-empty';

  const rowComments = fileComments.filter((c) => c.side === 'right' && c.lineNo === rightLn);

  const isAddingR = addingComment?.filePath === selectedFile && addingComment?.side === 'right' && rightLn != null && addingComment?.lineNo === rightLn;

  return (
    <div className="dv-row-group">
      <div className="dv-row">
        {/* LEFT side — no overflow:hidden so buttons aren't clipped */}
        <div className={`dv-side dv-side--left ${leftBg}`}>
          <span className="dv-ln">{row.left ? leftLn : ''}</span>
          <span className="dv-glyph">{row.left && !isCtx ? '-' : ' '}</span>
          <code className="dv-code">{row.left?.content ?? ''}</code>
        </div>
        {/* RIGHT side */}
        <div className={`dv-side dv-side--right ${rightBg}`}>
          <span className="dv-ln">{row.right ? rightLn : ''}</span>
          <span className="dv-glyph">{row.right && !isCtx ? '+' : ' '}</span>
          <code className="dv-code">{row.right?.content ?? ''}</code>
        </div>
      </div>

      {/* Comment button: only on right side (new changes) */}
      {row.right && (
        <button
          className="dv-add-btn dv-add-btn--right"
          onClick={() => setAddingComment({ filePath: selectedFile, side: 'right', lineNo: rightLn })}
          title="Add comment"
        ><Plus size={9} /></button>
      )}

      {/* Inline comment form */}
      {isAddingR && (
        <div className="dv-comment-zone dv-comment-zone--right">
          <CommentForm
            onSave={(text) => addComment(selectedFile, 'right', rightLn, text)}
            onCancel={() => setAddingComment(null)}
          />
        </div>
      )}

      {/* Existing comments */}
      {rowComments.map((c) => (
        <div key={c.id} className="dv-comment-zone dv-comment-zone--right">
          <div className="dv-comment-bubble">
            <MessageSquare size={11} className="dv-comment-icon" />
            <span className="dv-comment-text">{c.text}</span>
            <button className="dv-comment-remove" onClick={() => removeComment(c.id)} title="Remove"><X size={11} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main DiffViewer ──────────────────────────────────────── */

export default function DiffViewer({ repoPath, branch, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [comments, setComments] = useState([]);
  const [addingComment, setAddingComment] = useState(null);
  const [toast, setToast] = useState(false);

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

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const file = files.find((f) => f.path === selectedFile) || null;
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const fileComments = comments.filter((c) => c.filePath === selectedFile);

  const addComment = useCallback((filePath, side, lineNo, text) => {
    if (!text.trim()) return;
    setComments((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, filePath, side, lineNo, text }]);
    setAddingComment(null);
  }, []);

  const removeComment = useCallback((id) => setComments((prev) => prev.filter((c) => c.id !== id)), []);

  const copyComments = () => {
    if (!comments.length) return;
    const parts = comments.map((c) => {
      const f = files.find((f) => f.path === c.filePath);
      const contextLines = [];
      if (f) {
        const allRows = f.hunks.flatMap((h) => h.rows);
        const idx = allRows.findIndex((r) => r.right?.newLn === c.lineNo);
        if (idx >= 0) {
          const start = Math.max(0, idx - 4);
          const end = Math.min(allRows.length - 1, idx + 4);
          for (let i = start; i <= end; i++) {
            const cell = allRows[i].right;
            const ln = cell?.newLn ?? '';
            const marker = i === idx ? '>>>' : '   ';
            const lnStr = String(ln).padStart(4, ' ');
            contextLines.push(`${marker} ${lnStr}  ${cell?.content ?? ''}`);
          }
        }
      }
      return [
        `File: ${c.filePath}`,
        `Line ${c.lineNo} (new version):`,
        '```',
        contextLines.join('\n'),
        '```',
        `Review comment: ${c.text}`,
      ].join('\n');
    });
    const header = `# Code Review Comments\n# Branch diff — ${comments.length} comment${comments.length > 1 ? 's' : ''}\n`;
    navigator.clipboard.writeText(header + '\n' + parts.join('\n\n---\n\n'));
    setToast(true);
    setTimeout(() => setToast(false), 2500);
  };

  return createPortal(
    <div className="dv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dv-wrap">

        {/* Header */}
        <div className="dv-header">
          <span className="dv-title">{branch}</span>
          <div className="dv-totals">
            <span className="stat-add">+{totalAdd}</span>
            <span className="stat-del">-{totalDel}</span>
            <span className="dv-file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
          </div>
          <button className="btn-icon dv-close-btn" onClick={onClose} title="Minimize (Esc)"><Minimize2 size={16} /></button>
        </div>

        {/* Body */}
        <div className="dv-body">

          {/* File list sidebar */}
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

          {/* Diff area */}
          <div className="dv-area">
            {loading && <div className="dv-state">Loading diff…</div>}
            {error && <div className="dv-state dv-state--error">Error: {error}</div>}
            {!loading && !error && files.length === 0 && <div className="dv-state">No uncommitted changes</div>}

            {file && (
              <>
                <div className="dv-file-header">
                  <span>{file.path}</span>
                  <span className="dv-file-header-stats">
                    <span className="stat-add">+{file.additions}</span>
                    <span className="stat-del">-{file.deletions}</span>
                  </span>
                </div>

                {file.isBinary && <div className="dv-state">Binary file — no preview</div>}

                {!file.isBinary && file.hunks.map((hunk, hi) => (
                  <div key={hi} className="dv-hunk">
                    <div className="dv-hunk-header">
                      @@ -{hunk.oldStart} +{hunk.newStart} @@
                      {hunk.context && <span className="dv-hunk-ctx"> {hunk.context}</span>}
                    </div>
                    {hunk.rows.map((row, ri) => (
                      <DiffRow
                        key={ri}
                        row={row}
                        fileComments={fileComments}
                        selectedFile={selectedFile}
                        addingComment={addingComment}
                        setAddingComment={setAddingComment}
                        addComment={addComment}
                        removeComment={removeComment}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="dv-footer">
          <button
            className={`dv-footer-btn ${comments.length ? 'dv-footer-btn--active' : ''}`}
            onClick={copyComments}
            disabled={!comments.length}
            title="Copy all comments with code context"
          >
            <Copy size={13} />
            Copy comments
            {comments.length > 0 && <span className="dv-count-badge">{comments.length}</span>}
          </button>
          {comments.length > 0 && (
            <button className="dv-footer-btn dv-footer-btn--danger" onClick={() => setComments([])}>
              <Trash2 size={13} />
              Clear all
            </button>
          )}
        </div>

        {toast && (
          <div className="dv-toast">
            <Copy size={13} />
            Comments copied to clipboard
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
