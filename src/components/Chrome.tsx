// App chrome: sidebar (board tree, favourites, recent, shared, tags, trash),
// top bar (navigation, breadcrumbs, presence, actions) and the card toolbar.

import { useState } from 'react';
import type { CardType } from '../model/types';
import { getUI, lastSavedAt, redo, setUI, undo, useStore } from '../model/store';
import { boardPath, getIndex } from '../model/index';
import {
  canEditBoard, createCard, currentAccess, goBack, goForward, markNotificationsRead, openBoard, revealCard, toggleFavorite,
} from '../model/actions';
import { canView } from '../model/permissions';
import { useDoc, useUI, modKey } from '../hooks';
import { CardTypeIcon, Icon } from './icons';
import { t } from '../i18n';

// ------------------------------------------------------------------ sidebar

export function Sidebar() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const access = currentAccess();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [doc.rootBoardId]: true });
  const children = new Map<string, string[]>();
  for (const c of Object.values(doc.cards))
    if (c.type === 'board' && c.data.parentId && idx.liveBoards.has(c.id)) {
      const l = children.get(c.data.parentId) ?? [];
      l.push(c.id);
      children.set(c.data.parentId, l);
    }
  for (const l of children.values()) l.sort((a, b) => idx.title(a).localeCompare(idx.title(b)));
  const path = boardPath(doc, ui.boardId);
  const favorites = (doc.favorites[ui.userId] ?? []).filter((b) => idx.liveBoards.has(b) && access.canSee(b));
  const recent = (doc.recent[ui.userId] ?? []).filter((b) => idx.liveBoards.has(b) && access.canSee(b)).slice(0, 6);
  const shared = Object.values(doc.permissions)
    .filter((p) => p.userId === ui.userId && p.role !== 'none' && idx.liveBoards.has(p.boardId))
    .map((p) => p.boardId);
  const trashCount = Object.values(doc.cards).filter((c) => c.deletedAt).length;
  const tags = [...idx.tags.entries()].map(([tag, set]) => [tag, [...set].filter((id) => access.canSee(id)).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const Node = ({ id, depth }: { id: string; depth: number }) => {
    const kids = (children.get(id) ?? []).filter((k) => canView(access.board(k)));
    const open = expanded[id] || path.includes(id);
    const fav = favorites.includes(id);
    return (
      <li>
        <div
          className={'tree-row' + (ui.boardId === id ? ' active' : '')}
          style={{ paddingLeft: 6 + depth * 14 }}
          data-sidebar-board={id}
        >
          {kids.length ? (
            <button className="twisty" onClick={() => setExpanded((e) => ({ ...e, [id]: !open }))} aria-label={open ? t('Collapse') : t('Expand')} aria-expanded={open}>
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="twisty" />
          )}
          <button className="tree-label" onClick={() => openBoard(id)}>
            <span className="board-emoji">{doc.cards[id]?.data.icon ?? '📋'}</span>
            <span className="tree-title">{idx.title(id)}</span>
          </button>
          <span className="tree-count muted">{idx.childCount(id) || ''}</span>
          <button className={'star' + (fav ? ' on' : '')} onClick={() => toggleFavorite(id)} aria-label={fav ? t('Remove from favourites') : t('Add to favourites')} title={t('Favourite')}>
            <Icon name="star" size={13} />
          </button>
        </div>
        {open && kids.length > 0 && (
          <ul>{kids.map((k) => <Node key={k} id={k} depth={depth + 1} />)}</ul>
        )}
      </li>
    );
  };

  const List = ({ title, ids }: { title: string; ids: string[] }) =>
    ids.length ? (
      <section>
        <h4>{title}</h4>
        <ul className="flat">
          {ids.map((id) => (
            <li key={id}>
              <button className={'tree-label' + (ui.boardId === id ? ' active' : '')} onClick={() => openBoard(id)} data-sidebar-board={id}>
                <span className="board-emoji">{doc.cards[id]?.data.icon ?? '📋'}</span>
                <span className="tree-title">{idx.title(id)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <nav className="sidebar" aria-label={t('Boards')}>
      <div className="ws-name">
        <span className="logo">◉</span>
        <strong>{doc.name}</strong>
      </div>
      <button className="search-launch" onClick={() => setUI({ quickSwitcher: true })}>
        <Icon name="search" size={14} /> {t('Jump to…')} <kbd>{modKey()}K</kbd>
      </button>
      <div className="side-scroll">
        <List title={t('Favourites')} ids={favorites} />
        <List title={t('Recent')} ids={recent.filter((r) => !favorites.includes(r))} />
        <List title={t('Shared with me')} ids={shared} />
        <section>
          <h4>{t('Boards')}</h4>
          {canView(access.board(doc.rootBoardId)) ? (
            <ul className="tree"><Node id={doc.rootBoardId} depth={0} /></ul>
          ) : (
            <ul className="tree">{shared.map((s) => <Node key={s} id={s} depth={0} />)}</ul>
          )}
        </section>
        {tags.length > 0 && (
          <section>
            <h4>{t('Tags')}</h4>
            <div className="chips">
              {tags.map(([tag, n]) => (
                <button key={tag} className={'chip' + (ui.tagPage === tag ? ' on' : '')} onClick={() => setUI({ tagPage: tag })}>#{tag} <span className="muted">{n}</span></button>
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="side-foot">
        <button onClick={() => setUI({ templatesOpen: true })}><Icon name="template" size={15} /> {t('Templates')}</button>
        <button onClick={() => setUI({ trashOpen: true })} data-drop-trash><Icon name="trash" size={15} /> {t('Trash')} {trashCount > 0 && <span className="count">{trashCount}</span>}</button>
        <button onClick={() => setUI({ settingsOpen: true })}><Icon name="settings" size={15} /> {t('Settings')}</button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ top bar

export function Topbar() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const peers = useStore((s) => s.peers);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [bell, setBell] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const path = boardPath(doc, ui.boardId);
  const access = currentAccess();
  const role = access.board(ui.boardId);
  const here = Object.values(peers).filter((p) => p.boardId === ui.boardId && Date.now() - p.at < 20000);
  const notes = doc.notifications.filter((n) => n.userId === ui.userId);
  const unread = notes.filter((n) => !n.read).length;
  const me = doc.users[ui.userId];
  const fav = (doc.favorites[ui.userId] ?? []).includes(ui.boardId);

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => setUI({ sidebarOpen: !ui.sidebarOpen })} aria-label={t('Toggle sidebar')} aria-expanded={ui.sidebarOpen}><Icon name="menu" /></button>
      <button className="icon-btn" disabled={!ui.back.length} onClick={goBack} aria-label={t('Back')} title={t('Back') + ` (${modKey()}[)`}><Icon name="back" /></button>
      <button className="icon-btn" disabled={!ui.forward.length} onClick={goForward} aria-label={t('Forward')} title={t('Forward') + ` (${modKey()}])`}><Icon name="forward" /></button>
      <nav className="breadcrumbs" aria-label={t('Breadcrumb')}>
        {path.map((b, i) => (
          <span key={b} className="crumb">
            {i > 0 && <span className="sep">/</span>}
            {access.canSee(b) ? (
              <button className={i === path.length - 1 ? 'current' : ''} onClick={() => openBoard(b)} aria-current={i === path.length - 1 ? 'page' : undefined}>
                <span className="board-emoji">{doc.cards[b]?.data.icon}</span> {idx.title(b)}
              </button>
            ) : (
              <span className="muted">…</span>
            )}
          </span>
        ))}
        <button className={'star' + (fav ? ' on' : '')} onClick={() => toggleFavorite(ui.boardId)} aria-label={t('Favourite')} title={t('Favourite')}><Icon name="star" size={14} /></button>
        {role !== 'owner' && role !== 'editor' && <span className="role-pill">{t(role)}</span>}
      </nav>
      <div className="topbar-actions">
        <span className="save-dot" title={lastSavedAt ? t('Saved locally') + ' · ' + new Date(lastSavedAt).toLocaleTimeString() : t('Saved locally')}>●</span>
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title={t('Undo') + ` (${modKey()}Z)`} aria-label={t('Undo')}><Icon name="undo" /></button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title={t('Redo') + ` (${modKey()}⇧Z)`} aria-label={t('Redo')}><Icon name="redo" /></button>
        <div className="presence" aria-label={t('People on this board')}>
          {here.slice(0, 4).map((p) => (
            <span key={p.tab} className="avatar" style={{ background: p.color }} title={p.name}>{p.name[0]}</span>
          ))}
          {here.length > 4 && <span className="avatar more">+{here.length - 4}</span>}
        </div>
        <button className="icon-btn" onClick={() => setUI({ search: true })} title={t('Search') + ` (${modKey()}⇧F)`} aria-label={t('Search')}><Icon name="search" /></button>
        <button className={'icon-btn' + (ui.rightPanel === 'backlinks' ? ' on' : '')} onClick={() => setUI({ rightPanel: ui.rightPanel === 'backlinks' ? null : 'backlinks' })} title={t('Backlinks') + ` (${modKey()}⇧B)`} aria-label={t('Backlinks')}><Icon name="backlinks" /></button>
        <button className={'icon-btn' + (ui.rightPanel === 'localGraph' ? ' on' : '')} onClick={() => setUI({ rightPanel: ui.rightPanel === 'localGraph' ? null : 'localGraph' })} title={t('Local graph')} aria-label={t('Local graph')}><Icon name="connect" /></button>
        <button className="icon-btn" onClick={() => setUI({ globalGraph: true })} title={t('Graph view') + ` (${modKey()}G)`} aria-label={t('Graph view')}><Icon name="graph" /></button>
        <button className={'icon-btn' + (ui.listView ? ' on' : '')} onClick={() => setUI({ listView: !ui.listView })} title={t('List view (screen-reader friendly)')} aria-label={t('List view')} aria-pressed={ui.listView}><Icon name="list" /></button>
        <button className="icon-btn" onClick={() => setUI({ presenting: true })} title={t('Present')} aria-label={t('Present')}><Icon name="play" /></button>
        <div className="pop">
          <button className="icon-btn" onClick={() => { setBell((b) => !b); if (!bell && unread) markNotificationsRead(ui.userId); }} aria-label={t('Notifications')} title={t('Notifications')}>
            <Icon name="bell" />
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
          {bell && (
            <div className="menu notif-menu" onMouseLeave={() => setBell(false)}>
              {!notes.length && <div className="muted small pad">{t('No notifications')}</div>}
              {notes.slice(0, 20).map((n) => (
                <button key={n.id} className={n.read ? '' : 'unread'} onClick={() => { setBell(false); revealCard(n.targetId); setUI({ rightPanel: 'comments', focusCard: n.targetId }); }}>
                  <span>{n.text}</span>
                  <span className="hint">{new Date(n.at).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!ui.shareToken && (
          <button className="btn primary share-btn" onClick={() => setUI({ shareOpen: true })}><Icon name="share" size={15} /> <span className="hide-sm">{t('Share')}</span></button>
        )}
        {!ui.shareToken && me && (
          <div className="pop">
            <button className="avatar me" style={{ background: me.color }} onClick={() => setUserMenu((u) => !u)} title={t('Acting as {n} — switch to test permissions', { n: me.name })} aria-label={t('Switch user')}>
              {me.name[0]}
            </button>
            {userMenu && (
              <div className="menu user-menu" onMouseLeave={() => setUserMenu(false)}>
                <div className="muted small pad">{t('Act as (permission preview)')}</div>
                {doc.members.map((m) => {
                  const u = doc.users[m.userId];
                  return (
                    <button key={m.userId} className={m.userId === ui.userId ? 'on' : ''} onClick={() => { setUserMenu(false); switchUser(m.userId); }}>
                      <span className="avatar xs" style={{ background: u.color }}>{u.name[0]}</span>
                      <span>{u.name}</span>
                      <span className="hint">{t(m.role)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export function switchUser(userId: string) {
  const doc = useStore.getState().doc!;
  setUI({ userId, selection: [], focusCard: null });
  try {
    localStorage.setItem('nodeboard:user', userId);
  } catch {
    /* ignore */
  }
  // if the new user can't see the current board, go to the first one they can
  const access = currentAccess();
  if (!canView(access.board(getUI().boardId))) {
    const first = Object.values(doc.cards).find((c) => c.type === 'board' && canView(access.board(c.id)) && getIndex(doc).liveBoards.has(c.id));
    if (first) openBoard(first.id);
  }
}

// ------------------------------------------------------------------ card toolbar

const TOOL_TYPES: { type: CardType | 'line'; label: string; key?: string }[] = [
  { type: 'note', label: 'Note', key: 'N' },
  { type: 'document', label: 'Document', key: 'D' },
  { type: 'todo', label: 'To-do', key: 'T' },
  { type: 'board', label: 'Board', key: 'B' },
  { type: 'column', label: 'Column', key: 'C' },
  { type: 'line', label: 'Line', key: 'L' },
  { type: 'image', label: 'Image', key: 'I' },
  { type: 'link', label: 'Link', key: 'U' },
  { type: 'file', label: 'File / audio', key: 'F' },
  { type: 'table', label: 'Table', key: 'E' },
  { type: 'sketch', label: 'Sketch', key: 'S' },
  { type: 'swatch', label: 'Colour', key: 'K' },
  { type: 'map', label: 'Map', key: 'M' },
  { type: 'comment', label: 'Comment', key: 'O' },
];

export const TOOL_KEYS = Object.fromEntries(TOOL_TYPES.filter((x) => x.key).map((x) => [x.key!.toLowerCase(), x.type]));

export function addAtCenter(type: CardType | 'line') {
  const ui = getUI();
  if (type === 'line') {
    setUI({ tool: ui.tool === 'connect' ? 'select' : 'connect' });
    return;
  }
  const el = document.querySelector('.canvas') as HTMLElement | null;
  const vp = ui.viewports[ui.boardId] ?? { x: 120, y: 90, zoom: 1 };
  const r = el?.getBoundingClientRect() ?? { width: 800, height: 600 };
  const jitter = () => (Math.random() - 0.5) * 60;
  const x = (r.width / 2 - vp.x) / vp.zoom - 120 + jitter();
  const y = (r.height / 2 - vp.y) / vp.zoom - 60 + jitter();
  const { placementId } = createCard(type, { x, y });
  if (['note', 'todo', 'board', 'column', 'link', 'table', 'comment', 'sketch', 'swatch', 'map'].includes(type))
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('nb:edit', { detail: placementId })));
}

export function Toolbar() {
  const ui = useUI();
  const editable = canEditBoard(ui.boardId);
  if (!editable) return null;
  return (
    <aside className="toolbar" aria-label={t('Add cards')}>
      {TOOL_TYPES.map((tt) => (
        <button
          key={tt.type}
          className={'tool' + (tt.type === 'line' && ui.tool === 'connect' ? ' on' : '')}
          draggable={tt.type !== 'line'}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-nodeboard-type', tt.type);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => addAtCenter(tt.type)}
          title={`${t(tt.label)}${tt.key ? ` (${tt.key})` : ''} — ${tt.type === 'line' ? t('click, then drag between two cards') : t('click or drag onto the board')}`}
          aria-label={t(tt.label)}
        >
          <CardTypeIcon type={tt.type} size={19} />
          <span>{t(tt.label)}</span>
        </button>
      ))}
      <div className="toolbar-spacer" />
      <div className="tool trash-target" data-drop-trash title={t('Drag cards here to delete')} onClick={() => setUI({ trashOpen: true })}>
        <Icon name="trash" size={19} />
        <span>{t('Trash')}</span>
      </div>
    </aside>
  );
}
