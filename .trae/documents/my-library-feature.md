# Plan: My Library Feature

## Context

The user wants a local-only movie library with watch lists, personal ratings, and data analytics (director/actor aggregation, total watch time, charts). All data persists in the browser via `localStorage` — no backend database. The feature is accessed from a button in the top-right Header area and opens as a full-page view with Chart.js-powered statistics.

Personal ratings already use localStorage (`lumenframe:myrating:${id}` in App.jsx L323). This plan extends the same pattern to store full movie metadata for list items.

---

## Step 1: Add `runtime` and `genres` to movie detail API response

**File:** [server/index.js](file:///c:/Users/LongGe/Desktop/cinecard/server/index.js) (L128-L147)

The `/api/movie/:id` response currently omits `runtime` and `genres` from the TMDB data. Add:
```js
runtime: m.runtime || null,         // minutes, for watch-time analytics
genres: (m.genres || []).map(g => g.name),  // for genre distribution charts
```

---

## Step 2: Install Chart.js

**File:** [web/package.json](file:///c:/Users/LongGe/Desktop/cinecard/web/package.json)

```bash
npm install chart.js
```

Use `chart.js/auto` (tree-shaken auto-registration) in the stats component.

---

## Step 3: Create `useLibrary` hook

**File (new):** `web/src/hooks/useLibrary.js`

localStorage key: `lumenframe:library` — single JSON object:

```json
{
  "watched": [
    {
      "id": 27205,
      "title": "Inception",
      "year": "2010",
      "poster_path": "/9gN4a4r7YQdP9dJ5XkLmZ6xY.jpg",
      "rating": 8.4,
      "runtime": 148,
      "genres": ["Action", "Sci-Fi"],
      "myRating": 9,
      "director": "Christopher Nolan",
      "writers": ["Christopher Nolan"],
      "cast": [{ "id": 6197, "name": "Leonardo DiCaprio" }],
      "addedAt": 1697000000000
    }
  ],
  "watchlater": [ /* same shape, no myRating */ ]
}
```

Exported functions:
- `useLibrary()` → `{ watched, watchlater, addToWatched(movie), removeFromWatched(id), addToWatchLater(movie), removeFromWatchLater(id), isInWatched(id), isInWatchLater(id), moveWatchedToLater(id), moveLaterToWatched(id) }`
- `getMyRating(id)` / `setMyRating(id, v)` — migrate existing `lumenframe:myrating:` keys into watched items if present
- Reads/writes are synchronous (localStorage), with `useSyncExternalStore` or simple `useState` + custom event for cross-component sync

When adding to watched: if movie already in watchlater, remove it first (mutually exclusive). The `myRating` field reads from the existing `lumenframe:myrating:${id}` localStorage key at add-time and on changePersonal updates.

---

## Step 4: Create `LibraryPage` component

**File (new):** `web/src/components/LibraryPage.jsx`

Full-page view with three tabs:
1. **Watched** — grid of movie cards (poster, title, year, my rating, TMDB rating, runtime, remove button). Clicking a card opens the movie detail.
2. **Watch Later** — same grid layout, no rating shown.
3. **Statistics** — renders `<LibraryStats>`

Layout: `max-w-5xl mx-auto pt-24 px-6` to match the detail page container. Back button at top (same pattern as movie detail L513-L523). Tab bar with underline indicator (zinc-300 border, active = black).

Empty states: "Your watched list is empty. Search for movies and add them here." with a button to go home.

---

## Step 5: Create `LibraryStats` component

**File (new):** `web/src/components/LibraryStats.jsx`

Uses `chart.js/auto` for rendering. Layout: summary stat cards on top, then a responsive grid of chart canvases.

**Summary cards:**
- Movies Watched (count)
- Total Watch Time (sum of runtime → "XXh YYm")
- Average My Rating (mean of myRating, 1 decimal)
- Average TMDB Rating (mean of rating)

**Charts (all horizontal bar or doughnut, 4 per row on desktop):**
1. **Top Directors** — bar chart, top 10 by movie count
2. **Top Actors** — bar chart, top 10 by movie count (from cast[])
3. **Top Writers** — bar chart, top 10 by movie count
4. **Genre Distribution** — doughnut chart
5. **My Rating Distribution** — bar chart, x-axis = 1-10, y-axis = count

Each chart in a bordered card (`border border-zinc-200 p-4`). Canvas height ~240px. Colors: zinc palette to match site tone.

If watched list has < 3 movies, show a prompt: "Add at least 3 movies to see meaningful statistics."

---

## Step 6: Add "Library" button to Header

**File:** [web/src/components/Header.jsx](file:///c:/Users/LongGe/Desktop/cinecard/web/src/components/Header.jsx)

Add a new prop `onLibrary` and a "Library" text button (desktop) next to "References" (L39-L43). On mobile, the hamburger already opens the slide-out — add a "My Library" nav item at the top of the slide-out panel (above References).

Desktop layout: `[Library] [References]` in the top-right.

---

## Step 7: Add watch list buttons to movie detail page

**File:** [web/src/App.jsx](file:///c:/Users/LongGe/Desktop/cinecard/web/src/App.jsx)

In the movie detail header section (around L542-L553, after the ratings line), add two buttons:
- **"+ Watched"** / **"✓ Watched"** (toggle, shows checkmark if already in watched)
- **"+ Watch Later"** / **"✓ Watch Later"** (toggle)

Buttons styled as small pill outlines (`border border-zinc-300 px-3 py-1 text-xs`). Active state: `border-black bg-black text-white`.

When adding to watched, store the full movie metadata object (id, title, year, poster_path, rating, runtime, genres, credits, myRating). The `myRating` value is read from the current `personal` state so it stays in sync.

When `changePersonal` is called (L321-L324), also update the watched item's `myRating` if the movie is in the watched list.

---

## Step 8: Add library routing to App.jsx

**File:** [web/src/App.jsx](file:///c:/Users/LongGe/Desktop/cinecard/web/src/App.jsx)

Add a new view state and routing:

```js
const [view, setView] = useState('home') // 'home' | 'movie' | 'library'
```

- **goLibrary()**: `resetMovieView()`, `setView('library')`, pushState `{ library: true }` to URL `${BASE_PATH}library`
- **parseLibraryRoute()**: check if pathname matches `/library` at the end
- **popstate handler**: check for movie route first, then library route, else home
- **Header onLibrary={goLibrary}**
- **Render logic**: if `view === 'library'`, render `<LibraryPage>` instead of search/trending/detail. Otherwise existing flow.

---

## Step 9: Sync personal rating with library

**File:** [web/src/App.jsx](file:///c:/Users/LongGe/Desktop/cinecard/web/src/App.jsx)

In `changePersonal` (L321-L324), after updating localStorage, also call `useLibrary.updateMyRating(movie.id, v)` so the watched list's `myRating` stays in sync.

In `openMovie` (L360), after loading movie data, check if movie is in watched/watchlater and set a status flag for the toggle buttons.

---

## Files Summary

| File | Action |
| --- | --- |
| `server/index.js` | Add `runtime`, `genres` to `/api/movie/:id` response |
| `web/package.json` | Add `chart.js` dependency |
| `web/src/hooks/useLibrary.js` | **New** — localStorage CRUD + sync |
| `web/src/components/LibraryPage.jsx` | **New** — full-page view with tabs |
| `web/src/components/LibraryStats.jsx` | **New** — Chart.js analytics dashboard |
| `web/src/components/Header.jsx` | Add "Library" button + `onLibrary` prop |
| `web/src/App.jsx` | Routing, view state, watch list buttons, rating sync |

---

## Verification

1. `npm run dev --prefix web` — ensure no build errors
2. Open a movie detail page → verify "+ Watched" / "+ Watch Later" buttons appear
3. Add a movie to Watched → open Library (top-right button) → verify it appears in the Watched tab
4. Add 3+ movies → switch to Statistics tab → verify charts render (directors, actors, genres, rating distribution)
5. Remove a movie from the list → verify it disappears from both list and stats
6. Reload page → verify lists persist (localStorage)
7. Check that total watch time sums runtime correctly
8. Verify personal rating (My Score) stays in sync between Card Studio and Library stats
