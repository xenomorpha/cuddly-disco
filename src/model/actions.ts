// Domain operations. Every mutation goes through commit() so it is undoable,
// synced to other tabs and persisted.

import type { Draft } from 'immer';
import type {
  Card, CardData, CardType, Connector, GraphSettings, Placement, Role, SubtreePayload, Workspace,
} from './types';
import { DEFAULT_GRAPH_SETTINGS } from './types';
import type { DbSchema, DbValue } from './types';
import { defaultSchema } from './database';
import { commit, getDoc, getUI, setUI, toast, uid, type Viewport } from './store';
import { boardPath, cardTitle, getIndex, subtreeBoards } from './index';
import { linkMention, type Mention } from './links';
import { makeAccess, canEdit } from './permissions';

export const DEFAULT_SIZE: Record<CardType, { w: number; h?: number }> = {
  note: { w: 240 },
  document: { w: 220 },
  todo: { w: 260 },
  board: { w: 170 },
  column: { w: 280 },
  image: { w: 260 },
  link: { w: 280 },
  file: { w: 240 },
  table: { w: 400 },
  sketch: { w: 300, h: 220 },
  swatch: { w: 140 },
  map: { w: 320, h: 240 },
  comment: { w: 240 },
  shortcut: { w: 170 },
  database: { w: 760 },
  row: { w: 240 },
};

export const TRASH_DAYS = 30;

const now = () => Date.now();
const me = () => getUI().userId;

function newCard(type: CardType, partial: Partial<Card> = {}): Card {
  const t = now();
  return {
    id: uid(),
    type,
    title: '',
    text: '',
    data: {},
    labels: [],
    createdBy: me(),
    createdAt: t,
    updatedAt: t,
    updatedBy: me(),
    ...partial,
  };
}

function defaultData(type: CardType): CardData {
  switch (type) {
    case 'todo':
      return { items: [{ id: uid(), text: '', done: false }] };
    case 'table':
      return {
        table: {
          columns: [
            { id: uid(), name: 'Item', kind: 'text' },
            { id: uid(), name: 'Amount', kind: 'number' },
            { id: uid(), name: 'Done', kind: 'checkbox' },
          ],
          rows: [0, 1, 2].map(() => ({ id: uid(), cells: {} })),
        },
      };
    case 'sketch':
      return { strokes: [] };
    case 'swatch':
      return { hex: '#6c5ce7', showCaption: true };
    case 'board':
      return { icon: 'board' };
    case 'database':
      return { db: defaultSchema() };
    case 'map':
      return { lat: 51.5074, lon: -0.1278, address: 'London' };
    default:
      return {};
  }
}

function topZ(d: Workspace | Draft<Workspace>, boardId: string) {
  let z = 0;
  for (const p of Object.values(d.placements)) if (p.boardId === boardId && p.z > z) z = p.z;
  return z + 1;
}

export function snap(v: number) {
  return getUI().snap ? Math.round(v / 20) * 20 : Math.round(v);
}

export interface CreateOpts {
  boardId?: string;
  x?: number;
  y?: number;
  columnId?: string | null;
  order?: number;
  tray?: boolean;
  title?: string;
  text?: string;
  data?: CardData;
  w?: number;
  h?: number;
  color?: string;
  select?: boolean;
}

export function createCard(type: CardType, opts: CreateOpts = {}) {
  const boardId = opts.boardId ?? getUI().boardId;
  const card = newCard(type, {
    title: opts.title ?? (type === 'board' ? 'New board' : type === 'column' ? 'Column' : ''),
    text: opts.text ?? '',
    data: { ...defaultData(type), ...(opts.data ?? {}) },
    color: opts.color,
  });
  if (type === 'board') card.data.parentId = boardId;
  const size = DEFAULT_SIZE[type];
  const placement: Placement = {
    id: uid(),
    cardId: card.id,
    boardId,
    columnId: opts.columnId ?? null,
    order: opts.order ?? now(),
    x: snap(opts.x ?? 0),
    y: snap(opts.y ?? 0),
    w: opts.w ?? size.w,
    h: opts.h ?? size.h,
    z: 0,
    tray: opts.tray,
  };
  commit(`Add ${type}`, (d) => {
    placement.z = topZ(d, boardId);
    d.cards[card.id] = card;
    d.placements[placement.id] = placement;
  }, { activity: { boardId, text: `added a ${type}${card.title ? ` "${card.title}"` : ''}` } });
  if (opts.select !== false && !opts.tray) setUI({ selection: [placement.id], selectedConnector: null });
  return { cardId: card.id, placementId: placement.id };
}

