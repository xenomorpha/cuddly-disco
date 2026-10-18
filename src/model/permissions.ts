// Role resolution (spec §7): Owner / Editor / Commenter / Viewer per board,
// inherited down the board tree unless overridden. A board override of "none"
// hides a subtree from a member. Cards are visible when at least one of their
// placements sits on a visible board (synced cards can live on several boards).

import type { Role, Workspace } from './types';

export type Access = Role | 'none';

const RANK: Record<Access, number> = { none: 0, viewer: 1, commenter: 2, editor: 3, owner: 4 };

type PermWs = Pick<Workspace, 'ownerId' | 'members' | 'cards' | 'permissions' | 'placements' | 'shareLinks' | 'rootBoardId'>;

export function parentBoard(ws: Pick<Workspace, 'cards'>, boardId: string): string | null {
  return ws.cards[boardId]?.data.parentId ?? null;
}

/** Board ids from `boardId` up to the root (inclusive). Cycle-safe. */
export function boardChain(ws: Pick<Workspace, 'cards'>, boardId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = boardId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = parentBoard(ws, cur);
  }
  return out;
}

export function boardRole(ws: PermWs, userId: string, boardId: string): Access {
  if (userId === ws.ownerId) return 'owner';
  const chain = boardChain(ws, boardId);

  if (userId.startsWith('link:')) {
    const token = userId.slice(5);
    const link = Object.values(ws.shareLinks).find((l) => l.token === token && l.enabled);
    return link && chain.includes(link.boardId) ? 'viewer' : 'none';
  }

  const perms = Object.values(ws.permissions);
  for (const b of chain) {
    const p = perms.find((x) => x.boardId === b && x.userId === userId);
    if (p) return p.role;
  }
  return ws.members.find((m) => m.userId === userId)?.role ?? 'none';
}

export const canView = (a: Access) => RANK[a] >= RANK.viewer;
export const canComment = (a: Access) => RANK[a] >= RANK.commenter;
export const canEdit = (a: Access) => RANK[a] >= RANK.editor;
export const isOwner = (a: Access) => a === 'owner';

/** Memoised accessor for a single user over one workspace snapshot. */
export function makeAccess(ws: PermWs, userId: string) {
  const boardCache = new Map<string, Access>();
  const board = (id: string): Access => {
    let r = boardCache.get(id);
    if (r === undefined) {
      r = boardRole(ws, userId, id);
      boardCache.set(id, r);
    }
    return r;
  };
  const cardBoards = new Map<string, string[]>();
  for (const p of Object.values(ws.placements)) {
    if (p.deletedAt) continue;
    const list = cardBoards.get(p.cardId);
    if (list) list.push(p.boardId);
    else cardBoards.set(p.cardId, [p.boardId]);
  }
  /** Best role the user has on any board where the card is placed. */
  const card = (id: string): Access => {
    const c = ws.cards[id];
    if (!c) return 'none';
    if (c.type === 'board') return board(id);
    const boards = cardBoards.get(id) ?? [];
    let best: Access = 'none';
    for (const b of boards) {
      const r = board(b);
      if (RANK[r] > RANK[best]) best = r;
    }
    // A card with no live placement (e.g. trashed) is visible to whoever can see the root.
    if (!boards.length) best = board(ws.rootBoardId);
    return best;
  };
  return { board, card, canSee: (id: string) => canView(card(id)) };
}

export type AccessFn = ReturnType<typeof makeAccess>;
