// Turning dropped / pasted content into cards: files from the desktop,
// images dragged from other sites, URLs and plain text.

import { createCard } from '../model/actions';
import { putAsset, toast, uid } from '../model/store';
import { attachFile, fetchLinkPreview, imageSize } from './cards/MediaCards';
import { t } from '../i18n';

const URL_RE = /^https?:\/\/\S+$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;

export async function addImageFile(file: Blob, name: string, boardId: string, x: number, y: number, opts: { tray?: boolean } = {}) {
  const id = uid();
  await putAsset(id, file);
  const dims = await imageSize(file);
  const w = Math.min(320, Math.max(160, dims.w));
  return createCard('image', { boardId, x, y, w, tray: opts.tray, data: { assetId: id, mime: file.type, fileName: name, naturalW: dims.w, naturalH: dims.h } });
}

export async function addFiles(files: File[], boardId: string, x: number, y: number) {
  let i = 0;
  for (const f of files) {
    const px = x + (i % 4) * 30;
    const py = y + i * 30;
    if (f.type.startsWith('image/')) await addImageFile(f, f.name, boardId, px, py);
    else {
      const { cardId } = createCard('file', { boardId, x: px, y: py, title: f.name });
      await attachFile(cardId, f, f.name);
    }
    i++;
  }
  if (files.length > 1) toast(t('Added {n} files', { n: files.length }));
}

export function addUrl(url: string, boardId: string, x: number, y: number) {
  if (IMG_EXT.test(url)) return createCard('image', { boardId, x, y, data: { url } });
  const { cardId, placementId } = createCard('link', { boardId, x, y, data: { url } });
  void fetchLinkPreview(cardId, url);
  return { cardId, placementId };
}

export async function handleDroppedData(dt: DataTransfer, boardId: string, x: number, y: number) {
  const files = [...dt.files];
  if (files.length) return addFiles(files, boardId, x, y);
  const html = dt.getData('text/html');
  const imgSrc = html && /<img[^>]+src="([^"]+)"/i.exec(html)?.[1];
  if (imgSrc && /^https?:/.test(imgSrc)) {
    // try to keep a local copy; fall back to hot-linking when CORS blocks it
    try {
      const r = await fetch(imgSrc);
      const blob = await r.blob();
      if (blob.type.startsWith('image/')) return addImageFile(blob, imgSrc.split('/').pop() ?? 'image', boardId, x, y);
    } catch {
      /* CORS */
    }
    return createCard('image', { boardId, x, y, data: { url: imgSrc } });
  }
  const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (uri && URL_RE.test(uri.trim())) return addUrl(uri.trim(), boardId, x, y);
  if (uri?.trim()) return createCard('note', { boardId, x, y, text: uri.trim() });
}

export async function handlePaste(cd: DataTransfer, boardId: string, x: number, y: number): Promise<boolean> {
  const files = [...cd.files];
  if (files.length) {
    await addFiles(files.map((f, i) => (f.name === 'image.png' ? new File([f], `Pasted image ${i + 1}.png`, { type: f.type }) : f)), boardId, x, y);
    return true;
  }
  const text = cd.getData('text/plain');
  if (!text?.trim()) return false;
  if (URL_RE.test(text.trim())) addUrl(text.trim(), boardId, x, y);
  else createCard('note', { boardId, x, y, text: text.trim().slice(0, 20000) });
  return true;
}
