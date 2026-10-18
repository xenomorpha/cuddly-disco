import { useMemo, useState } from 'react';
import { getIndex, cardTitle, textFields } from '../model/index';
import { findMentions, snippetAround, type Mention } from '../model/links';
import { setUI } from '../model/store';
import { convertMention, currentAccess, revealCard, updateCard, openBoard } from '../model/actions';
import { canComment, canEdit } from '../model/permissions';
import { useAccess, useDoc, useUI } from '../hooks';
import { CardTypeIcon, Icon } from './icons';
import { CommentThread } from './CommentThread';
import { LocalGraphPanel } from './GraphView';
import { t } from '../i18n';
import type { Panel } from '../model/store';

/** The card the side panels talk about: selected card → focused card → current board. */
export function usePanelTarget(): string {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const sel = ui.selection.length ? doc.placements[ui.selection[0]]?.cardId : null;
  if (sel && doc.cards[sel]) return sel;
  if (ui.focusCard && doc.cards[ui.focusCard] && (idx.isLive(ui.focusCard) || doc.cards[ui.focusCard].deletedAt)) return ui.focusCard;
  return ui.boardId;
}

const TABS: { id: Exclude<Panel, null>; icon: string; label: string }[] = [
  { id: 'backlinks', icon: 'backlinks', label: 'Backlinks' },
  { id: 'localGraph', icon: 'graph', label: 'Local graph' },
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'info', icon: 'info', label: 'Info' },
  { id: 'activity', icon: 'activity', label: 'Activity' },
];

