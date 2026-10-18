// Demo workspace shown on first launch. It exercises every feature in the
// acceptance criteria: nested boards, wiki-links (incl. heading anchors and
// aliases), tags, unlinked mentions, synced cards, connectors, roles and a
// board hidden from one member.

import { Builder, link } from './builder';
import type { Workspace } from './types';
import { putAsset, uid } from './store';

export function seedWorkspace(): { doc: Workspace; assets: Promise<void> } {
  const owner = uid();
  const alex = uid();
  const sam = uid();
  const b = new Builder(owner);
  const rootId = uid();
  const t = Date.now();

  const root = {
    id: rootId, type: 'board' as const, title: 'Home', text: '', labels: [], createdBy: owner, createdAt: t, updatedAt: t, updatedBy: owner,
    data: { parentId: null, icon: '🏠' },
  };

  // --- top-level boards
  const research = b.board(rootId, 420, 40, 'Research', '🔬', { color: '#74b9ff' });
  const mood = b.board(rootId, 620, 40, 'Moodboard', '🎨', { color: '#fd79a8' });
  const plan = b.board(rootId, 820, 40, 'Project plan', '🗂', { color: '#55efc4' });
  const journal = b.board(rootId, 1020, 40, 'Private journal', '🔒', { color: '#b2bec3' });
  const interviews = b.board(research.cardId, 40, 380, 'Interviews', '🎙');
  const round1 = b.board(interviews.cardId, 40, 40, 'Round 1', '1️⃣');

  // --- research content
  const insight = b.note(research.cardId, 280, 40, '', {
    title: 'People think spatially',
    color: '#ffeaa7',
  });
  const brief = b.card('document', rootId, 420, 320, { title: 'Product brief' });
  insight.card.text =
    '## People think spatially\nUsers arrange ideas on a surface before they can name the structure. ' +
    `This supports the goals in ${link(brief.cardId, 'the brief', 'Goals')}. #research #insight`;
  const graphNote = b.note(research.cardId, 280, 300,
    'Graph view should make clusters and orphans obvious. Compare with how the Moodboard groups references visually. #research');
  const sources = b.column(research.cardId, 580, 40, 'Sources');
  b.inColumn(sources.placementId, 'link', { title: 'Graph theory', data: { url: 'https://en.wikipedia.org/wiki/Graph_theory', description: 'Wikipedia overview of graphs, nodes and edges.' } });
  b.inColumn(sources.placementId, 'link', { title: 'Zettelkasten', data: { url: 'https://en.wikipedia.org/wiki/Zettelkasten', description: 'A note-taking method based on linked cards.' } });
  b.inColumn(sources.placementId, 'note', { text: `Both sources relate to ${link(insight.cardId)}.` });
  const survey = b.card('table', research.cardId, 900, 40, {
    title: 'Survey results',
    data: {
      table: {
        columns: [
          { id: 'q', name: 'Question', kind: 'text' },
          { id: 'n', name: 'Agree', kind: 'number' },
          { id: 'd', name: 'Disagree', kind: 'number' },
          { id: 's', name: 'Share agree', kind: 'text' },
        ],
        rows: [
          { id: 'r1', cells: { q: 'I sketch before I write', n: '42', d: '8', s: '=B1/(B1+C1)' } },
          { id: 'r2', cells: { q: 'I lose track of links', n: '35', d: '15', s: '=B2/(B2+C2)' } },
          { id: 'r3', cells: { q: `Related: ${link(insight.cardId)}`, n: '=SUM(B1:B2)', d: '=SUM(C1:C2)', s: '=AVERAGE(D1:D2)' } },
        ],
      },
    },
  });
  b.connect(research.cardId, insight.placementId, graphNote.placementId, { dashed: true }, 'informs');
  void survey;

  // --- interviews (3 levels deep)
  const maya = b.note(interviews.cardId, 280, 40, '', { title: 'Interview — Maya' });
  maya.card.text = `## Interview — Maya\nDesigner, 6 yrs. Keeps a wall of sticky notes. "I need to *see* how things relate." → ${link(insight.cardId)}\n- [x] Recorded\n- [ ] Transcribed`;
  const leo = b.note(interviews.cardId, 560, 40, '', { title: 'Interview — Leo' });
  leo.card.text = `## Interview — Leo\nResearcher. Uses backlinks daily; misses a canvas. See also ${link(maya.cardId, 'Maya')}. #interview`;
  maya.card.text += ' #interview';
  const summary = b.note(round1.cardId, 40, 260, '', { title: 'Round 1 summary', color: '#81ecec' });
  summary.card.text = `# Round 1 summary\n2 of 2 participants want spatial + linked. Sources: ${link(maya.cardId)}, ${link(leo.cardId)}.\n\nOpen question: ${link('missing-target-demo', 'a deleted card')} (broken-link example).`;

  // --- moodboard
  b.note(mood.cardId, 40, 40, '# Visual direction\nSoft, tactile, paper-like. Calm colours with one bright accent. #moodboard', { color: '#ffeaa7' });
  ['#2d3436', '#6c5ce7', '#fd79a8', '#ffeaa7', '#55efc4'].forEach((hex, i) =>
    b.card('swatch', mood.cardId, 320 + i * 150, 40, { data: { hex, showCaption: true } }));
  const img1 = uid();
  const img2 = uid();
  b.card('image', mood.cardId, 40, 300, { data: { assetId: img1, mime: 'image/svg+xml', caption: 'Paper texture study', naturalW: 600, naturalH: 400 } });
  b.card('image', mood.cardId, 340, 300, { data: { assetId: img2, mime: 'image/svg+xml', caption: 'Gradient accent', naturalW: 600, naturalH: 400 } });
  b.card('sketch', mood.cardId, 660, 300, {
    title: 'Layout idea',
    data: {
      strokes: [
        { tool: 'pen', color: '#2d3436', width: 3, points: [20, 20, 0.5, 260, 20, 0.5, 260, 180, 0.5, 20, 180, 0.5, 20, 20, 0.5] },
        { tool: 'pen', color: '#6c5ce7', width: 4, points: [40, 60, 0.5, 120, 60, 0.5, 120, 140, 0.5, 40, 140, 0.5, 40, 60, 0.5] },
        { tool: 'highlighter', color: '#fdcb6e', width: 14, points: [150, 70, 0.5, 240, 70, 0.5] },
        { tool: 'pen', color: '#636e72', width: 2, points: [150, 100, 0.5, 240, 100, 0.5, 150, 120, 0.5, 220, 120, 0.5] },
      ],
    },
  });

  // --- project plan
  const cols = ['To do', 'Doing', 'Done'].map((ti, i) => b.column(plan.cardId, 40 + i * 300, 40, ti));
  b.inColumn(cols[0].placementId, 'note', { text: `Draft onboarding using ${link(brief.cardId)}` });
  b.inColumn(cols[0].placementId, 'note', { text: 'Graph performance test (5k nodes) #engineering' });
  b.inColumn(cols[1].placementId, 'note', { text: 'Backlinks panel UI #engineering', color: '#81ecec' });
  b.inColumn(cols[2].placementId, 'note', { text: `Interview synthesis → ${link(summary.cardId)}`, color: '#55efc4' });
  const todo = b.card('todo', plan.cardId, 960, 40, {
    title: 'This week',
    data: {
      items: [
        { id: uid(), text: `Review ${link(insight.cardId)}`, done: true, assignee: alex },
        { id: uid(), text: 'Book usability sessions', done: false, due: new Date(t + 3 * 86400_000).toISOString().slice(0, 10), assignee: owner },
        { id: uid(), text: `Update ${link(brief.cardId, 'brief', 'Audience')}`, done: false, due: new Date(t + 5 * 86400_000).toISOString().slice(0, 10) },
      ],
    },
  });
  b.card('map', plan.cardId, 960, 330, { title: 'Studio', data: { lat: 51.5246, lon: -0.0786, address: 'Shoreditch, London' } });

  // --- private journal (hidden from Sam)
  b.note(journal.cardId, 40, 40, '', { title: 'Reflections' }).card.text =
    `## Reflections\nI keep coming back to ${link(insight.cardId)}. Not ready to share this yet.`;

  // --- home
  const welcome = b.note(rootId, 0, 40, '', { color: '#ffeaa7', title: 'Welcome' }, { w: 280 });
  welcome.card.text = [
    '# Welcome to Nodeboard',
    'A visual board where **every card can link to every other card**.',
    '',
    '- Drag a card type from the left toolbar, or double-click the canvas',
    `- Type \`[[\` in any note to link — try ${link(research.cardId)} or ${link(brief.cardId)}`,
    '- Select a card and press **Cmd/Ctrl+Shift+B** for backlinks',
    '- **Cmd/Ctrl+G** opens the graph, **Cmd/Ctrl+K** jumps anywhere, **?** lists shortcuts',
    '',
    '#onboarding',
  ].join('\n');
  brief.card.text = [
    '# Problem',
    'Visual thinkers lose the connections between their ideas once a board grows beyond a screen.',
    '',
    '# Goals',
    '1. Freeform canvas with Milanote-level speed',
    '2. Bidirectional links between any items',
    `3. A graph view of how everything connects (see ${link(graphNote.cardId, 'graph notes')})`,
    '',
    '# Audience',
    'Designers, writers, researchers and small creative teams. #research',
    '',
    '# Open questions',
    '- [ ] Pricing model',
    '- [x] Name — "Nodeboard" (placeholder)',
  ].join('\n');
  b.connect(rootId, welcome.placementId, research.placementId, { color: '#6c5ce7' }, 'start here');
  b.card('shortcut', rootId, 700, 320, { data: { targetBoardId: round1.cardId } });
  // synced copy of the to-do list on Home
  b.placements.push({ id: uid(), cardId: todo.cardId, boardId: rootId, order: 0, x: 920, y: 320, w: 260, z: 99, columnId: null });

  const commentId = uid();
  const doc: Workspace = {
    id: uid(),
    name: 'Studio',
    ownerId: owner,
    rootBoardId: rootId,
    members: [
      { userId: owner, role: 'owner' },
      { userId: alex, role: 'editor' },
      { userId: sam, role: 'viewer' },
    ],
    users: {
      [owner]: { id: owner, name: 'Ksenia', email: 'you@example.com', color: '#6c5ce7' },
      [alex]: { id: alex, name: 'Alex Rivera', email: 'alex@example.com', color: '#00b894' },
      [sam]: { id: sam, name: 'Sam Lee', email: 'sam@example.com', color: '#e17055' },
    },
    cards: Object.fromEntries([root, ...b.cards].map((c) => [c.id, c])),
    placements: Object.fromEntries(b.placements.map((p) => [p.id, p])),
    connectors: Object.fromEntries(b.connectors.map((c) => [c.id, c])),
    comments: {
      [commentId]: { id: commentId, targetId: brief.cardId, authorId: alex, body: `@Ksenia should the goals mention ${link(insight.cardId)} explicitly?`, createdAt: t, parentId: null },
    },
    permissions: (() => {
      const id = uid();
      return { [id]: { id, boardId: journal.cardId, userId: sam, role: 'none' as const } };
    })(),
    shareLinks: {},
    activity: [],
    notifications: [{ id: uid(), userId: owner, at: t, read: false, targetId: brief.cardId, text: 'Alex Rivera mentioned you on "Product brief"' }],
    graphViews: {},
    graphSettings: {},
    templates: {},
    favorites: { [owner]: [research.cardId] },
    recent: {},
    version: 1,
  };

  const assets = Promise.all([
    putAsset(img1, svgBlob('#ffeaa7', '#fab1a0', 'paper')),
    putAsset(img2, svgBlob('#6c5ce7', '#fd79a8', 'gradient')),
  ]).then(() => undefined);
  return { doc, assets };
}

function svgBlob(a: string, b: string, kind: 'paper' | 'gradient') {
  const dots = kind === 'paper'
    ? Array.from({ length: 120 }, (_, i) => `<circle cx="${(i * 97) % 600}" cy="${(i * 61) % 400}" r="${1 + (i % 4)}" fill="#00000010"/>`).join('')
    : '<circle cx="420" cy="140" r="120" fill="#ffffff30"/><circle cx="160" cy="300" r="80" fill="#ffffff20"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="400" fill="url(#g)"/>${dots}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
