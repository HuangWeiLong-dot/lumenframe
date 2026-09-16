import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import SmartImage from './SmartImage'
import { apiUrl, posterFor } from '../api'

// 同类推荐：电影走 TasteDive(type=movie)+TMDB 解析，剧集走 TasteDive(type=show)+TVmaze 解析
export default function TasteDiveSimilar({ movie, onSelect, embed = false }) {
  const id = movie?.id
  const kind = movie?.kind === 'tv' ? 'tv' : 'movie'
  const title = movie?.title
  const year = movie?.year
  const [status, setStatus] = useState('loading')
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!id || !title) return
    let alive = true
    setStatus('loading')
    setItems([])

    const timer = setTimeout(() => {
      const q = new URLSearchParams({ title, year: year || '' })
      const endpoint =
        kind === 'tv' ? `/api/similar/tv/${id}?${q}` : `/api/similar/${id}?${q}`
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
  }, [id, kind, title, year])

  if (status === 'error') {
    const body = (
      <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
        Recommendations unavailable right now.
      </div>
    )
    return embed ? (
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">More Like This</h3>
        {body}
      </section>
    ) : (
      <CollapsibleSection title="More Like This">{body}</CollapsibleSection>
    )
  }

  const body = (
    <>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          Finding similar titles…
        </div>
      )}

      {status === 'done' && items.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          No similar titles found.
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
                <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
                  <SmartImage
                    src={poster}
                    alt={m.title}
                    className="h-full w-full"
                  />
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
            Recommendations by genre · posters by {kind === 'tv' ? 'TVmaze' : 'TMDB'}
          </p>
        </>
      )}
    </>
  )

  return embed ? (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">More Like This</h3>
      {body}
    </section>
  ) : (
    <CollapsibleSection title="More Like This" count={items.length} defaultOpen>
      {body}
    </CollapsibleSection>
  )
}
