// Force-directed layout off the UI thread (spec §5.6). The simulation is
// stepped manually and positions are streamed back as a transferable
// Float32Array, so the main thread only ever draws.

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';

interface N {
  index?: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  r: number;
}
interface L {
  source: number | N;
  target: number | N;
}

type Msg =
  | { type: 'init'; nodes: { x?: number; y?: number; r: number; pinned?: boolean }[]; edges: Int32Array; settings: Forces; warm: boolean }
  | { type: 'forces'; settings: Forces }
  | { type: 'drag'; index: number; x: number; y: number }
  | { type: 'release'; index: number; pin: boolean }
  | { type: 'unpinAll' }
  | { type: 'reheat'; alpha?: number }
  | { type: 'stop' };

interface Forces {
  linkDistance: number;
  repulsion: number;
  gravity: number;
}

let sim: Simulation<N, L> | null = null;
let nodes: N[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function post() {
  const buf = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    buf[i * 2] = nodes[i].x;
    buf[i * 2 + 1] = nodes[i].y;
  }
  (self as unknown as Worker).postMessage({ type: 'tick', positions: buf, alpha: sim?.alpha() ?? 0 }, [buf.buffer]);
}

function loop() {
  timer = null;
  if (!sim) return;
  const n = nodes.length;
  // more ticks per frame for small graphs so they settle quickly
  const steps = n < 500 ? 3 : 1;
  for (let i = 0; i < steps; i++) sim.tick();
  post();
  if (sim.alpha() > sim.alphaMin()) timer = setTimeout(loop, 16);
}

function kick(alpha: number) {
  if (!sim) return;
  sim.alpha(Math.max(sim.alpha(), alpha));
  if (!timer) timer = setTimeout(loop, 0);
}

function applyForces(s: Forces) {
  if (!sim) return;
  const n = nodes.length;
  (sim.force('link') as ReturnType<typeof forceLink<N, L>>).distance(s.linkDistance);
  (sim.force('charge') as ReturnType<typeof forceManyBody<N>>).strength(-s.repulsion).theta(n > 3000 ? 1.2 : 0.9);
  (sim.force('x') as ReturnType<typeof forceX<N>>).strength(s.gravity);
  (sim.force('y') as ReturnType<typeof forceY<N>>).strength(s.gravity);
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    if (timer) clearTimeout(timer);
    timer = null;
    sim?.stop();
    const spread = Math.sqrt(m.nodes.length) * 20;
    nodes = m.nodes.map((n) => {
      const x = n.x ?? (Math.random() - 0.5) * spread;
      const y = n.y ?? (Math.random() - 0.5) * spread;
      return { x, y, r: n.r, fx: n.pinned ? x : null, fy: n.pinned ? y : null };
    });
    const links: L[] = [];
    for (let i = 0; i < m.edges.length; i += 2) links.push({ source: m.edges[i], target: m.edges[i + 1] });
    const big = nodes.length > 3000;
    sim = forceSimulation<N, L>(nodes)
      .force('link', forceLink<N, L>(links).distance(m.settings.linkDistance).strength(big ? 0.3 : 0.7))
      .force('charge', forceManyBody<N>().strength(-m.settings.repulsion).theta(big ? 1.2 : 0.9).distanceMax(big ? 600 : 1500))
      .force('x', forceX<N>(0).strength(m.settings.gravity))
      .force('y', forceY<N>(0).strength(m.settings.gravity))
      .alphaDecay(big ? 0.03 : 0.0228)
      .velocityDecay(0.4)
      .stop();
    if (!big) sim.force('collide', forceCollide<N>((n) => n.r + 3).iterations(1));
    sim.alpha(m.warm ? 0.25 : 1);
    post();
    timer = setTimeout(loop, 0);
  } else if (m.type === 'forces') {
    applyForces(m.settings);
    kick(0.5);
  } else if (m.type === 'drag') {
    const n = nodes[m.index];
    if (!n) return;
    n.fx = m.x;
    n.fy = m.y;
    kick(0.15);
  } else if (m.type === 'release') {
    const n = nodes[m.index];
    if (!n) return;
    if (!m.pin) {
      n.fx = null;
      n.fy = null;
    }
    kick(0.1);
  } else if (m.type === 'unpinAll') {
    for (const n of nodes) {
      n.fx = null;
      n.fy = null;
    }
    kick(0.3);
  } else if (m.type === 'reheat') {
    if (m.alpha && m.alpha >= 1) {
      // reset layout: scatter and restart
      const spread = Math.sqrt(nodes.length) * 20;
      for (const n of nodes) {
        n.x = (Math.random() - 0.5) * spread;
        n.y = (Math.random() - 0.5) * spread;
        n.vx = n.vy = 0;
        n.fx = n.fy = null;
      }
    }
    kick(m.alpha ?? 0.5);
  } else if (m.type === 'stop') {
    if (timer) clearTimeout(timer);
    timer = null;
    sim?.stop();
  }
};
