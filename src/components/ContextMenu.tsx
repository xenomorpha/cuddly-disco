import { useEffect } from 'react';
import { create } from 'zustand';
import { getDoc, getUI, setUI } from '../model/store';
import {
  canEditBoard, copySelection, createCard, duplicate, duplicateEmptyColumn, groupIntoColumn, hasClipboard,
  openBoard, pasteClipboard, toggleLock, trashPlacements, updateData,
} from '../model/actions';
import type { CardType } from '../model/types';
import { addShortcut, copyCardLink, linkTo, moveTo, openComments, openInfo, openInGraph, showBacklinks, syncedCopy } from './commands';
import { suggestPaletteFromBoard } from './cards/SwatchCard';
import { t } from '../i18n';

interface MenuReq {
  x: number;
  y: number;
  kind: 'card' | 'canvas';
  placementId?: string;
  world: { x: number; y: number };
  setEditing: (id: string | null) => void;
}

const useMenu = create<{ req: MenuReq | null }>(() => ({ req: null }));
export const openContextMenu = (req: MenuReq) => useMenu.setState({ req });
const close = () => useMenu.setState({ req: null });

type Item = { label: string; run: () => void; hint?: string; danger?: boolean } | 'sep';

export function ContextMenu() {
  const req = useMenu((s) => s.req);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  const doc = getDoc();
  const ui = getUI();
  const editable = canEditBoard(ui.boardId);
  const items: Item[] = [];
  if (req.kind === 'card' && req.placementId) {
    const p = doc.placements[req.placementId];
    const c = doc.cards[p.cardId];
    const sel = ui.selection.length ? ui.selection : [p.id];
    if (c.type === 'board') items.push({ label: t('Open board'), run: () => openBoard(c.id) });
    if (c.type === 'document') items.push({ label: t('Open document'), run: () => setUI({ docEditor: { cardId: c.id } }) });
    if (editable && c.type !== 'board' && c.type !== 'document') items.push({ label: t('Edit'), hint: 'Enter', run: () => req.setEditing(p.id) });
    items.push({ label: t('Show backlinks'), hint: '⇧⌘B', run: () => showBacklinks(c.id) });
    items.push({ label: t('Open in graph'), run: () => openInGraph(c.id) });
    items.push({ label: t('Comments'), run: () => openComments(c.id) });
    items.push({ label: t('Copy link to card'), run: () => copyCardLink(c.id) });
    items.push({ label: t('Info & history'), run: () => openInfo(c.id) });
    if (editable) {
      items.push('sep');
      items.push({ label: t('Link to…'), run: () => linkTo(c.id) });
      items.push({ label: t('Copy'), hint: '⌘C', run: () => copySelection() });
      items.push({ label: t('Duplicate'), hint: '⌘D', run: () => duplicate(sel) });
      items.push({ label: p.locked ? t('Unlock') : t('Lock'), run: () => toggleLock(sel) });
      items.push({ label: t('Move to…'), run: () => moveTo(sel) });
      if (c.type !== 'board' && c.type !== 'column') items.push({ label: t('Place synced copy…'), run: () => syncedCopy(c.id) });
      if (sel.length > 1) items.push({ label: t('Group selection into column'), run: () => groupIntoColumn(sel) });
      if (c.type === 'column') {
        items.push({ label: c.data.collapsed ? t('Expand') : t('Collapse'), run: () => updateData(c.id, { collapsed: !c.data.collapsed }) });
        items.push({ label: t('Duplicate empty column'), hint: '⌘↵', run: () => duplicateEmptyColumn(p.id) });
      }
      items.push('sep');
      items.push({ label: t('Delete'), hint: 'Del', danger: true, run: () => trashPlacements(sel) });
    }
  } else {
    const add = (type: CardType, label: string) => ({
      label,
      run: () => {
        const { placementId } = createCard(type, { x: req.world.x, y: req.world.y });
        if (['note', 'todo', 'board', 'column', 'link', 'table'].includes(type)) req.setEditing(placementId);
      },
    });
    if (editable) {
      if (hasClipboard()) items.push({ label: t('Paste'), hint: '⌘V', run: () => pasteClipboard(req.world) });
      items.push(add('note', t('Add note')), add('todo', t('Add to-do list')), add('board', t('Add board')), add('column', t('Add column')), add('document', t('Add document')), add('database', t('Add database')));
      items.push({ label: t('Add board shortcut…'), run: () => addShortcut(ui.boardId, req.world.x, req.world.y) });
      items.push({ label: t('Suggest palette from board images'), run: () => void suggestPaletteFromBoard(ui.boardId, req.world.x, req.world.y) });
      items.push('sep');
    }
    items.push({
      label: t('Select all'),
      hint: '⌘A',
      run: () => setUI({ selection: Object.values(doc.placements).filter((p) => p.boardId === ui.boardId && !p.deletedAt && !p.columnId && !p.tray).map((p) => p.id) }),
    });
    items.push({ label: t('Zoom to fit'), hint: '⇧1', run: () => window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'fit' } })) });
    items.push({ label: t('Present board'), run: () => setUI({ presenting: true }) });
  }
  const left = Math.min(req.x, window.innerWidth - 240);
  const top = Math.min(req.y, window.innerHeight - items.length * 30 - 20);
  return (
    <div className="ctx-backdrop" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div className="menu context-menu" style={{ left, top: Math.max(8, top) }} onPointerDown={(e) => e.stopPropagation()} role="menu">
        {items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { close(); it.run(); }}>
              <span>{it.label}</span>
              {it.hint && <span className="hint">{it.hint}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
