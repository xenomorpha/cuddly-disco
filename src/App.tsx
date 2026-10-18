import { useEffect, useState } from 'react';
import { getDoc, getUI, loadDoc, redo, replaceDoc, saveNow, setUI, undo, useStore } from './model/store';
import { seedWorkspace } from './model/seed';
import { getIndex } from './model/index';
import {
  canEditBoard, copySelection, duplicate, duplicateEmptyColumn, goBack, goForward, groupIntoColumn, hasClipboard,
  currentAccess, lastCopiedText, movePlacements, openBoard, pasteClipboard, purgeOldTrash, revealCard, toggleLock, trashPlacements,
} from './model/actions';
import { canView } from './model/permissions';
import { useLocale } from './i18n';
import { Canvas, isTyping } from './components/Canvas';
import { Sidebar, Toolbar, Topbar, TOOL_KEYS, addAtCenter } from './components/Chrome';
import { RightPanel } from './components/RightPanel';
import { GlobalGraph } from './components/GraphView';
import { QuickSwitcher, SearchDialog, SettingsDialog, ShareDialog, ShortcutsOverlay, TagPage, TemplatesDialog, TrashDialog } from './components/Dialogs';
import { DocEditor, ListView, PeekPanel, Presentation, ShareGate, Toast } from './components/Views';
import { ContextMenu } from './components/ContextMenu';
import { PickerDialog } from './components/Pickers';
import { handlePaste } from './components/dropImport';
import { t } from './i18n';

async function boot() {
  let doc = await loadDoc();
  if (!doc) {
    const seeded = seedWorkspace();
    await seeded.assets;
    doc = seeded.doc;
  }
  replaceDoc(doc, false);
  let userId = doc.ownerId;
  try {
    const saved = localStorage.getItem('nodeboard:user');
    if (saved && doc.members.some((m) => m.userId === saved)) userId = saved;
  } catch {
    /* ignore */
  }
  const route = parseHash();
  setUI({ userId, boardId: doc.rootBoardId, shareToken: route.share ?? null });
  purgeOldTrash();
  if (route.share) {
    const link = Object.values(doc.shareLinks).find((l) => l.token === route.share);
    if (link) setUI({ boardId: link.boardId });
  } else if (route.board && doc.cards[route.board]?.type === 'board') openBoard(route.board, { history: false });
  else if (route.card && doc.cards[route.card]) setTimeout(() => revealCard(route.card!), 50);
  // make sure the current user can see where they land
  const acc = currentAccess();
  if (!canView(acc.board(getUI().boardId))) {
    const first = Object.values(doc.cards).find((c) => c.type === 'board' && canView(acc.board(c.id)));
    if (first) setUI({ boardId: first.id });
  }
  void saveNow();
}

