import { useEffect, useRef, useState } from 'react';
import type { BodyProps } from '../CardView';
import type { Stroke } from '../../model/types';
import { updateCard } from '../../model/actions';
import { Icon } from '../icons';
import { t } from '../../i18n';

const COLORS = ['#2d3436', '#d63031', '#0984e3', '#00b894', '#6c5ce7', '#fdcb6e', '#ffffff'];

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const s of strokes) {
    const pts = s.points;
    if (pts.length < 3) continue;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = 'multiply';
    }
    if (pts.length === 3) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // variable width by pressure: draw segment by segment
    for (let i = 3; i < pts.length; i += 3) {
      const p = s.tool === 'highlighter' ? 0.5 : (pts[i + 2] + pts[i - 1]) / 2;
      ctx.lineWidth = s.tool === 'highlighter' ? s.width : Math.max(0.5, s.width * (0.4 + p * 1.2));
      ctx.beginPath();
      if (i >= 6) {
        const mx0 = (pts[i - 6] + pts[i - 3]) / 2;
        const my0 = (pts[i - 5] + pts[i - 2]) / 2;
        const mx1 = (pts[i - 3] + pts[i]) / 2;
        const my1 = (pts[i - 2] + pts[i + 1]) / 2;
        ctx.moveTo(mx0, my0);
        ctx.quadraticCurveTo(pts[i - 3], pts[i - 2], mx1, my1);
      } else {
        ctx.moveTo(pts[i - 3], pts[i - 2]);
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function SketchCard({ card, placement, editing, readOnly }: BodyProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [color, setColor] = useState('#2d3436');
  const [width, setWidth] = useState(3);
  const live = useRef<Stroke | null>(null);
  const strokes = card.data.strokes ?? [];
  const w = placement.w;
  const h = (placement.h ?? 220) - (editing ? 40 : 0) - (card.title ? 22 : 0);

  const redraw = () => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * 2; // crisp when zoomed in
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawStrokes(ctx, live.current ? [...strokes, live.current] : strokes);
  };
  useEffect(redraw);

  const pos = (e: React.PointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * w) / r.width, ((e.clientY - r.top) * h) / r.height, e.pressure || 0.5] as const;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!editing || readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'eraser') {
      const erase = (ev: PointerEvent | React.PointerEvent) => {
        const [x, y] = pos(ev);
        const hit = strokes.findIndex((s) => {
          for (let i = 0; i < s.points.length; i += 3) if (Math.hypot(s.points[i] - x, s.points[i + 1] - y) < 10) return true;
          return false;
        });
        if (hit >= 0) updateCard(card.id, (c) => { c.data.strokes?.splice(hit, 1); }, 'sketch:' + card.id);
      };
      erase(e);
      const move = (ev: PointerEvent) => erase(ev);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const [x, y, p] = pos(e);
    live.current = { tool, color, width: tool === 'highlighter' ? width * 4 : width, points: [x, y, p] };
    redraw();
    const move = (ev: PointerEvent) => {
      const events = (ev as any).getCoalescedEvents?.() ?? [ev];
      for (const ce of events) {
        const [a, b, pr] = pos(ce);
        live.current!.points.push(Math.round(a * 10) / 10, Math.round(b * 10) / 10, Math.round(pr * 100) / 100);
      }
      redraw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const s = live.current;
      live.current = null;
      if (s) updateCard(card.id, (c) => { (c.data.strokes ??= []).push(s); }, 'stroke');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="card-body sketch-body">
      {card.title && <div className="card-title">{card.title}</div>}
      {editing && !readOnly && (
        <div className="sketch-tools interactive" onPointerDown={(e) => e.stopPropagation()}>
          <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title={t('Pen')}><Icon name="pen" size={14} /></button>
          <button className={tool === 'highlighter' ? 'on' : ''} onClick={() => setTool('highlighter')} title={t('Highlighter')}><Icon name="highlighter" size={14} /></button>
          <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} title={t('Eraser')}><Icon name="eraser" size={14} /></button>
          {COLORS.map((c) => (
            <button key={c} className={'sw' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} aria-label={c} />
          ))}
          <input type="range" min={1} max={12} value={width} onChange={(e) => setWidth(+e.target.value)} aria-label={t('Stroke width')} />
          <button onClick={() => updateCard(card.id, (c) => { c.data.strokes?.pop(); })} title={t('Undo stroke')}><Icon name="undo" size={14} /></button>
          <button onClick={() => updateCard(card.id, (c) => { c.data.strokes = []; })} title={t('Clear')}>✕</button>
        </div>
      )}
      <canvas
        ref={ref}
        className={'sketch-canvas' + (editing ? ' drawing ' + tool : '')}
        style={{ width: '100%', height: h, touchAction: editing ? 'none' : undefined }}
        onPointerDown={onDown}
      />
      {!editing && !strokes.length && <div className="placeholder overlay">{readOnly ? '' : t('Double-click to draw')}</div>}
    </div>
  );
}
