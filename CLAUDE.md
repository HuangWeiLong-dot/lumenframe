# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LUMENFRAME — a movie/TV detail-page SPA that aggregates metadata, ratings, cinematography specs, streaming availability, torrents, subtitles and screenshots, and renders shareable poster cards via Canvas. Three independent services in one repo; there is no monorepo tooling and no shared package.

Comments, docs, and commit messages are in Chinese — match that when editing existing code.

## Running it

Each service runs in its own terminal. Both backends are needed for full functionality; the UI hides any section whose backend is absent.

```bash
npm run dev --prefix server          # Node API → :3002 (node --env-file=.env --watch index.js)
npm run dev --prefix web             # Vite → :5173, proxies /api → :3002, /filmgrab → :8000/api
```

```powershell
.\filmgrab-service\start.ps1         # Python FastAPI → :8000 (creates .venv, installs deps,
                                     #   probes 127.0.0.1:7890 and sets HTTP(S)_PROXY if open)
```

`web/vite.config.js` is the only place the dev-proxy topology is defined. In production Nginx replaces it (`docs/deploy.md` §4.3) — the rewrite `/filmgrab/*` → `:8000/api/*` must be reproduced there.

**Build** (there is no test runner or linter configured anywhere in this repo):

```bash
npm run build --prefix web           # → web/dist
BASE_PATH='/repo/' npm run build --prefix web   # GitHub Pages project-site subpath (build-time env, not VITE_*)
```

`web/dist` is served as static files; the CI workflow `.github/workflows/deploy-pages.yml` builds and publishes it on pushes touching `web/**`, reading repo Variables `API_BASE` / `FILMGRAB_BASE` / `BASE_PATH`.

**The backends deploy by pull, not by push.** `deploy/` holds `lumenframe-deploy.sh` plus a systemd oneshot service/timer that runs on the box: it polls `origin/main` every 2 minutes and, only when the commit changed, resets the checkout, reinstalls deps, restarts `lumenframe-server` / `lumenframe-filmgrab` and polls both ports. A deploy is only recorded as successful (in `/var/lib/lumenframe-deploy/last-deployed`) after the ports answer, so a failed install is retried on the next tick instead of stranding the new code on the server. There is deliberately **no** SSH deploy workflow — the host's security group never opened port 22, and exposing root SSH to GitHub's runner pool to save two minutes isn't a trade worth making. The unit copies the script to `/run` before executing it because the script `git reset --hard`s the very tree it lives in.

**Env files** (all gitignored): `server/.env` (`TMDB_API_KEY` required; `TMDB_PROXY` only for restricted networks like China; `PORT`), `filmgrab-service/.env` (`YOUTUBE_API_KEY`, optional `PYTORRENT_API_KEY`, `HTTP_PROXY`/`HTTPS_PROXY`, `PROXY_CONCURRENCY`). `web/` has no runtime env — only build-time `VITE_API_BASE` / `VITE_FILMGRAB_BASE` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (see `web/.env.example`). CI enumerates each one by name in the build step's `env:` block — a new `VITE_*` var stays `undefined` in the Pages build until a matching line **and** a repo Variable exist. `node-version` there must stay ≥ 22 (`@supabase/supabase-js` requires it).

## Architecture

### Service boundaries

| Service | Port | Owns |
| --- | --- | --- |
| `web/` | 5173 dev | React 19 + Vite + Tailwind v4 SPA |
| `server/` | 3002 | Everything TMDB-centric: search, details, images, ratings, specs, watch availability, TVmaze shows, subtitles |
| `filmgrab-service/` | 8000 | FilmGrab screenshots, YouTube trailers/comments, torrent search (16 sites) |

The split is deliberate, not incidental: anything requiring browser-TLS impersonation, Python scraping libs, or that must not be publicly deployed lives in `filmgrab-service/`. `server/index.js` handles only what plain `fetch` + API keys can do.

`server/api/index.js` re-exports the Express app for serverless hosting (`server/vercel.json` was removed from the working tree; the documented paths now are Linux+Nginx and GitHub Pages+separate API host).

`Torrent-Api-py/` is a standalone upstream checkout kept for reference. Its `routers/`, `torrents/`, `helper/`, `constants/` are **vendored verbatim** into `filmgrab-service/` — the `.py` files are byte-identical. Fixing a torrent scraper means editing the copy under `filmgrab-service/`, not the upstream tree.

### Frontend (`web/src`)

