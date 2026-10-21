import { useState } from 'react';
import type { BodyProps } from '../CardView';
import { Inline } from '../Markdown';
import { WikiEditor } from '../WikiEditor';
import { updateCard } from '../../model/actions';
import { uid } from '../../model/store';
import { useDoc } from '../../hooks';
import { t } from '../../i18n';
import { Icon } from '../icons';

export function TodoCard({ card, placement, editing, setEditing, readOnly }: BodyProps) {
  const doc = useDoc();
  const items = card.data.items ?? [];
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const done = items.filter((i) => i.done).length;
  const users = doc.members.map((m) => doc.users[m.userId]).filter(Boolean);

  const setItems = (fn: (items: NonNullable<typeof card.data.items>) => void, key?: string) =>
    updateCard(card.id, (c) => {
      c.data.items ??= [];
      fn(c.data.items);
    }, key);

  const addAfter = (id: string | null) => {
    const nid = uid();
    setItems((its) => {
      const i = id ? its.findIndex((x) => x.id === id) : its.length - 1;
      its.splice(i + 1, 0, { id: nid, text: '', done: false });
    }, 'add-item');
    setFocusItem(nid);
  };

  return (
    <div className="card-body todo-body">
      <div className="todo-head">
        {editing && !readOnly ? (
          <input
            className="title-input"
            value={card.title}
            placeholder={t('To-do list')}
            onChange={(e) => updateCard(card.id, { title: e.target.value })}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addAfter(null); }}
            autoFocus={!focusItem}
          />
        ) : (
          <div className="card-title">{card.title || t('To-do list')}</div>
        )}
        {items.length > 0 && <span className="muted small">{done}/{items.length}</span>}
      </div>
      {items.length > 0 && <div className="progress"><div style={{ width: `${(done / items.length) * 100}%` }} /></div>}
      <ul className="todo-items">
        {items.map((it) => (
          <li
            key={it.id}
            className={(it.done ? 'done ' : '') + (dragId === it.id ? 'dragging' : '')}
            draggable={!readOnly && editing}
            onDragStart={(e) => { e.stopPropagation(); setDragId(it.id); e.dataTransfer.setData('text/x-todo', it.id); }}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.stopPropagation();
              setItems((its) => {
                const from = its.findIndex((x) => x.id === dragId);
                const to = its.findIndex((x) => x.id === it.id);
                const [m] = its.splice(from, 1);
                its.splice(to, 0, m);
              });
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
          >
            {editing && !readOnly && <span className="grip" title={t('Drag to reorder')}>⋮⋮</span>}
            <input
              type="checkbox"
              checked={it.done}
              disabled={readOnly}
              aria-label={t('Done')}
              onChange={() => setItems((its) => { const x = its.find((y) => y.id === it.id); if (x) x.done = !x.done; })}
            />
            <div className="todo-text">
              {editing && !readOnly ? (
                <WikiEditor
                  value={it.text}
                  singleLine
                  selfId={card.id}
                  autoFocus={focusItem === it.id}
                  placeholder={t('To-do')}
                  onChange={(text) => setItems((its) => { const x = its.find((y) => y.id === it.id); if (x) x.text = text; }, 'item:' + it.id)}
                  onEnter={() => addAfter(it.id)}
                  onBackspaceEmpty={() => setItems((its) => { const i = its.findIndex((y) => y.id === it.id); if (i >= 0) its.splice(i, 1); })}
                />
              ) : (
                <span><Inline text={it.text || ''} /></span>
              )}
              {(editing && !readOnly) ? (
                <div className="todo-meta interactive">
                  <input type="date" value={it.due ?? ''} aria-label={t('Due date')} onChange={(e) => setItems((its) => { const x = its.find((y) => y.id === it.id); if (x) x.due = e.target.value || undefined; })} />
                  <select value={it.assignee ?? ''} aria-label={t('Assignee')} onChange={(e) => setItems((its) => { const x = its.find((y) => y.id === it.id); if (x) x.assignee = e.target.value || undefined; })}>
                    <option value="">{t('Unassigned')}</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              ) : (it.due || it.assignee) ? (
                <div className="todo-meta">
                  {it.due && <span className={'due' + (!it.done && it.due < new Date().toISOString().slice(0, 10) ? ' overdue' : '')}><Icon name="calendar" size={11} /> {it.due}</span>}
                  {it.assignee && doc.users[it.assignee] && (
                    <span className="avatar xs" style={{ background: doc.users[it.assignee].color }} title={doc.users[it.assignee].name}>{doc.users[it.assignee].name[0]}</span>
                  )}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <button className="link-btn add-item" onClick={(e) => { e.stopPropagation(); addAfter(null); setEditing(placement.id); }}>
          + {t('Add item')}
        </button>
      )}
    </div>
  );
}