export function updateCard(id: string, patch: Partial<Card> | ((c: Draft<Card>) => void), key?: string) {
  const before = getDoc().cards[id];
  if (!before) return;
  commit('Edit ' + before.type, (d) => {
    const c = d.cards[id];
    if (!c) return;
    const prevText = c.text;
    const prevTitle = c.title;
    if (typeof patch === 'function') patch(c);
    else Object.assign(c, patch);
    c.updatedAt = now();
    c.updatedBy = me();
    // version history: keep a snapshot at most once a minute per card
    if ((c.text !== prevText || c.title !== prevTitle) && (prevText || prevTitle)) {
      const h = (c.history ??= []);
      const last = h[h.length - 1];
      if (!last || now() - last.at > 60_000) {
        h.push({ at: now(), by: me(), text: prevText, title: prevTitle });
        if (h.length > 30) h.shift();
      }
    }
  }, { key: key ?? 'edit:' + id });
}

export function updateData(id: string, patch: Partial<CardData> | ((data: Draft<CardData>) => void), key?: string) {
  updateCard(id, (c) => {
    if (typeof patch === 'function') patch(c.data);
    else Object.assign(c.data, patch);
  }, key);
}

/** Write the text of one linkable field (card text, to-do item, table cell, comment). */
export function setFieldText(cardId: string, field: string, text: string) {
  if (field.startsWith('comment:')) {
    const cid = field.slice(8);
    commit('Edit comment', (d) => {
      if (d.comments[cid]) d.comments[cid].body = text;
    });
    return;
  }
  updateCard(cardId, (c) => {
    if (field === 'text') c.text = text;
    else if (field === 'caption') c.data.caption = text;
    else if (field.startsWith('item:')) {
      const it = c.data.items?.find((i) => i.id === field.slice(5));
      if (it) it.text = text;
    } else if (field.startsWith('cell:')) {
      const [, row, col] = field.split(':');
      const r = c.data.table?.rows.find((x) => x.id === row);
      if (r) r.cells[col] = text;
    }
  });
}

export function convertMention(sourceId: string, field: string, fieldText: string, mention: Mention, targetId: string) {
  const title = getIndex(getDoc()).label(targetId) ?? '';
  setFieldText(sourceId, field, linkMention(fieldText, mention, targetId, title));
  toast('Linked mention');
}

export function setPlacement(id: string, patch: Partial<Placement>, key?: string) {
  commit('Edit placement', (d) => {
    const p = d.placements[id];
    if (p) Object.assign(p, patch);
  }, { key: key ?? 'place:' + id });
}

export function movePlacements(moves: { id: string; x: number; y: number }[]) {
  commit('Move', (d) => {
    for (const m of moves) {
      const p = d.placements[m.id];
      if (p && !p.locked) {
        p.x = snap(m.x);
        p.y = snap(m.y);
      }
    }
  });
}

export function bringToFront(ids: string[]) {
  const doc = getDoc();
  const boardId = doc.placements[ids[0]]?.boardId;
  if (!boardId) return;
  let z = topZ(doc, boardId);
  if (ids.every((id) => doc.placements[id]?.z === z - 1)) return;
  commit('Bring to front', (d) => {
    for (const id of ids) if (d.placements[id]) d.placements[id].z = z++;
  }, { silent: true });
}

export function toggleLock(ids: string[]) {
  const doc = getDoc();
  const lock = !ids.every((id) => doc.placements[id]?.locked);
  commit(lock ? 'Lock' : 'Unlock', (d) => {
    for (const id of ids) if (d.placements[id]) d.placements[id].locked = lock;
  });
}

// ------------------------------------------------------------------ columns

export function addToColumn(placementIds: string[], columnPlacementId: string, beforeOrder?: number) {
  const doc = getDoc();
  const col = doc.placements[columnPlacementId];
  if (!col) return;
  const siblings = Object.values(doc.placements)
    .filter((p) => p.columnId === columnPlacementId && !p.deletedAt && !placementIds.includes(p.id))
    .sort((a, b) => a.order - b.order);
  const ids = placementIds.filter((id) => doc.cards[doc.placements[id]?.cardId]?.type !== 'column' && id !== columnPlacementId);
  if (!ids.length) return;
  let insertAt = beforeOrder === undefined ? siblings.length : siblings.findIndex((s) => s.order >= beforeOrder);
  if (insertAt < 0) insertAt = siblings.length;
  const ordered = [...siblings.slice(0, insertAt).map((s) => s.id), ...ids, ...siblings.slice(insertAt).map((s) => s.id)];
  commit('Add to column', (d) => {
    ordered.forEach((id, i) => {
      const p = d.placements[id];
      if (!p) return;
      p.columnId = columnPlacementId;
      p.boardId = col.boardId;
      p.order = i;
      p.tray = false;
    });
  });
}

export function removeFromColumn(id: string, x: number, y: number) {
  commit('Remove from column', (d) => {
    const p = d.placements[id];
    if (!p) return;
    p.columnId = null;
    p.x = snap(x);
    p.y = snap(y);
    p.z = topZ(d, p.boardId);
  });
}

