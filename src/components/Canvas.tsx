// Infinite canvas (spec §3.1): pan, zoom 10–400%, marquee and shift-click
// selection, group move with snap and alignment guides, drop into columns /
// onto board cards / onto the trash, connectors that follow their cards,
// minimap, presence cursors, drag-and-drop of files and toolbar items.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardType, Placement } from '../model/types';
import { dragClock, getDoc, getUI, sendPresence, setUI, useStore, type Viewport } from '../model/store';
import { getIndex } from '../model/index';
import {
  addConnector, addToColumn, bringToFront, canEditBoard, createCard, moveToBoard, movePlacements,
  placeFromTray, removeFromColumn, setPlacement, setViewport, trashPlacements,
} from '../model/actions';
import { useDoc, useUI } from '../hooks';
import { CardFrame } from './CardView';
import { ConnectorLayer } from './Connectors';
import { Minimap } from './Minimap';
import { SelectionToolbar } from './SelectionToolbar';
import { openContextMenu } from './ContextMenu';
import { handleDroppedData } from './dropImport';
import { UnsortedTray } from './UnsortedTray';
import { Icon } from './icons';
import { t } from '../i18n';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const DEFAULT_VP: Viewport = { x: 120, y: 90, zoom: 1 };

export interface DragState {
  ids: string[];
  dx: number;
  dy: number;
  /** a card dragged out of a column floats at this world position */
  floating?: { id: string; x: number; y: number; w: number };
  guides: { x?: number; y?: number }[];
  hoverTarget: string | null; // drop target description for highlighting
}

interface CanvasCtx {
  vp: Viewport;
  drag: DragState | null;
  editing: string | null;
  setEditing: (id: string | null) => void;
  startCardDrag: (e: React.PointerEvent, p: Placement) => void;
  startResize: (e: React.PointerEvent, p: Placement, mode: 'w' | 'wh') => void;
  startConnect: (e: React.PointerEvent, p: Placement) => void;
  readOnly: boolean;
  toWorld: (cx: number, cy: number) => { x: number; y: number };
}

export const CanvasContext = React.createContext<CanvasCtx>(null as any);

