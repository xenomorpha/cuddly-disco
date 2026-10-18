# Spec coverage

Status against the technical specification. **Done** = implemented and exercised in the browser or by unit tests. **Partial** = works with a stated limitation. **Not built** = out of scope for this client-only build.

## Acceptance criteria (§11.2)

| Criterion | Status | Notes |
| --- | --- | --- |
| Nested boards three levels deep, breadcrumbs + sidebar | Done | Demo: Home › Research › Interviews › Round 1 |
| `[[` autocomplete; link survives renaming and moving the target | Done | Links stored as `[[@uuid]]`; verified rename, move, trash/restore in the browser |
| Backlinks panel lists every source with a snippet; click navigates and highlights | Done | Grouped by board, filter + sort |
| Unlinked mentions, one-click convert | Done | On demand, capped at 50; ignores `#tags` and `@mentions` |
| Deleted target → broken links; restore repairs | Done | |
| Global graph shows everything the user can access; local graph follows selection at depth 1–5 | Done | |
| Graph filters (type, tag, board, orphans) and colour groups persist per user | Done | Stored in the workspace per user id; named views too |
| 5,000 nodes / 15,000 edges at 60 fps on a 2022 MacBook Air | **Not verified** | Built-in benchmark (Graph → Performance benchmark) measures it; needs a run on target hardware with the window visible. Renderer is Canvas 2D, not WebGL |
| Two users see each other's changes in < 300 ms, no lost edits | Partial | Real-time between tabs/windows of one browser (BroadcastChannel, ~instant). Cross-device needs the sync server. Concurrent edits to the *same field* are last-writer-wins, not CRDT-merged |
| A Viewer cannot see links, backlinks or graph nodes from boards they can't access | Done | Unit-tested (`graph.test.ts`) and checked in the browser by acting as Sam Lee |

## Feature areas

| Area | Status | Notes |
| --- | --- | --- |
| §3.1 Canvas behaviour | Done | Pan/zoom 10–400%, pinch, snap, guides, marquee, group move, copy/paste, duplicate, 200-step undo, lock, context menu, contextual toolbar, toolbar drag-to-place, trash target, breadcrumbs, back/forward, minimap |
| §3.2 Note, Document, To-do, Board, Column, Link, File, Table, Sketch, Swatch, Map, Comment, Line | Done | Rich text is Markdown-based (see below) |
| §3.2 Image | Partial | Upload/paste/drop/crop/caption done; Unsplash search needs your API key; background removal (phase 2) not built |
| §3.2 Link previews | Partial | oEmbed (noembed.com) for YouTube/Vimeo/Spotify etc.; arbitrary pages need a server-side fetcher (CORS) |
| §3.2 Video/Audio | Done | Via File card: inline players + in-browser audio recording |
| §4.1 Link forms `[[T]]`, `[[T\|alias]]`, `[[T#Heading]]`, `[[Board/T]]`, Create new, Link to… | Done | Drag-a-card-onto-text not built |
| §4.1 Cross-workspace links | N/A | Single workspace per browser |
| §4.2 Backlinks panel, badges, filter, sort | Done | |
| §4.3 Hover preview (400 ms), Cmd/Ctrl+click side-by-side, broken style | Done | |
| §4.4 Link index | Done | Client: derived index. Server: `links` table rebuilt per card inside the save transaction (150 ms SLA not benchmarked) |
| §5 Graph view (modes, nodes, edges, interaction, filters, colour groups, forces, saved views) | Done | |
| §5.3 Path finder (phase 2) | Done | |
| §5.5 Graph as a board card (phase 2) | Not built | |
| §5.6 WebGL renderer | Partial | Canvas 2D batched renderer + worker layout; WebGL (Sigma.js) is the next step if the benchmark misses target |
| §6 Sidebar, favourites, recent, shared, trash, move, shortcuts, tags, synced cards, Unsorted tray, quick switcher, search, templates | Done | |
| §6 OCR search (phase 2), web clipper extension | Not built | |
| §7 Roles, inheritance, overrides, invite, secret link + password + allow-duplicate | Partial | Enforced in the UI and in every derived view; real security needs server-side checks. Invites don't send email. Secret links only work in the same browser profile |
| §7 Comments, @mentions, notifications | Partial | In-app notifications; no email digest |
| §7 Activity feed, version history | Done | |
| §7 Presentation mode | Done | Card-by-card in reading order |
| §7 Export PNG/PDF/Markdown/ZIP+graph.json; import Markdown/Obsidian | Done | |
| §7 Live cursors, presence | Done (same browser) | |
| §8 Data model | Done (client) | Same entities: cards, placements, connectors, links (derived), tags, comments, permissions, share links, graph views, templates |
| §9 Backend: Postgres, link index, permissions, REST API | Done (server) | `server/`: Fastify + Postgres 17. SQL permission resolution and the link index are unit-tested for parity with the client modules |
| §9 Yjs/Hocuspocus, S3, Meilisearch, BullMQ, Auth | **Not built** | Search uses Postgres FTS; auth is dev bearer tokens + share-link headers; the client does not call the API yet |
| §10 Offline | Done | Everything is local; IndexedDB |
| §10 Accessibility | Partial | Keyboard navigation of cards, list view, ARIA roles/labels, reduced-motion; no formal WCAG audit |
| §10 i18n (EN + RU) | Done | Some toast messages from the data layer are still English-only |
| §10 Unit tests ≥ 80% on links/permissions | Done | ~99% lines on links, permissions, graph, formula |
| §10 OpenAPI | Done | Generated from the route schemas: `server/openapi.json`, `/docs` |
| §10 E2E (Playwright) | Not built | Flows were exercised manually in a browser |
| §11.4 Docker Compose | Done | `docker compose up` → Postgres + API with the seeded demo workspace |
| §11.4 CI, staging/production | Not built | |

## Deliberate deviations

- **Rich text is Markdown, not TipTap/ProseMirror.** Editing happens in a textarea with a formatting bar and live rendering; it supports every listed format and keeps `[[links]]` portable to Obsidian. A WYSIWYG editor can replace `WikiEditor` later without touching storage.
- **Cards render as DOM, not PixiJS.** Simpler text editing and accessibility; fine for hundreds of cards. The 2,000-card target (§10) has not been measured.
- **Sync is patch broadcast, not a CRDT.** Undo, sync and persistence all ride on immer patches. Swapping in Yjs is described in ARCHITECTURE.md.
