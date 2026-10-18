// Canvas lines/arrows (spec §3.2 "Line / arrow"): straight or curved, arrow
// heads at either end, colour, dashed, label. Endpoints are measured from the
// rendered cards so lines stay attached while cards move or resize.

import { useLayoutEffect, useState } from 'react';
import { setUI } from '../model/store';
import { useDoc, useUI } from '../hooks';
import type { DragState } from './Canvas';

type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

interface Geo {
  id: string;
  d: string;
  a: Pt;
  b: Pt;
  ta: Pt; // tangent direction into A
  tb: Pt; // tangent direction into B
  mid: Pt;
}

function borderPoint(r: Rect, toward: Pt): { p: Pt; n: Pt } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { p: { x: cx, y: cy }, n: { x: 1, y: 0 } };
  const sx = r.w / 2 / Math.abs(dx || 1e-9);
  const sy = r.h / 2 / Math.abs(dy || 1e-9);
  if (sx < sy) return { p: { x: cx + dx * sx, y: cy + dy * sx }, n: { x: Math.sign(dx), y: 0 } };
  return { p: { x: cx + dx * sy, y: cy + dy * sy }, n: { x: 0, y: Math.sign(dy) } };
}

export function connectorGeometry(id: string, ra: Rect, rb: Rect, curved: boolean): Geo {
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
  const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
  const A = borderPoint(ra, cb);
  const B = borderPoint(rb, ca);
  const pad = 4;
  const a = { x: A.p.x + A.n.x * pad, y: A.p.y + A.n.y * pad };
  const b = { x: B.p.x + B.n.x * pad, y: B.p.y + B.n.y * pad };
  if (!curved) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { id, d: `M${a.x},${a.y} L${b.x},${b.y}`, a, b, ta: { x: -u.x, y: -u.y }, tb: u, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const k = Math.min(160, dist / 2.5);
  const c1 = { x: a.x + A.n.x * k, y: a.y + A.n.y * k };
  const c2 = { x: b.x + B.n.x * k, y: b.y + B.n.y * k };
  const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
  const mid = { x: bez(0.5, a.x, c1.x, c2.x, b.x), y: bez(0.5, a.y, c1.y, c2.y, b.y) };
  const norm = (v: Pt) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  return {
    id,
    d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
    a,
    b,
    ta: norm({ x: a.x - c1.x, y: a.y - c1.y }),
    tb: norm({ x: b.x - c2.x, y: b.y - c2.y }),
    mid,
  };
}

function arrow(p: Pt, dir: Pt, size = 10) {
  const px = -dir.y;
  const py = dir.x;
  const bx = p.x - dir.x * size;
  const by = p.y - dir.y * size;
  return `M${p.x},${p.y} L${bx + px * size * 0.5},${by + py * size * 0.5} L${bx - px * size * 0.5},${by - py * size * 0.5} Z`;
}

export function ConnectorLayer({
  boardId,
  drag,
  connecting,
  measure,
}: {
  boardId: string;
  drag: DragState | null;
  connecting: { from: string; x: number; y: number } | null;
  measure: (pid: string) => Rect | null;
}) {
  const doc = useDoc();
  const ui = useUI();
  const connectors = Object.values(doc.connectors).filter((c) => c.boardId === boardId);
  const [geos, setGeos] = useState<Geo[]>([]);
  const [temp, setTemp] = useState<string | null>(null);

  useLayoutEffect(() => {
    const out: Geo[] = [];
    for (const c of connectors) {
      const a = doc.placements[c.from];
      const b = doc.placements[c.to];
      if (!a || !b || a.deletedAt || b.deletedAt || a.tray || b.tray) continue;
      const ra = measure(c.from);
      const rb = measure(c.to);
      if (!ra || !rb) continue;
      out.push(connectorGeometry(c.id, ra, rb, c.style.curved));
    }
    const key = JSON.stringify(out.map((g) => g.d));
    setGeos((prev) => (JSON.stringify(prev.map((g) => g.d)) === key ? prev : out));
    if (connecting) {
      const ra = measure(connecting.from);
      if (ra) {
        const g = connectorGeometry('tmp', ra, { x: connecting.x, y: connecting.y, w: 0, h: 0 }, true);
        setTemp(g.d);
      }
    } else setTemp(null);
  });

  return (
    <svg className="connectors" width="1" height="1" aria-hidden={!connectors.length}>
      {geos.map((g) => {
        const c = doc.connectors[g.id];
        if (!c) return null;
        const sel = ui.selectedConnector === c.id;
        const color = sel ? 'var(--accent)' : c.style.color;
        return (
          <g key={c.id} className={'connector' + (sel ? ' selected' : '') + (drag ? ' dragging' : '')}>
            <path
              className="connector-hit"
              d={g.d}
              onPointerDown={(e) => {
                e.stopPropagation();
                setUI({ selectedConnector: c.id, selection: [] });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setUI({ selectedConnector: c.id, selection: [] });
                requestAnimationFrame(() => (document.querySelector('.connector-label-input') as HTMLInputElement | null)?.focus());
              }}
            />
            <path d={g.d} fill="none" stroke={color} strokeWidth={sel ? 3 : 2} strokeDasharray={c.style.dashed ? '7 6' : undefined} />
            {c.style.arrowEnd && <path d={arrow(g.b, g.tb)} fill={color} />}
            {c.style.arrowStart && <path d={arrow(g.a, g.ta)} fill={color} />}
            {c.label && (
              <g transform={`translate(${g.mid.x}, ${g.mid.y})`}>
                <rect x={-(c.label.length * 3.6 + 8)} y={-11} width={c.label.length * 7.2 + 16} height={22} rx={11} className="connector-label-bg" />
                <text textAnchor="middle" dy="4" className="connector-label">{c.label}</text>
              </g>
            )}
          </g>
        );
      })}
      {temp && <path d={temp} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 5" />}
    </svg>
  );
}
