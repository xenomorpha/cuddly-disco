// Export / import (spec §7): board → PNG / PDF, card → Markdown with [[links]]
// preserved, workspace → ZIP of Markdown + assets + graph.json, and import of
// a Markdown folder (e.g. an Obsidian vault) mapping files to cards and
// [[links]] to links.

import JSZip from 'jszip';
import type { Card, Workspace } from './types';
import { DEFAULT_GRAPH_SETTINGS } from './types';
import { getDoc, getAssetBlob, getUI, putAsset, replaceDoc, toast, uid } from './store';
import { boardPath, cardTitle, getIndex } from './index';
import { formatLink, parseLinks, toEditable } from './links';
import { buildGraph } from './graph';
import { makeAccess } from './permissions';
import { evaluate } from './formula';
import { Builder } from './builder';
import { pastePayload } from './actions';

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

// ------------------------------------------------------------------ board images

async function renderBoard(boardId: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const { toPng } = await import('html-to-image');
  const world = document.querySelector(`.canvas[data-board="${boardId}"] .world`) as HTMLElement | null;
  if (!world) return null;
  const cards = [...world.querySelectorAll(':scope > .card')] as HTMLElement[];
  if (!cards.length) return null;
  const host = world.parentElement!.getBoundingClientRect();
  const zoom = getUI().viewports[boardId]?.zoom ?? 1;
  const vp = getUI().viewports[boardId] ?? { x: 0, y: 0, zoom: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const x = (r.left - host.left - vp.x) / zoom;
    const y = (r.top - host.top - vp.y) / zoom;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + r.width / zoom);
    maxY = Math.max(maxY, y + r.height / zoom);
  }
  const pad = 40;
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);
  const bg = getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim() || '#f5f3ef';
  const dataUrl = await toPng(world, {
    width: w,
    height: h,
    pixelRatio: Math.min(2, 8000 / Math.max(w, h)),
    backgroundColor: bg,
    style: { transform: `translate(${-minX + pad}px, ${-minY + pad}px) scale(1)`, transformOrigin: '0 0' },
    filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('resize-handle') || n.classList.contains('connect-handle') || n.tagName === 'IFRAME')),
  });
  return { dataUrl, w, h };
}

export async function exportBoardPNG(boardId: string) {
  toast('Rendering PNG…');
  const r = await renderBoard(boardId);
  if (!r) return toast('Nothing to export on this board');
  const blob = await (await fetch(r.dataUrl)).blob();
  download(safe(cardTitle(getDoc().cards[boardId])) + '.png', blob);
}

export async function exportBoardPDF(boardId: string) {
  toast('Rendering PDF…');
  const r = await renderBoard(boardId);
  if (!r) return toast('Nothing to export on this board');
  const { jsPDF } = await import('jspdf');
  const landscape = r.w >= r.h;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'px', format: [r.w, r.h], hotfixes: ['px_scaling'] });
  pdf.addImage(r.dataUrl, 'PNG', 0, 0, r.w, r.h);
  pdf.setProperties({ title: cardTitle(getDoc().cards[boardId]) });
  download(safe(cardTitle(getDoc().cards[boardId])) + '.pdf', pdf.output('blob'));
}

// ------------------------------------------------------------------ markdown

