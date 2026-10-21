// A database with several saved views (table, board, list, gallery, calendar),
// each with its own filters, sorts, grouping and visible properties.

import { useMemo, useState } from 'react';
import type { Card, DbProp, DbSchema, DbView, FilterOp, PropKind, ViewKind } from '../../model/types';
import { PROP_KINDS, VIEW_KINDS } from '../../model/types';
import {
  PROP_ICONS, PROP_LABELS, VIEW_ICONS, VIEW_LABELS, applyView, convertValue, defaultSchema, groupRows, makeView, monthGrid, newProp, rowTitle,
  shiftMonth, valueForGroup,
} from '../../model/database';
import { addRow, currentAccess, deleteRows, reorderRow, setRowValue, updateCard, updateDb } from '../../model/actions';
import { canEdit } from '../../model/permissions';
import { getIndex } from '../../model/index';
import { getDoc, setUI, uid } from '../../model/store';
import { WikiEditor } from '../WikiEditor';
import { useDoc } from '../../hooks';
import { Icon } from '../icons';
import { Markdown } from '../Markdown';
import { OptionChip, PropCell, PropDisplay } from './PropValue';
import { t } from '../../i18n';

interface Ctx {
  db: Card;
  schema: DbSchema;
  view: DbView;
  rows: Card[];
  editable: boolean;
  visible: DbProp[];
}

