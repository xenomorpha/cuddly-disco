import type { RefObject } from 'react';
import type { Viewport } from '../model/store';
import { getIndex } from '../model/index';
import { useDoc } from '../hooks';
import { TYPE_COLORS } from './icons';

const W = 200;
const H = 130;

export function Minimap({
  boardId,
  vp,
  host,
  setVp,
  measure,
}: {
  boardId: string;
  vp: Viewport;
  host: RefObject<HTMLDivElement>;
  setVp: (v: Viewport) => void;
  measure: (pid: string) => { x: number; y: number; w: number; h: number } | null;
}) {
  const doc = useDoc();
  const ps = (getIndex(doc).placementsByBoard.get(boardId) ?? []).filter((p) => !p.columnId && !p.tray);
  const hostRect = host.current?.getBoundingClientRect();
  const view = hostRect
    ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: hostRect.width / vp.zoom, h: hostRect.height / vp.zoom }
    : { x: 0, y: 0, w: 1000, h: 700 };
  const rects = ps.map((p) => ({ p, r: measure(p.id) ?? { x: p.x, y: p.y, w: p.w, h: p.h ?? 100 } }));
  const all = [...rects.map((x) => x.r), view];
  const minX = Math.min(...all.map((r) => r.x)) - 50;
  const minY = Math.min(...all.map((r) => r.y)) - 50;
  const maxX = Math.max(...all.map((r) => r.x + r.w)) + 50;
  const maxY = Math.max(...all.map((r) => r.y + r.h)) + 50;
  const s = Math.min(W / (maxX - minX), H / (maxY - minY));

  const jump = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - r.left) / s + minX;
    const wy = (e.clientY - r.top) / s + minY;
    if (!hostRect) return;
    setVp({ ...vp, x: hostRect.width / 2 - wx * vp.zoom, y: hostRect.height / 2 - wy * vp.zoom });
  };

  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()}>
      <svg
        width={W}
        height={H}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => e.buttons && jump(e)}
        role="img"
        aria-label="Minimap"
      >
        {rects.map(({ p, r }) => (
          <rect
            key={p.id}
            x={(r.x - minX) * s}
            y={(r.y - minY) * s}
            width={Math.max(2, r.w * s)}
            height={Math.max(2, r.h * s)}
            fill={doc.cards[p.cardId]?.color || TYPE_COLORS[doc.cards[p.cardId]?.type ?? 'note']}
            opacity={0.8}
            rx={1}
          />
        ))}
        <rect
          x={(view.x - minX) * s}
          y={(view.y - minY) * s}
          width={view.w * s}
          height={view.h * s}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
