// Derived indexes over a workspace snapshot: link index (backlinks), tags,
// title resolution, placements by board. This is the client-side equivalent
// of the server's `links` / `card_tags` tables (spec §4.4). Per-card parse
// results are cached by object identity, so after an edit only the changed
// card is re-parsed (immer keeps unchanged objects identical).

import type { Card, Placement, Workspace } from './types';
import { editorLabel, extractTags, parseLinks, resolveRef, type ParsedLink, type Resolvable } from './links';

export interface TextField {
  field: string; // 'text' | 'title' | 'item:<id>' | 'cell:<row>:<col>' | 'comment:<id>'
  text: string;
}

export interface LinkRef extends ParsedLink {
  sourceId: string;
  field: string;
  fieldText: string;
}

export function textFields(card: Card): TextField[] {
  const out: TextField[] = [];
  if (card.text) out.push({ field: 'text', text: card.text });
  for (const it of card.data.items ?? []) if (it.text) out.push({ field: 'item:' + it.id, text: it.text });
  const t = card.data.table;
  if (t) for (const r of t.rows) for (const c of t.columns) if (r.cells[c.id]) out.push({ field: `cell:${r.id}:${c.id}`, text: r.cells[c.id] });
  if (card.data.caption) out.push({ field: 'caption', text: card.data.caption });
  return out;
}

const parseCache = new WeakMap<Card, { links: LinkRef[]; tags: string[] }>();

function parseCard(card: Card) {
  let hit = parseCache.get(card);
  if (!hit) {
    const links: LinkRef[] = [];
    const tags = new Set<string>(card.labels.map((l) => l.toLowerCase()));
    for (const f of textFields(card)) {
      for (const l of parseLinks(f.text)) links.push({ ...l, sourceId: card.id, field: f.field, fieldText: f.text });
      for (const t of extractTags(f.text)) tags.add(t);
    }
    hit = { links, tags: [...tags] };
    parseCache.set(card, hit);
  }
  return hit;
}

export interface WsIndex {
  doc: Workspace;
  liveBoards: Set<string>;
  isLive: (id: string) => boolean;
  placementsByBoard: Map<string, Placement[]>;
  placementsByCard: Map<string, Placement[]>;
  /** board a card primarily lives on (first live placement / parent for boards) */
  homeBoard: Map<string, string>;
  resolvables: Map<string, Resolvable>;
  titleCounts: Map<string, number>;
  label: (id: string) => string | null;
  title: (id: string) => string;
  resolve: (ref: string) => string | null;
  backlinks: Map<string, LinkRef[]>;
  outlinks: Map<string, LinkRef[]>;
  tags: Map<string, Set<string>>;
  cardTags: Map<string, string[]>;
  childCount: (boardId: string) => number;
}

