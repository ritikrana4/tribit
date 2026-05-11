import { useEffect, useRef, useCallback, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TERM_DARK = {
  background: '#0a0a0a', foreground: '#e0e0e0',
  cursor: '#7c5cfc', cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(124,92,252,0.3)',
  black: '#1a1a1a', brightBlack: '#555555',
  red: '#f87171', brightRed: '#fca5a5',
  green: '#22c55e', brightGreen: '#4ade80',
  yellow: '#f59e0b', brightYellow: '#fcd34d',
  blue: '#7c5cfc', brightBlue: '#a78bfa',
  magenta: '#c084fc', brightMagenta: '#d8b4fe',
  cyan: '#22d3ee', brightCyan: '#67e8f9',
  white: '#e6e6e6', brightWhite: '#ffffff',
};

const TERM_LIGHT = {
  background: '#f0f0f7', foreground: '#1c1c2e',
  cursor: '#7c5cfc', cursorAccent: '#ffffff',
  selectionBackground: 'rgba(124,92,252,0.2)',
  black: '#000000', brightBlack: '#686868',
  red: '#cd3131', brightRed: '#f14c4c',
  green: '#00bc00', brightGreen: '#23d18b',
  yellow: '#949800', brightYellow: '#b5ba00',
  blue: '#0451a5', brightBlue: '#2472c8',
  magenta: '#bc05bc', brightMagenta: '#bc8eea',
  cyan: '#0598bc', brightCyan: '#29b8db',
  white: '#555555', brightWhite: '#aeafad',
};

/* ── Single terminal instance (one per tab, hidden when inactive) ── */

function TerminalInstance({ sessionId, isVisible, onStatusChange, theme = 'dark' }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  const onStatusRef = useRef(onStatusChange);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => { onStatusRef.current = onStatusChange; }, [onStatusChange]);

  const connect = useCallback(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname;
    const wsPort = import.meta.env.DEV ? '7700' : window.location.port;
    const wsUrl = `${protocol}//${wsHost}:${wsPort}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      onStatusRef.current(sessionId, 'connected');
      const term = xtermRef.current;
      const fit = fitRef.current;
      if (term && fit) {
        fit.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
      setTimeout(() => term?.focus(), 50);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'scrollback' || msg.type === 'output') {
          xtermRef.current?.write(msg.data);
        } else if (msg.type === 'exit') {
          if (mountedRef.current) onStatusRef.current(sessionId, 'disconnected');
        }
      } catch {}
    };

    ws.onclose = () => {
      if (mountedRef.current) onStatusRef.current(sessionId, 'disconnected');
    };

    ws.onerror = () => {
      if (mountedRef.current) onStatusRef.current(sessionId, 'error');
    };
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    onStatusRef.current(sessionId, 'connecting');

    const term = new Terminal({
      fontFamily: "'Cascadia Code', 'Fira Code', 'SF Mono', monospace",
      fontSize: 13,
      theme: themeRef.current === 'light' ? TERM_LIGHT : TERM_DARK,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    connect();

    const handleResize = () => {
      fit.fit();
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (termRef.current) resizeObserver.observe(termRef.current);

    return () => {
      mountedRef.current = false;
      resizeObserver.disconnect();
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect, sessionId]);

  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = theme === 'light' ? TERM_LIGHT : TERM_DARK;
  }, [theme]);

  // Re-fit + focus when tab becomes visible
  useEffect(() => {
    if (isVisible) {
      setTimeout(() => {
        fitRef.current?.fit();
        xtermRef.current?.focus();
        const ws = wsRef.current;
        const term = xtermRef.current;
        if (ws?.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      }, 50);
    }
  }, [isVisible]);

  return (
    <div
      className="terminal-instance"
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      <div className="terminal-body" ref={termRef} />
    </div>
  );
}

/* ── Tabbed terminal container ──────────────────────────── */

export default memo(function TerminalPanel({ tabs, activeTab, onSelectTab, onCloseTab, onCloseAll, onStatusChange }) {
  // Ctrl+Esc to close panel
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && e.ctrlKey) onCloseAll();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCloseAll]);

  if (tabs.length === 0) return null;

  return (
    <div className="terminal-panel">
      {/* Tab bar */}
      <div className="terminal-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.sessionId}
            className={`terminal-tab ${tab.sessionId === activeTab ? 'terminal-tab--active' : ''}`}
            onClick={() => onSelectTab(tab.sessionId)}
          >
            <span className={`tab-dot tab-dot--${tab.status || 'connecting'}`} />
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.sessionId); }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Terminal instances — all stay mounted, only active is visible */}
      {tabs.map((tab) => (
        <TerminalInstance
          key={tab.sessionId}
          sessionId={tab.sessionId}
          isVisible={tab.sessionId === activeTab}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
});
