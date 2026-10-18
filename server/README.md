# Nodeboard server

Fastify + PostgreSQL API for the spec's server half (§8–§9): relational schema, link index, permission resolution in SQL, graph and backlinks endpoints. Real-time sync (Yjs/Hocuspocus) is **not** here yet; the browser client still runs local-first.

## Run it

```bash
docker compose up --build          # from nodeboard/: Postgres 17 on :5433 + API on :3000
```

On first start the server applies migrations and seeds the demo workspace **Studio** (`SEED_DEMO=1`). Docs are at <http://localhost:3000/docs> and the raw spec at `/openapi.json` (also committed as [openapi.json](openapi.json)).

| Principal | Header | Sees |
| --- | --- | --- |
| Ksenia (owner) | `Authorization: Bearer dev-ksenia` | everything |
| Alex (editor) | `Authorization: Bearer dev-alex` | everything, can edit |
| Sam (viewer) | `Authorization: Bearer dev-sam` | everything except *Private journal* (override `none`) |
| Casey (guest, not a member) | `Authorization: Bearer dev-casey` | *Research* subtree only, as commenter |
| Share link | `X-Share-Token: demo-moodboard` | *Moodboard* only, read-only |

```bash
curl -s -H 'Authorization: Bearer dev-sam' localhost:3000/workspaces/ws-studio/graph
curl -s -H 'Authorization: Bearer dev-sam' localhost:3000/cards/c-insight/backlinks
```

Without Docker (needs a Postgres): `npm install`, then `DATABASE_URL=postgres://… SEED_DEMO=1 npm run dev`.

## Tests

```bash
npm test     # vitest; runs real Postgres in-process via PGlite, no Docker needed
```

- `test/permissions.test.ts`: the SQL functions `board_role`, `board_roles`, `card_role` and `card_roles` must give the same answer as `src/model/permissions.ts` for every (principal, board/card) pair. Checked on the client's own test fixture, the demo workspace, cycles, disabled links and stacked overrides. `live_cards` is checked against the client index.
- `test/linkIndex.test.ts`: link rows (id, anchor, alias, field, unresolved and broken targets, to-do items, comments), tags and display titles must match the client index for every live card. Also covers re-indexing on save and on comment edit/delete.
- `test/api.test.ts`: the endpoints on the seeded workspace as each principal: graph filters, backlinks, writes, sharing, search and mentions.

## Layout

| File | |
| --- | --- |
| `sql/001_schema.sql` | Tables (spec §8) and the permission / liveness functions |
| `src/linkIndex.ts` | Link-index job: re-parses a card with the client's `parseLinks()` / `textFields()` and replaces its `links` and `card_tags` rows inside the save transaction |
| `src/graph.ts` | `GET /workspaces/:id/graph`, the server version of `buildGraph()` |
| `src/backlinks.ts` | `GET /cards/:id/backlinks` and `/mentions` |
| `src/access.ts` | Request-level checks. A missing permission returns 404, never 403, so restricted ids can't be probed |
| `src/app.ts` | Routes and JSON schemas; the schemas also generate the OpenAPI document |
| `src/importWorkspace.ts` | Loads a client `Workspace` document (IndexedDB / JSON export) into the tables (`npm run import -- workspace.json`) |
| `src/seed.ts` | Demo workspace with fixed ids |

The server imports `../src/model/{links,index,graph,permissions,types}.ts` directly, so the client and the server parse links the same way. Those modules have no browser dependencies. The Docker image copies `src/model` for this reason, which is why the build context is the repo root.

## Rules and deliberate choices

- **Permissions** follow `permissions.ts` exactly:
  - The workspace owner gets `owner` everywhere.
  - A `link:<token>` principal gets `viewer` on the shared board's subtree.
  - Anyone else gets the nearest override walking up the board tree, then their workspace role, then `none`.
  - A card gets the best role over its live placements. An unplaced card follows the root board.
  - `board_roles()` / `card_roles()` resolve a whole workspace in one recursive CTE. The scalar versions are for single checks.
- **Leaks closed beyond the client:**
  - A board's `parentId` / `boardId` is `null` when the parent is hidden.
  - Snippets render links to hidden cards as "missing".
  - Search text (`plain_text`) never contains a link target's title.
- **Ids are `text`.** The client generates UUIDs, but link targets can be broken references, and imported documents can carry any string.
- **Timestamps are ISO strings in the API.** The client model uses epoch ms; graph nodes keep `updatedAt` in ms to match `GNode`.
- **Auth is a stand-in.** Bearer tokens are stored as sha256 hashes in `api_tokens`, and share-link passwords use scrypt. A real auth provider only has to map a request to a user id.
- **Search is Postgres full-text search** (`tsvector` over `display_title` + `plain_text`). Meilisearch can replace it behind the same endpoint.

## Not built yet

- Yjs/Hocuspocus sync (`WS /sync`), and switching the client to call this API.
- Assets: there is an `assets` table but no S3 upload, so no `POST /assets`.
- The BullMQ link-preview fetcher.
- Email invites.
- Real auth.

Known edge: `display_title` uses the client rule that a card whose first line is a link shows the target's title. Like in the client, that title is visible to anyone who can see the source card.