export function Canvas({ boardId }: { boardId: string }) {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const ref = useRef<HTMLDivElement>(null);
  const vp = ui.viewports[boardId] ?? DEFAULT_VP;
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [editing, setEditingState] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const readOnly = !canEditBoard(boardId);
  const peers = useStore((s) => s.peers);

  const setEditing = useCallback((id: string | null) => setEditingState(id), []);
  useEffect(() => setEditingState(null), [boardId]);
  useEffect(() => {
    const onEdit = (e: Event) => setEditingState((e as CustomEvent).detail);
    window.addEventListener('nb:edit', onEdit);
    return () => window.removeEventListener('nb:edit', onEdit);
  }, []);

  const placements = idx.placementsByBoard.get(boardId) ?? [];
  // DOM order stays stable (z-index does the stacking): re-ordering nodes mid-drag would drop pointer capture
  const topLevel = useMemo(() => placements.filter((p) => !p.columnId && !p.tray), [placements]);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }, []);

  const setVp = useCallback((v: Viewport) => setViewport(boardId, v), [boardId]);

  // ------------------------------------------------------------- zoom helpers
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = vpRef.current;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    setVp({ zoom: z, x: px - ((px - v.x) * z) / v.zoom, y: py - ((py - v.y) * z) / v.zoom });
  }, [setVp]);

  const zoomToFit = useCallback((ids?: string[]) => {
    const el = ref.current;
    if (!el) return;
    const ps = (ids?.length ? ids.map((i) => getDoc().placements[i]).filter(Boolean) : topLevel) as Placement[];
    if (!ps.length) return setVp(DEFAULT_VP);
    const rects = ps.map((p) => measure(p.id) ?? { x: p.x, y: p.y, w: p.w, h: p.h ?? 120 });
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const r = el.getBoundingClientRect();
    const pad = 60;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1), ids ? 1.2 : 1)));
    setVp({ zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom });
  }, [topLevel, setVp]);

  // world-space rect of a rendered card
  const measure = (pid: string) => {
    const el = document.querySelector(`[data-placement="${pid}"]`) as HTMLElement | null;
    const host = ref.current;
    if (!el || !host) return null;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (r.left - h.left - v.x) / v.zoom, y: (r.top - h.top - v.y) / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom };
  };

  useEffect(() => {
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: 'in' | 'out' | 'fit' | 'reset' | 'selection' | 'ids'; ids?: string[] };
      if (d.kind === 'ids') zoomToFit(d.ids);
      else if (d.kind === 'in') zoomAt(1.2);
      else if (d.kind === 'out') zoomAt(1 / 1.2);
      else if (d.kind === 'fit') zoomToFit();
      else if (d.kind === 'selection') zoomToFit(getUI().selection);
      else {
        const r = ref.current!.getBoundingClientRect();
        const v = vpRef.current;
        const cx = (r.width / 2 - v.x) / v.zoom;
        const cy = (r.height / 2 - v.y) / v.zoom;
        setVp({ zoom: 1, x: r.width / 2 - cx, y: r.height / 2 - cy });
      }
    };
    window.addEventListener('nb:zoom', onZoom);
    return () => window.removeEventListener('nb:zoom', onZoom);
  }, [zoomAt, zoomToFit, setVp]);

  // first visit to a board: fit its content (never zooming in past 100%)
  useEffect(() => {
    if (getUI().viewports[boardId]) return;
    const h = getUI().highlight;
    if (h && getDoc().placements[h.placementId]?.boardId === boardId) return;
    requestAnimationFrame(() => zoomToFit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // centre and flash a highlighted card (from backlinks / search / graph)
  useEffect(() => {
    const h = ui.highlight;
    if (!h) return;
    const p = doc.placements[h.placementId];
    if (!p || p.boardId !== boardId) return;
    requestAnimationFrame(() => {
      const r = ref.current?.getBoundingClientRect();
      const m = measure(p.id) ?? { x: p.x, y: p.y, w: p.w, h: 100 };
      if (!r) return;
      const zoom = Math.max(vpRef.current.zoom, 0.8);
      setVp({ zoom, x: r.width / 2 - (m.x + m.w / 2) * zoom, y: r.height / 2 - (m.y + m.h / 2) * zoom });
      const el = document.querySelector(`[data-placement="${p.id}"]`);
      el?.classList.remove('flash');
      void (el as HTMLElement | null)?.offsetWidth;
      el?.classList.add('flash');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.highlight, boardId]);

  // space-drag panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ------------------------------------------------------------- wheel / pinch
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.no-wheel, .autocomplete')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY);
      } else {
        const v = vpRef.current;
        setVp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setVp]);

  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; cx: number; cy: number; vp: Viewport } | null>(null);

  // ------------------------------------------------------------- background pointer
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-placement], .selection-toolbar, .minimap, .zoom-controls, .tray, .connector-hit')) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: vpRef.current.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vp: vpRef.current };
        return;
      }
    }
    setEditingState(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const pan = spaceDown || e.button === 1 || e.pointerType === 'touch' || (e.altKey && !e.shiftKey);
    const start = { x: e.clientX, y: e.clientY, vp: vpRef.current };
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    if (pan) {
      el.classList.add('panning');
      const move = (ev: PointerEvent) => {
        if (pinch.current) return;
        setVp({ ...start.vp, x: start.vp.x + ev.clientX - start.x, y: start.vp.y + ev.clientY - start.y });
      };
      const up = () => {
        el.classList.remove('panning');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      return;
    }
    // marquee selection
    const additive = e.shiftKey;
    const base = additive ? getUI().selection : [];
    if (!additive) setUI({ selection: [], selectedConnector: null });
    const host = el.getBoundingClientRect();
    const sx = e.clientX - host.left;
    const sy = e.clientY - host.top;
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - host.left;
      const y1 = ev.clientY - host.top;
      setMarquee({ x0: sx, y0: sy, x1, y1 });
      const v = vpRef.current;
      const wx0 = (Math.min(sx, x1) - v.x) / v.zoom;
      const wy0 = (Math.min(sy, y1) - v.y) / v.zoom;
      const wx1 = (Math.max(sx, x1) - v.x) / v.zoom;
      const wy1 = (Math.max(sy, y1) - v.y) / v.zoom;
      const hit = topLevel
        .filter((p) => {
          const m = measure(p.id) ?? { x: p.x, y: p.y, w: p.w, h: p.h ?? 80 };
          return m.x < wx1 && m.x + m.w > wx0 && m.y < wy1 && m.y + m.h > wy0;
        })
        .map((p) => p.id);
      setUI({ selection: [...new Set([...base, ...hit])] });
    };
    const up = () => {
      setMarquee(null);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pinch.current.zoom * dist) / pinch.current.dist));
        const r = ref.current!.getBoundingClientRect();
        const pv = pinch.current.vp;
        const px = pinch.current.cx - r.left;
        const py = pinch.current.cy - r.top;
        setVp({ zoom: z, x: px - ((px - pv.x) * z) / pv.zoom, y: py - ((py - pv.y) * z) / pv.zoom });
      }
    }
    const w = toWorld(e.clientX, e.clientY);
    sendPresence(w.x, w.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  // ------------------------------------------------------------- card drag
  const startCardDrag = useCallback((e: React.PointerEvent, p: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ui0 = getUI();
    let sel = ui0.selection;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      sel = sel.includes(p.id) ? sel.filter((s) => s !== p.id) : [...sel, p.id];
      setUI({ selection: sel, selectedConnector: null, focusCard: p.cardId });
      return;
    }
    if (!sel.includes(p.id)) {
      sel = [p.id];
      setUI({ selection: sel, selectedConnector: null, focusCard: p.cardId });
    } else setUI({ focusCard: p.cardId });
    if (readOnly || spaceDown) return;
    const doc0 = getDoc();
    const startX = e.clientX;
    const startY = e.clientY;
    const zoom = vpRef.current.zoom;
    const inColumn = !!p.columnId;
    const ids = inColumn ? [p.id] : sel.filter((id) => !doc0.placements[id]?.columnId && !doc0.placements[id]?.locked);
    if (!ids.length) return;
    const startRect = measure(p.id);
    let moved = false;
    let last = { dx: 0, dy: 0 };
    let raf = 0;
    const others = topLevel.filter((q) => !ids.includes(q.id)).map((q) => measure(q.id) ?? { x: q.x, y: q.y, w: q.w, h: 80 });
    const move = (ev: PointerEvent) => {
      let dx = (ev.clientX - startX) / zoom;
      let dy = (ev.clientY - startY) / zoom;
      if (!moved && Math.hypot(dx, dy) * zoom < 4) return;
      if (!moved) {
        moved = true;
        if (!inColumn) bringToFront(ids);
        document.body.classList.add('dragging-card');
      }
      const guides: { x?: number; y?: number }[] = [];
      if (startRect && !inColumn) {
        // alignment guides against other cards (edges and centres)
        const th = 6 / zoom;
        const r = { x: startRect.x + dx, y: startRect.y + dy, w: startRect.w, h: startRect.h };
        const xs = [r.x, r.x + r.w / 2, r.x + r.w];
        const ys = [r.y, r.y + r.h / 2, r.y + r.h];
        let bestX: { d: number; adj: number; at: number } | null = null;
        let bestY: { d: number; adj: number; at: number } | null = null;
        for (const o of others) {
          for (const ox of [o.x, o.x + o.w / 2, o.x + o.w])
            for (const x of xs) {
              const d = Math.abs(ox - x);
              if (d < th && (!bestX || d < bestX.d)) bestX = { d, adj: ox - x, at: ox };
            }
          for (const oy of [o.y, o.y + o.h / 2, o.y + o.h])
            for (const y of ys) {
              const d = Math.abs(oy - y);
              if (d < th && (!bestY || d < bestY.d)) bestY = { d, adj: oy - y, at: oy };
            }
        }
        if (bestX && !getUI().snap) { dx += bestX.adj; guides.push({ x: bestX.at }); }
        if (bestY && !getUI().snap) { dy += bestY.adj; guides.push({ y: bestY.at }); }
        if (getUI().snap) {
          dx = Math.round((startRect.x + dx) / 20) * 20 - startRect.x;
          dy = Math.round((startRect.y + dy) / 20) * 20 - startRect.y;
        }
      }
      last = { dx, dy };
      const hover = dropTargetAt(ev.clientX, ev.clientY, ids, doc0);
      markHover(hover);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = toWorld(ev.clientX, ev.clientY);
        setDrag({
          ids,
          dx,
          dy,
          guides,
          hoverTarget: hover?.key ?? null,
          floating: inColumn && startRect ? { id: p.id, x: w.x - startRect.w / 2, y: w.y - 16, w: startRect.w } : undefined,
        });
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      document.body.classList.remove('dragging-card');
      markHover(null);
      if (!moved) {
        setDrag(null);
        return;
      }
      dragClock.lastEnd = Date.now();
      const dt = dropTargetAt(ev.clientX, ev.clientY, ids, doc0);
      setDrag(null);
      if (dt?.kind === 'trash') trashPlacements(ids);
      else if (dt?.kind === 'board') moveToBoard(ids, dt.id);
      else if (dt?.kind === 'column') addToColumn(ids, dt.id, dt.order);
      else if (inColumn) {
        const w = toWorld(ev.clientX, ev.clientY);
        removeFromColumn(p.id, w.x - (startRect?.w ?? 200) / 2, w.y - 16);
      } else
        movePlacements(ids.map((id) => {
          const q = getDoc().placements[id];
          return { id, x: q.x + last.dx, y: q.y + last.dy };
        }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [readOnly, spaceDown, topLevel, toWorld]);

  // ------------------------------------------------------------- resize
  const startResize = useCallback((e: React.PointerEvent, p: Placement, mode: 'w' | 'wh') => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly || p.locked) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const zoom = vpRef.current.zoom;
    const startW = p.w;
    const startH = p.h ?? measure(p.id)?.h ?? 100;
    const move = (ev: PointerEvent) => {
      const w = Math.max(120, Math.round(startW + (ev.clientX - sx) / zoom));
      const h = Math.max(60, Math.round(startH + (ev.clientY - sy) / zoom));
      setPlacement(p.id, mode === 'wh' ? { w, h } : { w }, 'resize:' + p.id);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [readOnly]);

  // ------------------------------------------------------------- connect
  const startConnect = useCallback((e: React.PointerEvent, p: Placement) => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly) return;
    const move = (ev: PointerEvent) => {
      const w = toWorld(ev.clientX, ev.clientY);
      setConnecting({ from: p.id, x: w.x, y: w.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConnecting(null);
      const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => (x as HTMLElement).dataset?.placement) as HTMLElement | undefined;
      const to = el?.dataset.placement;
      if (to && to !== p.id) addConnector(boardId, p.id, to);
      if (getUI().tool === 'connect') setUI({ tool: 'select' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [boardId, readOnly, toWorld]);

  // ------------------------------------------------------------- drops (toolbar, tray, files)
  const onDragOver = (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const type = e.dataTransfer.getData('application/x-nodeboard-type') as CardType;
    const trayId = e.dataTransfer.getData('application/x-nodeboard-placement');
    const colEl = (e.target as HTMLElement).closest('[data-drop-column]') as HTMLElement | null;
    if (type) {
      if (type === ('line' as any)) {
        setUI({ tool: 'connect' });
        return;
      }
      const { placementId } = createCard(type, { boardId, x: w.x - 20, y: w.y - 20 });
      if (colEl && type !== 'column' && type !== 'board') addToColumn([placementId], colEl.dataset.dropColumn!);
      if (['note', 'todo', 'board', 'column', 'link', 'comment', 'table'].includes(type)) setEditingState(placementId);
      return;
    }
    if (trayId) {
      if (colEl) addToColumn([trayId], colEl.dataset.dropColumn!);
      else placeFromTray(trayId, w.x - 40, w.y - 20);
      return;
    }
    await handleDroppedData(e.dataTransfer, boardId, w.x, w.y);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('[data-placement], .selection-toolbar, .minimap, .zoom-controls, .tray')) return;
    const w = toWorld(e.clientX, e.clientY);
    const { placementId } = createCard('note', { boardId, x: w.x - 20, y: w.y - 20 });
    setEditingState(placementId);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pel = (e.target as HTMLElement).closest('[data-placement]') as HTMLElement | null;
    const w = toWorld(e.clientX, e.clientY);
    if (pel) {
      const pid = pel.dataset.placement!;
      if (!getUI().selection.includes(pid)) setUI({ selection: [pid], focusCard: getDoc().placements[pid]?.cardId ?? null });
      openContextMenu({ x: e.clientX, y: e.clientY, kind: 'card', placementId: pid, world: w, setEditing: setEditingState });
    } else openContextMenu({ x: e.clientX, y: e.clientY, kind: 'canvas', world: w, setEditing: setEditingState });
  };

  // ------------------------------------------------------------- render
  const ctx: CanvasCtx = { vp, drag, editing, setEditing, startCardDrag, startResize, startConnect, readOnly, toWorld };
  const boardPeers = Object.values(peers).filter((p) => p.boardId === boardId && Date.now() - p.at < 20000);

  return (
    <CanvasContext.Provider value={ctx}>
      <div
        ref={ref}
        className={'canvas' + (spaceDown ? ' space' : '') + (ui.tool === 'connect' ? ' connect-mode' : '') + (ui.snap ? ' snap' : '') + (ui.showDots ? '' : ' no-dots')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        role="application"
        aria-label={t('Board canvas')}
        data-board={boardId}
      >
        <div className="world" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` }}>
          <ConnectorLayer boardId={boardId} drag={drag} connecting={connecting} measure={measure} />
          {topLevel.map((p) => (
            <CardFrame key={p.id} placement={p} />
          ))}
          {drag?.floating && (() => {
            const p = doc.placements[drag.floating.id];
            return p ? <CardFrame placement={{ ...p, columnId: null, x: drag.floating.x, y: drag.floating.y, w: drag.floating.w, z: 99999 }} floating /> : null;
          })()}
          {drag?.guides.map((g, i) =>
            g.x !== undefined ? (
              <div key={i} className="guide v" style={{ left: g.x, top: -100000, height: 200000 }} />
            ) : (
              <div key={i} className="guide h" style={{ top: g.y, left: -100000, width: 200000 }} />
            ),
          )}
          {boardPeers.map((p) => (
            <div key={p.tab} className="peer-cursor" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${1 / vp.zoom})`, color: p.color }}>
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1l5 14 2-6 6-2z" fill="currentColor" stroke="#fff" strokeWidth="1" /></svg>
              <span style={{ background: p.color }}>{p.name}</span>
            </div>
          ))}
        </div>
        {marquee && (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {!drag && <SelectionToolbar boardId={boardId} vp={vp} measure={measure} setEditing={setEditingState} />}
        {topLevel.length === 0 && (
          <div className="empty-board">
            <p>{readOnly ? t('This board is empty.') : t('Drag a card from the left toolbar, drop files here, or double-click to add a note.')}</p>
          </div>
        )}
        <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => zoomAt(1 / 1.2)} aria-label={t('Zoom out')} title={t('Zoom out')}>−</button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'reset' } }))} title={t('Reset zoom')} className="zoom-label">
            {Math.round(vp.zoom * 100)}%
          </button>
          <button onClick={() => zoomAt(1.2)} aria-label={t('Zoom in')} title={t('Zoom in')}>+</button>
          <button onClick={() => zoomToFit()} aria-label={t('Zoom to fit')} title={t('Zoom to fit') + ' (Shift+1)'}><Icon name="zoomfit" size={16} /></button>
          <button className={ui.showDots ? 'on' : ''} onClick={() => setUI({ showDots: !ui.showDots })} aria-label={t('Background dots')} aria-pressed={ui.showDots} title={t('Background dots')}><Icon name="dots" size={16} /></button>
          <button className={ui.minimap ? 'on' : ''} onClick={() => setUI({ minimap: !ui.minimap })} aria-label={t('Minimap')} title={t('Minimap')}><Icon name="minimap" size={16} /></button>
        </div>
        {ui.minimap && <Minimap boardId={boardId} vp={vp} host={ref} setVp={setVp} measure={measure} />}
        <UnsortedTray boardId={boardId} />
      </div>
    </CanvasContext.Provider>
  );
}

