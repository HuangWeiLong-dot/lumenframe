import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { FILMGRAB_BASE } from '../api'

// 开发态默认走 Vite 的 /filmgrab 代理；公网构建只有配置了 VITE_FILMGRAB_BASE 才启用
// （FilmGrab 不接受爬取，请仅在自有/可信服务器上开启）
const ENABLED = FILMGRAB_BASE !== ''
// 列表：<挂载前缀>/screenshots
const listUrl = (qs) => `${FILMGRAB_BASE}/screenshots?${qs}`
// 接口返回 /api/proxy?url=...，把 /api 替换成对外挂载前缀
const rewrite = (u) => u.replace(/^\/api/, FILMGRAB_BASE)

export default function FilmGrabShots({ movie, selected, onSelect }) {
  const title = movie?.title
  const year = movie?.year || ''
  const [shots, setShots] = useState([])
  const [status, setStatus] = useState('loading') // loading | done | error
  const [active, setActive] = useState(null) // 灯箱当前图片

  useEffect(() => {
    if (!title || !ENABLED) return
    // 不用 AbortController：开发态 StrictMode 二次挂载会立即 abort 首个请求，
    // 浏览器会把取消的 fetch 以 net::ERR_ABORTED 打进控制台。
    // 延迟到下一个宏任务发起——StrictMode 的同步 cleanup 会清掉首个定时器，
    // 实际只发一次请求；过期/卸载后的响应直接丢弃。
    let alive = true
    setStatus('loading')
    setShots([])

    const timer = setTimeout(() => {
      const qs = `movie=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`
      fetch(listUrl(qs))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          setShots((data.screenshots || []).map(rewrite))
          setStatus('done')
        })
        .catch(() => {
          if (alive) setStatus('error')
        })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [title, year])

  // 关闭灯箱：Esc
  useEffect(() => {
    if (active == null) return
    const onKey = (e) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // 未配置剧照服务或服务异常时静默隐藏；正常返回但该片未收录时给出明确提示
  if (!ENABLED || status === 'error') return null

  const headerAction = (
    <a
      href="https://film-grab.com"
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs text-zinc-600 underline-offset-2 hover:underline"
    >
      via FilmGrab
    </a>
  )

  return (
    <>
    <CollapsibleSection title="Film Stills" count={shots.length} action={headerAction}>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          Fetching stills…
        </div>
      )}

      {status === 'done' && shots.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          No film stills available for this movie.
        </div>
      )}

      {status === 'done' && shots.length > 0 && (
        <>
          <p className="mb-3 text-xs text-zinc-700">Tap a still to use it on your generated card.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {shots.map((src, i) => {
              const isSelected = selected === src
              return (
                <div
                  key={i}
                  className={`group relative aspect-video overflow-hidden bg-zinc-100 transition ${
                    isSelected ? 'ring-2 ring-black ring-offset-2' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : src)}
                    className="absolute inset-0 h-full w-full"
                    aria-label={isSelected ? 'Remove still from card' : 'Use this still on card'}
                  >
                    <img
                      src={src}
                      alt={`${title} still ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      crossOrigin="anonymous"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                      onError={(e) => { e.currentTarget.closest('.group').style.display = 'none' }}
                    />
                  </button>

                  {/* 放大预览（不影响选图） */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setActive(src) }}
                    aria-label="Preview still"
                    className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
                  >
                    ⤢
                  </button>

                  {isSelected && (
                    <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      On card
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </CollapsibleSection>

      {active != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setActive(null)}
        >
          <img
            src={active}
            alt={`${title} still`}
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
        </div>
      )}
    </>
  )
}
