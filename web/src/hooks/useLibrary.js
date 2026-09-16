import { useSyncExternalStore, useCallback } from 'react'

const STORAGE_KEY = 'lumenframe:library'
const NOTES_KEY = 'lumenframe:notes'
const EVENT = 'lumenframe:library-change'

// 电影（TMDB id）与剧集（TVmaze id）数字空间重叠，条目标题键必须带 kind 前缀。
// 旧数据没有 kind 字段，读取时按电影迁移。
export const entryKey = (kind, id) => `${kind || 'movie'}:${id}`

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { watched: [], watchlater: [] }
    const obj = JSON.parse(raw)
    const fix = (arr) =>
      (Array.isArray(arr) ? arr : []).map((m) =>
        m.kind === 'tv' ? m : { ...m, kind: 'movie' }
      )
    return { watched: fix(obj.watched), watchlater: fix(obj.watchlater) }
  } catch {
    return { watched: [], watchlater: [] }
  }
}

let cache = readStore()
let notesCache = readNotes()
const listeners = new Set()

function readNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeNotes(next) {
  notesCache = next
  localStorage.setItem(NOTES_KEY, JSON.stringify(next))
}

function emit() {
  cache = readStore()
  notesCache = readNotes()
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

/** Extract a lightweight metadata object from the full title API response. */
function toEntry(movie, myRating = 0) {
  const base = {
    kind: movie.kind === 'tv' ? 'tv' : 'movie',
    id: movie.id,
    title: movie.title,
    year: movie.year,
    rating: movie.rating,
    genres: movie.genres || [],
    myRating,
    addedAt: Date.now(),
    // 第三方评分缓存（IMDb / Rotten Tomatoes / Metacritic / Popcornmeter + awards）
    ratings: movie.ratings || null,
  }
  if (base.kind === 'tv') {
    return {
      ...base,
      original_title: null,
      poster_path: null,
      tvPoster: movie.tvPoster || null,
      runtime: movie.runtime || null,
      yearRange: movie.yearRange || '',
      status: movie.status || null,
      network: movie.network || null,
      seasonsCount: movie.seasonsCount ?? null,
      episodesCount: movie.episodesCount ?? null,
      cast: (movie.credits?.cast || []).map((p) => ({ id: p.id, name: p.name })),
    }
  }
  return {
    ...base,
    original_title: movie.original_title,
    poster_path: movie.poster_path,
    runtime: movie.runtime || null,
    director: movie.credits?.director || null,
    writers: movie.credits?.writers || [],
    cast: (movie.credits?.cast || []).map((p) => ({ id: p.id, name: p.name })),
  }
}

export function useLibrary() {
  const store = useSyncExternalStore(subscribe, () => cache, () => cache)

  const addToWatched = useCallback((movie, myRating = 0) => {
    const entry = toEntry(movie, myRating)
    const key = entryKey(entry.kind, entry.id)
    const next = { ...cache }
    // watched 与 watchlater 可共存，不再互斥
    const existing = cache.watched.find((m) => entryKey(m.kind, m.id) === key)
    if (existing) {
      next.watched = cache.watched.map((m) =>
        entryKey(m.kind, m.id) === key ? { ...entry, addedAt: existing.addedAt } : m
      )
    } else {
      next.watched = [entry, ...cache.watched]
    }
    write(next)
  }, [])

  const removeFromWatched = useCallback((kind, id) => {
    const key = entryKey(kind, id)
    write({ ...cache, watched: cache.watched.filter((m) => entryKey(m.kind, m.id) !== key) })
  }, [])

  const addToWatchLater = useCallback((movie) => {
    const entry = toEntry(movie)
    const key = entryKey(entry.kind, entry.id)
    if (cache.watchlater.some((m) => entryKey(m.kind, m.id) === key)) return
    write({ ...cache, watchlater: [entry, ...cache.watchlater] })
  }, [])

  const removeFromWatchLater = useCallback((kind, id) => {
    const key = entryKey(kind, id)
    write({ ...cache, watchlater: cache.watchlater.filter((m) => entryKey(m.kind, m.id) !== key) })
  }, [])

  const isInWatched = useCallback(
    (kind, id) => cache.watched.some((m) => entryKey(m.kind, m.id) === entryKey(kind, id)),
    [cache]
  )
  const isInWatchLater = useCallback(
    (kind, id) => cache.watchlater.some((m) => entryKey(m.kind, m.id) === entryKey(kind, id)),
    [cache]
  )

  const updateMyRating = useCallback((kind, id, rating) => {
    const key = entryKey(kind, id)
    if (!cache.watched.some((m) => entryKey(m.kind, m.id) === key)) return
    write({
      ...cache,
      watched: cache.watched.map((m) =>
        entryKey(m.kind, m.id) === key ? { ...m, myRating: rating } : m
      ),
    })
  }, [cache])

  // 同步第三方评分到 watched 条目（详情页 /api/ratings 成功后调用）
  const updateRatings = useCallback((kind, id, ratings) => {
    const key = entryKey(kind, id)
    if (!cache.watched.some((m) => entryKey(m.kind, m.id) === key)) return
    write({
      ...cache,
      watched: cache.watched.map((m) =>
        entryKey(m.kind, m.id) === key ? { ...m, ratings } : m
      ),
    })
  }, [cache])

  // 短评：独立存储，不要求加入 watched；同步到 watched 条目里以便 Library 页和 Card Studio 使用
  const getNote = useCallback(
    (kind, id) => notesCache[entryKey(kind, id)] || '',
    []
  )
  const setNote = useCallback((kind, id, text) => {
    const key = entryKey(kind, id)
    const next = { ...notesCache }
    if (text) next[key] = text
    else delete next[key]
    writeNotes(next)
    // 同时同步到 watched 条目（如果存在）
    if (cache.watched.some((m) => entryKey(m.kind, m.id) === key)) {
      write({
        ...cache,
        watched: cache.watched.map((m) =>
          entryKey(m.kind, m.id) === key ? { ...m, note: text || null } : m
        ),
      })
    }
    emit()
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
    updateRatings,
    getNote,
    setNote,
  }
}
