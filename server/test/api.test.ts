// Endpoints on the seeded demo workspace, as different principals.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db';
import { buildApp } from '../src/app';
import { DEMO, seedDemo } from '../src/seed';
import { freshDb } from './helpers';

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await freshDb();
  await db.tx(seedDemo);
  app = await buildApp(db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

type Who = keyof typeof DEMO.tokens | 'link' | 'anon';
const headers = (who: Who): Record<string, string> =>
  who === 'anon' ? {} : who === 'link' ? { 'x-share-token': DEMO.shareToken } : { authorization: `Bearer ${DEMO.tokens[who]}` };
const get = (who: Who, url: string) => app.inject({ method: 'GET', url, headers: headers(who) });
const send = (who: Who, method: 'PUT' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: headers(who), payload });

const graph = async (who: Who, qs = '') => {
  const r = await get(who, `/workspaces/${DEMO.workspace}/graph${qs}`);
  expect(r.statusCode).toBe(200);
  return r.json() as { nodes: { id: string; kind: string; degree: number; boardId: string | null }[]; edges: { source: string; target: string; kind: string }[] };
};

describe('auth', () => {
  it('rejects missing and bad credentials', async () => {
    expect((await get('anon', '/me')).statusCode).toBe(401);
    expect((await app.inject({ url: '/me', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/me', headers: { 'x-share-token': 'nope' } })).statusCode).toBe(401);
    expect((await get('sam', '/me')).json().user.name).toBe('Sam Lee');
    expect((await get('link', '/me')).json()).toMatchObject({ principal: 'link:' + DEMO.shareToken, kind: 'link' });
  });
  it('serves the OpenAPI document without auth', async () => {
    const r = await get('anon', '/openapi.json');
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json().paths)).toEqual(expect.arrayContaining(['/workspaces/{id}/graph', '/cards/{id}/backlinks']));
  });
});

describe('GET /workspaces/:id/graph', () => {
  it('owner sees everything, including the private journal and broken links', async () => {
    const g = await graph('ksenia');
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['b-journal', 'c-reflections', 'c-insight', 'broken:missing-target-demo', 'broken:Pricing research']));
    expect(ids).not.toContain('c-old-idea'); // trashed
    expect(g.edges).toContainEqual({ source: 'c-reflections', target: 'c-insight', kind: 'link' });
    expect(g.edges).toContainEqual({ source: 'c-insight', target: 'c-graph-note', kind: 'connector' });
    expect(g.edges).toContainEqual({ source: 'c-brief', target: 'c-insight', kind: 'link' }); // from the comment
  });

  it('a viewer gets no nodes or edges from a board hidden from them', async () => {
    const owner = await graph('ksenia');
    const g = await graph('sam');
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has('b-journal')).toBe(false);
    expect(ids.has('c-reflections')).toBe(false);
    expect(g.edges.some((e) => e.source === 'c-reflections' || e.target === 'c-reflections')).toBe(false);
    // degree is computed on the filtered graph
    const insight = (x: typeof g) => x.nodes.find((n) => n.id === 'c-insight')!.degree;
    expect(insight(g)).toBe(insight(owner) - 1);
    // the synced to-do is still visible (it is on Project plan and Home)
    expect(ids.has('c-todo')).toBe(true);
  });

  it('a guest only sees their board subtree; hidden parents are not revealed', async () => {
    const g = await graph('casey');
    const ids = g.nodes.filter((n) => n.kind !== 'broken').map((n) => n.id).sort();
    expect(ids).toEqual(['b-interviews', 'b-research', 'b-round1', 'c-graph-note', 'c-insight', 'c-leo', 'c-maya', 'c-summary']);
    expect(g.nodes.find((n) => n.id === 'b-research')!.boardId).toBeNull(); // parent Home is hidden
    // c-insight links to c-brief (on Home, hidden): dropped, not shown as broken
    expect(g.nodes.some((n) => n.id === 'broken:c-brief')).toBe(false);
    expect(g.edges.some((e) => e.target === 'c-brief')).toBe(false);
  });

  it('a share link sees only the shared board', async () => {
    const g = await graph('link');
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['b-mood', 'c-mood-note', 'c-swatch']);
  });

  it('filters: root, types, tags, orphans, containment, tag nodes, local graph', async () => {
    const research = await graph('ksenia', '?root=b-interviews');
    expect(research.nodes.filter((n) => n.kind !== 'broken').map((n) => n.id).sort()).toEqual(['b-interviews', 'b-round1', 'c-leo', 'c-maya', 'c-summary']);
    const notes = await graph('ksenia', '?types=note&broken=false');
    expect(notes.nodes.every((n) => (n as any).type === 'note')).toBe(true);
    const tagged = await graph('ksenia', '?tags=interview');
    expect(tagged.nodes.map((n) => n.id).sort()).toEqual(['c-leo', 'c-maya']);
    const noOrphans = await graph('ksenia', '?orphans=false');
    expect(noOrphans.nodes.every((n) => n.degree > 0)).toBe(true);
    expect(noOrphans.nodes.some((n) => n.id === 'c-swatch')).toBe(false);
    const contain = await graph('ksenia', '?containment=true');
    expect(contain.edges).toContainEqual({ source: 'b-research', target: 'b-home', kind: 'containment' });
    const tags = await graph('ksenia', '?tagNodes=true');
    expect(tags.edges).toContainEqual({ source: 'c-maya', target: 'tag:interview', kind: 'tag' });
    const local = await graph('ksenia', '?center=c-leo&depth=1');
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['c-leo', 'c-maya', 'c-summary']);
    const local2 = await graph('ksenia', '?center=c-leo&depth=2');
    expect(local2.nodes.map((n) => n.id)).toContain('c-insight');
  });

  it('404s for a workspace the principal cannot see', async () => {
    expect((await get('ksenia', '/workspaces/nope/graph')).statusCode).toBe(404);
  });
});

