import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { apiUrl, downloadImage } from '../api'
import { useI18n } from '../i18n'

// 剧集无原生 backdrop，用分集缩略图（16:9）作为 backdrops 来源。
// 数据走 /api/tv/:id/episodes（30 分钟缓存），与 ShowEpisodes 共享后端缓存。
export default function TvBackdrops({ show, selected, onSelect }) {
  const { t } = useI18n()
  const id = show?.id
  const title = show?.title
  const [shots, setShots] = useState([])
  const [status, setStatus] = useState('loading')
  const [active, setActive] = useState(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    setStatus('loading')
    setShots([])

    const timer = setTimeout(() => {
      fetch(apiUrl(`/api/tv/${id}/episodes`))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          const list = Array.isArray(data) ? data : (data.episodes || [])
          // 按图片 URL 去重，保留有图的分集
          const seen = new Set()
          const imgs = []
          for (const ep of list) {
            if (ep.image && !seen.has(ep.image)) {
              seen.add(ep.image)
              imgs.push(apiUrl(`/api/tv/image?u=${encodeURIComponent(ep.image)}`))
            }
          }
          setShots(imgs)
          setStatus('done')
        })
        .catch(() => { if (alive) setStatus('error') })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])

  useEffect(() => {
    if (active == null) return
    const onKey = (e) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (status === 'error') {
    return (
      <CollapsibleSection title={t('tvBackdrops.title')}>
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('tvBackdrops.error')}
        </div>
      </CollapsibleSection>
    )
  }

  return (
    <>
    <CollapsibleSection title={t('tvBackdrops.title')} count={shots.length}>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('tvBackdrops.loading')}
        </div>
      )}

      {status === 'done' && shots.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('tvBackdrops.empty')}
        </div>
      )}

      {status === 'done' && shots.length > 0 && (
        <>
          {/* 选中描边必须 ring-inset：外描边会被 CollapsibleSection 的 overflow-hidden 裁掉
              （最左/最右一列正好和网格同宽），且 ring-offset 的白圈画在黑圈**之上**、
              会在图片与黑边之间凿出一条白缝。inset 画在元素内部，永远裁不到。 */}
          <p className="mb-3 text-xs text-zinc-700">{t('tvBackdrops.tapForCard')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {shots.map((src, i) => {
              const isSelected = selected === src
              return (
                <div
                  key={src}
                  className={`group relative aspect-video overflow-hidden bg-zinc-100 transition ${
                    isSelected ? 'ring-2 ring-inset ring-black' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : src)}
                    className="absolute inset-0 h-full w-full"
                    aria-label={isSelected ? t('tvBackdrops.removeFromCard') : t('tvBackdrops.useOnCard')}
                  >
                    <img
                      src={src}
                      alt={`${title} backdrop ${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      crossOrigin="anonymous"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                      onError={(e) => { e.currentTarget.closest('.group').style.display = 'none' }}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setActive(src) }}
                    aria-label={t('tvBackdrops.preview')}
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
            alt={`${title} backdrop`}
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(active, `${title} - backdrop.jpg`) }}
            aria-label={t('tvBackdrops.download')}
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
