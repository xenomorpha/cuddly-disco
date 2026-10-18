// Request-level permission checks on top of the SQL functions in 001_schema.sql.
// Anything the principal cannot see is reported as 404, never 403, so ids of
// restricted items can't be probed.

import type { Role } from '../../src/model/types';
import type { Queryable } from './db';
import type { Principal } from './auth';

export type Access = Role | 'none';

const RANK: Record<Access, number> = { none: 0, viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const atLeast = (have: Access, need: Access) => RANK[have] >= RANK[need];

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface CardAccess {
  id: string;
  workspaceId: string;
  type: string;
  role: Access;
  live: boolean;
}

export async function cardAccess(q: Queryable, p: Principal, cardId: string): Promise<CardAccess | null> {
  const row = (await q.query<{ id: string; workspace_id: string; type: string; role: Access; live: boolean }>(
    `select c.id, c.workspace_id, c.type, card_role($1, c.id) as role,
            exists (select 1 from live_cards(c.workspace_id) l where l.card_id = c.id) as live
     from cards c where c.id = $2`,
    [p.id, cardId],
  )).rows[0];
  return row ? { id: row.id, workspaceId: row.workspace_id, type: row.type, role: row.role, live: row.live } : null;
}

/** The card if the principal has at least `need` on it; 404 when they can't see it at all. */
export async function requireCard(q: Queryable, p: Principal, cardId: string, need: Access): Promise<CardAccess> {
  const a = await cardAccess(q, p, cardId);
  if (!a || a.role === 'none') throw new HttpError(404, 'Not found');
  if (!atLeast(a.role, need)) throw new HttpError(403, `Requires ${need} access`);
  return a;
}

export async function requireBoard(q: Queryable, p: Principal, boardId: string, need: Access): Promise<CardAccess> {
  const a = await requireCard(q, p, boardId, 'viewer');
  if (a.type !== 'board') throw new HttpError(404, 'Not a board');
  if (!atLeast(a.role, need)) throw new HttpError(403, `Requires ${need} access`);
  return a;
}

/** A workspace is visible when the principal can see at least one of its boards (members, guests, share links). */
export async function requireWorkspace(q: Queryable, p: Principal, workspaceId: string): Promise<{ rootRole: Access }> {
  const row = (await q.query<{ root_role: Access; any_board: boolean }>(
    `select board_role($1, w.root_board_id) as root_role,
            exists (select 1 from board_roles($1, w.id) r where r.role <> 'none') as any_board
     from workspaces w where w.id = $2`,
    [p.id, workspaceId],
  )).rows[0];
  if (!row || !row.any_board) throw new HttpError(404, 'Not found');
  return { rootRole: row.root_role };
}

export function requireUser(p: Principal): string {
  if (!p.userId) throw new HttpError(403, 'Share links are read-only');
  return p.userId;
}

/**
 * CTEs shared by the read queries: `vis` (cards the principal can see), `live`
 * (live cards) and `home` (first visible live board each card is placed on).
 * Expects $1 = principal, $2 = workspace id.
 */
export const VISIBILITY_CTES = `
  vis as (select card_id from card_roles($1, $2) where role <> 'none'),
  live as (select card_id from live_cards($2)),
  home as (
    select distinct on (p.card_id) p.card_id, p.board_id
    from placements p
      join vis v on v.card_id = p.board_id
      join live l on l.card_id = p.board_id
    where p.workspace_id = $2 and p.deleted_at is null
    order by p.card_id, p.created_at, p.id
  )`;

/** Home board column for a card row `c` joined with `boards b`: the parent for boards, else `home`. Never a hidden board. */
export const HOME_BOARD_SQL = `
  case when c.type = 'board'
    then (case when b.parent_board_id in (select card_id from vis) then b.parent_board_id end)
    else (select h.board_id from home h where h.card_id = c.id)
  end`;
