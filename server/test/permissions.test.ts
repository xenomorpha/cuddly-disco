// The SQL permission functions must agree with src/model/permissions.ts on
// every (principal, board/card) pair, for the client's own test fixture, the
// demo workspace, and a few mutations of them.

import { afterEach, describe, expect, it } from 'vitest';
import { boardChain, boardRole, makeAccess } from '../../src/model/permissions';
import { getIndex } from '../../src/model/index';
import type { Db } from '../src/db';
import { importWorkspace, type ImportDoc } from '../src/importWorkspace';
import { demoDoc, DEMO } from '../src/seed';
import { freshDb } from './helpers';

const card = (id: string, type: string, parentId: string | null = null) =>
  ({ id, type, title: id, text: '', data: type === 'board' ? { parentId } : {}, labels: [], createdBy: 'o', createdAt: 0, updatedAt: 0, updatedBy: 'o' }) as any;
const pl = (id: string, cardId: string, boardId: string, deletedAt: number | null = null) =>
  ({ id, cardId, boardId, order: 0, x: 0, y: 0, w: 1, z: 0, deletedAt });

/** The fixture from src/model/permissions.test.ts, plus an unplaced card and a deleted placement. */
function fixture(): ImportDoc {
  return {
    id: 'w', name: 'W', ownerId: 'o', rootBoardId: 'root',
    users: Object.fromEntries(['o', 'e', 'v', 'g'].map((id) => [id, { id, name: id, email: `${id}@x`, color: '#000' }])),
    members: [
      { userId: 'o', role: 'owner' },
      { userId: 'e', role: 'editor' },
      { userId: 'v', role: 'viewer' },
    ],
    cards: Object.fromEntries([
      card('root', 'board'), card('a', 'board', 'root'), card('a1', 'board', 'a'), card('secret', 'board', 'root'),
      card('n1', 'note'), card('n2', 'note'), card('n3', 'note'), card('n4', 'note'), card('n5', 'note'),
    ].map((c) => [c.id, c])),
    placements: Object.fromEntries([
      pl('p1', 'n1', 'a1'), pl('p2', 'n2', 'secret'), pl('p3', 'n2', 'a'), pl('p4', 'n3', 'secret'),
      pl('p5', 'n5', 'a', 1), pl('p6', 'n5', 'secret'),
    ].map((p) => [p.id, p])),
    permissions: {
      x1: { id: 'x1', boardId: 'secret', userId: 'e', role: 'none' },
      x2: { id: 'x2', boardId: 'a', userId: 'v', role: 'commenter' },
      x3: { id: 'x3', boardId: 'a1', userId: 'v', role: 'viewer' },
      x4: { id: 'x4', boardId: 'a', userId: 'g', role: 'editor' }, // guest: not a member
    },
    shareLinks: { secret: { boardId: 'secret', token: 'tok', enabled: true, allowDuplicate: false } },
  };
}

const PRINCIPALS = ['o', 'e', 'v', 'g', 'stranger', 'link:tok', 'link:bad'];

let db: Db;
afterEach(async () => db?.close());

async function load(doc: ImportDoc) {
  db = await freshDb();
  await db.tx((q) => importWorkspace(q, doc));
}

/** Compares all four SQL functions against the client for every principal and id. */
async function expectParity(doc: ImportDoc, principals: string[]) {
  const ws = { ...doc, permissions: doc.permissions ?? {}, shareLinks: doc.shareLinks ?? {} } as any;
  const boards = Object.values(doc.cards).filter((c) => c.type === 'board').map((c) => c.id);
  const cards = Object.keys(doc.cards);
  for (const p of principals) {
    const acc = makeAccess(ws, p);
    const setBoards = Object.fromEntries((await db.query('select board_id, role from board_roles($1, $2)', [p, doc.id])).rows.map((r) => [r.board_id, r.role]));
    const setCards = Object.fromEntries((await db.query('select card_id, role from card_roles($1, $2)', [p, doc.id])).rows.map((r) => [r.card_id, r.role]));
    for (const b of boards) {
      const want = boardRole(ws, p, b);
      const one = (await db.query('select board_role($1, $2) as r', [p, b])).rows[0].r;
      expect({ p, b, r: one }).toEqual({ p, b, r: want });
      expect({ p, b, r: setBoards[b] }).toEqual({ p, b, r: want });
    }
    for (const c of cards) {
      const want = acc.card(c);
      const one = (await db.query('select card_role($1, $2) as r', [p, c])).rows[0].r;
      expect({ p, c, r: one }).toEqual({ p, c, r: want });
      expect({ p, c, r: setCards[c] }).toEqual({ p, c, r: want });
    }
  }
}

