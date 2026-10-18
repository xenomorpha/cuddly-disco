// Global graph (full screen, Cmd/Ctrl+G) and local graph (docked panel)
// — spec §5.

import { useMemo, useState } from 'react';
import type { CardType, GraphSettings } from '../model/types';
import { CARD_TYPES } from '../model/types';
import { buildGraph, localGraph, matchesQuery, shortestPath, syntheticGraph, type GNode, type GraphData } from '../model/graph';
import { getIndex } from '../model/index';
import { cachedAssetUrl, getDoc, setUI, toast, uid } from '../model/store';
import { deleteGraphView, graphSettingsFor, openBoard, revealCard, saveGraphSettings, saveGraphView } from '../model/actions';
import { useAccess, useDoc, useUI } from '../hooks';
import { GraphCanvas } from './GraphCanvas';
import { CardTypeIcon, Icon, TYPE_COLORS } from './icons';
import { Markdown } from './Markdown';
import { t } from '../i18n';

function useGraph(settings: GraphSettings): GraphData {
  const doc = useDoc();
  const access = useAccess();
  return useMemo(() => buildGraph(doc, getIndex(doc), access, settings), [doc, access, settings]);
}

function useColorOf(groups: GraphSettings['colorGroups']) {
  const doc = useDoc();
  return useMemo(() => {
    const idx = getIndex(doc);
    const cache = new Map<string, string>();
    return (n: GNode) => {
      let c = cache.get(n.id);
      if (c) return c;
      c = groups.find((g) => g.query.trim() && matchesQuery(n, g.query, idx.title))?.color ?? TYPE_COLORS[n.type] ?? '#888';
      cache.set(n.id, c);
      return c;
    };
  }, [groups, doc]);
}

function useThumbOf() {
  const doc = useDoc();
  return useMemo(() => (n: GNode) => {
    const c = doc.cards[n.id];
    return c?.data.assetId ? cachedAssetUrl(c.data.assetId) : c?.data.url ?? null;
  }, [doc]);
}

function openNode(id: string) {
  if (id.startsWith('tag:')) {
    setUI({ tagPage: id.slice(4), globalGraph: false });
    return;
  }
  if (id.startsWith('broken:')) {
    toast(t('This link points to a deleted or missing item'));
    return;
  }
  setUI({ globalGraph: false });
  revealOrOpen(id);
}

function revealOrOpen(id: string) {
  if (getDoc().cards[id]?.type === 'board') openBoard(id);
  else revealCard(id);
}

// ------------------------------------------------------------------ global graph

