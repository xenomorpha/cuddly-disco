// Wiki-link parsing and the UUID <-> title round trip (spec §4.1, §4.4).
//
// Stored form:   [[@<uuid>]], [[@<uuid>#Heading]], [[@<uuid>|alias]]
// Editable form: [[Title]],   [[Title#Heading]],   [[Title|alias]],  [[Board/Title]]
// Unresolved:    [[Some title]] stays as typed and renders as a broken link.
//
// Links are stored by UUID, so renaming or moving the target never breaks them;
// the title shown to the user is substituted at render/edit time.

export interface ParsedLink {
  /** set when the link is resolved to a card/board */
  targetId: string | null;
  /** raw reference text for unresolved links (title or Board/Title path) */
  ref: string | null;
  anchor: string | null;
  alias: string | null;
  index: number;
  length: number;
}

const WIKI_RE = /\[\[([^\[\]\n]+?)\]\]/g;

export function parseLinks(text: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  if (!text) return out;
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(text))) {
    const inner = m[1];
    let body = inner;
    let alias: string | null = null;
    const pipe = body.indexOf('|');
    if (pipe >= 0) {
      alias = body.slice(pipe + 1).trim() || null;
      body = body.slice(0, pipe);
    }
    let anchor: string | null = null;
    const hash = body.indexOf('#');
    if (hash >= 0) {
      anchor = body.slice(hash + 1).trim() || null;
      body = body.slice(0, hash);
    }
    body = body.trim();
    if (!body) continue;
    const isId = body.startsWith('@');
    out.push({
      targetId: isId ? body.slice(1) : null,
      ref: isId ? null : body,
      anchor,
      alias,
      index: m.index,
      length: m[0].length,
    });
  }
  return out;
}

export function formatLink(target: string, anchor: string | null, alias: string | null): string {
  return `[[${target}${anchor ? '#' + anchor : ''}${alias ? '|' + alias : ''}]]`;
}

/** Ids of every resolved link target in a piece of text (deduplicated). */
export function linkTargets(text: string): string[] {
  const set = new Set<string>();
  for (const l of parseLinks(text)) if (l.targetId) set.add(l.targetId);
  return [...set];
}

/**
 * Stored -> editable. `label(id)` returns the reference to show in the editor
 * (the title, or a Board/Title path when the title is ambiguous), or null when
 * the target no longer exists at all.
 */
export function toEditable(text: string, label: (id: string) => string | null): string {
  const links = parseLinks(text);
  if (!links.length) return text;
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += text.slice(pos, l.index);
    if (l.targetId) {
      const name = label(l.targetId);
      out += formatLink(name ?? '@' + l.targetId, l.anchor, l.alias);
    } else {
      out += text.slice(l.index, l.index + l.length);
    }
    pos = l.index + l.length;
  }
  return out + text.slice(pos);
}

/**
 * Editable -> stored. References the user did not touch keep the id they had
 * before (so two cards with the same title don't swap); new references are
 * resolved with `resolve(ref)`. Anything unresolved is kept verbatim.
 */
export function fromEditable(
  edited: string,
  previousStored: string,
  label: (id: string) => string | null,
  resolve: (ref: string) => string | null,
): string {
  const known = new Map<string, string>();
  for (const l of parseLinks(previousStored)) {
    if (!l.targetId) continue;
    const name = label(l.targetId);
    if (name) known.set(name.toLowerCase(), l.targetId);
  }
  const links = parseLinks(edited);
  if (!links.length) return edited;
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += edited.slice(pos, l.index);
    if (l.targetId) {
      out += edited.slice(l.index, l.index + l.length);
    } else {
      const ref = l.ref!;
      const id = known.get(ref.toLowerCase()) ?? resolve(ref);
      out += id ? formatLink('@' + id, l.anchor, l.alias) : edited.slice(l.index, l.index + l.length);
    }
    pos = l.index + l.length;
  }
  return out + edited.slice(pos);
}

export interface Resolvable {
  id: string;
  title: string;
  boardTitle: string; // title of the board the item lives on
  updatedAt: number;
}

