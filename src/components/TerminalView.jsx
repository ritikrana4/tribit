import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalView({ sessionId, isVisible }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const mountedRef = useRef(true);

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
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#7c5cfc',
        selectionBackground: 'rgba(124,92,252,0.3)',
        black: '#1a1a1a', red: '#f87171', green: '#22c55e', yellow: '#f59e0b',
        blue: '#7c5cfc', magenta: '#c084fc', cyan: '#22d3ee', white: '#e6e6e6',
      },
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
