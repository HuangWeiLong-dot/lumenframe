# LUMENFRAME Tech Stack

This document describes the technology stack, data acquisition pipeline, and API usage patterns of LUMENFRAME — a movie card generator that aggregates metadata, ratings, trailers, screenshots, streaming availability, and torrent resources into a single detail page.

For the full endpoint reference, see [api-reference.md](./api-reference.md).

---

## 1. Architecture Overview

```text
┌──────────────────────────────────────────────────────────┐
│                     Browser (User)                        │
│              React 19 + Vite (port 5173 dev)              │
└────────────────────┬───────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │  Vite Dev Proxy /     │
         │  Nginx (production)   │
         └────────┬──────────┬────┘
                  │          │
     /api/*       │          │  /filmgrab/*
     (port 3002)  │          │  (port 8000 → /api/)
                  ▼          ▼
         ┌──────────────┐  ┌───────────────────────┐
         │ Node.js +    │  │ Python + FastAPI      │
         │ Express      │  │ (filmgrab-service)    │
         │              │  │                       │
         │ TMDB proxy   │  │ FilmGrab screenshots   │
         │ Image proxy  │  │ Image proxy            │
         │ Ratings      │  │ YouTube trailer search │
         │ Tech specs   │  │ YouTube comments       │
         │ Watch avail. │  │ Torrent search (16 sites) │
         └──────┬───────┘  └──────┬────────────────┘
                │                 │
     ┌──────────┴───────┐        │
     │ External APIs     │        │
     │ - TMDB            │        ├── FilmGrab (scraped)
     │ - OMDB            │        ├── YouTube Data API v3
     │ - Watchmode       │        └── 16 torrent sites (scraped)
     │ - ShotOnWhat?     │
     └──────────────────┘
```

### Service Summary

| Service | Stack | Port | Responsibilities |
| --- | --- | --- | --- |
| `web/` | React 19 + Vite 7 + Tailwind CSS v4 | 5173 (dev) / static (prod) | Frontend SPA; movie search, detail page, card studio |
| `server/` | Node.js + Express + undici | 3002 | TMDB data proxy, image proxy, ratings, tech specs, watch availability |
| `filmgrab-service/` | Python 3.8+ + FastAPI + uvicorn | 8000 | FilmGrab screenshots, YouTube trailers/comments, torrent search |

### Frontend Stack

| Technology | Version | Purpose |
| --- | --- | --- |
| React | 19 | UI framework |
| Vite | 7 | Dev server + build tool |
| Tailwind CSS | v4 | Styling (via `@tailwindcss/vite` plugin) |
| History API | — | Minimal router (no React Router): `movie/{id}-{slug}` format |

### Backend Stack

| Technology | Version | Purpose |
| --- | --- | --- |
| Node.js | 22+ | JS runtime |
| Express | 4.x | HTTP server |
| undici | — | ProxyAgent for TMDB access through Clash proxy |
| Python | 3.8+ | Runtime for filmgrab-service |
| FastAPI | 0.110+ | HTTP framework |
| uvicorn | 0.27+ | ASGI server |
| curl_cffi | 0.7+ | Chrome TLS fingerprint for FilmGrab scraping |
| aiohttp | 3.9+ | Async HTTP for torrent site scraping |
| cloudscraper | 1.2.71+ | Cloudflare bypass for torrent sites |
| beautifulsoup4 | 4.12+ | HTML parsing |

---

## 2. Data Sources & Acquisition

### 2.1 TMDB (The Movie Database)

**Primary data source** for all movie metadata: search, details, cast/crew, images, trending, and trailer keys.

| Aspect | Detail |
| --- | --- |
| API | `https://api.themoviedb.org/3` |
| Auth | API key (`TMDB_API_KEY`), passed as `api_key` query parameter |
| Language | `en-US` (forced for all requests) |
| Image CDN | `https://image.tmdb.org/t/p/{size}{path}` |
| Rate limit | 50 requests/minute (free tier) |
| Proxy | `TMDB_PROXY` env var → undici `ProxyAgent` (for China network) |

**Endpoints used by the backend:**

