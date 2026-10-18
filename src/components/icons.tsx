import type { CardType } from '../model/types';

const P: Record<string, string> = {
  note: 'M5 4h14v12l-4 4H5z M15 20v-4h4',
  document: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 12h6 M10 16h6',
  todo: 'M4 6l2 2 3-3 M11 7h9 M4 13l2 2 3-3 M11 14h9 M11 20h9',
  board: 'M4 4h7v7H4z M13 4h7v4h-7z M13 10h7v10h-7z M4 13h7v7H4z',
  column: 'M7 3h10v18H7z M9 7h6 M9 11h6 M9 15h6',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15 9.5a1.5 1.5 0 1 0 0.01 0',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1 M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4',
  table: 'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14',
  sketch: 'M4 20c3-6 5-2 7-6s4-8 9-10 M15 4l5 5',
  swatch: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2-1 3-1a4 4 0 0 0 4-4c0-4.5-4-8-9-8z M7.5 11a1 1 0 1 0 .01 0 M10.5 7a1 1 0 1 0 .01 0 M15 7.5a1 1 0 1 0 .01 0',
  map: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z M12 9a2 2 0 1 0 .01 0',
  comment: 'M4 5h16v11H9l-5 4z',
  shortcut: 'M5 12h11 M12 7l5 5-5 5 M4 4v16',
  line: 'M5 19L19 5 M13 5h6v6',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 8a1 1 0 1 0 .01 0',
  broken: 'M10 14l4-4 M8 8l-3 3a4 4 0 0 0 5.6 5.6 M16 16l3-3a4 4 0 0 0-5.6-5.6 M4 4l3 3 M17 17l3 3',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  graph: 'M6 6a2 2 0 1 0 .01 0 M18 7a2 2 0 1 0 .01 0 M12 18a2 2 0 1 0 .01 0 M7.5 7.5l3.5 9 M16.5 8.5l-3.5 8 M8 6h8',
  backlinks: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-2',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5L21 21',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6L6 18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  share: 'M16 8a3 3 0 1 0 0-.01 M6 15a3 3 0 1 0 0-.01 M16 22a3 3 0 1 0 0-.01 M8.7 13.5l4.6-3 M8.7 16.5l4.6 3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  play: 'M7 4l13 8-13 8z',
  zoomfit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  undo: 'M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  template: 'M4 4h16v5H4z M4 11h7v9H4z M13 11h7v9h-7z',
  inbox: 'M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  info: 'M12 8h.01 M11 12h1v5h1 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
  minimap: 'M3 5h18v14H3z M13 11h6v6h-6z',
  grid: 'M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16',
  pen: 'M4 20l4-1 11-11-3-3L5 16z',
  eraser: 'M8 20h12 M5 15l9-9 5 5-9 9H8z',
  highlighter: 'M9 15l-3 3v2h4l3-3 M9 15l7-11 4 4-11 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  connect: 'M5 6a2 2 0 1 0 .01 0 M19 18a2 2 0 1 0 .01 0 M7 6c6 0 4 12 10 12',
};

export function Icon({ name, size = 18, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={'icon ' + (className ?? '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name] ?? P.note} />
    </svg>
  );
}

export function CardTypeIcon({ type, size = 16 }: { type: CardType | 'tag' | 'broken' | 'line'; size?: number }) {
  return <Icon name={type} size={size} />;
}

export const TYPE_COLORS: Record<string, string> = {
  board: '#6c5ce7',
  note: '#fdcb6e',
  document: '#0984e3',
  todo: '#00b894',
  column: '#b2bec3',
  image: '#e84393',
  link: '#00cec9',
  file: '#636e72',
  table: '#e17055',
  sketch: '#a29bfe',
  swatch: '#fd79a8',
  map: '#55efc4',
  comment: '#ffeaa7',
  shortcut: '#81ecec',
  tag: '#2d3436',
  broken: '#d63031',
};