describe('SQL permission resolution matches permissions.ts', () => {
  it('client fixture: owner, fallback, overrides, inheritance, guests, share links, synced cards', async () => {
    await load(fixture());
    await expectParity(fixture(), PRINCIPALS);
  });

  it('spot checks from the client tests', async () => {
    await load(fixture());
    const role = async (p: string, b: string) => (await db.query('select board_role($1, $2) as r', [p, b])).rows[0].r;
    const crole = async (p: string, c: string) => (await db.query('select card_role($1, $2) as r', [p, c])).rows[0].r;
    expect(await role('o', 'secret')).toBe('owner');
    expect(await role('e', 'a1')).toBe('editor');
    expect(await role('e', 'secret')).toBe('none');
    expect(await role('v', 'a')).toBe('commenter');
    expect(await role('v', 'a1')).toBe('viewer');
    expect(await role('v', 'root')).toBe('viewer');
    expect(await role('stranger', 'root')).toBe('none');
    expect(await role('link:tok', 'secret')).toBe('viewer');
    expect(await role('link:tok', 'a')).toBe('none');
    expect(await role('g', 'a1')).toBe('editor');
    expect(await role('g', 'root')).toBe('none');
    expect(await crole('e', 'n2')).toBe('editor'); // synced into board a
    expect(await crole('e', 'n3')).toBe('none'); // only on the secret board
    expect(await crole('v', 'n2')).toBe('commenter'); // best role across placements
    expect(await crole('v', 'n4')).toBe('viewer'); // unplaced -> root role
    expect(await crole('e', 'n5')).toBe('none'); // deleted placement on a doesn't count
    expect(await crole('e', 'missing')).toBe('none');
  });

  it('disabled share link grants nothing', async () => {
    const doc = fixture();
    doc.shareLinks!.secret.enabled = false;
    await load(doc);
    await expectParity(doc, ['link:tok', 'e']);
  });

  it('board chain is cycle-safe', async () => {
    const doc = fixture();
    doc.cards.root.data.parentId = 'a1';
    await load(doc);
    const chain = (await db.query('select board_id from board_chain($1) order by depth', ['a1'])).rows.map((r) => r.board_id);
    expect(chain).toEqual(boardChain(doc as any, 'a1'));
    expect(chain).toEqual(['a1', 'a', 'root']);
    await expectParity(doc, PRINCIPALS);
  });

  it('nearest override wins over a farther one, including "none" re-granted lower down', async () => {
    const doc = fixture();
    doc.permissions!.x5 = { id: 'x5', boardId: 'root', userId: 'e', role: 'none' };
    doc.permissions!.x6 = { id: 'x6', boardId: 'a1', userId: 'e', role: 'commenter' };
    await load(doc);
    await expectParity(doc, ['e']);
    expect((await db.query("select board_role('e', 'a') as r")).rows[0].r).toBe('none');
    expect((await db.query("select board_role('e', 'a1') as r")).rows[0].r).toBe('commenter');
  });

  it('demo workspace', async () => {
    const doc = demoDoc();
    await load(doc);
    await expectParity(doc, [...Object.values(DEMO.users), 'link:' + DEMO.shareToken]);
    const samBoards = (await db.query("select board_id from board_roles($1, $2) where role <> 'none' order by 1", [DEMO.users.sam, DEMO.workspace])).rows.map((r) => r.board_id);
    expect(samBoards).not.toContain('b-journal');
    expect(samBoards).toContain('b-research');
  });
});

describe('live_cards matches the client index', () => {
  it('demo workspace with a trashed card and a trashed board subtree', async () => {
    const doc = demoDoc();
    doc.cards['b-interviews'].deletedAt = 1; // hides Round 1 and everything on both boards
    await load(doc);
    const idx = getIndex({ ...doc, comments: {} } as any);
    const live = new Set((await db.query('select card_id from live_cards($1)', [doc.id])).rows.map((r) => r.card_id));
    for (const id of Object.keys(doc.cards)) expect({ id, live: live.has(id) }).toEqual({ id, live: idx.isLive(id) });
    expect(live.has('c-old-idea')).toBe(false);
    expect(live.has('c-summary')).toBe(false);
    expect(live.has('c-insight')).toBe(true);
  });
});
