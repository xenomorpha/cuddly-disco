import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardType, Role } from '../model/types';
import { CARD_TYPES } from '../model/types';
import { getDoc, replaceDoc, setUI, toast } from '../model/store';
import { boardPath, getIndex, textFields } from '../model/index';
import { toPlain } from '../model/links';
import {
  addMember, currentAccess, emptyTrash, hardDelete, instantiateTemplate, openBoard, removeMember, restoreCard, revealCard,
  saveBoardAsTemplate, setBoardPermission, setMemberRole, TRASH_DAYS, upsertShareLink, deleteTemplate, saveGraphSettings,
} from '../model/actions';
import { BUILTIN_TEMPLATES } from '../model/templates';
// export/import pulls in jszip/jspdf/html-to-image: load it on demand
const io = () => import('../model/io');
const exportBoardPNG = (id: string) => io().then((m) => m.exportBoardPNG(id));
const exportBoardPDF = (id: string) => io().then((m) => m.exportBoardPDF(id));
const exportCardMarkdown = (id: string) => void io().then((m) => m.exportCardMarkdown(id));
const exportWorkspaceZip = () => io().then((m) => m.exportWorkspaceZip());
const importFiles = (f: FileList) => io().then((m) => m.importFiles(f));
import { boardRole, canView, isOwner } from '../model/permissions';
import { seedWorkspace } from '../model/seed';
import { useAccess, useDoc, useUI, modKey } from '../hooks';
import { rankCards } from './WikiEditor';
import { CardTypeIcon, Icon } from './icons';
import { t } from '../i18n';
import { del as idbDel, clear as idbClear } from 'idb-keyval';

function Modal({ title, onClose, children, wide, className }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '') + ' ' + (className ?? '')} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function open(id: string) {
  if (getDoc().cards[id]?.type === 'board') openBoard(id);
  else revealCard(id);
}

// ------------------------------------------------------------------ quick switcher (Cmd/Ctrl+K)

export function QuickSwitcher() {
  const doc = useDoc();
  const idx = getIndex(doc);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ids = rankCards(q, 14);
  const close = () => setUI({ quickSwitcher: false });
  const go = (id: string) => {
    close();
    open(id);
  };
  return (
    <div className="modal-backdrop top" onPointerDown={close}>
      <div className="modal switcher" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('Quick switcher')}>
        <input
          autoFocus
          value={q}
          placeholder={t('Jump to a board or card…')}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(ids.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && ids[sel]) go(ids[sel]);
            if (e.key === 'Escape') close();
          }}
          aria-label={t('Search')}
        />
        <div className="picker-list" role="listbox">
          {ids.map((id, i) => (
            <button key={id} role="option" aria-selected={i === sel} className={'picker-item' + (i === sel ? ' active' : '')} onMouseEnter={() => setSel(i)} onClick={() => go(id)}>
              <CardTypeIcon type={doc.cards[id].type} />
              <span>{idx.title(id)}</span>
              <span className="muted small">{boardPath(doc, doc.cards[id].type === 'board' ? doc.cards[id].data.parentId ?? id : idx.homeBoard.get(id) ?? '').map((b) => idx.title(b)).join(' / ')}</span>
            </button>
          ))}
          {!ids.length && <div className="muted pad">{t('No matches')}</div>}
        </div>
        <div className="switcher-foot muted small">↑↓ {t('to navigate')} · ↵ {t('to open')} · {modKey()}⇧F {t('for full-text search')}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ full-text search

