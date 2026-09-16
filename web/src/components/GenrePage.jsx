import { useEffect, useState } from 'react'
import SmartImage from './SmartImage'
import { apiUrl, posterUrl } from '../api'

function TitleCard({ item, onOpen, kind }) {
  const poster = item.poster_path ? posterUrl(item.poster_path, 'w185') : null
  return (
    <button
      onClick={() => onOpen(kind, item.id)}
      className="group flex flex-col gap-1 text-left"
      title={`${item.title}${item.year ? ` (${item.year})` : ''}`}
    >
      <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
        {poster ? (
          <SmartImage
            src={poster}
            alt={item.title}
            className="h-full w-full transition group-hover:opacity-80"
            objectFit="cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400">
            No poster
          </div>
        )}
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-tight text-zinc-900">
        {item.title}
        {item.year && <span className="ml-1 font-normal text-zinc-500">{item.year}</span>}
      </p>
      {item.rating > 0 && (
        <p className="text-[11px] font-semibold text-amber-600">★ {item.rating.toFixed(1)}</p>
      )}
    </button>
  )
}

export default function GenrePage({ kind, genreId, genreName, onBack, onOpenTitle }) {
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const r = await fetch(apiUrl(`/api/genre/${kind}/${genreId}?page=1`))
        if (cancelled) return
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setItems(data.items || [])
        setPage(1)
        setTotalPages(Math.min(data.total_pages || 1, 50))
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load titles')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [kind, genreId])

  async function loadMore() {
    if (page >= totalPages) return
    const next = page + 1
    try {
      const r = await fetch(apiUrl(`/api/genre/${kind}/${genreId}?page=${next}`))
      if (!r.ok) return
      const data = await r.json()
      setItems((prev) => [...prev, ...(data.items || [])])
      setPage(next)
    } catch { /* swallow */ }
  }

  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 sm:px-6"
      style={{ fontFamily: "'Inter', Arial, sans-serif" }}
    >
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-600 transition hover:text-black"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

      <h1 className="mt-4 text-3xl font-bold uppercase tracking-tight text-zinc-900 sm:text-4xl">
        {genreName || 'Genre'}
      </h1>
      <p className="mt-1 text-xs uppercase tracking-[0.25em] text-zinc-500">
        {kind === 'tv' ? 'TV Shows' : 'Movies'}
      </p>

      {loading && <p className="mt-8 text-sm text-zinc-600">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-500">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="mt-12 border border-dashed border-zinc-300 py-16 text-center">
          <p className="text-sm text-zinc-500">No titles found in this genre.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {items.map((m) => (
              <TitleCard key={`${kind}:${m.id}`} item={m} kind={kind} onOpen={onOpenTitle} />
            ))}
          </div>
          {page < totalPages && (
            <div className="mt-8 text-center">
              <button
                onClick={loadMore}
                className="border border-black px-6 py-2 text-xs uppercase tracking-[0.2em] text-black transition hover:bg-black hover:text-white"
              >
                Load More (Page {page + 1} / {totalPages})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
