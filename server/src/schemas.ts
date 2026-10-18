// JSON schemas for request validation, response serialisation and the
// generated OpenAPI document. Shapes follow src/model/types.ts.

import { CARD_TYPES } from '../../src/model/types';

export const role = { type: 'string', enum: ['owner', 'editor', 'commenter', 'viewer', 'none'] } as const;
const nullableString = { type: ['string', 'null'] } as const;
const looseObject = { type: 'object', additionalProperties: true } as const;

export const error = {
  type: 'object',
  properties: { error: { type: 'string' }, statusCode: { type: 'integer' } },
} as const;

export const errors = { 400: error, 401: error, 403: error, 404: error } as const;

export const snippet = {
  type: 'object',
  properties: { before: { type: 'string' }, match: { type: 'string' }, after: { type: 'string' } },
  required: ['before', 'match', 'after'],
} as const;

export const graphNode = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['board', 'card', 'tag', 'broken'] },
    type: { type: 'string', description: 'Card type, or "tag" / "broken"' },
    title: { type: 'string' },
    boardId: { ...nullableString, description: 'Board the item lives on (parent for boards); null when that board is hidden from the viewer' },
    degree: { type: 'integer', description: 'Number of link/connector/tag edges (containment excluded)' },
    tags: { type: 'array', items: { type: 'string' } },
    createdBy: { type: 'string' },
    updatedAt: { type: 'integer', description: 'Epoch ms' },
  },
  required: ['id', 'kind', 'type', 'title', 'boardId', 'degree', 'tags'],
} as const;

export const graph = {
  type: 'object',
  properties: {
    nodes: { type: 'array', items: graphNode },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          kind: { type: 'string', enum: ['link', 'connector', 'containment', 'tag'] },
        },
        required: ['source', 'target', 'kind'],
      },
    },
  },
  required: ['nodes', 'edges'],
} as const;

export const backlink = {
  type: 'object',
  properties: {
    sourceId: { type: 'string' },
    sourceTitle: { type: 'string' },
    sourceType: { type: 'string' },
    boardId: nullableString,
    boardTitle: nullableString,
    field: { type: 'string', description: "'text' | 'item:<id>' | 'cell:<row>:<col>' | 'caption' | 'comment:<id>'" },
    anchor: nullableString,
    alias: nullableString,
    snippet,
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['sourceId', 'sourceTitle', 'boardId', 'field', 'snippet'],
} as const;

export const mention = {
  type: 'object',
  properties: {
    sourceId: { type: 'string' },
    sourceTitle: { type: 'string' },
    boardId: nullableString,
    field: { type: 'string' },
    index: { type: 'integer' },
    length: { type: 'integer' },
    snippet,
  },
} as const;

export const card = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspaceId: { type: 'string' },
    type: { type: 'string', enum: CARD_TYPES },
    title: { type: 'string' },
    displayTitle: { type: 'string' },
    text: { type: 'string', description: 'Markdown; links stored as [[@id#anchor|alias]]' },
    data: looseObject,
    color: nullableString,
    labels: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    role: role,
    createdBy: { type: 'string' },
    updatedBy: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: ['string', 'null'], format: 'date-time' },
    placements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, boardId: { type: 'string' }, columnId: nullableString,
          order: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: ['number', 'null'] },
          z: { type: 'integer' }, locked: { type: 'boolean' }, tray: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export const cardWrite = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: CARD_TYPES, description: 'Required when creating' },
    boardId: { type: 'string', description: 'Board to place a new card on (required when creating; the parent for a new board)' },
    title: { type: 'string' },
    text: { type: 'string' },
    data: looseObject,
    color: nullableString,
    labels: { type: 'array', items: { type: 'string' } },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
  },
  additionalProperties: false,
} as const;

export const comment = {
  type: 'object',
  properties: {
    id: { type: 'string' }, targetId: { type: 'string' }, authorId: { type: 'string' }, authorName: { type: 'string' },
    body: { type: 'string' }, parentId: nullableString, resolved: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const permissionEntry = {
  type: 'object',
  properties: { userId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, role },
} as const;

export const shareLink = {
  type: 'object',
  properties: {
    token: { type: 'string' }, boardId: { type: 'string' }, enabled: { type: 'boolean' },
    hasPassword: { type: 'boolean' }, allowDuplicate: { type: 'boolean' },
  },
} as const;

export const graphView = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' }, settings: looseObject, createdAt: { type: 'string', format: 'date-time' } },
} as const;

export const idParam = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } as const;
