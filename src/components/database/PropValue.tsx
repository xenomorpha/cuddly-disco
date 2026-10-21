// Display + inline editors for database property values.

import { useEffect, useRef, useState } from 'react';
import type { Card, DbProp, DbValue } from '../../model/types';
import { OPTION_COLORS, option } from '../../model/database';
import { setRowValue, updateDb } from '../../model/actions';
import { useDoc } from '../../hooks';
import { Inline } from '../Markdown';
import { WikiEditor } from '../WikiEditor';
import { Icon } from '../icons';
import { t } from '../../i18n';

export function OptionChip({ name, color }: { name: string; color?: string }) {
  return <span className="opt-chip" style={{ background: color ?? OPTION_COLORS[0] }}>{name}</span>;
}

export function PropDisplay({ prop, value, compact, placeholder }: { prop: DbProp; value: DbValue | undefined; compact?: boolean; placeholder?: boolean }) {
  const doc = useDoc();
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
    return prop.kind === 'checkbox' ? <span className="box" /> : <span className="db-empty">{placeholder ? t('Empty') : ''}</span>;
  }
  switch (prop.kind) {
    case 'select': {
      const o = prop.options?.find((x) => x.id === value);
      return o ? <OptionChip name={o.name} color={o.color} /> : null;
    }
    case 'multiselect':
      return (
        <span className="opt-chips">
          {(Array.isArray(value) ? value : []).map((id) => {
            const o = prop.options?.find((x) => x.id === id);
            return o ? <OptionChip key={id} name={o.name} color={o.color} /> : null;
          })}
        </span>
      );
    case 'checkbox':
      return <span className={'box' + (value ? ' on' : '')}>{value && <Icon name="check" size={10} />}</span>;
    case 'date':
      return <span className="db-date">{new Date(String(value) + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>;
    case 'person': {
      const u = doc.users[String(value)];
      return u ? (
        <span className="db-person"><span className="avatar xs" style={{ background: u.color }}>{u.name[0]}</span>{!compact && u.name}</span>
      ) : null;
    }
    case 'url': {
      let host = String(value);
      try {
        host = new URL(String(value)).hostname.replace(/^www\./, '');
      } catch {
        /* keep raw */
      }
      return <a href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{host}</a>;
    }
    case 'number':
      return <span className="db-num">{Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>;
    default:
      return <span className="db-text"><Inline text={String(value)} /></span>;
  }
}

/** Inline editor; calls onDone when the user is finished. */
export function PropEditor({ dbId, prop, row, onDone }: { dbId: string; prop: DbProp; row: Card; onDone: () => void }) {
  const doc = useDoc();
  const value = row.data.values?.[prop.id];
  const set = (v: DbValue) => setRowValue(row.id, prop.id, v);
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') onDone();
  };
  switch (prop.kind) {
    case 'select':
    case 'multiselect':
      return <OptionPicker dbId={dbId} prop={prop} value={value} onChange={set} onDone={onDone} />;
    case 'checkbox':
      return null;
    case 'date':
      return <input type="date" autoFocus value={String(value ?? '')} onChange={(e) => set(e.target.value || null)} onBlur={onDone} onKeyDown={keys} />;
    case 'number':
      return (
        <input
          type="number"
          autoFocus
          defaultValue={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={onDone}
          onKeyDown={keys}
        />
      );
    case 'person':
      return (
        <select autoFocus value={String(value ?? '')} onChange={(e) => { set(e.target.value || null); onDone(); }} onBlur={onDone} onKeyDown={keys}>
          <option value="">{t('Nobody')}</option>
          {doc.members.map((m) => <option key={m.userId} value={m.userId}>{doc.users[m.userId]?.name}</option>)}
        </select>
      );
    case 'url':
      return <input type="url" autoFocus defaultValue={String(value ?? '')} placeholder="https://" onChange={(e) => set(e.target.value || null)} onBlur={onDone} onKeyDown={keys} />;
    default:
      return (
        <div className="db-text-edit" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTimeout(onDone, 120); }}>
          <WikiEditor value={String(value ?? '')} singleLine autoFocus selfId={row.id} onChange={(v) => set(v || null)} onEnter={onDone} onDone={onDone} />
        </div>
      );
  }
}

