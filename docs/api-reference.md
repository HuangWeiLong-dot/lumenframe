# LUMENFRAME API Reference

This document describes every API endpoint exposed by the LUMENFRAME backend.

The system has two backend services:

| Service | Stack | Default Port | Internal Prefix |
| --- | --- | --- | --- |
| `server/` | Node.js + Express | 3001 | `/api` |
| `filmgrab-service/` | Python + FastAPI | 8000 | `/api` (internal), exposed as `/filmgrab` externally |

In local development, Vite proxies both services:

```text
/api/*      →  http://localhost:3001        (Node backend)
/filmgrab/* →  http://localhost:8000/api/*  (Python backend, prefix rewritten)
```

In production, Nginx replaces Vite for the same routing:

```text
/api/       →  127.0.0.1:3001
/filmgrab/  →  127.0.0.1:8000/api/
```

All endpoints are read-only `GET` and return JSON unless noted otherwise (image proxy returns binary).

---

## Part A — Node.js Backend (port 3001)

### Health & Search

#### `GET /api/search`

Search movies by keyword (TMDB `/search/movie`).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | string | Yes | Search query (min 1 char) |

**Response** `200`

```json
{
  "results": [
    {
      "id": 27205,
      "title": "Inception",
      "year": "2010",
      "rating": 8.4,
      "overview": "A thief who steals corporate secrets...",
      "poster_path": "/9gN4a4r7YQdP9dJ3J5XkLmZ6xY.jpg"
    }
  ]
}
```

Cache: 30 minutes in-memory, keyed by `search:{query}`.

---

### Movie Details

#### `GET /api/movie/:id`

Get full movie details including cast and crew (TMDB `/movie/{id}` with `append_to_response=credits`).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | integer | Yes | TMDB movie ID (path parameter) |

**Response** `200`

```json
{
  "id": 27205,
  "title": "Inception",
  "original_title": "Inception",
  "year": "2010",
  "rating": 8.4,
  "overview": "A thief who steals corporate secrets...",
  "poster_path": "/9gN4a4r7YQdP9dJ5XkLmZ6xY.jpg",
  "imdb_id": "tt1375666",
  "credits": {
    "director": "Christopher Nolan",
    "writers": ["Christopher Nolan"],
    "dop": "Wally Pfister",
    "cast": [
      { "id": 6197, "name": "Leonardo DiCaprio", "character": "Cobb" },
      { "id": 5294, "name": "Joseph Gordon-Levitt", "character": "Arthur" }
    ]
  }
}
```

- Writers: filtered by `job` in `Screenplay`, `Writer`, `Story`, `Novel`; deduplicated; max 3.
- Cast: top 5 by TMDB order.
- Cache: 30 minutes, keyed by `movie:{id}`.

---

#### `GET /api/movie/:id/images`

Get alternative posters and backdrops (TMDB `/movie/{id}/images`).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | integer | Yes | TMDB movie ID (path parameter) |

**Response** `200`

```json
{
  "posters": [
    { "file_path": "/9gN4a4r7YQdP9dJ5XkLmZ6xY.jpg", "width": 1000, "height": 1500 }
  ],
  "backdrops": [
    { "file_path": "/8ZTVGm5p7wW8k7r2H.jpg", "width": 1920, "height": 1080 }
  ]
}
```

- Posters: English + no-language originals, sorted by `vote_count` desc, top 10.
- Backdrops: sorted by `vote_count` desc, top 12.
- Cache: 30 minutes, keyed by `movie:{id}:images`.

---

### Trending

#### `GET /api/trending`

Get this week's trending movies (TMDB `/trending/movie/week`).

**Response** `200`

```json
{
  "posters": [
    {
      "id": 27205,
      "title": "Inception",
      "poster_path": "/9gN4a4r7YQdP9dJ5XkLmZ6xY.jpg",
      "backdrop_path": "/8ZTVGm5p7wW8k7r2H.jpg",
      "year": "2010"
    }
  ]
}
```