export function DatabaseView({ dbId, full }: { dbId: string; full?: boolean }) {
  const doc = useDoc();
  const db = doc.cards[dbId];
  const schema = db?.data.db ?? defaultSchema();
  const view = schema.views.find((v) => v.id === schema.activeView) ?? schema.views[0];
  const editable = !!db && canEdit(currentAccess().card(dbId));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(false);
  const [addingView, setAddingView] = useState(false);
  const allRows = getIndex(doc).rowsByDb.get(dbId) ?? [];
  const rows = useMemo(() => (view ? applyView(allRows, schema, view, query, doc.users) : []), [allRows, schema, view, query, doc.users]);
  if (!db || !view) return null;
  const visible = schema.props.filter((p) => !view.hidden.includes(p.id));
  const ctx: Ctx = { db, schema, view, rows, editable, visible };
  const filtersOn = view.filters.length + view.sorts.length;

  const newRow = () => {
    // a new row inherits values that make it pass simple "is" filters
    const values: Record<string, string> = {};
    for (const f of view.filters) if (f.op === 'is' && f.value && f.prop !== 'title') values[f.prop] = f.value;
    const id = addRow(dbId, values);
    setUI({ rowPage: id });
  };

  return (
    <div className={'database' + (full ? ' full' : '')}>
      <div className="db-head">
        <Icon name="database" size={full ? 22 : 17} />
        {editable ? (
          <input
            className="db-title interactive"
            value={db.title}
            placeholder={t('Untitled database')}
            onChange={(e) => updateCard(dbId, { title: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t('Database title')}
          />
        ) : (
          <span className="db-title">{db.title || t('Untitled database')}</span>
        )}
        <span className="muted small">{allRows.length}</span>
        {!full && (
          <button className="icon-btn interactive" title={t('Open as full page')} onClick={() => setUI({ dbPage: dbId })}>
            <Icon name="zoomfit" size={15} />
          </button>
        )}
      </div>
      <div className="db-bar interactive" onPointerDown={(e) => e.stopPropagation()}>
        <div className="db-tabs" role="tablist">
          {schema.views.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === view.id}
              className={'db-tab' + (v.id === view.id ? ' on' : '')}
              onClick={() => updateDb(dbId, (d) => { d.activeView = v.id; }, 'view')}
              onDoubleClick={() => editable && setSettings(true)}
            >
              <Icon name={VIEW_ICONS[v.kind]} size={14} /> {v.name}
            </button>
          ))}
          {editable && (
            <span className="pop">
              <button className="icon-btn" onClick={() => setAddingView((a) => !a)} title={t('Add a view')} aria-label={t('Add a view')}><Icon name="plus" size={14} /></button>
              {addingView && (
                <div className="menu db-menu">
                  {VIEW_KINDS.map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        const nv = makeView(k, schema, t(VIEW_LABELS[k]));
                        updateDb(dbId, (d) => { d.views.push(nv); d.activeView = nv.id; });
                        setAddingView(false);
                      }}
                    >
                      <Icon name={VIEW_ICONS[k]} size={15} /> {t(VIEW_LABELS[k])}
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
        <div className="db-actions">
          {searching ? (
            <input className="db-search" autoFocus value={query} placeholder={t('Search rows…')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { setQuery(''); setSearching(false); } }} onBlur={() => !query && setSearching(false)} />
          ) : (
            <button className="icon-btn" onClick={() => setSearching(true)} title={t('Search rows')} aria-label={t('Search rows')}><Icon name="search" size={15} /></button>
          )}
          <span className="pop">
            <button className={'icon-btn' + (filtersOn ? ' on' : '')} onClick={() => setSettings((s) => !s)} title={t('View settings: filter, sort, properties')} aria-label={t('View settings')}>
              <Icon name="filter" size={15} />
              {filtersOn > 0 && <span className="badge">{filtersOn}</span>}
            </button>
            {settings && <ViewSettings ctx={ctx} onClose={() => setSettings(false)} />}
          </span>
          {editable && <button className="btn small primary" onClick={newRow}><Icon name="plus" size={13} /> {t('New')}</button>}
        </div>
      </div>
      <div className={'db-body interactive' + (full ? '' : ' no-wheel')} onPointerDown={(e) => e.stopPropagation()}>
        {view.kind === 'table' && <TableView ctx={ctx} onNew={newRow} />}
        {view.kind === 'board' && <BoardView ctx={ctx} />}
        {view.kind === 'list' && <ListView ctx={ctx} />}
        {view.kind === 'gallery' && <GalleryView ctx={ctx} />}
        {view.kind === 'calendar' && <CalendarView ctx={ctx} />}
        {!rows.length && view.kind !== 'calendar' && view.kind !== 'board' && (
          <div className="db-none muted small">{allRows.length ? t('No rows match this view.') : t('No rows yet.')}</div>
        )}
      </div>
    </div>
  );
}

const openRow = (id: string) => setUI({ rowPage: id, focusCard: id });

// ------------------------------------------------------------------ table

function TableView({ ctx, onNew }: { ctx: Ctx; onNew: () => void }) {
  const { db, view, rows, editable, visible } = ctx;
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const manual = !view.sorts.length;
  return (
    <table className="db-table">
      <thead>
        <tr>
          <th className="db-title-col">
            <button className="db-th" onClick={() => setMenu(menu === 'title' ? null : 'title')}><Icon name="text" size={13} /> {t('Name')}</button>
            {menu === 'title' && <PropMenu ctx={ctx} propId="title" onClose={() => setMenu(null)} />}
          </th>
          {visible.map((p) => (
            <th key={p.id}>
              <button className="db-th" onClick={() => setMenu(menu === p.id ? null : p.id)}><Icon name={PROP_ICONS[p.kind]} size={13} /> {p.name}</button>
              {menu === p.id && <PropMenu ctx={ctx} propId={p.id} onClose={() => setMenu(null)} />}
            </th>
          ))}
          {editable && (
            <th className="db-add-col">
              <span className="pop">
                <button className="icon-btn" onClick={() => setAdding((a) => !a)} title={t('Add a property')} aria-label={t('Add a property')}><Icon name="plus" size={14} /></button>
                {adding && (
                  <div className="menu db-menu right">
                    {PROP_KINDS.map((k) => (
                      <button key={k} onClick={() => { updateDb(db.id, (d) => { d.props.push(newProp(k, t(PROP_LABELS[k]))); }); setAdding(false); }}>
                        <Icon name={PROP_ICONS[k]} size={14} /> {t(PROP_LABELS[k])}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className={drag === r.id ? 'dragging' : ''}
            draggable={editable && manual}
            onDragStart={(e) => { setDrag(r.id); e.dataTransfer.setData('text/x-row', r.id); e.stopPropagation(); }}
            onDragOver={(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (drag !== r.id) reorderRow(drag, r.id, db.id); setDrag(null); }}
            onDragEnd={() => setDrag(null)}
          >
            <td className="db-title-col">
              <TitleCell row={r} editable={editable} />
            </td>
            {visible.map((p) => (
              <td key={p.id} className={'kind-' + p.kind}><PropCell dbId={db.id} prop={p} row={r} editable={editable} /></td>
            ))}
            {editable && <td />}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{editable && <button className="link-btn" onClick={onNew}><Icon name="plus" size={13} /> {t('New')}</button>}</td>
          {visible.map((p) => (
            <td key={p.id} className="muted small db-calc">
              {p.kind === 'number' && rows.length > 0 ? `${t('Sum')} ${rows.reduce((s, r) => s + (Number(r.data.values?.[p.id]) || 0), 0).toLocaleString()}` : ''}
              {p.kind === 'checkbox' && rows.length > 0 ? `${rows.filter((r) => r.data.values?.[p.id] === true).length}/${rows.length}` : ''}
            </td>
          ))}
          {editable && <td />}
        </tr>
      </tfoot>
    </table>
  );
}

function TitleCell({ row, editable }: { row: Card; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const backlinks = getIndex(useDoc()).backlinks.get(row.id)?.length ?? 0;
  return (
    <div className="db-title-cell">
      {editing && editable ? (
        <input
          autoFocus
          defaultValue={row.title}
          onChange={(e) => updateCard(row.id, { title: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') setEditing(false); }}
          aria-label={t('Name')}
        />
      ) : (
        <span className={'db-row-title' + (row.title ? '' : ' muted')} onClick={() => (editable ? setEditing(true) : openRow(row.id))}>
          <Icon name="row" size={13} /> {rowTitle(row) === 'Untitled' ? t('Untitled') : row.title}
        </span>
      )}
      {backlinks > 0 && <span className="db-bl" title={t('{n} backlinks', { n: backlinks })}><Icon name="backlinks" size={11} />{backlinks}</span>}
      <button className="db-open" onClick={() => openRow(row.id)} title={t('Open as page')}><Icon name="external" size={12} /> {t('Open')}</button>
    </div>
  );
}

function PropMenu({ ctx, propId, onClose }: { ctx: Ctx; propId: string; onClose: () => void }) {
  const { db, schema, view, editable } = ctx;
  const prop = schema.props.find((p) => p.id === propId);
  const sortBy = (dir: 'asc' | 'desc') => {
    updateDb(db.id, (d) => {
      const v = d.views.find((x) => x.id === view.id)!;
      v.sorts = [{ prop: propId, dir }];
    });
    onClose();
  };
  const changeKind = (k: PropKind) => {
    if (!prop || k === prop.kind) return;
    const rows = getIndex(getDoc()).rowsByDb.get(db.id) ?? [];
    const opts = k === 'select' || k === 'multiselect' ? prop.options?.length ? prop.options : [] : undefined;
    updateDb(db.id, (d) => {
      const p = d.props.find((x) => x.id === propId)!;
      p.kind = k;
      p.options = opts ? [...opts] : undefined;
    });
    for (const r of rows) {
      const v = r.data.values?.[propId];
      if (v !== undefined) setRowValue(r.id, propId, convertValue(v, prop, k, opts ?? []));
    }
  };
  return (
    <div className="menu db-menu prop-menu" onPointerDown={(e) => e.stopPropagation()}>
      {prop && editable && (
        <>
          <input
            autoFocus
            defaultValue={prop.name}
            onChange={(e) => updateDb(db.id, (d) => { const p = d.props.find((x) => x.id === propId); if (p) p.name = e.target.value; }, 'propname:' + propId)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') onClose(); }}
            aria-label={t('Property name')}
          />
          <label className="field">
            <span>{t('Type')}</span>
            <select value={prop.kind} onChange={(e) => changeKind(e.target.value as PropKind)}>
              {PROP_KINDS.map((k) => <option key={k} value={k}>{t(PROP_LABELS[k])}</option>)}
            </select>
          </label>
          <div className="menu-sep" />
        </>
      )}
      <button onClick={() => sortBy('asc')}><Icon name="arrowUp" size={14} /> {t('Sort ascending')}</button>
      <button onClick={() => sortBy('desc')}><Icon name="arrowDown" size={14} /> {t('Sort descending')}</button>
      {prop && (
        <button onClick={() => { updateDb(db.id, (d) => { const v = d.views.find((x) => x.id === view.id)!; v.hidden.push(propId); }); onClose(); }}>
          <Icon name="eyeOff" size={14} /> {t('Hide in this view')}
        </button>
      )}
      {prop && editable && (
        <button className="danger" onClick={() => {
          if (!confirm(t('Delete the property "{p}" and its values?', { p: prop.name }))) return;
          updateDb(db.id, (d) => {
            d.props = d.props.filter((p) => p.id !== propId);
            for (const v of d.views) {
              v.filters = v.filters.filter((f) => f.prop !== propId);
              v.sorts = v.sorts.filter((s) => s.prop !== propId);
              if (v.groupBy === propId) v.groupBy = null;
              if (v.dateProp === propId) v.dateProp = null;
            }
          });
          onClose();
        }}>
          <Icon name="trash" size={14} /> {t('Delete property')}
        </button>
      )}
      <button onClick={onClose}><Icon name="close" size={14} /> {t('Close')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ board

function BoardView({ ctx }: { ctx: Ctx }) {
  const doc = useDoc();
  const { db, schema, view, rows, editable, visible } = ctx;
  const prop = schema.props.find((p) => p.id === view.groupBy);
  const [over, setOver] = useState<string | null>(null);
  const groupable = schema.props.filter((p) => p.kind === 'select' || p.kind === 'multiselect' || p.kind === 'person' || p.kind === 'checkbox');
  if (!prop)
    return (
      <div className="db-setup">
        <p className="muted">{t('Choose a property to group the board by.')}</p>
        {groupable.length ? (
          <div className="row wrap">
            {groupable.map((p) => (
              <button key={p.id} className="btn small" onClick={() => updateDb(db.id, (d) => { d.views.find((v) => v.id === view.id)!.groupBy = p.id; })}>
                <Icon name={PROP_ICONS[p.kind]} size={13} /> {p.name}
              </button>
            ))}
          </div>
        ) : editable ? (
          <button className="btn small" onClick={() => {
            const p = newProp('select', t('Status'));
            updateDb(db.id, (d) => { d.props.push(p); d.views.find((v) => v.id === view.id)!.groupBy = p.id; });
          }}>{t('Add a Select property')}</button>
        ) : null}
      </div>
    );
  const groups = groupRows(rows, prop, doc.users, doc.members.map((m) => m.userId));
  const cardProps = visible.filter((p) => p.id !== prop.id);
  return (
    <div className="db-board">
      {groups.map((g) => (
        <div
          key={g.key || 'none'}
          className={'db-col' + (over === g.key ? ' over' : '')}
          onDragOver={(e) => { if (editable && e.dataTransfer.types.includes('text/x-row')) { e.preventDefault(); setOver(g.key); } }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(null);
            const [rowId, from] = e.dataTransfer.getData('text/x-row').split('|');
            const row = doc.cards[rowId];
            if (!row) return;
            setRowValue(rowId, prop.id, valueForGroup(prop, g.key, row.data.values?.[prop.id], from));
          }}
        >
          <div className="db-col-head">
            {g.key && g.color ? <OptionChip name={g.label} color={g.color} /> : <span className="muted">{prop.kind === 'checkbox' ? t(g.label) : g.key ? g.label : t('No {p}', { p: prop.name })}</span>}
            <span className="muted small">{g.rows.length}</span>
          </div>
          {g.rows.map((r) => (
            <div
              key={r.id}
              className="db-tile"
              draggable={editable}
              onDragStart={(e) => { e.dataTransfer.setData('text/x-row', `${r.id}|${g.key}`); e.stopPropagation(); }}
              onClick={() => openRow(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openRow(r.id)}
            >
              <div className="db-tile-title">{r.title || <span className="muted">{t('Untitled')}</span>}</div>
              {cardProps.map((p) =>
                r.data.values?.[p.id] !== undefined ? <div key={p.id} className="db-tile-prop"><PropDisplay prop={p} value={r.data.values?.[p.id]} compact /></div> : null,
              )}
            </div>
          ))}
          {editable && (
            <button className="link-btn small" onClick={() => openRow(addRow(db.id, g.key ? { [prop.id]: valueForGroup(prop, g.key, undefined, '') } : {}))}>
              <Icon name="plus" size={12} /> {t('New')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ list & gallery

function ListView({ ctx }: { ctx: Ctx }) {
  const { rows, visible } = ctx;
  return (
    <div className="db-list">
      {rows.map((r) => (
        <button key={r.id} className="db-list-row" onClick={() => openRow(r.id)}>
          <Icon name="row" size={14} />
          <span className="db-list-title">{r.title || <span className="muted">{t('Untitled')}</span>}</span>
          <span className="db-list-props">
            {visible.map((p) => (r.data.values?.[p.id] !== undefined ? <PropDisplay key={p.id} prop={p} value={r.data.values?.[p.id]} compact /> : null))}
          </span>
        </button>
      ))}
    </div>
  );
}

function GalleryView({ ctx }: { ctx: Ctx }) {
  const { rows, visible } = ctx;
  return (
    <div className="db-gallery">
      {rows.map((r) => (
        <button key={r.id} className="db-gcard" onClick={() => openRow(r.id)}>
          <div className="db-gcover">{r.text ? <Markdown text={r.text} maxLines={5} className="tiny" /> : <Icon name="row" size={22} />}</div>
          <div className="db-gbody">
            <div className="db-tile-title">{r.title || <span className="muted">{t('Untitled')}</span>}</div>
            {visible.map((p) => (r.data.values?.[p.id] !== undefined ? <div key={p.id} className="db-tile-prop"><PropDisplay prop={p} value={r.data.values?.[p.id]} compact /></div> : null))}
          </div>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ calendar

function CalendarView({ ctx }: { ctx: Ctx }) {
  const { db, schema, view, rows, editable } = ctx;
  const prop = schema.props.find((p) => p.id === view.dateProp && p.kind === 'date');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const dates = schema.props.filter((p) => p.kind === 'date');
  if (!prop)
    return (
      <div className="db-setup">
        <p className="muted">{t('Choose a date property for the calendar.')}</p>
        <div className="row wrap">
          {dates.map((p) => (
            <button key={p.id} className="btn small" onClick={() => updateDb(db.id, (d) => { d.views.find((v) => v.id === view.id)!.dateProp = p.id; })}>
              <Icon name="calendar" size={13} /> {p.name}
            </button>
          ))}
          {editable && !dates.length && (
            <button className="btn small" onClick={() => {
              const p = newProp('date', t('Date'));
              updateDb(db.id, (d) => { d.props.push(p); d.views.find((v) => v.id === view.id)!.dateProp = p.id; });
            }}>{t('Add a Date property')}</button>
          )}
        </div>
      </div>
    );
  const grid = monthGrid(month);
  const today = new Date().toISOString().slice(0, 10);
  const byDay = new Map<string, Card[]>();
  for (const r of rows) {
    const v = r.data.values?.[prop.id];
    if (typeof v === 'string') byDay.set(v, [...(byDay.get(v) ?? []), r]);
  }
  const undated = rows.filter((r) => !r.data.values?.[prop.id]).length;
  const label = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }));
  return (
    <div className="db-cal">
      <div className="db-cal-head">
        <strong>{label}</strong>
        <span className="muted small">{undated ? t('{n} without a date', { n: undated }) : ''}</span>
        <div className="row">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('Previous month')}><Icon name="back" size={14} /></button>
          <button className="btn small" onClick={() => setMonth(today.slice(0, 7))}>{t('Today')}</button>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('Next month')}><Icon name="forward" size={14} /></button>
        </div>
      </div>
      <div className="db-cal-grid">
        {weekdays.map((w) => <div key={w} className="db-cal-wd">{w}</div>)}
        {grid.map((d) => (
          <div
            key={d}
            className={'db-day' + (d.slice(0, 7) !== month ? ' other' : '') + (d === today ? ' today' : '') + (over === d ? ' over' : '')}
            onDragOver={(e) => { if (editable && e.dataTransfer.types.includes('text/x-row')) { e.preventDefault(); setOver(d); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(null); setRowValue(e.dataTransfer.getData('text/x-row').split('|')[0], prop.id, d); }}
          >
            <div className="db-day-n">
              {Number(d.slice(8))}
              {editable && <button className="db-day-add" onClick={() => openRow(addRow(db.id, { [prop.id]: d }))} aria-label={t('New row on {d}', { d })}><Icon name="plus" size={11} /></button>}
            </div>
            {(byDay.get(d) ?? []).map((r) => (
              <button key={r.id} className="db-event" draggable={editable} onDragStart={(e) => { e.dataTransfer.setData('text/x-row', r.id); e.stopPropagation(); }} onClick={() => openRow(r.id)}>
                {r.title || t('Untitled')}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ view settings

const OPS: Record<string, FilterOp[]> = {
  text: ['contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty'],
  url: ['contains', 'notContains', 'empty', 'notEmpty'],
  number: ['is', 'isNot', 'gt', 'lt', 'empty', 'notEmpty'],
  select: ['is', 'isNot', 'empty', 'notEmpty'],
  multiselect: ['is', 'isNot', 'empty', 'notEmpty'],
  person: ['is', 'isNot', 'empty', 'notEmpty'],
  date: ['is', 'before', 'after', 'empty', 'notEmpty'],
  checkbox: ['checked', 'unchecked'],
};
const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains', notContains: 'does not contain', is: 'is', isNot: 'is not', empty: 'is empty', notEmpty: 'is not empty',
  gt: '>', lt: '<', before: 'is before', after: 'is after', checked: 'is checked', unchecked: 'is unchecked',
};

function ViewSettings({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const doc = useDoc();
  const { db, schema, view, editable } = ctx;
  const mut = (fn: (v: DbView) => void) => updateDb(db.id, (d) => { const v = d.views.find((x) => x.id === view.id); if (v) fn(v as DbView); }, 'viewset:' + view.id);
  const propsAll: { id: string; name: string; kind: PropKind }[] = [{ id: 'title', name: t('Name'), kind: 'text' }, ...schema.props];
  return (
    <>
      <div className="ctx-backdrop" onPointerDown={onClose} />
      <div className="menu db-menu view-settings" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('View settings')}>
        <div className="vs-row">
          <input value={view.name} disabled={!editable} onChange={(e) => mut((v) => { v.name = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('View name')} />
        </div>
        <div className="vs-kinds">
          {VIEW_KINDS.map((k: ViewKind) => (
            <button key={k} className={view.kind === k ? 'on' : ''} onClick={() => mut((v) => {
              v.kind = k;
              if (k === 'board' && !v.groupBy) v.groupBy = schema.props.find((p) => p.kind === 'select')?.id ?? null;
              if (k === 'calendar' && !v.dateProp) v.dateProp = schema.props.find((p) => p.kind === 'date')?.id ?? null;
            })}>
              <Icon name={VIEW_ICONS[k]} size={15} /><span>{t(VIEW_LABELS[k])}</span>
            </button>
          ))}
        </div>
        {view.kind === 'board' && (
          <label className="field"><span>{t('Group by')}</span>
            <select value={view.groupBy ?? ''} onChange={(e) => mut((v) => { v.groupBy = e.target.value || null; })}>
              <option value="">—</option>
              {schema.props.filter((p) => ['select', 'multiselect', 'person', 'checkbox'].includes(p.kind)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {view.kind === 'calendar' && (
          <label className="field"><span>{t('Date property')}</span>
            <select value={view.dateProp ?? ''} onChange={(e) => mut((v) => { v.dateProp = e.target.value || null; })}>
              <option value="">—</option>
              {schema.props.filter((p) => p.kind === 'date').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}

        <h5>{t('Filter')}</h5>
        {view.filters.map((f, i) => {
          const p = propsAll.find((x) => x.id === f.prop);
          const kind = p?.kind ?? 'text';
          const needsValue = !['empty', 'notEmpty', 'checked', 'unchecked'].includes(f.op);
          const opts = schema.props.find((x) => x.id === f.prop)?.options ?? [];
          return (
            <div key={f.id} className="vs-filter">
              <select value={f.prop} onChange={(e) => mut((v) => { const np = propsAll.find((x) => x.id === e.target.value); v.filters[i] = { ...v.filters[i], prop: e.target.value, op: OPS[np?.kind ?? 'text'][0], value: '' }; })}>
                {propsAll.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <select value={f.op} onChange={(e) => mut((v) => { v.filters[i].op = e.target.value as FilterOp; })}>
                {OPS[kind].map((o) => <option key={o} value={o}>{t(OP_LABELS[o])}</option>)}
              </select>
              {needsValue && (kind === 'select' || kind === 'multiselect' ? (
                <select value={f.value ?? ''} onChange={(e) => mut((v) => { v.filters[i].value = e.target.value; })}>
                  <option value="">—</option>
                  {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : kind === 'person' ? (
                <select value={f.value ?? ''} onChange={(e) => mut((v) => { v.filters[i].value = e.target.value; })}>
                  <option value="">—</option>
                  {doc.members.map((m) => <option key={m.userId} value={m.userId}>{doc.users[m.userId]?.name}</option>)}
                </select>
              ) : (
                <input type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'} value={f.value ?? ''} onChange={(e) => mut((v) => { v.filters[i].value = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} />
              ))}
              <button className="icon-btn" onClick={() => mut((v) => { v.filters.splice(i, 1); })} aria-label={t('Remove filter')}><Icon name="close" size={13} /></button>
            </div>
          );
        })}
        <button className="link-btn small" onClick={() => mut((v) => { v.filters.push({ id: uid(), prop: schema.props[0]?.id ?? 'title', op: OPS[schema.props[0]?.kind ?? 'text'][0], value: '' }); })}>
          <Icon name="plus" size={12} /> {t('Add filter')}
        </button>

        <h5>{t('Sort')}</h5>
        {view.sorts.map((s, i) => (
          <div key={i} className="vs-filter">
            <select value={s.prop} onChange={(e) => mut((v) => { v.sorts[i].prop = e.target.value; })}>
              {[...propsAll, { id: 'created', name: t('Created'), kind: 'date' as PropKind }].map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={s.dir} onChange={(e) => mut((v) => { v.sorts[i].dir = e.target.value as 'asc' | 'desc'; })}>
              <option value="asc">{t('Ascending')}</option>
              <option value="desc">{t('Descending')}</option>
            </select>
            <button className="icon-btn" onClick={() => mut((v) => { v.sorts.splice(i, 1); })} aria-label={t('Remove sort')}><Icon name="close" size={13} /></button>
          </div>
        ))}
        <button className="link-btn small" onClick={() => mut((v) => { v.sorts.push({ prop: 'title', dir: 'asc' }); })}><Icon name="plus" size={12} /> {t('Add sort')}</button>

        <h5>{t('Properties')}</h5>
        {schema.props.map((p) => {
          const shown = !view.hidden.includes(p.id);
          return (
            <button key={p.id} className="vs-prop" onClick={() => mut((v) => { v.hidden = shown ? [...v.hidden, p.id] : v.hidden.filter((x) => x !== p.id); })}>
              <Icon name={PROP_ICONS[p.kind]} size={14} /> <span className="grow">{p.name}</span> <Icon name={shown ? 'eye' : 'eyeOff'} size={14} />
            </button>
          );
        })}
        {editable && schema.views.length > 1 && (
          <>
            <div className="menu-sep" />
            <button className="danger" onClick={() => { updateDb(db.id, (d) => { d.views = d.views.filter((v) => v.id !== view.id); d.activeView = d.views[0].id; }); onClose(); }}>
              <Icon name="trash" size={14} /> {t('Delete this view')}
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ row page

export function RowPage({ rowId }: { rowId: string }) {
  const doc = useDoc();
  const row = doc.cards[rowId];
  const db = row?.data.databaseId ? doc.cards[row.data.databaseId] : undefined;
  if (!row || !db?.data.db) return null;
  const schema = db.data.db;
  const editable = canEdit(currentAccess().card(rowId));
  const idx = getIndex(doc);
  const backlinks = idx.backlinks.get(rowId)?.length ?? 0;
  const close = () => setUI({ rowPage: null });
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide row-page" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={rowTitle(row)} onKeyDown={(e) => e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea, input, select') && close()}>
        <div className="modal-head">
          <button className="link-btn small" onClick={close}><Icon name="database" size={13} /> {db.title || t('Untitled database')}</button>
          <div className="row">
            <button className="btn small" onClick={() => setUI({ rowPage: null, rightPanel: 'backlinks', focusCard: rowId })}><Icon name="backlinks" size={13} /> {backlinks}</button>
            <button className="btn small" onClick={() => setUI({ rowPage: null, rightPanel: 'comments', focusCard: rowId })}><Icon name="comment" size={13} /> {Object.values(doc.comments).filter((c) => c.targetId === rowId).length}</button>
            {editable && <button className="btn small danger" onClick={() => { deleteRows([rowId]); close(); }}><Icon name="trash" size={13} /></button>}
            <button className="icon-btn" onClick={close} aria-label={t('Close')}><Icon name="close" /></button>
          </div>
        </div>
        <div className="modal-body">
          {editable ? (
            <input className="row-title" autoFocus={!row.title} value={row.title} placeholder={t('Untitled')} onChange={(e) => updateCard(rowId, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Name')} />
          ) : (
            <h2 className="row-title">{rowTitle(row)}</h2>
          )}
          <div className="row-props">
            {schema.props.map((p) => (
              <div key={p.id} className="row-prop">
                <span className="row-prop-name"><Icon name={PROP_ICONS[p.kind]} size={14} /> {p.name}</span>
                <PropCell dbId={db.id} prop={p} row={row} editable={editable} placeholder />
              </div>
            ))}
          </div>
          <div className="row-body">
            {editable ? (
              <RowBodyEditor rowId={rowId} />
            ) : (
              <Markdown text={row.text} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowBodyEditor({ rowId }: { rowId: string }) {
  const doc = useDoc();
  const row = doc.cards[rowId];
  return <WikiEditor value={row.text} selfId={rowId} onChange={(text) => updateCard(rowId, { text })} toolbar minRows={8} placeholder={t('Write notes for this row… [[links]] and #tags work here')} />;
}

export function DatabasePage({ dbId }: { dbId: string }) {
  return (
    <div className="db-page" role="dialog" aria-label={t('Database')}>
      <div className="db-page-head">
        <button className="icon-btn" onClick={() => setUI({ dbPage: null })} aria-label={t('Close')}><Icon name="back" /></button>
      </div>
      <DatabaseView dbId={dbId} full />
    </div>
  );
}
