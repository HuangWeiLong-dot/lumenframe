import { useEffect, useState } from 'react'
import { apiUrl } from '../api'

// 模块级缓存 + 进行中的 Promise，确保 /api/trending 全应用只请求一次
let cache = null

// 预取脚本（vite.config.js 的 homePrefetch 插件注入到 index.html <head> 的内联脚本）
// 在 HTML 解析期就发起了同一个请求，这里直接复用它 —— 若等本模块的 effect 再发，
// 就要先等 200+ KB 主包下载并执行完，那正是 LCP 的 1,720ms「资源发现延迟」的来源。
// 预取脚本不存在（Node 里跑 scripts/sim、或插件被移除）时回落为下面的自建请求。
// 取用一次后置空：本模块随后仍自行管理 inFlight 的生命周期。
let inFlight =
  typeof window !== 'undefined' && window.__lfTrending ? window.__lfTrending : null
if (typeof window !== 'undefined') window.__lfTrending = null

export function useTrending() {
  const [posters, setPosters] = useState(cache || [])

  useEffect(() => {
    if (cache) return
    if (!inFlight) {
      inFlight = fetch(apiUrl('/api/trending'))
        .then((r) => r.json())
        .then((d) => d.posters || [])
        .catch(() => null)
    }
    let alive = true
    inFlight.then((list) => {
      // null = 请求失败。不写 cache，之后重新挂载（如切换路由回来）还能重试一次；
      // 空数组 [] 是合法结果（trending 为空），照常缓存。
      if (list) cache = list
      inFlight = null
      if (alive) setPosters(list || [])
    })
    return () => { alive = false }
  }, [])

  return posters
}