| TMDB Endpoint | Backend Route | Cache |
| --- | --- | --- |
| `/search/movie` | `/api/search` | 30 min in-memory |
| `/movie/{id}?append_to_response=credits` | `/api/movie/:id` | 30 min |
| `/movie/{id}/images` | `/api/movie/:id/images` | 30 min |
| `/trending/movie/week` | `/api/trending` | 30 min |
| `/movie/{id}/videos` | `/api/trailer/:tmdbId` | 30 min |

**Caching strategy:** In-memory `Map` with 30-minute TTL, FIFO eviction at 200 entries. Single-flight deduplication (`inFlight` map) prevents thundering herd when multiple requests arrive for the same cold key.

**Image proxy:** TMDB images are proxied through `/api/image?path={path}&s={size}` to solve two problems:
1. Network restrictions: `image.tmdb.org` is blocked in China without a proxy.
2. html2canvas cross-origin: the canvas export requires same-origin images. `crossOrigin="anonymous"` is set on `<img>` tags.

Image proxy does **not** cache binary data (too large for memory). Instead, it deduplicates concurrent requests for the same image via `imgInFlight`, and relies on `Cache-Control: immutable` for browser-side caching.

---

### 2.2 OMDB API

**Third-party ratings** for IMDb, Metacritic, and Rotten Tomatoes (Tomatometer).

| Aspect | Detail |
| --- | --- |
| API | `https://www.omdbapi.com/` |
| Auth | `OMDB_API_KEY` query parameter |
| Query | `?i={imdbId}&apikey={key}` (lookup by IMDb ID) |

**Response parsing:**
- `imdbRating` → `imdb` (float, 1 decimal)
- `Metascore` → `metacritic` (integer)
- `Ratings[].Source === "Rotten Tomatoes"` → `rotten_tomatoes` (integer, stripped `%`)
- Missing/unavailable values become `null` — no fabrication.

---

### 2.3 Rotten Tomatoes (Popcornmeter)

