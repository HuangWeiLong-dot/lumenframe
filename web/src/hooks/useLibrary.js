import { useSyncExternalStore, useCallback } from 'react'
import { safeGetJSON, safeSet, setChangeOrigin } from '../storage'

const STORAGE_KEY = 'lumenframe:library'
const NOTES_KEY = 'lumenframe:notes'
const EVENT = 'lumenframe:library-change'

// 电影（TMDB id）与剧集（TVmaze id）数字空间重叠，条目标题键必须带 kind 前缀。
// 旧数据没有 kind 字段，读取时按电影迁移。
export const entryKey = (kind, id) => `${kind || 'movie'}:${id}`

// 个人评分的本地标量 key（电影沿用旧 key，剧集带 tv: 前缀）。
// 与 watched[].myRating 是两份数据：这里是「评了分但没加入片库」的兜底，
// 云端同步以 watched[].myRating 为准。
export function ratingStorageKey(kind, id) {
  return kind === 'tv' ? `lumenframe:myrating:tv:${id}` : `lumenframe:myrating:${id}`
}

function readStore() {
  // 无数据（首次访问 / 清空 localStorage）时也要返回完整的三个键，
  // 否则 store.likes === undefined 会让观影库页面直接白屏。
  // 注意每次都返回新对象：emit() 靠引用变化触发 useSyncExternalStore 重渲染。
  const obj = safeGetJSON(STORAGE_KEY, null)
  if (!obj || typeof obj !== 'object') return { watched: [], watchlater: [], likes: [] }
  const fix = (arr) =>
    (Array.isArray(arr) ? arr : []).map((m) =>
      m.kind === 'tv' ? m : { ...m, kind: 'movie' }
    )
  return {
    watched: fix(obj.watched),
    watchlater: fix(obj.watchlater),
    likes: Array.isArray(obj.likes) ? obj.likes : [],
  }
}

let cache = readStore()
let notesCache = readNotes()
const listeners = new Set()

function readNotes() {
  const obj = safeGetJSON(NOTES_KEY, null)
  return obj && typeof obj === 'object' ? obj : {}
}

// localStorage 可能被隐私模式/浏览器策略禁用或写满：写失败只影响持久化，
// 不应让「加入观影库 / 评分 / 短评」等交互抛错崩掉页面（safeSet 见 ../storage）
function writeNotes(next) {
  notesCache = next
  safeSet(NOTES_KEY, JSON.stringify(next))
}

// 只通知订阅者（保留内存缓存里的改动，即便持久化失败本次会话也生效）
function notify() {
  listeners.forEach((fn) => fn())
}

