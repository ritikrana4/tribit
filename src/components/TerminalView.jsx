import { useEffect, useRef, useCallback } from 'react';
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

export default function TerminalView({ sessionId, isVisible, theme = 'dark' }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const connect = useCallback(() => {
    if (!sessionId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = import.meta.env.DEV ? '7700' : window.location.port;
    const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
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
        }
      } catch {}
    };

    ws.onclose = () => {};
    ws.onerror = () => {};
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
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
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    connect();

    const handleResize = () => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    const ro = new ResizeObserver(handleResize);
    if (termRef.current) ro.observe(termRef.current);

    return () => {
      mountedRef.current = false;
      ro.disconnect();
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect, sessionId]);

  // Live theme update without re-mounting the terminal
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = theme === 'light' ? TERM_LIGHT : TERM_DARK;
  }, [theme]);

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
      }, 60);
    }
  }, [isVisible]);

  return (
    <div className="terminal-instance" style={{ display: isVisible ? 'flex' : 'none' }}>
      <div className="terminal-body" ref={termRef} />
    </div>
  );
}
