import { useEffect, useState } from 'react'
import SmartImage from './SmartImage'
import { apiUrl, posterUrl } from '../api'

function formatLifeSpan(birth, death) {
  if (!birth) return null
  const start = birth.slice(0, 4)
  if (death) return `${start}–${death.slice(0, 4)}`
  return `b. ${start}`
}

function WorkCard({ work, onOpen }) {
  const poster = work.poster_path ? posterUrl(work.poster_path, 'w185') : null
  return (
    <button
      onClick={() => onOpen(work)}
      className="group flex flex-col gap-1 text-left"
      title={`${work.title}${work.year ? ` (${work.year})` : ''}`}
    >
      <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
        {poster ? (
          <SmartImage
            src={poster}
            alt={work.title}
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
        {work.title}
        {work.year && <span className="ml-1 font-normal text-zinc-500">{work.year}</span>}
      </p>
      {work.character && (
        <p className="truncate text-[11px] text-zinc-500">as {work.character}</p>
      )}
      {work.episode_count > 0 && (
        <p className="text-[11px] text-zinc-500">{work.episode_count} ep.</p>
      )}
      {work.vote_average > 0 && (
        <p className="text-[11px] font-semibold text-amber-600">★ {work.vote_average.toFixed(1)}</p>
      )}
    </button>
  )
}

function RoleSection({ title, movies, tv, onOpen }) {
  if (!movies.length && !tv.length) return null
  return (
    <section className="mt-8">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-600">{title}</h3>
      {movies.length > 0 && (
        <div className="mb-5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Films</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {movies.map((w) => (
              <WorkCard key={`m:${w.id}`} work={w} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      {tv.length > 0 && (
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">TV Shows</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {tv.map((w) => (
              <WorkCard key={`t:${w.id}`} work={w} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function PersonPage({ personId, onBack, onOpenMovie, onOpenShow }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    ;(async () => {
      try {
        const r = await fetch(apiUrl(`/api/person/${personId}/credits`))
        if (cancelled) return
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        setData(json)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load person')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [personId])

  // 点击作品：电影直接打开，TV（来自 TMDB id）需通过标题搜索 TVmaze 找到本地 ID 再打开
  async function handleOpenWork(work) {
    if (work.kind === 'movie') {
      onOpenMovie(work.id, { history: 'push' })
      return
    }
    // TV：TMDB id 与本站使用的 TVmaze id 不一致，先按 title+year 搜索
    try {
      const qs = new URLSearchParams({ q: work.title, limit: '3' })
      const r = await fetch(apiUrl(`/api/search?${qs}`))
      if (!r.ok) return
      const data = await r.json()
      const candidates = (data.results || []).filter((m) => m.kind === 'tv')
      const match = candidates.find((m) => m.year === work.year) || candidates[0]
      if (match) {
        onOpenShow(match.id, { history: 'push' })
      }
    } catch {
      /* swallow */
    }
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

      {loading && <p className="mt-8 text-sm text-zinc-600">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-500">{error}</p>}

      {data && (
        <>
          <header className="mt-6 flex flex-col items-center gap-6 sm:mt-8 sm:flex-row sm:items-start sm:gap-8">
            <div className="h-48 w-36 shrink-0 overflow-hidden bg-zinc-100 shadow-md ring-1 ring-black/5 sm:h-64 sm:w-44">
              {data.profile_path ? (
                <SmartImage
                  src={posterUrl(data.profile_path, 'w342')}
                  alt={data.name}
                  className="h-full w-full"
                  objectFit="cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400">
                  No photo
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
                {data.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-zinc-600 sm:justify-start">
                {data.known_for_department && (
                  <span className="font-medium text-zinc-800">{data.known_for_department}</span>
                )}
                {data.birthday && (
                  <>
                    <span className="text-zinc-300">•</span>
                    <span>{formatLifeSpan(data.birthday, data.deathday)}</span>
                  </>
                )}
                {data.place_of_birth && (
                  <>
                    <span className="text-zinc-300">•</span>
                    <span className="truncate">{data.place_of_birth}</span>
                  </>
                )}
              </div>
              {data.biography && (
                <p className="mt-4 line-clamp-6 text-sm leading-relaxed text-zinc-700">
                  {data.biography}
                </p>
              )}
            </div>
          </header>

          {data.credits && (
            <>
              <RoleSection
                title="Acting"
                movies={data.credits.acting.movies}
                tv={data.credits.acting.tv}
                onOpen={handleOpenWork}
              />
              <RoleSection
                title="Directing"
                movies={data.credits.directing.movies}
                tv={data.credits.directing.tv}
                onOpen={handleOpenWork}
              />
              <RoleSection
                title="Writing"
                movies={data.credits.writing.movies}
                tv={data.credits.writing.tv}
                onOpen={handleOpenWork}
              />
            </>
          )}

          {data.credits
            && data.credits.acting.movies.length === 0
            && data.credits.acting.tv.length === 0
            && data.credits.directing.movies.length === 0
            && data.credits.directing.tv.length === 0
            && data.credits.writing.movies.length === 0
            && data.credits.writing.tv.length === 0 && (
              <p className="mt-12 text-center text-sm text-zinc-500">
                No credits available for this person.
              </p>
            )}
        </>
      )}
    </div>
  )
}