- Filters out entries without `poster_path`; returns top 30.
- Cache: 30 minutes, keyed by `trending:week`.

---

### Image Proxy

#### `GET /api/image`

Proxy TMDB poster/backdrop images. Solves network restrictions in China and html2canvas cross-origin issues.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | Yes | TMDB image path, e.g. `/9gN4a4r7YQdP9dJ5XkLmZ6xY.jpg` |
| `s` | string | No | Image size: `w185` \| `w342` \| `w500` \| `w780` \| `w1280` \| `original`. Default: `w500` |

**Response** `200` — Binary image data with `Content-Type` and `Cache-Control: public, max-age=604800, immutable`.

- Concurrent identical requests are deduplicated (single-flight), but images are not cached in memory (too large).
- Upstream fetch retries once on failure.
- Invalid path format returns `400`.

---

### Ratings

#### `GET /api/ratings/:imdbId`

Get third-party ratings from OMDB API (IMDb, Metacritic, Rotten Tomatoes) and Rotten Tomatoes Popcornmeter.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `imdbId` | string | Yes | IMDb ID, e.g. `tt1375666` (path parameter) |
| `title` | string | Yes | Movie title (query, for OMDB fallback and RT scraping) |
| `year` | string | Yes | 4-digit release year (query) |

**Response** `200`

```json
{
  "imdb": 8.4,
  "metacritic": 74,
  "rotten_tomatoes": 87,
  "popcornmeter": 85
}
```

Any unavailable rating is `null` — no fabricated values.

- OMDB API: `https://www.omdbapi.com/?i={imdbId}&apikey={key}` returns IMDb rating, Metacritic, and RT Tomatometer.
- RT Popcornmeter: scraped via `server/rt.js` if OMDB doesn't include it.
- Cache: file-based permanent cache at `server/.cache/ratings/{imdbId}.json` (with `CACHE_VERSION` for schema upgrades). Failed requests cached in-memory for 10 minutes.
- `x-cache` response header: `HIT` or `MISS`.

---

### Trailer (TMDB)

#### `GET /api/trailer/:tmdbId`

Get the official trailer YouTube key from TMDB videos (no YouTube API quota cost).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `tmdbId` | integer | Yes | TMDB movie ID (path parameter) |

**Response** `200`

```json
{
  "videoId": "YoHD9XEInc0",
  "title": "Inception - Official Trailer [HD]",
  "official": true,
  "publishedAt": "2010-01-01T00:00:00Z"
}
```

If no trailer found: `{"videoId": null}`.

- TMDB `/movie/{id}/videos` is filtered to `site === 'YouTube'` and `official !== false`.
- Scoring: `Trailer` type (100) > `Teaser` (50); "Official Trailer" in name (+30); 1080p size (+10).
- Cache: 30 minutes, keyed by `trailer:{id}`.

---

### Watch Availability

#### `GET /api/watch/:tmdbId`

Check streaming availability via Watchmode API.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `tmdbId` | integer | Yes | TMDB movie ID (path parameter) |

**Response** `200`

```json
{
  "sources": [
    {
      "name": "Netflix",
      "type": "sub",
      "webUrl": "https://www.netflix.com/title/8009...",
      "price": null,
      "currency": "USD",
      "region": "US"
    },
    {
      "name": "Apple TV",
      "type": "rent",
      "webUrl": "https://tv.apple.com/movie/...",
      "price": 3.99,
      "currency": "USD",
      "region": "US"
    }
  ]
}
```

- `type`: `sub` (subscription) \| `free` \| `rent` \| `buy` \| `tve` (TV Everywhere).
- Sources are deduplicated by platform name, keeping the highest-priority type (`sub` > `free` > `rent` > `buy` > `tve`).
- If `WATCHMODE_API_KEY` is not set, returns `{"sources": []}`.
- Cache: 30 minutes, keyed by `watch:{id}`.

---

### Tech Specs

