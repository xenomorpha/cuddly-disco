// Loads a client document (src/model/types.ts `Workspace`, as kept in
// IndexedDB or exported to JSON) into the relational schema, then builds the
// link index. Used by the seed and by `cli.ts import <file.json>`.

import type { Workspace } from '../../src/model/types';
import type { Queryable } from './db';
import { reindexWorkspace } from './linkIndex';
import { hashSecret } from './auth';

const ts = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

export type ImportDoc = Pick<Workspace, 'id' | 'name' | 'ownerId' | 'rootBoardId' | 'members' | 'users' | 'cards' | 'placements'> &
  Partial<Pick<Workspace, 'connectors' | 'comments' | 'permissions' | 'shareLinks' | 'graphViews'>>;

export async function importWorkspace(q: Queryable, doc: ImportDoc): Promise<void> {
  for (const u of Object.values(doc.users)) {
    await q.query(
      `insert into users (id, name, email, color) values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name, color = excluded.color`,
      [u.id, u.name, u.email, u.color],
    );
  }
  await q.query('insert into workspaces (id, name, owner_id, root_board_id) values ($1, $2, $3, $4)', [doc.id, doc.name, doc.ownerId, doc.rootBoardId]);
  for (const m of doc.members) {
    await q.query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [doc.id, m.userId, m.role]);
  }

  const cards = Object.values(doc.cards);
  const boardIds = new Set(cards.filter((c) => c.type === 'board').map((c) => c.id));
  for (const c of cards) {
    const { parentId, icon, cover, ...data } = c.data;
    await q.query(
      `insert into cards (id, workspace_id, type, title, text, data, color, labels, created_by, updated_by, created_at, updated_at, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()), coalesce($12::timestamptz, now()), $13)`,
      [c.id, doc.id, c.type, c.title ?? '', c.text ?? '', c.type === 'board' ? data : c.data, c.color ?? null, c.labels ?? [],
        c.createdBy, c.updatedBy || c.createdBy, ts(c.createdAt), ts(c.updatedAt), ts(c.deletedAt)],
    );
    if (c.type === 'board') {
      // a dangling parent (target no longer exists) becomes a top-level board
      const parent = parentId && boardIds.has(parentId) ? parentId : null;
      await q.query('insert into boards (id, workspace_id, parent_board_id, icon, cover) values ($1, $2, $3, $4, $5)', [c.id, doc.id, parent, icon ?? null, cover ?? null]);
    }
  }

  for (const p of Object.values(doc.placements)) {
    if (!doc.cards[p.cardId] || !boardIds.has(p.boardId)) continue;
    await q.query(
      `insert into placements (id, workspace_id, card_id, board_id, column_id, ord, x, y, w, h, z, locked, tray, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [p.id, doc.id, p.cardId, p.boardId, p.columnId && doc.placements[p.columnId] ? p.columnId : null, p.order ?? 0,
        p.x, p.y, p.w, p.h ?? null, p.z ?? 0, !!p.locked, !!p.tray, ts(p.deletedAt)],
    );
  }
  for (const cn of Object.values(doc.connectors ?? {})) {
    if (!doc.placements[cn.from] || !doc.placements[cn.to] || !boardIds.has(cn.boardId)) continue;
    await q.query(
      'insert into connectors (id, workspace_id, board_id, from_placement_id, to_placement_id, style, label) values ($1, $2, $3, $4, $5, $6, $7)',
      [cn.id, doc.id, cn.boardId, cn.from, cn.to, cn.style, cn.label ?? ''],
    );
  }
  // parents before replies
  const comments = Object.values(doc.comments ?? {}).sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
  for (const cm of comments) {
    if (!doc.cards[cm.targetId]) continue;
    await q.query(
      'insert into comments (id, workspace_id, target_id, author_id, body, parent_id, resolved, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [cm.id, doc.id, cm.targetId, cm.authorId, cm.body, cm.parentId ?? null, !!cm.resolved, ts(cm.createdAt)],
    );
  }
  for (const p of Object.values(doc.permissions ?? {})) {
    // link principals are resolved from share_links, not stored as overrides
    if (p.userId.startsWith('link:') || !boardIds.has(p.boardId)) continue;
    await q.query('insert into permissions (id, workspace_id, board_id, user_id, role) values ($1, $2, $3, $4, $5)', [p.id, doc.id, p.boardId, p.userId, p.role]);
  }
  for (const s of Object.values(doc.shareLinks ?? {})) {
    if (!boardIds.has(s.boardId)) continue;
    await q.query(
      'insert into share_links (token, workspace_id, board_id, enabled, password_hash, allow_duplicate) values ($1, $2, $3, $4, $5, $6)',
      [s.token, doc.id, s.boardId, s.enabled, s.password ? hashSecret(s.password) : null, s.allowDuplicate],
    );
  }
  for (const v of Object.values(doc.graphViews ?? {})) {
    await q.query('insert into graph_views (id, workspace_id, user_id, name, settings) values ($1, $2, $3, $4, $5)', [v.id, doc.id, v.userId, v.name, v.settings]);
  }

  await reindexWorkspace(q, doc.id);
}