/** Markdown for one card, with links written as [[Title]] (Obsidian-compatible). */
export function cardToMarkdown(doc: Workspace, card: Card, withFrontmatter = true): string {
  const idx = getIndex(doc);
  const label = (id: string) => (doc.cards[id] ? safe(idx.title(id)) : null);
  const ed = (s: string) => toEditable(s, label);
  const tags = idx.cardTags.get(card.id) ?? [];
  const fm = withFrontmatter
    ? ['---', `id: ${card.id}`, `type: ${card.type}`, `created: ${new Date(card.createdAt).toISOString()}`, `updated: ${new Date(card.updatedAt).toISOString()}`, tags.length ? `tags: [${tags.join(', ')}]` : '', card.color ? `color: "${card.color}"` : '', '---', ''].filter(Boolean).join('\n') + '\n'
    : '';
  let body = '';
  const title = idx.title(card.id);
  switch (card.type) {
    case 'todo':
      body = `# ${title}\n\n` + (card.data.items ?? []).map((i) => `- [${i.done ? 'x' : ' '}] ${ed(i.text)}${i.due ? ` 📅 ${i.due}` : ''}${i.assignee && doc.users[i.assignee] ? ` @${doc.users[i.assignee].name}` : ''}`).join('\n');
      break;
    case 'table': {
      const tb = card.data.table!;
      const get = (c: number, r: number) => tb.rows[r]?.cells[tb.columns[c]?.id] ?? '';
      body = `# ${title}\n\n| ${tb.columns.map((c) => c.name).join(' | ')} |\n| ${tb.columns.map(() => '---').join(' | ')} |\n` +
        tb.rows.map((r) => '| ' + tb.columns.map((c) => { const v = r.cells[c.id] ?? ''; return String(v.startsWith('=') ? evaluate(v, get) : ed(v)).replace(/\|/g, '\\|'); }).join(' | ') + ' |').join('\n');
      break;
    }
    case 'link':
      body = `# ${title}\n\n[${card.data.url}](${card.data.url})\n\n${card.data.description ?? ''}`;
      break;
    case 'image':
    case 'file':
      body = `# ${title}\n\n${card.data.assetId ? `![[${assetName(card)}]]` : card.data.url ? `![](${card.data.url})` : ''}\n\n${ed(card.data.caption ?? '')}`;
      break;
    case 'swatch':
      body = `# ${title}\n\nColour: \`${card.data.hex}\``;
      break;
    case 'map':
      body = `# ${title}\n\n${card.data.address ?? ''}\n\nhttps://www.openstreetmap.org/?mlat=${card.data.lat}&mlon=${card.data.lon}`;
      break;
    case 'board': {
      const ps = idx.placementsByBoard.get(card.id) ?? [];
      body = `# ${title}\n\n` + ps.map((p) => `- ${formatLink(safe(idx.title(p.cardId)), null, null)}`).join('\n');
      break;
    }
    default:
      body = (card.title && !card.text.startsWith('#') ? `# ${card.title}\n\n` : '') + ed(card.text);
  }
  if (card.text && !['note', 'document', 'comment'].includes(card.type)) body += '\n\n' + ed(card.text);
  const comments = Object.values(doc.comments).filter((c) => c.targetId === card.id);
  if (comments.length) body += '\n\n## Comments\n' + comments.map((c) => `> **${doc.users[c.authorId]?.name ?? '?'}**: ${ed(c.body)}`).join('\n');
  return fm + body + '\n';
}

function assetName(card: Card) {
  const ext = (card.data.fileName?.split('.').pop() || card.data.mime?.split('/')[1] || 'bin').replace('svg+xml', 'svg').replace('+', '');
  return `${card.data.assetId}.${ext}`;
}

export function exportCardMarkdown(cardId: string) {
  const doc = getDoc();
  const c = doc.cards[cardId];
  if (!c) return;
  download(safe(getIndex(doc).title(cardId)) + '.md', new Blob([cardToMarkdown(doc, c)], { type: 'text/markdown' }));
}

// ------------------------------------------------------------------ workspace zip

