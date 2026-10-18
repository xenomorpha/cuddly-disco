// Contextual toolbar above the selected card(s) or connector.

import { useLayoutEffect, useState } from 'react';
import type { Viewport } from '../model/store';
import { getIndex } from '../model/index';
import {
  canEditBoard, deleteConnector, duplicate, groupIntoColumn, toggleLock, trashPlacements, updateCard, updateConnector,
} from '../model/actions';
import { useDoc, useUI } from '../hooks';
import { Icon } from './icons';
import { copyCardLink, linkTo, moveTo, openComments, openInfo, openInGraph, showBacklinks, syncedCopy } from './commands';
import { t } from '../i18n';

export const CARD_COLORS = ['', '#ffeaa7', '#fab1a0', '#ff7675', '#fd79a8', '#a29bfe', '#74b9ff', '#81ecec', '#55efc4', '#dfe6e9', '#2d3436'];

export function SelectionToolbar({
  boardId,
  vp,
  measure,
  setEditing,
}: {
  boardId: string;
  vp: Viewport;
  measure: (pid: string) => { x: number; y: number; w: number; h: number } | null;
  setEditing: (id: string | null) => void;
}) {
  const doc = useDoc();
  const ui = useUI();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [colors, setColors] = useState(false);
  const sel = ui.selection.filter((id) => doc.placements[id]?.boardId === boardId && !doc.placements[id]?.deletedAt);
  const conn = ui.selectedConnector ? doc.connectors[ui.selectedConnector] : null;

  useLayoutEffect(() => {
    if (!sel.length) return setPos(null);
    const rs = sel.map(measure).filter(Boolean) as { x: number; y: number; w: number; h: number }[];
    if (!rs.length) return setPos(null);
    const minX = Math.min(...rs.map((r) => r.x));
    const maxX = Math.max(...rs.map((r) => r.x + r.w));
    const minY = Math.min(...rs.map((r) => r.y));
    const next = { x: ((minX + maxX) / 2) * vp.zoom + vp.x, y: minY * vp.zoom + vp.y };
    setPos((p) => (p && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 ? p : next));
  });
  useLayoutEffect(() => setColors(false), [sel.join()]);

  if (conn) {
    return (
      <div className="selection-toolbar connector-toolbar" style={{ left: '50%', top: 12, transform: 'translateX(-50%)' }} onPointerDown={(e) => e.stopPropagation()}>
        <span className="muted small">{t('Line')}</span>
        <button className={conn.style.curved ? 'on' : ''} onClick={() => updateConnector(conn.id, (c) => { c.style.curved = true; })} title={t('Curved')}>⤳</button>
        <button className={!conn.style.curved ? 'on' : ''} onClick={() => updateConnector(conn.id, (c) => { c.style.curved = false; })} title={t('Straight')}>⟶</button>
        <button className={conn.style.arrowStart ? 'on' : ''} onClick={() => updateConnector(conn.id, (c) => { c.style.arrowStart = !c.style.arrowStart; })} title={t('Arrow at start')}>◀</button>
        <button className={conn.style.arrowEnd ? 'on' : ''} onClick={() => updateConnector(conn.id, (c) => { c.style.arrowEnd = !c.style.arrowEnd; })} title={t('Arrow at end')}>▶</button>
        <button className={conn.style.dashed ? 'on' : ''} onClick={() => updateConnector(conn.id, (c) => { c.style.dashed = !c.style.dashed; })} title={t('Dashed')}>┄</button>
        {['#636e72', '#d63031', '#0984e3', '#00b894', '#6c5ce7', '#fdcb6e'].map((c) => (
          <button key={c} className={'sw' + (conn.style.color === c ? ' on' : '')} style={{ background: c }} onClick={() => updateConnector(conn.id, (x) => { x.style.color = c; })} aria-label={c} />
        ))}
        <input
          className="connector-label-input"
          value={conn.label}
          placeholder={t('Label')}
          onChange={(e) => updateConnector(conn.id, { label: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button onClick={() => deleteConnector(conn.id)} title={t('Delete line')}><Icon name="trash" size={15} /></button>
      </div>
    );
  }

  if (!sel.length || !pos) return null;
  const first = doc.placements[sel[0]];
  const card = doc.cards[first.cardId];
  const single = sel.length === 1;
  const backlinks = single ? getIndex(doc).backlinks.get(card.id)?.length ?? 0 : 0;
  const locked = sel.every((id) => doc.placements[id]?.locked);
  const comments = single ? Object.values(doc.comments).filter((c) => c.targetId === card.id).length : 0;
  const readOnly = !canEditBoard(boardId);

  if (readOnly)
    return (
      <div className="selection-toolbar" style={{ left: pos.x, top: Math.max(8, pos.y - 46) }} onPointerDown={(e) => e.stopPropagation()} role="toolbar">
        {single && <span className="muted small type-label">{t(card.type)}</span>}
        {single && <button onClick={() => showBacklinks(card.id)} title={t('Backlinks')} className="with-count"><Icon name="backlinks" size={15} /> {backlinks}</button>}
        {single && <button onClick={() => openInGraph(card.id)} title={t('Open in graph')}><Icon name="graph" size={15} /></button>}
        {single && <button onClick={() => openComments(card.id)} title={t('Comments')} className="with-count"><Icon name="comment" size={15} />{comments ? ' ' + comments : ''}</button>}
        {single && <button onClick={() => copyCardLink(card.id)} title={t('Copy link to card')}><Icon name="share" size={15} /></button>}
      </div>
    );

  return (
    <div
      className="selection-toolbar"
      style={{ left: pos.x, top: Math.max(8, pos.y - 46) }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={t('Card actions')}
    >
      {single && <span className="muted small type-label">{t(card.type)}</span>}
      <div className="color-pop">
        <button onClick={() => setColors((c) => !c)} title={t('Colour')}><span className="sw" style={{ background: card.color || 'var(--card)' }} /></button>
        {colors && (
          <div className="color-menu">
            {CARD_COLORS.map((c) => (
              <button
                key={c || 'none'}
                className={'sw' + ((card.color ?? '') === c ? ' on' : '')}
                style={{ background: c || 'var(--card)' }}
                aria-label={c || t('Default')}
                onClick={() => sel.forEach((pid) => updateCard(doc.placements[pid].cardId, { color: c || undefined }, 'color'))}
              />
            ))}
          </div>
        )}
      </div>
      {single && card.type !== 'board' && card.type !== 'document' && (
        <button onClick={() => setEditing(first.id)} title={t('Edit') + ' (Enter)'}>✎</button>
      )}
      {single && (
        <button onClick={() => showBacklinks(card.id)} title={t('Backlinks') + ' (Cmd/Ctrl+Shift+B)'} className="with-count">
          <Icon name="backlinks" size={15} /> {backlinks}
        </button>
      )}
      {single && <button onClick={() => linkTo(card.id)} title={t('Link to…')}><Icon name="link" size={15} /></button>}
      {single && <button onClick={() => openInGraph(card.id)} title={t('Open in graph')}><Icon name="graph" size={15} /></button>}
      {single && <button onClick={() => openComments(card.id)} title={t('Comments')} className="with-count"><Icon name="comment" size={15} />{comments ? ' ' + comments : ''}</button>}
      <span className="sep" />
      <button onClick={() => duplicate(sel)} title={t('Duplicate') + ' (Cmd/Ctrl+D)'}>⧉</button>
      <button className={locked ? 'on' : ''} onClick={() => toggleLock(sel)} title={locked ? t('Unlock') : t('Lock')}><Icon name="lock" size={15} /></button>
      {sel.length > 1 && <button onClick={() => groupIntoColumn(sel)} title={t('Group selection into column')}><Icon name="column" size={15} /></button>}
      <MoreMenu sel={sel} cardId={card.id} single={single} />
      <button onClick={() => trashPlacements(sel)} title={t('Delete') + ' (Del)'}><Icon name="trash" size={15} /></button>
    </div>
  );
}

function MoreMenu({ sel, cardId, single }: { sel: string[]; cardId: string; single: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more-pop">
      <button onClick={() => setOpen((o) => !o)} title={t('More')} aria-expanded={open}>⋯</button>
      {open && (
        <div className="menu" onClick={() => setOpen(false)}>
          <button onClick={() => moveTo(sel)}>{t('Move to…')}</button>
          {single && <button onClick={() => syncedCopy(cardId)}>{t('Place synced copy…')}</button>}
          {single && <button onClick={() => copyCardLink(cardId)}>{t('Copy link to card')}</button>}
          {single && <button onClick={() => openInfo(cardId)}>{t('Info & history')}</button>}
          <button onClick={() => window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'selection' } }))}>{t('Zoom to selection')}</button>
        </div>
      )}
    </div>
  );
}
