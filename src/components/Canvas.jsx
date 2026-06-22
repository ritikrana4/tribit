'use strict';
import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react';
import { Minus, Plus, Maximize } from 'lucide-react';
import WorktreeNode from './WorktreeNode.jsx';

const DOT_GAP = 22;

function findNodeEl(target, container) {
  let cur = target;
  while (cur && cur !== container) {
    if (cur.dataset?.nodeId) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function hasDragBlock(target, nodeEl) {
  let cur = target;
  while (cur && cur !== nodeEl) {
    if (cur.classList?.contains('nodrag')) return true;
    cur = cur.parentElement;
  }
  return false;
}

const Canvas = forwardRef(function Canvas({ nodes, setNodes, onNodeDragStop, theme, onAdd }, ref) {
  const containerRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const nodesRef = useRef(nodes);
  const dragRef = useRef(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const syncPan = useCallback((p) => { panRef.current = p; setPan(p); }, []);
  const syncZoom = useCallback((z) => { zoomRef.current = z; setZoom(z); }, []);

  const fitView = useCallback(({ nodes: targetNodes, padding = 0.25 } = {}) => {
    const container = containerRef.current;
    if (!container) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    const allEls = Array.from(container.querySelectorAll('[data-node-id]'));

    let elements;
    if (targetNodes?.length) {
      const ids = new Set(targetNodes.map((n) => n.id));
      elements = allEls.filter((el) => ids.has(el.dataset.nodeId));
    } else {
      elements = allEls;
    }
    if (!elements.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      minX = Math.min(minX, el.offsetLeft);
      minY = Math.min(minY, el.offsetTop);
      maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    });

    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (!bboxW || !bboxH) return;

    const newZoom = Math.min(
      1.5,
      W / (bboxW * (1 + 2 * padding)),
      H / (bboxH * (1 + 2 * padding)),
    );
    syncPan({
      x: (W - bboxW * newZoom) / 2 - minX * newZoom,
      y: (H - bboxH * newZoom) / 2 - minY * newZoom,
    });
    syncZoom(newZoom);
  }, [syncPan, syncZoom]);

  useImperativeHandle(ref, () => ({
    fitView,
    getNodes: () => nodesRef.current,
  }), [fitView]);

  // Initial fit after nodes first appear
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && nodes.length > 0) {
      fittedRef.current = true;
      setTimeout(() => fitView({ padding: 0.25 }), 60);
    }
  }, [nodes, fitView]);

  // Wheel zoom toward cursor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      const factor = Math.pow(0.999, delta);
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.1, Math.min(3, oldZoom * factor));
      const ratio = newZoom / oldZoom;
      const oldPan = panRef.current;
      syncPan({ x: mx - (mx - oldPan.x) * ratio, y: my - (my - oldPan.y) * ratio });
      syncZoom(newZoom);
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [syncPan, syncZoom]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    const nodeEl = findNodeEl(e.target, container);

    if (nodeEl) {
      if (hasDragBlock(e.target, nodeEl)) return;
      const nodeId = nodeEl.dataset.nodeId;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      dragRef.current = {
        type: 'node', nodeId,
        startX: e.clientX, startY: e.clientY,
        startPosX: node.position.x, startPosY: node.position.y,
      };
      setDragging(true);
      e.preventDefault();
    } else {
      dragRef.current = {
        type: 'pan',
        startX: e.clientX, startY: e.clientY,
        startPanX: panRef.current.x, startPanY: panRef.current.y,
      };
      setDragging(true);
      e.preventDefault();
    }
  }, []);

  const onMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.type === 'pan') {
      syncPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    } else {
      const dxW = dx / zoomRef.current;
      const dyW = dy / zoomRef.current;
      setNodes((prev) => prev.map((n) =>
        n.id === drag.nodeId
          ? { ...n, position: { x: drag.startPosX + dxW, y: drag.startPosY + dyW } }
          : n
      ));
    }
  }, [syncPan, setNodes]);

  const onMouseUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.type === 'node' && onNodeDragStop) {
      const node = nodesRef.current.find((n) => n.id === drag.nodeId);
      if (node) onNodeDragStop(e, node);
    }
  }, [onNodeDragStop]);

  const dotColor = theme === 'light' ? '#d4d4d8' : '#1e1e1e';
  const gridSize = DOT_GAP * zoom;
  const bgX = ((pan.x % gridSize) + gridSize) % gridSize;
  const bgY = ((pan.y % gridSize) + gridSize) % gridSize;

  return (
    <div
      ref={containerRef}
      className="canvas-wrap"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: dragging ? (dragRef.current?.type === 'pan' ? 'grabbing' : 'default') : 'grab',
        userSelect: dragging ? 'none' : '',
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
        }}
      >
        {nodes.map((node) => (
          <div
            key={node.id}
            data-node-id={node.id}
            style={{ position: 'absolute', left: node.position.x, top: node.position.y }}
          >
            <WorktreeNode data={node.data} />
          </div>
        ))}
      </div>

      <div className="canvas-controls">
        <button
          className="canvas-ctrl-btn"
          title="Zoom in"
          onClick={() => { const z = Math.min(3, zoomRef.current * 1.25); syncZoom(z); }}
        ><Plus size={13} /></button>
        <button
          className="canvas-ctrl-btn"
          title="Zoom out"
          onClick={() => { const z = Math.max(0.1, zoomRef.current / 1.25); syncZoom(z); }}
        ><Minus size={13} /></button>
        <button
          className="canvas-ctrl-btn"
          title="Fit view"
          onClick={() => fitView({ padding: 0.25 })}
        ><Maximize size={13} /></button>
      </div>

      {onAdd && (
        <div className="canvas-panel-bottom">
          <button className="btn-add-float" onClick={onAdd}>
            <Plus size={14} /> New Worktree
          </button>
        </div>
      )}
    </div>
  );
});

export default Canvas;
