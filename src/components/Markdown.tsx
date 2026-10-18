// Renders the markdown-ish card text: H1–H3, bold, italic, strike, code,
// quotes, bullet/numbered lists, checklists, inline links, [[wiki-links]], #tags.

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseLinks, slugify, type ParsedLink } from '../model/links';
import { getDoc, justDragged, setUI } from '../model/store';
import { cardTitle, getIndex } from '../model/index';
import { currentAccess, openBoard, revealCard } from '../model/actions';
import { CardTypeIcon } from './icons';
import { t } from '../i18n';
import { useAssetUrl } from '../hooks';

interface Props {
  text: string;
  onToggleCheck?: (lineIndex: number) => void;
  className?: string;
  /** limit to the first N lines (previews) */
  maxLines?: number;
  highlightHeading?: string | null;
}

export function Markdown({ text, onToggleCheck, className, maxLines, highlightHeading }: Props) {
  let lines = (text || '').split('\n');
  if (maxLines && lines.length > maxLines) lines = [...lines.slice(0, maxLines), '…'];
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i;
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = (`h${h[1].length}`) as 'h1' | 'h2' | 'h3';
      const slug = slugify(h[2]);
      blocks.push(
        <Tag key={key++} id={'h-' + slug} className={highlightHeading === slug ? 'flash' : undefined}>
          <Inline text={h[2]} />
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key++}><Inline text={body.join('\n')} /></blockquote>);
      continue;
    }
    if (/^\s*[-*]\s\[( |x|X)\]\s?/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s\[( |x|X)\]\s?/.test(lines[i])) {
        const m = /^\s*[-*]\s\[( |x|X)\]\s?(.*)$/.exec(lines[i])!;
        const done = m[1] !== ' ';
        const ln = i;
        items.push(
          <li key={i} className={done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={done}
              disabled={!onToggleCheck}
              onChange={() => onToggleCheck?.(ln)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={m[2] || 'checklist item'}
            />
            <span><Inline text={m[2]} /></span>
          </li>,
        );
        i++;
      }
      blocks.push(<ul key={key++} className="checklist">{items}</ul>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s\[( |x|X)\]/.test(lines[i])) {
        items.push(<li key={i}><Inline text={lines[i].replace(/^\s*[-*]\s+/, '')} /></li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(<li key={i}><Inline text={lines[i].replace(/^\s*\d+[.)]\s+/, '')} /></li>);
        i++;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])
    ) para.push(lines[i++]);
    blocks.push(<p key={key++} data-line={lineNo}><Inline text={para.join('\n')} /></p>);
  }
  return <div className={'md ' + (className ?? '')}>{blocks}</div>;
}

const INLINE_RE =
  /(\[\[[^\[\]\n]+?\]\])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?:^|(?<=[\s(,;]))#[\p{L}\p{N}_][\p{L}\p{N}_\-/]*)|(\n)/gu;

