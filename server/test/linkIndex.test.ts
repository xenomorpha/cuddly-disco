import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cardTitle, getIndex } from '../../src/model/index';
import type { Db } from '../src/db';
import { importWorkspace } from '../src/importWorkspace';
import { indexCard, indexComment } from '../src/linkIndex';
import { demoDoc } from '../src/seed';
import { freshDb } from './helpers';

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.tx((q) => importWorkspace(q, demoDoc()));
});
afterEach(() => db.close());

const linksFrom = async (id: string) =>
  (await db.query('select source_field, target_id, target_ref, target_anchor, alias, comment_id from links where source_card_id = $1 order by source_field, position', [id])).rows;
const tagsOf = async (id: string) =>
  (await db.query('select t.name from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = $1 order by 1', [id])).rows.map((r) => r.name);

describe('link index', () => {
  it('stores id, anchor and alias for each [[link]]', async () => {
    expect(await linksFrom('c-insight')).toEqual([
      { source_field: 'text', target_id: 'c-brief', target_ref: null, target_anchor: 'Goals', alias: 'the brief', comment_id: null },
    ]);
  });

  it('keeps broken and unresolved links', async () => {
    const rows = await linksFrom('c-summary');
    expect(rows.map((r) => r.target_id ?? 'ref:' + r.target_ref)).toEqual(['c-maya', 'c-leo', 'missing-target-demo', 'ref:Pricing research']);
  });

  it('indexes to-do items, and comment links as references from the commented card', async () => {
    const rows = await linksFrom('c-todo');
    expect(rows.map((r) => [r.source_field, r.target_id, r.target_anchor])).toEqual([
      ['item:i1', 'c-insight', null],
      ['item:i3', 'c-brief', 'Audience'],
    ]);
    const brief = await linksFrom('c-brief');
    expect(brief).toContainEqual({ source_field: 'comment:cm-1', target_id: 'c-insight', target_ref: null, target_anchor: null, alias: null, comment_id: 'cm-1' });
  });

  it('matches the client link index for every live card', async () => {
    const doc = demoDoc();
    const idx = getIndex({ ...doc, comments: doc.comments } as any);
    const live = Object.keys(doc.cards).filter((id) => idx.isLive(id));
    for (const id of live) {
      const want = (idx.outlinks.get(id) ?? []).map((l) => [l.field, l.targetId, l.ref, l.anchor, l.alias]).sort();
      const got = (await linksFrom(id)).map((r) => [r.source_field, r.target_id, r.target_ref, r.target_anchor, r.alias]).sort();
      expect({ id, links: got }).toEqual({ id, links: want });
      expect({ id, tags: await tagsOf(id) }).toEqual({ id, tags: [...(idx.cardTags.get(id) ?? [])].sort() });
    }
  });

  it('re-indexes on save: old links and tags go, new ones arrive', async () => {
    await db.tx(async (q) => {
      await q.query('update cards set text = $2 where id = $1', ['c-insight', 'Now about [[@c-maya#Quotes]] and [[Something new]] #fresh']);
      await indexCard(q, 'c-insight');
    });
    expect(await linksFrom('c-insight')).toEqual([
      { source_field: 'text', target_id: 'c-maya', target_ref: null, target_anchor: 'Quotes', alias: null, comment_id: null },
      { source_field: 'text', target_id: null, target_ref: 'Something new', target_anchor: null, alias: null, comment_id: null },
    ]);
    expect(await tagsOf('c-insight')).toEqual(['fresh']);
    // the comment's link on c-brief is untouched by re-indexing c-brief's own text
    await db.tx((q) => indexCard(q, 'c-brief'));
    expect((await linksFrom('c-brief')).some((r) => r.comment_id === 'cm-1')).toBe(true);
  });

  it('comment edits and deletes update the index', async () => {
    await db.tx(async (q) => {
      await q.query("update comments set body = 'no links now' where id = 'cm-1'");
      await indexComment(q, 'cm-1');
    });
    expect((await linksFrom('c-brief')).some((r) => r.comment_id)).toBe(false);
    await db.tx(async (q) => {
      await q.query(`update comments set body = 'see [[@c-leo]]' where id = 'cm-1'`);
      await indexComment(q, 'cm-1');
    });
    expect((await linksFrom('c-brief')).find((r) => r.comment_id)?.target_id).toBe('c-leo');
    await db.query("delete from comments where id = 'cm-1'");
    expect((await linksFrom('c-brief')).some((r) => r.comment_id)).toBe(false);
  });

  it('display titles follow the client rules and refresh when a linked title changes', async () => {
    const title = async (id: string) => (await db.query('select display_title from cards where id = $1', [id])).rows[0].display_title;
    const doc = demoDoc();
    for (const id of Object.keys(doc.cards)) expect({ id, t: await title(id) }).toEqual({ id, t: cardTitle(doc.cards[id], doc) });
    expect(await title('c-swatch')).toBe('#6c5ce7');
    await db.tx(async (q) => {
      await q.query(`insert into cards (id, workspace_id, type, text, created_by, updated_by) values ('c-x', 'ws-studio', 'note', '[[@c-brief]]', 'u-ksenia', 'u-ksenia')`);
      await indexCard(q, 'c-x');
    });
    expect(await title('c-x')).toBe('Product brief');
    await db.tx(async (q) => {
      await q.query("update cards set title = 'Brief v2' where id = 'c-brief'");
      await indexCard(q, 'c-brief');
    });
    expect(await title('c-x')).toBe('Brief v2');
  });

  it('search text keeps aliases but never a target title', async () => {
    const plain = async (id: string) => (await db.query('select plain_text from cards where id = $1', [id])).rows[0].plain_text;
    expect(await plain('c-insight')).toContain('supports the goals in the brief.');
    expect(await plain('c-reflections')).not.toContain('People think spatially');
  });
});
