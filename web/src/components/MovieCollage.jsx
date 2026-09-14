import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTrending } from '../hooks/useTrending'
import { posterUrl } from '../api'

const GAP = 8

// 按容器实际宽度分档（首页通栏，所以不能用视口断点）：
// 窄手机 3 列 → 大屏手机 4 → 平板 5 → 桌面 6 → 宽屏 8
function colsForWidth(w) {
  if (w >= 1200) return 8
  if (w >= 960) return 6
  if (w >= 680) return 5
  if (w >= 480) return 4
  return 3
}

// 确定性伪随机（布局稳定，不随渲染跳动）
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 网格以"半张海报高"为单位行：
//   普通海报 = 1 列 × 2 单位行（2:3）
//   大海报   = 2 列 × 4 单位行（普通的 2 倍，同为 2:3）
// 逐 band 贪心装填：大海报纵向占据相邻两个 band，剩余列用普通海报补满。
// 总槽位恒为 cols*chunks，因此结果必为完整矩形——无缺口、无凸出。
function pack(movies, cols, chunks) {
  const occ = Array.from({ length: chunks }, () => Array(cols).fill(false))
  const items = []
  let mi = 0
  for (let r = 0; r < chunks; r++) {
    let c = 0
    while (c < cols) {
      if (mi >= movies.length) return items // 数据不足，直接结束（外层会因长度为 0 不渲染）
      if (occ[r][c]) { c++; continue }
      const canLarge =
        r < chunks - 1 &&
        c + 1 < cols &&
        !occ[r][c + 1] &&
        !occ[r + 1][c] &&
        !occ[r + 1][c + 1]
      const rnd = mulberry32(mi * 131 + r * 17 + c * 7 + 20240914)()
      if (canLarge && rnd < 0.26) {
        items.push({ m: movies[mi], col: c + 1, row: r * 2 + 1, cs: 2, rs: 4 })
        occ[r][c] = occ[r][c + 1] = occ[r + 1][c] = occ[r + 1][c + 1] = true
        c += 2
      } else {
        items.push({ m: movies[mi], col: c + 1, row: r * 2 + 1, cs: 1, rs: 2 })
        occ[r][c] = true
        c += 1
      }
      mi++
    }
  }
  return items
}

export default function MovieCollage({ onPick }) {
  const trending = useTrending()
  const wrapRef = useRef(null)
  const [cols, setCols] = useState(3)
  const [rowH, setRowH] = useState(100)
  const [totalW, setTotalW] = useState(null) // 列宽取整后网格实际像素宽（居中摆放）

  // 容器实测宽度 → 列数与单位行高。显式 px 列/行轨道，全部按整数像素锁定，
  // 消除 fr + 小数轨道在窄屏的 ±1px 取整抖动（双端海报比例恒定 2:3）。
  // 依赖 trending.length：首挂载时容器为空（无滚动条），数据渲染后必须重测一次。
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      // 列数只取决于容器自身宽度——iframe、缩放、滚动条出现都不会误判
      const nextCols = colsForWidth(w)
      const colW = Math.floor((w - (nextCols - 1) * GAP) / nextCols)
      const width = nextCols * colW + (nextCols - 1) * GAP
      // 普通海报高 = 整数 colW 的精确 1.5 倍；rowH 允许半像素，两轨 + gap 仍精确
      const posterH = Math.max(60, Math.round(colW * 1.5))
      setCols(nextCols)
      setTotalW(width)
      setRowH((posterH - GAP) / 2)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 双保险：部分环境（及移动端地址栏收放）依赖 resize 事件
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [trending.length])

  const items = useMemo(() => {
    const withPoster = trending.filter((m) => m.poster_path)
    // 只排完整 bands：chunks = floor(n / cols)，保证最后一行也被填满
    const chunks = Math.max(1, Math.floor(withPoster.length / cols))
    return pack(withPoster, cols, chunks)
  }, [trending, cols])

  // 注意：外层容器必须始终挂载——测量 effect 只跑一次，
  // 若数据未到时 return null，ref 为空会导致 ResizeObserver 永不初始化（冷加载必现）。
  // 取整后剩余的 0~cols-1 px 余量两侧均分 → 网格整体居中
  const colW = totalW != null ? (totalW - (cols - 1) * GAP) / cols : 0

  return (
    <div className="mt-12 pb-1" ref={wrapRef}>
      {items.length > 0 && (
        <div className="mx-auto" style={{ width: totalW }}>
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-zinc-700">Trending Now</p>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, ${colW}px)`,
              gridAutoRows: `${rowH}px`,
              gap: GAP,
            }}
          >
            {items.map(({ m, col, row, cs, rs }) => (
              <button
                key={m.id}
                onClick={() => onPick(m.id)}
                className="group relative overflow-hidden bg-zinc-100 text-left transition"
                style={{
                  gridColumn: `${col} / span ${cs}`,
                  gridRow: `${row} / span ${rs}`,
                  // 跨 2×2 格的格子本身是 1.48（gap 不可约），上下各侵入 gutter 2px，
                  // 可见盒子即严格 2:3；8px gap 仍余 6px，首尾行外扩 2px 落在相邻留白内。
                  ...(cs === 2 ? { margin: '-2px 0' } : null),
                }}
              >
                <img
                  src={posterUrl(m.poster_path, 'w342')}
                  alt={m.title}
                  loading="lazy"
                  decoding="async"
                  crossOrigin="anonymous"
                  className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
                {/* 悬浮片名条 */}
                <span
                  className="pointer-events-none absolute inset-x-0 bottom-0 p-2 pt-8 text-xs font-medium leading-tight text-white opacity-0 transition duration-200 group-hover:opacity-100"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0))' }}
                >
                  {m.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
