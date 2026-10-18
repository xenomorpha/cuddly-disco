// Demo workspace with fixed ids, modelled on the client's demo (src/model/seed.ts):
// nested boards, links with anchors and aliases, a broken and an unresolved
// link, tags, a synced card, connectors, a comment with a link, a secret
// share link, and a board hidden from one member.
//
//   Ksenia  owner          token dev-ksenia
//   Alex    editor         token dev-alex
//   Sam     viewer         token dev-sam      "Private journal" overridden to none
//   Casey   not a member   token dev-casey    commenter on "Research" only (guest)
//   share link "demo-moodboard" on Moodboard (no password)

import type { Card, CardData, CardType, Comment, Connector, Placement, User } from '../../src/model/types';
import { DEFAULT_GRAPH_SETTINGS } from '../../src/model/types';
import type { Queryable } from './db';
import { importWorkspace, type ImportDoc } from './importWorkspace';
import { issueApiToken } from './auth';

export const DEMO = {
  workspace: 'ws-studio',
  users: { ksenia: 'u-ksenia', alex: 'u-alex', sam: 'u-sam', casey: 'u-casey' },
  tokens: { ksenia: 'dev-ksenia', alex: 'dev-alex', sam: 'dev-sam', casey: 'dev-casey' },
  shareToken: 'demo-moodboard',
} as const;

const link = (id: string, alias?: string, anchor?: string) => `[[@${id}${anchor ? '#' + anchor : ''}${alias ? '|' + alias : ''}]]`;

