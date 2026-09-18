import { useSyncExternalStore, useCallback } from 'react'
import { posterFor } from '../api'
import { safeGetJSON, safeSet, setChangeOrigin } from '../storage'

const KEY = 'lumenframe:pinned:v1'
const MAX_PINS = 6

function load() {
  const parsed = safeGetJSON(KEY, null)
  // 每次都返回新数组：emit() 靠引用变化触发 useSyncExternalStore 重渲染
  return Array.isArray(parsed) ? parsed : []
}

function entryKey(kind, id) {
  return `${kind}:${id}`
}

function toPinEntry(movie) {
  const isTv = movie.kind === 'tv'
  const base = {
    kind: movie.kind || 'movie',
    id: movie.id,
    title: movie.title,
    year: movie.year || null,
    yearRange: isTv ? (movie.yearRange || '') : null,
    poster_path: movie.poster_path || null,
    tvPoster: isTv ? (movie.tvPoster || null) : null,
    // 云端合并后要靠它恢复「新的在前」的顺序（合并是按键求并集，不保留数组次序），
    // 同时充当该条目首次同步时的时间戳种子
    addedAt: movie.addedAt || Date.now(),
  }
  return base
}

// module-level store（与 useLibrary / i18n 同一套骨架）：
// 组件内 useState 版本下，同页两个调用方互相看不见，云端同步层也读不到、写不进。
let cache = load()
const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

// 从存储重读（storage 事件：其它标签页写入后同步）
// 标记来源为 external，同 useLibrary.emit()：外部清空不得被当成用户取消 pin。
function emit() {
  cache = load()
  setChangeOrigin('external')
  notify()
}

function onStorage(e) {
  // e.key === null 表示 storage.clear()
  if (e.key === null || e.key === KEY) emit()
}

function subscribe(fn) {
  listeners.add(fn)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

function write(next) {
  cache = next
  safeSet(KEY, JSON.stringify(next))
  setChangeOrigin('local')
  notify()
}

export function usePinned() {
  const store = useSyncExternalStore(subscribe, () => cache, () => cache)

  const isPinned = useCallback(
    (kind, id) => cache.some((p) => entryKey(p.kind, p.id) === entryKey(kind, id)),
    [cache]
  )

  const togglePin = useCallback((movie) => {
    const key = entryKey(movie.kind || 'movie', movie.id)
    const exists = cache.some((p) => entryKey(p.kind, p.id) === key)
    // 写入时**不**按 MAX_PINS 裁剪：挤掉最旧的一条会让云端同步把它当成用户删除，
    // 另一台还留着它的设备再推回来，形成删除/复活的来回拉锯。
    // 上限只在渲染时生效（见下方 pinned），被挤掉的条目仍留在存储里，取消其它 Pin 即可回来。
    write(
      exists
        ? cache.filter((p) => entryKey(p.kind, p.id) !== key)
        : [toPinEntry(movie), ...cache]
    )
  }, [])

  const removePin = useCallback((kind, id) => {
    write(cache.filter((p) => entryKey(p.kind, p.id) !== entryKey(kind, id)))
  }, [])

  // 语言切换后回填最新标题（条目不存在或标题没变时不写入、不触发重渲染）
  const updateEntry = useCallback((kind, id, patch = {}) => {
    const key = entryKey(kind, id)
    let changed = false
    const next = cache.map((p) => {
      if (entryKey(p.kind, p.id) !== key) return p
      if (patch.title != null && patch.title !== p.title) {
        changed = true
        return { ...p, ...patch }
      }
      return p
    })
    if (!changed) return
    write(next)
  }, [])

  return { pinned: store.slice(0, MAX_PINS), isPinned, togglePin, removePin, updateEntry, MAX_PINS }
}

// ---- 云端同步层入口（非组件代码使用，见 ../sync/engine.js）----

export function subscribePinned(fn) {
  return subscribe(fn)
}

// 当前快照的原始引用（**未**裁到 MAX_PINS，同步层要看到全部）。
// 调用方只读，不要就地修改。
export function getPinnedState() {
  return cache
}

export function applyRemotePinned(next) {
  write(Array.isArray(next) ? next : [])
}

export { posterFor }
