// Built-in starter templates (spec §6). Each returns a payload whose top-level
// placements sit on the virtual board "ROOT"; instantiateTemplate() maps that
// onto a newly created board.

import { Builder } from './builder';
import type { SubtreePayload } from './types';
import { uid } from './store';

export interface BuiltinTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  build: (userId: string) => SubtreePayload;
}

const R = 'ROOT';

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'moodboard',
    name: 'Moodboard',
    icon: 'palette',
    description: 'Palette, references and a sketch area for visual direction.',
    build: (u) => {
      const b = new Builder(u);
      b.note(R, 0, 0, '# Moodboard\nCollect references, colours and textures. Drop images straight from your desktop. #moodboard', { color: '#ffeaa7' });
      ['#2d3436', '#e17055', '#fdcb6e', '#00b894', '#74b9ff'].forEach((hex, i) => b.card('swatch', R, 280 + i * 150, 0, { data: { hex, showCaption: true } }));
      const c = b.column(R, 0, 200, 'References');
      b.inColumn(c.placementId, 'note', { text: '## Mood\nCalm · tactile · optimistic' });
      b.inColumn(c.placementId, 'link', { data: { url: 'https://unsplash.com' }, title: 'Unsplash' });
      b.card('sketch', R, 320, 200, { title: 'Composition sketch', data: { strokes: [] } });
      return b.payload(R);
    },
  },
  {
    id: 'project-plan',
    name: 'Project plan',
    icon: 'folder',
    description: 'Kanban columns, milestones and a task list.',
    build: (u) => {
      const b = new Builder(u);
      const cols = ['Backlog', 'In progress', 'Review', 'Done'].map((t, i) => b.column(R, i * 300, 120, t));
      b.inColumn(cols[0].placementId, 'note', { text: 'Define scope' });
      b.inColumn(cols[0].placementId, 'note', { text: 'Collect requirements' });
      b.inColumn(cols[1].placementId, 'note', { text: 'Design first prototype', color: '#81ecec' });
      b.note(R, 0, 0, '# Project plan\nOwner: · Deadline: · Goal:', { color: '#dfe6e9' }, { w: 580 });
      b.card('todo', R, 1220, 120, {
        title: 'Milestones',
        data: { items: ['Kickoff', 'Prototype', 'Beta', 'Launch'].map((text) => ({ id: uid(), text, done: false })) },
      });
      return b.payload(R);
    },
  },
  {
    id: 'creative-brief',
    name: 'Creative brief',
    icon: 'pencil',
    description: 'Objective, audience, message and deliverables.',
    build: (u) => {
      const b = new Builder(u);
      const doc = b.card('document', R, 0, 0, {
        title: 'Creative brief',
        text: '# Background\n\n# Objective\n\n# Audience\n\n# Key message\n\n# Deliverables\n\n# Timeline\n',
      });
      const n1 = b.note(R, 280, 0, '## Audience\nWho are we talking to? What do they believe today?', { color: '#fab1a0' });
      const n2 = b.note(R, 280, 180, '## Single-minded message\nOne sentence.', { color: '#ffeaa7' });
      b.connect(R, doc.placementId, n1.placementId);
      b.connect(R, n1.placementId, n2.placementId);
      return b.payload(R);
    },
  },
  {
    id: 'story-plot',
    name: 'Story plot',
    icon: 'book',
    description: 'Three-act structure with characters and scenes.',
    build: (u) => {
      const b = new Builder(u);
      const acts = ['Act I — Setup', 'Act II — Confrontation', 'Act III — Resolution'].map((t, i) => b.column(R, i * 300, 160, t));
      b.inColumn(acts[0].placementId, 'note', { text: 'Inciting incident' });
      b.inColumn(acts[1].placementId, 'note', { text: 'Midpoint twist' });
      b.inColumn(acts[2].placementId, 'note', { text: 'Climax' });
      const chars = b.column(R, 920, 160, 'Characters', '#a29bfe');
      b.inColumn(chars.placementId, 'note', { text: '## Protagonist\nWants: · Needs: · Flaw:' });
      b.inColumn(chars.placementId, 'note', { text: '## Antagonist\nWants:' });
      b.note(R, 0, 0, '# Story plot\nLogline: ', { color: '#ffeaa7' }, { w: 580 });
      return b.payload(R);
    },
  },
  {
    id: 'research-map',
    name: 'Research map',
    icon: 'flask',
    description: 'Questions, sources and findings, linked together.',
    build: (u) => {
      const b = new Builder(u);
      const q = b.note(R, 0, 0, '# Research question\nWhat do we want to learn?', { color: '#74b9ff', title: 'Research question' });
      const s = b.column(R, 320, 0, 'Sources');
      b.inColumn(s.placementId, 'link', { data: { url: 'https://scholar.google.com' }, title: 'Google Scholar' });
      const f = b.note(R, 0, 260, '', { title: 'Findings' });
      f.card.text = `## Findings\nAnswering [[@${q.cardId}]]. #research`;
      b.connect(R, q.placementId, f.placementId, { dashed: true });
      b.card('table', R, 640, 0, {
        title: 'Evidence',
        data: {
          table: {
            columns: [{ id: 'c1', name: 'Source', kind: 'text' }, { id: 'c2', name: 'Confidence', kind: 'number' }],
            rows: [{ id: 'r1', cells: { c1: 'Interview A', c2: '4' } }, { id: 'r2', cells: { c1: 'Survey', c2: '3' } }, { id: 'r3', cells: { c1: 'Average', c2: '=AVERAGE(B1:B2)' } }],
          },
        },
      });
      return b.payload(R);
    },
  },
  {
    id: 'weekly-planner',
    name: 'Weekly planner',
    icon: 'calendar',
    description: 'A column per day plus priorities.',
    build: (u) => {
      const b = new Builder(u);
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((d, i) => {
        const c = b.column(R, i * 230, 120, d);
        const col = b.placements.find((p) => p.id === c.placementId)!;
        col.w = 210;
      });
      b.card('todo', R, 0, 0, { title: 'Top 3 priorities', data: { items: [1, 2, 3].map(() => ({ id: uid(), text: '', done: false })) } }, { w: 400 });
      b.note(R, 440, 0, 'Notes for the week', { color: '#ffeaa7' });
      return b.payload(R);
    },
  },
];
