import { useEffect, useRef, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';

const COLORS = { pen: '#ff3b30', circle: '#ff9500' };
const ERASE_RADIUS = 0.02;

function encode(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decode(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

function hitTest(strokes, x, y) {
  for (const [id, stroke] of strokes) {
    if (stroke.tool === 'pen') {
      if (stroke.points.some((p) => Math.hypot(p.x - x, p.y - y) < ERASE_RADIUS)) return id;
    } else if (stroke.tool === 'circle') {
      const cx = (stroke.x1 + stroke.x2) / 2;
      const cy = (stroke.y1 + stroke.y2) / 2;
      const rx = Math.abs(stroke.x2 - stroke.x1) / 2 || 0.001;
      const ry = Math.abs(stroke.y2 - stroke.y1) / 2 || 0.001;
      const dist = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (Math.abs(dist - 1) < 0.15) return id;
    }
  }
  return null;
}

export default function DrawingOverlay() {
  const canvasRef = useRef(null);
  const strokesRef = useRef(new Map());
  const drawingRef = useRef(null);
  const [tool, setTool] = useState('pen');

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current.values()) {
      if (stroke.tool === 'pen' && stroke.points.length > 0) {
        ctx.strokeStyle = COLORS.pen;
        ctx.beginPath();
        stroke.points.forEach((p, i) => {
          const x = p.x * canvas.width;
          const y = p.y * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      } else if (stroke.tool === 'circle') {
        const x1 = stroke.x1 * canvas.width;
        const y1 = stroke.y1 * canvas.height;
        const x2 = stroke.x2 * canvas.width;
        const y2 = stroke.y2 * canvas.height;
        ctx.strokeStyle = COLORS.circle;
        ctx.beginPath();
        ctx.ellipse(
          (x1 + x2) / 2,
          (y1 + y2) / 2,
          Math.max(Math.abs(x2 - x1) / 2, 1),
          Math.max(Math.abs(y2 - y1) / 2, 1),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    }
  };

  const applyMessage = (data) => {
    const strokes = strokesRef.current;
    if (data.type === 'pen-start') {
      strokes.set(data.id, { tool: 'pen', points: [{ x: data.x, y: data.y }] });
    } else if (data.type === 'pen-move') {
      strokes.get(data.id)?.points.push({ x: data.x, y: data.y });
    } else if (data.type === 'circle') {
      strokes.set(data.id, { tool: 'circle', x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2 });
    } else if (data.type === 'erase') {
      strokes.delete(data.id);
    } else if (data.type === 'clear') {
      strokes.clear();
    } else {
      return;
    }
    redraw();
  };

  const { send } = useDataChannel('draw', (msg) => applyMessage(decode(msg.payload)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const eraseAt = (x, y) => {
    const id = hitTest(strokesRef.current, x, y);
    if (!id) return;
    strokesRef.current.delete(id);
    redraw();
    send(encode({ type: 'erase', id }), { reliable: true });
  };

  const handlePointerDown = (e) => {
    e.target.setPointerCapture(e.pointerId);
    const { x, y } = pointFromEvent(e);

    if (tool === 'eraser') {
      drawingRef.current = { tool: 'eraser' };
      eraseAt(x, y);
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (tool === 'pen') {
      strokesRef.current.set(id, { tool: 'pen', points: [{ x, y }] });
      drawingRef.current = { tool: 'pen', id };
      send(encode({ type: 'pen-start', id, x, y }), { reliable: true });
    } else {
      drawingRef.current = { tool: 'circle', id, x1: x, y1: y };
      strokesRef.current.set(id, { tool: 'circle', x1: x, y1: y, x2: x, y2: y });
    }
    redraw();
  };

  const handlePointerMove = (e) => {
    if (!drawingRef.current) return;
    const { x, y } = pointFromEvent(e);

    if (drawingRef.current.tool === 'eraser') {
      eraseAt(x, y);
    } else if (drawingRef.current.tool === 'pen') {
      const { id } = drawingRef.current;
      strokesRef.current.get(id)?.points.push({ x, y });
      send(encode({ type: 'pen-move', id, x, y }), { reliable: false });
      redraw();
    } else if (drawingRef.current.tool === 'circle') {
      const { id, x1, y1 } = drawingRef.current;
      strokesRef.current.set(id, { tool: 'circle', x1, y1, x2: x, y2: y });
      redraw();
    }
  };

  const handlePointerUp = () => {
    if (drawingRef.current?.tool === 'circle') {
      const stroke = strokesRef.current.get(drawingRef.current.id);
      if (stroke) {
        send(encode({ type: 'circle', id: drawingRef.current.id, ...stroke }), { reliable: true });
      }
    }
    drawingRef.current = null;
  };

  const clearAll = () => {
    strokesRef.current.clear();
    redraw();
    send(encode({ type: 'clear' }), { reliable: true });
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'flex',
          gap: '0.5rem',
          background: 'rgba(0,0,0,0.55)',
          padding: '0.4rem',
          borderRadius: 8,
        }}
      >
        <button type="button" onClick={() => setTool('pen')} style={{ fontWeight: tool === 'pen' ? 'bold' : 'normal' }}>
          ✏️ ペン
        </button>
        <button type="button" onClick={() => setTool('circle')} style={{ fontWeight: tool === 'circle' ? 'bold' : 'normal' }}>
          ⭕ 丸で囲む
        </button>
        <button type="button" onClick={() => setTool('eraser')} style={{ fontWeight: tool === 'eraser' ? 'bold' : 'normal' }}>
          🧹 消しゴム
        </button>
        <button type="button" onClick={clearAll}>
          全部消す
        </button>
      </div>
    </div>
  );
}