#### `GET /api/specs/:imdbId`

Get cinematography technical specs from ShotOnWhat?.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `imdbId` | string | Yes | IMDb ID (path parameter) |
| `title` | string | Yes | Movie title (query) |
| `year` | string | Yes | 4-digit release year (query) |

**Response** `200` (found)

```json
{
  "found": true,
  "camera": ["ARRI Alexa 65", "IMAX MSM 9802"],
  "lenses": ["Leica Prime Lenses"],
  "film_format": ["IMAX", "65mm Digital"],
  "laboratory": null,
  "sound_mixer": null
}
```

If not found: `{"found": false}` (HTTP 200, to avoid console 404 noise).

- Cache: file-based permanent cache at `server/.cache/sow/{imdbId}.json`. 10-minute in-memory cache for failed requests.
- `x-cache` response header: `HIT` or `MISS`.

---

## Part B — Python FastAPI Backend (port 8000)

All endpoints below are served from `filmgrab-service/`. The internal prefix is `/api/`; externally exposed as `/filmgrab/` via Nginx/Vite rewrite.

### Health Check

#### `GET /`

```json
{"service": "filmgrab-proxy", "status": "ok"}
```

---

### FilmGrab Screenshots

#### `GET /api/screenshots`

Get movie screenshot list from FilmGrab.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `movie` | string | Yes | Movie name (min 1 char) |
| `year` | string | No | Release year, for disambiguating remakes |

**Response** `200`

```json
{
  "movie": "Inception",
  "page_title": "Inception (2010)",
  "count": 65,
  "screenshots": [
    "/api/proxy?url=https%3A%2F%2Ffilm-grab.com%2Fwp-content%2Fuploads%2Fphoto-gallery%2F01.jpg"
  ]
}
```

- `screenshots` entries are proxy URLs (to be consumed via the next endpoint).
- `year` participates in cache key.
- Empty results return `{"count": 0, "screenshots": []}` and are not cached.
- Cache: in-memory, 6 hours, max 200 entries.

---

#### `GET /api/proxy`

Proxy a FilmGrab image (domain whitelist enforced).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | Yes | Full FilmGrab image URL (URL-encoded) |

**Response** `200` — Binary image data with `Content-Type` and `Cache-Control: public, max-age=86400`.

- Only `film-grab.com` / `www.film-grab.com` under `/wp-content/uploads/` with image extensions are allowed. Otherwise: `403`.
- `X-Cache: HIT` or `X-Cache: MISS` response header.
- Upstream fetch failure: `502`.
- Cache: in-memory LRU, 1 hour TTL, max 120 images.
- Concurrency limit: `asyncio.Semaphore(8)` (configurable via `PROXY_CONCURRENCY`).

---

### YouTube Trailer Search

#### `GET /api/trailer`

Search for the official trailer via YouTube Data API v3.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `movie` | string | Yes | Movie name |
| `year` | string | No | Release year, helps locate correct trailer |

**Response** `200`

```json
{
  "videoId": "YoHD9XEInc0",
  "title": "Inception - Official Trailer [HD]",
  "channelTitle": "Warner Bros. Pictures",
  "thumbnail": "https://i.ytimg.com/vi/YoHD9XEInc0/hqdefault.jpg",
  "publishedAt": "2010-01-01T00:00:00Z",
  "durationSeconds": 90,
  "viewCount": 45000000
}
```

If not found: `{"videoId": null}`.

- Search query: `"{movie} {year} official trailer"`.
- Uses `search.list` (100 units) + `videos.list` (1 unit) for details.
- Scoring: Official Trailer in title (+8), Trailer/Teaser (+4), official channel (+10), year proximity (+2). Junk keywords (reaction, review, etc.) are hard-rejected. Duration must be 20s–12min.
- Cache: 7 days for hits; 1 hour for misses/failures. Max 500 entries.
- Requires `YOUTUBE_API_KEY` environment variable.

---

