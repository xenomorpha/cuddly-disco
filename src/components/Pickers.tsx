// Generic search-and-pick dialog used by "Link to…", "Move to…",
// "Place synced copy…" and "Add board shortcut…".

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { getDoc } from '../model/store';
import { getIndex, boardPath } from '../model/index';
import { rankCards } from './WikiEditor';
import { CardTypeIcon } from './icons';
import { t } from '../i18n';

interface PickerState {
  open: boolean;
  title: string;
  boardsOnly: boolean;
  exclude?: string;
  onPick: (id: string) => void;
}

const usePicker = create<PickerState>(() => ({ open: false, title: '', boardsOnly: false, onPick: () => {} }));

export function openPicker(opts: Omit<PickerState, 'open'>) {
  usePicker.setState({ ...opts, open: true });
}

export function PickerDialog() {
  const s = usePicker();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (s.open) {
      setQ('');
      setSel(0);
      setTimeout(() => ref.current?.focus(), 0);
    }
  }, [s.open]);
  if (!s.open) return null;
  const doc = getDoc();
  const idx = getIndex(doc);
  const ids = rankCards(q, 12, { boardsOnly: s.boardsOnly, exclude: s.exclude });
  const close = () => usePicker.setState({ open: false });
  const pick = (id: string) => {
    close();
    s.onPick(id);
  };
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal picker" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={s.title}>
        <h3>{s.title}</h3>
        <input
          ref={ref}
          value={q}
          placeholder={s.boardsOnly ? t('Search boards…') : t('Search cards and boards…')}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(ids.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter' && ids[sel]) pick(ids[sel]);
            if (e.key === 'Escape') close();
          }}
        />
        <div className="picker-list" role="listbox">
          {ids.map((id, i) => (
            <button key={id} role="option" aria-selected={i === sel} className={'picker-item' + (i === sel ? ' active' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(id)}>
              <CardTypeIcon type={doc.cards[id].type} />
              <span>{idx.title(id)}</span>
              <span className="muted small">
                {doc.cards[id].type === 'board'
                  ? boardPath(doc, id).slice(0, -1).map((b) => idx.title(b)).join(' / ')
                  : idx.resolvables.get(id)?.boardTitle}
              </span>
            </button>
          ))}
          {!ids.length && <div className="muted">{t('No matches')}</div>}
        </div>
      </div>
    </div>
  );
}
