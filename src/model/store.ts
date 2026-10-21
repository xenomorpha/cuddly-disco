// Local-first store: the whole workspace document lives in memory, every edit
// is an immer recipe that yields patches. Patches give us
//   - undo/redo (inverse patches, 200 steps),
//   - real-time sync between tabs/windows (BroadcastChannel),
//   - debounced persistence to IndexedDB (offline by default).
// A server-backed deployment would forward the same patches over a WebSocket
// (or swap this layer for Yjs) — see docs/ARCHITECTURE.md.

import { create } from 'zustand';
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch, setAutoFreeze } from 'immer';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Workspace } from './types';

enablePatches();
setAutoFreeze(true);

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  key?: string;
  at: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type Panel = 'backlinks' | 'localGraph' | 'comments' | 'activity' | 'info' | null;

export interface UIState {
  boardId: string;
  userId: string; // who we're acting as (for permission demo)
  selection: string[]; // placement ids
  selectedConnector: string | null;
  focusCard: string | null; // card shown in side panels when nothing selected on canvas
  rightPanel: Panel;
  globalGraph: boolean;
  quickSwitcher: boolean;
  search: boolean;
  shortcuts: boolean;
  settingsOpen: boolean;
  shareOpen: boolean;
  templatesOpen: boolean;
  trashOpen: boolean;
  tagPage: string | null;
  docEditor: { cardId: string; anchor?: string | null } | null;
  rowPage: string | null; // database row opened as a page
  dbPage: string | null; // database opened full screen
  peek: string | null; // card opened side-by-side (Cmd+click on a link)
  presenting: boolean;
  listView: boolean;
  highlight: { placementId: string; at: number } | null;
  viewports: Record<string, Viewport>;
  back: string[];
  forward: string[];
  snap: boolean;
  showBadges: boolean;
  minimap: boolean;
  showDots: boolean;
  locale: 'en' | 'ru';
  theme: 'light' | 'dark' | 'system';
  tool: 'select' | 'connect';
  shareToken: string | null; // when opened through a public link
  toast: { text: string; at: number } | null;
}

interface StoreState {
  doc: Workspace | null;
  ui: UIState;
  past: HistoryEntry[];
  future: HistoryEntry[];
  peers: Record<string, Peer>;
}

export interface Peer {
  tab: string;
  name: string;
  color: string;
  boardId: string;
  x: number;
  y: number;
  selection: string[];
  at: number;
}

const HISTORY_LIMIT = 200;
const TAB_ID = uid();

const savedPrefs = (() => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem('nodeboard:prefs') || '{}');
  } catch {
    return {};
  }
})();

const initialUI: UIState = {
  boardId: '',
  userId: '',
  selection: [],
  selectedConnector: null,
  focusCard: null,
  rightPanel: null,
  globalGraph: false,
  quickSwitcher: false,
  search: false,
  shortcuts: false,
  settingsOpen: false,
  shareOpen: false,
  templatesOpen: false,
  trashOpen: false,
  tagPage: null,
  docEditor: null,
  rowPage: null,
  dbPage: null,
  peek: null,
  presenting: false,
  listView: false,
  highlight: null,
  viewports: {},
  back: [],
  forward: [],
  snap: savedPrefs.snap ?? false,
  showBadges: savedPrefs.showBadges ?? true,
  minimap: savedPrefs.minimap ?? false,
  showDots: savedPrefs.showDots ?? true,
  locale: savedPrefs.locale ?? (globalThis.navigator?.language?.startsWith('ru') ? 'ru' : 'en'),
  theme: savedPrefs.theme ?? 'light',
  tool: 'select',
  shareToken: null,
  toast: null,
};

export const useStore = create<StoreState>(() => ({
  doc: null,
  ui: initialUI,
  past: [],
  future: [],
  peers: {},
}));

export const getDoc = () => useStore.getState().doc!;