export function groupIntoColumn(ids: string[]) {
  const doc = getDoc();
  const ps = ids.map((id) => doc.placements[id]).filter((p) => p && !p.columnId && doc.cards[p.cardId]?.type !== 'column');
  if (!ps.length) return;
  const x = Math.min(...ps.map((p) => p.x));
  const y = Math.min(...ps.map((p) => p.y));
  const { placementId } = createCard('column', { boardId: ps[0].boardId, x, y: y - 10, title: 'Column' });
  addToColumn(ps.sort((a, b) => a.y - b.y || a.x - b.x).map((p) => p.id), placementId);
}

export function duplicateEmptyColumn(columnPlacementId: string) {
  const doc = getDoc();
  const p = doc.placements[columnPlacementId];
  const c = p && doc.cards[p.cardId];
  if (!p || !c) return;
  createCard('column', { boardId: p.boardId, x: p.x + p.w + 20, y: p.y, title: c.title, w: p.w, color: c.color });
}

// ------------------------------------------------------------------ connectors

export function addConnector(boardId: string, from: string, to: string) {
  if (from === to) return;
  const exists = Object.values(getDoc().connectors).some((c) => c.boardId === boardId && c.from === from && c.to === to);
  if (exists) return;
  const c: Connector = {
    id: uid(),
    boardId,
    from,
    to,
    label: '',
    style: { curved: true, arrowStart: false, arrowEnd: true, color: '#636e72', dashed: false },
  };
  commit('Add line', (d) => {
    d.connectors[c.id] = c;
  }, { activity: { boardId, text: 'connected two cards' } });
  setUI({ selectedConnector: c.id, selection: [] });
}

export function updateConnector(id: string, patch: Partial<Connector> | ((c: Draft<Connector>) => void)) {
  commit('Edit line', (d) => {
    const c = d.connectors[id];
    if (!c) return;
    if (typeof patch === 'function') patch(c);
    else Object.assign(c, patch);
  }, { key: 'conn:' + id });
}

export function deleteConnector(id: string) {
  commit('Delete line', (d) => {
    delete d.connectors[id];
  });
  setUI({ selectedConnector: null });
}

// ------------------------------------------------------------------ trash

export function trashPlacements(ids: string[]) {
  const doc = getDoc();
  const idx = getIndex(doc);
  const t = now();
  let boardId = '';
  commit('Delete', (d) => {
    const all = new Set(ids);
    // a column takes its contents with it
    for (const id of ids) {
      const p = doc.placements[id];
      if (p && doc.cards[p.cardId]?.type === 'column')
        for (const q of Object.values(doc.placements)) if (q.columnId === id && !q.deletedAt) all.add(q.id);
    }
    for (const id of all) {
      const p = d.placements[id];
      if (!p || p.locked) continue;
      boardId = p.boardId;
      const live = (idx.placementsByCard.get(p.cardId) ?? []).filter((q) => !all.has(q.id));
      p.deletedAt = t;
      if (!live.length) {
        const c = d.cards[p.cardId];
        if (c) c.deletedAt = t;
      }
    }
  }, { activity: boardId ? { boardId: doc.placements[ids[0]]?.boardId ?? '', text: `deleted ${ids.length} item(s)` } : undefined });
  setUI((ui) => ({ selection: ui.selection.filter((s) => !ids.includes(s)) }));
  toast(`Moved ${ids.length} item(s) to Trash · Cmd/Ctrl+Z to undo`);
}

export function trashBoard(boardId: string) {
  const doc = getDoc();
  if (boardId === doc.rootBoardId) return;
  const ps = getIndex(doc).placementsByCard.get(boardId) ?? [];
  if (ps.length) trashPlacements(ps.map((p) => p.id));
  else
    commit('Delete board', (d) => {
      if (d.cards[boardId]) d.cards[boardId].deletedAt = now();
    });
  if (getUI().boardId === boardId || boardPath(getDoc(), getUI().boardId).includes(boardId))
    openBoard(doc.cards[boardId].data.parentId ?? doc.rootBoardId);
}