- **Router**: no React Router. `App.jsx` hand-rolls the History API: `/movie/{tmdbId}-{slug}`, `/tv/{tvmazeId}-{slug}`, `/person/{id}-{slug}`, `/genre/{kind}/{id}-{slug}`, `/library`. `id` is authoritative, slug is cosmetic. `BASE_PATH` is derived at runtime from `location.pathname` (`getBasePath()`) so deep links work both at `/` and `/<repo>/`.
- **GitHub Pages 404 dance**: `web/public/404.html` encodes the original path into `_spa=` and bounces to the root; an inline script in `index.html` and `resolveSpaRedirect()` in `App.jsx` unwrap it (recursively, up to 20 levels) before React mounts. Break one and deep links 404-loop.
- **i18n** (`web/src/i18n/`): custom, not react-i18next. `useSyncExternalStore` over a module-level `lang` + `localStorage['lumenframe:lang']`. Two facts matter: `t()` falls back to English then warns on a missing key (so add keys to **both** `en.js` and `zh.js`), and `apiLang()` is the non-reactive accessor used by `api.js` while `useI18n().apiLang` is the reactive one components put in effect deps.
- **Data fetching**: plain `fetch` in `useEffect`. **Do not use `AbortController`** — React 19 StrictMode double-mounting produces `net::ERR_ABORTED` console noise. The house pattern is `const t = setTimeout(0, …)` + an `alive` flag that discards stale responses, and a 15s `Promise.race` timeout in `Torrents.jsx`.
- **Sections**: every detail-page block is wrapped in `CollapsibleSection` and receives `key={movie.id}` so switching titles fully resets state. When a service is unconfigured or errors, the section returns `null` rather than an error state.
- **Cards** (`Card.jsx` + `canvas-utils.js`, driven by `CardStudio.jsx`): Canvas is repainted imperatively from React state (`preview ≡ export`, no DOM screenshotting). 5 templates × 5 aspect ratios. Image loading goes through `web/src/imageQueue.js` (global 8-slot concurrency gate) to avoid saturating the image proxy.
- **Persistence**: `useLibrary.js` (watched / watchlater / likes / notes + Chart.js stats) and `usePinned.js` (pins) are `useSyncExternalStore` stores over localStorage. Keys are namespaced `lumenframe:*`, with a `storage` listener for cross-tab sync. Movies (TMDB ids) and shows (TVmaze ids) share a numeric space — entries are keyed `` `${kind}:${id}` `` and legacy rows without `kind` are migrated to `movie` on read. Every read/write is wrapped in try/catch (see `web/src/storage.js`) because localStorage can be disabled outright. Note the `-change` window events (`lumenframe:library-change`, `lumenframe:lang-change`) are **listen-only** — nothing in the repo calls `dispatchEvent`, so the `subscribe` fan-out for them is dead; build on the exported `subscribe*` functions instead.
- **Pin cap**: `MAX_PINS = 6` is enforced at **render** time (`usePinned` returns `store.slice(0, MAX_PINS)`), never at write time. Slicing on write would make pinning a 7th title look like a user deletion to the sync layer, which then tombstones it and lets a second device push it back.
- **Cloud sync (optional, Supabase)**: email+password auth plus multi-device sync of the library, client-only — the browser talks to Supabase directly with a publishable key, and RLS is the entire security boundary. **Neither backend is involved.** `web/src/supabase.js` is the config switch: when `VITE_SUPABASE_URL`/`_PUBLISHABLE_KEY` are absent the whole feature self-hides (no account button, no requests, and supabase-js stays in an unloaded chunk — same rule as `FILMGRAB_BASE === ''`). `web/src/sync/engine.js` runs a full pull → merge → push cycle; `sync/projection.js` and `sync/merge.js` are pure and are exercised by `node web/scripts/check-sync.mjs`.
  - **`getSupabase()` must stay lazy.** `App.jsx`'s `resolveSpaRedirect()` is module-scope code that runs *after* its imports are evaluated; a `createClient` in a module body would consume `window.location` before `_spa` is unwrapped, and the email-callback session would silently never establish.
  - **The synced projection excludes `ratings`.** It is a re-fetchable third-party cache that `loadRatings` (every detail-page visit) and `refreshAllRatings` rewrite constantly; syncing it would republish titles on every page view.
  - **Deletes are tombstones** (`deleted_at`), and the local half lives in `lumenframe:sync:meta` as `{ [listKey]: { ts, deleted? } }`. Timestamps are recorded by a subscriber at the moment a store changes — never derived from the entry shape. Seeding uses `addedAt` so pre-existing entries don't all look newer than the cloud.
  - **`likes` are addressed by `entry.type`, not `entry.kind`** — a genre like carries the movie/tv kind it belongs to, so keying on `kind` collapses every movie-genre like into one row.
  - **Take every local snapshot *after* the network round-trip.** `syncNow` awaits `pull()`; reading `currentLocal()`/`project()`/`meta.meta` before that await and writing the result back wholesale erases anything the user did in between — and worse, pairs a *fresh* timestamp with *stale* content, which last-write-wins then pushes to the cloud as authoritative.
  - **Write meta back per key** (`applyMetaWriteBack`), never by wholesale assignment: the recorder may have logged a tombstone during `push()`, and clobbering it silently resurrects the deleted item on the next cycle.
  - **`sync:meta`'s `scope` may only be discarded when it names a *different* account.** `scope === null` means guest data the user is now adopting; dropping its tombstones would undo deletes made before signing in.
  - **The username is a display name in `auth.users.raw_user_meta_data`**, written at signup via `options.data` and edited with `updateUser({ data })` (which merges, not replaces). Deliberately **not** a `profiles` table: no uniqueness is wanted, so there is no unique index and no duplicate-name race to handle. Moving to a real handle later means a table + unique index + migration.
  - **Never put a secret/service_role key in `web/`.** Schema (table, RLS policy, index) is `supabase/schema.sql`, run once by hand in the Supabase SQL editor.