/** set when a canvas drag ends, so the click that follows doesn't open a link */
export const dragClock = { lastEnd: 0 };
export const justDragged = () => Date.now() - dragClock.lastEnd < 350;
export const getUI = () => useStore.getState().ui;

export function setUI(patch: Partial<UIState> | ((ui: UIState) => Partial<UIState>)) {
  useStore.setState((s) => {
    const p = typeof patch === 'function' ? patch(s.ui) : patch;
    const ui = { ...s.ui, ...p };
    if ('snap' in p || 'showBadges' in p || 'minimap' in p || 'locale' in p || 'theme' in p || 'showDots' in p) {
      try {
        localStorage.setItem(
          'nodeboard:prefs',
          JSON.stringify({ snap: ui.snap, showBadges: ui.showBadges, minimap: ui.minimap, locale: ui.locale, theme: ui.theme, showDots: ui.showDots }),
        );
      } catch {
        /* storage unavailable */
      }
    }
    return { ui };
  });
}

export function toast(text: string) {
  setUI({ toast: { text, at: Date.now() } });
}

// ------------------------------------------------------------------ commits

export interface CommitOptions {
  /** consecutive commits with the same key within 1.5 s merge into one undo step */
  key?: string;
  /** add an activity feed entry */
  activity?: { boardId: string; text: string };
  /** skip undo history (e.g. selection-like bookkeeping) */
  silent?: boolean;
}

export function commit(label: string, recipe: (d: Draft<Workspace>) => void, opts: CommitOptions = {}) {
  const s = useStore.getState();
  if (!s.doc) return;
  const [next, patches, inverse] = produceWithPatches(s.doc, (d) => {
    recipe(d);
    if (opts.activity) {
      d.activity.unshift({ id: uid(), boardId: opts.activity.boardId, userId: s.ui.userId, at: Date.now(), text: opts.activity.text });
      if (d.activity.length > 500) d.activity.length = 500;
    }
  });
  if (!patches.length) return;
  let past = s.past;
  if (!opts.silent) {
    const last = past[past.length - 1];
    const now = Date.now();
    if (opts.key && last && last.key === opts.key && now - last.at < 1500) {
      past = [...past.slice(0, -1), { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now }];
    } else {
      past = [...past, { label, patches, inverse, key: opts.key, at: now }].slice(-HISTORY_LIMIT);
    }
  }
  useStore.setState({ doc: next, past, future: opts.silent ? s.future : [] });
  broadcast({ type: 'patches', patches });
  scheduleSave();
}

export function undo() {
  const s = useStore.getState();
  const e = s.past[s.past.length - 1];
  if (!s.doc || !e) return;
  try {
    const doc = applyPatches(s.doc, e.inverse);
    useStore.setState({ doc, past: s.past.slice(0, -1), future: [...s.future, e] });
    broadcast({ type: 'patches', patches: e.inverse });
    scheduleSave();
    toast('Undo: ' + e.label);
  } catch {
    useStore.setState({ past: s.past.slice(0, -1) });
  }
}

export function redo() {
  const s = useStore.getState();
  const e = s.future[s.future.length - 1];
  if (!s.doc || !e) return;
  try {
    const doc = applyPatches(s.doc, e.patches);
    useStore.setState({ doc, future: s.future.slice(0, -1), past: [...s.past, e] });
    broadcast({ type: 'patches', patches: e.patches });
    scheduleSave();
    toast('Redo: ' + e.label);
  } catch {
    useStore.setState({ future: s.future.slice(0, -1) });
  }
}

// ------------------------------------------------------------------ persistence

const DOC_KEY = 'nodeboard:workspace';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export let lastSavedAt = 0;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export async function saveNow() {
  const doc = useStore.getState().doc;
  if (!doc || useStore.getState().ui.shareToken) return;
  try {
    await idbSet(DOC_KEY, doc);
    lastSavedAt = Date.now();
  } catch (e) {
    console.error('save failed', e);
  }
}