#### `GET /api/comments`

Get top YouTube comments for a trailer video.

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `videoId` | string | Yes | YouTube video ID |
| `max` | integer | No | Max comments to return. Default: 20, range: 1–30 |

**Response** `200`

```json
{
  "comments": [
    {
      "author": "MovieFan42",
      "authorChannelUrl": "https://www.youtube.com/channel/...",
      "avatar": "https://yt3.ggpht.com/...",
      "text": "One of the best movies ever made.",
      "likes": 12500,
      "publishedAt": "2010-01-05T00:00:00Z"
    }
  ]
}
```

If comments are disabled: `{"comments": []}`.

- Uses `commentThreads.list` (1 unit), ordered by relevance.
- Comments sorted by likes (descending), truncated to `max`.
- Cache: 1 day for hits; 1 hour for misses/disabled. Max 500 entries.

---

## Part C — Torrent API (integrated into FastAPI backend)

All torrent routes are prefixed with `/api/torrent/v1`. Externally: `/filmgrab/torrent/v1/...`.

Optional authentication: if `PYTORRENT_API_KEY` environment variable is set, all torrent endpoints require an `X-API-Key` header matching the key. If unset, no authentication is enforced.

### Supported Sites

#### `GET /api/torrent/v1/sites`

List all supported torrent sites.

**Response** `200`

```json
{
  "supported_sites": ["1337x", "torlock", "zooqle", "magnetdl", "tgx", "nyaasi", "piratebay", "bitsearch", "kickass", "libgen", "yts", "limetorrent", "torrentfunk", "glodls", "torrentproject", "ybt"]
}
```

---

#### `GET /api/torrent/v1/sites/config`

List all supported sites with capabilities.

**Response** `200`

```json
{
  "1337x": {
    "website": "1337x",
    "trending_available": true,
    "trending_category": true,
    "search_by_category": true,
    "recent_available": true,
    "recent_category_available": true,
    "categories": ["anime", "music", "games", "tv", "apps", "documentaries", "other", "xxx", "movies"],
    "limit": 100
  },
  "yts": {
    "website": "YTS",
    "trending_available": true,
    "trending_category": false,
    "search_by_category": false,
    "recent_available": true,
    "recent_category_available": false,
    "categories": [],
    "limit": 20
  }
}
```

---

### Single-Site Search

#### `GET /api/torrent/v1/search`

Search torrents on a specific site.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site` | string | Yes | — | Site ID (e.g. `yts`, `1337x`, `piratebay`) |
| `query` | string | Yes | — | Search keywords |
| `limit` | integer | No | 0 (site default) | Max results. Capped by site's `limit` field |
| `page` | integer | No | 1 | Page number |

**Response** `200`

```json
{
  "data": [
    {
      "name": "Inception (2010) 1080p BrRip x264 - 1.85GB - YIFY",
      "size": "1.85 GB",
      "seeders": "1543",
      "leechers": "287",
      "magnet": "magnet:?xt=urn:btih:6a9759dee3e40...",
      "torrent": "https://yts.mx/torrent/download/...",
      "url": "https://yts.mx/movies/inception-2010",
      "date": "2023-01-15",
      "hash": "6a9759dee3e40c1f..."
    }
  ],
  "total": 10,
  "time": 1.6,
  "current_page": 1,
  "total_pages": 3
}
```

- `torrent` (`.torrent` file URL), `url` (detail page), `current_page`/`total_pages` are optional (not all sites return them).
- Site blocked/unavailable: `403 {"error": "Website Blocked Change IP or Website Domain."}`.
- No results: `404 {"error": "Result not found."}`.
- Unsupported site: `404 {"error": "Selected Site Not Available"}`.

**YTS-specific**: each `data[]` item may contain a `torrents[]` array with per-quality entries (`quality`, `type`, `size`, `torrent`, `magnet`, `hash`), plus movie metadata (`poster`, `genre`, `rating`, `runtime`, `description`, `screenshot`).

---

### Trending

#### `GET /api/torrent/v1/trending`

Get trending torrents from a specific site.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site` | string | Yes | — | Site ID |
| `limit` | integer | No | 0 | Max results |
| `category` | string | No | null | Category (e.g. `movies`). Must be in site's `categories` |
| `page` | integer | No | 1 | Page number |

