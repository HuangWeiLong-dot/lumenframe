import { useEffect, useState } from 'react'
import { apiUrl } from '../api'

// 模块级缓存 + 进行中的 Promise，确保 /api/trending 全应用只请求一次
let cache = null
let inFlight = null

export function useTrending() {
  const [posters, setPosters] = useState(cache || [])

  useEffect(() => {
    if (cache) return
    if (!inFlight) {
      inFlight = fetch(apiUrl('/api/trending'))
        .then((r) => r.json())
        .then((d) => {
          cache = d.posters || []
          inFlight = null
          return cache
        })
        .catch(() => {
          inFlight = null
          return []
        })
    }
    let alive = true
    inFlight.then((list) => { if (alive) setPosters(list) })
    return () => { alive = false }
  }, [])

  return posters
}