export function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

type DropTarget =
  | { kind: 'trash'; key: string }
  | { kind: 'board'; id: string; key: string }
  | { kind: 'column'; id: string; order?: number; key: string };

function dropTargetAt(cx: number, cy: number, dragged: string[], doc: ReturnType<typeof getDoc>): DropTarget | null {
  const els = document.elementsFromPoint(cx, cy) as HTMLElement[];
  for (const el of els) {
    if (el.closest('[data-dragging="true"]')) continue;
    if (el.closest('[data-drop-trash]')) return { kind: 'trash', key: 'trash' };
    const sb = el.closest('[data-nav-board]') as HTMLElement | null;
    if (sb && sb.dataset.navBoard !== getUI().boardId) return { kind: 'board', id: sb.dataset.navBoard!, key: 'sb:' + sb.dataset.navBoard };
    const colEl = el.closest('[data-drop-column]') as HTMLElement | null;
    if (colEl && !dragged.includes(colEl.dataset.dropColumn!)) {
      const draggedCards = dragged.map((d) => doc.cards[doc.placements[d]?.cardId]?.type);
      if (draggedCards.includes('column')) return null;
      // insertion order from child positions
      const children = [...colEl.querySelectorAll('.column-body > [data-placement]')] as HTMLElement[];
      let order: number | undefined;
      for (const ch of children) {
        if (dragged.includes(ch.dataset.placement!)) continue;
        const r = ch.getBoundingClientRect();
        if (cy < r.top + r.height / 2) {
          order = doc.placements[ch.dataset.placement!]?.order;
          break;
        }
      }
      return { kind: 'column', id: colEl.dataset.dropColumn!, order, key: 'col:' + colEl.dataset.dropColumn };
    }
    const bEl = el.closest('[data-drop-board]') as HTMLElement | null;
    if (bEl && !dragged.includes(bEl.dataset.placement!)) return { kind: 'board', id: bEl.dataset.dropBoard!, key: 'b:' + bEl.dataset.dropBoard };
  }
  return null;
}

let hoverEl: Element | null = null;
function markHover(t: DropTarget | null) {
  let el: Element | null = null;
  if (t?.kind === 'trash') el = document.querySelector('[data-drop-trash]');
  else if (t?.kind === 'column') el = document.querySelector(`[data-drop-column="${t.id}"]`);
  else if (t?.kind === 'board') el = t.key.startsWith('sb:') ? document.querySelector(`[data-nav-board="${t.id}"]`) : document.querySelector(`[data-drop-board="${t.id}"]`);
  if (el === hoverEl) return;
  hoverEl?.classList.remove('drop-hover');
  el?.classList.add('drop-hover');
  hoverEl = el;
}

/** Hook used by a few overlays to re-render on layout changes. */
export function useForceUpdateOnResize() {
  const [, set] = useState(0);
  useLayoutEffect(() => {
    const f = () => set((n) => n + 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
}
