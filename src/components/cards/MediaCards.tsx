import { useEffect, useRef, useState } from 'react';
import type { BodyProps } from '../CardView';
import { WikiEditor } from '../WikiEditor';
import { Inline } from '../Markdown';
import { updateCard, updateData } from '../../model/actions';
import { putAsset, toast, uid } from '../../model/store';
import { useAssetUrl } from '../../hooks';
import { Icon } from '../icons';
import { t } from '../../i18n';

// ------------------------------------------------------------------ image

export function ImageCard({ card, editing, setEditing, readOnly }: BodyProps) {
  const assetUrl = useAssetUrl(card.data.assetId);
  const src = assetUrl ?? card.data.url ?? null;
  const [cropping, setCropping] = useState(false);
  const crop = card.data.crop;
  const nw = card.data.naturalW ?? 4;
  const nh = card.data.naturalH ?? 3;
  useEffect(() => {
    if (!editing) setCropping(false);
  }, [editing]);

  if (cropping && src)
    return <CropEditor src={src} initial={crop} onDone={(c) => { updateData(card.id, { crop: c ?? undefined }); setCropping(false); }} />;

  return (
    <div className="card-body image-body">
      {src ? (
        crop ? (
          <div className="crop-frame" style={{ aspectRatio: `${crop.w * nw} / ${crop.h * nh}` }}>
            <img
              src={src}
              alt={card.data.caption ?? ''}
              draggable={false}
              style={{ width: `${100 / crop.w}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` }}
            />
          </div>
        ) : (
          <img
            src={src}
            alt={card.data.caption ?? ''}
            draggable={false}
            onLoad={(e) => {
              const im = e.currentTarget;
              if (!card.data.naturalW && im.naturalWidth && !readOnly)
                updateData(card.id, { naturalW: im.naturalWidth, naturalH: im.naturalHeight }, 'natural:' + card.id);
            }}
          />
        )
      ) : (
        <ImagePicker cardId={card.id} readOnly={readOnly} />
      )}
      {editing && !readOnly ? (
        <div className="interactive caption-edit">
          <WikiEditor value={card.data.caption ?? ''} singleLine autoFocus placeholder={t('Caption')} onChange={(caption) => updateData(card.id, { caption })} onDone={() => setEditing(null)} />
          {src && (
            <div className="row">
              <button className="btn small" onClick={() => setCropping(true)}>{t('Crop')}</button>
              {crop && <button className="btn small" onClick={() => updateData(card.id, { crop: undefined })}>{t('Reset crop')}</button>}
              <ImageReplace cardId={card.id} />
            </div>
          )}
        </div>
      ) : (
        card.data.caption && <div className="caption"><Inline text={card.data.caption} /></div>
      )}
    </div>
  );
}

async function fileToImageCard(cardId: string, file: Blob, name?: string) {
  const id = uid();
  await putAsset(id, file);
  const dims = await imageSize(file);
  updateCard(cardId, (c) => {
    c.data.assetId = id;
    c.data.mime = file.type;
    c.data.fileName = name;
    c.data.naturalW = dims.w;
    c.data.naturalH = dims.h;
    c.data.crop = undefined;
    c.data.url = undefined;
  });
}

export function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      res({ w: im.naturalWidth || 400, h: im.naturalHeight || 300 });
      URL.revokeObjectURL(url);
    };
    im.onerror = () => res({ w: 400, h: 300 });
    im.src = url;
  });
}

function ImageReplace({ cardId }: { cardId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn small" onClick={() => ref.current?.click()}>{t('Replace')}</button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && fileToImageCard(cardId, e.target.files[0], e.target.files[0].name)} />
    </>
  );
}

