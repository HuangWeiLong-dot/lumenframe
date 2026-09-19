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

// 短评存两代形态：旧版是裸字符串 '好看'，新版是 { text, addedAt }。
// addedAt 是同步层给「首次同步」播种时间戳的唯一依据（见 sync/engine.js 的 seedMeta）：
// 没有它就只能播成 0 = 年龄不详，首次登录必输给云端同一条。
// 旧形态补成 { text, addedAt: 0 }——行为与旧版一致，但文字一个字不丢。
//
// ⚠ 必须是 function 声明：上面 let notesCache = readNotes() 依赖函数提升
function normalizeNote(v) {
  if (typeof v === 'string') return { text: v, addedAt: 0 }
  if (!v || typeof v !== 'object' || typeof v.text !== 'string') return null
  return { text: v.text, addedAt: Number(v.addedAt) || 0 }
}

function normalizeNotes(obj) {
  const out = {}
  for (const [key, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    const note = normalizeNote(v)
    if (note) out[key] = note
  }
  return out
}

function readNotes() {
  return normalizeNotes(safeGetJSON(NOTES_KEY, null))
}

// localStorage 可能被隐私模式/浏览器策略禁用或写满：写失败只影响持久化，
// 不应让「加入观影库 / 评分 / 短评」等交互抛错崩掉页面（safeSet 见 ../storage）
//
// 归一化放在这里而不是只在读取时：writeNotes 也是 applyRemoteNotes 的落地口，
// 云端回来的形态必须与本地一致，否则每轮同步都会判定「投影变了」而反复重写。
function writeNotes(next) {
  notesCache = normalizeNotes(next)
  safeSet(NOTES_KEY, JSON.stringify(notesCache))
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

  // 语言切换后回填本地化元信息（标题 / 类型名 / 海报等）。
  // patch 字段可选：只覆盖传入的字段，未变则不写入、不触发渲染。
  // 本地存的是加入时的语言快照，切换后由上层（详情页 / 观影库页）回填当前语言版本。
  const updateEntryMeta = useCallback((kind, id, patch) => {
    if (!patch || typeof patch !== 'object') return
    const key = entryKey(kind, id)
    const applyPatch = (list) => {
      let changed = false
      const next = list.map((m) => {
        if (entryKey(m.kind, m.id) !== key) return m
        let cur = m
        if (patch.title != null && m.title !== patch.title) cur = { ...cur, title: patch.title }
        if (Array.isArray(patch.genres) && JSON.stringify(m.genres) !== JSON.stringify(patch.genres)) {
          cur = { ...cur, genres: patch.genres }
        }
        if (patch.poster_path != null && m.poster_path !== patch.poster_path) {
          cur = { ...cur, poster_path: patch.poster_path }
        }
        if (cur !== m) changed = true
        return cur
      })
      return changed ? next : null
    }
    const watched = applyPatch(cache.watched)
    const watchlater = applyPatch(cache.watchlater)
    if (!watched && !watchlater) return
    write({
      ...cache,
      watched: watched || cache.watched,
      watchlater: watchlater || cache.watchlater,
    })
  }, [cache])

  // 语言切换后批量回填本地化元信息：整批一次 write，
  // 少一次通知，也不会短暂暴露「一半条目已更新」的中间态
  const updateEntriesMeta = useCallback((updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return
    // 按 key 合并所有 patch；同 key 多次出现时后者覆盖前者
    const patches = new Map()
    for (const u of updates) {
      if (!u || typeof u !== 'object' || u.id == null) continue
      const key = entryKey(u.kind, u.id)
      patches.set(key, {
        title: u.title != null ? u.title : undefined,
        genres: Array.isArray(u.genres) ? u.genres : undefined,
        poster_path: u.poster_path != null ? u.poster_path : undefined,
      })
    }
    if (patches.size === 0) return
    const applyPatches = (list) => {
      let changed = false
      const next = list.map((m) => {
        const patch = patches.get(entryKey(m.kind, m.id))
        if (!patch) return m
        let cur = m
        if (patch.title !== undefined && m.title !== patch.title) cur = { ...cur, title: patch.title }
        if (patch.genres !== undefined && JSON.stringify(m.genres) !== JSON.stringify(patch.genres)) {
          cur = { ...cur, genres: patch.genres }
        }
        if (patch.poster_path !== undefined && m.poster_path !== patch.poster_path) {
          cur = { ...cur, poster_path: patch.poster_path }
        }
        if (cur !== m) changed = true
        return cur
      })
      return changed ? next : null
    }
    const watched = applyPatches(cache.watched)
    const watchlater = applyPatches(cache.watchlater)
    if (!watched && !watchlater) return
    write({
      ...cache,
      watched: watched || cache.watched,
      watchlater: watchlater || cache.watchlater,
    })
  }, [cache])

  // 短评：独立存储，不要求加入 watched；同步到 watched 条目里以便 Library 页和 Card Studio 使用
  const getNote = useCallback(
    (kind, id) => notesCache[entryKey(kind, id)]?.text || '',
    []
  )
  const setNote = useCallback((kind, id, text) => {
    const key = entryKey(kind, id)
    const next = { ...notesCache }
    // addedAt = 短评写下的时间：同步层把它当条目时间戳用（改一次就是一次新的修改）
    if (text) next[key] = { text, addedAt: Date.now() }
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

  // 语言切换后批量回填点赞条目的本地化名称 / 海报（标题类点赞存的是当初点赞时的语言）。
  // 传入项形如 { type, id, name?, poster? }；未变则不写入，整批一次 write。
  const updateLikesMeta = useCallback((updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return
    const patches = new Map()
    for (const u of updates) {
      if (!u || u.id == null || !u.type) continue
      const prev = patches.get(likeKey(u.type, u.id)) || {}
      patches.set(likeKey(u.type, u.id), {
        name: u.name != null ? u.name : prev.name,
        poster: u.poster != null ? u.poster : prev.poster,
      })
    }
    if (patches.size === 0) return
    const likes = cache.likes || []
    let changed = false
    const next = likes.map((l) => {
      const patch = patches.get(likeKey(l.type, l.id))
      if (!patch) return l
      let cur = l
      if (patch.name !== undefined && l.name !== patch.name) cur = { ...cur, name: patch.name }
      if (patch.poster !== undefined && l.poster !== patch.poster) cur = { ...cur, poster: patch.poster }
      if (cur !== l) changed = true
      return cur
    })
    if (!changed) return
    write({ ...cache, likes: next })
  }, [cache])

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
    updateEntryMeta,
    updateEntriesMeta,
    refreshAllRatings,
    getNote,
    setNote,
    toggleLike,
    removeFromLikes,
    isInLikes,
    updateLikesMeta,
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
