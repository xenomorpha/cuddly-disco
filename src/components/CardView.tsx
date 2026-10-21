import React, { useContext } from 'react';
import type { Card, Placement } from '../model/types';
import { getUI, setUI, useStore } from '../model/store';
import { getIndex } from '../model/index';
import { openBoard } from '../model/actions';
import { useDoc, useUI } from '../hooks';
import { CanvasContext } from './Canvas';
import { NoteCard, DocumentCard, CommentCard } from './cards/TextCards';
import { TodoCard } from './cards/TodoCard';
import { BoardCard, ColumnCard, ShortcutCard } from './cards/BoardCards';
import { ImageCard, LinkCard, FileCard, MapCard } from './cards/MediaCards';
import { TableCard } from './cards/TableCard';
import { SketchCard } from './cards/SketchCard';
import { SwatchCard } from './cards/SwatchCard';
import { DatabaseView } from './database/DatabaseView';

function DatabaseCard({ card }: BodyProps) {
  return (
    <div className="card-body db-card-body">
      <DatabaseView dbId={card.id} />
    </div>
  );
}
import { Icon } from './icons';
import { Markdown } from './Markdown';
import { t } from '../i18n';

export interface BodyProps {
  card: Card;
  placement: Placement;
  editing: boolean;
  setEditing: (id: string | null) => void;
  readOnly: boolean;
}

const BODIES: Record<string, React.FC<BodyProps>> = {
  note: NoteCard,
  document: DocumentCard,
  comment: CommentCard,
  todo: TodoCard,
  board: BoardCard,
  column: ColumnCard,
  shortcut: ShortcutCard,
  image: ImageCard,
  link: LinkCard,
  file: FileCard,
  map: MapCard,
  table: TableCard,
  sketch: SketchCard,
  swatch: SwatchCard,
  database: DatabaseCard,
};

const TEXT_TYPES = ['note', 'document', 'comment', 'database'];

const INTERACTIVE = 'input, textarea, select, button, a, iframe, audio, video, .interactive, .wiki-editor';

export function CardFrame({ placement: p, inColumn, floating }: { placement: Placement; inColumn?: boolean; floating?: boolean }) {
  const doc = useDoc();
  const ui = useUI();
  const ctx = useContext(CanvasContext);
  const peers = useStore((s) => s.peers);
  const card = doc.cards[p.cardId];
  if (!card) return null;
  const selected = ui.selection.includes(p.id);
  const dragging = !!ctx.drag?.ids.includes(p.id) && !floating;
  const editing = ctx.editing === p.id && !floating;
  const idx = getIndex(doc);
  const backlinks = idx.backlinks.get(card.id)?.length ?? 0;
  const synced = (idx.placementsByCard.get(card.id)?.length ?? 0) > 1;
  const Body = BODIES[card.type] ?? NoteCard;
  const dx = dragging && !ctx.drag?.floating ? ctx.drag!.dx : 0;
  const dy = dragging && !ctx.drag?.floating ? ctx.drag!.dy : 0;
  const peerSel = Object.values(peers).find((pe) => pe.boardId === p.boardId && pe.selection.includes(p.id));
  const resizable = card.type !== 'swatch';
  const hasHeight = p.h !== undefined;

  const style: React.CSSProperties = inColumn
    ? {}
    : {
        transform: `translate(${p.x + dx}px, ${p.y + dy}px)`,
        width: p.w,
        height: p.h,
        zIndex: floating ? 99999 : p.z,
      };
  const colorStyle = card.color && card.type !== 'board' && card.type !== 'column' ? { ['--card-bg' as any]: card.color } : {};

  return (
    <div
      data-placement={p.id}
      data-card={card.id}
      data-drop-board={card.type === 'board' ? card.id : undefined}
      data-drop-column={card.type === 'column' && !floating ? p.id : undefined}
      data-dragging={dragging || floating ? 'true' : undefined}
      className={[
        'card',
        'card-' + card.type,
        inColumn ? 'in-column' : 'free',
        selected ? 'selected' : '',
        editing ? 'editing' : '',
        dragging || floating ? 'dragging' : '',
        p.locked ? 'locked' : '',
        card.color ? 'colored' : '',
        hasHeight ? 'fixed-h' : '',
        ctx.drag?.floating?.id === p.id && !floating ? 'ghost' : '',
      ].join(' ')}
      style={{ ...style, ...colorStyle, ...(peerSel ? { ['--peer' as any]: peerSel.color } : {}) }}
      tabIndex={0}
      role="group"
      aria-label={`${t(card.type)}: ${idx.title(card.id)}`}
      aria-selected={selected}
      onPointerDown={(e) => {
        if (editing) return;
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE) && !target.closest('.drag-handle, .md .tag, .md .wikilink')) {
          // still select on interaction
          if (!selected) setUI({ selection: [p.id], selectedConnector: null, focusCard: card.id });
          return;
        }
        if (target.closest('.card') !== e.currentTarget) return; // nested card (column child) handles itself
        if (getUI().tool === 'connect' && !ctx.readOnly) return ctx.startConnect(e, p);
        ctx.startCardDrag(e, p);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('.card') !== e.currentTarget) return;
        if (card.type === 'board') return openBoard(card.id);
        if (card.type === 'shortcut' && card.data.targetBoardId) return openBoard(card.data.targetBoardId);
        if (card.type === 'document') return setUI({ docEditor: { cardId: card.id } });
        if (!ctx.readOnly && !p.locked) ctx.setEditing(p.id);
      }}
      onKeyDown={(e) => {
        if (editing || (e.target as HTMLElement) !== e.currentTarget) return;
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (card.type === 'board') openBoard(card.id);
          else if (card.type === 'document') setUI({ docEditor: { cardId: card.id } });
          else if (!ctx.readOnly) ctx.setEditing(p.id);
        }
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected && !ui.selection.length) setUI({ selection: [p.id], focusCard: card.id });
      }}
    >
      <Body card={card} placement={p} editing={editing} setEditing={ctx.setEditing} readOnly={ctx.readOnly || !!p.locked} />
      {card.text && !TEXT_TYPES.includes(card.type) && (
        <div className="card-links"><Markdown text={card.text} /></div>
      )}
      {ui.showBadges && backlinks > 0 && (
        <button
          className="backlink-badge"
          title={t('{n} backlinks', { n: backlinks })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setUI({ selection: [p.id], focusCard: card.id, rightPanel: 'backlinks' });
          }}
        >
          <Icon name="backlinks" size={11} /> {backlinks}
        </button>
      )}
      {synced && <span className="synced-badge" title={t('Synced card — shown on several boards')}><Icon name="sync" size={11} /></span>}
      {p.locked && <span className="lock-badge" title={t('Locked')}><Icon name="lock" size={12} /></span>}
      {selected && !inColumn && !ctx.readOnly && !p.locked && !floating && (
        <>
          {resizable && <div className="resize-handle" onPointerDown={(e) => ctx.startResize(e, p, hasHeight ? 'wh' : 'w')} title={t('Resize')} />}
          <div className="connect-handle" onPointerDown={(e) => ctx.startConnect(e, p)} title={t('Drag to connect with a line')} />
        </>
      )}
    </div>
  );
}