export function demoDoc(now = Date.UTC(2026, 9, 18, 9)): ImportDoc {
  const owner = DEMO.users.ksenia;
  const cards: Record<string, Card> = {};
  const placements: Record<string, Placement> = {};
  const connectors: Record<string, Connector> = {};
  let n = 0;
  let t = now;

  const card = (id: string, type: CardType, boardId: string | null, opts: { title?: string; text?: string; data?: CardData; labels?: string[]; by?: string; deleted?: boolean } = {}) => {
    t += 60_000;
    cards[id] = {
      id, type, title: opts.title ?? '', text: opts.text ?? '', data: opts.data ?? {}, labels: opts.labels ?? [],
      createdBy: opts.by ?? owner, updatedBy: opts.by ?? owner, createdAt: t, updatedAt: t, deletedAt: opts.deleted ? t : null,
    };
    if (boardId) place(id, boardId);
    return id;
  };
  const place = (cardId: string, boardId: string) => {
    const id = `p${++n}`;
    placements[id] = { id, cardId, boardId, order: n, x: 40 + (n % 5) * 280, y: 40 + Math.floor(n / 5) * 220, w: 240, z: n, columnId: null };
    return id;
  };
  const board = (id: string, parent: string | null, title: string, icon: string) =>
    card(id, 'board', parent, { title, data: { parentId: parent, icon } });
  const placementOf = (cardId: string, boardId: string) => Object.values(placements).find((p) => p.cardId === cardId && p.boardId === boardId)!.id;

  board('b-home', null, 'Home', '🏠');
  board('b-research', 'b-home', 'Research', '🔬');
  board('b-interviews', 'b-research', 'Interviews', '🎙');
  board('b-round1', 'b-interviews', 'Round 1', '1️⃣');
  board('b-mood', 'b-home', 'Moodboard', '🎨');
  board('b-plan', 'b-home', 'Project plan', '🗂');
  board('b-journal', 'b-home', 'Private journal', '🔒');

  card('c-brief', 'document', 'b-home', {
    title: 'Product brief',
    text: [
      '# Problem', 'Visual thinkers lose the connections between their ideas once a board grows beyond a screen.', '',
      '# Goals', '1. Freeform canvas', '2. Bidirectional links between any items',
      `3. A graph view of how everything connects (see ${link('c-graph-note', 'graph notes')})`, '',
      '# Audience', 'Designers, writers, researchers and small creative teams. #research',
    ].join('\n'),
  });
  card('c-insight', 'note', 'b-research', {
    title: 'People think spatially',
    text: `## People think spatially\nUsers arrange ideas on a surface before they can name the structure. This supports the goals in ${link('c-brief', 'the brief', 'Goals')}. #research #insight`,
  });
  card('c-graph-note', 'note', 'b-research', {
    text: 'Graph view should make clusters and orphans obvious. Compare with how the Moodboard groups references. #research',
  });
  card('c-old-idea', 'note', 'b-research', { text: `Old idea, now in the trash: ${link('c-brief')}`, deleted: true });
  card('c-maya', 'note', 'b-interviews', {
    title: 'Interview — Maya',
    text: `## Interview — Maya\nDesigner, 6 yrs. "I need to *see* how things relate." → ${link('c-insight')} #interview`,
    by: DEMO.users.alex,
  });
  card('c-leo', 'note', 'b-interviews', {
    title: 'Interview — Leo',
    text: `## Interview — Leo\nResearcher. Uses backlinks daily; misses a canvas. See also ${link('c-maya', 'Maya')}. #interview`,
    by: DEMO.users.alex,
  });
  card('c-summary', 'note', 'b-round1', {
    title: 'Round 1 summary',
    text: `# Round 1 summary\nSources: ${link('c-maya')}, ${link('c-leo')}.\n\nOpen question: ${link('missing-target-demo', 'a deleted card')} and [[Pricing research]].`,
  });
  card('c-mood-note', 'note', 'b-mood', { text: '# Visual direction\nSoft, tactile, paper-like. One bright accent. People think spatially. #moodboard' });
  card('c-swatch', 'swatch', 'b-mood', { data: { hex: '#6c5ce7', showCaption: true } });
  card('c-todo', 'todo', 'b-plan', {
    title: 'This week',
    data: {
      items: [
        { id: 'i1', text: `Review ${link('c-insight')}`, done: true, assignee: DEMO.users.alex },
        { id: 'i2', text: 'Book usability sessions', done: false },
        { id: 'i3', text: `Update ${link('c-brief', 'brief', 'Audience')} #engineering`, done: false },
      ],
    },
  });
  place('c-todo', 'b-home'); // synced card: lives on Project plan and Home
  card('c-reflections', 'note', 'b-journal', {
    title: 'Reflections',
    text: `## Reflections\nI keep coming back to ${link('c-insight')}. Not ready to share this yet. #private`,
  });
  card('c-welcome', 'note', 'b-home', {
    title: 'Welcome',
    text: `# Welcome to Nodeboard\nTry ${link('b-research')} or ${link('c-brief')}.\n#onboarding`,
  });

  const connect = (id: string, boardId: string, from: string, to: string, label: string) => {
    connectors[id] = {
      id, boardId, from: placementOf(from, boardId), to: placementOf(to, boardId), label,
      style: { curved: true, arrowStart: false, arrowEnd: true, color: '#636e72', dashed: false },
    };
  };
  connect('k1', 'b-research', 'c-insight', 'c-graph-note', 'informs');
  connect('k2', 'b-home', 'c-welcome', 'b-research', 'start here');

  const comments: Record<string, Comment> = {
    'cm-1': { id: 'cm-1', targetId: 'c-brief', authorId: DEMO.users.alex, body: `@Ksenia should the goals mention ${link('c-insight')} explicitly?`, createdAt: now, parentId: null },
  };

  const users: Record<string, User> = {
    [owner]: { id: owner, name: 'Ksenia', email: 'ksenia@example.com', color: '#6c5ce7' },
    [DEMO.users.alex]: { id: DEMO.users.alex, name: 'Alex Rivera', email: 'alex@example.com', color: '#00b894' },
    [DEMO.users.sam]: { id: DEMO.users.sam, name: 'Sam Lee', email: 'sam@example.com', color: '#e17055' },
    [DEMO.users.casey]: { id: DEMO.users.casey, name: 'Casey Guest', email: 'casey@example.com', color: '#0984e3' },
  };

  return {
    id: DEMO.workspace,
    name: 'Studio',
    ownerId: owner,
    rootBoardId: 'b-home',
    members: [
      { userId: owner, role: 'owner' },
      { userId: DEMO.users.alex, role: 'editor' },
      { userId: DEMO.users.sam, role: 'viewer' },
    ],
    users,
    cards,
    placements,
    connectors,
    comments,
    permissions: {
      'perm-1': { id: 'perm-1', boardId: 'b-journal', userId: DEMO.users.sam, role: 'none' },
      'perm-2': { id: 'perm-2', boardId: 'b-research', userId: DEMO.users.casey, role: 'commenter' },
    },
    shareLinks: { 'b-mood': { boardId: 'b-mood', token: DEMO.shareToken, enabled: true, allowDuplicate: false } },
    graphViews: {
      'gv-1': { id: 'gv-1', userId: owner, name: 'Research only', settings: { ...DEFAULT_GRAPH_SETTINGS, rootBoardId: 'b-research' } },
    },
  };
}

/** Inserts the demo workspace and dev tokens. Does nothing if it already exists. */
export async function seedDemo(q: Queryable): Promise<boolean> {
  const exists = (await q.query('select 1 from workspaces where id = $1', [DEMO.workspace])).rows.length > 0;
  if (exists) return false;
  await importWorkspace(q, demoDoc());
  for (const [name, token] of Object.entries(DEMO.tokens)) {
    await issueApiToken(q, DEMO.users[name as keyof typeof DEMO.users], token, 'dev');
  }
  return true;
}
