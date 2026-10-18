// Graph renderer. Layout runs in a Web Worker; this component only draws,
// batching edges and nodes into a handful of canvas paths per frame so
// thousands of nodes stay smooth. Spec §5.6 suggests WebGL — this Canvas 2D
// renderer is the documented fallback path and meets the 5k/15k target on
// recent hardware; see docs/ARCHITECTURE.md.

import { useEffect, useRef, useState } from 'react';
import type { GEdge, GNode, GraphData } from '../model/graph';
import { t } from '../i18n';

export interface GraphCanvasProps {
  data: GraphData;
  colorOf: (n: GNode) => string;
  thumbOf?: (n: GNode) => string | null;
  highlight?: Set<string> | null;
  path?: string[] | null;
  selected?: string | null;
  center?: string | null;
  onSelect: (id: string | null, e?: { shift: boolean }) => void;
  onOpen: (id: string) => void;
  onHover?: (n: GNode | null, screen: { x: number; y: number } | null) => void;
  forces: { linkDistance: number; repulsion: number; gravity: number };
  compact?: boolean;
  showFps?: boolean;
  zoomTo?: { ids: string[]; at: number } | null;
  resetAt?: number;
  unpinAt?: number;
  /** run a 3-second scripted pan/zoom and report the measured frame rate */
  benchAt?: number;
  onBench?: (r: { fps: number | null; avgMs: number; worstMs: number; drawMs: number; drawWorstMs: number }) => void;
}

interface Prepared {
  ids: string[];
  index: Map<string, number>;
  nodes: GNode[];
  src: Int32Array;
  dst: Int32Array;
  kind: Uint8Array; // 0 link, 1 connector, 2 containment, 3 tag
  radius: Float32Array;
  neighbors: number[][];
}

const KIND: Record<GEdge['kind'], number> = { link: 0, connector: 1, containment: 2, tag: 3 };

function prepare(data: GraphData): Prepared {
  const ids = data.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const m = data.edges.length;
  const src = new Int32Array(m);
  const dst = new Int32Array(m);
  const kind = new Uint8Array(m);
  const neighbors: number[][] = data.nodes.map(() => []);
  data.edges.forEach((e, i) => {
    const s = index.get(e.source)!;
    const d = index.get(e.target)!;
    src[i] = s;
    dst[i] = d;
    kind[i] = KIND[e.kind];
    neighbors[s].push(d);
    neighbors[d].push(s);
  });
  const radius = new Float32Array(data.nodes.length);
  data.nodes.forEach((n, i) => {
    const base = n.kind === 'board' ? 7 : n.kind === 'tag' ? 5 : n.kind === 'broken' ? 3.5 : 4.5;
    radius[i] = base + Math.sqrt(n.degree) * 1.7;
  });
  return { ids, index, nodes: data.nodes, src, dst, kind, radius, neighbors };
}

