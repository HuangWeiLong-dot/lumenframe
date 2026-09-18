import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { FILMGRAB_BASE, downloadImage } from '../api'
import { useI18n } from '../i18n'

// 开发态默认走 Vite 的 /filmgrab 代理；公网构建只有配置了 VITE_FILMGRAB_BASE 才启用
// （FilmGrab 不接受爬取，请仅在自有/可信服务器上开启）
const ENABLED = FILMGRAB_BASE !== ''
// 列表：<挂载前缀>/screenshots
const listUrl = (qs) => `${FILMGRAB_BASE}/screenshots?${qs}`
// 接口返回 /api/proxy?url=...，把 /api 替换成对外挂载前缀
const rewrite = (u) => u.replace(/^\/api/, FILMGRAB_BASE)

export default function FilmGrabShots({ movie, selected, onSelect }) {
  const { t } = useI18n()
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

  // 未配置剧照服务或服务异常：显示区块 + 提示，而不是静默消失
  if (!ENABLED) {
    return (
      <CollapsibleSection title={t('filmGrab.title')}>
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.notConfigured')}
        </div>
      </CollapsibleSection>
    )
  }
  if (status === 'error') {
    return (
      <CollapsibleSection title={t('filmGrab.title')}>
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.error')}
        </div>
      </CollapsibleSection>
    )
  }

  const headerAction = (
    <a
      href="https://film-grab.com"
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs text-zinc-600 underline-offset-2 hover:underline"
    >
      {t('filmGrab.via')}
    </a>
  )

  return (
    <>
    <CollapsibleSection title={t('filmGrab.title')} count={shots.length} action={headerAction}>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.fetching')}
        </div>
      )}

      {status === 'done' && shots.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.emptyMovie')}
        </div>
      )}

      {status === 'done' && shots.length > 0 && (
        <>
          <p className="mb-3 text-xs text-zinc-700">{t('filmGrab.tapForCard')}</p>
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
                    aria-label={isSelected ? t('filmGrab.removeFromCard') : t('filmGrab.useOnCard')}
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
                    aria-label={t('filmGrab.preview')}
                    className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </button>

                  {isSelected && (
                    <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      {t('common.onCard')}
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
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(active, `${title} - still.jpg`) }}
            aria-label={t('filmGrab.download')}
            className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}
