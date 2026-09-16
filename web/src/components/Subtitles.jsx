import { useState, useEffect } from 'react'
import { apiUrl } from '../api'

const LANGS = [
  { code: 'eng', label: 'English' },
  { code: 'chi', label: 'Chinese' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fre', label: 'French' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ger', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'rus', label: 'Russian' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
]

function DownloadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function SubtitleRow({ sub }) {
  return (
    <div className="flex items-start gap-3 border border-zinc-200 px-3 py-2.5 transition hover:border-zinc-400 hover:bg-zinc-50">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900" title={sub.filename}>{sub.filename}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-600">{sub.lang}</span>
          {sub.hearingImpaired && (
            <span className="border border-zinc-300 px-1.5 py-0.5 text-[10px] font-bold uppercase">HI</span>
          )}
          {sub.rating > 0 && (
            <span className="inline-flex items-center gap-0.5 font-medium text-amber-600">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
              </svg>
              {sub.rating.toFixed(1)}
            </span>
          )}
          {sub.downloads > 0 && (
            <span className="inline-flex items-center gap-0.5 text-zinc-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
              </svg>
              {sub.downloads.toLocaleString()}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={apiUrl(`/api/subtitle/download?url=${encodeURIComponent(sub.downloadUrl)}`)}
          download
          title="Download subtitle"
          aria-label="Download subtitle"
          className="flex h-8 w-8 items-center justify-center border border-zinc-300 text-zinc-700 transition hover:border-black hover:bg-black hover:text-white"
        >
          <DownloadIcon className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

export default function Subtitles({ movie, embed }) {
  const [lang, setLang] = useState('eng')
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetched, setFetched] = useState(false)

  const isTv = movie?.kind === 'tv'
  const imdbId = movie?.imdb_id
  const seasons = isTv && movie?.seasons ? movie.seasons : []

  useEffect(() => {
    if (!imdbId) return
    let cancelled = false
    setLoading(true)
    setError('')
    setFetched(false)
    const qs = new URLSearchParams({ imdb_id: imdbId, lang })
    if (season) qs.set('season', season)
    if (episode) qs.set('episode', episode)
    fetch(apiUrl(`/api/subtitles?${qs}`))
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setResults(d.results || [])
        setFetched(true)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load subtitles')
        setFetched(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [imdbId, lang, season, episode])

  if (!imdbId) return null

  const content = (
    <>
      {/* 控制行 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500">Lang</label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 focus:border-black focus:outline-none"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        {isTv && seasons.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500">Season</label>
            <select
              value={season}
              onChange={(e) => { setSeason(e.target.value); setEpisode('') }}
              className="border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 focus:border-black focus:outline-none"
            >
              <option value="">All</option>
              {seasons.map((s) => (
                <option key={s.number} value={s.number}>S{s.number}</option>
              ))}
            </select>
            {season && (
              <>
                <label className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500">Ep</label>
                <select
                  value={episode}
                  onChange={(e) => setEpisode(e.target.value)}
                  className="border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 focus:border-black focus:outline-none"
                >
                  <option value="">All</option>
                </select>
              </>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          Searching subtitles…
        </div>
      )}

      {error && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          {error}
        </div>
      )}

      {!loading && !error && fetched && results.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          No {LANGS.find(l => l.code === lang)?.label || ''} subtitles found.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((s, i) => (
            <SubtitleRow key={i} sub={s} />
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
        Subtitle data from OpenSubtitles.org
      </p>
    </>
  )

  if (embed) {
    return (
      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">Subtitles {results.length > 0 && `(${results.length})`}</h3>
        {content}
      </div>
    )
  }

  return content
}