export function GraphCanvas(props: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const prep = useRef<Prepared | null>(null);
  const pos = useRef<Float32Array>(new Float32Array(0));
  const lastPos = useRef(new Map<string, [number, number]>());
  const pinned = useRef(new Set<string>());
  const tf = useRef({ k: 1, x: 0, y: 0 });
  const hover = useRef<number>(-1);
  const dirty = useRef(true);
  const propsRef = useRef(props);
  propsRef.current = props;
  const thumbs = useRef(new Map<string, HTMLImageElement>());
  const [stats, setStats] = useState({ fps: 0, ms: 0 });
  const drawStats = useRef({ n: 0, total: 0, worst: 0 });
  const fitStage = useRef(0);
  const userMoved = useRef(false);

  // worker lifecycle
  useEffect(() => {
    const w = new Worker(new URL('../graph.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      if (e.data.type === 'tick') {
        pos.current = e.data.positions;
        dirty.current = true;
        // fit once early and again when the layout has settled, unless the user took over
        const a = e.data.alpha;
        if (!userMoved.current && ((fitStage.current === 0 && a < 0.6) || (fitStage.current === 1 && a < 0.08))) {
          fitStage.current++;
          fit();
        }
      }
    };
    return () => {
      w.postMessage({ type: 'stop' });
      w.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (re)initialise layout when the graph structure changes
  const key = props.data.nodes.map((n) => n.id).join('|') + '#' + props.data.edges.length + ':' + props.data.edges.slice(0, 50).map((e) => e.source + e.target).join('');
  useEffect(() => {
    const old = prep.current;
    if (old) old.ids.forEach((id, i) => pos.current.length > i * 2 + 1 && lastPos.current.set(id, [pos.current[i * 2], pos.current[i * 2 + 1]]));
    const p = prepare(props.data);
    prep.current = p;
    const known = p.ids.filter((id) => lastPos.current.has(id)).length;
    // place new nodes near a known neighbour so the layout doesn't explode
    const nodes = p.ids.map((id, i) => {
      const lp = lastPos.current.get(id);
      if (lp) return { x: lp[0], y: lp[1], r: p.radius[i], pinned: pinned.current.has(id) };
      const nb = p.neighbors[i].map((j) => lastPos.current.get(p.ids[j])).find(Boolean);
      return nb ? { x: nb[0] + (Math.random() - 0.5) * 30, y: nb[1] + (Math.random() - 0.5) * 30, r: p.radius[i] } : { r: p.radius[i] };
    });
    const edges = new Int32Array(p.src.length * 2);
    for (let i = 0; i < p.src.length; i++) {
      edges[i * 2] = p.src[i];
      edges[i * 2 + 1] = p.dst[i];
    }
    pos.current = new Float32Array(p.ids.length * 2);
    nodes.forEach((n, i) => {
      pos.current[i * 2] = n.x ?? 0;
      pos.current[i * 2 + 1] = n.y ?? 0;
    });
    if (!known) {
      fitStage.current = 0;
      userMoved.current = false;
    }
    hover.current = -1;
    workerRef.current?.postMessage({ type: 'init', nodes, edges, settings: props.forces, warm: known > p.ids.length * 0.6 }, [edges.buffer]);
    dirty.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: 'forces', settings: props.forces });
  }, [props.forces.linkDistance, props.forces.repulsion, props.forces.gravity]);

  useEffect(() => {
    if (props.resetAt) {
      pinned.current.clear();
      fitStage.current = 0;
      userMoved.current = false;
      workerRef.current?.postMessage({ type: 'reheat', alpha: 1 });
    }
  }, [props.resetAt]);
  useEffect(() => {
    if (props.unpinAt) {
      pinned.current.clear();
      workerRef.current?.postMessage({ type: 'unpinAll' });
    }
  }, [props.unpinAt]);

  useEffect(() => {
    if (!props.benchAt) return;
    const base = { ...tf.current };
    const move = (u: number) => {
      tf.current = { k: base.k * (1 + 0.5 * Math.sin(u * 2)), x: base.x + (Math.cos(u * 3) * 200) / base.k, y: base.y + (Math.sin(u * 3) * 200) / base.k };
    };
    // 1) pure render cost: 60 synchronous frames of pan + zoom
    const costs: number[] = [];
    for (let f = 0; f < 60; f++) {
      move(f / 20);
      const t0 = performance.now();
      draw();
      // force the GPU to finish rasterising so the timing includes it
      canvasRef.current?.getContext('2d')?.getImageData(0, 0, 1, 1);
      costs.push(performance.now() - t0);
    }
    const drawMs = costs.reduce((a, b) => a + b, 0) / costs.length;
    const drawWorstMs = Math.max(...costs);
    propsRef.current.onBench?.({ fps: null, avgMs: 0, worstMs: 0, drawMs, drawWorstMs });
    // 2) real frame rate over 3 s of animated pan/zoom (only meaningful while the window is visible)
    const start = performance.now();
    let frames = 0;
    let last = start;
    let worst = 0;
    let raf = 0;
    const finish = (el: number) => {
      tf.current = base;
      dirty.current = true;
      propsRef.current.onBench?.({ fps: frames ? Math.round((frames / el) * 1000) : 0, avgMs: frames ? el / frames : 0, worstMs: worst, drawMs, drawWorstMs });
    };
    if (document.hidden) {
      finish(1);
      return;
    }
    const step = (now: number) => {
      const el = now - start;
      if (frames) worst = Math.max(worst, now - last);
      last = now;
      frames++;
      move(el / 1000);
      dirty.current = true;
      if (el < 3000) raf = requestAnimationFrame(step);
      else finish(el);
    };
    raf = requestAnimationFrame(step);
    const guard = setTimeout(() => { cancelAnimationFrame(raf); finish(performance.now() - start); }, 4000);
    return () => { cancelAnimationFrame(raf); clearTimeout(guard); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.benchAt]);

  useEffect(() => {
    dirty.current = true;
  }, [props.highlight, props.path, props.selected, props.center, props.colorOf]);

  useEffect(() => {
    if (props.zoomTo?.ids.length) fit(props.zoomTo.ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.zoomTo?.at]);

  function size() {
    const el = wrapRef.current!;
    return { w: el.clientWidth, h: el.clientHeight };
  }

  function fit(ids?: string[]) {
    const p = prep.current;
    if (!p || !p.ids.length) return;
    const idxs = ids ? ids.map((id) => p.index.get(id)).filter((i): i is number => i !== undefined) : p.ids.map((_, i) => i);
    if (!idxs.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of idxs) {
      const x = pos.current[i * 2], y = pos.current[i * 2 + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const { w, h } = size();
    const pad = props.compact ? 30 : 80;
    const k = Math.min(3, Math.max(0.02, Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1))));
    const target = { k: ids && idxs.length === 1 ? Math.max(tf.current.k, 1.5) : k, x: -((minX + maxX) / 2), y: -((minY + maxY) / 2) };
    animateTo(target);
  }

  function animateTo(target: { k: number; x: number; y: number }) {
    const start = { ...tf.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 350);
      const e = 1 - (1 - u) ** 3;
      tf.current = { k: start.k + (target.k - start.k) * e, x: start.x + (target.x - start.x) * e, y: start.y + (target.y - start.y) * e };
      dirty.current = true;
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // world <-> screen; transform: screen = (world + t.xy) * k + centre
  const toWorld = (sx: number, sy: number) => {
    const { w, h } = size();
    const { k, x, y } = tf.current;
    return { x: (sx - w / 2) / k - x, y: (sy - h / 2) / k - y };
  };

  function hitTest(sx: number, sy: number): number {
    const p = prep.current;
    if (!p) return -1;
    const wp = toWorld(sx, sy);
    const k = tf.current.k;
    let best = -1;
    let bd = Infinity;
    const P = pos.current;
    for (let i = 0; i < p.ids.length; i++) {
      const dx = P[i * 2] - wp.x;
      const dy = P[i * 2 + 1] - wp.y;
      const d = dx * dx + dy * dy;
      const r = p.radius[i] + 4 / k;
      if (d < r * r && d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // render loop
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let msSum = 0;
    let last = performance.now();
    const render = () => {
      raf = requestAnimationFrame(render);
      const now = performance.now();
      if (now - last > 1000) {
        if (propsRef.current.showFps) setStats({ fps: frames, ms: frames ? msSum / frames : 0 });
        frames = 0;
        msSum = 0;
        last = now;
      }
      if (!dirty.current) return;
      dirty.current = false;
      const t0 = performance.now();
      draw();
      const dt = performance.now() - t0;
      msSum += dt;
      frames++;
      const ds = drawStats.current;
      ds.n++;
      ds.total += dt;
      if (dt > ds.worst) ds.worst = dt;
    };
    raf = requestAnimationFrame(render);
    const ro = new ResizeObserver(() => (dirty.current = true));
    ro.observe(wrapRef.current!);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const c = canvasRef.current;
    const p = prep.current;
    if (!c || !p) return;
    const pr = propsRef.current;
    const { w, h } = size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    const ctx = c.getContext('2d')!;
    const css = getComputedStyle(c);
    const fg = css.getPropertyValue('--graph-fg').trim() || '#2d3436';
    const edgeColor = css.getPropertyValue('--graph-edge').trim() || 'rgba(99,110,114,0.35)';
    const accent = css.getPropertyValue('--accent').trim() || '#6c5ce7';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { k, x: tx, y: ty } = tf.current;
    ctx.translate(w / 2, h / 2);
    ctx.scale(k, k);
    ctx.translate(tx, ty);
    const P = pos.current;
    const n = p.ids.length;
    if (P.length < n * 2) return;

    // focus set: hovered node (or selected) and its neighbours
    const focusIdx = hover.current >= 0 ? hover.current : pr.selected ? p.index.get(pr.selected) ?? -1 : -1;
    let focus: Set<number> | null = null;
    if (focusIdx >= 0) focus = new Set([focusIdx, ...p.neighbors[focusIdx]]);
    const pathSet = pr.path ? new Set(pr.path.map((id) => p.index.get(id)!).filter((i) => i !== undefined)) : null;
    const pathEdges = new Set<string>();
    if (pr.path) for (let i = 0; i + 1 < pr.path.length; i++) pathEdges.add(pr.path[i] + '>' + pr.path[i + 1]).add(pr.path[i + 1] + '>' + pr.path[i]);
    const hl = pr.highlight && pr.highlight.size ? pr.highlight : null;
    const dim = !!focus || !!pathSet || !!hl;

    // viewport culling bounds in world coords
    const vw0 = -w / 2 / k - tx - 50, vw1 = w / 2 / k - tx + 50;
    const vh0 = -h / 2 / k - ty - 50, vh1 = h / 2 / k - ty + 50;
    const inView = (i: number) => {
      const x = P[i * 2], y = P[i * 2 + 1];
      return x > vw0 && x < vw1 && y > vh0 && y < vh1;
    };

    // ---- edges (batched by kind and emphasis)
    const lw = 1 / k;
    const drawEdges = (kindSel: number, emph: boolean | null) => {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < p.src.length; i++) {
        if (p.kind[i] !== kindSel) continue;
        const s = p.src[i], d = p.dst[i];
        const isEmph = focus ? focus.has(s) && focus.has(d) && (s === focusIdx || d === focusIdx) : pathSet ? pathEdges.has(p.ids[s] + '>' + p.ids[d]) : false;
        if (emph !== null && isEmph !== emph) continue;
        if (!inView(s) && !inView(d)) continue;
        ctx.moveTo(P[s * 2], P[s * 2 + 1]);
        ctx.lineTo(P[d * 2], P[d * 2 + 1]);
        any = true;
      }
      if (any) ctx.stroke();
    };
    const styles: [number, string, number[]][] = [
      [2, edgeColor, [2, 4]],
      [3, edgeColor, [1, 3]],
      [1, edgeColor, [6, 4]],
      [0, edgeColor, []],
    ];
    for (const [kd, col, dash] of styles) {
      ctx.setLineDash(dash.map((d) => d / k));
      ctx.lineWidth = kd === 2 ? lw * 0.6 : lw;
      ctx.strokeStyle = col;
      ctx.globalAlpha = dim ? 0.15 : kd === 2 ? 0.5 : 1;
      drawEdges(kd, dim ? false : null);
      if (dim) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pathSet ? accent : fg;
        ctx.lineWidth = lw * 1.8;
        drawEdges(kd, true);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // arrowheads for links (only when zoomed in enough or focused)
    if (k > 0.5 && (p.src.length < 6000 || focus)) {
      ctx.fillStyle = edgeColor;
      ctx.beginPath();
      for (let i = 0; i < p.src.length; i++) {
        if (p.kind[i] !== 0) continue;
        const s = p.src[i], d = p.dst[i];
        if (focus && !(focus.has(s) && focus.has(d))) continue;
        if (!inView(d)) continue;
        const x1 = P[s * 2], y1 = P[s * 2 + 1], x2 = P[d * 2], y2 = P[d * 2 + 1];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const r = p.radius[d] + 1.5;
        const ax = x2 - ux * r, ay = y2 - uy * r;
        const sz = Math.min(6, 3 + 2 / k);
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - ux * sz - uy * sz * 0.5, ay - uy * sz + ux * sz * 0.5);
        ctx.lineTo(ax - ux * sz + uy * sz * 0.5, ay - uy * sz - ux * sz * 0.5);
        ctx.closePath();
      }
      ctx.fill();
    }

    // ---- nodes, batched by colour
    const byColor = new Map<string, number[]>();
    const faded: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!inView(i)) continue;
      const active = !dim || (focus ? focus.has(i) : pathSet ? pathSet.has(i) : hl!.has(p.ids[i]));
      if (!active) {
        faded.push(i);
        continue;
      }
      const col = pr.colorOf(p.nodes[i]);
      const l = byColor.get(col);
      if (l) l.push(i);
      else byColor.set(col, [i]);
    }
    const shape = (i: number) => {
      const x = P[i * 2], y = P[i * 2 + 1], r = p.radius[i];
      const nd = p.nodes[i];
      if (nd.kind === 'board') {
        ctx.moveTo(x - r, y - r * 0.8);
        ctx.roundRect?.(x - r, y - r * 0.8, r * 2, r * 1.6, r * 0.35) ?? ctx.rect(x - r, y - r * 0.8, r * 2, r * 1.6);
      } else if (nd.kind === 'tag') {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
      } else {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    };
    if (faded.length) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#95a5a6';
      ctx.beginPath();
      faded.forEach(shape);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const [col, list] of byColor) {
      ctx.fillStyle = col;
      ctx.beginPath();
      list.forEach(shape);
      ctx.fill();
    }
    // broken nodes get a red outline
    ctx.strokeStyle = '#d63031';
    ctx.lineWidth = 1.2 / k;
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (p.nodes[i].kind === 'broken' && inView(i)) { ctx.moveTo(P[i * 2] + p.radius[i] + 1, P[i * 2 + 1]); ctx.arc(P[i * 2], P[i * 2 + 1], p.radius[i] + 1, 0, Math.PI * 2); }
    ctx.stroke();

    // thumbnails for image cards at high zoom
    if (pr.thumbOf && k > 2.2) {
      for (let i = 0; i < n; i++) {
        const nd = p.nodes[i];
        if (nd.type !== 'image' || !inView(i)) continue;
        const url = pr.thumbOf(nd);
        if (!url) continue;
        let im = thumbs.current.get(url);
        if (!im) {
          im = new Image();
          im.onload = () => (dirty.current = true);
          im.src = url;
          thumbs.current.set(url, im);
        }
        if (!im.complete || !im.naturalWidth) continue;
        const r = p.radius[i] * 2.4;
        const x = P[i * 2], y = P[i * 2 + 1];
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
        ctx.restore();
      }
    }

    // rings: selection, centre, highlight
    const ring = (i: number | undefined, color: string, extra: number) => {
      if (i === undefined || i < 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(P[i * 2], P[i * 2 + 1], p.radius[i] + extra / k, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (pr.center) ring(p.index.get(pr.center), fg, 4);
    if (pr.selected) ring(p.index.get(pr.selected), accent, 3);
    if (hl) for (const id of hl) ring(p.index.get(id), accent, 2);

    // ---- labels in screen space (constant size)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${pr.compact ? 10 : 11}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const toScreen = (i: number) => ({ x: (P[i * 2] + tx) * k + w / 2, y: (P[i * 2 + 1] + ty) * k + h / 2 });
    const labels: number[] = [];
    const small = n <= (pr.compact ? 40 : 120);
    for (let i = 0; i < n; i++) {
      if (!inView(i)) continue;
      const important = (focus && focus.has(i)) || (pathSet && pathSet.has(i)) || (hl && hl.has(p.ids[i])) || p.ids[i] === pr.selected || p.ids[i] === pr.center;
      if (important || (!dim && (small || p.radius[i] * k > 7))) labels.push(i);
    }
    if (labels.length > 400) labels.sort((a, b) => p.radius[b] - p.radius[a]).length = 400;
    const bg = css.getPropertyValue('--graph-label-bg').trim() || 'rgba(255,255,255,0.8)';
    for (const i of labels) {
      const s = toScreen(i);
      const label = p.nodes[i].title.length > 32 ? p.nodes[i].title.slice(0, 30) + '…' : p.nodes[i].title;
      const y = s.y + p.radius[i] * k + 3;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = bg;
      ctx.fillRect(s.x - tw / 2 - 2, y - 1, tw + 4, 14);
      ctx.fillStyle = fg;
      ctx.globalAlpha = dim && !(focus?.has(i) || pathSet?.has(i) || hl?.has(p.ids[i])) ? 0.4 : 1;
      ctx.fillText(label, s.x, y);
      ctx.globalAlpha = 1;
    }
  }

  // ---- interaction
  const drag = useRef<{ mode: 'pan' | 'node'; i: number; sx: number; sy: number; moved: boolean; start: { x: number; y: number } } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const i = hitTest(sx, sy);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode: i >= 0 ? 'node' : 'pan', i, sx, sy, moved: false, start: { x: tf.current.x, y: tf.current.y } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const d = drag.current;
    if (d) {
      if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
      if (!d.moved) return;
      userMoved.current = true;
      if (d.mode === 'pan') {
        tf.current = { ...tf.current, x: d.start.x + (sx - d.sx) / tf.current.k, y: d.start.y + (sy - d.sy) / tf.current.k };
        dirty.current = true;
      } else {
        const wp = toWorld(sx, sy);
        workerRef.current?.postMessage({ type: 'drag', index: d.i, x: wp.x, y: wp.y });
        pos.current[d.i * 2] = wp.x;
        pos.current[d.i * 2 + 1] = wp.y;
        dirty.current = true;
      }
      return;
    }
    const i = hitTest(sx, sy);
    if (i !== hover.current) {
      hover.current = i;
      dirty.current = true;
      canvasRef.current!.style.cursor = i >= 0 ? 'pointer' : 'grab';
      props.onHover?.(i >= 0 ? prep.current!.nodes[i] : null, i >= 0 ? { x: e.clientX, y: e.clientY } : null);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'node') {
      if (d.moved) {
        pinned.current.add(prep.current!.ids[d.i]);
        workerRef.current?.postMessage({ type: 'release', index: d.i, pin: true });
      } else props.onSelect(prep.current!.ids[d.i], { shift: e.shiftKey });
    } else if (!d.moved) props.onSelect(null);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const i = hitTest(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) props.onOpen(prep.current!.ids[i]);
  };
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const before = toWorld(sx, sy);
      const factor = e.ctrlKey || e.metaKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.002);
      userMoved.current = true;
      const k = Math.min(8, Math.max(0.02, tf.current.k * factor));
      const { w, h } = size();
      tf.current = { k, x: (sx - w / 2) / k - before.x, y: (sy - h / 2) / k - before.y };
      dirty.current = true;
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={'graph-canvas' + (props.compact ? ' compact' : '')} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (hover.current >= 0) {
            hover.current = -1;
            dirty.current = true;
            props.onHover?.(null, null);
          }
        }}
        onDoubleClick={onDoubleClick}
        role="img"
        aria-label={t('Graph of {n} items and {m} connections', { n: props.data.nodes.length, m: props.data.edges.length })}
      />
      <div className="graph-zoom">
        <button onClick={() => { tf.current = { ...tf.current, k: Math.min(8, tf.current.k * 1.3) }; dirty.current = true; }} aria-label={t('Zoom in')}>+</button>
        <button onClick={() => { tf.current = { ...tf.current, k: Math.max(0.02, tf.current.k / 1.3) }; dirty.current = true; }} aria-label={t('Zoom out')}>−</button>
        <button onClick={() => fit()} aria-label={t('Zoom to fit')} title={t('Zoom to fit')}>⤢</button>
      </div>
      {props.showFps && (
        <div className="fps">{stats.fps} fps · {stats.ms.toFixed(1)} ms/frame · {props.data.nodes.length.toLocaleString()} nodes · {props.data.edges.length.toLocaleString()} edges</div>
      )}
    </div>
  );
}
