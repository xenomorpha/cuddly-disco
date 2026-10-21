// Databases (Notion-style): a schema of typed properties and several saved
// views over the same rows. Rows are ordinary cards (type "row") so they can
// be linked with [[…]], have backlinks and comments, and appear in search and
// the graph. Everything here is pure so it can be unit-tested.

import type { Card, DbFilter, DbOption, DbProp, DbSchema, DbValue, DbView, PropKind, ViewKind } from './types';

export const OPTION_COLORS = ['#dfe6e9', '#ffeaa7', '#fab1a0', '#ff7675', '#fd79a8', '#a29bfe', '#74b9ff', '#81ecec', '#55efc4', '#b2bec3'];

let n = 0;
const rid = () => (globalThis.crypto?.randomUUID?.() ?? 'id' + Date.now().toString(36) + (n++).toString(36));

export function option(name: string, i: number): DbOption {
  return { id: rid(), name, color: OPTION_COLORS[(i + 1) % OPTION_COLORS.length] };
}

export function makeView(kind: ViewKind, schema: Pick<DbSchema, 'props'>, name?: string): DbView {
  const groupable = schema.props.find((p) => p.kind === 'select') ?? schema.props.find((p) => p.kind === 'person' || p.kind === 'checkbox');
  const date = schema.props.find((p) => p.kind === 'date');
  return {
    id: rid(),
    name: name ?? VIEW_LABELS[kind],
    kind,
    groupBy: kind === 'board' ? groupable?.id ?? null : null,
    dateProp: kind === 'calendar' ? date?.id ?? null : null,
    sorts: [],
    filters: [],
    hidden: [],
  };
}

export const VIEW_LABELS: Record<ViewKind, string> = { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar' };
export const VIEW_ICONS: Record<ViewKind, string> = { table: 'table', board: 'kanban', list: 'list', gallery: 'gallery', calendar: 'calendar' };
export const PROP_ICONS: Record<PropKind, string> = {
  text: 'text', number: 'number', select: 'select', multiselect: 'multiselect', date: 'calendar', checkbox: 'checkbox', person: 'person', url: 'link',
};
export const PROP_LABELS: Record<PropKind, string> = {
  text: 'Text', number: 'Number', select: 'Select', multiselect: 'Multi-select', date: 'Date', checkbox: 'Checkbox', person: 'Person', url: 'URL',
};

/** A new database: Status / Tags / Due / Owner, with table, board and calendar views. */
export function defaultSchema(): DbSchema {
  const props: DbProp[] = [
    {
      id: rid(),
      name: 'Status',
      kind: 'select',
      options: [
        { id: rid(), name: 'Not started', color: '#dfe6e9' },
        { id: rid(), name: 'In progress', color: '#74b9ff' },
        { id: rid(), name: 'Done', color: '#55efc4' },
      ],
    },
    { id: rid(), name: 'Tags', kind: 'multiselect', options: [] },
    { id: rid(), name: 'Due', kind: 'date' },
    { id: rid(), name: 'Owner', kind: 'person' },
  ];
  const views = [makeView('table', { props }), makeView('board', { props }), makeView('calendar', { props })];
  return { props, views, activeView: views[0].id };
}

export function newProp(kind: PropKind, name: string): DbProp {
  return { id: rid(), name, kind, options: kind === 'select' || kind === 'multiselect' ? [] : undefined };
}

// ---------------------------------------------------------------- values

export function isEmpty(v: DbValue | undefined): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
}

/** Convert a value when a property changes type. */
export function convertValue(v: DbValue | undefined, from: DbProp, to: PropKind, toOptions: DbOption[] = []): DbValue {
  if (v === undefined || v === null) return null;
  const text = valueText(v, from, {});
  switch (to) {
    case 'number': {
      const n = parseFloat(String(text));
      return isNaN(n) ? null : n;
    }
    case 'checkbox':
      return v === true || /^(true|yes|1|done)$/i.test(String(text));
    case 'select': {
      const name = Array.isArray(v) ? text.split(', ')[0] : text;
      return toOptions.find((o) => o.name === name)?.id ?? null;
    }
    case 'multiselect':
      return text.split(', ').map((nm) => toOptions.find((o) => o.name === nm)?.id).filter(Boolean) as string[];
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
    default:
      return text || null;
  }
}

/** Plain-text form of a value (search, sort, export). */
export function valueText(v: DbValue | undefined, prop: DbProp, users: Record<string, { name: string }>): string {
  if (v === null || v === undefined) return '';
  switch (prop.kind) {
    case 'select':
      return prop.options?.find((o) => o.id === v)?.name ?? '';
    case 'multiselect':
      return (Array.isArray(v) ? v : []).map((id) => prop.options?.find((o) => o.id === id)?.name).filter(Boolean).join(', ');
    case 'person':
      return users[String(v)]?.name ?? '';
    case 'checkbox':
      return v ? 'true' : 'false';
    default:
      return String(v);
  }
}

// ---------------------------------------------------------------- view evaluation

export function rowTitle(row: Card) {
  return row.title?.trim() || 'Untitled';
}