export function restoreCard(cardId: string) {
  const doc = getDoc();
  const card = doc.cards[cardId];
  if (!card) return;
  const idx = getIndex(doc);
  commit('Restore', (d) => {
    const c = d.cards[cardId];
    const t = c.deletedAt;
    c.deletedAt = null;
    const ps = Object.values(d.placements).filter((p) => p.cardId === cardId);
    let restored = ps.filter((p) => p.deletedAt && p.deletedAt === t);
    if (!restored.length && !ps.some((p) => !p.deletedAt)) restored = ps.slice(-1);
    for (const p of restored) {
      p.deletedAt = null;
      if (!idx.liveBoards.has(p.boardId)) {
        p.boardId = doc.rootBoardId;
        p.columnId = null;
      }
      // column contents deleted together with the column
      for (const q of Object.values(d.placements))
        if (q.columnId === p.id && q.deletedAt === t) {
          q.deletedAt = null;
          const qc = d.cards[q.cardId];
          if (qc && qc.deletedAt === t) qc.deletedAt = null;
        }
    }
    if (c.type === 'board' && c.data.parentId && !idx.liveBoards.has(c.data.parentId)) {
      c.data.parentId = doc.rootBoardId;
      for (const p of restored) p.boardId = doc.rootBoardId;
    }
    if (c.type !== 'board' && c.type !== 'row' && !restored.length && !ps.length) {
      const pl: Placement = { id: uid(), cardId, boardId: doc.rootBoardId, order: 0, x: 0, y: 0, w: DEFAULT_SIZE[c.type].w, z: 1 };
      d.placements[pl.id] = pl;
    }
  });
  toast(`Restored "${cardTitle(card)}"`);
}

export function hardDelete(cardId: string) {
  const doc = getDoc();
  const access = makeAccess(doc, me());
  if (access.board(doc.rootBoardId) !== 'owner') {
    toast('Only the workspace owner can permanently delete');
    return;
  }
  commit('Delete forever', (d) => hardDeleteDraft(d, cardId));
}

function hardDeleteDraft(d: Draft<Workspace>, cardId: string) {
  const c = d.cards[cardId];
  if (!c) return;
  if (c.type === 'database')
    for (const r of Object.values(d.cards)) if (r.type === 'row' && r.data.databaseId === cardId) delete d.cards[r.id];
  if (c.type === 'board') {
    const boards = subtreeBoards(d as Workspace, cardId);
    for (const p of Object.values(d.placements))
      if (boards.has(p.boardId) && p.cardId !== cardId) {
        const others = Object.values(d.placements).some((q) => q.cardId === p.cardId && !boards.has(q.boardId));
        if (!others && d.cards[p.cardId]) hardDeleteDraft(d, p.cardId);
        delete d.placements[p.id];
      }
  }
  const pids = new Set<string>();
  for (const p of Object.values(d.placements)) if (p.cardId === cardId) { pids.add(p.id); delete d.placements[p.id]; }
  for (const cn of Object.values(d.connectors)) if (pids.has(cn.from) || pids.has(cn.to)) delete d.connectors[cn.id];
  for (const cm of Object.values(d.comments)) if (cm.targetId === cardId) delete d.comments[cm.id];
  delete d.cards[cardId];
}

export function emptyTrash() {
  const doc = getDoc();
  const ids = Object.values(doc.cards).filter((c) => c.deletedAt).map((c) => c.id);
  commit('Empty trash', (d) => ids.forEach((id) => hardDeleteDraft(d, id)));
}

/** Hard-delete anything that has been in the trash for over 30 days. */
export function purgeOldTrash() {
  const doc = getDoc();
  const cutoff = now() - TRASH_DAYS * 86400_000;
  const ids = Object.values(doc.cards).filter((c) => c.deletedAt && c.deletedAt < cutoff).map((c) => c.id);
  if (ids.length) commit('Purge trash', (d) => ids.forEach((id) => hardDeleteDraft(d, id)), { silent: true });
}

// ------------------------------------------------------------------ copy / paste / duplicate

export function copySubtree(placementIds: string[]): SubtreePayload {
  const doc = getDoc();
  const ps = new Map<string, Placement>();
  const cards = new Map<string, Card>();
  const addPlacement = (p: Placement) => {
    ps.set(p.id, p);
    const c = doc.cards[p.cardId];
    if (!c) return;
    cards.set(c.id, c);
    if (c.type === 'column')
      for (const q of Object.values(doc.placements)) if (q.columnId === p.id && !q.deletedAt) addPlacement(q);
    if (c.type === 'database')
      for (const r of Object.values(doc.cards)) if (r.type === 'row' && r.data.databaseId === c.id && !r.deletedAt) cards.set(r.id, r);
    if (c.type === 'board') {
      for (const b of subtreeBoards(doc, c.id)) {
        if (doc.cards[b]) cards.set(b, doc.cards[b]);
        for (const q of Object.values(doc.placements)) if (q.boardId === b && !q.deletedAt && !ps.has(q.id)) addPlacement(q);
      }
    }
  };
  for (const id of placementIds) if (doc.placements[id]) addPlacement(doc.placements[id]);
  const connectors = Object.values(doc.connectors).filter((c) => ps.has(c.from) && ps.has(c.to));
  return { rootId: '', cards: [...cards.values()], placements: [...ps.values()], connectors };
}