**Response**: same structure as search. Returns `404` if the site doesn't support trending or the category is unavailable.

---

### Category Search

#### `GET /api/torrent/v1/category`

Search within a category on a site that supports `search_by_category`.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site` | string | Yes | — | Site ID (only `1337x` and `torlock` support this) |
| `query` | string | Yes | — | Search keywords |
| `category` | string | Yes | — | Category (must be in site's `categories`) |
| `limit` | integer | No | 0 | Max results |
| `page` | integer | No | 1 | Page number |

**Response**: same structure as search.

---

### Recent

#### `GET /api/torrent/v1/recent`

Get recently added torrents from a specific site.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site` | string | Yes | — | Site ID |
| `limit` | integer | No | 0 | Max results |
| `category` | string | No | null | Category filter |
| `page` | integer | No | 1 | Page number |

**Response**: same structure as search.

---

### Combo (All-Site Parallel)

These endpoints aggregate results from all supported sites concurrently. Each site is queried independently; site failures are silently skipped.

#### `GET /api/torrent/v1/all/search`

Search all sites in parallel.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | Yes | — | Search keywords |
| `limit` | integer | No | 0 | Per-site limit (capped by each site's `limit`) |

**Response** `200`

```json
{
  "data": [
    { "name": "...", "seeders": "1543", "magnet": "...", "site": "yts" }
  ],
  "total": 45,
  "time": 3.2
}
```

- All 16 sites are queried concurrently via `asyncio.gather`.
- Each site's results are merged into a single `data[]` array.
- If all sites return no results: `404 {"error": "Result not found."}`.

---

#### `GET /api/torrent/v1/all/trending`

Get trending torrents from all sites that support it.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | No | 0 | Per-site limit |

**Response**: same structure as `/all/search`.

---

#### `GET /api/torrent/v1/all/recent`

Get recent torrents from all sites that support it.

| Param | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | No | 0 | Per-site limit |

**Response**: same structure as `/all/search`.

---

### Search by URL

#### `GET /api/torrent/v1/search_url`

Fetch torrent data from a specific detail-page URL (currently only 1337x).

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `site` | string | Yes | Site ID (only `1337x` supported) |
| `url` | string | Yes | Detail page URL |

**Response**: same structure as search (single-item `data[]`).

---

## Environment Variables Summary

### Node.js Backend (`server/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TMDB_API_KEY` | Yes | — | TMDB v3 API key |
| `TMDB_PROXY` | No | — | Proxy URL for TMDB access (e.g. `http://127.0.0.1:7890`) |
| `PORT` | No | 3001 | Server port |
| `OMDB_API_KEY` | No | — | OMDB API key for ratings |
| `WATCHMODE_API_KEY` | No | — | Watchmode API key for streaming availability |

### Python Backend (`filmgrab-service/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `YOUTUBE_API_KEY` | No | — | YouTube Data API v3 key (required for trailer/comments) |
| `PORT` | No | 8000 | Service port |
| `HTTPS_PROXY` / `HTTP_PROXY` | No | — | Proxy for upstream access (e.g. `http://127.0.0.1:7890`) |
| `PROXY_CONCURRENCY` | No | 8 | FilmGrab image download concurrency limit |
| `PYTORRENT_API_KEY` | No | — | If set, torrent endpoints require `X-API-Key` header |

### Frontend (`web/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_API_BASE` | No | `''` (same-origin) | Node backend base URL for cross-domain deployment |
| `VITE_FILMGRAB_BASE` | No | `''` (disabled; `/filmgrab` in dev) | Python backend base URL for cross-domain deployment |
