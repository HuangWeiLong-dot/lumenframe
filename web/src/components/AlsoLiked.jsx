import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import SmartImage from './SmartImage'
import { apiUrl, posterFor } from '../api'

// "看过这个的还喜欢"：基于 TasteDive 协同过滤推荐（与基于类别的 More Like This 互补）
export default function AlsoLiked({ movie, onSelect, embed = false }) {
  const id = movie?.id
  const kind = movie?.kind === 'tv' ? 'tv' : 'movie'
  const title = movie?.title
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
      const q = new URLSearchParams({ title, year: year || '', imdb: imdbId || '' })
      const endpoint =
        kind === 'tv' ? `/api/liked/tv/${id}?${q}` : `/api/liked/${id}?${q}`
      fetch(apiUrl(endpoint))
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
  }, [id, kind, title, year, imdbId])

  if (status === 'error') {
    const body = (
      <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
        Recommendations unavailable right now.
      </div>
    )
    return embed ? (
      <section className="mt-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">Viewers Also Liked</h3>
        {body}
      </section>
    ) : (
      <CollapsibleSection title="Viewers Also Liked">{body}</CollapsibleSection>
    )
  }

  const body = (
    <>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          Finding recommendations…
        </div>
      )}

      {status === 'done' && items.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          No recommendations found.
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
                  <SmartImage
                    src={poster}
                    alt={m.title}
                    aspect="2/3"
                    className="w-full"
                  />
                  <p className="mt-1 truncate text-xs font-medium text-zinc-800 group-hover:text-black">
                    {m.title}
                  </p>
                  <p className="text-[11px] text-zinc-500">{m.year || '—'}</p>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">
            Recommendations by TasteDive · posters by {kind === 'tv' ? 'TVmaze' : 'TMDB'}
          </p>
        </>
      )}
    </>
  )

  return embed ? (
    <section className="mt-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">Viewers Also Liked</h3>
      {body}
    </section>
  ) : (
    <CollapsibleSection title="Viewers Also Liked" count={items.length}>
      {body}
    </CollapsibleSection>
  )
}
