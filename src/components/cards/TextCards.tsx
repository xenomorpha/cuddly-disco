import { useState } from 'react';
import type { BodyProps } from '../CardView';
import { Markdown } from '../Markdown';
import { WikiEditor } from '../WikiEditor';
import { addComment, updateCard, currentAccess } from '../../model/actions';
import { canComment } from '../../model/permissions';
import { useDoc } from '../../hooks';
import { setUI } from '../../model/store';
import { headings } from '../../model/links';
import { Icon } from '../icons';
import { t } from '../../i18n';
import { CommentThread } from '../CommentThread';

export function toggleChecklistLine(text: string, line: number) {
  const lines = text.split('\n');
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

export function NoteCard({ card, editing, setEditing, readOnly }: BodyProps) {
  if (editing)
    return (
      <div className="card-body note-body">
        <WikiEditor
          value={card.text}
          onChange={(text) => updateCard(card.id, { text })}
          selfId={card.id}
          autoFocus
          toolbar
          minRows={3}
          placeholder={t('Type something… [[ to link, # to tag')}
          onDone={() => setEditing(null)}
        />
      </div>
    );
  return (
    <div className="card-body note-body">
      {card.title && !/^#{1,3}\s/.test(card.text) && card.text.split('\n')[0].replace(/^#+\s*/, '') !== card.title && <div className="card-title">{card.title}</div>}
      {card.text ? (
        <Markdown text={card.text} onToggleCheck={readOnly ? undefined : (l) => updateCard(card.id, { text: toggleChecklistLine(card.text, l) })} />
      ) : (
        <div className="placeholder">{card.title ? '' : readOnly ? t('Empty note') : t('Double-click to write')}</div>
      )}
    </div>
  );
}

export function DocumentCard({ card }: BodyProps) {
  const hs = headings(card.text);
  const words = card.text.trim() ? card.text.trim().split(/\s+/).length : 0;
  return (
    <div className="card-body doc-body">
      <div className="doc-icon"><Icon name="document" size={28} /></div>
      <div className="doc-meta">
        <div className="card-title">{card.title || t('Untitled document')}</div>
        <div className="muted small">{t('{n} words', { n: words })}{hs.length ? ` · ${hs.length} ${t('sections')}` : ''}</div>
        <button className="link-btn" onClick={(e) => { e.stopPropagation(); setUI({ docEditor: { cardId: card.id } }); }}>{t('Open')}</button>
      </div>
    </div>
  );
}

export function CommentCard({ card, editing, setEditing, readOnly }: BodyProps) {
  const doc = useDoc();
  const [draft, setDraft] = useState('');
  const root = Object.values(doc.comments).filter((c) => c.targetId === card.id);
  const allowed = canComment(currentAccess().card(card.id));
  const resolved = !!card.data.resolved;
  return (
    <div className={'card-body comment-body' + (resolved ? ' resolved' : '')}>
      <div className="comment-head">
        <Icon name="comment" size={14} /> <strong>{card.title || t('Comment')}</strong>
        {!readOnly && (
          <button className="link-btn" onClick={(e) => { e.stopPropagation(); updateCard(card.id, (c) => { c.data.resolved = !resolved; }); }}>
            {resolved ? t('Reopen') : t('Resolve')}
          </button>
        )}
      </div>
      {editing && !root.length ? (
        <div className="interactive">
          <WikiEditor value={draft} onChange={setDraft} autoFocus minRows={2} placeholder={t('Write a comment… @mention, [[link]]')} onDone={() => setEditing(null)} />
          <button className="btn small primary" disabled={!draft.trim()} onClick={() => { addComment(card.id, draft); setDraft(''); setEditing(null); }}>{t('Post')}</button>
        </div>
      ) : (
        <CommentThread targetId={card.id} compact canPost={allowed} />
      )}
      {resolved && <div className="muted small">{t('Resolved')}</div>}
    </div>
  );
}