/** Pick / toggle / create options for select and multi-select properties. */
export function OptionPicker({ dbId, prop, value, onChange, onDone }: { dbId: string; prop: DbProp; value: DbValue | undefined; onChange: (v: DbValue) => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const multi = prop.kind === 'multiselect';
  const selected = multi ? (Array.isArray(value) ? value : []) : value ? [String(value)] : [];
  const opts = (prop.options ?? []).filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = (prop.options ?? []).some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDone();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onDone]);
  const pick = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? null : id);
      onDone();
    }
  };
  const create = () => {
    const name = q.trim();
    if (!name) return;
    const o = option(name, prop.options?.length ?? 0);
    updateDb(dbId, (db) => {
      const p = db.props.find((x) => x.id === prop.id);
      if (p) (p.options ??= []).push(o);
    });
    setQ('');
    if (multi) onChange([...selected, o.id]);
    else {
      onChange(o.id);
      onDone();
    }
  };
  return (
    <div className="option-picker interactive" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <div className="opt-selected">
        {selected.map((id) => {
          const o = prop.options?.find((x) => x.id === id);
          return o ? (
            <button key={id} className="opt-chip" style={{ background: o.color }} onClick={() => pick(id)} title={t('Remove')}>
              {o.name} <Icon name="close" size={10} />
            </button>
          ) : null;
        })}
        <input
          autoFocus
          value={q}
          placeholder={t('Search or create an option…')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') opts[0] && !q.trim() ? pick(opts[0].id) : exact ? pick(opts.find((o) => o.name.toLowerCase() === q.trim().toLowerCase())!.id) : create();
            if (e.key === 'Escape') onDone();
            if (e.key === 'Backspace' && !q && selected.length && multi) pick(selected[selected.length - 1]);
          }}
        />
      </div>
      <div className="opt-list">
        {opts.map((o) => (
          <div key={o.id} className="opt-row">
            <button className="opt-pick" onClick={() => pick(o.id)}>
              <OptionChip name={o.name} color={o.color} />
              {selected.includes(o.id) && <Icon name="check" size={13} />}
            </button>
            <OptionColor dbId={dbId} propId={prop.id} optionId={o.id} color={o.color} />
          </div>
        ))}
        {q.trim() && !exact && (
          <button className="opt-pick create" onClick={create}>
            <Icon name="plus" size={13} /> {t('Create')} <OptionChip name={q.trim()} color={OPTION_COLORS[((prop.options?.length ?? 0) + 1) % OPTION_COLORS.length]} />
          </button>
        )}
        {!opts.length && !q && <div className="muted small pad">{t('Type to create the first option')}</div>}
      </div>
    </div>
  );
}

function OptionColor({ dbId, propId, optionId, color }: { dbId: string; propId: string; optionId: string; color: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="opt-color">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={t('Option colour')}><Icon name="more" size={14} /></button>
      {open && (
        <span className="opt-colors">
          {OPTION_COLORS.map((c) => (
            <button
              key={c}
              className={'sw' + (c === color ? ' on' : '')}
              style={{ background: c }}
              aria-label={c}
              onClick={() => {
                updateDb(dbId, (db) => {
                  const o = db.props.find((p) => p.id === propId)?.options?.find((x) => x.id === optionId);
                  if (o) o.color = c;
                });
                setOpen(false);
              }}
            />
          ))}
          <button
            className="icon-btn"
            title={t('Delete option')}
            onClick={() =>
              updateDb(dbId, (db) => {
                const p = db.props.find((x) => x.id === propId);
                if (p?.options) p.options = p.options.filter((o) => o.id !== optionId);
              })
            }
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      )}
    </span>
  );
}

/** A value cell: shows the value, click to edit (checkbox toggles directly). */
export function PropCell({ dbId, prop, row, editable, compact, placeholder }: { dbId: string; prop: DbProp; row: Card; editable: boolean; compact?: boolean; placeholder?: boolean }) {
  const [editing, setEditing] = useState(false);
  const value = row.data.values?.[prop.id];
  if (prop.kind === 'checkbox')
    return (
      <button
        className="db-cell-btn"
        disabled={!editable}
        aria-label={prop.name}
        aria-pressed={value === true}
        onClick={(e) => {
          e.stopPropagation();
          setRowValue(row.id, prop.id, !value);
        }}
      >
        <PropDisplay prop={prop} value={value} />
      </button>
    );
  if (editing && editable) return <div className="db-cell-edit">{<PropEditor dbId={dbId} prop={prop} row={row} onDone={() => setEditing(false)} />}</div>;
  return (
    <div
      className={'db-cell-view' + (editable ? ' editable' : '')}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, .wikilink, .tag')) return;
        e.stopPropagation();
        if (editable) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && editable) {
          e.stopPropagation();
          setEditing(true);
        }
      }}
    >
      <PropDisplay prop={prop} value={value} compact={compact} placeholder={placeholder} />
    </div>
  );
}
