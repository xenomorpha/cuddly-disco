import { describe, it, expect } from 'vitest';
import { Builder, link } from './builder';
import { buildGraph, localGraph, shortestPath, matchesQuery, syntheticGraph } from './graph';
import { getIndex } from './index';
import { makeAccess } from './permissions';
import { DEFAULT_GRAPH_SETTINGS, type Workspace } from './types';

/** Small workspace: root → (A, Secret); notes link across boards. Viewer "v" has no access to Secret. */
function fixture() {
  const b = new Builder('o');
  const root = 'root';
  const A = b.board(root, 0, 0, 'Board A');
  const S = b.board(root, 200, 0, 'Secret');
  const n1 = b.note(A.cardId, 0, 0, '', { title: 'Alpha' });
  const n2 = b.note(A.cardId, 0, 0, '', { title: 'Beta' });
  const n3 = b.note(S.cardId, 0, 0, '', { title: 'Hidden' });
  const orphan = b.note(A.cardId, 0, 0, 'lonely #solo', { title: 'Orphan' });
  n1.card.text = `see ${link(n2.cardId)} #research`;
  n2.card.text = `back to ${link(n1.cardId)} and ${link('gone')}`;
  n3.card.text = `secretly about ${link(n1.cardId)}`;
  b.connect(A.cardId, n1.placementId, orphan.placementId);
  const t = 1;
  const doc: Workspace = {
    id: 'w', name: 'W', ownerId: 'o', rootBoardId: root,
    members: [{ userId: 'o', role: 'owner' }, { userId: 'v', role: 'viewer' }],
    users: {},
    cards: Object.fromEntries([
      { id: root, type: 'board', title: 'Home', text: '', data: { parentId: null }, labels: [], createdBy: 'o', createdAt: t, updatedAt: t, updatedBy: 'o' },
      ...b.cards,
    ].map((c) => [c.id, c])) as Workspace['cards'],
    placements: Object.fromEntries(b.placements.map((p) => [p.id, p])),
    connectors: Object.fromEntries(b.connectors.map((c) => [c.id, c])),
    comments: {},
    permissions: { p: { id: 'p', boardId: S.cardId, userId: 'v', role: 'none' } },
    shareLinks: {}, activity: [], notifications: [], graphViews: {}, graphSettings: {}, templates: {}, favorites: {}, recent: {}, version: 1,
  };
  return { doc, ids: { A: A.cardId, S: S.cardId, n1: n1.cardId, n2: n2.cardId, n3: n3.cardId, orphan: orphan.cardId } };
}

describe('link index', () => {
  it('collects backlinks and tags', () => {
    const { doc, ids } = fixture();
    const idx = getIndex(doc);
    expect(idx.backlinks.get(ids.n1)!.map((r) => r.sourceId).sort()).toEqual([ids.n2, ids.n3].sort());
    expect(idx.tags.get('research')!.has(ids.n1)).toBe(true);
    expect(idx.resolve('alpha')).toBe(ids.n1);
    expect(idx.resolve('Board A/Beta')).toBe(ids.n2);
  });
  it('drops backlinks from trashed sources and marks trashed targets as not live', () => {
    const { doc, ids } = fixture();
    doc.cards[ids.n3] = { ...doc.cards[ids.n3], deletedAt: 5 };
    doc.cards[ids.n2] = { ...doc.cards[ids.n2], deletedAt: 5 };
    const idx = getIndex(doc);
    expect(idx.backlinks.get(ids.n1)?.length ?? 0).toBe(0);
    expect(idx.isLive(ids.n2)).toBe(false);
    expect(idx.backlinks.get(ids.n2)?.length).toBe(1); // n1 still links to it -> rendered as broken
  });
});

describe('graph', () => {
  it('owner sees everything incl. broken targets and connector edges', () => {
    const { doc, ids } = fixture();
    const g = buildGraph(doc, getIndex(doc), makeAccess(doc, 'o'), DEFAULT_GRAPH_SETTINGS);
    const nodeIds = g.nodes.map((n) => n.id);
    expect(nodeIds).toContain(ids.n3);
    expect(nodeIds).toContain('broken:gone');
    expect(g.edges.some((e) => e.kind === 'connector' && e.source === ids.n1 && e.target === ids.orphan)).toBe(true);
  });
  it('viewer never sees nodes or edges from boards they cannot access', () => {
    const { doc, ids } = fixture();
    const g = buildGraph(doc, getIndex(doc), makeAccess(doc, 'v'), DEFAULT_GRAPH_SETTINGS);
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    expect(nodeIds.has(ids.n3)).toBe(false);
    expect(nodeIds.has(ids.S)).toBe(false);
    expect(g.edges.some((e) => e.source === ids.n3 || e.target === ids.n3)).toBe(false);
    // and the restricted link target never shows up as a "broken" node either
    expect([...nodeIds].some((id) => id.includes(ids.n3))).toBe(false);
  });
  it('filters by type, tag, orphans and scope; adds tag/containment edges on request', () => {
    const { doc, ids } = fixture();
    const idx = getIndex(doc);
    const acc = makeAccess(doc, 'o');
    const s = DEFAULT_GRAPH_SETTINGS;
    expect(buildGraph(doc, idx, acc, { ...s, types: ['board'] }).nodes.every((n) => n.type === 'board' || n.kind === 'broken')).toBe(true);
    expect(buildGraph(doc, idx, acc, { ...s, tags: ['research'] }).nodes.map((n) => n.id)).toContain(ids.n1);
    const noOrphans = buildGraph(doc, idx, acc, { ...s, showOrphans: false, showConnectors: false });
    expect(noOrphans.nodes.map((n) => n.id)).not.toContain(ids.orphan);
    const scoped = buildGraph(doc, idx, acc, { ...s, rootBoardId: ids.S });
    expect(scoped.nodes.map((n) => n.id).sort()).toEqual([ids.S, ids.n3].sort());
    const withTags = buildGraph(doc, idx, acc, { ...s, showTags: true, showContainment: true });
    expect(withTags.edges.some((e) => e.kind === 'tag' && e.target === 'tag:research')).toBe(true);
    expect(withTags.edges.some((e) => e.kind === 'containment' && e.source === ids.n1 && e.target === ids.A)).toBe(true);
  });
  it('local graph, shortest path and colour-group queries', () => {
    const { doc, ids } = fixture();
    const g = buildGraph(doc, getIndex(doc), makeAccess(doc, 'o'), DEFAULT_GRAPH_SETTINGS);
    const l1 = localGraph(g, ids.orphan, 1).nodes.map((n) => n.id).sort();
    expect(l1).toEqual([ids.n1, ids.orphan].sort());
    expect(localGraph(g, ids.orphan, 2).nodes.length).toBeGreaterThan(2);
    expect(shortestPath(g, ids.orphan, ids.n3)).toEqual([ids.orphan, ids.n1, ids.n3]);
    expect(shortestPath(g, ids.orphan, ids.S)).toBeNull();
    const n1 = g.nodes.find((n) => n.id === ids.n1)!;
    expect(matchesQuery(n1, 'tag:research', () => '')).toBe(true);
    expect(matchesQuery(n1, 'type:note', () => '')).toBe(true);
    expect(matchesQuery(n1, 'board:board a', (id) => doc.cards[id].title)).toBe(true);
    expect(matchesQuery(n1, 'alp', () => '')).toBe(true);
  });
  it('synthetic benchmark graph has the requested size', () => {
    const g = syntheticGraph(5000, 15000);
    expect(g.nodes).toHaveLength(5000);
    expect(g.edges.length).toBeGreaterThan(14000);
  });
});