/** Resolve "Title" or "Board/Title" against a list of candidates. */
export function resolveRef(ref: string, items: Resolvable[]): string | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  const byTitle = items.filter((i) => i.title.trim().toLowerCase() === r);
  if (byTitle.length) return newest(byTitle).id;
  const slash = r.lastIndexOf('/');
  if (slash > 0) {
    const board = r.slice(0, slash).trim();
    const title = r.slice(slash + 1).trim();
    const hits = items.filter(
      (i) => i.title.trim().toLowerCase() === title && i.boardTitle.trim().toLowerCase() === board,
    );
    if (hits.length) return newest(hits).id;
  }
  return null;
}

function newest<T extends { updatedAt: number }>(xs: T[]): T {
  return xs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}

/** Label used in the editor: Title, or Board/Title when the title is not unique. */
export function editorLabel(id: string, items: Map<string, Resolvable>, titleCounts: Map<string, number>): string | null {
  const it = items.get(id);
  if (!it) return null;
  const t = it.title.trim() || 'Untitled';
  if ((titleCounts.get(t.toLowerCase()) ?? 0) > 1 && it.boardTitle) return `${it.boardTitle}/${t}`;
  return t;
}

// ---------------------------------------------------------------- tags

const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;

export function extractTags(text: string): string[] {
  if (!text) return [];
  const stripped = stripCode(text).replace(WIKI_RE, ' ');
  const set = new Set<string>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(stripped))) set.add(m[2].toLowerCase());
  return [...set];
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

// ---------------------------------------------------------------- unlinked mentions

export interface Mention {
  index: number;
  length: number;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Plain-text occurrences of `title` that are not already inside a [[link]]. */
export function findMentions(text: string, title: string): Mention[] {
  const t = title.trim();
  if (t.length < 2 || !text) return [];
  const blocked: [number, number][] = parseLinks(text).map((l) => [l.index, l.index + l.length]);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_#@/])${escapeRe(t)}(?![\\p{L}\\p{N}_])`, 'giu');
  const out: Mention[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (blocked.some(([a, b]) => s < b && e > a)) continue;
    out.push({ index: s, length: m[0].length });
  }
  return out;
}

/** Turn one plain-text mention into a link, keeping the original wording as alias if it differs. */
export function linkMention(text: string, mention: Mention, targetId: string, title: string): string {
  const original = text.slice(mention.index, mention.index + mention.length);
  const alias = original === title ? null : original;
  return text.slice(0, mention.index) + formatLink('@' + targetId, null, alias) + text.slice(mention.index + mention.length);
}

// ---------------------------------------------------------------- display helpers

/** Replace link tokens with readable text, for snippets / search / export. */
export function toPlain(text: string, label: (id: string) => string | null): string {
  const links = parseLinks(text);
  let out = '';
  let pos = 0;
  for (const l of links) {
    out += text.slice(pos, l.index);
    out += l.alias ?? (l.targetId ? label(l.targetId) ?? 'missing' : l.ref);
    pos = l.index + l.length;
  }
  return out + text.slice(pos);
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** A snippet of `text` around [index, index+length), rendered in plain form. */
export function snippetAround(
  text: string,
  index: number,
  length: number,
  label: (id: string) => string | null,
  radius = 60,
): Snippet {
  const before = toPlain(text.slice(0, index), label);
  const match = toPlain(text.slice(index, index + length), label);
  const after = toPlain(text.slice(index + length), label);
  const b = before.length > radius ? '…' + before.slice(before.length - radius) : before;
  const a = after.length > radius ? after.slice(0, radius) + '…' : after;
  return { before: b.replace(/\s+/g, ' '), match, after: a.replace(/\s+/g, ' ') };
}

export function headings(text: string): { level: number; text: string; slug: string }[] {
  const out: { level: number; text: string; slug: string }[] = [];
  for (const line of (text || '').split('\n')) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), slug: slugify(m[2]) });
  }
  return out;
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

/** Find an open "[[query" right before the caret (for autocomplete). */
export function openLinkQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const between = before.slice(open + 2);
  if (between.includes(']]') || between.includes('\n')) return null;
  return { start: open, query: between };
}