describe('GET /cards/:id/backlinks', () => {
  it('lists every visible source with a snippet, grouped by board', async () => {
    const r = await get('ksenia', '/cards/c-insight/backlinks');
    expect(r.statusCode).toBe(200);
    const rows = r.json();
    expect(rows.map((b: any) => [b.sourceId, b.field])).toEqual(expect.arrayContaining([
      ['c-maya', 'text'], ['c-reflections', 'text'], ['c-todo', 'item:i1'], ['c-brief', 'comment:cm-1'],
    ]));
    const maya = rows.find((b: any) => b.sourceId === 'c-maya');
    expect(maya).toMatchObject({ boardId: 'b-interviews', boardTitle: 'Interviews', sourceTitle: 'Interview — Maya' });
    expect(maya.snippet.match).toBe('People think spatially');
    expect(rows.map((b: any) => b.boardTitle)).toEqual([...rows.map((b: any) => b.boardTitle)].sort((a: string, b: string) => a.localeCompare(b)));
  });

  it('drops sources on boards the viewer cannot see', async () => {
    const ids = (await get('sam', '/cards/c-insight/backlinks')).json().map((b: any) => b.sourceId);
    expect(ids).toContain('c-maya');
    expect(ids).not.toContain('c-reflections');
  });

  it('snippets never print the title of a hidden target', async () => {
    // c-insight's own text links to c-brief, which Casey cannot see
    await send('ksenia', 'PUT', '/cards/c-graph-note', { text: 'See [[@c-insight]] and [[@c-brief]] together. #research' });
    const row = (await get('casey', '/cards/c-insight/backlinks')).json().find((b: any) => b.sourceId === 'c-graph-note');
    expect(row.snippet.after).toContain('missing');
    expect(row.snippet.after).not.toContain('Product brief');
    const own = (await get('ksenia', '/cards/c-insight/backlinks')).json().find((b: any) => b.sourceId === 'c-graph-note');
    expect(own.snippet.after).toContain('Product brief');
  });

  it('404s on a target the viewer cannot see, filters with q, sorts by date', async () => {
    expect((await get('sam', '/cards/c-reflections/backlinks')).statusCode).toBe(404);
    const q = (await get('ksenia', '/cards/c-insight/backlinks?q=maya')).json();
    expect(q.map((b: any) => b.sourceId)).toEqual(['c-maya']);
    const byDate = (await get('ksenia', '/cards/c-insight/backlinks?sort=date')).json();
    const times = byDate.map((b: any) => Date.parse(b.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('writes re-index links', () => {
  it('saving a card updates backlinks and the graph immediately', async () => {
    const created = await send('alex', 'PUT', '/cards/c-new', { type: 'note', boardId: 'b-plan', text: `Kickoff notes, see [[@c-leo|Leo's interview]] #kickoff` });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'c-new', tags: ['kickoff'], createdBy: DEMO.users.alex });
    const back = (await get('alex', '/cards/c-leo/backlinks')).json();
    expect(back.find((b: any) => b.sourceId === 'c-new')).toMatchObject({ alias: "Leo's interview", boardId: 'b-plan' });
    const g = await graph('alex');
    expect(g.edges).toContainEqual({ source: 'c-new', target: 'c-leo', kind: 'link' });

    // deleting the target turns the link into a broken node
    expect((await send('alex', 'DELETE', '/cards/c-leo')).statusCode).toBe(204);
    const g2 = await graph('alex');
    expect(g2.nodes.some((n) => n.id === 'c-leo')).toBe(false);
    expect(g2.edges).toContainEqual({ source: 'c-new', target: 'broken:c-leo', kind: 'link' });
  });

  it('enforces roles on writes', async () => {
    expect((await send('sam', 'PUT', '/cards/c-insight', { text: 'hi' })).statusCode).toBe(403);
    expect((await send('sam', 'PUT', '/cards/c-reflections', { text: 'hi' })).statusCode).toBe(404);
    expect((await send('casey', 'PUT', '/cards/c-x', { type: 'note', boardId: 'b-research', text: 'x' })).statusCode).toBe(403);
    expect((await send('link', 'PUT', '/cards/c-mood-note', { text: 'x' })).statusCode).toBe(403);
    // commenters can comment, and comment links are indexed
    const c = await send('casey', 'POST', '/cards/c-maya/comments', { body: 'Compare with [[@c-summary]]' });
    expect(c.statusCode).toBe(201);
    const back = (await get('casey', '/cards/c-summary/backlinks')).json();
    expect(back.some((b: any) => b.sourceId === 'c-maya' && b.field.startsWith('comment:'))).toBe(true);
    expect((await send('sam', 'POST', '/cards/c-maya/comments', { body: 'x' })).statusCode).toBe(403);
  });
});

describe('boards, sharing, search, mentions', () => {
  it('GET /boards/:id hides board tiles and cards the viewer cannot see', async () => {
    const own = (await get('ksenia', '/boards/b-home')).json();
    const sam = (await get('sam', '/boards/b-home')).json();
    expect(own.cards.map((c: any) => c.id)).toContain('b-journal');
    expect(sam.cards.map((c: any) => c.id)).not.toContain('b-journal');
    expect(sam.connectors.map((c: any) => c.label)).toEqual(['start here']);
    expect((await get('sam', '/boards/b-journal')).statusCode).toBe(404);
  });

  it('permission overrides take effect on every endpoint', async () => {
    expect((await send('alex', 'PUT', `/boards/b-research/permissions/${DEMO.users.sam}`, { role: 'none' })).statusCode).toBe(403);
    const r = await send('ksenia', 'PUT', `/boards/b-research/permissions/${DEMO.users.sam}`, { role: 'none' });
    expect(r.json()).toMatchObject({ role: 'none', effective: 'none' });
    expect((await graph('sam')).nodes.some((n) => n.id === 'c-maya')).toBe(false);
    expect((await get('sam', '/cards/c-maya')).statusCode).toBe(404);
    const perms = (await get('ksenia', '/boards/b-interviews/permissions')).json();
    expect(perms.effective.find((e: any) => e.userId === DEMO.users.sam).role).toBe('none'); // inherited
    await send('ksenia', 'PUT', `/boards/b-research/permissions/${DEMO.users.sam}`, { role: null });
    expect((await get('sam', '/cards/c-maya')).statusCode).toBe(200);
  });

  it('share links: password and disable', async () => {
    const created = await send('ksenia', 'POST', '/boards/b-plan/share-link', { password: 'hunter2' });
    expect(created.statusCode).toBe(201);
    const { token } = created.json();
    expect((await app.inject({ url: '/boards/b-plan', headers: { 'x-share-token': token } })).statusCode).toBe(401);
    const ok = await app.inject({ url: '/boards/b-plan', headers: { 'x-share-token': token, 'x-share-password': 'hunter2' } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ url: '/boards/b-mood', headers: { 'x-share-token': token, 'x-share-password': 'hunter2' } })).statusCode).toBe(404);
    await send('ksenia', 'PATCH', `/share-links/${token}`, { enabled: false });
    expect((await app.inject({ url: '/boards/b-plan', headers: { 'x-share-token': token, 'x-share-password': 'hunter2' } })).statusCode).toBe(401);
  });

  it('search is permission-filtered', async () => {
    const own = (await get('ksenia', '/search?q=reflections')).json();
    expect(own.map((r: any) => r.id)).toContain('c-reflections');
    expect((await get('sam', '/search?q=reflections')).json()).toEqual([]);
    const tagged = (await get('sam', '/search?q=people&tag=research')).json();
    expect(tagged.map((r: any) => r.id)).toContain('c-insight');
  });

  it('unlinked mentions find plain-text titles on visible cards', async () => {
    const own = (await get('ksenia', '/cards/c-insight/mentions')).json();
    expect(own.map((m: any) => m.sourceId)).toContain('c-mood-note');
    expect(own.every((m: any) => m.snippet.match.toLowerCase() === 'people think spatially')).toBe(true);
    expect((await get('casey', '/cards/c-insight/mentions')).json()).toEqual([]); // Moodboard is not Casey's
  });
});
