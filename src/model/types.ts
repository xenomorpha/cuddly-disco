// Core entities. Mirrors the relational model in the spec (§8): a card is the
// content, a placement is where it sits. Boards are cards of type "board".

export type CardType =
  | 'note'
  | 'document'
  | 'todo'
  | 'board'
  | 'column'
  | 'image'
  | 'link'
  | 'file'
  | 'table'
  | 'sketch'
  | 'swatch'
  | 'map'
  | 'comment'
  | 'shortcut'
  | 'database'
  | 'row';

export const CARD_TYPES: CardType[] = [
  'note', 'document', 'todo', 'board', 'column', 'image', 'link', 'file',
  'table', 'sketch', 'swatch', 'map', 'comment', 'shortcut', 'database', 'row',
];

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
}

export interface Member {
  userId: string;
  role: Role;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  due?: string;
  assignee?: string;
}

export type ColumnKind = 'text' | 'number' | 'date' | 'checkbox';

export interface TableData {
  columns: { id: string; name: string; kind: ColumnKind }[];
  rows: { id: string; cells: Record<string, string> }[];
}

export interface Stroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: number[]; // x, y, pressure triples
}

// ---------------------------------------------------------------- databases

export type PropKind = 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'checkbox' | 'person' | 'url';
export const PROP_KINDS: PropKind[] = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'person', 'url'];

export interface DbOption {
  id: string;
  name: string;
  color: string;
}

export interface DbProp {
  id: string;
  name: string;
  kind: PropKind;
  options?: DbOption[];
}

export type ViewKind = 'table' | 'board' | 'list' | 'gallery' | 'calendar';
export const VIEW_KINDS: ViewKind[] = ['table', 'board', 'list', 'gallery', 'calendar'];

export type FilterOp = 'contains' | 'notContains' | 'is' | 'isNot' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'before' | 'after' | 'checked' | 'unchecked';

export interface DbFilter {
  id: string;
  prop: string; // prop id, or 'title'
  op: FilterOp;
  value?: string;
}

export interface DbSort {
  prop: string; // prop id, 'title' or 'created'
  dir: 'asc' | 'desc';
}

export interface DbView {
  id: string;
  name: string;
  kind: ViewKind;
  groupBy?: string | null; // board view: select / multiselect / person / checkbox prop
  dateProp?: string | null; // calendar view
  sorts: DbSort[];
  filters: DbFilter[];
  hidden: string[]; // prop ids not shown in this view
}

export interface DbSchema {
  props: DbProp[];
  views: DbView[];
  activeView: string;
}

export type DbValue = string | number | boolean | string[] | null;

export interface CardData {
  // database
  db?: DbSchema;
  // database row (a card without a canvas placement)
  databaseId?: string;
  values?: Record<string, DbValue>;
  order?: number;
  // board
  parentId?: string | null;
  icon?: string;
  cover?: string;
  // shortcut
  targetBoardId?: string;
  // todo
  items?: TodoItem[];
  // image / file
  assetId?: string;
  mime?: string;
  fileName?: string;
  size?: number;
  caption?: string;
  crop?: { x: number; y: number; w: number; h: number }; // normalised 0..1
  naturalW?: number;
  naturalH?: number;
  // link
  url?: string;
  description?: string;
  // table
  table?: TableData;
  // sketch
  strokes?: Stroke[];
  // swatch
  hex?: string;
  showCaption?: boolean;
  // map
  lat?: number;
  lon?: number;
  address?: string;
  // column
  collapsed?: boolean;
  // comment
  resolved?: boolean;
}

export interface Card {
  id: string;
  type: CardType;
  title: string;
  /** Markdown-ish rich text. Wiki-links are stored as [[@uuid#anchor|alias]]. */
  text: string;
  data: CardData;
  color?: string;
  labels: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number | null;
  history?: { at: number; by: string; text: string; title: string }[];
}

export interface Placement {
  id: string;
  cardId: string;
  boardId: string;
  columnId?: string | null; // placement id of the column holding this card
  order: number; // order inside a column
  x: number;
  y: number;
  w: number;
  h?: number; // undefined = auto height
  z: number;
  locked?: boolean;
  tray?: boolean; // sits in the board's "Unsorted" tray
  deletedAt?: number | null;
}

export interface ConnectorStyle {
  curved: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
  color: string;
  dashed: boolean;
}

export interface Connector {
  id: string;
  boardId: string;
  from: string; // placement id
  to: string;
  style: ConnectorStyle;
  label: string;
}

export interface Comment {
  id: string;
  targetId: string; // card or board id
  authorId: string;
  body: string;
  parentId?: string | null;
  resolved?: boolean;
  createdAt: number;
}

export interface Permission {
  id: string;
  boardId: string;
  userId: string; // or "link:<token>"
  role: Role | 'none';
}

export interface ShareLink {
  boardId: string;
  token: string;
  enabled: boolean;
  password?: string;
  allowDuplicate: boolean;
}

export interface Activity {
  id: string;
  boardId: string;
  userId: string;
  at: number;
  text: string;
}

export interface Notification {
  id: string;
  userId: string;
  at: number;
  text: string;
  targetId: string;
  read: boolean;
}

export interface ColorGroup {
  id: string;
  query: string;
  color: string;
}

export interface GraphSettings {
  showOrphans: boolean;
  showTags: boolean;
  showConnectors: boolean;
  showContainment: boolean;
  showBroken: boolean;
  types: CardType[]; // empty = all
  tags: string[];
  rootBoardId: string | null;
  author: string | null;
  query: string;
  dateFrom: string;
  dateTo: string;
  colorGroups: ColorGroup[];
  linkDistance: number;
  repulsion: number;
  gravity: number;
  depth: number;
}

export interface GraphView {
  id: string;
  userId: string;
  name: string;
  settings: GraphSettings;
}

export interface Template {
  id: string;
  name: string;
  /** serialised subtree, produced by exportSubtree() */
  payload: SubtreePayload;
}

export interface SubtreePayload {
  rootId: string;
  cards: Card[];
  placements: Placement[];
  connectors: Connector[];
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  rootBoardId: string;
  members: Member[];
  users: Record<string, User>;
  cards: Record<string, Card>;
  placements: Record<string, Placement>;
  connectors: Record<string, Connector>;
  comments: Record<string, Comment>;
  permissions: Record<string, Permission>;
  shareLinks: Record<string, ShareLink>;
  activity: Activity[];
  notifications: Notification[];
  graphViews: Record<string, GraphView>;
  graphSettings: Record<string, GraphSettings>; // per user
  templates: Record<string, Template>;
  favorites: Record<string, string[]>; // userId -> board ids
  recent: Record<string, string[]>;
  version: number;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  showOrphans: true,
  showTags: false,
  showConnectors: true,
  showContainment: false,
  showBroken: true,
  types: [],
  tags: [],
  rootBoardId: null,
  author: null,
  query: '',
  dateFrom: '',
  dateTo: '',
  colorGroups: [],
  linkDistance: 60,
  repulsion: 120,
  gravity: 0.05,
  depth: 2,
};