**Audience score** scraped via `server/rt.js` (separate from OMDB's Tomatometer).

The Popcornmeter is not available via OMDB. When the user requests ratings for a movie, the backend queries the RT website directly to extract the audience score. This is a supplementary scraping step that runs alongside the OMDB call.

**File cache:** `server/.cache/ratings/{imdbId}.json` — permanent on success, with a `CACHE_VERSION` field that invalidates old cache when schema changes. Failed requests are cached in-memory for 10 minutes.

---

### 2.4 Watchmode API

**Streaming availability** (where to watch) via Watchmode.

| Aspect | Detail |
| --- | --- |
| API | `https://api.watchmode.com/v1` |
| Auth | `WATCHMODE_API_KEY` query parameter |
| Flow | (1) Search by TMDB ID → get Watchmode title ID; (2) Fetch sources for that title |

**Two-step process:**
1. `GET /search/?apiKey={key}&search_field=tmdb_movie_id&search_value={tmdbId}`
2. `GET /title/{wmId}/sources/?apiKey={key}` → returns all streaming sources

**Deduplication:** Same platform may appear multiple times (e.g., Netflix sub + Netflix free). The backend keeps only the highest-priority type per platform name: `sub` > `free` > `rent` > `buy` > `tve`.

If `WATCHMODE_API_KEY` is not set, returns `{sources: []}` gracefully.

---

### 2.5 ShotOnWhat?

**Cinematography technical specs** (camera, lenses, film format, etc.).

| Aspect | Detail |
| --- | --- |
| Source | ShotOnWhat? website |
| Lookup | By IMDb ID + title + year |
| Auth | None (scraped) |

**File cache:** `server/.cache/sow/{imdbId}.json` — permanent on success. Failed requests cached in-memory for 10 minutes.

"Not found" is a normal result for new/uncommon films; returned as `{found: false}` with HTTP 200 (to avoid console 404 noise).

---

### 2.6 FilmGrab

**Movie screenshots/stills** from [film-grab.com](https://film-grab.com).

| Aspect | Detail |
| --- | --- |
| Source | FilmGrab (WordPress + 10Web Photo Gallery) |
| Anti-scraping | TLS/JA3 fingerprint check — normal `requests` gets 403 |
| Bypass | `curl_cffi` with `impersonate="chrome"` simulates Chrome TLS fingerprint |
| Politeness | 1-second delay between page requests; 2 retries on detail page |
| Ethics | Personal study only; not for public distribution |

**Two-step scrape:**
1. Search page: `GET https://film-grab.com/?s={movie}` → parse `h2.entry-title > a` for detail page URLs.
2. Detail page: parse `a[href*="/wp-content/uploads/photo-gallery/"]` (excluding `/thumb/` paths) for original image URLs.

**Title matching:** Strict normalized-title comparison with similarity threshold 0.85. Year hard-rejects mismatches. Roman numerals converted (II → 2) for sequel number consistency. Token-set containment check prevents false positives.

**Image proxy:** `/api/proxy?url={encoded}` — domain whitelist (`film-grab.com` only), path prefix check (`/wp-content/uploads/`), file extension check. Images cached in-memory LRU (1 hour, max 120). Concurrency limited by `asyncio.Semaphore(8)`.

**Caching:** Screenshot list cached 6 hours in-memory (empty results not cached). Image binary cached 1 hour (LRU).

---

### 2.7 YouTube Data API v3

**Official trailer search** and **comment retrieval** via YouTube Data API.

| Aspect | Detail |
| --- | --- |
| API | `https://www.googleapis.com/youtube/v3` |
| Auth | `YOUTUBE_API_KEY` query parameter |
| Quota | 10,000 units/day (shared) |

**Cost per operation:**

| API Call | Unit Cost | Cache TTL |
| --- | --- | --- |
| `search.list` | 100 | 7 days (hit) / 1 hour (miss) |
| `videos.list` | 1 | (batched with search) |
| `commentThreads.list` | 1 | 1 day (hit) / 1 hour (miss/disabled) |

**Trailer search algorithm:**
1. Query: `"{movie} {year} official trailer"` → 8 candidates.
2. Batch `videos.list` to get duration + statistics for all candidates (1 unit).
3. Score each candidate:
   - Title contains "Official Trailer/Teaser": +8
   - Title contains "Trailer/Teaser": +4
   - Channel is an official studio/authorized channel: +10
   - Published year matches release year (±1): +2
   - Junk keywords (reaction, review, fan-made, etc.): hard reject
   - Duration outside 20s–12min: hard reject
4. Return the best-scoring video's metadata.

**Comment retrieval:** `commentThreads.list` ordered by relevance, sorted by likes (descending), truncated to `max` (default 20, max 30). Comments disabled (403) → empty list, not an error.

**Note:** The frontend uses two trailer endpoints:
- **Primary:** `GET /api/trailer/{tmdbId}` (Node backend, TMDB videos, 0 quota cost)
- **Fallback/Enhanced:** `GET /api/trailer` (Python backend, YouTube Data API, richer metadata) — currently the Node endpoint is used for the initial trailer key; the Python endpoint provides YouTube comments.

---

### 2.8 Torrent Sites (16 sites)

**Torrent resource search** integrated from Torrent-Api-py, supporting 16 sites:

| Site ID | Name | Limit | Capabilities |
| --- | --- | --- | --- |
| `1337x` | 1337x | 100 | search, trending (categorized), category search, recent (categorized) |
| `torlock` | Torlock | 50 | search, trending (categorized), recent (categorized) |
| `tgx` | TorrentGalaxy | 50 | search, trending (categorized), recent (categorized) |
| `yts` | YTS | 20 | search, trending, recent |
| `piratebay` | Pirate Bay | 50 | search, trending, recent (categorized) |
| `kickass` | Kickass | 50 | search, trending (categorized), recent (categorized) |
| `limetorrent` | LimeTorrent | 50 | search, trending, recent (categorized) |
| `torrentfunk` | TorrentFunk | 50 | search, trending (categorized), recent (categorized) |
| `glodls` | Glodls | 45 | search, trending, recent |
| `bitsearch` | BitSearch | 50 | search, trending |
| `nyaasi` | Nyaa.si | 50 | search, recent |
| `magnetdl` | MagnetDL | 40 | search, recent (categorized) |
| `zooqle` | Zooqle | 30 | search only |
| `libgen` | Libgen | 25 | search only |
| `torrentproject` | TorrentProject | 20 | search only |
| `ybt` | YourBitTorrent | 20 | search, trending (categorized), recent (categorized) |

**Scraping method:** All torrent scrapers use `aiohttp` for async HTTP requests. `cloudscraper` is used as fallback for Cloudflare-protected sites. `beautifulsoup4` parses HTML. `HTTP_PROXY`/`HTTPS_PROXY` environment variables are respected by `aiohttp` for proxy access.

**YTS special case:** YTS returns structured movie entries with a `torrents[]` array containing per-quality items (quality, type, size, torrent link, magnet, hash). The frontend normalizes these into individual rows.

**Combo routes:** `/api/torrent/v1/all/{search,trending,recent}` query all 16 sites in parallel via `asyncio.gather`. Site failures are silently skipped; results are merged into a single array.

**Anti-bot note:** Cloudflare-protected sites (1337x, YTS, BitSearch) may return 403 or connection resets depending on the exit IP. The frontend handles these gracefully (per-site failures don't block others).

---

## 3. Frontend API Usage

### 3.1 Configuration

```js
// web/src/api.js
export const API_BASE = import.meta.env.VITE_API_BASE || ''
const _fgBase = import.meta.env.VITE_FILMGRAB_BASE
export const FILMGRAB_BASE =
  _fgBase != null && _fgBase !== '' ? _fgBase : import.meta.env.DEV ? '/filmgrab' : ''
export const apiUrl = (path) => `${API_BASE}${path}`
export const posterUrl = (path, size = 'w500') =>
  apiUrl(`/api/image?path=${encodeURIComponent(path)}&s=${size}`)
```

- `API_BASE`: empty in dev (same-origin, Vite proxies), set to `https://api.example.com` in cross-domain production.
- `FILMGRAB_BASE`: `/filmgrab` in dev (Vite proxy), `https://api.example.com/filmgrab` in production, or empty to disable.

### 3.2 Vite Proxy Configuration

```js
// web/vite.config.js
server: {
  proxy: {
    '/api': 'http://localhost:3002',           // Node backend
    '/filmgrab': {                              // Python backend
      target: 'http://localhost:8000',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/filmgrab/, '/api'),
    },
  },
}
```

### 3.3 Detail Page Section Order

Sections appear in this order on the movie detail page (all wrapped in `CollapsibleSection`):

```text
1. Trailer         — TrailerSection.jsx   (TMDB trailer key → YouTube iframe)
2. Where to Watch  — WhereToWatch.jsx     (Watchmode streaming sources)
3. Downloads       — Torrents.jsx         (4-site parallel torrent search)
4. Film Stills      — FilmGrabShots.jsx    (FilmGrab screenshots, selectable for card)
5. Card Studio     — CardStudio.jsx       (Card generation + export)
```

### 3.4 Component-to-Endpoint Mapping

| Component | Endpoint(s) Called | Service |
| --- | --- | --- |
| App.jsx (search dropdown) | `GET /api/search?q={q}` | Node |
| App.jsx (detail) | `GET /api/movie/{id}` | Node |
| App.jsx (detail images) | `GET /api/movie/{id}/images` | Node |
| App.jsx (trending) | `GET /api/trending` | Node |
| App.jsx (poster) | `GET /api/image?path={p}&s={size}` | Node |
| TrailerSection.jsx | `GET /api/trailer/{tmdbId}` | Node |
| TrailerSection.jsx | `GET {FILMGRAB_BASE}/comments?videoId={vid}&max=20` | Python |
| WhereToWatch.jsx | `GET /api/watch/{tmdbId}` | Node |
| Torrents.jsx | `GET {FILMGRAB_BASE}/torrent/v1/search?site={s}&query={q}&limit=20` (×4 sites) | Python |
| FilmGrabShots.jsx | `GET {FILMGRAB_BASE}/screenshots?movie={m}&year={y}` | Python |
| FilmGrabShots.jsx | `GET {FILMGRAB_BASE}/proxy?url={u}` (image src) | Python |
| CardStudio.jsx | `GET /api/ratings/{imdbId}?title={t}&year={y}` | Node |
| CardStudio.jsx | `GET /api/specs/{imdbId}?title={t}&year={y}` | Node |

### 3.5 Torrent Frontend Logic (Torrents.jsx)

The `Torrents` component implements a **parallel multi-site search** with graceful degradation:

```text
1. Build query: "{movie.title} {movie.year}"
2. Promise.allSettled([
     searchSite('yts', query),
     searchSite('piratebay', query),
     searchSite('1337x', query),
     searchSite('tgx', query)
   ])
3. Each searchSite() calls: GET {FILMGRAB_BASE}/torrent/v1/search?site={id}&query={q}&limit=20
   - 15-second timeout via Promise.race (not AbortController, to avoid console ERR_ABORTED)
   - 4xx responses treated as "no results from this site"
4. Merge all fulfilled results
5. Normalize:
   - YTS items with torrents[] expanded into per-quality rows
   - Non-YTS items kept as single rows
6. Deduplicate by btih hash (from magnet URI) or name+size fallback
7. Sort by seeders (descending)
8. Cap at 30 rows
9. Per-site filter chips (All / YTS / Pirate Bay / 1337x / TorrentGalaxy)
```

**Error handling:**
- `FILMGRAB_BASE === ''` → section hidden entirely
- All sites reject → section hidden
- Some sites reject → results from successful sites shown
- Zero results → "No torrents found" message

### 3.6 Common Frontend Patterns

All section components follow these conventions:

1. **StrictMode compatibility:** Instead of `AbortController`, a `setTimeout(0)` defers the fetch and an `alive` flag discards stale responses. This prevents `net::ERR_ABORTED` console noise during React 19 StrictMode double-mounting.

2. **CollapsibleSection wrapper:** All detail-page sections use `CollapsibleSection` for consistent expand/collapse UX with CSS grid `0fr→1fr` animation.

3. **Auto-hide on unavailable:** When a service is not configured (`ENABLED === false`) or returns an error, the section renders `null` — it doesn't show error states to the user.

4. **Movie-keyed remounting:** Each section receives `key={movie.id}` so switching movies cleanly resets all state.

---

## 4. Caching Architecture Summary

| Layer | Mechanism | TTL | Capacity |
| --- | --- | --- | --- |
| Node TMDB data | In-memory `Map` | 30 min | 200 entries (FIFO) |
| Node TMDB images | Single-flight only (no binary cache) | — | — |
| Node ratings | File: `server/.cache/ratings/{imdbId}.json` | Permanent | Until schema version bump |
| Node tech specs | File: `server/.cache/sow/{imdbId}.json` | Permanent | — |
| Node ratings (fail) | In-memory `Map` | 10 min | — |
| Python screenshots | In-memory dict | 6 hours | 200 entries |
| Python images | In-memory `OrderedDict` (LRU) | 1 hour | 120 entries |
| Python trailers | In-memory dict | 7 days (hit) / 1 hour (miss) | 500 entries |
| Python comments | In-memory dict | 1 day (hit) / 1 hour (miss) | 500 entries |
| Browser (TMDB img) | `Cache-Control: immutable` | 7 days | Browser-managed |

---

## 5. Network & Proxy Configuration

### Development (China network)

```text
Browser (5173)
  └─ Vite proxy
       ├─ /api/ → Node (3002) → TMDB via undici ProxyAgent (127.0.0.1:7890)
       └─ /filmgrab/ → Python (8000) → upstream via HTTP_PROXY env (127.0.0.1:7890)
```

### Production (server with direct internet)

```text
Browser → Nginx (80/443)
  ├─ / → web/dist (static files)
  ├─ /api/ → Node (127.0.0.1:3002) → TMDB direct (no proxy needed)
  └─ /filmgrab/ → Python (127.0.0.1:8000)/api/ → upstream direct
```

### Proxy auto-detection (Windows dev)

`filmgrab-service/start.ps1` probes `127.0.0.1:7890` (Clash) on startup:
- If open: sets `HTTP_PROXY` and `HTTPS_PROXY` environment variables.
- If closed: connects directly.

---

## 6. Related Documents

- [API Reference](./api-reference.md) — Full endpoint specification with request/response shapes
- [Local Development Manual](./manual.md) — How to start all three services locally
- [Deployment Guide](./deploy.md) — Production setup with Nginx, systemd
- [FilmGrab Service Details](./filmgrab-service.md) — Scraper internals and maintenance