export function RightPanel() {
  const ui = useUI();
  const doc = useDoc();
  const target = usePanelTarget();
  const idx = getIndex(doc);
  if (!ui.rightPanel) return null;
  const c = doc.cards[target];
  return (
    <aside className="right-panel" aria-label={t('Side panel')}>
      <div className="panel-tabs" role="tablist">
        {TABS.map((tb) => (
          <button key={tb.id} role="tab" aria-selected={ui.rightPanel === tb.id} className={ui.rightPanel === tb.id ? 'on' : ''} onClick={() => setUI({ rightPanel: tb.id })} title={t(tb.label)}>
            <Icon name={tb.icon} size={16} />
            <span className="tab-label">{t(tb.label)}</span>
          </button>
        ))}
        <button className="icon-btn close" onClick={() => setUI({ rightPanel: null })} aria-label={t('Close panel')}><Icon name="close" size={16} /></button>
      </div>
      {ui.rightPanel !== 'activity' && c && (
        <div className="panel-target">
          <CardTypeIcon type={c.type} />
          <strong>{idx.title(target)}</strong>
          {target === ui.boardId && <span className="muted small">({t('this board')})</span>}
        </div>
      )}
      <div className="panel-body">
        {ui.rightPanel === 'backlinks' && <BacklinksPanel target={target} />}
        {ui.rightPanel === 'localGraph' && <LocalGraphPanel />}
        {ui.rightPanel === 'comments' && <CommentThread targetId={target} canPost={canComment(currentAccess().card(target))} />}
        {ui.rightPanel === 'info' && <InfoPanel target={target} />}
        {ui.rightPanel === 'activity' && <ActivityPanel />}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ backlinks

function Snip({ text, index, length }: { text: string; index: number; length: number }) {
  const doc = useDoc();
  const s = snippetAround(text, index, length, getIndex(doc).label);
  return (
    <span className="snippet">
      {s.before}
      <mark>{s.match}</mark>
      {s.after}
    </span>
  );
}

export function BacklinksPanel({ target }: { target: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const access = useAccess();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'board' | 'date'>('board');
  const [showMentions, setShowMentions] = useState(true);
  const title = idx.title(target);
  const editable = (id: string) => canEdit(access.card(id));

  const refs = useMemo(() => {
    const all = (idx.backlinks.get(target) ?? []).filter((r) => access.canSee(r.sourceId));
    const f = filter.trim().toLowerCase();
    return f ? all.filter((r) => idx.title(r.sourceId).toLowerCase().includes(f) || r.fieldText.toLowerCase().includes(f)) : all;
  }, [idx, target, access, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof refs>();
    for (const r of refs) {
      const b = idx.homeBoard.get(r.sourceId) ?? '';
      const l = m.get(b);
      if (l) l.push(r);
      else m.set(b, [r]);
    }
    const arr = [...m.entries()];
    if (sort === 'board') arr.sort((a, b) => idx.title(a[0]).localeCompare(idx.title(b[0])));
    else arr.sort((a, b) => Math.max(...b[1].map((r) => doc.cards[r.sourceId]?.updatedAt ?? 0)) - Math.max(...a[1].map((r) => doc.cards[r.sourceId]?.updatedAt ?? 0)));
    return arr;
  }, [refs, sort, idx, doc]);

  // unlinked mentions: computed on demand, capped at 50 (spec §4.4)
  const mentions = useMemo(() => {
    if (!showMentions) return [];
    const out: { sourceId: string; field: string; text: string; m: Mention }[] = [];
    const tgt = doc.cards[target];
    if (!tgt || title.length < 3 || title.startsWith('Untitled')) return out;
    for (const c of Object.values(doc.cards)) {
      if (c.id === target || !idx.isLive(c.id) || !access.canSee(c.id)) continue;
      for (const f of textFields(c)) {
        for (const m of findMentions(f.text, title)) {
          out.push({ sourceId: c.id, field: f.field, text: f.text, m });
          if (out.length >= 50) return out;
        }
      }
    }
    return out;
  }, [doc, idx, target, title, access, showMentions]);

  const isBroken = doc.cards[target]?.deletedAt;

  return (
    <div className="backlinks">
      {isBroken && <div className="notice">{t('This item is in the Trash — links to it show as broken until it is restored.')}</div>}
      <div className="row">
        <input className="grow" value={filter} placeholder={t('Filter references…')} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Filter references')} />
        <select value={sort} onChange={(e) => setSort(e.target.value as 'board' | 'date')} aria-label={t('Sort')}>
          <option value="board">{t('By board')}</option>
          <option value="date">{t('By date edited')}</option>
        </select>
      </div>
      <h4>{t('Linked references')} <span className="count">{refs.length}</span></h4>
      {!refs.length && <div className="muted small">{t('Nothing links here yet. Type [[{t}]] in any note to link it.', { t: title })}</div>}
      {groups.map(([boardId, list]) => (
        <div key={boardId} className="ref-group">
          <button className="ref-board" onClick={() => boardId && openBoard(boardId)}>
            <Icon name="board" size={13} /> {boardId ? idx.title(boardId) : t('Unplaced')}
          </button>
          {list.map((r, i) => (
            <button key={r.sourceId + r.field + r.index + i} className="ref" onClick={() => revealCard(r.sourceId)} title={t('Go to card')}>
              <div className="ref-title"><CardTypeIcon type={doc.cards[r.sourceId]?.type ?? 'note'} size={13} /> {idx.title(r.sourceId)}{r.field.startsWith('comment:') ? ' · ' + t('comment') : ''}</div>
              <Snip text={r.fieldText} index={r.index} length={r.length} />
            </button>
          ))}
        </div>
      ))}
      <h4 className="clickable" onClick={() => setShowMentions((s) => !s)}>
        {t('Unlinked mentions')} <span className="count">{mentions.length}{mentions.length >= 50 ? '+' : ''}</span> <span className="muted">{showMentions ? '▾' : '▸'}</span>
      </h4>
      {showMentions && !mentions.length && <div className="muted small">{t('No plain-text mentions of "{t}".', { t: title })}</div>}
      {mentions.map((x, i) => (
        <div key={x.sourceId + x.field + x.m.index + i} className="ref mention">
          <button className="ref-main" onClick={() => revealCard(x.sourceId)}>
            <div className="ref-title"><CardTypeIcon type={doc.cards[x.sourceId]?.type ?? 'note'} size={13} /> {idx.title(x.sourceId)}</div>
            <Snip text={x.text} index={x.m.index} length={x.m.length} />
          </button>
          {editable(x.sourceId) && (
            <button className="btn small" onClick={() => convertMention(x.sourceId, x.field, x.text, x.m, target)}>{t('Link')}</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ info & version history

function InfoPanel({ target }: { target: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const c = doc.cards[target];
  const access = useAccess();
  if (!c) return null;
  const users = doc.users;
  const placements = idx.placementsByCard.get(c.id) ?? [];
  const fmt = (ts: number) => new Date(ts).toLocaleString();
  const editable = canEdit(access.card(c.id));
  return (
    <div className="info">
      <dl>
        <dt>{t('Type')}</dt><dd>{t(c.type)}</dd>
        <dt>{t('Created')}</dt><dd>{fmt(c.createdAt)} · {users[c.createdBy]?.name ?? '—'}</dd>
        <dt>{t('Edited')}</dt><dd>{fmt(c.updatedAt)} · {users[c.updatedBy]?.name ?? '—'}</dd>
        <dt>{t('Backlinks')}</dt><dd>{idx.backlinks.get(c.id)?.length ?? 0}</dd>
        <dt>{t('Outgoing links')}</dt><dd>{idx.outlinks.get(c.id)?.length ?? 0}</dd>
        <dt>{t('Tags')}</dt><dd>{(idx.cardTags.get(c.id) ?? []).map((tg) => <button key={tg} className="tag" onClick={() => setUI({ tagPage: tg })}>#{tg}</button>)}</dd>
        <dt>{t('Your access')}</dt><dd>{t(access.card(c.id))}</dd>
        {c.type !== 'board' && (
          <>
            <dt>{placements.length > 1 ? t('Synced on') : t('On board')}</dt>
            <dd>{placements.map((p) => <button key={p.id} className="link-btn" onClick={() => revealCard(c.id)}>{idx.title(p.boardId)}</button>)}</dd>
          </>
        )}
        <dt>ID</dt><dd><code className="small">{c.id}</code></dd>
      </dl>
      <h4>{t('Version history')}</h4>
      {!c.history?.length && <div className="muted small">{t('No earlier versions yet.')}</div>}
      {[...(c.history ?? [])].reverse().map((h, i) => (
        <div key={i} className="version">
          <div className="row">
            <span className="small">{fmt(h.at)} · {users[h.by]?.name ?? '—'}</span>
            {editable && (
              <button className="link-btn small" onClick={() => updateCard(c.id, { text: h.text, title: h.title }, 'restore-version')}>{t('Restore')}</button>
            )}
          </div>
          <div className="muted small clamp">{h.title ? h.title + ' — ' : ''}{h.text.slice(0, 140)}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ activity feed

function ActivityPanel() {
  const doc = useDoc();
  const ui = useUI();
  const items = doc.activity.filter((a) => a.boardId === ui.boardId).slice(0, 100);
  return (
    <div className="activity">
      <div className="muted small">{t('Activity on "{b}"', { b: cardTitle(doc.cards[ui.boardId]) })}</div>
      {!items.length && <div className="muted small">{t('No activity yet.')}</div>}
      {items.map((a) => {
        const u = doc.users[a.userId];
        return (
          <div key={a.id} className="activity-item">
            <span className="avatar xs" style={{ background: u?.color ?? '#999' }}>{u?.name[0] ?? '?'}</span>
            <div><strong>{u?.name ?? t('Someone')}</strong> {a.text}<div className="muted small">{new Date(a.at).toLocaleString()}</div></div>
          </div>
        );
      })}
    </div>
  );
}