function parseHash(): { board?: string; card?: string; share?: string } {
  const h = location.hash.replace(/^#\/?/, '');
  const [kind, id] = h.split('/');
  if (kind === 'board') return { board: id };
  if (kind === 'card') return { card: id };
  if (kind === 'share') return { share: id };
  return {};
}

export function App() {
  const doc = useStore((s) => s.doc);
  const ui = useStore((s) => s.ui);
  const [gateOpen, setGateOpen] = useState(false);
  useLocale();

  useEffect(() => {
    void boot();
    const onHash = () => {
      const r = parseHash();
      if (r.board && r.board !== getUI().boardId) openBoard(r.board);
      if (r.card) revealCard(r.card);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = ui.locale;
  }, [ui.locale]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getUI();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const typing = isTyping();
      // global, even while typing
      if (mod && k === 'k') { e.preventDefault(); setUI({ quickSwitcher: !s.quickSwitcher }); return; }
      if (mod && e.shiftKey && k === 'f') { e.preventDefault(); setUI({ search: true }); return; }
      if (mod && !e.shiftKey && k === 'g') { e.preventDefault(); setUI({ globalGraph: !s.globalGraph }); return; }
      if (mod && e.shiftKey && k === 'b') { e.preventDefault(); setUI({ rightPanel: s.rightPanel === 'backlinks' ? null : 'backlinks' }); return; }
      if (typing) return;
      if (e.key === 'Escape') {
        if (s.globalGraph) return setUI({ globalGraph: false });
        if (s.peek) return setUI({ peek: null });
        if (s.tool === 'connect') return setUI({ tool: 'select' });
        if (s.selection.length || s.selectedConnector) return setUI({ selection: [], selectedConnector: null });
        if (s.rightPanel) return setUI({ rightPanel: null });
        return;
      }
      if (s.globalGraph || s.docEditor || s.presenting) return;
      if (document.querySelector('.modal-backdrop')) return;
      const editable = canEditBoard(s.boardId);
      if (mod && k === 'z') { e.preventDefault(); if (!editable) return; e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); if (editable) redo(); return; }
      if (mod && e.key === '[') { e.preventDefault(); goBack(); return; }
      if (mod && e.key === ']') { e.preventDefault(); goForward(); return; }
      if (mod && k === 'a') {
        e.preventDefault();
        const doc0 = getDoc();
        setUI({ selection: (getIndex(doc0).placementsByBoard.get(s.boardId) ?? []).filter((p) => !p.columnId && !p.tray).map((p) => p.id) });
        return;
      }
      if (mod && k === 'c') { if (s.selection.length) { e.preventDefault(); copySelection(); } return; }
      if (!editable) return;
      if (mod && k === 'x') { if (s.selection.length) { e.preventDefault(); copySelection(); trashPlacements(s.selection); } return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(s.selection); return; }
      if (mod && k === 'l') { e.preventDefault(); if (s.selection.length) toggleLock(s.selection); return; }
      if (mod && e.shiftKey && k === 'g') { e.preventDefault(); groupIntoColumn(s.selection); return; }
      if (mod && e.key === 'Enter') {
        const doc0 = getDoc();
        const p = doc0.placements[s.selection[0]];
        if (p && doc0.cards[p.cardId]?.type === 'column') { e.preventDefault(); duplicateEmptyColumn(p.id); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) { e.preventDefault(); trashPlacements(s.selection); return; }
      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const doc0 = getDoc();
        movePlacements(s.selection.map((id) => doc0.placements[id]).filter((p) => p && !p.columnId).map((p) => ({ id: p.id, x: p.x + dx, y: p.y + dy })));
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '?') { setUI({ shortcuts: true }); return; }
      if (e.key === '+' || e.key === '=') return void window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'in' } }));
      if (e.key === '-') return void window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'out' } }));
      if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) return void window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'fit' } }));
      if (e.shiftKey && (e.key === ')' || e.code === 'Digit0')) return void window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'reset' } }));
      if (e.key === 'Enter' && s.selection.length === 1) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('nb:edit', { detail: s.selection[0] }));
        return;
      }
      if (!e.shiftKey && TOOL_KEYS[k]) { e.preventDefault(); addAtCenter(TOOL_KEYS[k]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ paste
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping() || !e.clipboardData) return;
      const s = getUI();
      if (s.globalGraph || s.docEditor || !canEditBoard(s.boardId)) return;
      const text = e.clipboardData.getData('text/plain');
      const vp = s.viewports[s.boardId] ?? { x: 120, y: 90, zoom: 1 };
      const r = document.querySelector('.canvas')?.getBoundingClientRect() ?? { width: 800, height: 600 };
      const at = { x: (r.width / 2 - vp.x) / vp.zoom - 100, y: (r.height / 2 - vp.y) / vp.zoom - 50 };
      if (hasClipboard() && !e.clipboardData.files.length && (!text || text === lastCopiedText)) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      e.preventDefault();
      void handlePaste(e.clipboardData, s.boardId, at.x, at.y);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  if (!doc || !ui.boardId) return <div className="loading">Nodeboard…</div>;
  if (ui.shareToken && !gateOpen) return <ShareGate token={ui.shareToken} onEnter={() => setGateOpen(true)} />;

  const board = doc.cards[ui.boardId];
  const allowed = canView(currentAccess().board(ui.boardId));

  return (
    <div className={'app' + (ui.presenting ? ' presenting' : '') + (ui.sidebarOpen ? ' with-sidebar' : '') + (ui.rightPanel ? ' with-panel' : '') + (ui.peek ? ' with-peek' : '')}>
      {ui.shareToken && <div className="share-banner">{t('Viewing a shared board (read-only)')}</div>}
      {!ui.presenting && <Topbar />}
      <div className="main">
        {!ui.presenting && ui.sidebarOpen && !ui.shareToken && <Sidebar />}
        {!ui.presenting && !ui.listView && <Toolbar />}
        <div className="stage">
          {!allowed ? (
            <div className="empty-board"><p>{t("You don't have access to this board.")}</p><button className="btn" onClick={() => openBoard(doc.rootBoardId)}>{t('Go home')}</button></div>
          ) : board && !board.deletedAt ? (
            ui.listView && !ui.presenting ? <ListView boardId={ui.boardId} /> : <Canvas key={ui.boardId} boardId={ui.boardId} />
          ) : (
            <div className="empty-board"><p>{t('This board was deleted.')}</p><button className="btn" onClick={() => openBoard(doc.rootBoardId)}>{t('Go home')}</button></div>
          )}
        </div>
        {!ui.presenting && ui.peek && <PeekPanel cardId={ui.peek} />}
        {!ui.presenting && <RightPanel />}
      </div>
      {ui.presenting && <Presentation />}
      {ui.globalGraph && <GlobalGraph />}
      {ui.quickSwitcher && <QuickSwitcher />}
      {ui.search && <SearchDialog />}
      {ui.shortcuts && <ShortcutsOverlay />}
      {ui.settingsOpen && <SettingsDialog />}
      {ui.shareOpen && <ShareDialog />}
      {ui.templatesOpen && <TemplatesDialog />}
      {ui.trashOpen && <TrashDialog />}
      {ui.tagPage && <TagPage tag={ui.tagPage} />}
      {ui.docEditor && <DocEditor key={ui.docEditor.cardId} cardId={ui.docEditor.cardId} anchor={ui.docEditor.anchor} />}
      <ContextMenu />
      <PickerDialog />
      <Toast />
    </div>
  );
}
