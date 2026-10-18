import { describe, it, expect } from 'vitest';
import {
  parseLinks, linkTargets, toEditable, fromEditable, resolveRef, extractTags, findMentions,
  linkMention, toPlain, snippetAround, headings, slugify, openLinkQuery, editorLabel, formatLink,
} from './links';

const titles: Record<string, string> = { a1: 'Alpha', b2: 'Beta', c3: 'Research' };
const label = (id: string) => titles[id] ?? null;

describe('parseLinks', () => {
  it('parses resolved, anchored and aliased links', () => {
    const ls = parseLinks('see [[@a1]] and [[@b2#Intro|the beta]] or [[Gamma]]');
    expect(ls).toHaveLength(3);
    expect(ls[0]).toMatchObject({ targetId: 'a1', anchor: null, alias: null });
    expect(ls[1]).toMatchObject({ targetId: 'b2', anchor: 'Intro', alias: 'the beta' });
    expect(ls[2]).toMatchObject({ targetId: null, ref: 'Gamma' });
  });
  it('ignores empty and multi-line brackets', () => {
    expect(parseLinks('[[ ]] [[a\nb]] [[]]')).toHaveLength(0);
    expect(parseLinks('')).toHaveLength(0);
  });
  it('dedupes link targets', () => {
    expect(linkTargets('[[@a1]] [[@a1|x]] [[@b2]]')).toEqual(['a1', 'b2']);
  });
  it('formats links', () => {
    expect(formatLink('@x', 'h', 'al')).toBe('[[@x#h|al]]');
  });
});

describe('round trip', () => {
  it('converts stored ids to titles and back', () => {
    const stored = 'x [[@a1]] y [[@b2#Intro|bb]] z [[Nope]]';
    const ed = toEditable(stored, label);
    expect(ed).toBe('x [[Alpha]] y [[Beta#Intro|bb]] z [[Nope]]');
    const back = fromEditable(ed, stored, label, () => null);
    expect(back).toBe(stored);
  });
  it('renaming a target keeps the link (stored by id)', () => {
    const stored = '[[@a1]]';
    titles.a1 = 'Alpha renamed';
    expect(toEditable(stored, label)).toBe('[[Alpha renamed]]');
    titles.a1 = 'Alpha';
  });
  it('resolves newly typed references', () => {
    const out = fromEditable('[[Research]] and [[research|r]]', '', label, (r) => (r.toLowerCase() === 'research' ? 'c3' : null));
    expect(out).toBe('[[@c3]] and [[@c3|r]]');
  });
  it('prefers the previously linked id for untouched references', () => {
    const out = fromEditable('[[Alpha]]', '[[@a1]]', label, () => 'other');
    expect(out).toBe('[[@a1]]');
  });
  it('shows missing targets with their raw id', () => {
    expect(toEditable('[[@zz]]', label)).toBe('[[@@zz]]'.replace('@@', '@'));
  });
  it('leaves already-stored ids untouched on save', () => {
    expect(fromEditable('[[@zz]]', '', label, () => null)).toBe('[[@zz]]');
    expect(fromEditable('plain', '', label, () => null)).toBe('plain');
  });
});

describe('resolveRef', () => {
  const items = [
    { id: '1', title: 'Ideas', boardTitle: 'Work', updatedAt: 1 },
    { id: '2', title: 'Ideas', boardTitle: 'Home', updatedAt: 5 },
    { id: '3', title: 'Plan', boardTitle: 'Work', updatedAt: 2 },
  ];
  it('matches titles case-insensitively, newest first', () => {
    expect(resolveRef('ideas', items)).toBe('2');
    expect(resolveRef('PLAN', items)).toBe('3');
  });
  it('disambiguates Board/Card', () => {
    expect(resolveRef('Work/Ideas', items)).toBe('1');
    expect(resolveRef('home/ideas', items)).toBe('2');
  });
  it('returns null when nothing matches', () => {
    expect(resolveRef('Nope', items)).toBeNull();
    expect(resolveRef('X/Nope', items)).toBeNull();
    expect(resolveRef('  ', items)).toBeNull();
  });
  it('builds editor labels with board prefix for duplicates', () => {
    const map = new Map(items.map((i) => [i.id, i]));
    const counts = new Map([['ideas', 2], ['plan', 1]]);
    expect(editorLabel('1', map, counts)).toBe('Work/Ideas');
    expect(editorLabel('3', map, counts)).toBe('Plan');
    expect(editorLabel('9', map, counts)).toBeNull();
  });
});

describe('tags', () => {
  it('extracts hashtags but not headings, code, urls or link anchors', () => {
    const t = extractTags('# Heading\nwe #Research this (#ux/flows) `#code` [[@a1#Intro]] http://x.y/#frag');
    expect(t.sort()).toEqual(['research', 'ux/flows']);
  });
  it('supports unicode tags', () => {
    expect(extractTags('#идея here')).toEqual(['идея']);
  });
});

describe('mentions', () => {
  it('finds plain-text mentions outside links, on word boundaries', () => {
    const text = 'Alpha is here, alphabet is not, [[@a1|Alpha]] is linked, alpha again';
    const ms = findMentions(text, 'Alpha');
    expect(ms.map((m) => text.slice(m.index, m.index + m.length))).toEqual(['Alpha', 'alpha']);
  });
  it('does not treat #tags or @mentions as mentions', () => {
    expect(findMentions('see #moodboard and @Moodboard', 'Moodboard')).toEqual([]);
  });
  it('ignores very short titles', () => {
    expect(findMentions('a b c', 'a')).toEqual([]);
  });
  it('converts a mention into a link keeping wording as alias', () => {
    const text = 'about alpha today';
    const [m] = findMentions(text, 'Alpha');
    expect(linkMention(text, m, 'a1', 'Alpha')).toBe('about [[@a1|alpha]] today');
    const text2 = 'about Alpha';
    expect(linkMention(text2, findMentions(text2, 'Alpha')[0], 'a1', 'Alpha')).toBe('about [[@a1]]');
  });
});

describe('display helpers', () => {
  it('renders plain text', () => {
    expect(toPlain('a [[@a1]] b [[@b2|bee]] c [[Ref]] [[@gone]]', label)).toBe('a Alpha b bee c Ref missing');
  });
  it('builds snippets around a link', () => {
    const text = 'x'.repeat(100) + ' see [[@a1]] now ' + 'y'.repeat(100);
    const idx = text.indexOf('[[');
    const s = snippetAround(text, idx, 7, label, 10);
    expect(s.match).toBe('Alpha');
    expect(s.before.startsWith('…')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
  });
  it('lists headings with slugs', () => {
    expect(headings('# One\ntext\n## Two Words\n#### no')).toEqual([
      { level: 1, text: 'One', slug: 'one' },
      { level: 2, text: 'Two Words', slug: 'two-words' },
    ]);
    expect(slugify('  Hello, World! ')).toBe('hello-world');
  });
  it('detects an open [[ query at the caret', () => {
    expect(openLinkQuery('see [[Alp', 9)).toEqual({ start: 4, query: 'Alp' });
    expect(openLinkQuery('see [[Alp]] x', 13)).toBeNull();
    expect(openLinkQuery('no link', 7)).toBeNull();
    expect(openLinkQuery('[[a\nb', 5)).toBeNull();
  });
});
