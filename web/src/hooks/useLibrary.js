import { useSyncExternalStore, useCallback } from 'react'

const STORAGE_KEY = 'lumenframe:library'
const EVENT = 'lumenframe:library-change'

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { watched: [], watchlater: [] }
    const obj = JSON.parse(raw)
    return {
      watched: Array.isArray(obj.watched) ? obj.watched : [],
      watchlater: Array.isArray(obj.watchlater) ? obj.watchlater : [],
    }
  } catch {
    return { watched: [], watchlater: [] }
  }
}

let cache = readStore()
const listeners = new Set()

function emit() {
  cache = readStore()
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  window.addEventListener('storage', onStorage)
  window.addEventListener(EVENT, onStorage)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(EVENT, onStorage)
    }
  }
}

function onStorage() {
  emit()
}

function write(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  emit()
}

/** Extract a lightweight metadata object from the full movie API response. */
function toEntry(movie, myRating = 0) {
  return {
    id: movie.id,
    title: movie.title,
    original_title: movie.original_title,
    year: movie.year,
    poster_path: movie.poster_path,
    rating: movie.rating,
    runtime: movie.runtime || null,
    genres: movie.genres || [],
    myRating,
    director: movie.credits?.director || null,
    writers: movie.credits?.writers || [],
    cast: (movie.credits?.cast || []).map((p) => ({ id: p.id, name: p.name })),
    addedAt: Date.now(),
  }
}

export function useLibrary() {
  const store = useSyncExternalStore(subscribe, () => cache, () => cache)

  const addToWatched = useCallback((movie, myRating = 0) => {
    const entry = toEntry(movie, myRating)
    const next = { ...cache }
    // watched 与 watchlater 可共存，不再互斥
    const existing = cache.watched.find((m) => m.id === entry.id)
    if (existing) {
      next.watched = cache.watched.map((m) => (m.id === entry.id ? { ...entry, addedAt: existing.addedAt } : m))
    } else {
      next.watched = [entry, ...cache.watched]
    }
    write(next)
  }, [])

  const removeFromWatched = useCallback((id) => {
    write({ ...cache, watched: cache.watched.filter((m) => m.id !== id) })
  }, [])

  const addToWatchLater = useCallback((movie) => {
    const entry = toEntry(movie)
    if (cache.watchlater.some((m) => m.id === entry.id)) return
    write({ ...cache, watchlater: [entry, ...cache.watchlater] })
  }, [])

  const removeFromWatchLater = useCallback((id) => {
    write({ ...cache, watchlater: cache.watchlater.filter((m) => m.id !== id) })
  }, [])

  const isInWatched = useCallback((id) => cache.watched.some((m) => m.id === id), [cache])
  const isInWatchLater = useCallback((id) => cache.watchlater.some((m) => m.id === id), [cache])

  const updateMyRating = useCallback((id, rating) => {
    if (!cache.watched.some((m) => m.id === id)) return
    write({
      ...cache,
      watched: cache.watched.map((m) => (m.id === id ? { ...m, myRating: rating } : m)),
    })
  }, [cache])

  return {
    watched: store.watched,
    watchlater: store.watchlater,
    addToWatched,
    removeFromWatched,
    addToWatchLater,
    removeFromWatchLater,
    isInWatched,
    isInWatchLater,
    updateMyRating,
  }
}
