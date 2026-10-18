import { useState } from 'react';
import { addComment, deleteComment, resolveComment, setFieldText } from '../model/actions';
import { getUI } from '../model/store';
import { useDoc } from '../hooks';
import { Markdown } from './Markdown';
import { WikiEditor } from './WikiEditor';
import { t } from '../i18n';
import type { Comment } from '../model/types';

function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return new Date(ts).toLocaleDateString();
}

/** Threaded comments with @mentions and [[links]] (spec §3.2 "Comment", §7). */
export function CommentThread({ targetId, compact, canPost }: { targetId: string; compact?: boolean; canPost: boolean }) {
  const doc = useDoc();
  const all = Object.values(doc.comments).filter((c) => c.targetId === targetId).sort((a, b) => a.createdAt - b.createdAt);
  const roots = all.filter((c) => !c.parentId);
  const [draft, setDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const visibleRoots = roots.filter((r) => showResolved || !r.resolved);
  const resolvedCount = roots.filter((r) => r.resolved).length;
  const names = Object.values(doc.users).map((u) => '@' + u.name.split(' ')[0]).join(', ');
  return (
    <div className={'comment-thread' + (compact ? ' compact' : '')} onPointerDown={(e) => e.stopPropagation()}>
      {visibleRoots.map((r) => (
        <Thread key={r.id} root={r} replies={all.filter((c) => c.parentId === r.id)} canPost={canPost} />
      ))}
      {resolvedCount > 0 && (
        <button className="link-btn small" onClick={() => setShowResolved((s) => !s)}>
          {showResolved ? t('Hide resolved') : t('Show {n} resolved', { n: resolvedCount })}
        </button>
      )}
      {canPost && (
        <div className="comment-compose interactive">
          <WikiEditor value={draft} onChange={setDraft} minRows={compact ? 1 : 2} placeholder={t('Comment… @mention, [[link]]')} ariaLabel={t('New comment')} />
          <div className="row">
            <span className="muted small" title={names}>{t('Mention:')} {names}</span>
            <button className="btn small primary" disabled={!draft.trim()} onClick={() => { addComment(targetId, draft); setDraft(''); }}>{t('Post')}</button>
          </div>
        </div>
      )}
      {!roots.length && !canPost && <div className="muted small">{t('No comments')}</div>}
    </div>
  );
}

function Thread({ root, replies, canPost }: { root: Comment; replies: Comment[]; canPost: boolean }) {
  const doc = useDoc();
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const me = getUI().userId;
  const one = (c: Comment) => {
    const u = doc.users[c.authorId];
    return (
      <div key={c.id} className="comment">
        <span className="avatar xs" style={{ background: u?.color ?? '#999' }}>{u?.name[0] ?? '?'}</span>
        <div className="comment-main">
          <div className="comment-meta"><strong>{u?.name ?? t('Unknown')}</strong> <span className="muted small">{ago(c.createdAt)}</span></div>
          {editing === c.id ? (
            <WikiEditor value={c.body} onChange={(b) => setFieldText(c.targetId, 'comment:' + c.id, b)} autoFocus onDone={() => setEditing(null)} />
          ) : (
            <Markdown text={c.body.replace(/(^|\s)@(\w+)/g, '$1**@$2**')} />
          )}
          <div className="comment-actions">
            {canPost && !c.parentId && <button className="link-btn small" onClick={() => setReplying((r) => !r)}>{t('Reply')}</button>}
            {canPost && !c.parentId && <button className="link-btn small" onClick={() => resolveComment(c.id, !c.resolved)}>{c.resolved ? t('Reopen') : t('Resolve')}</button>}
            {c.authorId === me && <button className="link-btn small" onClick={() => setEditing(editing === c.id ? null : c.id)}>{editing === c.id ? t('Done') : t('Edit')}</button>}
            {c.authorId === me && <button className="link-btn small danger" onClick={() => deleteComment(c.id)}>{t('Delete')}</button>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className={'thread' + (root.resolved ? ' resolved' : '')}>
      {one(root)}
      <div className="replies">{replies.map(one)}</div>
      {replying && (
        <div className="comment-compose interactive">
          <WikiEditor value={reply} onChange={setReply} autoFocus placeholder={t('Reply…')} />
          <button className="btn small primary" disabled={!reply.trim()} onClick={() => { addComment(root.targetId, reply, root.id); setReply(''); setReplying(false); }}>{t('Reply')}</button>
        </div>
      )}
    </div>
  );
}
