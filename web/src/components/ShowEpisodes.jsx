import { useEffect, useMemo, useState } from 'react'
import { apiUrl, tvImageUrl, downloadImage } from '../api'
import CollapsibleSection from './CollapsibleSection'
import { useI18n } from '../i18n'

function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  const dt = new Date(Number(y), Number(m) - 1, Number(day))
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const chip = (active) =>
  `border px-2.5 py-1 text-xs uppercase tracking-wider transition ${
    active
      ? 'border-black bg-black text-white'
      : 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
  }`

// 剧集详情页：季选择 + 分集列表 + 分集剧照网格（可设为卡片主图）
export default function ShowEpisodes({ show, cardImage, onSelectCardImage }) {
  const { t } = useI18n()
  const [episodes, setEpisodes] = useState(null)
  const [error, setError] = useState(false)
  const [season, setSeason] = useState(1)
  const [active, setActive] = useState(null) // 灯箱

  useEffect(() => {
    let alive = true
    setEpisodes(null)
    setError(false)
    setSeason(1)
    fetch(apiUrl(`/api/tv/${show.id}/episodes`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((data) => { if (alive) setEpisodes(data.episodes || []) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [show.id])

  useEffect(() => {
    if (active == null) return
    const onKey = (e) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const seasonNumbers = useMemo(() => {
    if (!episodes) return show.seasons?.map((s) => s.number) || [1]
    return [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b)
  }, [episodes, show.seasons])

  const list = useMemo(
    () => (episodes || []).filter((e) => e.season === season),
    [episodes, season]
  )

  // 当前季有剧照的分集（用于 Episode Stills 网格）
  const stills = useMemo(
    () => list.filter((e) => e.image),
    [list]
  )

  const seasonInfo = show.seasons?.find((s) => s.number === season)

  return (
    <CollapsibleSection
      title={t('showEpisodes.title')}
      count={show.episodesCount || episodes?.length || 0}
      defaultOpen
    >
      {/* 季选择 chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {seasonNumbers.map((n) => (
          <button key={n} onClick={() => setSeason(n)} className={chip(season === n)}>
            {t('showEpisodes.season')} {n}
          </button>
        ))}
      </div>

      {episodes === null && !error && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('showEpisodes.loading')}
        </div>
      )}
      {error && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('showEpisodes.error')}
        </div>
      )}
      {episodes !== null && !error && list.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('showEpisodes.emptySeason')}
        </div>
      )}

      <div className="flex flex-col">
        {list.map((ep) => {
          const imgSrc = ep.image ? tvImageUrl(ep.image) : null
          const isSelected = !!imgSrc && cardImage === imgSrc
          return (
            <div
              key={`${ep.season}-${ep.number}`}
              className={`flex gap-4 border-b border-zinc-200 py-4 last:border-0 ${
                isSelected ? 'bg-zinc-50' : ''
              }`}
            >
              <div className="w-9 shrink-0 pt-0.5 text-sm font-bold tabular-nums text-zinc-400">
                {String(ep.number).padStart(2, '0')}
              </div>
              {imgSrc && (
                <button
                  type="button"
                  onClick={() => onSelectCardImage(isSelected ? null : imgSrc)}
                  className={`group relative hidden aspect-video w-36 shrink-0 overflow-hidden bg-zinc-100 sm:block ${
                    isSelected ? 'ring-4 ring-inset ring-white inset-ring-2 inset-ring-black' : ''
                  }`}
                  title={isSelected ? t('showEpisodes.removeFromCard') : t('showEpisodes.useOnCard')}
                >
                  <img
                    src={imgSrc}
                    alt=""
                    loading="lazy"
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover transition group-hover:opacity-80"
                  />
                  {isSelected && (
                    <span className="absolute bottom-1 left-1 bg-black px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                      {t('common.onCard')}
                    </span>
                  )}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">{ep.name}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {fmtDate(ep.airdate)}
                  {ep.runtime > 0 && ` · ${t('showEpisodes.runtime', { n: ep.runtime })}`}
                </p>
                {ep.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                    {ep.summary}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {seasonInfo?.network && (
        <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
          {t('showEpisodes.airedOn', { network: seasonInfo.network })}
        </p>
      )}

      {/* 分集剧照网格：当前季所有有剧照的分集，可设为卡片主图 */}
      {episodes !== null && !error && stills.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-5">
          <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-800">
            {t('showEpisodes.episodeStills')}
          </p>
          {/* 选中态是两条 inset 描边，都画在图片**内部** —— 外描边会被 CollapsibleSection
              的 overflow-hidden 裁掉（最左/最右一列正好和网格同宽）。
                外圈 2px 黑：inset-ring-2 inset-ring-black（box-shadow 列表里排在前面 = 画在上层）
                内圈 2px 白：ring-4 ring-inset ring-white（在下层，外侧 2px 被黑圈盖住）
              两条都要：亮图上黑圈可见、暗图上白圈可见，单靠任一条都有整类图看不出来。
              别改成外层 ring + ring-offset：offset 那层白圈在 box-shadow 列表里排在黑圈
              之前，即画在黑圈**之上**，会在黑边与图片之间凿出一条白缝。 */}
          <p className="mb-3 text-xs text-zinc-700">
            {t('showEpisodes.tapForCard')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {stills.map((ep) => {
              const src = tvImageUrl(ep.image)
              const isSelected = cardImage === src
              return (
                <div
                  key={`still-${ep.season}-${ep.number}`}
                  className={`group relative aspect-video overflow-hidden bg-zinc-100 transition ${
                    isSelected ? 'ring-4 ring-inset ring-white inset-ring-2 inset-ring-black' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectCardImage(isSelected ? null : src)}
                    className="absolute inset-0 h-full w-full"
                    aria-label={isSelected ? t('showEpisodes.removeFromCard') : t('showEpisodes.useOnCard')}
                  >
                    <img
                      src={src}
                      alt={`${ep.name} still`}
                      loading="lazy"
                      decoding="async"
                      crossOrigin="anonymous"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setActive(src) }}
                    aria-label={t('showEpisodes.preview')}
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
                  <span className="absolute left-2 top-2 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    S{ep.season}E{ep.number}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {active != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setActive(null)}
        >
          <img
            src={active}
            alt="episode still"
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(active, `${show.title} - still.jpg`) }}
            aria-label={t('showEpisodes.download')}
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
    </CollapsibleSection>
  )
}
