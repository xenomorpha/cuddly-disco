// Graph data for graph view (spec §5, §8 "Graph API"): nodes for boards,
// cards and tags; edges for links, connectors, containment and tags —
// filtered by the viewer's permissions and the user's graph settings.

import type { CardType, GraphSettings, Workspace } from './types';
import type { WsIndex } from './index';
import { subtreeBoards } from './index';
import type { AccessFn } from './permissions';

export type NodeKind = 'board' | 'card' | 'tag' | 'broken';
export type EdgeKind = 'link' | 'connector' | 'containment' | 'tag';

export interface GNode {
  id: string;
  kind: NodeKind;
  type: CardType | 'tag' | 'broken';
  title: string;
  boardId: string | null;
  degree: number;
  createdBy?: string;
  updatedAt?: number;
  tags: string[];
}

export interface GEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
}

const HIDDEN_TYPES: CardType[] = ['column'];

export function buildGraph(doc: Workspace, idx: WsIndex, access: AccessFn, s: GraphSettings): GraphData {
  const scope = s.rootBoardId && idx.liveBoards.has(s.rootBoardId) ? subtreeBoards(doc, s.rootBoardId) : null;
  const inScope = (id: string) => {
    if (!scope) return true;
    const c = doc.cards[id];
    if (c?.type === 'board') return scope.has(id);
    return (idx.placementsByCard.get(id) ?? []).some((p) => scope.has(p.boardId));
  };
  const from = s.dateFrom ? Date.parse(s.dateFrom) : null;
  const to = s.dateTo ? Date.parse(s.dateTo) + 86400_000 : null;
  const q = s.query.trim().toLowerCase();

  const nodes = new Map<string, GNode>();
  for (const c of Object.values(doc.cards)) {
    if (HIDDEN_TYPES.includes(c.type)) continue;
    if (!idx.isLive(c.id) || !access.canSee(c.id) || !inScope(c.id)) continue;
    if (s.types.length && !s.types.includes(c.type)) continue;
    const tags = idx.cardTags.get(c.id) ?? [];
    if (s.tags.length && !s.tags.some((t) => tags.includes(t))) continue;
    if (s.author && c.createdBy !== s.author) continue;
    if (from && c.updatedAt < from) continue;
    if (to && c.updatedAt > to) continue;
    const title = idx.title(c.id);
    if (q && !title.toLowerCase().includes(q) && !c.text.toLowerCase().includes(q)) continue;
    nodes.set(c.id, {
      id: c.id,
      kind: c.type === 'board' ? 'board' : 'card',
      type: c.type,
      title,
      boardId: idx.homeBoard.get(c.id) ?? null,
      degree: 0,
      createdBy: c.createdBy,
      updatedAt: c.updatedAt,
      tags,
    });
  }

  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, kind: EdgeKind) => {
    if (source === target) return;
    const key = `${kind}:${source}>${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  // semantic links
  for (const [src, refs] of idx.outlinks) {
    if (!nodes.has(src)) continue;
    for (const r of refs) {
      if (r.targetId && nodes.has(r.targetId)) add(src, r.targetId, 'link');
      else if (s.showBroken) {
        const live = r.targetId ? idx.isLive(r.targetId) : false;
        if (live) continue; // filtered out or restricted: never reveal it
        const bid = 'broken:' + (r.targetId ?? r.ref);
        if (!nodes.has(bid))
          nodes.set(bid, { id: bid, kind: 'broken', type: 'broken', title: r.targetId ? (r.alias ?? 'Missing item') : r.ref ?? '?', boardId: null, degree: 0, tags: [] });
        add(src, bid, 'link');
      }
    }
  }
  // canvas connectors
  if (s.showConnectors) {
    for (const cn of Object.values(doc.connectors)) {
      const a = doc.placements[cn.from];
      const b = doc.placements[cn.to];
      if (!a || !b || a.deletedAt || b.deletedAt) continue;
      if (nodes.has(a.cardId) && nodes.has(b.cardId)) add(a.cardId, b.cardId, 'connector');
    }
  }
  // containment
  if (s.showContainment) {
    for (const n of [...nodes.values()]) {
      if (n.kind === 'board') {
        const parent = doc.cards[n.id]?.data.parentId;
        if (parent && nodes.has(parent)) add(n.id, parent, 'containment');
      } else if (n.kind === 'card') {
        for (const p of idx.placementsByCard.get(n.id) ?? []) if (nodes.has(p.boardId)) add(n.id, p.boardId, 'containment');
      }
    }
  }
  // tags
  if (s.showTags) {
    for (const n of [...nodes.values()]) {
      if (n.kind === 'tag') continue;
      for (const t of n.tags) {
        const tid = 'tag:' + t;
        if (!nodes.has(tid)) nodes.set(tid, { id: tid, kind: 'tag', type: 'tag', title: '#' + t, boardId: null, degree: 0, tags: [] });
        add(n.id, tid, 'tag');
      }
    }
  }

  for (const e of edges) {
    if (e.kind === 'containment') continue;
    nodes.get(e.source)!.degree++;
    nodes.get(e.target)!.degree++;
  }
  let list = [...nodes.values()];
  if (!s.showOrphans) {
    list = list.filter((n) => n.degree > 0);
  }
  const ids = new Set(list.map((n) => n.id));
  return { nodes: list, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** Neighbourhood of `center` up to `depth` hops (edges are treated as undirected). */
export function localGraph(g: GraphData, center: string, depth: number): GraphData {
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const keep = new Set<string>([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const m of adj.get(n) ?? []) if (!keep.has(m)) { keep.add(m); next.push(m); }
    frontier = next;
  }
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

/** Shortest path (BFS, undirected) between two nodes; returns node ids or null. */
export function shortestPath(g: GraphData, a: string, b: string): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    if (e.kind === 'containment') continue;
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const prev = new Map<string, string | null>([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === b) break;
    for (const m of adj.get(n) ?? []) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
  }
  if (!prev.has(b)) return null;
  const path: string[] = [];
  for (let cur: string | null = b; cur; cur = prev.get(cur) ?? null) path.unshift(cur);
  return path;
}

/** Colour-group query: `tag:x`, `type:note`, `board:Name`, or plain text in the title. */
export function matchesQuery(n: GNode, query: string, boardTitle: (id: string) => string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const m = /^(tag|type|board):(.+)$/.exec(q);
  if (m) {
    const v = m[2].trim().replace(/^#/, '');
    if (m[1] === 'tag') return n.tags.includes(v) || n.id === 'tag:' + v;
    if (m[1] === 'type') return n.type === v;
    if (m[1] === 'board') return !!n.boardId && boardTitle(n.boardId).toLowerCase().includes(v);
  }
  return n.title.toLowerCase().includes(q.replace(/^#/, '')) || n.tags.includes(q.replace(/^#/, ''));
}

/** Synthetic graph for the performance benchmark (spec §5.6). */
export function syntheticGraph(nodeCount: number, edgeCount: number): GraphData {
  const types: CardType[] = ['note', 'note', 'note', 'document', 'todo', 'image', 'link', 'board'];
  const nodes: GNode[] = Array.from({ length: nodeCount }, (_, i) => {
    const type = types[i % types.length];
    return { id: 'n' + i, kind: type === 'board' ? 'board' : 'card', type, title: `${type} ${i}`, boardId: null, degree: 0, tags: [] };
  });
  const edges: GEdge[] = [];
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clusters = Math.max(1, Math.round(nodeCount / 120));
  for (let i = 0; i < edgeCount; i++) {
    const a = Math.floor(rnd() * nodeCount);
    // mostly connect within a cluster so the layout shows structure
    const cluster = a % clusters;
    const b = rnd() < 0.85 ? (cluster + clusters * Math.floor(rnd() * (nodeCount / clusters))) % nodeCount : Math.floor(rnd() * nodeCount);
    if (a === b) continue;
    edges.push({ source: 'n' + a, target: 'n' + b, kind: rnd() < 0.85 ? 'link' : 'connector' });
    nodes[a].degree++;
    nodes[b].degree++;
  }
  return { nodes, edges };
}
