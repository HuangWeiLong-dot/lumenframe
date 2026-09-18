import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import SmartImage from './SmartImage'
import StatusBadge from './StatusBadge'
import { apiUrlWithLang, posterFor } from '../api'
import { useI18n } from '../i18n'

// "看过这个的还喜欢"：基于 TasteDive 协同过滤推荐（与基于类别的 More Like This 互补）
export default function AlsoLiked({ movie, onSelect, embed = false }) {
  const { t, apiLang } = useI18n()
  const id = movie?.id
  const kind = movie?.kind === 'tv' ? 'tv' : 'movie'
  const title = movie?.title
  // 后端用 TasteDive 协同过滤，只认英文片名：中文界面下传 title_en
  const matchTitle = movie?.title_en || title
  const year = movie?.year
  const imdbId = movie?.imdb_id || ''
  const [status, setStatus] = useState('loading')
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!id || !title) return
    let alive = true
    setStatus('loading')
    setItems([])

    const timer = setTimeout(() => {
      const q = new URLSearchParams({ title: matchTitle, year: year || '', imdb: imdbId || '' })
      const endpoint =
        kind === 'tv' ? `/api/liked/tv/${id}?${q}` : `/api/liked/${id}?${q}`
      fetch(apiUrlWithLang(endpoint))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          setItems(data.results || [])
          setStatus('done')
        })
        .catch(() => { if (alive) setStatus('error') })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
    // apiLang：切换语言后推荐列表也跟着本地化
  }, [id, kind, title, matchTitle, year, imdbId, apiLang])

  if (status === 'error') {
    const body = (
      <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
        {t('alsoLiked.unavailable')}
      </div>
    )
    return embed ? (
      <section className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">{t('alsoLiked.title')}</h3>
        {body}
      </section>
    ) : (
      <CollapsibleSection title={t('alsoLiked.title')}>{body}</CollapsibleSection>
    )
  }

  const body = (
    <>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          {t('alsoLiked.loading')}
        </div>
      )}

      {status === 'done' && items.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          {t('alsoLiked.empty')}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
            {items.map((m) => {
              const itemKind = m.tvmaze_id != null ? 'tv' : 'movie'
              const itemId = m.tvmaze_id ?? m.tmdb_id
              const poster = posterFor(
                itemKind === 'tv' ? { kind: 'tv', tvPoster: m.tvPoster } : { poster_path: m.poster_path },
                'w185'
              )
              return (
                <button
                  key={`${itemKind}:${itemId}`}
                  type="button"
                  onClick={() => onSelect?.(itemKind, itemId)}
                  className="group text-left"
                  title={m.title}
                >
                  <div className="relative">
                    <SmartImage
                      src={poster}
                      alt={m.title}
                      aspect="2/3"
                      className="w-full"
                    />
                    <StatusBadge kind={itemKind} id={itemId} size="md" />
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-zinc-800 group-hover:text-black">
                    {m.title}
                  </p>
                  <p className="text-[11px] text-zinc-500">{m.year || '—'}</p>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">
            {t('alsoLiked.attribution', { source: kind === 'tv' ? 'TVmaze' : 'TMDB' })}
          </p>
        </>
      )}
    </>
  )

  return embed ? (
    <section className="mt-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">{t('alsoLiked.title')}</h3>
      {body}
    </section>
  ) : (
    <CollapsibleSection title={t('alsoLiked.title')} count={items.length}>
      {body}
    </CollapsibleSection>
  )
}
