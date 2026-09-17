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

export default function GenrePage({ kind, genreId, genreName, isInLikes, toggleLike, onBack, onOpenTitle }) {
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

      <div className="relative mt-4">
        <button
          onClick={() => {
            if (isInLikes('genre', genreId)) {
              toggleLike('genre', genreId)
            } else {
              toggleLike('genre', genreId, {
                name: genreName || 'Genre',
                kind,
              })
            }
          }}
          aria-label={isInLikes('genre', genreId) ? 'Remove from likes' : 'Add to likes'}
          title={isInLikes('genre', genreId) ? 'Remove from likes' : 'Add to likes'}
          className={`absolute -top-2 right-0 z-10 flex h-8 w-8 items-center justify-center transition hover:opacity-70 ${
            isInLikes('genre', genreId) ? 'text-red-500' : 'text-zinc-300 hover:text-zinc-500'
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isInLikes('genre', genreId) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
          </svg>
        </button>
        <h1 className="text-3xl font-bold uppercase tracking-tight text-zinc-900 sm:text-4xl">
          {genreName || 'Genre'}
        </h1>
      </div>
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
            <div className="mt-8 mb-8 text-center">
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