function cmpValues(a: DbValue | undefined, b: DbValue | undefined, prop: DbProp | null, users: Record<string, { name: string }>): number {
  const ea = isEmpty(a) && prop?.kind !== 'checkbox';
  const eb = isEmpty(b) && prop?.kind !== 'checkbox';
  if (ea && eb) return 0;
  if (ea) return 1; // empties last
  if (eb) return -1;
  if (prop?.kind === 'number') return Number(a) - Number(b);
  if (prop?.kind === 'checkbox') return Number(!!a) - Number(!!b);
  if (prop?.kind === 'select') {
    const ia = prop.options?.findIndex((o) => o.id === a) ?? 0;
    const ib = prop.options?.findIndex((o) => o.id === b) ?? 0;
    return ia - ib;
  }
  const sa = prop ? valueText(a, prop, users) : String(a);
  const sb = prop ? valueText(b, prop, users) : String(b);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

export function matchFilter(row: Card, f: DbFilter, schema: DbSchema, users: Record<string, { name: string }>): boolean {
  const prop = schema.props.find((p) => p.id === f.prop) ?? null;
  const raw: DbValue | undefined = f.prop === 'title' ? row.title : row.data.values?.[f.prop];
  const text = (f.prop === 'title' ? row.title ?? '' : prop ? valueText(raw, prop, users) : '').toLowerCase();
  const val = (f.value ?? '').toLowerCase();
  switch (f.op) {
    case 'contains':
      return text.includes(val);
    case 'notContains':
      return !text.includes(val);
    case 'is':
      if (prop?.kind === 'select' || prop?.kind === 'person') return raw === f.value;
      if (prop?.kind === 'multiselect') return Array.isArray(raw) && raw.includes(f.value ?? '');
      return text === val;
    case 'isNot':
      if (prop?.kind === 'select' || prop?.kind === 'person') return raw !== f.value;
      if (prop?.kind === 'multiselect') return !(Array.isArray(raw) && raw.includes(f.value ?? ''));
      return text !== val;
    case 'empty':
      return isEmpty(raw);
    case 'notEmpty':
      return !isEmpty(raw);
    case 'gt':
      return raw !== null && raw !== undefined && raw !== '' && Number(raw) > Number(f.value);
    case 'lt':
      return raw !== null && raw !== undefined && raw !== '' && Number(raw) < Number(f.value);
    case 'before':
      return !!raw && String(raw) < (f.value ?? '');
    case 'after':
      return !!raw && String(raw) > (f.value ?? '');
    case 'checked':
      return raw === true;
    case 'unchecked':
      return raw !== true;
  }
}

/** Rows visible in a view: filters (AND), quick search, then sorts (manual order last). */
export function applyView(rows: Card[], schema: DbSchema, view: DbView, query: string, users: Record<string, { name: string }> = {}): Card[] {
  const q = query.trim().toLowerCase();
  let out = rows.filter((r) => view.filters.every((f) => matchFilter(r, f, schema, users)));
  if (q)
    out = out.filter((r) =>
      [r.title, r.text, ...schema.props.map((p) => valueText(r.data.values?.[p.id], p, users))].join('\n').toLowerCase().includes(q),
    );
  return [...out].sort((a, b) => {
    for (const s of view.sorts) {
      const prop = schema.props.find((p) => p.id === s.prop) ?? null;
      const va: DbValue | undefined = s.prop === 'title' ? a.title : s.prop === 'created' ? a.createdAt : a.data.values?.[s.prop];
      const vb: DbValue | undefined = s.prop === 'title' ? b.title : s.prop === 'created' ? b.createdAt : b.data.values?.[s.prop];
      // empty values always sort last, whatever the direction
      const ea = isEmpty(va) && prop?.kind !== 'checkbox';
      const eb = isEmpty(vb) && prop?.kind !== 'checkbox';
      if (ea !== eb) return ea ? 1 : -1;
      const c = s.prop === 'created' ? Number(va) - Number(vb) : cmpValues(va, vb, prop, users);
      if (c) return s.dir === 'asc' ? c : -c;
    }
    return (a.data.order ?? 0) - (b.data.order ?? 0);
  });
}

export interface Group {
  key: string; // option id / user id / 'true' / 'false' / '' for "no value"
  label: string;
  color?: string;
  rows: Card[];
}

/** Columns for a board view. Multi-select rows appear in every matching column. */
export function groupRows(rows: Card[], prop: DbProp | undefined, users: Record<string, { name: string }>, members: string[] = []): Group[] {
  if (!prop) return [{ key: '', label: '', rows }];
  let groups: Group[];
  if (prop.kind === 'select' || prop.kind === 'multiselect') groups = (prop.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color, rows: [] }));
  else if (prop.kind === 'checkbox') groups = [{ key: 'false', label: 'Unchecked', rows: [] }, { key: 'true', label: 'Checked', rows: [] }];
  else if (prop.kind === 'person') groups = members.map((m) => ({ key: m, label: users[m]?.name ?? m, rows: [] }));
  else groups = [];
  const none: Group = { key: '', label: 'No ' + prop.name, rows: [] };
  for (const r of rows) {
    const v = r.data.values?.[prop.id];
    if (prop.kind === 'checkbox') {
      groups[v === true ? 1 : 0].rows.push(r);
      continue;
    }
    const keys = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [String(v)];
    const hit = groups.filter((g) => keys.includes(g.key));
    if (hit.length) hit.forEach((g) => g.rows.push(r));
    else none.rows.push(r);
  }
  return prop.kind === 'checkbox' ? groups : [none, ...groups].filter((g, i) => i > 0 || g.rows.length > 0 || groups.length === 0);
}

/** Value to store when a row is dropped into a board column. */
export function valueForGroup(prop: DbProp, key: string, current: DbValue | undefined, fromKey: string): DbValue {
  if (prop.kind === 'checkbox') return key === 'true';
  if (prop.kind === 'multiselect') {
    const cur = Array.isArray(current) ? current.filter((k) => k !== fromKey) : [];
    return key ? [...new Set([...cur, key])] : cur;
  }
  return key || null;
}

// ---------------------------------------------------------------- calendar

/** 6×7 grid of ISO dates covering the month of `ym` ("2026-10"), weeks starting Monday. */
export function monthGrid(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(y, m - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86400_000).toISOString().slice(0, 10));
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
