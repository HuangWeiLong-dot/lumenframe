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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* 语言选择 */}
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

        {/* TV: 季/集选择 */}
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

      {/* 加载中 */}
      {loading && (
        <div className="flex items-center gap-2 py-3 text-sm text-zinc-500">
          <div className="h-4 w-4 animate-spin border-2 border-zinc-300 border-t-black"></div>
          Searching subtitles...
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 无结果 */}
      {!loading && !error && fetched && results.length === 0 && (
        <div className="py-3 text-sm text-zinc-500">No {LANGS.find(l => l.code === lang)?.label || ''} subtitles found.</div>
      )}

      {/* 字幕列表 */}
      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border border-zinc-200 bg-white px-3 py-2 hover:border-zinc-300"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">{s.filename}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                  <span>{s.lang}</span>
                  {s.hearingImpaired && (
                    <span className="border border-zinc-300 px-1 text-[10px] uppercase">HI</span>
                  )}
                  {s.rating > 0 && <span>★ {s.rating.toFixed(1)}</span>}
                  <span>↓ {s.downloads.toLocaleString()}</span>
                </div>
              </div>
              <a
                href={apiUrl(`/api/subtitle/download?url=${encodeURIComponent(s.downloadUrl)}`)}
                download
                className="border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-black hover:bg-black hover:text-white"
              >
                Download
              </a>
            </div>
          ))}
        </div>
      )}

      {/* 数据来源 */}
      <p className="mt-3 text-xs text-zinc-400">Subtitle data from OpenSubtitles.org</p>
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
