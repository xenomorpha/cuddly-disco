import { useEffect, useMemo, useState } from 'react';
import { setUI } from '../model/store';
import { getIndex } from '../model/index';
import { headings, toPlain } from '../model/links';
import { canEditBoard, currentAccess, openBoard, revealCard, updateCard } from '../model/actions';
import { canEdit } from '../model/permissions';
const exportCardMarkdown = (id: string) => void import('../model/io').then((m) => m.exportCardMarkdown(id));
import { useDoc, useUI } from '../hooks';
import { Markdown } from './Markdown';
import { WikiEditor } from './WikiEditor';
import { CardTypeIcon, Icon } from './icons';
import { t } from '../i18n';
import { toggleChecklistLine } from './cards/TextCards';

// ------------------------------------------------------------------ document editor (full screen)

export function DocEditor({ cardId, anchor }: { cardId: string; anchor?: string | null }) {
  const doc = useDoc();
  const c = doc.cards[cardId];
  const editable = c ? canEdit(currentAccess().card(cardId)) : false;
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>(editable ? (window.innerWidth < 800 ? 'edit' : 'split') : 'preview');
  const [flash, setFlash] = useState<string | null>(anchor ?? null);
  useEffect(() => {
    if (!anchor) return;
    setTimeout(() => {
      document.getElementById('h-' + anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlash(anchor);
    }, 60);
  }, [anchor]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea') && setUI({ docEditor: null });
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  if (!c) return null;
  const hs = headings(c.text);
  const close = () => setUI({ docEditor: null });
  const goHeading = (slug: string) => {
    if (mode === 'edit') setMode('split');
    setTimeout(() => {
      document.getElementById('h-' + slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFlash(slug);
    }, 30);
  };
  return (
    <div className="doc-editor" role="dialog" aria-label={t('Document')}>
      <header>
        <button className="icon-btn" onClick={close} aria-label={t('Close')}><Icon name="back" /></button>
        <Icon name="document" />
        {editable ? (
          <input className="doc-title" value={c.title} placeholder={t('Untitled document')} onChange={(e) => updateCard(c.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        ) : (
          <h2 className="doc-title">{c.title}</h2>
        )}
        <div className="seg">
          {editable && <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>{t('Write')}</button>}
          {editable && <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>{t('Split')}</button>}
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>{t('Read')}</button>
        </div>
        <button className="btn small" onClick={() => exportCardMarkdown(c.id)}><Icon name="download" size={14} /> .md</button>
        <button className="btn small" onClick={() => { close(); revealCard(c.id); }}>{t('Show on board')}</button>
        <button className="btn small" onClick={() => setUI({ rightPanel: 'backlinks', focusCard: c.id, docEditor: null })}><Icon name="backlinks" size={14} /> {getIndex(doc).backlinks.get(c.id)?.length ?? 0}</button>
      </header>
      <div className="doc-main">
        {hs.length > 0 && (
          <nav className="doc-outline" aria-label={t('Outline')}>
            <h4>{t('Outline')}</h4>
            {hs.map((h, i) => (
              <button key={i} style={{ paddingLeft: (h.level - 1) * 12 + 6 }} onClick={() => goHeading(h.slug)}>{h.text}</button>
            ))}
          </nav>
        )}
        {mode !== 'preview' && editable && (
          <div className="doc-write">
            <WikiEditor selfId={c.id} value={c.text} onChange={(text) => updateCard(c.id, { text })} toolbar autoFocus={!anchor} minRows={20} placeholder={t('Start writing… # headings, [[links]], #tags')} />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="doc-read">
            <Markdown text={c.text} highlightHeading={flash} onToggleCheck={editable ? (l) => updateCard(c.id, { text: toggleChecklistLine(c.text, l) }) : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ side-by-side peek (Cmd/Ctrl+click a link)

export function PeekPanel({ cardId }: { cardId: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const c = doc.cards[cardId];
  const [editing, setEditing] = useState(false);
  if (!c) return null;
  const editable = canEdit(currentAccess().card(cardId)) && (c.type === 'note' || c.type === 'document');
  return (
    <aside className="peek-panel" aria-label={t('Side-by-side')}>
      <div className="peek-head">
        <CardTypeIcon type={c.type} />
        <strong>{idx.title(cardId)}</strong>
        <span className="muted small">{idx.homeBoard.get(cardId) ? idx.title(idx.homeBoard.get(cardId)!) : ''}</span>
        <div className="grow" />
        {editable && <button className="btn small" onClick={() => setEditing((e) => !e)}>{editing ? t('Done') : t('Edit')}</button>}
        <button className="btn small" onClick={() => { setUI({ peek: null }); c.type === 'board' ? openBoard(c.id) : revealCard(c.id); }}>{t('Open')}</button>
        <button className="icon-btn" onClick={() => setUI({ peek: null })} aria-label={t('Close')}><Icon name="close" /></button>
      </div>
      <div className="peek-body">
        {editing ? (
          <WikiEditor selfId={c.id} value={c.text} onChange={(text) => updateCard(c.id, { text })} toolbar autoFocus minRows={12} />
        ) : c.type === 'board' ? (
          <ul>
            {(idx.placementsByBoard.get(c.id) ?? []).map((p) => (
              <li key={p.id}><button className="link-btn" onClick={() => setUI({ peek: p.cardId })}>{idx.title(p.cardId)}</button></li>
            ))}
          </ul>
        ) : c.type === 'todo' ? (
          <ul className="checklist">{(c.data.items ?? []).map((i) => <li key={i.id} className={i.done ? 'done' : ''}>{i.done ? '☑' : '☐'} {toPlain(i.text, idx.label)}</li>)}</ul>
        ) : (
          <Markdown text={c.text || c.data.description || c.data.caption || ''} />
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ presentation mode

export function Presentation() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const frames = useMemo(() => {
    const ps = (idx.placementsByBoard.get(ui.boardId) ?? []).filter((p) => !p.columnId && !p.tray);
    // reading order: rows (by y band) then left-to-right
    return ps.sort((a, b) => (Math.abs(a.y - b.y) < 120 ? a.x - b.x : a.y - b.y));
  }, [idx, ui.boardId]);
  const [i, setI] = useState(-1);
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onFs = () => !document.fullscreenElement && setUI({ presenting: false });
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    setUI({ selection: [] });
    const ids = i < 0 ? frames.map((f) => f.id) : [frames[i]?.id].filter(Boolean);
    window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'ids', ids } }));
  }, [i, frames]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setI((x) => Math.min(frames.length - 1, x + 1)); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setI((x) => Math.max(-1, x - 1)); }
      if (e.key === 'Escape') setUI({ presenting: false });
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [frames.length]);
  return (
    <div className="presenter" role="toolbar" aria-label={t('Presentation')}>
      <button onClick={() => setI((x) => Math.max(-1, x - 1))} aria-label={t('Previous')}>‹</button>
      <span>{i < 0 ? t('Overview') : `${i + 1} / ${frames.length}`} {i >= 0 && frames[i] ? '· ' + idx.title(frames[i].cardId) : ''}</span>
      <button onClick={() => setI((x) => Math.min(frames.length - 1, x + 1))} aria-label={t('Next')}>›</button>
      <button onClick={() => setUI({ presenting: false })}>{t('Exit')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ list view (screen readers / keyboard)

export function ListView({ boardId }: { boardId: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const ps = (idx.placementsByBoard.get(boardId) ?? []).filter((p) => !p.columnId).sort((a, b) => (Math.abs(a.y - b.y) < 120 ? a.x - b.x : a.y - b.y));
  const editable = canEditBoard(boardId);
  const describe = (cardId: string) => {
    const c = doc.cards[cardId];
    if (c.type === 'todo') return (c.data.items ?? []).map((i) => `${i.done ? '☑' : '☐'} ${toPlain(i.text, idx.label)}`).join('; ');
    if (c.type === 'board') return t('{n} items', { n: idx.childCount(c.id) });
    if (c.type === 'link') return c.data.url ?? '';
    if (c.type === 'swatch') return c.data.hex ?? '';
    if (c.type === 'image') return c.data.caption ?? '';
    return toPlain(c.text, idx.label).slice(0, 400);
  };
  return (
    <main className="list-view" aria-label={t('Board as a list')}>
      <h1>{idx.title(boardId)}</h1>
      <p className="muted">{t('{n} items', { n: ps.length })} · {editable ? t('Editable') : t('Read-only')}</p>
      <ol>
        {ps.map((p) => {
          const c = doc.cards[p.cardId];
          const kids = (idx.placementsByBoard.get(boardId) ?? []).filter((q) => q.columnId === p.id).sort((a, b) => a.order - b.order);
          return (
            <li key={p.id}>
              <article aria-label={`${t(c.type)}: ${idx.title(c.id)}`}>
                <h2><CardTypeIcon type={c.type} /> <span className="muted small">{t(c.type)}</span> {idx.title(c.id)}</h2>
                <p>{describe(c.id)}</p>
                <div className="row">
                  {c.type === 'board' && <button className="btn small" onClick={() => openBoard(c.id)}>{t('Open board')}</button>}
                  {c.type === 'document' && <button className="btn small" onClick={() => setUI({ docEditor: { cardId: c.id } })}>{t('Open document')}</button>}
                  <button className="btn small" onClick={() => setUI({ listView: false, selection: [p.id], highlight: { placementId: p.id, at: Date.now() } })}>{t('Show on canvas')}</button>
                  <button className="btn small" onClick={() => setUI({ focusCard: c.id, rightPanel: 'backlinks' })}>{t('Backlinks')} ({idx.backlinks.get(c.id)?.length ?? 0})</button>
                </div>
                {kids.length > 0 && (
                  <ol>
                    {kids.map((k) => (
                      <li key={k.id}><strong>{idx.title(k.cardId)}</strong> — {describe(k.cardId)}</li>
                    ))}
                  </ol>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

// ------------------------------------------------------------------ toast

export function Toast() {
  const toast = useUI().toast;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const tm = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(tm);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className="toast" role="status" aria-live="polite">{toast.text}</div>;
}

// ------------------------------------------------------------------ share link gate

export function ShareGate({ token, onEnter }: { token: string; onEnter: () => void }) {
  const doc = useDoc();
  const link = Object.values(doc.shareLinks).find((l) => l.token === token);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  if (!link || !link.enabled)
    return (
      <div className="gate">
        <h2>{t('This link is no longer active')}</h2>
        <a href="#/" onClick={() => location.reload()}>{t('Back to app')}</a>
      </div>
    );
  if (!link.password) {
    setTimeout(onEnter, 0);
    return null;
  }
  return (
    <div className="gate">
      <h2>{t('Password required')}</h2>
      <p className="muted">{t('Enter the password to view "{b}"', { b: getIndex(doc).title(link.boardId) })}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (pw === link.password) onEnter(); else setErr(true); }}>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }} autoFocus aria-label={t('Password')} />
        <button className="btn primary">{t('View board')}</button>
      </form>
      {err && <p className="danger">{t('Wrong password')}</p>}
    </div>
  );
}
