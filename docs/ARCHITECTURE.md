# Architecture

## Today: a local-first client

```
 React components ──read──▶ Zustand store { doc: Workspace, ui, past/future, peers }
        │                         ▲
        └── actions.ts ── commit(label, recipe) ── immer produceWithPatches
                                  │
             ┌────────────────────┼─────────────────────────┐
             ▼                    ▼                         ▼
     undo/redo stack      BroadcastChannel            IndexedDB (debounced)
     (inverse patches)    → other tabs apply patches  workspace + asset blobs
```

- **One document per workspace** (`model/types.ts`). It mirrors the relational model of spec §8: `cards` (content) are separate from `placements` (where a card sits), so one card can live on several boards (synced cards). Boards are cards of type `board` with `data.parentId`.
- **Every edit is a commit.** `commit()` runs an immer recipe and gets forward and inverse patches. Inverse patches give undo (200 steps; rapid edits to the same field merge into one step). Forward patches are broadcast to other tabs and the document is saved to IndexedDB 400 ms later.
- **Derived indexes** (`model/index.ts`) are rebuilt per document snapshot: placements by board/card, live boards, title resolution, the backlink index, outgoing links and tags. Per-card parse results are cached by object identity — immer keeps unchanged cards identical, so an edit re-parses one card.
- **Links** (`model/links.ts`) are stored as `[[@uuid#anchor|alias]]`. The editor converts to `[[Title]]` on open and back on every keystroke, keeping the previous id for untouched references, so renames and duplicate titles are safe.
- **Permissions** (`model/permissions.ts`) are resolved per viewer: owner → nearest board override up the tree → workspace role. Every derived view (sidebar, search, backlinks, graph, link rendering) asks `access.canSee(id)`, so restricted content never leaks.
- **Graph** (`model/graph.ts`) builds `{nodes, edges}` exactly like the planned `GET /workspaces/:id/graph`. Layout runs in `graph.worker.ts` (d3-force, manual ticks, positions streamed back as a transferable `Float32Array`); `GraphCanvas.tsx` draws batched paths with viewport culling.

## Moving to the spec's server architecture (§9)

**Status:** the server half now lives in [`server/`](../server/README.md): the Postgres schema, the link-index job, permission resolution in SQL, graph/backlinks/mentions/search/sharing endpoints, an OpenAPI document and Docker Compose. Unit tests check that the SQL permission functions and the link index agree with the client modules. Still to do: Yjs/Hocuspocus sync, moving the client onto the API, S3 assets, the BullMQ link-preview job, and real auth.

| Client piece | Server counterpart |
| --- | --- |
| `commit()` patches + BroadcastChannel | Yjs document per board, synced through Hocuspocus over WebSocket; `y-indexeddb` keeps offline support. Replace the `doc` slice with Y.Maps keyed by id (`cards`, `placements`, `connectors`) — the actions layer keeps its API. |
| `getIndex()` backlinks | **Built** (`server/src/linkIndex.ts`). On save, the server parses card text with the same `parseLinks()` and upserts the `links` table (`source_card_id, target_id, target_anchor, alias`), indexed on `target_id`. `model/links.ts` has no browser dependencies and can be shared. |
| `makeAccess()` | **Built** (`board_roles()` / `card_roles()` in `server/sql/001_schema.sql`). Same resolution in SQL (recursive CTE over `boards.parent_board_id` + `permissions`), checked on every API and sync request. |
| `buildGraph()` | **Built** (`server/src/graph.ts`). `GET /workspaces/:id/graph?root=&center=&depth=&types=&tags=` → `{nodes:[{id,type,title,boardId,degree}], edges:[{source,target,kind}]}` |
| Search dialog | `GET /search` on Postgres FTS over `plain_text` today; Meilisearch later |
| IndexedDB asset blobs | S3 + signed URLs; `assetId` stays the key |
| `fetchLinkPreview()` | BullMQ job fetching OpenGraph data server-side |

### Proposed endpoints

```
GET    /workspaces/:id/graph?root=&depth=&types=&tags=
GET    /cards/:id/backlinks?sort=board|date&q=          -> [{ sourceId, boardId, snippet, anchor }]
GET    /cards/:id/mentions                               -> unlinked mentions (FTS on title, limit 50)
GET    /search?q=&type=&board=&tag=&since=
GET    /boards/:id/permissions        PUT /boards/:id/permissions/:userId
POST   /boards/:id/share-link         PATCH /share-links/:token
POST   /assets (multipart) -> { assetId, url }
WS     /sync  (Hocuspocus, one Yjs doc per board)
```

All of these are implemented except `POST /assets` and `WS /sync`, together with `GET/PUT/DELETE /cards/:id`, `GET /boards/:id`, comments and graph views. The schema is in [server/openapi.json](../server/openapi.json), served live at `/docs`.

## Testing hooks

In dev builds `window.__nb` exposes `{ useStore, actions, getIndex }` for browser automation (Playwright E2E can drive flows and assert on the store).
