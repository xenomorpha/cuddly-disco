import { describe, it, expect } from 'vitest';
import { applyView, convertValue, defaultSchema, groupRows, makeView, monthGrid, newProp, shiftMonth, valueForGroup, valueText } from './database';
import type { Card } from './types';

const schema = defaultSchema();
const [status, tags, due, owner] = schema.props;
const [todo, doing, done] = status.options!;
tags.options = [{ id: 'w', name: 'writing', color: '' }, { id: 'e', name: 'eng', color: '' }];
const est = newProp('number', 'Estimate');
schema.props.push(est);
const users = { u1: { name: 'Ann' }, u2: { name: 'Bob' } };

let order = 0;
function row(title: string, values: Card['data']['values'], text = ''): Card {
  return { id: title, type: 'row', title, text, labels: [], createdBy: 'u1', createdAt: order, updatedAt: 0, updatedBy: 'u1', data: { databaseId: 'db', values, order: ++order } };
}
const rows = [
  row('Alpha', { [status.id]: doing.id, [tags.id]: ['w'], [due.id]: '2026-10-05', [owner.id]: 'u1', [est.id]: 3 }),
  row('Beta', { [status.id]: done.id, [tags.id]: ['w', 'e'], [due.id]: '2026-10-20', [est.id]: 1 }, 'about graphs'),
  row('Gamma', { [status.id]: todo.id, [owner.id]: 'u2' }),
  row('Delta', {}),
];

describe('database views', () => {
  it('default schema has typed props and three views', () => {
    expect(schema.props.map((p) => p.kind).slice(0, 4)).toEqual(['select', 'multiselect', 'date', 'person']);
    expect(schema.views.map((v) => v.kind)).toEqual(['table', 'board', 'calendar']);
    expect(schema.views[1].groupBy).toBe(status.id);
    expect(schema.views[2].dateProp).toBe(due.id);
  });
  it('filters, searches and sorts', () => {
    const v = makeView('table', schema);
    expect(applyView(rows, schema, v, '').map((r) => r.id)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: status.id, op: 'is', value: done.id }] }, '').map((r) => r.id)).toEqual(['Beta']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: tags.id, op: 'is', value: 'w' }] }, '').map((r) => r.id)).toEqual(['Alpha', 'Beta']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: owner.id, op: 'empty' }] }, '').map((r) => r.id)).toEqual(['Beta', 'Delta']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: est.id, op: 'gt', value: '2' }] }, '').map((r) => r.id)).toEqual(['Alpha']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: due.id, op: 'before', value: '2026-10-10' }] }, '').map((r) => r.id)).toEqual(['Alpha']);
    expect(applyView(rows, schema, { ...v, filters: [{ id: 'f', prop: 'title', op: 'contains', value: 'ta' }] }, '').map((r) => r.id)).toEqual(['Beta', 'Delta']);
    expect(applyView(rows, schema, v, 'graphs').map((r) => r.id)).toEqual(['Beta']);
    expect(applyView(rows, schema, v, 'ann', users).map((r) => r.id)).toEqual(['Alpha']);
    expect(applyView(rows, schema, { ...v, sorts: [{ prop: est.id, dir: 'asc' }] }, '').map((r) => r.id)).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta']);
    expect(applyView(rows, schema, { ...v, sorts: [{ prop: status.id, dir: 'desc' }] }, '').map((r) => r.id).slice(0, 3)).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(applyView(rows, schema, { ...v, sorts: [{ prop: 'title', dir: 'asc' }] }, '').map((r) => r.id)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });
  it('groups for board views (multi-select rows appear in each column)', () => {
    const g = groupRows(rows, status, users);
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([
      ['No Status', ['Delta']], ['Not started', ['Gamma']], ['In progress', ['Alpha']], ['Done', ['Beta']],
    ]);
    const gt = groupRows(rows, tags, users);
    expect(gt.find((x) => x.key === 'w')!.rows.map((r) => r.id)).toEqual(['Alpha', 'Beta']);
    expect(gt.find((x) => x.key === 'e')!.rows.map((r) => r.id)).toEqual(['Beta']);
    const gp = groupRows(rows, owner, users, ['u1', 'u2']);
    expect(gp.map((x) => x.label)).toEqual(['No Owner', 'Ann', 'Bob']);
  });
  it('computes the value when a card is dropped into a column', () => {
    expect(valueForGroup(status, done.id, doing.id, doing.id)).toBe(done.id);
    expect(valueForGroup(status, '', doing.id, doing.id)).toBeNull();
    expect(valueForGroup(tags, 'e', ['w'], 'w')).toEqual(['e']);
    expect(valueForGroup(tags, 'e', ['w'], '')).toEqual(['w', 'e']);
  });
  it('converts values between property types', () => {
    expect(convertValue(3, est, 'text')).toBe('3');
    expect(convertValue('42', newProp('text', 't'), 'number')).toBe(42);
    expect(convertValue(doing.id, status, 'multiselect', status.options)).toEqual([doing.id]);
    expect(convertValue('yes', newProp('text', 't'), 'checkbox')).toBe(true);
    expect(valueText(['w', 'e'], tags, users)).toBe('writing, eng');
  });
  it('builds month grids starting on Monday', () => {
    const g = monthGrid('2026-10');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-09-28');
    expect(g).toContain('2026-10-31');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
