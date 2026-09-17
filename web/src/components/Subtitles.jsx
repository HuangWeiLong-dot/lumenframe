import { useState, useEffect, useMemo } from 'react'
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

// 从字幕文件名中解析季集号，返回 { season, episode } 或 null
function parseEpisode(filename) {
  if (!filename) return null
  const name = filename.toLowerCase()
  // S01E03 / s1e12 / 1x03 等常见格式
  const m = name.match(/s(\d{1,2})e(\d{1,3})/) || name.match(/(\d{1,2})x(\d{1,3})/)
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) }
  // "Episode 3" 格式
  const m2 = name.match(/episode\s*(\d{1,3})/)
  if (m2) return { season: null, episode: parseInt(m2[1]) }
  // "E03" 单独出现
  const m3 = name.match(/(^|[^0-9])e(\d{1,3})([^0-9]|$)/)
  if (m3) return { season: null, episode: parseInt(m3[2]) }
  return null
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

function EpisodeGroup({ epNum, subs }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-zinc-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between bg-zinc-50 px-3 py-2 text-left transition hover:bg-zinc-100"
      >
        <span className="text-sm font-semibold text-zinc-800">Episode {epNum}</span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {subs.length} subtitle{subs.length > 1 ? 's' : ''}
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 p-1.5">
          {subs.map((s, i) => (
            <SubtitleRow key={i} sub={s} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Subtitles({ movie, embed }) {
  const [lang, setLang] = useState('eng')
  const [season, setSeason] = useState('')
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
    const qs = new URLSearchParams({ imdb_id: imdbId, lang, query: movie.title })
    if (season) qs.set('season', season)
    // 不再发送 episode 参数，获取整季所有字幕
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
  }, [imdbId, lang, season])

  // 按集数分组排列
  const groupedResults = useMemo(() => {
    if (!isTv || !season) return null
    const groups = new Map() // epNum -> subs[]
    const unknown = []
    for (const sub of results) {
      const ep = parseEpisode(sub.filename)
      if (ep && ep.episode) {
        const arr = groups.get(ep.episode) || []
        arr.push(sub)
        groups.set(ep.episode, arr)
      } else {
        unknown.push(sub)
      }
    }
    // 按集数排序
    const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0])
    return { groups: sortedGroups, unknown }
  }, [results, isTv, season])

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
              onChange={(e) => setSeason(e.target.value)}
              className="border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 focus:border-black focus:outline-none"
            >
              <option value="">All</option>
              {seasons.map((s) => (
                <option key={s.number} value={s.number}>S{s.number}</option>
              ))}
            </select>
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
        isTv && season && groupedResults ? (
          <div className="space-y-2">
            {groupedResults.groups.map(([epNum, subs]) => (
              <EpisodeGroup key={epNum} epNum={epNum} subs={subs} />
            ))}
            {groupedResults.unknown.length > 0 && (
              <div className="border border-zinc-200">
                <div className="bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-800">
                  Other <span className="text-xs font-normal text-zinc-500">({groupedResults.unknown.length})</span>
                </div>
                <div className="space-y-1.5 p-1.5">
                  {groupedResults.unknown.map((s, i) => (
                    <SubtitleRow key={i} sub={s} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {results.map((s, i) => (
              <SubtitleRow key={i} sub={s} />
            ))}
          </div>
        )
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
