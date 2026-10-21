import { useState } from 'react';
import type { BodyProps } from '../CardView';
import { createCard, updateCard, updateData } from '../../model/actions';
import { assetUrl, getDoc, toast } from '../../model/store';
import { getIndex } from '../../model/index';
import { t } from '../../i18n';
import { Icon } from '../icons';

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
function readable(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#2d3436' : '#ffffff';
}

/** Dominant colours of an image via k-means on a downsampled copy. */
export async function paletteFromImage(url: string, k = 5): Promise<string[]> {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.src = url;
  await im.decode();
  const c = document.createElement('canvas');
  const s = 64;
  c.width = s;
  c.height = Math.max(1, Math.round((s * im.naturalHeight) / im.naturalWidth));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(im, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const px: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  let centers = Array.from({ length: k }, (_, i) => px[Math.floor((i * px.length) / k)]);
  for (let it = 0; it < 10; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c2, j) => {
        const d = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      });
      const sm = sums[best];
      sm[0] += p[0]; sm[1] += p[1]; sm[2] += p[2]; sm[3]++;
    }
    centers = sums.map((sm, j) => (sm[3] ? [sm[0] / sm[3], sm[1] / sm[3], sm[2] / sm[3]] : centers[j])) as [number, number, number][];
  }
  return [...new Set(centers.map((c2) => rgbToHex(...c2)))];
}

export async function suggestPaletteFromBoard(boardId: string, x: number, y: number) {
  const doc = getDoc();
  const ps = getIndex(doc).placementsByBoard.get(boardId) ?? [];
  const imgs = ps.map((p) => doc.cards[p.cardId]).filter((c) => c?.type === 'image');
  if (!imgs.length) {
    toast(t('Add images to this board first'));
    return;
  }
  const colors: string[] = [];
  for (const c of imgs.slice(0, 6)) {
    const url = c.data.assetId ? await assetUrl(c.data.assetId) : c.data.url;
    if (!url) continue;
    try {
      colors.push(...(await paletteFromImage(url, imgs.length > 2 ? 3 : 5)));
    } catch {
      /* tainted / failed */
    }
  }
  const uniq = colors.filter((c, i) => colors.findIndex((d) => dist(c, d) < 40) === i).slice(0, 6);
  uniq.forEach((hex, i) => createCard('swatch', { boardId, x: x + i * 150, y, data: { hex, showCaption: true }, select: false }));
  toast(t('Added {n} swatches from board images', { n: uniq.length }));
}

function dist(a: string, b: string) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function SwatchCard({ card, placement, editing, readOnly }: BodyProps) {
  const hex = card.data.hex ?? '#6c5ce7';
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const [draft, setDraft] = useState(hex);
  const [sampling, setSampling] = useState(false);
  const set = (v: string) => {
    setDraft(v);
    if (/^#[0-9a-f]{6}$/i.test(v)) updateData(card.id, { hex: v.toLowerCase() });
  };
  const eyedrop = async () => {
    const ED = (window as any).EyeDropper;
    if (ED) {
      try {
        const res = await new ED().open();
        set(res.sRGBHex);
      } catch {
        /* cancelled */
      }
    } else setSampling(true);
  };
  return (
    <div className="card-body swatch-body">
      <div className="swatch-color" style={{ background: hex, color: readable(hex) }}>
        {card.title && <span className="swatch-name">{card.title}</span>}
      </div>
      {(card.data.showCaption ?? true) && (
        <div className="swatch-values">
          <code>{hex.toUpperCase()}</code>
          <code>rgb({r}, {g}, {b})</code>
          <code>hsl({h}, {s}%, {l}%)</code>
        </div>
      )}
      {editing && !readOnly && (
        <div className="interactive swatch-edit">
          <input className="title-input" value={card.title} placeholder={t('Name')} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <div className="row">
            <input type="color" value={hex} onChange={(e) => set(e.target.value)} aria-label={t('Colour picker')} />
            <input value={draft} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="HEX" />
          </div>
          <div className="row">
            <button className="btn small" onClick={() => void eyedrop()} title={t('Pick a colour from the screen or an image on the board')}><Icon name="drop" size={14} /> {t('Eyedropper')}</button>
            <label className="small"><input type="checkbox" checked={card.data.showCaption ?? true} onChange={(e) => updateData(card.id, { showCaption: e.target.checked })} /> {t('Caption')}</label>
          </div>
          <button className="btn small" onClick={() => void suggestPaletteFromBoard(placement.boardId, placement.x, placement.y + 200)}><Icon name="palette" size={14} /> {t('Suggest palette from board images')}</button>
          {sampling && <ImageSampler boardId={placement.boardId} onPick={(c) => { set(c); setSampling(false); }} onClose={() => setSampling(false)} />}
        </div>
      )}
    </div>
  );
}

/** Fallback eyedropper for browsers without the EyeDropper API: click a pixel of a board image. */
function ImageSampler({ boardId, onPick, onClose }: { boardId: string; onPick: (hex: string) => void; onClose: () => void }) {
  const doc = getDoc();
  const ps = getIndex(doc).placementsByBoard.get(boardId) ?? [];
  const imgs = ps.map((p) => doc.cards[p.cardId]).filter((c) => c?.type === 'image');
  const [urls, setUrls] = useState<string[]>([]);
  if (!urls.length && imgs.length)
    void Promise.all(imgs.map((c) => (c.data.assetId ? assetUrl(c.data.assetId) : Promise.resolve(c.data.url ?? null)))).then((u) => setUrls(u.filter(Boolean) as string[]));
  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(im, 0, 0);
    const r = im.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * im.naturalWidth);
    const y = Math.floor(((e.clientY - r.top) / r.height) * im.naturalHeight);
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      onPick(rgbToHex(d[0], d[1], d[2]));
    } catch {
      toast(t('Cannot sample colours from this image'));
    }
  };
  return (
    <div className="sampler">
      <div className="row"><strong>{t('Click a pixel')}</strong><button className="icon-btn" onClick={onClose}>×</button></div>
      {!imgs.length && <div className="muted small">{t('No images on this board')}</div>}
      <div className="sampler-grid">
        {urls.map((u) => <img key={u} src={u} alt="" crossOrigin="anonymous" onClick={pick} />)}
      </div>
    </div>
  );
}