export async function exportWorkspaceZip() {
  const doc = getDoc();
  const idx = getIndex(doc);
  const zip = new JSZip();
  const used = new Set<string>();
  const folderOf = (boardId: string) => boardPath(doc, boardId).map((b) => safe(idx.title(b))).join('/');
  for (const c of Object.values(doc.cards)) {
    if (!idx.isLive(c.id) || c.type === 'column') continue;
    const folder = c.type === 'board' ? folderOf(c.id) : folderOf(idx.homeBoard.get(c.id) ?? doc.rootBoardId);
    let name = `${folder}/${safe(idx.title(c.id))}${c.type === 'board' ? '/_board' : ''}.md`;
    if (used.has(name.toLowerCase())) name = name.replace(/\.md$/, ` (${c.id.slice(0, 6)}).md`);
    used.add(name.toLowerCase());
    zip.file(name, cardToMarkdown(doc, c));
    if (c.data.assetId) {
      const blob = await getAssetBlob(c.data.assetId);
      if (blob) zip.file('assets/' + assetName(c), blob);
    }
  }
  const owner = makeAccess(doc, doc.ownerId);
  const graph = buildGraph(doc, idx, owner, { ...DEFAULT_GRAPH_SETTINGS, showContainment: true, showTags: true });
  zip.file('graph.json', JSON.stringify(graph, null, 2));
  zip.file('workspace.json', JSON.stringify(doc));
  zip.file('README.txt', `Nodeboard export of "${doc.name}" — ${new Date().toISOString()}\n\n- One Markdown file per card, foldered by board. [[Links]] use card titles (Obsidian-compatible).\n- assets/ holds images and files.\n- graph.json: { nodes, edges } as returned by the graph API.\n- workspace.json: full backup; import it in Settings → Import to restore.\n`);
  const blob = await zip.generateAsync({ type: 'blob' });
  download(safe(doc.name) + '-export.zip', blob);
}

// ------------------------------------------------------------------ import

/** Restore a full workspace backup (workspace.json). Assets are restored when present in the zip. */
export async function importWorkspaceJson(text: string, zip?: JSZip) {
  const doc = JSON.parse(text) as Workspace;
  if (!doc.cards || !doc.rootBoardId) throw new Error('Not a Nodeboard workspace');
  if (zip) {
    const files = zip.folder('assets');
    const tasks: Promise<void>[] = [];
    files?.forEach((path, f) => {
      const id = path.split('.')[0];
      tasks.push(f.async('blob').then((b) => putAsset(id, b)));
    });
    await Promise.all(tasks);
  }
  replaceDoc(doc);
  toast('Workspace restored');
}

export interface VaultFile {
  path: string; // relative path inside the vault, with folders
  file: Blob;
}