// 从存储重读（storage 事件：其它标签页写入后同步）
// 标记来源为 external：这次变化不是用户操作，可能是存储被清空（key === null）——
// 同步层据此判断「条目消失」是缓存被清还是用户删除，绝不在这里记墓碑。
function emit() {
  cache = readStore()
  notesCache = readNotes()
  setChangeOrigin('external')
  notify()
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
  // 先落内存缓存，再尝试持久化：存储不可用时改动仍在本会话有效
  cache = next
  safeSet(STORAGE_KEY, JSON.stringify(next))
  setChangeOrigin('local')
  notify()
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
    imdb_id: movie.imdb_id || null,
    director: movie.credits?.director || null,
    writers: movie.credits?.writers || [],
    cast: movie.credits?.cast || [].map((p) => ({ id: p.id, name: p.name })),
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

  // 语言切换后回填本地化标题（本地存的是加入时的语言；标题未变则不写入、不触发渲染）
  const updateTitle = useCallback((kind, id, title) => {
    if (!title) return
    const key = entryKey(kind, id)
    const patch = (list) => {
      let changed = false
      const next = list.map((m) => {
        if (entryKey(m.kind, m.id) !== key || m.title === title) return m
        changed = true
        return { ...m, title }
      })
      return changed ? next : null
    }
    const watched = patch(cache.watched)
    const watchlater = patch(cache.watchlater)
    if (!watched && !watchlater) return
    write({
      ...cache,
      watched: watched || cache.watched,
      watchlater: watchlater || cache.watchlater,
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
    setChangeOrigin('local')
    notify()
  }, [cache])

  // 批量刷新评分：找出 watched 中没有 ratings 的条目，逐个拉取
  const refreshAllRatings = useCallback(async (apiUrlFn, onProgress) => {
    const needRatings = cache.watched.filter((m) => !m.ratings)
    if (needRatings.length === 0) {
      onProgress?.({ done: 0, total: 0, msg: 'All ratings up to date' })
      return
    }
    let done = 0
    for (const m of needRatings) {
      try {
        // 先获取 imdb_id（如果条目没有的话）
        let imdbId = m.imdb_id
        if (!imdbId) {
          if (m.kind === 'tv') {
            // TV 没有 imdb_id，跳过
            done++
            onProgress?.({ done, total: needRatings.length, msg: `Skipped ${m.title} (TV)` })
            continue
          }
          const detailRes = await fetch(apiUrlFn(`/api/movie/${m.id}`))
          if (detailRes.ok) {
            const detail = await detailRes.json()
            imdbId = detail.imdb_id
          }
        }
        if (!imdbId) {
          done++
          onProgress?.({ done, total: needRatings.length, msg: `Skipped ${m.title} (no IMDb id)` })
          continue
        }
        const r = await fetch(apiUrlFn(`/api/ratings/${imdbId}?title=${encodeURIComponent(m.title)}&year=${m.year || ''}`))
        if (r.ok) {
          const data = await r.json()
          const key = entryKey(m.kind, m.id)
          const next = { ...cache, watched: cache.watched.map((w) =>
            entryKey(w.kind, w.id) === key ? { ...w, ratings: data, imdb_id: imdbId } : w
          )}
          write(next)
        }
      } catch {
        // 单个失败不影响整体
      }
      done++
      onProgress?.({ done, total: needRatings.length, msg: `Updated ${m.title}` })
      // 请求间隔避免 API 限流
      await new Promise((r) => setTimeout(r, 300))
    }
    onProgress?.({ done, total: needRatings.length, msg: 'Refresh complete' })
  }, [cache])

  // --- Likes：支持 movie / tv / genre / person 四类 ---
  const likeKey = (type, id) => `${type}:${id}`

  const toggleLike = useCallback((type, id, meta = {}) => {
    const key = likeKey(type, id)
    const likes = cache.likes || []
    const exists = likes.some((l) => likeKey(l.type, l.id) === key)
    if (exists) {
      write({ ...cache, likes: likes.filter((l) => likeKey(l.type, l.id) !== key) })
    } else {
      write({ ...cache, likes: [{ type, id, ...meta, addedAt: Date.now() }, ...likes] })
    }
  }, [])

  const removeFromLikes = useCallback((type, id) => {
    const key = likeKey(type, id)
    const likes = cache.likes || []
    write({ ...cache, likes: likes.filter((l) => likeKey(l.type, l.id) !== key) })
  }, [])

  const isInLikes = useCallback(
    (type, id) => (cache.likes || []).some((l) => likeKey(l.type, l.id) === likeKey(type, id)),
    [cache]
  )

  return {
    watched: store.watched,
    watchlater: store.watchlater,
    likes: store.likes || [],
    addToWatched,
    removeFromWatched,
    addToWatchLater,
    removeFromWatchLater,
    isInWatched,
    isInWatchLater,
    updateMyRating,
    updateRatings,
    updateTitle,
    refreshAllRatings,
    getNote,
    setNote,
    toggleLike,
    removeFromLikes,
    isInLikes,
  }
}

// ---- 云端同步层入口（非组件代码使用，见 ../sync/engine.js）----
// 复用同一 listeners 集合：write() 之后同步层与组件收到的是同一次通知。

export function subscribeLibrary(fn) {
  return subscribe(fn)
}

// 当前快照的原始引用。调用方只读，不要就地修改。
export function getLibraryState() {
  return { library: cache, notes: notesCache }
}

// 把合并结果写回：走 write/writeNotes，保证内存缓存、localStorage、
// 组件重渲染三者一起更新。library 必须整对象一次传入——分两次 write 会多通知一次，
// 中间还会短暂暴露「watched 已更新、likes 还是旧的」的混合状态。
export function applyRemoteLibrary(next) {
  write(next)
}

export function applyRemoteNotes(next) {
  writeNotes(next)
  notify()
}
