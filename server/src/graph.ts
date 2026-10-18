// GET /workspaces/:id/graph — the server version of buildGraph() in
// src/model/graph.ts. Nodes come out of SQL already permission-filtered; a
// link to something the viewer can't see is dropped, never shown as broken.

import type { GEdge, GNode, GraphData, EdgeKind } from '../../src/model/graph';
import { localGraph } from '../../src/model/graph';
import type { Queryable } from './db';
import type { Principal } from './auth';
import { HOME_BOARD_SQL, VISIBILITY_CTES } from './access';

export interface GraphQuery {
  root?: string; // limit to a board's subtree
  center?: string; // local graph around this node...
  depth?: number; // ...up to this many hops (1–5)
  types?: string[];
  tags?: string[];
  q?: string;
  orphans?: boolean;
  connectors?: boolean;
  containment?: boolean;
  broken?: boolean;
  tagNodes?: boolean;
}

export async function workspaceGraph(db: Queryable, p: Principal, workspaceId: string, o: GraphQuery): Promise<GraphData> {
  const nodeRows = (await db.query<{ id: string; type: GNode['type']; title: string; board_id: string | null; created_by: string; updated_at: Date; tags: string[] }>(
    `with recursive ${VISIBILITY_CTES},
     scope as (select board_id from subtree_boards($3) where $3::text is not null)
     select c.id, c.type, c.display_title as title, c.created_by, c.updated_at, ${HOME_BOARD_SQL} as board_id,
       coalesce((select array_agg(t.name order by t.name) from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = c.id), '{}') as tags
     from cards c
       join vis on vis.card_id = c.id
       join live on live.card_id = c.id
       left join boards b on b.id = c.id
     where c.workspace_id = $2 and c.type <> 'column'
       and ($3::text is null
            or (c.type = 'board' and c.id in (select board_id from scope))
            or (c.type <> 'board' and exists (
                  select 1 from placements pl join live lb on lb.card_id = pl.board_id
                  where pl.card_id = c.id and pl.deleted_at is null and pl.board_id in (select board_id from scope))))
       and ($4::text[] is null or c.type = any ($4::text[]))
       and ($5::text[] is null or exists (
             select 1 from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = c.id and t.name = any ($5::text[])))
       and ($6::text is null or c.display_title ilike '%' || $6 || '%' or c.plain_text ilike '%' || $6 || '%')`,
    [p.id, workspaceId, o.root ?? null, o.types?.length ? o.types : null, o.tags?.length ? o.tags.map((t) => t.toLowerCase()) : null, o.q?.trim() || null],
  )).rows;

  const nodes = new Map<string, GNode>();
  for (const r of nodeRows) {
    nodes.set(r.id, {
      id: r.id, kind: r.type === 'board' ? 'board' : 'card', type: r.type, title: r.title, boardId: r.board_id,
      degree: 0, createdBy: r.created_by, updatedAt: new Date(r.updated_at).getTime(), tags: r.tags,
    });
  }
  const ids = [...nodes.keys()];

  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, kind: EdgeKind) => {
    if (source === target) return;
    const key = `${kind}:${source}>${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  const linkRows = (await db.query<{ source: string; target: string }>(
    `select source_card_id as source, target_id as target from links
     where workspace_id = $1 and source_card_id = any ($2::text[]) and target_id = any ($2::text[])
     order by id`,
    [workspaceId, ids],
  )).rows;
  for (const r of linkRows) add(r.source, r.target, 'link');

  if (o.broken !== false) {
    // only targets that are deleted or never existed; live-but-hidden targets are skipped
    const brokenRows = (await db.query<{ source: string; target_id: string | null; target_ref: string | null; alias: string | null }>(
      `select l.source_card_id as source, l.target_id, l.target_ref, l.alias from links l
       where l.workspace_id = $1 and l.source_card_id = any ($2::text[])
         and (l.target_id is null or l.target_id not in (select card_id from live_cards($1)))
       order by l.id`,
      [workspaceId, ids],
    )).rows;
    for (const r of brokenRows) {
      const bid = 'broken:' + (r.target_id ?? r.target_ref);
      if (!nodes.has(bid)) {
        nodes.set(bid, {
          id: bid, kind: 'broken', type: 'broken', boardId: null, degree: 0, tags: [],
          title: r.target_id ? (r.alias ?? 'Missing item') : (r.target_ref ?? '?'),
        });
      }
      add(r.source, bid, 'link');
    }
  }

  if (o.connectors !== false) {
    const rows = (await db.query<{ source: string; target: string }>(
      `select a.card_id as source, b.card_id as target
       from connectors cn
         join placements a on a.id = cn.from_placement_id
         join placements b on b.id = cn.to_placement_id
       where cn.workspace_id = $1 and a.deleted_at is null and b.deleted_at is null
         and a.card_id = any ($2::text[]) and b.card_id = any ($2::text[])
       order by cn.id`,
      [workspaceId, ids],
    )).rows;
    for (const r of rows) add(r.source, r.target, 'connector');
  }

  if (o.containment) {
    const rows = (await db.query<{ source: string; target: string }>(
      `select b.id as source, b.parent_board_id as target from boards b
       where b.id = any ($1::text[]) and b.parent_board_id = any ($1::text[])
       union all
       select p.card_id, p.board_id from placements p join cards c on c.id = p.card_id
       where c.type <> 'board' and p.deleted_at is null and p.card_id = any ($1::text[]) and p.board_id = any ($1::text[])`,
      [ids],
    )).rows;
    for (const r of rows) add(r.source, r.target, 'containment');
  }

  if (o.tagNodes) {
    for (const n of [...nodes.values()]) {
      for (const t of n.tags) {
        const tid = 'tag:' + t;
        if (!nodes.has(tid)) nodes.set(tid, { id: tid, kind: 'tag', type: 'tag', title: '#' + t, boardId: null, degree: 0, tags: [] });
        add(n.id, tid, 'tag');
      }
    }
  }

  for (const e of edges) {
    if (e.kind === 'containment') continue;
    nodes.get(e.source)!.degree++;
    nodes.get(e.target)!.degree++;
  }
  let list = [...nodes.values()];
  if (o.orphans === false) list = list.filter((n) => n.degree > 0);
  const keep = new Set(list.map((n) => n.id));
  let g: GraphData = { nodes: list, edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  if (o.center) g = keep.has(o.center) ? localGraph(g, o.center, Math.min(5, Math.max(1, o.depth ?? 1))) : { nodes: [], edges: [] };
  return g;
}
