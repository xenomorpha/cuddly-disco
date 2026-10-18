import { describe, it, expect } from 'vitest';
import { boardRole, boardChain, makeAccess, canEdit, canComment, canView, isOwner } from './permissions';

function card(id: string, type: string, parentId: string | null = null) {
  return { id, type, title: id, text: '', data: { parentId }, labels: [], createdBy: 'o', createdAt: 0, updatedAt: 0, updatedBy: 'o' } as any;
}

function ws() {
  return {
    ownerId: 'o',
    rootBoardId: 'root',
    members: [
      { userId: 'o', role: 'owner' as const },
      { userId: 'e', role: 'editor' as const },
      { userId: 'v', role: 'viewer' as const },
    ],
    cards: {
      root: card('root', 'board'),
      a: card('a', 'board', 'root'),
      a1: card('a1', 'board', 'a'),
      secret: card('secret', 'board', 'root'),
      n1: card('n1', 'note'),
      n2: card('n2', 'note'),
      n3: card('n3', 'note'),
    },
    placements: {
      p1: { id: 'p1', cardId: 'n1', boardId: 'a1', order: 0, x: 0, y: 0, w: 1, z: 0 },
      p2: { id: 'p2', cardId: 'n2', boardId: 'secret', order: 0, x: 0, y: 0, w: 1, z: 0 },
      p3: { id: 'p3', cardId: 'n2', boardId: 'a', order: 0, x: 0, y: 0, w: 1, z: 0 },
      p4: { id: 'p4', cardId: 'n3', boardId: 'secret', order: 0, x: 0, y: 0, w: 1, z: 0 },
    },
    permissions: {
      x1: { id: 'x1', boardId: 'secret', userId: 'e', role: 'none' as const },
      x2: { id: 'x2', boardId: 'a', userId: 'v', role: 'commenter' as const },
      x3: { id: 'x3', boardId: 'a1', userId: 'v', role: 'viewer' as const },
    },
    shareLinks: { secret: { boardId: 'secret', token: 'tok', enabled: true, allowDuplicate: false } },
  };
}

describe('boardRole', () => {
  it('owner always owns', () => {
    expect(boardRole(ws(), 'o', 'secret')).toBe('owner');
  });
  it('falls back to workspace role', () => {
    expect(boardRole(ws(), 'e', 'a1')).toBe('editor');
  });
  it('override hides a subtree', () => {
    expect(boardRole(ws(), 'e', 'secret')).toBe('none');
  });
  it('inherits overrides to nested boards, nearest wins', () => {
    expect(boardRole(ws(), 'v', 'a')).toBe('commenter');
    expect(boardRole(ws(), 'v', 'a1')).toBe('viewer');
    expect(boardRole(ws(), 'v', 'root')).toBe('viewer');
  });
  it('non-members see nothing', () => {
    expect(boardRole(ws(), 'stranger', 'root')).toBe('none');
  });
  it('share link grants viewer to its subtree only', () => {
    expect(boardRole(ws(), 'link:tok', 'secret')).toBe('viewer');
    expect(boardRole(ws(), 'link:tok', 'a')).toBe('none');
    expect(boardRole(ws(), 'link:bad', 'secret')).toBe('none');
    const w = ws();
    w.shareLinks.secret.enabled = false;
    expect(boardRole(w, 'link:tok', 'secret')).toBe('none');
  });
  it('board chain is cycle-safe', () => {
    const w = ws();
    w.cards.root.data.parentId = 'a1';
    expect(boardChain(w, 'a1')).toEqual(['a1', 'a', 'root']);
  });
});

describe('card access', () => {
  it('a card is visible if any placement is on a visible board', () => {
    const acc = makeAccess(ws() as any, 'e');
    expect(acc.canSee('n1')).toBe(true);
    expect(acc.canSee('n2')).toBe(true); // synced into board a
    expect(acc.canSee('n3')).toBe(false); // only on the secret board
    expect(acc.canSee('secret')).toBe(false);
    expect(acc.canSee('missing')).toBe(false);
  });
  it('uses the best role across placements', () => {
    const acc = makeAccess(ws() as any, 'v');
    expect(acc.card('n2')).toBe('commenter');
  });
  it('unplaced cards follow the root role', () => {
    const w = ws();
    delete (w.placements as any).p1;
    expect(makeAccess(w as any, 'v').card('n1')).toBe('viewer');
  });
  it('role predicates', () => {
    expect(canEdit('editor')).toBe(true);
    expect(canEdit('commenter')).toBe(false);
    expect(canComment('commenter')).toBe(true);
    expect(canView('none')).toBe(false);
    expect(isOwner('owner')).toBe(true);
  });
});
