import { useEffect, useMemo, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { FILMGRAB_BASE } from '../api'

// 走 FilmGrab FastAPI 的 /api/torrent/v1（本地经 Vite /filmgrab 代理，
// 公网经 Nginx /filmgrab -> /api 重写）；未配置服务时显示未配置提示。
const ENABLED = FILMGRAB_BASE !== ''

// 电影向站点：并行查询、单点失败不影响其它站点。
// YTS 一个条目内嵌多清晰度 torrents[]，其余站点字段基本统一。
const SITES = [
  { id: 'yts', label: 'YTS' },
  { id: 'piratebay', label: 'Pirate Bay' },
  { id: '1337x', label: '1337x' },
  { id: 'tgx', label: 'TorrentGalaxy' },
]

const PER_SITE_LIMIT = 20
const DISPLAY_LIMIT = 30
const REQUEST_TIMEOUT = 15000

const QUALITY_STYLE = {
  '2160p': 'bg-violet-700 text-white',
  '1080p': 'bg-sky-700 text-white',
  '720p': 'bg-zinc-600 text-white',
  '480p': 'bg-zinc-400 text-white',
}

function cleanText(v) {
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
}

function toInt(v) {
  const n = parseInt(cleanText(v).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function qualityOf(name) {
  const n = cleanText(name).toLowerCase()
  if (/2160p|\b4k\b|\buhd\b/.test(n)) return '2160p'
  if (/1080p/.test(n)) return '1080p'
  if (/720p/.test(n)) return '720p'
  if (/480p/.test(n)) return '480p'
  return ''
}

// 各站点条目统一成一行；YTS 条目展开成多清晰度多行。
function normalize(item, siteId) {
  const base = {
    site: siteId,
    seeders: toInt(item.seeders),
    leechers: toInt(item.leechers),
    size: cleanText(item.size),
    date: cleanText(item.date),
    url: cleanText(item.url),
  }
  const rows = []
  const push = (name, magnet, torrent) => {
    const link = magnet || torrent || base.url
    rows.push({
      ...base,
      name: cleanText(name),
      magnet: cleanText(magnet),
      torrent: cleanText(torrent),
      link,
      quality: qualityOf(name),
    })
  }

  if (Array.isArray(item.torrents) && item.torrents.length > 0) {
    for (const t of item.torrents) {
      const q = cleanText(t.quality)
      const type = cleanText(t.type)
      push(
        `${cleanText(item.name)} ${q}${type ? ' ' + type : ''}`.trim(),
        t.magnet,
        t.torrent
      )
    }
  } else {
    push(item.name, item.magnet, item.torrent)
  }
  return rows.filter((r) => r.name && r.link)
}

async function searchSite(siteId, query) {
  const url =
    `${FILMGRAB_BASE}/torrent/v1/search?site=${encodeURIComponent(siteId)}` +
    `&query=${encodeURIComponent(query)}&limit=${PER_SITE_LIMIT}`

  // 后端无结果/被拦返回 4xx，按"该站点无结果"处理；
  // catch 吞掉错误避免控制台打印 uncaught rejection
  const fetchP = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const timeoutP = new Promise((resolve) =>
    setTimeout(() => resolve(null), REQUEST_TIMEOUT)
  )
  const data = await Promise.race([fetchP, timeoutP])
  if (!data) return []
  return (data.data || []).flatMap((item) => normalize(item, siteId))
}

function MagnetIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" />
      <path d="m5 8 4 4" />
      <path d="m12 15 4 4" />
    </svg>
  )
}

function ExternalIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

function TorrentRow({ row }) {
  return (
    <div className="flex items-start gap-3 border border-zinc-200 px-3 py-2.5 transition hover:border-zinc-400 hover:bg-zinc-50">
      <div className="min-w-0 flex-1">
        <a
          href={row.link}
          title={row.name}
          className="block truncate text-sm font-medium text-zinc-900 hover:underline"
        >
          {row.name}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          {row.quality && (
            <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${QUALITY_STYLE[row.quality]}`}>
              {row.quality}
            </span>
          )}
          <span className="font-semibold text-zinc-600">
            {SITES.find((s) => s.id === row.site)?.label || row.site}
          </span>
          {row.size && <span>{row.size}</span>}
          {row.seeders > 0 && (
            <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
              </svg>
              {row.seeders}
            </span>
          )}
          {row.leechers > 0 && (
            <span className="inline-flex items-center gap-0.5 text-zinc-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
              </svg>
              {row.leechers}
            </span>
          )}
          {row.date && <span className="text-zinc-400">{row.date}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {row.magnet ? (
          <a
            href={row.magnet}
            title="Open magnet link"
            aria-label="Open magnet link"
            className="flex h-8 w-8 items-center justify-center border border-zinc-300 text-zinc-700 transition hover:border-black hover:bg-black hover:text-white"
          >
            <MagnetIcon className="h-4 w-4" />
          </a>
        ) : (
          <span
            title="Magnet unavailable, open the detail page"
            className="flex h-8 w-8 cursor-not-allowed items-center justify-center border border-zinc-200 text-zinc-300"
          >
            <MagnetIcon className="h-4 w-4" />
          </span>
        )}
        {row.url && (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            title="Open source page"
            aria-label="Open source page"
            className="flex h-8 w-8 items-center justify-center border border-zinc-300 text-zinc-700 transition hover:border-black hover:bg-black hover:text-white"
          >
            <ExternalIcon className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  )
}

export default function Torrents({ movie }) {
  const title = movie?.title
  const year = movie?.year || ''
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading') // loading | done | error
  const [filter, setFilter] = useState('all')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!title || !ENABLED) return
    let alive = true
    setStatus('loading')
    setRows([])
    setFilter('all')

    const query = year ? `${title} ${year}` : title
    const timer = setTimeout(() => {
      Promise.allSettled(SITES.map((s) => searchSite(s.id, query))).then((results) => {
        if (!alive) return
        const merged = []
        results.forEach((r) => {
          if (r.status === 'fulfilled') merged.push(...r.value)
        })
        if (merged.length === 0) {
          setStatus('error')
          return
        }
        const seen = new Set()
        const deduped = []
        for (const row of merged) {
          const hash = row.magnet.match(/btih:([A-Za-z0-9]+)/)?.[1]?.toUpperCase()
          const key = hash || `${row.name}|${row.size}`
          if (seen.has(key)) continue
          seen.add(key)
          deduped.push(row)
        }
        deduped.sort((a, b) => b.seeders - a.seeders)
        setRows(deduped.slice(0, DISPLAY_LIMIT))
        setStatus('done')
      })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [title, year, nonce])

  const siteCounts = useMemo(() => {
    const counts = { all: rows.length }
    for (const r of rows) counts[r.site] = (counts[r.site] || 0) + 1
    return counts
  }, [rows])

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.site === filter)),
    [rows, filter]
  )

  // 未配置下载服务或全部站点都不可达：显示区块 + 提示
  if (!ENABLED) {
    return (
      <CollapsibleSection title="Downloads">
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          Downloads service is not configured.
        </div>
      </CollapsibleSection>
    )
  }
  if (status === 'error') {
    return (
      <CollapsibleSection title="Downloads">
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          All torrent sources are currently unavailable.
        </div>
      </CollapsibleSection>
    )
  }

  const headerAction = (
    <button
      type="button"
      onClick={() => setNonce((n) => n + 1)}
      disabled={status === 'loading'}
      className="shrink-0 text-xs text-zinc-600 underline-offset-2 hover:underline disabled:opacity-40"
    >
      Refresh
    </button>
  )

  return (
    <CollapsibleSection title="Downloads" count={rows.length} action={headerAction}>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          Searching torrent sources…
        </div>
      )}

      {status === 'done' && rows.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          No torrents found for this title.
        </div>
      )}

      {status === 'done' && rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <FilterChip
              label="All"
              count={siteCounts.all}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            {SITES.filter((s) => siteCounts[s.id] > 0).map((s) => (
              <FilterChip
                key={s.id}
                label={s.label}
                count={siteCounts[s.id]}
                active={filter === s.id}
                onClick={() => setFilter(s.id)}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            {visible.map((row, i) => (
              <TorrentRow key={`${row.site}-${i}-${row.link}`} row={row} />
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
            For educational purposes only. Do not distribute or disseminate.
          </p>
        </>
      )}
    </CollapsibleSection>
  )
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'border-black bg-black text-white'
          : 'border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:bg-zinc-50'
      }`}
    >
      {label}
      <span className={active ? 'ml-1.5 text-white/60' : 'ml-1.5 text-zinc-400'}>{count}</span>
    </button>
  )
}