function ImagePicker({ cardId, readOnly }: { cardId: string; readOnly: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; thumb: string; full: string; by: string }[]>([]);
  const key = (() => {
    try {
      return localStorage.getItem('nodeboard:unsplashKey') || '';
    } catch {
      return '';
    }
  })();
  if (readOnly) return <div className="placeholder">{t('No image')}</div>;
  const search = async () => {
    if (!key) {
      toast(t('Add an Unsplash access key in Settings to search stock images'));
      return;
    }
    try {
      const r = await fetch(`https://api.unsplash.com/search/photos?per_page=12&query=${encodeURIComponent(q)}`, { headers: { Authorization: 'Client-ID ' + key } });
      const j = await r.json();
      setResults((j.results ?? []).map((x: any) => ({ id: x.id, thumb: x.urls.thumb, full: x.urls.regular, by: x.user?.name ?? '' })));
    } catch {
      toast(t('Unsplash search failed'));
    }
  };
  return (
    <div className="image-picker interactive">
      <button className="btn" onClick={() => ref.current?.click()}><Icon name="upload" size={14} /> {t('Upload image')}</button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && fileToImageCard(cardId, e.target.files[0], e.target.files[0].name)} />
      <div className="muted small">{t('…or paste / drop an image, or use a URL')}</div>
      <div className="row">
        <input value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn small" disabled={!/^https?:\/\//.test(url)} onClick={() => updateData(cardId, { url })}>{t('Use')}</button>
      </div>
      <div className="row">
        <input value={q} placeholder={t('Search Unsplash')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void search(); }} />
        <button className="btn small" onClick={() => void search()}><Icon name="search" size={14} /></button>
      </div>
      {results.length > 0 && (
        <div className="stock-grid">
          {results.map((r) => (
            <button key={r.id} title={r.by} onClick={() => updateData(cardId, { url: r.full, caption: `Photo by ${r.by} on Unsplash` })}>
              <img src={r.thumb} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CropEditor({ src, initial, onDone }: { src: string; initial?: { x: number; y: number; w: number; h: number }; onDone: (c: { x: number; y: number; w: number; h: number } | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState(initial ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const box = ref.current!.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width;
    const sy = (e.clientY - box.top) / box.height;
    const inside = sx > rect.x && sx < rect.x + rect.w && sy > rect.y && sy < rect.y + rect.h;
    const start = { ...rect };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
      if (inside) {
        setRect({ ...start, x: Math.min(1 - start.w, Math.max(0, start.x + x - sx)), y: Math.min(1 - start.h, Math.max(0, start.y + y - sy)) });
      } else {
        setRect({ x: Math.min(sx, x), y: Math.min(sy, y), w: Math.max(0.05, Math.abs(x - sx)), h: Math.max(0.05, Math.abs(y - sy)) });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="card-body image-body interactive">
      <div className="crop-editor" ref={ref} onPointerDown={onDown}>
        <img src={src} alt="" draggable={false} />
        <div className="crop-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />
      </div>
      <div className="row">
        <button className="btn small primary" onClick={() => onDone(rect)}>{t('Apply crop')}</button>
        <button className="btn small" onClick={() => onDone(initial ?? null)}>{t('Cancel')}</button>
      </div>
      <div className="muted small">{t('Drag to draw the crop area, drag inside to move it')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ link

export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null);
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').find((s) => /^\d+$/.test(s));
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === 'open.spotify.com') {
      const m = /^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(u.pathname);
      return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
    }
  } catch {
    /* not a url */
  }
  return null;
}

export async function fetchLinkPreview(cardId: string, url: string) {
  // Cross-origin pages can't be fetched from the browser; oEmbed (via noembed,
  // CORS-enabled) covers YouTube/Vimeo/Spotify and many others. A server-side
  // fetcher (spec §9: BullMQ "URL previews" job) would handle the rest.
  try {
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url));
    const j = await r.json();
    if (j && !j.error)
      updateCard(cardId, (c) => {
        if (!c.title) c.title = j.title ?? '';
        if (!c.data.description) c.data.description = j.author_name ? `${j.provider_name ?? ''} · ${j.author_name}` : j.provider_name ?? '';
        if (j.thumbnail_url) c.data.cover = j.thumbnail_url;
      });
  } catch {
    /* offline or blocked */
  }
}

export function LinkCard({ card, editing, readOnly }: BodyProps) {
  const url = card.data.url ?? '';
  const [draft, setDraft] = useState(url);
  const [embed, setEmbed] = useState(false);
  let host = '';
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    host = url;
  }
  const emb = embedUrl(url);
  if ((editing && !readOnly) || !url)
    return (
      <div className="card-body link-body interactive">
        <label className="field">
          <span>{t('URL')}</span>
          <input
            autoFocus
            value={draft}
            placeholder="https://"
            readOnly={readOnly}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                const u = /^https?:\/\//.test(draft) ? draft : 'https://' + draft;
                updateData(card.id, { url: u });
                void fetchLinkPreview(card.id, u);
              }
            }}
            onBlur={() => {
              if (draft && draft !== url) {
                const u = /^https?:\/\//.test(draft) ? draft : 'https://' + draft;
                updateData(card.id, { url: u });
                void fetchLinkPreview(card.id, u);
              }
            }}
          />
        </label>
        {url && (
          <>
            <label className="field"><span>{t('Title')}</span><input value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
            <label className="field"><span>{t('Description')}</span><input value={card.data.description ?? ''} onChange={(e) => updateData(card.id, { description: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>
          </>
        )}
      </div>
    );
  return (
    <div className="card-body link-body">
      {emb && embed ? (
        <iframe className="embed" src={emb} title={card.title || host} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      ) : card.data.cover ? (
        <div className="link-cover" style={{ backgroundImage: `url(${card.data.cover})` }}>
          {emb && <button className="play" onClick={(e) => { e.stopPropagation(); setEmbed(true); }} aria-label={t('Play')}><Icon name="play" size={22} /></button>}
        </div>
      ) : emb ? (
        <button className="btn small" onClick={(e) => { e.stopPropagation(); setEmbed(true); }}><Icon name="play" size={14} /> {t('Show embed')}</button>
      ) : null}
      <div className="link-meta">
        <img className="favicon" src={host ? `https://${host}/favicon.ico` : ''} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
        <div>
          <a href={url} target="_blank" rel="noreferrer noopener" className="card-title" onPointerDown={(e) => e.stopPropagation()}>{card.title || host}</a>
          {card.data.description && <div className="muted small">{card.data.description}</div>}
          <div className="muted small">{host}</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ file / audio / video

function fmtSize(n?: number) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export const FILE_LIMIT = 100 * 1024 * 1024;

export async function attachFile(cardId: string, file: File | Blob, name: string) {
  if (file.size > FILE_LIMIT) {
    toast(t('File is larger than the 100 MB plan limit'));
    return;
  }
  const id = uid();
  await putAsset(id, file);
  updateCard(cardId, (c) => {
    c.data.assetId = id;
    c.data.mime = file.type || 'application/octet-stream';
    c.data.fileName = name;
    c.data.size = file.size;
    if (!c.title) c.title = name;
  });
}

export function FileCard({ card, editing, readOnly }: BodyProps) {
  const url = useAssetUrl(card.data.assetId);
  const ref = useRef<HTMLInputElement>(null);
  const mime = card.data.mime ?? '';
  const [preview, setPreview] = useState(mime.startsWith('audio') || mime.startsWith('video'));
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);

  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        await attachFile(card.id, blob, `Recording ${new Date().toLocaleString()}.webm`);
        setPreview(true);
        setRec(null);
      };
      mr.start();
      setRec(mr);
      setSecs(0);
      const started = Date.now();
      const timer = setInterval(() => {
        if (mr.state !== 'recording') return clearInterval(timer);
        setSecs(Math.round((Date.now() - started) / 1000));
      }, 500);
    } catch {
      toast(t('Microphone not available'));
    }
  };

  if (!card.data.assetId)
    return (
      <div className="card-body file-body interactive">
        {readOnly ? <div className="placeholder">{t('No file')}</div> : (
          <>
            <button className="btn" onClick={() => ref.current?.click()}><Icon name="upload" size={14} /> {t('Upload file')}</button>
            <input ref={ref} type="file" hidden onChange={(e) => e.target.files?.[0] && attachFile(card.id, e.target.files[0], e.target.files[0].name)} />
            {rec ? (
              <button className="btn danger" onClick={() => rec.stop()}>■ {t('Stop')} · {secs}s</button>
            ) : (
              <button className="btn" onClick={() => void record()}><Icon name="mic" size={14} /> {t('Record audio')}</button>
            )}
            <div className="muted small">{t('Any file up to 100 MB · PDF, audio and video preview inline')}</div>
          </>
        )}
      </div>
    );
  return (
    <div className="card-body file-body">
      <div className="file-row">
        <Icon name={mime.startsWith('audio') ? 'mic' : 'file'} size={26} />
        <div className="file-meta">
          {editing && !readOnly ? (
            <input className="title-input" value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          ) : (
            <div className="card-title">{card.title || card.data.fileName}</div>
          )}
          <div className="muted small">{mime.split('/')[1]?.toUpperCase() ?? 'FILE'} · {fmtSize(card.data.size)}</div>
        </div>
      </div>
      {url && preview && (
        mime.startsWith('audio') ? <audio controls src={url} /> :
        mime.startsWith('video') ? <video controls src={url} /> :
        mime === 'application/pdf' ? <iframe className="pdf" src={url} title={card.data.fileName} /> :
        mime.startsWith('image') ? <img src={url} alt="" /> :
        mime.startsWith('text') ? <TextPreview url={url} /> : null
      )}
      <div className="row interactive">
        {url && (mime === 'application/pdf' || mime.startsWith('image') || mime.startsWith('text')) && (
          <button className="btn small" onClick={() => setPreview((p) => !p)}>{preview ? t('Hide preview') : t('Preview')}</button>
        )}
        {url && <a className="btn small" href={url} download={card.data.fileName ?? 'file'}><Icon name="download" size={14} /> {t('Download')}</a>}
      </div>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    void fetch(url).then((r) => r.text()).then((s) => setText(s.slice(0, 2000)));
  }, [url]);
  return <pre className="text-preview no-wheel">{text}</pre>;
}

// ------------------------------------------------------------------ map

export function MapCard({ card, editing, readOnly }: BodyProps) {
  const { lat = 0, lon = 0 } = card.data;
  const [q, setQ] = useState(card.data.address ?? '');
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const d = 0.012;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d * 0.6},${lon + d},${lat + d * 0.6}&layer=mapnik&marker=${lat},${lon}`;
  const search = async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
      setResults(await r.json());
    } catch {
      toast(t('Address search failed'));
    }
  };
  return (
    <div className="card-body map-body">
      <div className="map-head">
        <Icon name="map" size={14} />
        {editing && !readOnly ? (
          <input className="title-input" value={card.title} placeholder={t('Place name')} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        ) : (
          <span className="card-title">{card.title || card.data.address}</span>
        )}
      </div>
      {editing && !readOnly && (
        <div className="interactive map-search">
          <div className="row">
            <input value={q} autoFocus placeholder={t('Search address')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void search(); }} />
            <button className="btn small" onClick={() => void search()}><Icon name="search" size={14} /></button>
          </div>
          {results.map((r) => (
            <button key={r.display_name} className="result" onClick={() => { updateData(card.id, { lat: +r.lat, lon: +r.lon, address: r.display_name }); setResults([]); }}>{r.display_name}</button>
          ))}
        </div>
      )}
      <iframe className="map-frame" src={src} title={card.title || 'map'} loading="lazy" />
      <a className="muted small" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>{card.data.address} ↗</a>
    </div>
  );
}
