// Text editor used in every rich-text field. The user edits [[Title]] text;
// it is stored as [[@uuid]] (spec §4.1). Typing [[ opens autocomplete over
// cards and boards ranked by title match and recency, with "Create new".

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fromEditable, headings, openLinkQuery, toEditable } from '../model/links';
import { getDoc, getUI } from '../model/store';
import { getIndex } from '../model/index';
import { createLinkTarget, currentAccess } from '../model/actions';
import { CardTypeIcon } from './icons';
import { t } from '../i18n';
import type { CardType } from '../model/types';

interface Props {
  value: string; // stored form
  onChange: (stored: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  singleLine?: boolean;
  toolbar?: boolean;
  className?: string;
  onDone?: () => void;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  minRows?: number;
  ariaLabel?: string;
  /** card being edited — excluded from link suggestions */
  selfId?: string;
}

interface Suggestion {
  kind: 'card' | 'heading' | 'create' | 'tag';
  id?: string;
  label: string;
  insert: string;
  sub?: string;
  type?: CardType;
}

export function WikiEditor(props: Props) {
  const { value, onChange, singleLine } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const idx = getIndex(getDoc());
  const [text, setText] = useState(() => toEditable(value, idx.label));
  const storedRef = useRef(value);
  const [ac, setAc] = useState<{ start: number; query: string; mode: 'link' | 'tag' } | null>(null);
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // external updates (other tab / undo) when not focused
  useEffect(() => {
    if (document.activeElement !== ref.current && value !== storedRef.current) {
      storedRef.current = value;
      setText(toEditable(value, getIndex(getDoc()).label));
    }
  }, [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [text]);

  useEffect(() => {
    if (props.autoFocus && ref.current) {
      ref.current.focus();
      const l = ref.current.value.length;
      ref.current.setSelectionRange(l, l);
    }
  }, [props.autoFocus]);

  const commitText = (next: string) => {
    setText(next);
    const i = getIndex(getDoc());
    const stored = fromEditable(next, storedRef.current, i.label, i.resolve);
    storedRef.current = stored;
    if (stored !== value) onChange(stored);
  };

  const updateAc = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart;
    const q = openLinkQuery(el.value, caret);
    if (q && !q.query.includes('|')) {
      setAc({ start: q.start, query: q.query, mode: 'link' });
      setPos(caretCoords(el, q.start));
      setSel(0);
      return;
    }
    const tm = /(^|[\s(])#([\p{L}\p{N}_\-/]*)$/u.exec(el.value.slice(0, caret));
    if (tm && tm[2].length >= 1) {
      setAc({ start: caret - tm[2].length - 1, query: tm[2], mode: 'tag' });
      setPos(caretCoords(el, caret - tm[2].length - 1));
      setSel(0);
      return;
    }
    setAc(null);
  };

  const suggestions = useMemo<Suggestion[]>(() => (ac ? buildSuggestions(ac.query, ac.mode, props.selfId) : []), [ac, props.selfId]);

  const choose = (s: Suggestion) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    let insert = s.insert;
    if (s.kind === 'create') {
      createLinkTarget(s.label);
    }
    // swallow an auto-typed closing "]]" right after the caret
    const after = el.value.slice(caret);
    const skip = ac?.mode === 'link' && after.startsWith(']]') ? 2 : 0;
    const next = el.value.slice(0, ac!.start) + insert + el.value.slice(caret + skip);
    const newCaret = ac!.start + insert.length;
    setAc(null);
    commitText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (ac && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggestions[sel]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAc(null); return; }
    }
    if (e.key === 'Escape') { ref.current?.blur(); props.onDone?.(); return; }
    if (singleLine && e.key === 'Enter') { e.preventDefault(); props.onEnter?.(); return; }
    if (e.key === 'Backspace' && !text && props.onBackspaceEmpty) { e.preventDefault(); props.onBackspaceEmpty(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); wrap('~~', '~~'); }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); wrap('`', '`'); }
    if (!singleLine && e.key === 'Enter' && !e.shiftKey && !mod) {
      // continue lists
      const el = e.currentTarget;
      const lineStart = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
      const line = el.value.slice(lineStart, el.selectionStart);
      const m = /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)[.)] )/.exec(line);
      if (m) {
        e.preventDefault();
        if (line.trim() === m[2].trim()) {
          const next = el.value.slice(0, lineStart) + el.value.slice(el.selectionStart);
          commitText(next);
          requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
          return;
        }
        let bullet = m[2];
        if (m[3]) bullet = `${parseInt(m[3], 10) + 1}. `;
        if (bullet.includes('[')) bullet = bullet.replace(/\[[xX]\]/, '[ ]');
        insertAtCaret('\n' + m[1] + bullet);
      }
    }
    if (e.key === '[' && !mod) {
      // auto-close [[ ]]
      const el = e.currentTarget;
      if (el.value[el.selectionStart - 1] === '[' && el.selectionStart === el.selectionEnd) {
        e.preventDefault();
        const c = el.selectionStart;
        const next = el.value.slice(0, c) + '[]]' + el.value.slice(c);
        commitText(next);
        requestAnimationFrame(() => {
          el.setSelectionRange(c + 1, c + 1);
          updateAc(el);
        });
      }
    }
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current!;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = el.value.slice(0, a) + s + el.value.slice(b);
    commitText(next);
    requestAnimationFrame(() => el.setSelectionRange(a + s.length, a + s.length));
  };

  const wrap = (l: string, r: string) => {
    const el = ref.current!;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const inner = el.value.slice(a, b) || 'text';
    const next = el.value.slice(0, a) + l + inner + r + el.value.slice(b);
    commitText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + l.length, a + l.length + inner.length);
    });
  };

  const linePrefix = (prefix: string) => {
    const el = ref.current!;
    const a = el.selectionStart;
    const lineStart = el.value.lastIndexOf('\n', a - 1) + 1;
    const line = el.value.slice(lineStart).split('\n')[0];
    const stripped = line.replace(/^(#{1,3} |> |[-*] \[[ xX]\] |[-*] |\d+[.)] )/, '');
    const nextLine = line.startsWith(prefix) ? stripped : prefix + stripped;
    const next = el.value.slice(0, lineStart) + nextLine + el.value.slice(lineStart + line.length);
    commitText(next);
    requestAnimationFrame(() => {
      el.focus();
      const c = lineStart + nextLine.length;
      el.setSelectionRange(c, c);
    });
  };

  return (
    <div className={'wiki-editor ' + (props.className ?? '')} onPointerDown={(e) => e.stopPropagation()}>
      {props.toolbar && (
        <div className="format-bar" role="toolbar" aria-label={t('Formatting')} onMouseDown={(e) => e.preventDefault()}>
          <button title="Heading 1" onClick={() => linePrefix('# ')}>H1</button>
          <button title="Heading 2" onClick={() => linePrefix('## ')}>H2</button>
          <button title="Heading 3" onClick={() => linePrefix('### ')}>H3</button>
          <span className="sep" />
          <button title="Bold (Cmd/Ctrl+B)" onClick={() => wrap('**', '**')}><b>B</b></button>
          <button title="Italic (Cmd/Ctrl+I)" onClick={() => wrap('*', '*')}><i>I</i></button>
          <button title="Strikethrough" onClick={() => wrap('~~', '~~')}><s>S</s></button>
          <button title="Code (Cmd/Ctrl+E)" onClick={() => wrap('`', '`')}>{'</>'}</button>
          <span className="sep" />
          <button title="Quote" onClick={() => linePrefix('> ')}>❝</button>
          <button title="Bullet list" onClick={() => linePrefix('- ')}>•</button>
          <button title="Numbered list" onClick={() => linePrefix('1. ')}>1.</button>
          <button title="Checklist" onClick={() => linePrefix('- [ ] ')}>☑</button>
          <span className="sep" />
          <button title="Wiki-link [[" onClick={() => { insertAtCaret('[['); requestAnimationFrame(() => ref.current && updateAc(ref.current)); }}>[[ ]]</button>
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        rows={props.minRows ?? 1}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel ?? props.placeholder}
        spellCheck
        onChange={(e) => {
          commitText(e.target.value);
          updateAc(e.target);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateAc(e.currentTarget);
        }}
        onClick={(e) => updateAc(e.currentTarget)}
        onBlur={() => setTimeout(() => setAc(null), 150)}
        onPaste={(e) => e.stopPropagation()}
        onCopy={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()}
      />
      {ac && pos && suggestions.length > 0 &&
        createPortal(
          <div className="autocomplete" style={{ top: pos.top, left: pos.left }} role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((s, i) => (
              <div
                key={s.kind + (s.id ?? s.label) + i}
                role="option"
                aria-selected={i === sel}
                className={'ac-item ' + (i === sel ? 'active' : '') + ' ' + s.kind}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(s)}
              >
                {s.kind === 'create' ? <span className="ac-plus">+</span> : s.kind === 'tag' ? <span className="ac-plus">#</span> : s.kind === 'heading' ? <span className="ac-plus">§</span> : <CardTypeIcon type={s.type ?? 'note'} />}
                <span className="ac-label">{s.kind === 'create' ? t('Create "{q}"', { q: s.label }) : s.label}</span>
                {s.sub && <span className="ac-sub">{s.sub}</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function score(title: string, q: string): number {
  const tl = title.toLowerCase();
  if (!q) return 1;
  if (tl === q) return 100;
  if (tl.startsWith(q)) return 80;
  if (tl.split(/[\s\-—/]+/).some((w) => w.startsWith(q))) return 60;
  if (tl.includes(q)) return 40;
  // subsequence (fuzzy)
  let i = 0;
  for (const ch of tl) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

export function rankCards(query: string, limit = 8, opts: { boardsOnly?: boolean; exclude?: string } = {}) {
  const doc = getDoc();
  const idx = getIndex(doc);
  const access = currentAccess();
  const recent = doc.recent[getUI().userId] ?? [];
  const q = query.trim().toLowerCase();
  const now = Date.now();
  const out: { id: string; score: number }[] = [];
  for (const r of idx.resolvables.values()) {
    const c = doc.cards[r.id];
    if (!c || !idx.isLive(r.id) || !access.canSee(r.id)) continue;
    if (c.type === 'column' && !c.title) continue;
    if (opts.boardsOnly && c.type !== 'board') continue;
    if (r.id === opts.exclude) continue;
    const s = score(r.title, q);
    if (!s) continue;
    const ageDays = (now - c.updatedAt) / 86400_000;
    const recency = Math.max(0, 10 - ageDays) + (recent.includes(r.id) ? 8 - recent.indexOf(r.id) * 0.5 : 0);
    out.push({ id: r.id, score: s + recency });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.id);
}

function buildSuggestions(query: string, mode: 'link' | 'tag', selfId?: string): Suggestion[] {
  const doc = getDoc();
  const idx = getIndex(doc);
  if (mode === 'tag') {
    const q = query.toLowerCase();
    return [...idx.tags.keys()]
      .filter((t) => t.startsWith(q) && t !== q)
      .slice(0, 6)
      .map((tag) => ({ kind: 'tag' as const, label: '#' + tag, insert: '#' + tag + ' ', sub: `${idx.tags.get(tag)!.size}` }));
  }
  const hash = query.indexOf('#');
  if (hash >= 0) {
    const ref = query.slice(0, hash);
    const hq = query.slice(hash + 1).toLowerCase();
    const id = idx.resolve(ref);
    if (!id) return [];
    const label = idx.label(id)!;
    return headings(doc.cards[id].text)
      .filter((h) => h.text.toLowerCase().includes(hq))
      .slice(0, 8)
      .map((h) => ({ kind: 'heading' as const, id, label: h.text, sub: label, insert: `[[${label}#${h.text}]]` }));
  }
  const ids = rankCards(query, 8, { exclude: selfId });
  const list: Suggestion[] = ids.map((id) => {
    const r = idx.resolvables.get(id)!;
    const label = idx.label(id)!;
    return { kind: 'card', id, label: r.title, sub: r.boardTitle, insert: `[[${label}]]`, type: doc.cards[id].type };
  });
  const q = query.trim();
  if (q && !list.some((s) => s.label.toLowerCase() === q.toLowerCase()))
    list.push({ kind: 'create', label: q, insert: `[[${q}]]` });
  return list;
}

// caret position inside a textarea, via a mirror element
function caretCoords(el: HTMLTextAreaElement, index: number) {
  const div = document.createElement('div');
  const cs = getComputedStyle(el);
  for (const p of ['font', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap', 'width', 'textIndent'] as const)
    (div.style as any)[p] = (cs as any)[p];
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.width = el.offsetWidth + 'px';
  div.textContent = el.value.slice(0, index);
  const span = document.createElement('span');
  span.textContent = '​';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = el.getBoundingClientRect();
  const line = parseFloat(cs.lineHeight) || 18;
  let top = r.top + span.offsetTop - el.scrollTop + line + 4;
  const left = r.left + span.offsetLeft;
  document.body.removeChild(div);
  // flip above the caret when there is no room below
  if (top + 280 > window.innerHeight) top = Math.max(8, top - line - 8 - 280);
  return { top, left: Math.max(8, Math.min(left, window.innerWidth - 310)) };
}
