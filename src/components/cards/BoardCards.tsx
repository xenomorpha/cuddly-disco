import type { BodyProps } from '../CardView';
import { CardFrame } from '../CardView';
import { createCard, openBoard, updateCard, updateData } from '../../model/actions';
import { getIndex, cardTitle } from '../../model/index';
import { useAccess, useAssetUrl, useDoc } from '../../hooks';
import { Icon } from '../icons';
import { t } from '../../i18n';

const ICONS = ['📋', '🔬', '🎨', '🗂', '🔒', '💡', '📚', '🚀', '🎯', '🧪', '📝', '🌱', '🏠', '🎙', '📅', '⭐'];
const COVERS = ['', '#74b9ff', '#fd79a8', '#55efc4', '#ffeaa7', '#a29bfe', '#fab1a0', '#b2bec3', '#2d3436'];

export function BoardCard({ card, editing, readOnly }: BodyProps) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const access = useAccess();
  const count = idx.childCount(card.id);
  const cover = useAssetUrl(card.data.cover?.startsWith('asset:') ? card.data.cover.slice(6) : undefined);
  const restricted = !access.canSee(card.id);
  return (
    <div className="card-body board-body">
      <div
        className="board-cover"
        style={{ background: cover ? `center/cover url(${cover})` : card.color || card.data.cover || 'var(--board-cover)' }}
      >
        <span className="board-icon">{restricted ? '🔒' : card.data.icon || '📋'}</span>
      </div>
      {editing && !readOnly ? (
        <div className="interactive board-edit">
          <input
            className="title-input"
            autoFocus
            value={card.title}
            placeholder={t('Board title')}
            onChange={(e) => updateCard(card.id, { title: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="icon-pick">
            {ICONS.map((i) => (
              <button key={i} className={card.data.icon === i ? 'on' : ''} onClick={() => updateData(card.id, { icon: i })}>{i}</button>
            ))}
          </div>
          <div className="swatches">
            {COVERS.map((c) => (
              <button key={c || 'none'} className={'sw' + ((card.color ?? '') === c ? ' on' : '')} style={{ background: c || 'var(--board-cover)' }} onClick={() => updateCard(card.id, { color: c || undefined })} aria-label={c || 'default'} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="card-title">{restricted ? t('Restricted item') : card.title || t('Untitled board')}</div>
          <div className="muted small">{t('{n} items', { n: count })}</div>
          <button className="link-btn" onClick={(e) => { e.stopPropagation(); openBoard(card.id); }}>{t('Open')} →</button>
        </>
      )}
    </div>
  );
}

export function ShortcutCard({ card }: BodyProps) {
  const doc = useDoc();
  const access = useAccess();
  const target = card.data.targetBoardId ? doc.cards[card.data.targetBoardId] : undefined;
  const live = target && getIndex(doc).isLive(target.id);
  const visible = live && access.canSee(target!.id);
  return (
    <div className="card-body shortcut-body">
      <div className="board-cover small" style={{ background: target?.color || 'var(--board-cover)' }}>
        <span className="board-icon">{visible ? target!.data.icon || '📋' : '⛔'}</span>
        <span className="shortcut-arrow"><Icon name="shortcut" size={14} /></span>
      </div>
      <div className="card-title">{!target || !live ? t('Missing board') : visible ? cardTitle(target) : t('Restricted item')}</div>
      <div className="muted small">{t('Board shortcut')}</div>
      {visible && <button className="link-btn" onClick={(e) => { e.stopPropagation(); openBoard(target!.id); }}>{t('Open')} →</button>}
    </div>
  );
}

export function ColumnCard({ card, placement, editing, readOnly }: BodyProps) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const children = (idx.placementsByBoard.get(placement.boardId) ?? [])
    .filter((p) => p.columnId === placement.id)
    .sort((a, b) => a.order - b.order);
  const collapsed = !!card.data.collapsed;
  return (
    <div className="card-body column-wrap" style={card.color ? { background: card.color + '33' } : undefined}>
      <div className="column-head">
        {editing && !readOnly ? (
          <input className="title-input" autoFocus value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        ) : (
          <div className="card-title">{card.title || t('Column')}</div>
        )}
        <span className="muted small">{children.length}</span>
        <button
          className="icon-btn"
          aria-label={collapsed ? t('Expand') : t('Collapse')}
          title={collapsed ? t('Expand') : t('Collapse')}
          onClick={(e) => { e.stopPropagation(); updateData(card.id, { collapsed: !collapsed }); }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div className="column-body">
          {children.map((p) => <CardFrame key={p.id} placement={p} inColumn />)}
          {!children.length && <div className="column-empty muted small">{t('Drag cards here')}</div>}
        </div>
      )}
      {!collapsed && !readOnly && (
        <button
          className="link-btn add-item"
          onClick={(e) => {
            e.stopPropagation();
            const { placementId } = createCard('note', { boardId: placement.boardId, columnId: placement.id, order: Date.now() });
            requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('nb:edit', { detail: placementId })));
          }}
        >
          + {t('Add note')}
        </button>
      )}
    </div>
  );
}