export function Inline({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, 'gu');
  while ((m = re.exec(text))) {
    if (m.index > pos) out.push(text.slice(pos, m.index));
    const s = m[0];
    if (m[1]) {
      const l = parseLinks(s)[0];
      out.push(l ? <WikiLink key={k++} link={l} /> : s);
    } else if (m[2]) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (m[3]) out.push(<strong key={k++}><Inline text={s.slice(2, -2)} /></strong>);
    else if (m[4]) out.push(<s key={k++}><Inline text={s.slice(2, -2)} /></s>);
    else if (m[5]) out.push(<em key={k++}><Inline text={s.slice(1, -1)} /></em>);
    else if (m[6]) {
      const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(s)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>{mm[1]}</a>);
    } else if (m[7]) out.push(<a key={k++} href={s} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>{s}</a>);
    else if (m[8]) {
      const tag = s.slice(1);
      out.push(
        <button key={k++} className="tag" onClick={(e) => { e.stopPropagation(); if (!justDragged()) setUI({ tagPage: tag.toLowerCase() }); }}>
          #{tag}
        </button>,
      );
    } else if (m[9]) out.push(<br key={k++} />);
    pos = m.index + s.length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

type LinkState = 'ok' | 'broken' | 'restricted' | 'unresolved';

export function linkState(l: ParsedLink): { state: LinkState; label: string; id: string | null } {
  const doc = getDoc();
  const idx = getIndex(doc);
  if (!l.targetId) return { state: 'unresolved', label: l.alias ?? l.ref ?? '', id: null };
  const c = doc.cards[l.targetId];
  if (!c || !idx.isLive(c.id)) return { state: 'broken', label: l.alias ?? (c ? cardTitle(c) : t('Missing item')), id: c?.id ?? null };
  if (!currentAccess().canSee(c.id)) return { state: 'restricted', label: t('Restricted item'), id: null };
  const label = l.alias ?? (idx.title(c.id) + (l.anchor ? ' › ' + l.anchor : ''));
  return { state: 'ok', label, id: c.id };
}

function WikiLink({ link }: { link: ParsedLink }) {
  const { state, label, id } = linkState(link);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef<HTMLSpanElement>(null);
  const title =
    state === 'broken' ? t('Broken link — target was deleted') : state === 'unresolved' ? t('Unresolved link — no card with this title') : undefined;
  return (
    <span
      ref={ref}
      className={'wikilink ' + state}
      title={title}
      role="link"
      tabIndex={0}
      onMouseEnter={() => {
        if (state !== 'ok') return;
        timer.current = setTimeout(() => setHover(ref.current!.getBoundingClientRect()), 400);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setHover(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        clearTimeout(timer.current);
        setHover(null);
        if (justDragged()) return;
        if (state === 'broken' && id) {
          revealCard(id);
          return;
        }
        if (state !== 'ok' || !id) return;
        if (e.metaKey || e.ctrlKey) setUI({ peek: id });
        else openTarget(id, link.anchor);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && id && state === 'ok') openTarget(id, link.anchor);
      }}
    >
      {label}
      {hover && id && createPortal(<HoverPreview cardId={id} rect={hover} anchor={link.anchor} />, document.body)}
    </span>
  );
}

function openTarget(id: string, anchor: string | null) {
  const c = getDoc().cards[id];
  if (!c) return;
  if (c.type === 'board') {
    openBoard(id);
    return;
  }
  if (c.type === 'document') {
    setUI({ docEditor: { cardId: id, anchor: anchor ? slugify(anchor) : null } });
    return;
  }
  revealCard(id, anchor);
}

export function HoverPreview({ cardId, rect, anchor }: { cardId: string; rect: DOMRect; anchor?: string | null }) {
  const doc = getDoc();
  const c = doc.cards[cardId];
  const idx = getIndex(doc);
  const url = useAssetUrl(c?.type === 'image' ? c.data.assetId : undefined);
  if (!c) return null;
  const top = rect.bottom + 6 + 260 > window.innerHeight ? rect.top - 266 : rect.bottom + 6;
  const left = Math.min(rect.left, window.innerWidth - 340);
  let text = c.text;
  if (anchor && c.type === 'document') {
    const i = text.split('\n').findIndex((l) => /^#{1,3}\s/.test(l) && slugify(l.replace(/^#+\s*/, '')) === slugify(anchor));
    if (i >= 0) text = text.split('\n').slice(i).join('\n');
  }
  const boardId = idx.homeBoard.get(cardId);
  return (
    <div className="hover-preview" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="hp-head">
        <CardTypeIcon type={c.type} />
        <strong>{idx.title(cardId)}</strong>
        {boardId && <span className="muted"> · {idx.title(boardId)}</span>}
      </div>
      {c.type === 'image' && url ? (
        <img src={url} alt={c.data.caption ?? ''} />
      ) : c.type === 'board' ? (
        <div className="muted">{t('{n} items', { n: idx.childCount(cardId) })}</div>
      ) : c.type === 'todo' ? (
        <ul className="checklist">
          {(c.data.items ?? []).slice(0, 10).map((it) => (
            <li key={it.id} className={it.done ? 'done' : ''}>{it.done ? '☑' : '☐'} <Inline text={it.text} /></li>
          ))}
        </ul>
      ) : (
        <Markdown text={text || c.data.description || c.data.url || ''} maxLines={10} />
      )}
      <div className="hp-foot muted">{t('Click to open · Cmd/Ctrl+click for side-by-side')}</div>
    </div>
  );
}
