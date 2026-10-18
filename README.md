# Nodeboard

A visual board app (Milanote-style canvas) with bidirectional `[[wiki-links]]`, a backlinks panel and an interactive graph view. Built from *Visual Board App with Backlinks & Graph View — Technical Specification* (Oct 18, 2026).

This is a **local-first web client**: every feature runs in the browser, data lives in IndexedDB, and tabs/windows on the same machine sync in real time. The server half lives in [server/](server/README.md): Postgres schema, link index, SQL permissions, graph/backlinks API, OpenAPI and `docker compose up`. The client does not use it yet, and real-time sync (Hocuspocus), S3, Meilisearch and real auth are **not built** — see [docs/SPEC-COVERAGE.md](docs/SPEC-COVERAGE.md) for exactly what is and isn't covered, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the client maps onto the planned backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # unit tests (links, permissions, graph, formulas, i18n)
npm run test:coverage
npm run build      # strict typecheck + production build in dist/
```

### macOS app (.dmg)

`src-tauri/` wraps the same web build in a native window (Tauri 2). On GitHub, **Actions → Build macOS app → Run workflow** builds a universal `.dmg` and attaches it to a Release named after the version in `src-tauri/tauri.conf.json`; bump that version for the next release. Locally (needs Rust from rustup.rs): `npm run app`. The app is ad-hoc signed, not notarized: on first launch use System Settings → Privacy & Security → **Open Anyway**.

### Publish on GitHub Pages (installable app)

Push the `nodeboard/` folder as the root of a GitHub repository and set **Settings → Pages → Source** to **GitHub Actions**. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) then tests, builds and publishes every push to `main` at `https://<user>.github.io/<repo>/`. The page ships a web manifest and a service worker, so it can be installed as an app (Chrome/Edge: install icon in the address bar; Safari: File → Add to Dock; iPhone: Share → Add to Home Screen) and starts offline. Data stays in each browser's IndexedDB; the `server/` API is not deployed by this workflow.

Node 20+ is required. The first launch seeds a demo workspace ("Studio") that exercises every feature; **Settings → Import & export → Reset to demo workspace** brings it back.

## What to try

| Try this | Where |
| --- | --- |
| Type `[[` in a note — autocomplete over cards and boards; choose **Create "…"** to make a new note in the board's *Unsorted* tray | any note, to-do item, table cell, caption or comment |
| `[[Title#Heading]]`, `[[Title\|alias]]`, `[[Board/Title]]` | e.g. the *People think spatially* note links to `Product brief#Goals` |
| Hover a link for 400 ms → preview. **Cmd/Ctrl+click** → side-by-side | any link |
| Select a card, **Cmd/Ctrl+Shift+B** → linked references (grouped by board, with snippets) and unlinked mentions with a one-click **Link** button | Research → *People think spatially*, or Home → Moodboard |
| Rename a card: links follow. Delete it: links turn red (broken). Restore it from Trash: links are repaired | sidebar → Trash |
| **Cmd/Ctrl+G** → global graph with filters, colour groups, forces, saved views, path finder and a 5k/20k-node benchmark | |
| Local graph docked on the right, follows the selection, depth 1–5 | top bar → local-graph icon |
| Avatar menu (top right) → act as **Sam Lee (viewer)**: the *Private journal* board, its backlinks and its graph nodes disappear | |
| Open the app in a second tab: live cursors, presence avatars and instant sync | |
| `?` → all keyboard shortcuts | |

## Feature overview

- **Canvas:** infinite pan/zoom (10–400%, pinch, Cmd/Ctrl+scroll, space-drag, zoom to fit), marquee + shift-click selection, group move, alignment guides, snap-to-grid, copy/paste/duplicate, 200-step undo/redo, lock, context menu, contextual toolbar, drag-to-trash, breadcrumbs, back/forward, minimap, presentation mode, screen-reader list view.
- **Cards:** note, document (full-screen editor with outline), to-do (due dates, assignees, drag reorder), board (nested without limit), column (drag in/out, collapse, group selection, Cmd/Ctrl+Enter duplicate), image (upload/paste/drop, caption, crop, Unsplash search with your key), link (YouTube/Vimeo/Spotify embeds, oEmbed titles), file (any type, PDF/audio/video/text preview, in-browser audio recording), table (typed columns + `SUM/AVERAGE/MIN/MAX/COUNT` and arithmetic), sketch (pen/highlighter/eraser, pressure), colour swatch (HEX/RGB/HSL, eyedropper, palette from board images), map (OpenStreetMap + address search), comment threads, board shortcuts, connectors (curved/straight, arrows, colour, dashed, label).
- **Links & backlinks:** links stored by UUID; editor shows titles; heading anchors; aliases; broken/unresolved/restricted link states; tag pages; backlink count badges.
- **Graph:** Web-Worker force layout (d3-force), batched canvas renderer, node size by degree, link/connector/containment/tag edges, filters (type, board subtree, tag, author, date, text), toggles, colour-group rules (`tag:x`, `type:note`, `board:Name`, text), force sliders, reset/unpin, saved named views per user, shortest-path finder, search & zoom-to-match.
- **Organisation:** sidebar tree, favourites, recent, shared-with-me, tags, Unsorted tray, move to board (drag onto a board card or sidebar item), synced cards (one card, many boards), quick switcher (Cmd/Ctrl+K), full-text search with filters (Cmd/Ctrl+Shift+F), 6 starter templates + save-board-as-template, 30-day trash.
- **Collaboration (local):** roles (owner/editor/commenter/viewer) inherited down the board tree with per-board overrides, invite by email (recorded, no email sent), secret read-only links with optional password and duplicate permission, comments with @mentions and in-app notifications, activity feed, per-card version history with restore.
- **Export / import:** board → PNG / PDF, card → Markdown, workspace → ZIP (Markdown with `[[links]]` + assets + `graph.json` + full backup), import a Markdown folder / Obsidian vault (folders → boards, `[[links]]` → links) or a backup.
- **i18n:** English and Russian (Settings → Language); a test fails if any UI string lacks a translation.

## Project layout

```
src/
  model/        data model, store (undo, sync, persistence), link parser, link index,
                permissions, graph builder, formulas, templates, seed data, export/import
  components/   canvas, card types, panels, graph view, dialogs
  graph.worker.ts   force layout off the main thread
  locales/ru.json
server/         Fastify + Postgres API (schema, link index, SQL permissions, graph, OpenAPI)
docs/           architecture, spec coverage
docker-compose.yml  Postgres + server
```
