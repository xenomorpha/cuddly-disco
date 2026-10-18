import { useState } from 'react';
import { getIndex } from '../model/index';
import { canEditBoard, placeFromTray, trashPlacements } from '../model/actions';
import { getUI } from '../model/store';
import { useDoc } from '../hooks';
import { CardTypeIcon, Icon } from './icons';
import { t } from '../i18n';

/** "Unsorted" inbox (spec §6): captured or auto-created cards wait here until placed. */
export function UnsortedTray({ boardId }: { boardId: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const items = (idx.placementsByBoard.get(boardId) ?? []).filter((p) => p.tray);
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const editable = canEditBoard(boardId);
  const place = (pid: string, i: number) => {
    const vp = getUI().viewports[boardId] ?? { x: 120, y: 90, zoom: 1 };
    const el = document.querySelector('.canvas')!.getBoundingClientRect();
    placeFromTray(pid, (el.width / 2 - vp.x) / vp.zoom - 100 + i * 20, (el.height / 2 - vp.y) / vp.zoom - 40 + i * 20);
  };
  return (
    <div className={'tray' + (open ? ' open' : '')} onPointerDown={(e) => e.stopPropagation()} aria-label={t('Unsorted')}>
      <button className="tray-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="inbox" size={15} /> {t('Unsorted')} <span className="count">{items.length}</span> <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tray-items">
          {items.map((p, i) => {
            const c = doc.cards[p.cardId];
            return (
              <div
                key={p.id}
                className="tray-item"
                draggable={editable}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-nodeboard-placement', p.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                title={t('Drag onto the board')}
              >
                <CardTypeIcon type={c.type} />
                <span className="tray-title">{idx.title(c.id)}</span>
                {editable && (
                  <>
                    <button className="icon-btn" title={t('Place on board')} onClick={() => place(p.id, i)}>↧</button>
                    <button className="icon-btn" title={t('Delete')} onClick={() => trashPlacements([p.id])}>×</button>
                  </>
                )}
              </div>
            );
          })}
          {editable && items.length > 1 && (
            <button className="link-btn" onClick={() => items.forEach((p, i) => place(p.id, i))}>{t('Place all')}</button>
          )}
        </div>
      )}
    </div>
  );
}