export function SearchDialog() {
  const doc = useDoc();
  const idx = getIndex(doc);
  const access = useAccess();
  const [q, setQ] = useState('');
  const [type, setType] = useState<CardType | ''>('');
  const [board, setBoard] = useState('');
  const [tag, setTag] = useState('');
  const [since, setSince] = useState('');
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query && !type && !tag && !board) return [];
    const out: { id: string; snippet: string; score: number }[] = [];
    const scope = board ? new Set([board, ...Object.values(doc.cards).filter((c) => c.type === 'board' && boardPath(doc, c.id).includes(board)).map((c) => c.id)]) : null;
    const sinceTs = since ? Date.parse(since) : 0;
    for (const c of Object.values(doc.cards)) {
      if (!idx.isLive(c.id) || !access.canSee(c.id) || c.type === 'column') continue;
      if (type && c.type !== type) continue;
      if (tag && !(idx.cardTags.get(c.id) ?? []).includes(tag)) continue;
      if (scope && !scope.has(idx.homeBoard.get(c.id) ?? '') && !scope.has(c.id)) continue;
      if (sinceTs && c.updatedAt < sinceTs) continue;
      const title = idx.title(c.id);
      const hay = [
        title,
        ...textFields(c).map((f) => toPlain(f.text, idx.label)),
        c.data.url ?? '',
        c.data.description ?? '',
        c.data.fileName ?? '',
        c.data.address ?? '',
        ...Object.values(doc.comments).filter((m) => m.targetId === c.id).map((m) => toPlain(m.body, idx.label)),
      ].join('\n');
      if (!query) {
        out.push({ id: c.id, snippet: hay.slice(title.length, title.length + 120), score: c.updatedAt });
        continue;
      }
      const words = query.split(/\s+/);
      const low = hay.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      const snippet = (at > 40 ? '…' : '') + hay.slice(Math.max(0, at - 40), at + 100).replace(/\s+/g, ' ');
      const score = (title.toLowerCase().includes(query) ? 1000 : 0) + (title.toLowerCase().startsWith(query) ? 500 : 0) + c.updatedAt / 1e12;
      out.push({ id: c.id, snippet, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 100);
  }, [q, type, board, tag, since, doc, idx, access]);
  const hi = (s: string) => {
    const w = q.trim().split(/\s+/)[0];
    if (!w) return s;
    const i = s.toLowerCase().indexOf(w.toLowerCase());
    if (i < 0) return s;
    return <>{s.slice(0, i)}<mark>{s.slice(i, i + w.length)}</mark>{s.slice(i + w.length)}</>;
  };
  const boards = Object.values(doc.cards).filter((c) => c.type === 'board' && idx.liveBoards.has(c.id) && access.canSee(c.id));
  return (
    <Modal title={t('Search')} onClose={() => setUI({ search: false })} wide>
      <input autoFocus className="big-input" value={q} placeholder={t('Search titles, text, table cells, URLs, comments…')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Search')} />
      <div className="row wrap filters">
        <select value={type} onChange={(e) => setType(e.target.value as CardType)} aria-label={t('Type')}>
          <option value="">{t('All types')}</option>
          {CARD_TYPES.filter((x) => x !== 'column').map((x) => <option key={x} value={x}>{t(x)}</option>)}
        </select>
        <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label={t('Board')}>
          <option value="">{t('All boards')}</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{idx.title(b.id)}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t('Tag')}>
          <option value="">{t('Any tag')}</option>
          {[...idx.tags.keys()].sort().map((x) => <option key={x} value={x}>#{x}</option>)}
        </select>
        <label className="small">{t('Edited since')} <input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        <span className="muted small">{results.length} {t('results')}</span>
      </div>
      <div className="search-results">
        {results.map((r) => (
          <button key={r.id} className="search-result" onClick={() => { setUI({ search: false }); open(r.id); }}>
            <div className="row"><CardTypeIcon type={doc.cards[r.id].type} /> <strong>{hi(idx.title(r.id))}</strong> <span className="muted small">{idx.homeBoard.get(r.id) ? idx.title(idx.homeBoard.get(r.id)!) : ''}</span></div>
            <div className="muted small">{hi(r.snippet)}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ shortcuts cheat-sheet (?)

export function ShortcutsOverlay() {
  const m = modKey();
  const groups: [string, [string, string][]][] = [
    [t('Create'), [['N', t('Note')], ['D', t('Document')], ['T', t('To-do')], ['B', t('Board')], ['C', t('Column')], ['I', t('Image')], ['U', t('Link')], ['F', t('File / audio')], ['E', t('Table')], ['S', t('Sketch')], ['K', t('Colour')], ['M', t('Map')], ['O', t('Comment')], ['L', t('Line tool')], [t('Double-click canvas'), t('New note')]]],
    [t('Edit'), [[`${m}Z / ${m}⇧Z`, t('Undo / redo')], [`${m}C / ${m}V / ${m}X`, t('Copy / paste / cut')], [`${m}D`, t('Duplicate')], [`${m}A`, t('Select all')], ['Del / ⌫', t('Delete')], ['Enter', t('Edit selected card')], ['Esc', t('Stop editing / deselect')], [t('Arrows'), t('Nudge (⇧ = 10px)')], [`${m}L`, t('Lock / unlock')], [`${m}↵`, t('Duplicate empty column')], [`${m}⇧G`, t('Group selection into column')], ['[[', t('Link to a card')], ['#', t('Tag')]]],
    [t('Navigate'), [[`${m}K`, t('Quick switcher')], [`${m}⇧F`, t('Search')], [`${m}G`, t('Graph view')], [`${m}⇧B`, t('Backlinks panel')], [`${m}[ / ${m}]`, t('Back / forward')], ['Tab', t('Next card')], [t('Space + drag'), t('Pan')], [`${m} + scroll`, t('Zoom')], ['+ / −', t('Zoom in / out')], ['⇧1', t('Zoom to fit')], ['⇧0', t('Zoom 100%')], ['?', t('This cheat-sheet')]]],
    [t('Text'), [[`${m}B`, t('Bold')], [`${m}I`, t('Italic')], [`${m}E`, t('Code')], [`${m}⇧X`, t('Strikethrough')], [`${m}+click link`, t('Open side-by-side')]]],
  ];
  return (
    <Modal title={t('Keyboard shortcuts')} onClose={() => setUI({ shortcuts: false })} wide>
      <div className="shortcut-grid">
        {groups.map(([g, items]) => (
          <section key={g}>
            <h4>{g}</h4>
            {items.map(([k, d]) => (
              <div key={k + d} className="shortcut"><kbd>{k}</kbd><span>{d}</span></div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ settings

export function SettingsDialog() {
  const doc = useDoc();
  const ui = useUI();
  const [tab, setTab] = useState<'general' | 'members' | 'data'>('general');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const owner = isOwner(currentAccess().board(doc.rootBoardId));
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(() => { try { return localStorage.getItem('nodeboard:unsplashKey') ?? ''; } catch { return ''; } });
  useEffect(() => {
    dirRef.current?.setAttribute('webkitdirectory', '');
  }, [tab]);
  return (
    <Modal title={t('Settings')} onClose={() => setUI({ settingsOpen: false })} wide>
      <div className="tabs">
        <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>{t('General')}</button>
        <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>{t('Members')}</button>
        <button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>{t('Import & export')}</button>
      </div>
      {tab === 'general' && (
        <div className="form">
          <label className="field"><span>{t('Language')}</span>
            <select value={ui.locale} onChange={(e) => setUI({ locale: e.target.value as 'en' | 'ru' })}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={ui.snap} onChange={(e) => setUI({ snap: e.target.checked })} /> {t('Snap to grid')}</label>
          <label className="toggle"><input type="checkbox" checked={ui.showBadges} onChange={(e) => setUI({ showBadges: e.target.checked })} /> {t('Show backlink count badges on cards')}</label>
          <label className="toggle"><input type="checkbox" checked={ui.minimap} onChange={(e) => setUI({ minimap: e.target.checked })} /> {t('Show minimap')}</label>
          <label className="field"><span>{t('Unsplash access key (stock image search)')}</span>
            <input value={key} onChange={(e) => { setKey(e.target.value); try { localStorage.setItem('nodeboard:unsplashKey', e.target.value); } catch { /* */ } }} placeholder="optional" />
          </label>
          <p className="muted small">{t('Everything is stored locally in this browser (IndexedDB) and works offline. Open the app in a second tab or window to see real-time sync and presence.')}</p>
        </div>
      )}
      {tab === 'members' && (
        <div className="form">
          <table className="members">
            <tbody>
              {doc.members.map((m) => {
                const u = doc.users[m.userId];
                return (
                  <tr key={m.userId}>
                    <td><span className="avatar xs" style={{ background: u.color }}>{u.name[0]}</span> {u.name}</td>
                    <td className="muted small">{u.email}</td>
                    <td>
                      {m.role === 'owner' || !owner ? t(m.role) : (
                        <select value={m.role} onChange={(e) => setMemberRole(m.userId, e.target.value as Role)}>
                          <option value="editor">{t('editor')}</option>
                          <option value="commenter">{t('commenter')}</option>
                          <option value="viewer">{t('viewer')}</option>
                        </select>
                      )}
                    </td>
                    <td>{owner && m.role !== 'owner' && <button className="link-btn danger" onClick={() => removeMember(m.userId)}>{t('Remove')}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {owner && (
            <div className="row wrap">
              <input value={name} placeholder={t('Name')} onChange={(e) => setName(e.target.value)} />
              <input value={email} placeholder="email@example.com" type="email" onChange={(e) => setEmail(e.target.value)} />
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="editor">{t('editor')}</option>
                <option value="commenter">{t('commenter')}</option>
                <option value="viewer">{t('viewer')}</option>
              </select>
              <button className="btn primary" disabled={!name.trim() || !/@/.test(email)} onClick={() => { addMember(name.trim(), email.trim(), role); setName(''); setEmail(''); toast(t('Member added (no email is sent in local mode)')); }}>{t('Invite')}</button>
            </div>
          )}
          <p className="muted small">{t('Use the avatar menu (top right) to act as another member and check what they can see. Board-level overrides are set in the Share dialog.')}</p>
        </div>
      )}
      {tab === 'data' && (
        <div className="form">
          <h4>{t('Export')}</h4>
          <div className="row wrap">
            <button className="btn" onClick={() => void exportBoardPNG(ui.boardId)}>{t('Board as PNG')}</button>
            <button className="btn" onClick={() => void exportBoardPDF(ui.boardId)}>{t('Board as PDF')}</button>
            <button className="btn" disabled={!ui.selection.length} onClick={() => exportCardMarkdown(doc.placements[ui.selection[0]].cardId)}>{t('Selected card as Markdown')}</button>
            <button className="btn primary" onClick={() => void exportWorkspaceZip()}>{t('Whole workspace (ZIP: Markdown + assets + graph.json)')}</button>
          </div>
          <h4>{t('Import')}</h4>
          <div className="row wrap">
            <button className="btn" onClick={() => dirRef.current?.click()}>{t('Markdown folder / Obsidian vault…')}</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>{t('Markdown files, vault .zip, or workspace backup…')}</button>
            <input ref={dirRef} type="file" multiple hidden onChange={(e) => e.target.files && void importFiles(e.target.files).then(() => setUI({ settingsOpen: false }))} />
            <input ref={fileRef} type="file" multiple hidden accept=".md,.markdown,.zip,.json,image/*" onChange={(e) => e.target.files && void importFiles(e.target.files).then(() => setUI({ settingsOpen: false }))} />
          </div>
          <p className="muted small">{t('Imported notes land on a new board inside the current board. Folders become nested boards and [[links]] become real links.')}</p>
          <h4>{t('Your data')}</h4>
          <div className="row wrap">
            <button className="btn" onClick={() => {
              if (!confirm(t('Replace this workspace with a fresh demo workspace?'))) return;
              const { doc: d, assets } = seedWorkspace();
              void assets.then(() => { replaceDoc(d); setUI({ boardId: d.rootBoardId, userId: d.ownerId, settingsOpen: false, back: [], forward: [] }); });
            }}>{t('Reset to demo workspace')}</button>
            <button className="btn danger" onClick={async () => {
              if (!confirm(t('Delete all Nodeboard data stored in this browser? This cannot be undone.'))) return;
              await idbDel('nodeboard:workspace');
              await idbClear();
              try { localStorage.clear(); } catch { /* */ }
              location.reload();
            }}>{t('Delete all my data')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ share

export function ShareDialog() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const boardId = ui.boardId;
  const link = doc.shareLinks[boardId];
  const access = currentAccess();
  const myRole = access.board(boardId);
  const manage = myRole === 'owner' || myRole === 'editor';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const url = link ? `${location.origin}${location.pathname}#/share/${link.token}` : '';
  return (
    <Modal title={t('Share "{b}"', { b: idx.title(boardId) })} onClose={() => setUI({ shareOpen: false })}>
      <h4>{t('People')}</h4>
      <table className="members">
        <tbody>
          {doc.members.map((m) => {
            const u = doc.users[m.userId];
            const override = Object.values(doc.permissions).find((p) => p.boardId === boardId && p.userId === m.userId);
            const effective = boardRole(doc, m.userId, boardId);
            return (
              <tr key={m.userId}>
                <td><span className="avatar xs" style={{ background: u.color }}>{u.name[0]}</span> {u.name}</td>
                <td>
                  {m.role === 'owner' || !manage ? (
                    <span className="muted">{t(effective)}</span>
                  ) : (
                    <select value={override?.role ?? ''} onChange={(e) => setBoardPermission(boardId, m.userId, (e.target.value || null) as Role | 'none' | null)} aria-label={t('Access for {n}', { n: u.name })}>
                      <option value="">{t('Inherited')} ({t(boardRole({ ...doc, permissions: Object.fromEntries(Object.entries(doc.permissions).filter(([, p]) => !(p.boardId === boardId && p.userId === m.userId))) }, m.userId, boardId))})</option>
                      <option value="editor">{t('editor')}</option>
                      <option value="commenter">{t('commenter')}</option>
                      <option value="viewer">{t('viewer')}</option>
                      <option value="none">{t('No access')}</option>
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {manage && (
        <div className="row">
          <input className="grow" type="email" value={email} placeholder={t('Invite by email')} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="editor">{t('editor')}</option>
            <option value="commenter">{t('commenter')}</option>
            <option value="viewer">{t('viewer')}</option>
          </select>
          <button className="btn primary" disabled={!/@/.test(email)} onClick={() => {
            const existing = Object.values(doc.users).find((u) => u.email === email.trim());
            // invitee joins the workspace with no default access; this board grants it
            const id = existing?.id ?? addMember(email.split('@')[0], email.trim(), 'viewer');
            if (!existing) setMemberRole(id, 'viewer');
            setBoardPermission(boardId, id, role);
            setEmail('');
            toast(t('Invited {e} (no email is sent in local mode)', { e: email }));
          }}>{t('Invite')}</button>
        </div>
      )}
      <p className="muted small">{t('Permissions inherit to nested boards unless overridden. "No access" hides this board, its cards, links, backlinks and graph nodes from that person.')}</p>
      <h4>{t('Secret link')}</h4>
      <label className="toggle">
        <input type="checkbox" disabled={!manage} checked={!!link?.enabled} onChange={(e) => upsertShareLink(boardId, { enabled: e.target.checked })} /> {t('Anyone with the link can view (read-only)')}
      </label>
      {link?.enabled && (
        <>
          <div className="row">
            <input className="grow" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(t('Link copied')))}>{t('Copy')}</button>
          </div>
          <label className="field"><span>{t('Password (optional)')}</span>
            <input type="text" value={link.password ?? ''} disabled={!manage} onChange={(e) => upsertShareLink(boardId, { password: e.target.value })} placeholder={t('No password')} />
          </label>
          <label className="toggle"><input type="checkbox" disabled={!manage} checked={link.allowDuplicate} onChange={(e) => upsertShareLink(boardId, { allowDuplicate: e.target.checked })} /> {t('Allow viewers to duplicate this board')}</label>
          <p className="muted small">{t('In this local-first build the link opens a read-only view in this browser profile; a deployed server makes it work for anyone.')}</p>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ templates

export function TemplatesDialog() {
  const doc = useDoc();
  const ui = useUI();
  const [name, setName] = useState('');
  const editable = canView(currentAccess().board(ui.boardId)) && ['owner', 'editor'].includes(currentAccess().board(ui.boardId));
  const center = () => {
    const vp = ui.viewports[ui.boardId] ?? { x: 120, y: 90, zoom: 1 };
    const r = document.querySelector('.canvas')?.getBoundingClientRect() ?? { width: 800, height: 600 };
    return { x: (r.width / 2 - vp.x) / vp.zoom - 80, y: (r.height / 2 - vp.y) / vp.zoom - 60 };
  };
  const use = (n: string, icon: string, payload: Parameters<typeof instantiateTemplate>[2]) => {
    const c = center();
    const id = instantiateTemplate(n, icon, payload, ui.boardId, c.x, c.y);
    setUI({ templatesOpen: false });
    openBoard(id);
    setTimeout(() => window.dispatchEvent(new CustomEvent('nb:zoom', { detail: { kind: 'fit' } })), 100);
  };
  const custom = Object.values(doc.templates);
  return (
    <Modal title={t('Templates')} onClose={() => setUI({ templatesOpen: false })} wide>
      {!editable && <div className="notice">{t('You need edit access to this board to add a template here.')}</div>}
      <div className="template-grid">
        {BUILTIN_TEMPLATES.map((tp) => (
          <button key={tp.id} className="template" disabled={!editable} onClick={() => use(t(tp.name), tp.icon, tp.build(ui.userId))}>
            <span className="template-icon">{tp.icon}</span>
            <strong>{t(tp.name)}</strong>
            <span className="muted small">{t(tp.description)}</span>
          </button>
        ))}
        {custom.map((tp) => (
          <div key={tp.id} className="template custom">
            <button disabled={!editable} onClick={() => use(tp.name, '⭐', tp.payload)}>
              <span className="template-icon">⭐</span>
              <strong>{tp.name}</strong>
              <span className="muted small">{t('{n} cards', { n: tp.payload.cards.length })} · {t('custom')}</span>
            </button>
            <button className="link-btn danger small" onClick={() => deleteTemplate(tp.id)}>{t('Delete')}</button>
          </div>
        ))}
      </div>
      <h4>{t('Save current board as a template')}</h4>
      <div className="row">
        <input className="grow" value={name} placeholder={t('Template name')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn primary" disabled={!name.trim()} onClick={() => { saveBoardAsTemplate(ui.boardId, name.trim()); setName(''); }}>{t('Save template')}</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ trash

export function TrashDialog() {
  const doc = useDoc();
  const idx = getIndex(doc);
  const items = Object.values(doc.cards).filter((c) => c.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const owner = isOwner(currentAccess().board(doc.rootBoardId));
  const days = (ts: number) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - ts) / 86400_000));
  return (
    <Modal title={t('Trash')} onClose={() => setUI({ trashOpen: false })}>
      <p className="muted small">{t('Deleted items are kept for {n} days. Restoring an item repairs every link that points to it.', { n: TRASH_DAYS })}</p>
      {!items.length && <div className="muted pad">{t('Trash is empty')}</div>}
      <div className="trash-list">
        {items.map((c) => (
          <div key={c.id} className="trash-item">
            <CardTypeIcon type={c.type} />
            <div className="grow">
              <div>{idx.title(c.id)}</div>
              <div className="muted small">
                {t('Deleted {d}', { d: new Date(c.deletedAt!).toLocaleString() })} · {t('{n} days left', { n: days(c.deletedAt!) })}
                {(idx.backlinks.get(c.id)?.length ?? 0) > 0 && ` · ${t('{n} broken links', { n: idx.backlinks.get(c.id)!.length })}`}
              </div>
            </div>
            <button className="btn small" onClick={() => restoreCard(c.id)}>{t('Restore')}</button>
            {owner && <button className="btn small danger" onClick={() => { if (confirm(t('Delete forever? This cannot be undone.'))) hardDelete(c.id); }}>{t('Delete forever')}</button>}
          </div>
        ))}
      </div>
      {owner && items.length > 0 && (
        <button className="btn danger" onClick={() => { if (confirm(t('Permanently delete everything in the Trash?'))) emptyTrash(); }}>{t('Empty trash')}</button>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ tag page

export function TagPage({ tag }: { tag: string }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const access = useAccess();
  const ids = [...(idx.tags.get(tag) ?? [])].filter((id) => access.canSee(id) && idx.isLive(id));
  const byBoard = new Map<string, string[]>();
  for (const id of ids) {
    const b = idx.homeBoard.get(id) ?? '';
    byBoard.set(b, [...(byBoard.get(b) ?? []), id]);
  }
  return (
    <Modal title={'#' + tag} onClose={() => setUI({ tagPage: null })}>
      <p className="muted small">{t('{n} items tagged #{t}', { n: ids.length, t: tag })}</p>
      {[...byBoard.entries()].map(([b, list]) => (
        <div key={b} className="ref-group">
          <div className="ref-board"><Icon name="board" size={13} /> {b ? idx.title(b) : '—'}</div>
          {list.map((id) => (
            <button key={id} className="ref" onClick={() => { setUI({ tagPage: null }); open(id); }}>
              <div className="ref-title"><CardTypeIcon type={doc.cards[id].type} size={13} /> {idx.title(id)}</div>
              <span className="snippet">{toPlain(doc.cards[id].text, idx.label).slice(0, 140)}</span>
            </button>
          ))}
        </div>
      ))}
      <button className="btn small" onClick={() => {
        setUI({ tagPage: null, globalGraph: true });
        saveGraphSettings({ tags: [tag], showTags: true });
      }}>{t('Show in graph')}</button>
    </Modal>
  );
}