### Node backend (`server/`)

`index.js` is the TMDB proxy + routers; scrapers live in sibling modules — `ratings.js` (OMDB + Rotten Tomatoes Popcornmeter), `sow.js` (ShotOnWhat? tech specs), `tastedive.js`, `tvmaze.js`, `subtitles.js` (OpenSubtitles), `rt.js`, `titlematch.js`.

- **Language**: every text endpoint takes `?lang=`; `reqLang()` whitelists `en-US|zh-CN|zh-TW` and collapses other `zh*` to `zh-CN`. Cache keys are language-scoped via `lk()` (`movie:157336:zh-CN`) — omitting it lets English and Chinese responses overwrite each other. Endpoints deliberately hard-pinned to `en-US`: all TVmaze, TasteDive, ShotOnWhat, Rotten Tomatoes, and `/api/trailer` (ranking depends on the English "Official Trailer" label). Watched: `englishTitleByImdb` / `englishTitleByTmdbId` resolve non-ASCII titles back to English before calling those services.
- **Caching**: `cached(key, fetcher)` is a 30-min in-memory `Map` (FIFO, 200 entries) with single-flight dedup via `inFlight`, so concurrent cold requests hit upstream once. Scraped ratings/specs persist to files under `server/.cache/` (gitignored, auto-redirected to `/tmp` on serverless); edit `CACHE_VERSION` in those modules to invalidate a schema change.
- **Images**: `/api/image?path=&s=` proxies `image.tmdb.org`. There is **no** server-side binary cache by design (w1280/original can be megabytes) — only `imgInFlight` dedup plus `Cache-Control: immutable` for the browser. `setDefaultResultOrder('ipv4first')` exists because IPv6-less cloud hosts make `fetch` fail outright.

### Python service (`filmgrab-service/`)

`main.py` holds the FastAPI app plus the FilmGrab routes; `filmgrab_scraper.py` and `youtube_service.py` are the scrapers. Everything else under `routers/`, `torrents/`, `helper/`, `constants/` is the vendored Torrent-Api-py code, mounted under `/api/torrent/v1/*` and gated by `authenticate_request` (which is a no-op unless `PYTORRENT_API_KEY` is set).

- FilmGrab returns 403 to ordinary clients — `curl_cffi` with `impersonate="chrome"` is load-bearing, not an optimization. Title matching uses a 0.85 similarity threshold with year hard-reject and Roman-numeral normalization (`titlematch.js` on the Node side mirrors this intent, different implementation).
- `/api/proxy` is whitelisted to `film-grab.com` `/wp-content/uploads/` paths, with `asyncio.Semaphore(PROXY_CONCURRENCY)` limiting upstream concurrency.
- In-memory caches: screenshots 6h, image binaries 1h LRU/120, trailers 7d, comments 1d.
- **Personal use only** — FilmGrab prohibits scraping. Bind to `127.0.0.1`, never expose :8000. Public deployments should simply not run this service; the Film Stills section self-hides when `FILMGRAB_BASE` is empty.

## Cross-cutting gotchas

- **Anything that queries an English-only upstream by title must use `movie.title_en || movie.title`**, never the localized `movie.title`. This applies to torrent search, OpenSubtitles, ShotOnWhat, Rotten Tomatoes, TasteDive, and IMDb-keyed lookups — i.e. every external service except TMDB itself. `title_en` is only emitted by `/api/movie/:id` (movies); TV payloads come from TVmaze and are already English, so the `|| movie.title` fallback is a real code path, not defensive noise. Because `title_en` is language-independent, such a component also won't re-fetch (and won't clear its results) when the UI language changes.
- **Canvas export requires proxied images.** TMDB and TVmaze images must be loaded through `/api/image` and `/api/tv/image` with `crossOrigin="anonymous"`; pointing an `<img>` at `image.tmdb.org` directly makes the canvas tainted and silently breaks card export. Both backends emit `Access-Control-Allow-Origin: *` for the cross-domain (GitHub Pages + separate API) deployment.
- **`FILMGRAB_BASE` semantics**: dev defaults to `/filmgrab` (Vite proxy), production defaults to `''` = disabled section. Distinct from `API_BASE`, which is `''` = same-origin in dev.
- **The Node and Python trailer endpoints are different things**: `/api/trailer/{tmdbId}` (Node, TMDB video keys, free) supplies the initial key; the Python `/api/trailer` is the YouTube Data API path used for comments. YouTube quota is 10k units/day with `search.list` costing 100 — hence the 7-day trailer cache.
- `docs/` is gitignored, so it is local-only documentation that will not appear in a fresh clone. It is nonetheless the authoritative reference: `docs/api-reference.md` (every endpoint with shapes), `docs/tech-stack.md` (data sources + full cache table), `docs/deploy.md` (Nginx/systemd/Pages), and `docs/*.md` design notes for individual features.
- A `?? .trae/documents/` directory holds older design notes for in-flight work.