export async function loadDoc(): Promise<Workspace | null> {
  try {
    return ((await idbGet(DOC_KEY)) as Workspace) ?? null;
  } catch {
    return null;
  }
}

export function replaceDoc(doc: Workspace, broadcastIt = true) {
  useStore.setState({ doc, past: [], future: [] });
  if (broadcastIt) broadcast({ type: 'replace', doc });
  scheduleSave();
}

// assets (images, files, audio) live in IndexedDB as blobs
const urlCache = new Map<string, string>();

export async function putAsset(id: string, blob: Blob) {
  await idbSet('asset:' + id, blob);
  urlCache.set(id, URL.createObjectURL(blob));
  broadcast({ type: 'asset', id });
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  return ((await idbGet('asset:' + id)) as Blob) ?? null;
}

export async function assetUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getAssetBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export const cachedAssetUrl = (id: string) => urlCache.get(id) ?? null;

// ------------------------------------------------------------------ cross-tab sync + presence

type Msg =
  | { type: 'patches'; patches: Patch[] }
  | { type: 'replace'; doc: Workspace }
  | { type: 'asset'; id: string }
  | { type: 'presence'; peer: Peer }
  | { type: 'bye'; tab: string }
  | { type: 'hello' };

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined' ? new BroadcastChannel('nodeboard') : null;

function broadcast(m: Msg) {
  try {
    channel?.postMessage(m);
  } catch {
    /* non-cloneable payload; ignore */
  }
}

const PRESENCE_NAMES = ['Otter', 'Heron', 'Lynx', 'Marten', 'Ibis', 'Fox', 'Wren', 'Koala'];
const PRESENCE_COLORS = ['#e17055', '#0984e3', '#00b894', '#6c5ce7', '#fdcb6e', '#e84393', '#00cec9'];
export const me = {
  tab: TAB_ID,
  name: PRESENCE_NAMES[Math.floor(Math.random() * PRESENCE_NAMES.length)],
  color: PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)],
};

let lastPresence = 0;
export function sendPresence(x: number, y: number) {
  const now = Date.now();
  if (now - lastPresence < 40) return;
  lastPresence = now;
  const ui = getUI();
  const doc = getDoc();
  const user = doc?.users[ui.userId];
  broadcast({
    type: 'presence',
    peer: { ...me, name: user ? `${user.name} (${me.name})` : me.name, boardId: ui.boardId, x, y, selection: ui.selection, at: now },
  });
}

if (channel) {
  channel.onmessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data;
    const s = useStore.getState();
    if (m.type === 'patches' && s.doc) {
      try {
        useStore.setState({ doc: applyPatches(s.doc, m.patches) });
      } catch (e) {
        console.warn('could not apply remote patches', e);
      }
    } else if (m.type === 'replace') {
      useStore.setState({ doc: m.doc, past: [], future: [] });
    } else if (m.type === 'asset') {
      urlCache.delete(m.id);
      void assetUrl(m.id).then(() => useStore.setState({ doc: useStore.getState().doc && { ...useStore.getState().doc! } }));
    } else if (m.type === 'presence') {
      useStore.setState({ peers: { ...s.peers, [m.peer.tab]: m.peer } });
    } else if (m.type === 'bye') {
      const peers = { ...s.peers };
      delete peers[m.tab];
      useStore.setState({ peers });
    } else if (m.type === 'hello') {
      sendPresence(0, 0);
    }
  };
  broadcast({ type: 'hello' });
  window.addEventListener('beforeunload', () => {
    broadcast({ type: 'bye', tab: TAB_ID });
    void saveNow();
  });
  setInterval(() => {
    const s = useStore.getState();
    const now = Date.now();
    const stale = Object.values(s.peers).filter((p) => now - p.at > 30000);
    if (stale.length) {
      const peers = { ...s.peers };
      for (const p of stale) delete peers[p.tab];
      useStore.setState({ peers });
    }
  }, 5000);
}
