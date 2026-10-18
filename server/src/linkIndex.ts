// Link-index job (spec §4.4). Runs inside the save transaction: re-parses the
// saved card with the client's own parseLinks()/textFields(), replaces its rows
// in `links` and `card_tags`, and refreshes the derived display_title /
// plain_text used by search and the graph.

import type { Card } from '../../src/model/types';
import { extractTags, parseLinks, toPlain } from '../../src/model/links';
import { cardTitle, textFields } from '../../src/model/index';
import type { Queryable } from './db';

export interface CardRow {
  id: string;
  workspace_id: string;
  type: Card['type'];
  title: string;
  text: string;
  data: Card['data'];
  labels: string[];
  display_title?: string;
}

/** Just enough of a client Card for textFields() and cardTitle(). */
export function rowToCard(r: CardRow): Card {
  return {
    id: r.id, type: r.type, title: r.title, text: r.text, data: r.data ?? {}, labels: r.labels ?? [],
    createdBy: '', createdAt: 0, updatedAt: 0, updatedBy: '',
  };
}

const CARD_COLS = 'id, workspace_id, type, title, text, data, labels, display_title';

export interface IndexResult {
  links: number;
  tags: string[];
  displayTitle: string;
}

export async function indexCard(q: Queryable, cardId: string, opts: { dependents?: boolean } = {}): Promise<IndexResult | null> {
  const row = (await q.query<CardRow>(`select ${CARD_COLS} from cards where id = $1`, [cardId])).rows[0];
  if (!row) return null;
  const card = rowToCard(row);
  const fields = textFields(card);

  const links = fields.flatMap((f) => parseLinks(f.text).map((l) => ({ ...l, field: f.field, fieldText: f.text })));
  const tags = new Set(card.labels.map((l) => l.toLowerCase()));
  for (const f of fields) for (const t of extractTags(f.text)) tags.add(t);

  // Titles of link targets, for a first line that is itself a link (same rule as the client).
  const targetIds = [...new Set(links.map((l) => l.targetId).filter((x): x is string => !!x))];
  const targets = targetIds.length
    ? (await q.query<CardRow>(`select ${CARD_COLS} from cards where id = any($1::text[]) and workspace_id = $2`, [targetIds, row.workspace_id])).rows
    : [];
  const displayTitle = cardTitle(card, { cards: Object.fromEntries(targets.map((t) => [t.id, rowToCard(t)])) });
  // Search text keeps aliases and unresolved refs but never a target's title,
  // so a card on a visible board cannot surface a restricted card's name.
  const plainText = fields.map((f) => toPlain(f.text, () => '')).join('\n');

  await q.query('delete from links where source_card_id = $1 and comment_id is null', [cardId]);
  if (links.length) {
    await q.query(
      `insert into links (workspace_id, source_card_id, source_field, target_id, target_ref, target_anchor, alias, position, length, field_text)
       select $1, $2, u.f, u.ti, u.tr, u.an, u.al, u.po, u.le, u.ft
       from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[], $10::text[])
         as u(f, ti, tr, an, al, po, le, ft)`,
      [
        row.workspace_id, cardId,
        links.map((l) => l.field), links.map((l) => l.targetId), links.map((l) => l.ref),
        links.map((l) => l.anchor), links.map((l) => l.alias),
        links.map((l) => l.index), links.map((l) => l.length), links.map((l) => l.fieldText),
      ],
    );
  }

  const tagList = [...tags];
  await q.query('delete from card_tags where card_id = $1', [cardId]);
  if (tagList.length) {
    await q.query('insert into tags (workspace_id, name) select $1, unnest($2::text[]) on conflict do nothing', [row.workspace_id, tagList]);
    await q.query(
      'insert into card_tags (card_id, tag_id) select $1, id from tags where workspace_id = $2 and name = any($3::text[])',
      [cardId, row.workspace_id, tagList],
    );
  }

  await q.query('update cards set display_title = $2, plain_text = $3 where id = $1', [cardId, displayTitle, plainText]);

  // A card whose first line is a link to this one shows this card's title.
  if (opts.dependents !== false && row.display_title !== displayTitle) {
    const deps = await q.query<{ source_card_id: string }>(
      'select distinct source_card_id from links where target_id = $1 and comment_id is null and source_card_id <> $1',
      [cardId],
    );
    for (const d of deps.rows) await indexCard(q, d.source_card_id, { dependents: false });
  }
  return { links: links.length, tags: tagList, displayTitle };
}

/** Links written in a comment count as references from the commented card. */
export async function indexComment(q: Queryable, commentId: string): Promise<number> {
  await q.query('delete from links where comment_id = $1', [commentId]);
  const c = (await q.query<{ workspace_id: string; target_id: string; body: string }>(
    'select workspace_id, target_id, body from comments where id = $1', [commentId],
  )).rows[0];
  if (!c) return 0;
  const links = parseLinks(c.body);
  for (const l of links) {
    await q.query(
      `insert into links (workspace_id, source_card_id, comment_id, source_field, target_id, target_ref, target_anchor, alias, position, length, field_text)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [c.workspace_id, c.target_id, commentId, 'comment:' + commentId, l.targetId, l.ref, l.anchor, l.alias, l.index, l.length, c.body],
    );
  }
  return links.length;
}

export async function reindexWorkspace(q: Queryable, workspaceId: string): Promise<{ cards: number; comments: number }> {
  const cards = (await q.query<{ id: string }>('select id from cards where workspace_id = $1', [workspaceId])).rows;
  for (const c of cards) await indexCard(q, c.id, { dependents: false });
  const comments = (await q.query<{ id: string }>('select id from comments where workspace_id = $1', [workspaceId])).rows;
  for (const c of comments) await indexComment(q, c.id);
  return { cards: cards.length, comments: comments.length };
}
