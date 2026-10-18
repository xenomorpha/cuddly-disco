import type { BodyProps } from '../CardView';
import type { ColumnKind, TableData } from '../../model/types';
import { Inline } from '../Markdown';
import { WikiEditor } from '../WikiEditor';
import { updateCard } from '../../model/actions';
import { uid } from '../../model/store';
import { colName, evaluate } from '../../model/formula';
import { t } from '../../i18n';
import type { Draft } from 'immer';

export function TableCard({ card, editing, readOnly }: BodyProps) {
  const table = card.data.table ?? { columns: [], rows: [] };
  const edit = editing && !readOnly;
  const get = (c: number, r: number) => {
    const col = table.columns[c];
    const row = table.rows[r];
    return col && row ? row.cells[col.id] ?? '' : '';
  };
  const mut = (fn: (t: Draft<TableData>) => void, key?: string) =>
    updateCard(card.id, (c) => {
      c.data.table ??= { columns: [], rows: [] };
      fn(c.data.table);
    }, key);

  const display = (raw: string, kind: ColumnKind) => {
    const v = raw.startsWith('=') ? evaluate(raw, get) : raw;
    if (kind === 'number' && typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (raw.startsWith('=') && typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return String(v);
  };

  return (
    <div className="card-body table-body">
      {edit ? (
        <input className="title-input" value={card.title} placeholder={t('Table')} onChange={(e) => updateCard(card.id, { title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        card.title && <div className="card-title">{card.title}</div>
      )}
      <div className="table-scroll no-wheel">
        <table>
          <thead>
            <tr>
              <th className="rn" />
              {table.columns.map((col, ci) => (
                <th key={col.id}>
                  {edit ? (
                    <div className="th-edit interactive">
                      <input value={col.name} onChange={(e) => mut((tb) => { tb.columns[ci].name = e.target.value; }, 'col:' + col.id)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('Column name')} />
                      <select value={col.kind} onChange={(e) => mut((tb) => { tb.columns[ci].kind = e.target.value as ColumnKind; })} aria-label={t('Column type')}>
                        <option value="text">{t('Text')}</option>
                        <option value="number">{t('Number')}</option>
                        <option value="date">{t('Date')}</option>
                        <option value="checkbox">{t('Checkbox')}</option>
                      </select>
                      <button className="icon-btn" title={t('Delete column')} onClick={() => mut((tb) => { tb.columns.splice(ci, 1); })}>×</button>
                    </div>
                  ) : (
                    <span><span className="col-letter">{colName(ci)}</span> {col.name}</span>
                  )}
                </th>
              ))}
              {edit && (
                <th className="add">
                  <button className="icon-btn" title={t('Add column')} onClick={() => mut((tb) => { tb.columns.push({ id: uid(), name: t('Column'), kind: 'text' }); })}>+</button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={row.id}>
                <td className="rn">
                  {edit ? <button className="icon-btn" title={t('Delete row')} onClick={() => mut((tb) => { tb.rows.splice(ri, 1); })}>×</button> : ri + 1}
                </td>
                {table.columns.map((col) => {
                  const raw = row.cells[col.id] ?? '';
                  const set = (v: string) => mut((tb) => { tb.rows[ri].cells[col.id] = v; }, `cell:${row.id}:${col.id}`);
                  if (col.kind === 'checkbox')
                    return (
                      <td key={col.id} className="center">
                        <input type="checkbox" checked={raw === 'true'} disabled={readOnly} onChange={(e) => set(String(e.target.checked))} aria-label={col.name} />
                      </td>
                    );
                  if (edit)
                    return (
                      <td key={col.id} className={col.kind === 'number' ? 'num' : ''}>
                        {col.kind === 'date' ? (
                          <input type="date" value={raw} onChange={(e) => set(e.target.value)} />
                        ) : col.kind === 'number' ? (
                          <input value={raw} inputMode="decimal" onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="0 or =SUM(…)" />
                        ) : (
                          <WikiEditor value={raw} singleLine onChange={set} />
                        )}
                      </td>
                    );
                  const shown = display(raw, col.kind);
                  return (
                    <td key={col.id} className={(col.kind === 'number' || raw.startsWith('=') ? 'num' : '') + (shown.startsWith('#') && raw.startsWith('=') ? ' err' : '')} title={raw.startsWith('=') ? raw : undefined}>
                      {raw.startsWith('=') || col.kind !== 'text' ? shown : <Inline text={raw} />}
                    </td>
                  );
                })}
                {edit && <td />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="row">
          <button className="link-btn" onClick={() => mut((tb) => { tb.rows.push({ id: uid(), cells: {} }); })}>+ {t('Add row')}</button>
          <span className="muted small">{t('Formulas: =SUM(B1:B3), AVERAGE, MIN, MAX, COUNT, + − × ÷')}</span>
        </div>
      )}
    </div>
  );
}
