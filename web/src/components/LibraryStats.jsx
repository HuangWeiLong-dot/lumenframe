import { useEffect, useRef, useMemo, useState } from 'react'
import Chart from 'chart.js/auto'
import { posterFor } from '../api'
import { useI18n } from '../i18n'
import SmartImage from './SmartImage'

// 深色调色板：符合网站 zinc 基调
const PALETTE = [
  '#18181b', '#27272a', '#3f3f46', '#52525b', '#71717a',
  '#1e293b', '#1c1917', '#312e81', '#292524', '#0f172a',
]
const DARK = '#18181b'

const RATING_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

function aggregate(items, field, limit = 10) {
  const counts = {}
  for (const m of items) {
    const val = m[field]
    if (!val) continue
    if (Array.isArray(val)) {
      const seen = new Set()
      for (const v of val) {
        const name = typeof v === 'object' ? v?.name : v
        if (!name || seen.has(name)) continue
        seen.add(name)
        counts[name] = (counts[name] || 0) + 1
      }
    } else {
      counts[val] = (counts[val] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
}

function formatRuntime(totalMin) {
  if (!totalMin) return '0m'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function formatWatchTime(totalMin) {
  if (!totalMin) return '0h'
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
}

function itemTotalRuntime(m) {
  if (m.kind === 'tv') return (m.runtime || 0) * (m.episodesCount || 0)
  return m.runtime || 0
}

function StatCard({ label, value, sub }) {
  return (
    <div className="border border-zinc-200 p-4 text-center">
      <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-black">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

function ChartCard({ title, children, span = 1, hasData = true }) {
  const { t } = useI18n()
  return (
    <div className={`border border-zinc-200 p-4 ${span === 2 ? 'sm:col-span-2' : ''}`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">{title}</h3>
      <div className="relative" style={{ height: '240px' }}>
        {hasData ? children : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            {t('stats.noData')}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LibraryStats({ watched, onRefreshRatings }) {
  const { t } = useI18n()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const handleRefresh = async () => {
    if (refreshing || !onRefreshRatings) return
    setRefreshing(true)
    setRefreshMsg(t('stats.starting'))
    await onRefreshRatings(({ done, total, msg }) => {
      if (total > 0) setRefreshMsg(`${done}/${total} — ${msg}`)
      else setRefreshMsg(msg)
    })
    setRefreshing(false)
    setTimeout(() => setRefreshMsg(''), 5000)
  }

  const missingRatings = watched.filter((m) => !m.ratings && m.kind !== 'tv').length

  if (watched.length < 3) {
    return (
      <div className="border border-dashed border-zinc-300 py-12 text-center">
        <p className="text-sm text-zinc-500">{t('stats.needMore')}</p>
      </div>
    )
  }

  const movies = watched.filter((m) => m.kind !== 'tv')
  const shows = watched.filter((m) => m.kind === 'tv')

  const totalRuntime = watched.reduce((sum, m) => sum + itemTotalRuntime(m), 0)
  const movieRuntime = movies.reduce((sum, m) => sum + itemTotalRuntime(m), 0)
  const ratedItems = watched.filter((m) => m.myRating > 0)
  const avgMyRating = ratedItems.length
    ? (ratedItems.reduce((s, m) => s + m.myRating, 0) / ratedItems.length).toFixed(1)
    : '—'
  const avgExternal = (watched.reduce((s, m) => s + (m.rating || 0), 0) / watched.length).toFixed(1)
  const avgExternalLabel = shows.length > movies.length ? 'TVmaze' : 'TMDB'

  const topDirectors = useMemo(() => aggregate(movies, 'director', 8), [movies])
  const topGenres = useMemo(() => aggregate(watched, 'genres', 10), [watched])

  const ratingBuckets = useMemo(() => {
    const buckets = Array(10).fill(0)
    for (const m of watched) {
      if (m.myRating >= 1 && m.myRating <= 10) buckets[m.myRating - 1]++
    }
    return buckets
  }, [watched])

  const recentlyAdded = useMemo(() => {
    return [...watched]
      .filter((m) => m.addedAt)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 5)
  }, [watched])

  const topDirectorsData = useMemo(() => ({
    labels: topDirectors.map(([n]) => n),
    values: topDirectors.map(([, c]) => c),
  }), [topDirectors])
  const topGenresData = useMemo(() => ({
    labels: topGenres.map(([n]) => n),
    values: topGenres.map(([, c]) => c),
  }), [topGenres])

  return (
    <>
      {/* Refresh ratings bar */}
      {missingRatings > 0 && onRefreshRatings && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-zinc-700">
              {t('stats.missingRatings', { n: missingRatings, m: missingRatings > 1 ? 's' : '' })}
            </span>
            {refreshMsg && <span className="text-xs text-zinc-500">{refreshMsg}</span>}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`border px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
              refreshing
                ? 'border-zinc-200 bg-zinc-100 text-zinc-400'
                : 'border-black bg-black text-white hover:bg-zinc-800'
            }`}
          >
            {refreshing ? t('stats.refreshing') : t('stats.refreshRatings')}
          </button>
        </div>
      )}

      {/* 4 张汇总卡 */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('stats.titles')} value={watched.length} sub={t('stats.filmsShows', { films: movies.length, shows: shows.length })} />
        <StatCard label={t('stats.watchTime')} value={formatWatchTime(totalRuntime)} sub={movies.length ? t('stats.filmsRuntime', { runtime: formatRuntime(movieRuntime) }) : null} />
        <StatCard label={t('stats.avgMyRating')} value={avgMyRating} sub={t('stats.rated', { n: ratedItems.length })} />
        <StatCard label={t('stats.avgExternal', { source: avgExternalLabel })} value={avgExternal} />
      </div>

      {/* 4 张图：My Rating 分布、Genre 分布、Top Directors、Watch Timeline */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChartCard title={t('stats.myRatingDistribution')} hasData={ratedItems.length > 0}>
          <BarChart labels={RATING_LABELS} values={ratingBuckets} color={DARK} indexAxis="x" />
        </ChartCard>
        <ChartCard title={t('stats.genreDistribution')} hasData={topGenresData.labels.length > 0}>
          <DoughnutChart labels={topGenresData.labels} values={topGenresData.values} />
        </ChartCard>
        <ChartCard title={t('stats.topDirectors')} hasData={topDirectorsData.labels.length > 0}>
          <BarChart labels={topDirectorsData.labels} values={topDirectorsData.values} color={DARK} />
        </ChartCard>
        <ChartCard title={t('stats.watchTimeline')} hasData={watched.some((m) => m.addedAt)}>
          <TimelineChart items={watched} />
        </ChartCard>
      </div>

      {/* Recently Added */}
      <div className="mt-6 border border-zinc-200 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">
          {t('stats.recentlyAdded')}
        </h3>
        {recentlyAdded.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-400">{t('stats.noActivity')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recentlyAdded.map((m) => (
              <li key={`${m.kind}:${m.id}`} className="flex items-center gap-3">
                <div className="h-16 w-11 shrink-0 overflow-hidden bg-zinc-100">
                  <SmartImage src={posterFor(m, 'w185')} alt={m.title} className="h-full w-full" objectFit="cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">{m.title}</p>
                  <p className="text-xs text-zinc-500">
                    {m.year || m.yearRange}
                    {m.myRating > 0 && <span className="ml-1 text-amber-600">· ★ {m.myRating}</span>}
                  </p>
                </div>
                <span className="ml-auto shrink-0 text-xs text-zinc-400">
                  {new Date(m.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function BarChart({ labels, values, color = '#18181b', indexAxis = 'y' }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current?.destroy?.()
    const bg = Array.isArray(color) ? color : color
    const bc = Array.isArray(color) ? color : color
    chartRef.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: bg, borderColor: bc, borderWidth: 0, borderRadius: 2 }],
      },
      options: {
        indexAxis,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: indexAxis === 'y' }, ticks: { font: { size: 10 }, color: '#71717a', autoSkip: false, maxRotation: 45 } },
          y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#3f3f46' } },
        },
      },
    })
    return () => chartRef.current?.destroy?.()
  }, [labels, values, color, indexAxis])

  return <canvas ref={ref} />
}

function DoughnutChart({ labels, values, colors }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const hasData = values.some((v) => v > 0)
    if (!hasData) {
      chartRef.current?.destroy?.()
      chartRef.current = null
      return
    }
    chartRef.current?.destroy?.()
    const bg = colors || PALETTE
    chartRef.current = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: bg, borderColor: '#fff', borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { font: { size: 10 }, color: '#3f3f46', boxWidth: 12 } } },
      },
    })
    return () => chartRef.current?.destroy?.()
  }, [labels, values])

  return <canvas ref={ref} />
}

function TimelineChart({ items }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const sorted = [...items].filter((m) => m.addedAt).sort((a, b) => a.addedAt - b.addedAt)
    if (sorted.length === 0) {
      chartRef.current?.destroy?.()
      chartRef.current = null
      return
    }
    let cum = 0
    const labels = sorted.map((m) => new Date(m.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    const data = sorted.map((m) => { cum += itemTotalRuntime(m); return cum })
    chartRef.current?.destroy?.()
    chartRef.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{ data, borderColor: PALETTE[0], backgroundColor: 'rgba(24,24,27,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: PALETTE[0] }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#71717a', maxRotation: 45 } },
          y: { grid: { color: '#f4f4f5' }, ticks: { font: { size: 10 }, color: '#71717a', callback: (v) => `${Math.floor(v / 60)}h ${v % 60}m` } },
        },
      },
    })
    return () => chartRef.current?.destroy?.()
  }, [items])

  return <canvas ref={ref} />
}
