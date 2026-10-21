// Small helper for generating boards programmatically (seed data, templates, imports).

import type { Card, CardData, CardType, Connector, ConnectorStyle, DbValue, Placement, SubtreePayload } from './types';
import { uid } from './store';

const SIZES: Partial<Record<CardType, { w: number; h?: number }>> = {
  note: { w: 240 }, document: { w: 220 }, todo: { w: 260 }, board: { w: 170 }, column: { w: 280 },
  image: { w: 260 }, link: { w: 280 }, file: { w: 240 }, table: { w: 400 }, sketch: { w: 300, h: 220 },
  swatch: { w: 140 }, map: { w: 320, h: 240 }, comment: { w: 240 }, shortcut: { w: 170 }, database: { w: 760 },
};

export class Builder {
  cards: Card[] = [];
  placements: Placement[] = [];
  connectors: Connector[] = [];
  private z = 1;
  private t = Date.now();
  constructor(public userId: string) {}

  card(
    type: CardType,
    boardId: string,
    x: number,
    y: number,
    partial: Partial<Card> & { data?: CardData } = {},
    pl: Partial<Placement> = {},
  ) {
    const t = this.t++;
    const card: Card = {
      id: uid(), type, title: '', text: '', labels: [], createdBy: this.userId, createdAt: t, updatedAt: t, updatedBy: this.userId,
      ...partial,
      data: { ...(partial.data ?? {}) },
    };
    if (type === 'board' && card.data.parentId === undefined) card.data.parentId = boardId;
    const size = SIZES[type] ?? { w: 240 };
    const p: Placement = { id: uid(), cardId: card.id, boardId, order: this.z, x, y, w: size.w, h: size.h, z: this.z++, columnId: null, ...pl };
    this.cards.push(card);
    this.placements.push(p);
    return { card, cardId: card.id, placementId: p.id };
  }

  note(boardId: string, x: number, y: number, text: string, extra: Partial<Card> = {}, pl: Partial<Placement> = {}) {
    return this.card('note', boardId, x, y, { text, ...extra }, pl);
  }

  board(parentId: string, x: number, y: number, title: string, icon = 'board', extra: Partial<Card> = {}) {
    return this.card('board', parentId, x, y, { title, ...extra, data: { icon, parentId, ...(extra.data ?? {}) } });
  }

  column(boardId: string, x: number, y: number, title: string, color?: string) {
    return this.card('column', boardId, x, y, { title, color });
  }

  /** Put a card inside a column (placement-level). */
  inColumn(columnPlacementId: string, type: CardType, partial: Partial<Card> & { data?: CardData }) {
    const col = this.placements.find((p) => p.id === columnPlacementId)!;
    const order = this.placements.filter((p) => p.columnId === columnPlacementId).length;
    return this.card(type, col.boardId, 0, 0, partial, { columnId: columnPlacementId, order });
  }

  /** Database row: a card with no placement. */
  row(databaseId: string, title: string, values: Record<string, DbValue> = {}, text = '') {
    const t = this.t++;
    const order = this.cards.filter((c) => c.type === 'row' && c.data.databaseId === databaseId).length + 1;
    const card: Card = {
      id: uid(), type: 'row', title, text, labels: [], createdBy: this.userId, createdAt: t, updatedAt: t, updatedBy: this.userId,
      data: { databaseId, values, order },
    };
    this.cards.push(card);
    return card;
  }

  connect(boardId: string, from: string, to: string, style: Partial<ConnectorStyle> = {}, label = '') {
    const c: Connector = {
      id: uid(), boardId, from, to, label,
      style: { curved: true, arrowStart: false, arrowEnd: true, color: '#636e72', dashed: false, ...style },
    };
    this.connectors.push(c);
    return c;
  }

  payload(rootId: string): SubtreePayload {
    return { rootId, cards: this.cards, placements: this.placements, connectors: this.connectors };
  }
}

export const link = (id: string, alias?: string, anchor?: string) => `[[@${id}${anchor ? '#' + anchor : ''}${alias ? '|' + alias : ''}]]`;
