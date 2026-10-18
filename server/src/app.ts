import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Db, Queryable } from './db';
import { AuthError, hashSecret, newToken, resolvePrincipal, type Principal } from './auth';
import { atLeast, HOME_BOARD_SQL, HttpError, requireBoard, requireCard, requireUser, requireWorkspace, VISIBILITY_CTES, type Access } from './access';
import { workspaceGraph } from './graph';
import { backlinks, mentions } from './backlinks';
import { indexCard, indexComment } from './linkIndex';
import * as S from './schemas';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}

const csv = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const SECURITY: { [scheme: string]: string[] }[] = [{ bearer: [] }, { shareToken: [] }];

export async function buildApp(db: Db, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Nodeboard API',
        version: '0.1.0',
        description:
          'Boards, cards, links, backlinks and the graph. Every response is filtered by the caller\'s role (spec §7): items on boards the caller cannot see are omitted, and requests for them return 404.',
      },
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'API token (dev seed: dev-ksenia, dev-alex, dev-sam, dev-casey)' },
          shareToken: { type: 'apiKey', in: 'header', name: 'X-Share-Token', description: 'Secret share link token (read-only); add X-Share-Password when the link has a password' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorateRequest('principal', null as unknown as Principal);
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if (path === '/health' || path === '/openapi.json' || path.startsWith('/docs')) return;
    req.principal = await resolvePrincipal(db, req.headers);
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError || err instanceof AuthError) return reply.status(err.status).send({ error: err.message, statusCode: err.status });
    if (err.validation) return reply.status(400).send({ error: err.message, statusCode: 400 });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error', statusCode: 500 });
  });

  app.get('/health', { schema: { hide: true } }, async () => {
    await db.query('select 1');
    return { ok: true };
  });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  // ------------------------------------------------------------ me / workspaces

  app.get('/me', {
    schema: {
      tags: ['workspaces'], security: SECURITY, summary: 'The calling principal',
      response: { 200: { type: 'object', properties: { principal: { type: 'string' }, kind: { type: 'string' }, user: { type: ['object', 'null'], additionalProperties: true } } } },
    },
  }, async (req) => {
    const user = req.principal.userId
      ? (await db.query('select id, name, email, color from users where id = $1', [req.principal.userId])).rows[0] ?? null
      : null;
    return { principal: req.principal.id, kind: req.principal.kind, user };
  });

  app.get('/workspaces', {
    schema: {
      tags: ['workspaces'], security: SECURITY, summary: 'Workspaces where the caller can see at least one board',
      response: {
        200: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, rootBoardId: { type: 'string' }, rootRole: S.role } } },
      },
    },
  }, async (req) => {
    const rows = (await db.query(
      `select w.id, w.name, w.root_board_id as "rootBoardId", board_role($1, w.root_board_id) as "rootRole"
       from workspaces w
       where exists (select 1 from board_roles($1, w.id) r where r.role <> 'none')
       order by w.name`,
      [req.principal.id],
    )).rows;
    return rows;
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, any> }>('/workspaces/:id/graph', {
    schema: {
      tags: ['graph'], security: SECURITY, summary: 'Graph of everything the caller can see',
      description: 'Server version of buildGraph() (src/model/graph.ts). Links to items the caller cannot see are dropped; links to deleted or missing items become `broken:` nodes.',
      params: S.idParam,
      querystring: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Only this board\'s subtree' },
          center: { type: 'string', description: 'Local graph around this node' },
          depth: { type: 'integer', minimum: 1, maximum: 5, description: 'Hops from `center` (default 1)' },
          types: { type: 'string', description: 'Comma-separated card types' },
          tags: { type: 'string', description: 'Comma-separated tags (any match)' },
          q: { type: 'string', description: 'Substring of title or text' },
          orphans: { type: 'boolean', default: true },
          connectors: { type: 'boolean', default: true },
          containment: { type: 'boolean', default: false },
          broken: { type: 'boolean', default: true },
          tagNodes: { type: 'boolean', default: false, description: 'Add a node per tag with tag edges' },
        },
      },
      response: { 200: S.graph, ...S.errors },
    },
  }, async (req) => {
    await requireWorkspace(db, req.principal, req.params.id);
    const qs = req.query;
    return workspaceGraph(db, req.principal, req.params.id, {
      root: qs.root, center: qs.center, depth: qs.depth, types: csv(qs.types), tags: csv(qs.tags), q: qs.q,
      orphans: qs.orphans, connectors: qs.connectors, containment: qs.containment, broken: qs.broken, tagNodes: qs.tagNodes,
    });
  });

  app.get<{ Params: { id: string } }>('/workspaces/:id/graph-views', {
    schema: { tags: ['graph'], security: SECURITY, summary: "The caller's saved graph views", params: S.idParam, response: { 200: { type: 'array', items: S.graphView }, ...S.errors } },
  }, async (req) => {
    const userId = requireUser(req.principal);
    await requireWorkspace(db, req.principal, req.params.id);
    return (await db.query(
      'select id, name, settings, created_at as "createdAt" from graph_views where workspace_id = $1 and user_id = $2 order by created_at',
      [req.params.id, userId],
    )).rows;
  });

  app.post<{ Params: { id: string }; Body: { name: string; settings: object } }>('/workspaces/:id/graph-views', {
    schema: {
      tags: ['graph'], security: SECURITY, summary: 'Save a named graph view (GraphSettings from src/model/types.ts)', params: S.idParam,
      body: { type: 'object', properties: { name: { type: 'string', minLength: 1 }, settings: { type: 'object', additionalProperties: true } }, required: ['name', 'settings'] },
      response: { 201: S.graphView, ...S.errors },
    },
  }, async (req, reply) => {
    const userId = requireUser(req.principal);
    await requireWorkspace(db, req.principal, req.params.id);
    const row = (await db.query(
      'insert into graph_views (workspace_id, user_id, name, settings) values ($1, $2, $3, $4) returning id, name, settings, created_at as "createdAt"',
      [req.params.id, userId, req.body.name, req.body.settings],
    )).rows[0];
    return reply.status(201).send(row);
  });

  // ------------------------------------------------------------ boards

  app.get<{ Params: { id: string } }>('/boards/:id', {
    schema: {
      tags: ['boards'], security: SECURITY, summary: 'A board with the cards, placements and connectors the caller can see', params: S.idParam,
      response: {
        200: {
          type: 'object',
          properties: {
            board: S.card,
            cards: { type: 'array', items: S.card },
            connectors: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, style: { type: 'object', additionalProperties: true } } } },
          },
        },
        ...S.errors,
      },
    },
  }, async (req) => {
    const b = await requireBoard(db, req.principal, req.params.id, 'viewer');
    const board = (await loadCards(db, req.principal, b.workspaceId, [b.id]))[0];
    const ids = (await db.query<{ id: string }>(
      `with ${VISIBILITY_CTES}
       select distinct p.card_id as id from placements p join vis on vis.card_id = p.card_id join live on live.card_id = p.card_id
       where p.board_id = $3 and p.deleted_at is null`,
      [req.principal.id, b.workspaceId, b.id],
    )).rows.map((r) => r.id);
    const cards = (await loadCards(db, req.principal, b.workspaceId, ids)).map((c) => ({ ...c, placements: c.placements.filter((p: any) => p.boardId === b.id) }));
    const placementIds = cards.flatMap((c) => c.placements.map((p: any) => p.id));
    const connectors = (await db.query(
      `select id, from_placement_id as "from", to_placement_id as "to", label, style from connectors
       where board_id = $1 and from_placement_id = any ($2::text[]) and to_placement_id = any ($2::text[]) order by id`,
      [b.id, placementIds],
    )).rows;
    return { board, cards, connectors };
  });

  app.get<{ Params: { id: string } }>('/boards/:id/permissions', {
    schema: {
      tags: ['sharing'], security: SECURITY, summary: 'Workspace members and the overrides set on this board (owners only)', params: S.idParam,
      response: { 200: { type: 'object', properties: { members: { type: 'array', items: S.permissionEntry }, overrides: { type: 'array', items: S.permissionEntry }, effective: { type: 'array', items: S.permissionEntry } } }, ...S.errors },
    },
  }, async (req) => {
    const b = await requireBoard(db, req.principal, req.params.id, 'owner');
    const members = (await db.query(
      `select u.id as "userId", u.name, u.email, m.role from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 order by u.name`,
      [b.workspaceId],
    )).rows;
    const overrides = (await db.query(
      `select u.id as "userId", u.name, u.email, p.role from permissions p join users u on u.id = p.user_id where p.board_id = $1 order by u.name`,
      [b.id],
    )).rows;
    // everyone who has any member role or an override anywhere in the workspace, resolved for this board
    const effective = (await db.query(
      `select u.id as "userId", u.name, u.email, board_role(u.id, $2) as role from users u
       where u.id in (select user_id from workspace_members where workspace_id = $1 union select user_id from permissions where workspace_id = $1)
       order by u.name`,
      [b.workspaceId, b.id],
    )).rows;
    return { members, overrides, effective };
  });

  app.put<{ Params: { id: string; userId: string }; Body: { role: Access | null } }>('/boards/:id/permissions/:userId', {
    schema: {
      tags: ['sharing'], security: SECURITY, summary: 'Set or clear (role: null) a user\'s override on a board and its subtree (owners only)',
      params: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' } }, required: ['id', 'userId'] },
      body: { type: 'object', properties: { role: { type: ['string', 'null'], enum: ['owner', 'editor', 'commenter', 'viewer', 'none', null] } }, required: ['role'] },
      response: { 200: { type: 'object', properties: { userId: { type: 'string' }, boardId: { type: 'string' }, role: { type: ['string', 'null'] }, effective: S.role } }, ...S.errors },
    },
  }, async (req) => {
    const b = await requireBoard(db, req.principal, req.params.id, 'owner');
    const user = (await db.query('select id from users where id = $1', [req.params.userId])).rows[0];
    if (!user) throw new HttpError(404, 'Unknown user');
    if (req.body.role === null) {
      await db.query('delete from permissions where board_id = $1 and user_id = $2', [b.id, req.params.userId]);
    } else {
      await db.query(
        `insert into permissions (workspace_id, board_id, user_id, role) values ($1, $2, $3, $4)
         on conflict (board_id, user_id) do update set role = excluded.role`,
        [b.workspaceId, b.id, req.params.userId, req.body.role],
      );
    }
    const effective = (await db.query('select board_role($1, $2) as r', [req.params.userId, b.id])).rows[0].r;
    return { userId: req.params.userId, boardId: b.id, role: req.body.role, effective };
  });

  app.post<{ Params: { id: string }; Body: { password?: string | null; allowDuplicate?: boolean } }>('/boards/:id/share-link', {
    schema: {
      tags: ['sharing'], security: SECURITY, summary: 'Create (or rotate) the secret view-only link for a board (owners only)', params: S.idParam,
      body: { type: 'object', properties: { password: { type: ['string', 'null'] }, allowDuplicate: { type: 'boolean' } } },
      response: { 201: S.shareLink, ...S.errors },
    },
  }, async (req, reply) => {
    const b = await requireBoard(db, req.principal, req.params.id, 'owner');
    const token = newToken();
    const body = req.body ?? {};
    await db.query(
      `insert into share_links (token, workspace_id, board_id, enabled, password_hash, allow_duplicate) values ($1, $2, $3, true, $4, $5)
       on conflict (board_id) do update set token = excluded.token, enabled = true, password_hash = excluded.password_hash, allow_duplicate = excluded.allow_duplicate`,
      [token, b.workspaceId, b.id, body.password ? hashSecret(body.password) : null, !!body.allowDuplicate],
    );
    return reply.status(201).send({ token, boardId: b.id, enabled: true, hasPassword: !!body.password, allowDuplicate: !!body.allowDuplicate });
  });

  app.patch<{ Params: { token: string }; Body: { enabled?: boolean; password?: string | null; allowDuplicate?: boolean } }>('/share-links/:token', {
    schema: {
      tags: ['sharing'], security: SECURITY, summary: 'Enable/disable a share link, set or clear its password (owners only)',
      params: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
      body: { type: 'object', properties: { enabled: { type: 'boolean' }, password: { type: ['string', 'null'] }, allowDuplicate: { type: 'boolean' } } },
      response: { 200: S.shareLink, ...S.errors },
    },
  }, async (req) => {
    const link = (await db.query<{ board_id: string }>('select board_id from share_links where token = $1', [req.params.token])).rows[0];
    if (!link) throw new HttpError(404, 'Not found');
    await requireBoard(db, req.principal, link.board_id, 'owner');
    const body = req.body ?? {};
    const row = (await db.query(
      `update share_links set
         enabled = coalesce($2, enabled),
         password_hash = case when $3::boolean then $4 else password_hash end,
         allow_duplicate = coalesce($5, allow_duplicate)
       where token = $1
       returning token, board_id as "boardId", enabled, password_hash is not null as "hasPassword", allow_duplicate as "allowDuplicate"`,
      [req.params.token, body.enabled ?? null, 'password' in body, body.password ? hashSecret(body.password) : null, body.allowDuplicate ?? null],
    )).rows[0];
    return row;
  });

  // ------------------------------------------------------------ cards

  app.get<{ Params: { id: string } }>('/cards/:id', {
    schema: { tags: ['cards'], security: SECURITY, summary: 'One card, with its placements on boards the caller can see', params: S.idParam, response: { 200: S.card, ...S.errors } },
  }, async (req) => {
    const a = await requireCard(db, req.principal, req.params.id, 'viewer');
    return (await loadCards(db, req.principal, a.workspaceId, [a.id]))[0];
  });

  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/cards/:id', {
    schema: {
      tags: ['cards'], security: SECURITY, summary: 'Create or update a card; re-indexes its links and tags in the same transaction',
      description: 'Editors only. To create, pass `type` and `boardId` (the board to place it on; for a new board, its parent). Text is stored as sent: send links in stored form `[[@id]]`.',
      params: S.idParam, body: S.cardWrite,
      response: { 200: S.card, 201: S.card, ...S.errors },
    },
  }, async (req, reply) => {
    const userId = requireUser(req.principal);
    const body = req.body;
    const existing = (await db.query<{ workspace_id: string }>('select workspace_id from cards where id = $1', [req.params.id])).rows[0];
    const result = await db.tx(async (q) => {
      if (existing) {
        await requireCard(q, req.principal, req.params.id, 'editor');
        await q.query(
          `update cards set
             title = coalesce($2, title), text = coalesce($3, text), data = coalesce($4, data),
             color = case when $5::boolean then $6 else color end, labels = coalesce($7, labels),
             updated_by = $8, updated_at = now()
           where id = $1`,
          [req.params.id, body.title ?? null, body.text ?? null, body.data ?? null, 'color' in body, body.color ?? null, body.labels ?? null, userId],
        );
        await indexCard(q, req.params.id);
        return { workspaceId: existing.workspace_id, created: false };
      }
      if (!body.type || !body.boardId) throw new HttpError(400, 'type and boardId are required to create a card');
      const board = await requireBoard(q, req.principal, body.boardId, 'editor');
      await q.query(
        `insert into cards (id, workspace_id, type, title, text, data, color, labels, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [req.params.id, board.workspaceId, body.type, body.title ?? '', body.text ?? '', body.data ?? {}, body.color ?? null, body.labels ?? [], userId],
      );
      if (body.type === 'board') {
        await q.query('insert into boards (id, workspace_id, parent_board_id, icon) values ($1, $2, $3, $4)', [req.params.id, board.workspaceId, board.id, body.data?.icon ?? null]);
      }
      await q.query(
        `insert into placements (workspace_id, card_id, board_id, x, y, w, z)
         values ($1, $2, $3, $4, $5, $6, coalesce((select max(z) + 1 from placements where board_id = $3), 0))`,
        [board.workspaceId, req.params.id, board.id, body.x ?? 0, body.y ?? 0, body.w ?? 240],
      );
      await indexCard(q, req.params.id);
      return { workspaceId: board.workspaceId, created: true };
    });
    const card = (await loadCards(db, req.principal, result.workspaceId, [req.params.id]))[0];
    return reply.status(result.created ? 201 : 200).send(card);
  });

  app.delete<{ Params: { id: string } }>('/cards/:id', {
    schema: { tags: ['cards'], security: SECURITY, summary: 'Move a card to the trash (soft delete; its links turn broken)', params: S.idParam, response: { 204: { type: 'null' }, ...S.errors } },
  }, async (req, reply) => {
    const userId = requireUser(req.principal);
    await requireCard(db, req.principal, req.params.id, 'editor');
    await db.query('update cards set deleted_at = now(), updated_by = $2, updated_at = now() where id = $1', [req.params.id, userId]);
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string }; Querystring: { sort?: 'board' | 'date'; q?: string } }>('/cards/:id/backlinks', {
    schema: {
      tags: ['links'], security: SECURITY, summary: 'Linked references to a card from items the caller can see', params: S.idParam,
      querystring: { type: 'object', properties: { sort: { type: 'string', enum: ['board', 'date'], default: 'board' }, q: { type: 'string', description: 'Filter by source title, board or snippet' } } },
      response: { 200: { type: 'array', items: S.backlink }, ...S.errors },
    },
  }, async (req) => {
    const a = await requireCard(db, req.principal, req.params.id, 'viewer');
    return backlinks(db, req.principal, a.workspaceId, a.id, req.query);
  });

  app.get<{ Params: { id: string } }>('/cards/:id/mentions', {
    schema: {
      tags: ['links'], security: SECURITY, summary: 'Unlinked mentions: plain-text occurrences of the card\'s title (max 50)', params: S.idParam,
      response: { 200: { type: 'array', items: S.mention }, ...S.errors },
    },
  }, async (req) => {
    const a = await requireCard(db, req.principal, req.params.id, 'viewer');
    return mentions(db, req.principal, a.workspaceId, a.id);
  });

  app.get<{ Params: { id: string } }>('/cards/:id/comments', {
    schema: { tags: ['comments'], security: SECURITY, summary: 'Comment thread on a card or board', params: S.idParam, response: { 200: { type: 'array', items: S.comment }, ...S.errors } },
  }, async (req) => {
    await requireCard(db, req.principal, req.params.id, 'viewer');
    return (await db.query(
      `select c.id, c.target_id as "targetId", c.author_id as "authorId", u.name as "authorName", c.body, c.parent_id as "parentId", c.resolved, c.created_at as "createdAt"
       from comments c join users u on u.id = c.author_id where c.target_id = $1 order by c.created_at, c.id`,
      [req.params.id],
    )).rows;
  });

  app.post<{ Params: { id: string }; Body: { body: string; parentId?: string | null } }>('/cards/:id/comments', {
    schema: {
      tags: ['comments'], security: SECURITY, summary: 'Comment on a card or board (commenters and up); links in the body are indexed', params: S.idParam,
      body: { type: 'object', properties: { body: { type: 'string', minLength: 1 }, parentId: { type: ['string', 'null'] } }, required: ['body'] },
      response: { 201: S.comment, ...S.errors },
    },
  }, async (req, reply) => {
    const userId = requireUser(req.principal);
    const a = await requireCard(db, req.principal, req.params.id, 'commenter');
    const row = await db.tx(async (q) => {
      if (req.body.parentId) {
        const parent = (await q.query('select 1 from comments where id = $1 and target_id = $2', [req.body.parentId, a.id])).rows[0];
        if (!parent) throw new HttpError(400, 'parentId is not a comment on this card');
      }
      const r = (await q.query(
        `insert into comments (workspace_id, target_id, author_id, body, parent_id) values ($1, $2, $3, $4, $5)
         returning id, target_id as "targetId", author_id as "authorId", body, parent_id as "parentId", resolved, created_at as "createdAt"`,
        [a.workspaceId, a.id, userId, req.body.body, req.body.parentId ?? null],
      )).rows[0];
      await indexComment(q, r.id);
      return r;
    });
    return reply.status(201).send(row);
  });

  // ------------------------------------------------------------ search

  app.get<{ Querystring: { q: string; workspace?: string; type?: string; board?: string; tag?: string; since?: string; limit?: number } }>('/search', {
    schema: {
      tags: ['search'], security: SECURITY, summary: 'Full-text search over titles and text (Postgres FTS; Meilisearch can replace it later)',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', minLength: 1 },
          workspace: { type: 'string', description: 'Default: every workspace the caller can see' },
          type: { type: 'string', description: 'Comma-separated card types' },
          board: { type: 'string', description: 'Only this board\'s subtree' },
          tag: { type: 'string' },
          since: { type: 'string', format: 'date-time' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        },
        required: ['q'],
      },
      response: {
        200: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, workspaceId: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, boardId: { type: ['string', 'null'] }, headline: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } },
        },
        ...S.errors,
      },
    },
  }, async (req) => {
    const qs = req.query;
    if (qs.workspace) await requireWorkspace(db, req.principal, qs.workspace);
    const workspaces = qs.workspace
      ? [qs.workspace]
      : (await db.query<{ id: string }>(`select id from workspaces w where exists (select 1 from board_roles($1, w.id) r where r.role <> 'none')`, [req.principal.id])).rows.map((r) => r.id);
    const out: any[] = [];
    for (const ws of workspaces) {
      const rows = (await db.query(
        `with ${VISIBILITY_CTES},
         scope as (select board_id from subtree_boards($5) where $5::text is not null),
         query as (select websearch_to_tsquery('simple', $3) as tsq)
         select c.id, c.workspace_id as "workspaceId", c.type, c.display_title as title, ${HOME_BOARD_SQL} as "boardId",
           ts_headline('simple', c.plain_text, query.tsq, 'MaxWords=18, MinWords=6') as headline, c.updated_at as "updatedAt",
           ts_rank(c.search, query.tsq) + case when c.display_title ilike $3 || '%' then 1 else 0 end as rank
         from cards c
           cross join query
           join vis on vis.card_id = c.id
           join live on live.card_id = c.id
           left join boards b on b.id = c.id
         where c.workspace_id = $2 and c.type <> 'column'
           and (c.search @@ query.tsq or c.display_title ilike '%' || $3 || '%')
           and ($4::text[] is null or c.type = any ($4::text[]))
           and ($5::text is null
                or (c.type = 'board' and c.id in (select board_id from scope))
                or exists (select 1 from placements pl where pl.card_id = c.id and pl.deleted_at is null and pl.board_id in (select board_id from scope)))
           and ($6::text is null or exists (select 1 from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = c.id and t.name = lower($6)))
           and ($7::timestamptz is null or c.updated_at >= $7)
         order by rank desc, c.updated_at desc
         limit $8`,
        [req.principal.id, ws, qs.q, csv(qs.type) ?? null, qs.board ?? null, qs.tag?.replace(/^#/, '') ?? null, qs.since ?? null, qs.limit ?? 30],
      )).rows;
      out.push(...rows);
    }
    return out.sort((a, b) => b.rank - a.rank).slice(0, qs.limit ?? 30);
  });

  return app;
}

/** Cards in API shape, with placements limited to boards the principal can see. */
async function loadCards(q: Queryable, p: Principal, workspaceId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const rows = (await q.query(
    `with ${VISIBILITY_CTES},
     roles as (select * from card_roles($1, $2) where card_id = any ($3::text[]))
     select c.id, c.workspace_id as "workspaceId", c.type, c.title, c.display_title as "displayTitle", c.text, c.data, c.color, c.labels,
       c.created_by as "createdBy", c.updated_by as "updatedBy", c.created_at as "createdAt", c.updated_at as "updatedAt", c.deleted_at as "deletedAt",
       r.role, ${HOME_BOARD_SQL} as "homeBoardId", b.parent_board_id as "parentId", b.icon, b.cover,
       coalesce((select array_agg(t.name order by t.name) from card_tags ct join tags t on t.id = ct.tag_id where ct.card_id = c.id), '{}') as tags,
       coalesce((select json_agg(json_build_object('id', pl.id, 'boardId', pl.board_id, 'columnId', pl.column_id, 'order', pl.ord, 'x', pl.x, 'y', pl.y,
                                                   'w', pl.w, 'h', pl.h, 'z', pl.z, 'locked', pl.locked, 'tray', pl.tray) order by pl.created_at, pl.id)
                 from placements pl join vis on vis.card_id = pl.board_id where pl.card_id = c.id and pl.deleted_at is null), '[]') as placements
     from cards c join roles r on r.card_id = c.id left join boards b on b.id = c.id
     where c.id = any ($3::text[])
     order by c.created_at, c.id`,
    [p.id, workspaceId, ids],
  )).rows;
  return rows
    .filter((r) => atLeast(r.role, 'viewer'))
    // a board's parentId is its home board, which is null when the parent is hidden from the caller
    .map(({ parentId: _p, icon, cover, homeBoardId, ...r }) => (r.type === 'board' ? { ...r, data: { ...r.data, parentId: homeBoardId ?? null, icon, cover } } : r));
}