/** Insert a copied subtree with fresh ids. Top-level placements land on `boardId`, offset by (dx, dy). */
export function pastePayload(payload: SubtreePayload, boardId: string, dx: number, dy: number, label = 'Paste') {
  const idMap = new Map<string, string>();
  const map = (id: string) => {
    let n = idMap.get(id);
    if (!n) idMap.set(id, (n = uid()));
    return n;
  };
  const cardIds = new Set(payload.cards.map((c) => c.id));
  const placementIds = new Set(payload.placements.map((p) => p.id));
  const remapText = (s: string) => s.replace(/\[\[@([^\]|#]+)/g, (m, id) => (cardIds.has(id) ? '[[@' + map(id) : m));
  const top: string[] = [];
  const t = now();
  commit(label, (d) => {
    let z = topZ(d, boardId);
    const topBoards = new Set(payload.placements.map((p) => p.boardId).filter((b) => !cardIds.has(b)));
    for (const c of payload.cards) {
      const nc: Card = JSON.parse(JSON.stringify(c));
      nc.id = map(c.id);
      nc.text = remapText(nc.text);
      for (const it of nc.data.items ?? []) it.text = remapText(it.text);
      nc.createdAt = nc.updatedAt = t;
      nc.createdBy = nc.updatedBy = me();
      nc.deletedAt = null;
      delete nc.history;
      if (nc.type === 'row' && c.data.databaseId && cardIds.has(c.data.databaseId)) nc.data.databaseId = map(c.data.databaseId);
      for (const [k, v] of Object.entries(nc.data.values ?? {})) if (typeof v === 'string') nc.data.values![k] = remapText(v);
      if (nc.type === 'board') nc.data.parentId = c.data.parentId && cardIds.has(c.data.parentId) ? map(c.data.parentId) : boardId;
      d.cards[nc.id] = nc;
    }
    for (const p of payload.placements) {
      const isTop = topBoards.has(p.boardId);
      const np: Placement = {
        ...p,
        id: map(p.id),
        cardId: cardIds.has(p.cardId) ? map(p.cardId) : p.cardId,
        boardId: isTop ? boardId : map(p.boardId),
        columnId: p.columnId && placementIds.has(p.columnId) ? map(p.columnId) : null,
        x: isTop && !(p.columnId && placementIds.has(p.columnId)) ? p.x + dx : p.x,
        y: isTop && !(p.columnId && placementIds.has(p.columnId)) ? p.y + dy : p.y,
        z: isTop ? z++ : p.z,
        deletedAt: null,
        locked: false,
      };
      d.placements[np.id] = np;
      if (isTop && !np.columnId) top.push(np.id);
    }
    for (const c of payload.connectors)
      d.connectors[map(c.id)] = { ...c, id: map(c.id), from: map(c.from), to: map(c.to), boardId: idMap.has(c.boardId) ? map(c.boardId) : boardId };
  }, { activity: { boardId, text: `pasted ${top.length} item(s)` } });
  setUI({ selection: top });
  return top;
}

let clipboard: SubtreePayload | null = null;
export let lastCopiedText = '';
export function copySelection() {
  const sel = getUI().selection;
  if (!sel.length) return;
  clipboard = copySubtree(sel);
  try {
    const idx = getIndex(getDoc());
    const text = clipboard.cards.map((c) => cardTitle(c) + (c.text && c.text !== c.title ? '\n' + c.text : '')).join('\n\n');
    lastCopiedText = text.replace(/\[\[@([^\]|#]+)/g, (_m, id) => '[[' + (idx.label(id) ?? id));
    void navigator.clipboard?.writeText(lastCopiedText);
  } catch {
    /* clipboard permission denied */
  }
  toast(`Copied ${sel.length} item(s)`);
}
export const hasClipboard = () => !!clipboard;
export function pasteClipboard(at?: { x: number; y: number }) {
  if (!clipboard) return false;
  const tops = clipboard.placements.filter((p) => !clipboard!.cards.some((c) => c.id === p.boardId) && !(p.columnId && clipboard!.placements.some((q) => q.id === p.columnId)));
  const minX = Math.min(...tops.map((p) => p.x));
  const minY = Math.min(...tops.map((p) => p.y));
  const dx = at ? at.x - minX : 30;
  const dy = at ? at.y - minY : 30;
  pastePayload(clipboard, getUI().boardId, dx, dy);
  return true;
}
export function duplicate(ids: string[]) {
  if (!ids.length) return;
  pastePayload(copySubtree(ids), getDoc().placements[ids[0]].boardId, 24, 24, 'Duplicate');
}

// ------------------------------------------------------------------ synced copies & moving

export function placeSynced(cardId: string, boardId: string, x = 0, y = 0) {
  const doc = getDoc();
  const c = doc.cards[cardId];
  if (!c || c.type === 'board' || c.type === 'column') {
    toast('Boards and columns cannot be synced — use a board shortcut instead');
    return;
  }
  const p: Placement = { id: uid(), cardId, boardId, order: now(), x: snap(x), y: snap(y), w: DEFAULT_SIZE[c.type].w, z: topZ(doc, boardId) };
  commit('Place synced copy', (d) => {
    d.placements[p.id] = p;
  }, { activity: { boardId, text: `placed a synced copy of "${cardTitle(c)}"` } });
  toast(`Synced copy placed on "${cardTitle(doc.cards[boardId])}"`);
}

export function createShortcut(targetBoardId: string, boardId: string, x = 0, y = 0) {
  createCard('shortcut', { boardId, x, y, data: { targetBoardId } });
}

export function moveToBoard(placementIds: string[], targetBoardId: string) {
  const doc = getDoc();
  const forbidden = new Set<string>();
  for (const id of placementIds) {
    const c = doc.cards[doc.placements[id]?.cardId];
    if (c?.type === 'board') for (const b of subtreeBoards(doc, c.id)) forbidden.add(b);
  }
  if (forbidden.has(targetBoardId)) {
    toast("Can't move a board into itself");
    return;
  }
  const all = new Set(placementIds);
  for (const id of placementIds) for (const q of Object.values(doc.placements)) if (q.columnId === id) all.add(q.id);
  const from = doc.placements[placementIds[0]]?.boardId;
  commit('Move to board', (d) => {
    let z = topZ(d, targetBoardId);
    let i = 0;
    for (const id of all) {
      const p = d.placements[id];
      if (!p) continue;
      const inMovedColumn = p.columnId && all.has(p.columnId);
      if (!inMovedColumn) {
        p.columnId = null;
        p.x = 40 + (i % 5) * 30;
        p.y = 40 + i * 30;
        i++;
      }
      p.boardId = targetBoardId;
      p.z = z++;
      p.tray = false;
      const c = d.cards[p.cardId];
      if (c?.type === 'board') c.data.parentId = targetBoardId;
    }
    for (const cn of Object.values(d.connectors)) if (all.has(cn.from) !== all.has(cn.to) && (all.has(cn.from) || all.has(cn.to))) delete d.connectors[cn.id];
      else if (all.has(cn.from)) cn.boardId = targetBoardId;
  }, { activity: { boardId: from ?? targetBoardId, text: `moved ${placementIds.length} item(s) to "${cardTitle(doc.cards[targetBoardId])}"` } });
  setUI({ selection: [] });
  toast(`Moved to "${cardTitle(doc.cards[targetBoardId])}"`);
}

export function placeFromTray(placementId: string, x: number, y: number) {
  commit('Place from Unsorted', (d) => {
    const p = d.placements[placementId];
    if (!p) return;
    p.tray = false;
    p.x = snap(x);
    p.y = snap(y);
    p.z = topZ(d, p.boardId);
  });
}

/** Autocomplete "Create new": an empty note in the current board's Unsorted tray. */
export function createLinkTarget(title: string, boardId?: string) {
  const { cardId } = createCard('note', { boardId: boardId ?? getUI().boardId, tray: true, title, select: false });
  toast(`Created "${title}" in Unsorted`);
  return cardId;
}

// ------------------------------------------------------------------ navigation

export function openBoard(boardId: string, opts: { history?: boolean } = {}) {
  const ui = getUI();
  const doc = getDoc();
  if (!doc.cards[boardId] || doc.cards[boardId].type !== 'board') return;
  if (ui.boardId === boardId) return;
  setUI({
    boardId,
    selection: [],
    selectedConnector: null,
    back: opts.history === false ? ui.back : [...ui.back, ui.boardId].slice(-50),
    forward: opts.history === false ? ui.forward : [],
    tagPage: null,
  });
  const userId = ui.userId;
  commit('Visit', (d) => {
    const r = (d.recent[userId] ??= []);
    const i = r.indexOf(boardId);
    if (i >= 0) r.splice(i, 1);
    r.unshift(boardId);
    if (r.length > 15) r.length = 15;
  }, { silent: true });
  try {
    history.replaceState(null, '', '#/board/' + boardId);
  } catch {
    /* sandboxed */
  }
}

export function goBack() {
  const ui = getUI();
  const prev = ui.back[ui.back.length - 1];
  if (!prev) return;
  setUI({ back: ui.back.slice(0, -1), forward: [...ui.forward, ui.boardId] });
  openBoard(prev, { history: false });
}

export function goForward() {
  const ui = getUI();
  const next = ui.forward[ui.forward.length - 1];
  if (!next) return;
  setUI({ forward: ui.forward.slice(0, -1), back: [...ui.back, ui.boardId] });
  openBoard(next, { history: false });
}

/** Navigate to the board holding a card and centre + highlight it. */
export function revealCard(cardId: string, anchor?: string | null) {
  const doc = getDoc();
  const card = doc.cards[cardId];
  if (!card) return;
  const idx = getIndex(doc);
  if (card.deletedAt) {
    toast(`"${cardTitle(card)}" is in the Trash`);
    setUI({ trashOpen: true });
    return;
  }
  if (card.type === 'row') {
    if (card.data.databaseId) revealCard(card.data.databaseId);
    setUI({ rowPage: cardId, focusCard: cardId });
    return;
  }
  if (card.type === 'board' && !idx.placementsByCard.get(cardId)?.length) {
    openBoard(cardId);
    return;
  }
  const ps = idx.placementsByCard.get(cardId) ?? [];
  const p = ps.find((x) => x.boardId === getUI().boardId) ?? ps[0];
  if (!p) return;
  openBoard(p.boardId);
  setUI({ selection: [p.id], highlight: { placementId: p.id, at: now() }, focusCard: cardId });
  if (card.type === 'document' && anchor) setUI({ docEditor: { cardId, anchor } });
}

export function setViewport(boardId: string, v: Viewport) {
  setUI((ui) => ({ viewports: { ...ui.viewports, [boardId]: v } }));
}

// ------------------------------------------------------------------ comments, notifications

export function addComment(targetId: string, body: string, parentId: string | null = null) {
  const doc = getDoc();
  const id = uid();
  const mentions = Object.values(doc.users).filter((u) => new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(body));
  const author = doc.users[me()]?.name ?? 'Someone';
  const boardId = getIndex(doc).homeBoard.get(targetId) ?? targetId;
  commit('Comment', (d) => {
    d.comments[id] = { id, targetId, authorId: me(), body, parentId, createdAt: now(), resolved: false };
    for (const u of mentions)
      if (u.id !== me())
        d.notifications.unshift({ id: uid(), userId: u.id, at: now(), read: false, targetId, text: `${author} mentioned you on "${cardTitle(doc.cards[targetId])}"` });
    // notify the thread author on replies
    if (parentId) {
      const root = d.comments[parentId];
      if (root && root.authorId !== me() && !mentions.some((m) => m.id === root.authorId))
        d.notifications.unshift({ id: uid(), userId: root.authorId, at: now(), read: false, targetId, text: `${author} replied to your comment` });
    }
  }, { activity: { boardId, text: `commented on "${cardTitle(doc.cards[targetId])}"` } });
}

export function resolveComment(id: string, resolved: boolean) {
  commit(resolved ? 'Resolve comment' : 'Reopen comment', (d) => {
    if (d.comments[id]) d.comments[id].resolved = resolved;
  });
}

export function deleteComment(id: string) {
  commit('Delete comment', (d) => {
    for (const c of Object.values(d.comments)) if (c.id === id || c.parentId === id) delete d.comments[c.id];
  });
}

export function markNotificationsRead(userId: string) {
  commit('Read notifications', (d) => {
    for (const n of d.notifications) if (n.userId === userId) n.read = true;
  }, { silent: true });
}

// ------------------------------------------------------------------ members & permissions

export function addMember(name: string, email: string, role: Role) {
  const id = uid();
  const colors = ['#e17055', '#0984e3', '#00b894', '#6c5ce7', '#e84393', '#00cec9', '#fdcb6e'];
  commit('Invite member', (d) => {
    d.users[id] = { id, name, email, color: colors[Object.keys(d.users).length % colors.length] };
    d.members.push({ userId: id, role });
  });
  return id;
}

export function setMemberRole(userId: string, role: Role) {
  commit('Change role', (d) => {
    const m = d.members.find((x) => x.userId === userId);
    if (m) m.role = role;
  });
}

export function removeMember(userId: string) {
  commit('Remove member', (d) => {
    d.members = d.members.filter((m) => m.userId !== userId);
    for (const p of Object.values(d.permissions)) if (p.userId === userId) delete d.permissions[p.id];
  });
}

export function setBoardPermission(boardId: string, userId: string, role: Role | 'none' | null) {
  commit('Change board access', (d) => {
    const existing = Object.values(d.permissions).find((p) => p.boardId === boardId && p.userId === userId);
    if (role === null) {
      if (existing) delete d.permissions[existing.id];
    } else if (existing) existing.role = role;
    else {
      const id = uid();
      d.permissions[id] = { id, boardId, userId, role };
    }
  });
}

export function upsertShareLink(boardId: string, patch: Partial<{ enabled: boolean; password: string; allowDuplicate: boolean }>) {
  commit('Share link', (d) => {
    const l = (d.shareLinks[boardId] ??= { boardId, token: uid().replace(/-/g, '').slice(0, 16), enabled: false, allowDuplicate: false });
    Object.assign(l, patch);
  });
}

export function currentAccess() {
  const doc = getDoc();
  const ui = getUI();
  return makeAccess(doc, ui.shareToken ? 'link:' + ui.shareToken : ui.userId);
}

export function canEditBoard(boardId: string) {
  return canEdit(currentAccess().board(boardId));
}

// ------------------------------------------------------------------ favourites

export function toggleFavorite(boardId: string) {
  const userId = me();
  commit('Favourite', (d) => {
    const f = (d.favorites[userId] ??= []);
    const i = f.indexOf(boardId);
    if (i >= 0) f.splice(i, 1);
    else f.push(boardId);
  }, { silent: true });
}

// ------------------------------------------------------------------ graph settings

export function graphSettingsFor(doc: Workspace, userId: string): GraphSettings {
  return { ...DEFAULT_GRAPH_SETTINGS, ...(doc.graphSettings[userId] ?? {}) };
}

export function saveGraphSettings(patch: Partial<GraphSettings>) {
  const userId = me();
  commit('Graph settings', (d) => {
    d.graphSettings[userId] = { ...DEFAULT_GRAPH_SETTINGS, ...(d.graphSettings[userId] ?? {}), ...patch } as GraphSettings;
  }, { silent: true });
}

export function saveGraphView(name: string) {
  const doc = getDoc();
  const id = uid();
  commit('Save graph view', (d) => {
    d.graphViews[id] = { id, userId: me(), name, settings: graphSettingsFor(doc, me()) };
  }, { silent: true });
  toast(`Saved view "${name}"`);
}

export function deleteGraphView(id: string) {
  commit('Delete graph view', (d) => {
    delete d.graphViews[id];
  }, { silent: true });
}

// ------------------------------------------------------------------ templates

export function saveBoardAsTemplate(boardId: string, name: string) {
  const doc = getDoc();
  const ps = (getIndex(doc).placementsByBoard.get(boardId) ?? []).filter((p) => !p.columnId);
  const payload = copySubtree(ps.map((p) => p.id));
  const id = uid();
  commit('Save template', (d) => {
    d.templates[id] = { id, name, payload: { ...payload, rootId: boardId } };
  }, { silent: true });
  toast(`Saved "${name}" as a template`);
}

export function deleteTemplate(id: string) {
  commit('Delete template', (d) => {
    delete d.templates[id];
  }, { silent: true });
}

/** New board on `parentId` whose content is the template payload. */
export function instantiateTemplate(name: string, icon: string, payload: SubtreePayload, parentId: string, x: number, y: number) {
  const { cardId } = createCard('board', { boardId: parentId, x, y, title: name, data: { icon } });
  pastePayload({ ...payload, placements: payload.placements.map((p) => (p.boardId === payload.rootId ? { ...p, boardId: '__tpl_root__' } : p)) }, cardId, 0, 0, 'Apply template');
  setUI({ selection: [] });
  return cardId;
}

// ------------------------------------------------------------------ databases

export function updateDb(dbId: string, fn: (db: Draft<DbSchema>) => void, key?: string) {
  updateCard(dbId, (c) => {
    c.data.db ??= defaultSchema();
    fn(c.data.db);
  }, key ?? 'db:' + dbId);
}

/** New row (a card without a placement). Returns its id. */
export function addRow(dbId: string, values: Record<string, DbValue> = {}, title = '') {
  const doc = getDoc();
  const rows = getIndex(doc).rowsByDb.get(dbId) ?? [];
  const order = rows.length ? Math.max(...rows.map((r) => r.data.order ?? 0)) + 1 : 1;
  const card = newCard('row', { title, data: { databaseId: dbId, values, order } });
  const boardId = getIndex(doc).homeBoard.get(dbId) ?? getUI().boardId;
  commit('Add row', (d) => {
    d.cards[card.id] = card;
  }, { activity: { boardId, text: `added a row to "${cardTitle(doc.cards[dbId], doc)}"` } });
  return card.id;
}

export function setRowValue(rowId: string, propId: string, value: DbValue) {
  updateCard(rowId, (c) => {
    c.data.values ??= {};
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete c.data.values[propId];
    else c.data.values[propId] = value as never;
  }, `val:${rowId}:${propId}`);
}

export function deleteRows(ids: string[]) {
  const t = now();
  commit('Delete row', (d) => {
    for (const id of ids) if (d.cards[id]) d.cards[id].deletedAt = t;
  });
  toast(`Moved ${ids.length} row(s) to Trash · Cmd/Ctrl+Z to undo`);
}

/** Move a row before another one (manual order), optionally setting a value on the way. */
export function reorderRow(rowId: string, beforeId: string | null, dbId: string) {
  const rows = (getIndex(getDoc()).rowsByDb.get(dbId) ?? []).filter((r) => r.id !== rowId);
  let i = beforeId ? rows.findIndex((r) => r.id === beforeId) : rows.length;
  if (i < 0) i = rows.length;
  const ids = [...rows.slice(0, i).map((r) => r.id), rowId, ...rows.slice(i).map((r) => r.id)];
  commit('Reorder rows', (d) => {
    ids.forEach((id, n) => {
      if (d.cards[id]) d.cards[id].data.order = n + 1;
    });
  });
}
