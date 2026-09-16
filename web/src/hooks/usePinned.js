import { useCallback, useEffect, useState } from 'react'
import { posterFor } from '../api'

const KEY = 'lumenframe:pinned:v1'
const MAX_PINS = 6

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch { /* ignore */ }
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
  }
  return base
}

export function usePinned() {
  const [pinned, setPinned] = useState(load)

  useEffect(() => {
    const handler = (e) => {
      if (e.key === KEY) setPinned(load())
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const isPinned = useCallback(
    (kind, id) => pinned.some((p) => entryKey(p.kind, p.id) === entryKey(kind, id)),
    [pinned]
  )

  const togglePin = useCallback((movie) => {
    setPinned((prev) => {
      const key = entryKey(movie.kind || 'movie', movie.id)
      const exists = prev.some((p) => entryKey(p.kind, p.id) === key)
      let next
      if (exists) {
        next = prev.filter((p) => entryKey(p.kind, p.id) !== key)
      } else {
        // 加到最前，超限弹出最旧的
        next = [toPinEntry(movie), ...prev].slice(0, MAX_PINS)
      }
      persist(next)
      return next
    })
  }, [])

  const removePin = useCallback((kind, id) => {
    setPinned((prev) => {
      const next = prev.filter((p) => entryKey(p.kind, p.id) !== entryKey(kind, id))
      persist(next)
      return next
    })
  }, [])

  return { pinned, isPinned, togglePin, removePin, MAX_PINS }
}

export { posterFor }
