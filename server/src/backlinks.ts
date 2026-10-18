// GET /cards/:id/backlinks and /cards/:id/mentions, read from the `links`
// table and filtered to sources the principal can see. Snippets render other
// links as titles only when the viewer can see those targets too.

import { findMentions, parseLinks, snippetAround, type Snippet } from '../../src/model/links';
import { textFields } from '../../src/model/index';
import type { Queryable } from './db';
import type { Principal } from './auth';
import { HOME_BOARD_SQL, VISIBILITY_CTES } from './access';
import { rowToCard, type CardRow } from './linkIndex';

export interface Backlink {
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  boardId: string | null;
  boardTitle: string | null;
  field: string;
  anchor: string | null;
  alias: string | null;
  snippet: Snippet;
  updatedAt: Date;
}

/** Title lookup restricted to what the principal can see (others render as "missing"). */
async function visibleTitles(q: Queryable, p: Principal, workspaceId: string, ids: string[]): Promise<(id: string) => string | null> {
  if (!ids.length) return () => null;
  const rows = (await q.query<{ id: string; title: string }>(
    `with ${VISIBILITY_CTES}
     select c.id, c.display_title as title from cards c join vis on vis.card_id = c.id join live on live.card_id = c.id
     where c.id = any ($3::text[])`,
    [p.id, workspaceId, ids],
  )).rows;
  const m = new Map(rows.map((r) => [r.id, r.title]));
  return (id) => m.get(id) ?? null;
}

export async function backlinks(
  q: Queryable, p: Principal, workspaceId: string, targetId: string, opts: { sort?: 'board' | 'date'; q?: string } = {},
): Promise<Backlink[]> {
  const rows = (await q.query<{
    source_card_id: string; source_title: string; source_type: string; board_id: string | null; board_title: string | null;
    source_field: string; target_anchor: string | null; alias: string | null; position: number; length: number; field_text: string; updated_at: Date;
  }>(
    `with ${VISIBILITY_CTES},
     src as (
       select l.*, c.display_title as source_title, c.type as source_type, c.updated_at, ${HOME_BOARD_SQL} as board_id
       from links l
         join cards c on c.id = l.source_card_id
         join vis on vis.card_id = c.id
         join live on live.card_id = c.id
         left join boards b on b.id = c.id
       where l.workspace_id = $2 and l.target_id = $3 and l.source_card_id <> $3
     )
     select src.*, bc.display_title as board_title
     from src left join cards bc on bc.id = src.board_id
     order by src.id`,
    [p.id, workspaceId, targetId],
  )).rows;

  const otherIds = new Set<string>();
  for (const r of rows) for (const l of parseLinks(r.field_text)) if (l.targetId) otherIds.add(l.targetId);
  const label = await visibleTitles(q, p, workspaceId, [...otherIds]);

  let out: Backlink[] = rows.map((r) => ({
    sourceId: r.source_card_id,
    sourceTitle: r.source_title,
    sourceType: r.source_type,
    boardId: r.board_id,
    boardTitle: r.board_title,
    field: r.source_field,
    anchor: r.target_anchor,
    alias: r.alias,
    snippet: snippetAround(r.field_text, r.position, r.length, label),
    updatedAt: r.updated_at,
  }));
  const needle = opts.q?.trim().toLowerCase();
  if (needle) {
    out = out.filter((b) => [b.sourceTitle, b.boardTitle ?? '', b.snippet.before, b.snippet.match, b.snippet.after].some((s) => s.toLowerCase().includes(needle)));
  }
  if (opts.sort === 'date') out.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  else out.sort((a, b) => (a.boardTitle ?? '').localeCompare(b.boardTitle ?? '') || a.sourceTitle.localeCompare(b.sourceTitle));
  return out;
}

export interface MentionHit {
  sourceId: string;
  sourceTitle: string;
  boardId: string | null;
  field: string;
  index: number;
  length: number;
  snippet: Snippet;
}

/** Plain-text occurrences of the target's title in other visible cards (spec §4.2 unlinked mentions). */
export async function mentions(q: Queryable, p: Principal, workspaceId: string, targetId: string, limit = 50): Promise<MentionHit[]> {
  const target = (await q.query<{ display_title: string }>('select display_title from cards where id = $1', [targetId])).rows[0];
  const title = target?.display_title.trim() ?? '';
  if (title.length < 2) return [];
  const rows = (await q.query<CardRow & { board_id: string | null }>(
    `with ${VISIBILITY_CTES}
     select c.id, c.workspace_id, c.type, c.title, c.text, c.data, c.labels, c.display_title, ${HOME_BOARD_SQL} as board_id
     from cards c
       join vis on vis.card_id = c.id
       join live on live.card_id = c.id
       left join boards b on b.id = c.id
     where c.workspace_id = $2 and c.id <> $3 and c.plain_text ilike '%' || $4 || '%'
     order by c.updated_at desc
     limit 500`,
    [p.id, workspaceId, targetId, title.replace(/[\\%_]/g, '\\$&')],
  )).rows;

  const otherIds = new Set<string>();
  for (const r of rows) for (const f of textFields(rowToCard(r))) for (const l of parseLinks(f.text)) if (l.targetId) otherIds.add(l.targetId);
  const label = await visibleTitles(q, p, workspaceId, [...otherIds]);

  const out: MentionHit[] = [];
  for (const r of rows) {
    for (const f of textFields(rowToCard(r))) {
      for (const m of findMentions(f.text, title)) {
        out.push({ sourceId: r.id, sourceTitle: r.display_title ?? '', boardId: r.board_id, field: f.field, index: m.index, length: m.length, snippet: snippetAround(f.text, m.index, m.length, label) });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