const LINK_TOKEN = /\[\[@?([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g;

/**
 * Display title of a card: its title, or the first line of its text. Links in
 * that first line are shown as their alias / the target's title (one level deep).
 */
export function cardTitle(card: Card | undefined, doc?: Pick<Workspace, 'cards'>, depth = 0): string {
  if (!card) return 'Missing item';
  if (card.title?.trim()) return card.title.trim();
  const firstLine = (card.text || '').split('\n').find((l) => l.trim());
  if (firstLine) {
    const plain = firstLine
      .replace(/^#+\s*/, '')
      .replace(LINK_TOKEN, (_m, id: string, _a, alias?: string) => {
        if (alias) return alias;
        const target = doc?.cards[id];
        return target && depth < 1 ? cardTitle(target, doc, depth + 1) : id.length > 30 ? '…' : id;
      })
      .replace(/[*_~`>]/g, '')
      .replace(/^\s*[-+]\s+(\[[ xX]\]\s*)?/, '')
      .trim();
    if (plain) return plain.length > 60 ? plain.slice(0, 58) + '…' : plain;
  }
  if (card.type === 'link' && card.data.url) return card.data.url;
  if (card.type === 'image' || card.type === 'file') return card.data.fileName || card.data.caption || card.type;
  if (card.type === 'swatch') return card.data.hex || 'Colour';
  if (card.type === 'map') return card.data.address || 'Map';
  if (card.type === 'todo') return 'To-do list';
  return 'Untitled ' + card.type;
}

let cached: { doc: Workspace; index: WsIndex } | null = null;

export function getIndex(doc: Workspace): WsIndex {
  if (cached && cached.doc === doc) return cached.index;
  const index = buildIndex(doc);
  cached = { doc, index };
  return index;
}

function buildIndex(doc: Workspace): WsIndex {
  // live boards: not deleted and every ancestor live
  const liveBoards = new Set<string>();
  const boardLive = (id: string, depth = 0): boolean => {
    if (liveBoards.has(id)) return true;
    const c = doc.cards[id];
    if (!c || c.type !== 'board' || c.deletedAt || depth > 64) return false;
    const parent = c.data.parentId;
    if (id !== doc.rootBoardId && (!parent || !boardLive(parent, depth + 1))) return false;
    liveBoards.add(id);
    return true;
  };
  for (const c of Object.values(doc.cards)) if (c.type === 'board') boardLive(c.id);

  const placementsByBoard = new Map<string, Placement[]>();
  const placementsByCard = new Map<string, Placement[]>();
  for (const p of Object.values(doc.placements)) {
    if (p.deletedAt || !liveBoards.has(p.boardId)) continue;
    const c = doc.cards[p.cardId];
    if (!c || c.deletedAt) continue;
    push(placementsByBoard, p.boardId, p);
    push(placementsByCard, p.cardId, p);
  }
  const isLive = (id: string) => {
    const c = doc.cards[id];
    if (!c || c.deletedAt) return false;
    if (c.type === 'board') return liveBoards.has(id);
    return placementsByCard.has(id);
  };

  const homeBoard = new Map<string, string>();
  for (const c of Object.values(doc.cards)) {
    if (c.type === 'board') {
      if (c.data.parentId) homeBoard.set(c.id, c.data.parentId);
    } else {
      const ps = placementsByCard.get(c.id);
      if (ps?.length) homeBoard.set(c.id, ps[0].boardId);
      else {
        const any = Object.values(doc.placements).find((p) => p.cardId === c.id);
        if (any) homeBoard.set(c.id, any.boardId);
      }
    }
  }

  const resolvables = new Map<string, Resolvable>();
  const titleCounts = new Map<string, number>();
  for (const c of Object.values(doc.cards)) {
    if (c.type === 'column' && !c.title) continue;
    const t = cardTitle(c, doc);
    const hb = homeBoard.get(c.id);
    resolvables.set(c.id, { id: c.id, title: t, boardTitle: hb ? cardTitle(doc.cards[hb], doc) : '', updatedAt: c.updatedAt });
    if (isLive(c.id)) titleCounts.set(t.toLowerCase(), (titleCounts.get(t.toLowerCase()) ?? 0) + 1);
  }
  const liveResolvables = [...resolvables.values()].filter((r) => isLive(r.id));

  const backlinks = new Map<string, LinkRef[]>();
  const outlinks = new Map<string, LinkRef[]>();
  const tags = new Map<string, Set<string>>();
  const cardTags = new Map<string, string[]>();
  for (const c of Object.values(doc.cards)) {
    if (!isLive(c.id)) continue;
    const { links, tags: ts } = parseCard(c);
    if (links.length) outlinks.set(c.id, [...links]);
    for (const l of links) if (l.targetId) push(backlinks, l.targetId, l);
    if (ts.length) {
      cardTags.set(c.id, ts);
      for (const t of ts) {
        let s = tags.get(t);
        if (!s) tags.set(t, (s = new Set()));
        s.add(c.id);
      }
    }
  }
  // links written inside comments count as references from the commented item
  for (const cm of Object.values(doc.comments)) {
    if (!isLive(cm.targetId)) continue;
    for (const l of parseLinks(cm.body)) {
      const ref: LinkRef = { ...l, sourceId: cm.targetId, field: 'comment:' + cm.id, fieldText: cm.body };
      push(outlinks, cm.targetId, ref);
      if (l.targetId) push(backlinks, l.targetId, ref);
    }
  }

  const label = (id: string) => editorLabel(id, resolvables, titleCounts);
  return {
    doc,
    liveBoards,
    isLive,
    placementsByBoard,
    placementsByCard,
    homeBoard,
    resolvables,
    titleCounts,
    label,
    title: (id: string) => resolvables.get(id)?.title ?? cardTitle(doc.cards[id], doc),
    resolve: (ref: string) => resolveRef(ref, liveResolvables),
    backlinks,
    outlinks,
    tags,
    cardTags,
    childCount: (b: string) => placementsByBoard.get(b)?.filter((p) => !p.tray).length ?? 0,
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Breadcrumb path root -> board */
export function boardPath(doc: Workspace, boardId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = boardId;
  while (cur && !seen.has(cur) && doc.cards[cur]) {
    seen.add(cur);
    out.unshift(cur);
    cur = doc.cards[cur].data.parentId;
  }
  return out;
}

/** Board ids in the subtree rooted at `root` (inclusive). */
export function subtreeBoards(doc: Workspace, root: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of Object.values(doc.cards)) if (c.type === 'board' && c.data.parentId) push(children, c.data.parentId, c.id);
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const b = stack.pop()!;
    if (out.has(b)) continue;
    out.add(b);
    stack.push(...(children.get(b) ?? []));
  }
  return out;
}