export function GlobalGraph() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const settings = useMemo(() => graphSettingsFor(doc, ui.userId), [doc.graphSettings, ui.userId]);
  const real = useGraph(settings);
  const [bench, setBench] = useState<{ n: number; m: number } | null>(null);
  const synthetic = useMemo(() => (bench ? syntheticGraph(bench.n, bench.m) : null), [bench]);
  const data = synthetic ?? real;
  const colorOf = useColorOf(settings.colorGroups);
  const thumb = useThumbOf();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [zoomTo, setZoomTo] = useState<{ ids: string[]; at: number } | null>(null);
  const [resetAt, setResetAt] = useState(0);
  const [unpinAt, setUnpinAt] = useState(0);
  const [benchAt, setBenchAt] = useState(0);
  const [benchResult, setBenchResult] = useState<string>('');
  const [path, setPath] = useState<string[] | null>(null);
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [hover, setHover] = useState<{ n: GNode; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState(window.innerWidth > 900);
  const [viewName, setViewName] = useState('');

  const highlight = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(q) || n.tags.includes(q.replace(/^#/, ''))).map((n) => n.id));
  }, [search, data]);

  const set = (patch: Partial<GraphSettings>) => saveGraphSettings(patch);
  const toggleType = (tp: CardType) => set({ types: settings.types.includes(tp) ? settings.types.filter((x) => x !== tp) : [...settings.types, tp] });
  const toggleTag = (tg: string) => set({ tags: settings.tags.includes(tg) ? settings.tags.filter((x) => x !== tg) : [...settings.tags, tg] });
  const boards = Object.values(doc.cards).filter((c) => c.type === 'board' && idx.liveBoards.has(c.id));
  const views = Object.values(doc.graphViews).filter((v) => v.userId === ui.userId);
  const sel = selected ? data.nodes.find((n) => n.id === selected) : null;

  const onSelect = (id: string | null) => {
    if (pathFrom && id) {
      const p = shortestPath(data, pathFrom, id);
      setPath(p);
      setPathFrom(null);
      if (!p) toast(t('No path between these items'));
      else setZoomTo({ ids: p, at: Date.now() });
      setSelected(id);
      return;
    }
    setSelected(id);
  };

  return (
    <div className="graph-overlay" role="dialog" aria-label={t('Graph view')}>
      <header className="graph-header">
        <button className="icon-btn" onClick={() => setPanel((p) => !p)} title={t('Filters & settings')} aria-expanded={panel}><Icon name="settings" /></button>
        <h2><Icon name="graph" /> {t('Graph')}</h2>
        <span className="muted small">{data.nodes.length.toLocaleString()} {t('nodes')} · {data.edges.length.toLocaleString()} {t('edges')}{bench ? ' · ' + t('synthetic benchmark') : ''}</span>
        <div className="graph-search">
          <Icon name="search" size={15} />
          <input
            value={search}
            placeholder={t('Search nodes…')}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && highlight?.size) setZoomTo({ ids: [...highlight], at: Date.now() });
              if (e.key === 'Escape') setSearch('');
            }}
            aria-label={t('Search nodes')}
          />
          {highlight && <span className="muted small">{highlight.size}</span>}
        </div>
        {pathFrom && <span className="pill">{t('Click a second node to find the path…')} <button className="link-btn" onClick={() => setPathFrom(null)}>{t('Cancel')}</button></span>}
        {path && <span className="pill">{t('Path: {n} steps', { n: path.length - 1 })} <button className="link-btn" onClick={() => setPath(null)}>{t('Clear')}</button></span>}
        <button className="icon-btn" onClick={() => setUI({ globalGraph: false })} title={t('Close') + ' (Esc)'}><Icon name="close" /></button>
      </header>
      <div className="graph-main">
        {panel && (
          <aside className="graph-settings">
            <section>
              <h4>{t('Scope')}</h4>
              <select value={settings.rootBoardId ?? ''} onChange={(e) => set({ rootBoardId: e.target.value || null })} aria-label={t('Board and subtree')}>
                <option value="">{t('Whole workspace')}</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{idx.title(b.id)}</option>)}
              </select>
            </section>
            <section>
              <h4>{t('Show')}</h4>
              {([
                ['showOrphans', t('Orphans')],
                ['showTags', t('Tags as nodes')],
                ['showConnectors', t('Canvas lines')],
                ['showContainment', t('Containment')],
                ['showBroken', t('Broken / unresolved links')],
              ] as const).map(([k, label]) => (
                <label key={k} className="toggle">
                  <input type="checkbox" checked={settings[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<GraphSettings>)} /> {label}
                </label>
              ))}
            </section>
            <section>
              <h4>{t('Card types')}</h4>
              <div className="chips">
                {CARD_TYPES.filter((x) => x !== 'column').map((tp) => (
                  <button key={tp} className={'chip' + (settings.types.includes(tp) ? ' on' : '')} onClick={() => toggleType(tp)}>
                    <span className="dot" style={{ background: TYPE_COLORS[tp] }} />{t(tp)}
                  </button>
                ))}
              </div>
            </section>
            {idx.tags.size > 0 && (
              <section>
                <h4>{t('Tags')}</h4>
                <div className="chips">
                  {[...idx.tags.keys()].sort().map((tg) => (
                    <button key={tg} className={'chip' + (settings.tags.includes(tg) ? ' on' : '')} onClick={() => toggleTag(tg)}>#{tg}</button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h4>{t('Filter')}</h4>
              <input value={settings.query} placeholder={t('Text in title or content')} onChange={(e) => set({ query: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <select value={settings.author ?? ''} onChange={(e) => set({ author: e.target.value || null })} aria-label={t('Author')}>
                <option value="">{t('Any author')}</option>
                {Object.values(doc.users).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <div className="row">
                <input type="date" value={settings.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} aria-label={t('Edited from')} />
                <input type="date" value={settings.dateTo} onChange={(e) => set({ dateTo: e.target.value })} aria-label={t('Edited to')} />
              </div>
            </section>
            <section>
              <h4>{t('Colour groups')}</h4>
              {settings.colorGroups.map((g, i) => (
                <div className="row" key={g.id}>
                  <input type="color" value={g.color} onChange={(e) => set({ colorGroups: settings.colorGroups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} aria-label={t('Colour')} />
                  <input value={g.query} placeholder="tag:research · type:note · board:Name" onChange={(e) => set({ colorGroups: settings.colorGroups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} />
                  <button className="icon-btn" onClick={() => set({ colorGroups: settings.colorGroups.filter((_, j) => j !== i) })} aria-label={t('Remove')}>×</button>
                </div>
              ))}
              <button className="link-btn" onClick={() => set({ colorGroups: [...settings.colorGroups, { id: uid(), query: 'tag:', color: '#0984e3' }] })}>+ {t('Add group')}</button>
            </section>
            <section>
              <h4>{t('Forces')}</h4>
              <label className="slider">{t('Link distance')} <input type="range" min={10} max={300} value={settings.linkDistance} onChange={(e) => set({ linkDistance: +e.target.value })} /></label>
              <label className="slider">{t('Repulsion')} <input type="range" min={5} max={600} value={settings.repulsion} onChange={(e) => set({ repulsion: +e.target.value })} /></label>
              <label className="slider">{t('Centre gravity')} <input type="range" min={0} max={0.3} step={0.005} value={settings.gravity} onChange={(e) => set({ gravity: +e.target.value })} /></label>
              <div className="row">
                <button className="btn small" onClick={() => setResetAt(Date.now())}>{t('Reset layout')}</button>
                <button className="btn small" onClick={() => setUnpinAt(Date.now())}>{t('Unpin all')}</button>
              </div>
            </section>
            <section>
              <h4>{t('Saved views')}</h4>
              <div className="row">
                <input value={viewName} placeholder={t('View name')} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <button className="btn small" disabled={!viewName.trim()} onClick={() => { saveGraphView(viewName.trim()); setViewName(''); }}>{t('Save')}</button>
              </div>
              {views.map((v) => (
                <div className="row view-row" key={v.id}>
                  <button className="link-btn" onClick={() => { set(v.settings); toast(t('Loaded view "{n}"', { n: v.name })); }}>{v.name}</button>
                  <button className="icon-btn" onClick={() => deleteGraphView(v.id)} aria-label={t('Delete')}>×</button>
                </div>
              ))}
              <button className="link-btn small" onClick={() => saveGraphSettings({ ...graphSettingsFor({ ...doc, graphSettings: {} }, ui.userId) })}>{t('Reset all settings')}</button>
            </section>
            <section>
              <h4>{t('Performance benchmark')}</h4>
              <div className="row wrap">
                <button className={'btn small' + (bench?.n === 5000 ? ' primary' : '')} onClick={() => setBench({ n: 5000, m: 15000 })}>5k / 15k</button>
                <button className={'btn small' + (bench?.n === 20000 ? ' primary' : '')} onClick={() => setBench({ n: 20000, m: 60000 })}>20k / 60k</button>
                {bench && <button className="btn small" onClick={() => { setBench(null); setBenchResult(''); }}>{t('Back to workspace')}</button>}
              </div>
              <button className="btn small" onClick={() => { setBenchResult(t('Measuring…')); setBenchAt(Date.now()); }}>{t('Measure pan/zoom FPS (3 s)')}</button>
              {benchResult && <div className="bench-result">{benchResult}</div>}
            </section>
          </aside>
        )}
        <GraphCanvas
          data={data}
          colorOf={colorOf}
          thumbOf={bench ? undefined : thumb}
          highlight={highlight}
          path={path}
          selected={selected}
          onSelect={onSelect}
          onOpen={(id) => (bench ? undefined : openNode(id))}
          onHover={(n, s) => setHover(n && s ? { n, x: s.x, y: s.y } : null)}
          forces={settings}
          showFps
          zoomTo={zoomTo}
          resetAt={resetAt}
          unpinAt={unpinAt}
          benchAt={benchAt}
          onBench={(r) => setBenchResult(`${r.fps === null ? 'measuring live fps…' : r.fps + ' fps measured live'} · render cost ${r.drawMs.toFixed(1)} ms/frame (worst ${r.drawWorstMs.toFixed(1)} ms) ≈ ${Math.floor(1000 / Math.max(r.drawMs, 0.1))} fps headroom · ${data.nodes.length.toLocaleString()} nodes / ${data.edges.length.toLocaleString()} edges`)}
        />
        {sel && !bench && (
          <aside className="graph-preview">
            <NodePreview node={sel} onPath={() => { setPathFrom(sel.id); setPath(null); }} />
          </aside>
        )}
      </div>
      {hover && !bench && (
        <div className="graph-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="row"><CardTypeIcon type={hover.n.type} /> <strong>{hover.n.title}</strong></div>
          <div className="muted small">
            {t(hover.n.type)}{hover.n.boardId ? ' · ' + idx.title(hover.n.boardId) : ''} · {t('{n} connections', { n: hover.n.degree })}
          </div>
          {doc.cards[hover.n.id]?.text && <Markdown text={doc.cards[hover.n.id].text} maxLines={4} className="tiny" />}
        </div>
      )}
    </div>
  );
}

function NodePreview({ node, onPath }: { node: GNode; onPath: () => void }) {
  const doc = useDoc();
  const idx = getIndex(doc);
  const c = doc.cards[node.id];
  const backlinks = idx.backlinks.get(node.id)?.length ?? 0;
  return (
    <div className="node-preview">
      <div className="row"><CardTypeIcon type={node.type} size={18} /><h3>{node.title}</h3></div>
      <div className="muted small">
        {t(node.type)}{node.boardId ? ' · ' + t('on') + ' ' + idx.title(node.boardId) : ''} · {t('{n} connections', { n: node.degree })} · {t('{n} backlinks', { n: backlinks })}
      </div>
      {node.tags.length > 0 && <div className="chips">{node.tags.map((tg) => <span key={tg} className="tag">#{tg}</span>)}</div>}
      {c && (c.text ? <Markdown text={c.text} maxLines={12} /> : c.type === 'board' ? <div className="muted">{t('{n} items', { n: idx.childCount(c.id) })}</div> : null)}
      <div className="row wrap">
        {!node.id.includes(':') && <button className="btn small primary" onClick={() => openNode(node.id)}>{t('Open')}</button>}
        {!node.id.includes(':') && (
          <button className="btn small" onClick={() => { setUI({ globalGraph: false, focusCard: node.id, rightPanel: 'backlinks' }); revealOrOpen(node.id); }}>{t('Backlinks')}</button>
        )}
        {!node.id.includes(':') && (
          <button className="btn small" onClick={() => { setUI({ globalGraph: false, focusCard: node.id, rightPanel: 'localGraph' }); revealOrOpen(node.id); }}>{t('Local graph')}</button>
        )}
        <button className="btn small" onClick={onPath}>{t('Find path to…')}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ local graph panel

export function LocalGraphPanel() {
  const doc = useDoc();
  const ui = useUI();
  const idx = getIndex(doc);
  const settings = useMemo(() => graphSettingsFor(doc, ui.userId), [doc.graphSettings, ui.userId]);
  const local = useMemo<GraphSettings>(() => ({ ...settings, showOrphans: true, rootBoardId: null, types: [], tags: [], query: '', author: null, dateFrom: '', dateTo: '' }), [settings]);
  const full = useGraph(local);
  const selCard = ui.selection.length ? doc.placements[ui.selection[0]]?.cardId : null;
  const center = (selCard && idx.isLive(selCard) ? selCard : null) ?? (ui.focusCard && idx.isLive(ui.focusCard) ? ui.focusCard : null) ?? ui.boardId;
  const data = useMemo(() => localGraph(full, center, settings.depth), [full, center, settings.depth]);
  const colorOf = useColorOf(settings.colorGroups);
  const thumb = useThumbOf();
  const [hover, setHover] = useState<{ n: GNode; x: number; y: number } | null>(null);
  return (
    <div className="local-graph">
      <div className="panel-sub">
        <span className="muted small">{t('Centred on')} <strong>{idx.title(center)}</strong></span>
        <label className="slider small">
          {t('Depth')} {settings.depth}
          <input type="range" min={1} max={5} value={settings.depth} onChange={(e) => saveGraphSettings({ depth: +e.target.value })} aria-label={t('Depth')} />
        </label>
        <div className="row wrap">
          <label className="toggle small"><input type="checkbox" checked={settings.showContainment} onChange={(e) => saveGraphSettings({ showContainment: e.target.checked })} /> {t('Containment')}</label>
          <label className="toggle small"><input type="checkbox" checked={settings.showTags} onChange={(e) => saveGraphSettings({ showTags: e.target.checked })} /> {t('Tags')}</label>
          <label className="toggle small"><input type="checkbox" checked={settings.showConnectors} onChange={(e) => saveGraphSettings({ showConnectors: e.target.checked })} /> {t('Lines')}</label>
        </div>
      </div>
      <GraphCanvas
        data={data}
        colorOf={colorOf}
        thumbOf={thumb}
        center={center}
        selected={null}
        compact
        onSelect={(id) => {
          if (!id || id.includes(':')) return;
          setUI({ focusCard: id });
        }}
        onOpen={(id) => openNode(id)}
        onHover={(n, s) => setHover(n && s ? { n, x: s.x, y: s.y } : null)}
        forces={settings}
      />
      {hover && (
        <div className="graph-tooltip" style={{ left: Math.min(hover.x + 12, window.innerWidth - 260), top: hover.y + 12 }}>
          <strong>{hover.n.title}</strong>
          <div className="muted small">{t(hover.n.type)} · {t('double-click to open')}</div>
        </div>
      )}
      <button className="btn small" onClick={() => setUI({ globalGraph: true })}><Icon name="graph" size={14} /> {t('Open global graph')}</button>
    </div>
  );
}