const IMG = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** Import a Markdown folder (Obsidian vault): folders → boards, .md → notes/documents, [[links]] → links. */
export async function importVault(files: VaultFile[], vaultName: string) {
  const doc = getDoc();
  const parent = getUI().boardId || doc.rootBoardId;
  const userId = getUI().userId;
  const md = files.filter((f) => f.path.toLowerCase().endsWith('.md') && !f.path.split('/').some((s) => s.startsWith('.')));
  const imgs = files.filter((f) => IMG.test(f.path) && !f.path.split('/').some((s) => s.startsWith('.')));
  if (!md.length && !imgs.length) return toast('No Markdown files found');
  const b = new Builder(userId);
  const ROOT = 'ROOT';
  const rootBoard = b.board(ROOT, 0, 0, vaultName, '📥');
  const boardFor = new Map<string, string>([['', rootBoard.cardId]]);
  const counters = new Map<string, number>();
  const nextPos = (boardId: string, w: number) => {
    const n = counters.get(boardId) ?? 0;
    counters.set(boardId, n + 1);
    void w;
    return { x: (n % 5) * 280, y: Math.floor(n / 5) * 240 };
  };
  const ensureBoard = (folder: string): string => {
    const hit = boardFor.get(folder);
    if (hit) return hit;
    const parts = folder.split('/');
    const parentId = ensureBoard(parts.slice(0, -1).join('/'));
    const p = nextPos(parentId, 170);
    const bd = b.board(parentId, p.x, p.y, parts[parts.length - 1], '📁');
    boardFor.set(folder, bd.cardId);
    return bd.cardId;
  };
  const strip = (p: string) => p.split('/').slice(1).join('/'); // drop the vault folder name
  const byName = new Map<string, string>();
  const created: { cardId: string; raw: string }[] = [];

  for (const f of imgs) {
    const rel = files.every((x) => x.path.includes('/')) ? strip(f.path) : f.path;
    const folder = rel.split('/').slice(0, -1).join('/');
    const boardId = ensureBoard(folder);
    const id = uid();
    await putAsset(id, f.file);
    const name = rel.split('/').pop()!;
    const p = nextPos(boardId, 260);
    const c = b.card('image', boardId, p.x, p.y, { title: name, data: { assetId: id, mime: f.file.type || 'image/png', fileName: name } });
    byName.set(name.toLowerCase(), c.cardId);
  }
  for (const f of md) {
    const rel = files.every((x) => x.path.includes('/')) ? strip(f.path) : f.path;
    const folder = rel.split('/').slice(0, -1).join('/');
    const boardId = ensureBoard(folder);
    let text = await f.file.text();
    let fmTags: string[] = [];
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (fm) {
      const tm = /tags:\s*\[?([^\]\n]*)\]?/.exec(fm[1]);
      if (tm) fmTags = tm[1].split(/[,\s]+/).map((s) => s.replace(/^#/, '').trim()).filter(Boolean);
      text = text.slice(fm[0].length);
    }
    const title = rel.split('/').pop()!.replace(/\.md$/i, '');
    const long = text.length > 1500 || (text.match(/^#{1,3} /gm)?.length ?? 0) > 3;
    const p = nextPos(boardId, 240);
    const c = b.card(long ? 'document' : 'note', boardId, p.x, p.y, { title, labels: fmTags });
    byName.set(title.toLowerCase(), c.cardId);
    byName.set(rel.replace(/\.md$/i, '').toLowerCase(), c.cardId);
    created.push({ cardId: c.cardId, raw: text });
  }
  // second pass: resolve [[links]] and ![[embeds]] by file name / path
  for (const { cardId, raw } of created) {
    let out = '';
    let pos = 0;
    const text = raw.replace(/!\[\[([^\]]+)\]\]/g, '[[$1]]');
    for (const l of parseLinks(text)) {
      out += text.slice(pos, l.index);
      const ref = (l.ref ?? '').replace(/\.md$/i, '').toLowerCase();
      const id = byName.get(ref) ?? byName.get(ref.split('/').pop()!);
      out += id ? formatLink('@' + id, l.anchor, l.alias) : text.slice(l.index, l.index + l.length);
      pos = l.index + l.length;
    }
    out += text.slice(pos);
    b.cards.find((c) => c.id === cardId)!.text = out;
  }
  const x = 40 + Math.random() * 100;
  pastePayload(b.payload(ROOT), parent, x, 40, 'Import vault');
  toast(`Imported ${md.length} notes and ${imgs.length} images into "${vaultName}"`);
}

export async function importFiles(fileList: FileList | File[]) {
  const files = [...fileList];
  if (files.length === 1 && files[0].name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(files[0]);
    const ws = zip.file('workspace.json');
    if (ws) {
      if (!confirm('Restore this workspace backup? It replaces the current workspace in this browser.')) return;
      return importWorkspaceJson(await ws.async('text'), zip);
    }
    const vf: VaultFile[] = [];
    const tasks: Promise<void>[] = [];
    zip.forEach((path, f) => {
      if (!f.dir) tasks.push(f.async('blob').then((blob) => void vf.push({ path, file: blob })));
    });
    await Promise.all(tasks);
    return importVault(vf, files[0].name.replace(/\.zip$/, ''));
  }
  if (files.length === 1 && files[0].name.endsWith('.json')) {
    if (!confirm('Restore this workspace backup? It replaces the current workspace in this browser.')) return;
    return importWorkspaceJson(await files[0].text());
  }
  const vf = files.map((f) => ({ path: (f as any).webkitRelativePath || f.name, file: f as Blob }));
  const root = vf[0]?.path.includes('/') ? vf[0].path.split('/')[0] : 'Imported notes';
  return importVault(vf, root);
}
