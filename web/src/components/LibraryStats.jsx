import { useEffect, useRef, useMemo, useState } from 'react'
import Chart from 'chart.js/auto'
import { posterFor } from '../api'
import SmartImage from './SmartImage'

// 深色调色板：符合网站 zinc 基调，大部分图表使用深色
const PALETTE = [
  '#18181b', '#27272a', '#3f3f46', '#52525b', '#71717a',
  '#1e293b', '#1c1917', '#312e81', '#292524', '#0f172a',
]
// 默认深色（柱状图）
const DARK = '#18181b'
// Metacritic 0-100 分桶：红 → 琥珀 → 绿
const MC_COLORS = [
  '#dc2626', '#dc2626', '#dc2626', '#dc2626', '#f97316',
  '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#16a34a',
]
// Rotten Tomatoes：Fresh 绿 / Rotten 红 / No RT 灰
const RT_COLORS = ['#16a34a', '#dc2626', '#a1a1aa']

// 稳定的标签数组（避免每次渲染新建引用触发 chart 重建）
const RATING_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
const MC_LABELS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100']
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RT_SPLIT_LABELS = ['Fresh', 'Rotten', 'No RT']

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

// TV 的 year 是首播年字符串；movies 的 year 也是字符串。直接用 year 就行
function decadeOf(item) {
  const y = Number(item.year)
  if (!y || Number.isNaN(y)) return null
  const d = Math.floor(y / 10) * 10
  return `${d}s`
}

// 单条目的总观看时长：电影=runtime；剧集=单集时长×集数
function itemTotalRuntime(m) {
  if (m.kind === 'tv') {
    return (m.runtime || 0) * (m.episodesCount || 0)
  }
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
  return (
    <div className={`border border-zinc-200 p-4 ${span === 2 ? 'sm:col-span-2' : ''}`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">{title}</h3>
      <div className="relative" style={{ height: '240px' }}>
        {hasData ? children : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            No data available
          </div>
        )}
      </div>
    </div>
  )
}

export default function LibraryStats({ watched, onRefreshRatings }) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const handleRefresh = async () => {
    if (refreshing || !onRefreshRatings) return
    setRefreshing(true)
    setRefreshMsg('Starting...')
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
        <p className="text-sm text-zinc-500">
          Add at least 3 movies to your watched list to see meaningful statistics.
        </p>
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

  // 多源外部评分聚合（IMDb / RT / MC / Popcornmeter）
  const itemsWithRatings = watched.filter((m) => m.ratings)
  const avgImdb = (() => {
    const xs = itemsWithRatings.map((m) => m.ratings.imdb).filter((v) => v != null)
    return xs.length ? (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1) : null
  })()
  const avgRt = (() => {
    const xs = itemsWithRatings.map((m) => m.ratings.rotten_tomatoes).filter((v) => v != null)
    return xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null
  })()
  const avgMc = (() => {
    const xs = itemsWithRatings.map((m) => m.ratings.metacritic).filter((v) => v != null)
    return xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null
  })()
  const avgPopcorn = (() => {
    const xs = itemsWithRatings.map((m) => m.ratings.popcornmeter).filter((v) => v != null)
    return xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null
  })()
  const ratedRtCount = itemsWithRatings.filter((m) => m.ratings.rotten_tomatoes != null).length
  const ratedMcCount = itemsWithRatings.filter((m) => m.ratings.metacritic != null).length
  const ratedImdbCount = itemsWithRatings.filter((m) => m.ratings.imdb != null).length
  const ratedPopcornCount = itemsWithRatings.filter((m) => m.ratings.popcornmeter != null).length

  // 分布统计
  const topDirectors = useMemo(() => aggregate(movies, 'director', 8), [movies])
  const topWriters = useMemo(() => aggregate(movies, 'writers', 8), [movies])
  const topActors = useMemo(() => aggregate(watched, 'cast', 8), [watched])
  const topGenres = useMemo(() => aggregate(watched, 'genres', 10), [watched])
  const topNetworks = useMemo(() => aggregate(shows, 'network', 6), [shows])

  // 年代分布
  const decades = useMemo(() => {
    const counts = {}
    for (const m of watched) {
      const d = decadeOf(m)
      if (!d) continue
      counts[d] = (counts[d] || 0) + 1
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  }, [watched])

  // 各 genre 的平均 myRating
  const genreAvgRating = useMemo(() => {
    const sums = {}
    const counts = {}
    for (const m of watched) {
      if (!m.myRating || !m.genres?.length) continue
      for (const g of m.genres) {
        sums[g] = (sums[g] || 0) + m.myRating
        counts[g] = (counts[g] || 0) + 1
      }
    }
    return Object.entries(sums)
      .map(([g, s]) => ({ name: g, avg: s / counts[g], count: counts[g] }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8)
  }, [watched])

  // My Rating 分布（1-10 桶）
  const ratingBuckets = useMemo(() => {
    const buckets = Array(10).fill(0)
    for (const m of watched) {
      if (m.myRating >= 1 && m.myRating <= 10) buckets[m.myRating - 1]++
    }
    return buckets
  }, [watched])

  // Metacritic 0-100 分桶
  const mcBuckets = useMemo(() => {
    const buckets = Array(10).fill(0)
    for (const m of itemsWithRatings) {
      const v = m.ratings.metacritic
      if (v == null || v < 0 || v > 100) continue
      buckets[Math.min(9, Math.floor(v / 10))]++
    }
    return buckets
  }, [itemsWithRatings])

  const rtBuckets = useMemo(() => {
    const fresh = { fresh: 0, rotten: 0, none: 0 }
    for (const m of itemsWithRatings) {
      const v = m.ratings.rotten_tomatoes
      if (v == null) fresh.none++
      else if (v >= 60) fresh.fresh++
      else fresh.rotten++
    }
    return fresh
  }, [itemsWithRatings])

  // 加入观影库时的星期分布
  const weekdayBuckets = useMemo(() => {
    const buckets = Array(7).fill(0)
    for (const m of watched) {
      if (!m.addedAt) continue
      const day = new Date(m.addedAt).getDay()
      buckets[day]++
    }
    return buckets
  }, [watched])

  // Top 5 最高评分
  const topRated = useMemo(() => {
    return [...ratedItems]
      .sort((a, b) => b.myRating - a.myRating || (b.rating || 0) - (a.rating || 0))
      .slice(0, 5)
  }, [ratedItems])

  // Top 5 最长（按总观看时长，TV 用 单集×集数）
  const longest = useMemo(() => {
    return [...watched]
      .map((m) => ({ ...m, _totalRuntime: itemTotalRuntime(m) }))
      .filter((m) => m._totalRuntime > 0)
      .sort((a, b) => b._totalRuntime - a._totalRuntime)
      .slice(0, 5)
  }, [watched])

  // 最近加入
  const recentlyAdded = useMemo(() => {
    return [...watched]
      .filter((m) => m.addedAt)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 5)
  }, [watched])

  // 评分 vs 片长（散点）
  const ratingVsRuntime = useMemo(() => {
    return ratedItems
      .map((m) => ({ x: itemTotalRuntime(m), y: m.myRating, title: m.title, kind: m.kind, id: m.id, runtime: itemTotalRuntime(m) }))
      .filter((p) => p.x > 0)
  }, [ratedItems])

  // 最常见组合：导演 × 主演
  const directorActorPairs = useMemo(() => {
    const counts = {}
    for (const m of movies) {
      if (!m.director || !m.cast?.length) continue
      for (const c of m.cast.slice(0, 2)) {
        const key = `${m.director} × ${c.name}`
        counts[key] = (counts[key] || 0) + 1
      }
    }
    return Object.entries(counts)
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [movies])

  // 稳定化的 chart 数据（避免每次渲染新建数组）
  const topDirectorsData = useMemo(() => ({
    labels: topDirectors.map(([n]) => n),
    values: topDirectors.map(([, c]) => c),
  }), [topDirectors])
  const topWritersData = useMemo(() => ({
    labels: topWriters.map(([n]) => n),
    values: topWriters.map(([, c]) => c),
  }), [topWriters])
  const topActorsData = useMemo(() => ({
    labels: topActors.map(([n]) => n),
    values: topActors.map(([, c]) => c),
  }), [topActors])
  const topGenresData = useMemo(() => ({
    labels: topGenres.map(([n]) => n),
    values: topGenres.map(([, c]) => c),
  }), [topGenres])
  const topNetworksData = useMemo(() => ({
    labels: topNetworks.map(([n]) => n),
    values: topNetworks.map(([, c]) => c),
  }), [topNetworks])
  const decadesData = useMemo(() => ({
    labels: decades.map(([d]) => d),
    values: decades.map(([, c]) => c),
  }), [decades])
  const genreAvgData = useMemo(() => ({
    labels: genreAvgRating.map((g) => `${g.name} (${g.count})`),
    values: genreAvgRating.map((g) => Number(g.avg.toFixed(2))),
  }), [genreAvgRating])
  const directorPairsData = useMemo(() => ({
    labels: directorActorPairs.map(([k]) => k),
    values: directorActorPairs.map(([, c]) => c),
  }), [directorActorPairs])
  const rtSplitData = useMemo(() => ({
    labels: RT_SPLIT_LABELS,
    values: [rtBuckets.fresh, rtBuckets.rotten, rtBuckets.none],
  }), [rtBuckets])

  const hasRtData = ratedRtCount > 0
  const hasMcData = ratedMcCount > 0

  return (
    <>
      {/* Refresh ratings bar */}
      {missingRatings > 0 && onRefreshRatings && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-zinc-700">
              {missingRatings} movie{missingRatings > 1 ? 's' : ''} missing external ratings
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
            {refreshing ? 'Refreshing...' : 'Refresh Ratings'}
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Titles" value={watched.length} sub={`${movies.length} films · ${shows.length} shows`} />
        <StatCard label="Watch Time" value={formatWatchTime(totalRuntime)} sub={movies.length ? `${formatRuntime(movieRuntime)} films` : null} />
        <StatCard label="Avg My Rating" value={avgMyRating} sub={`${ratedItems.length} rated`} />
        <StatCard label={`Avg ${avgExternalLabel}`} value={avgExternal} />
      </div>

      {/* Secondary quick stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Top Genre"
          value={topGenres[0]?.[0] ?? '—'}
          sub={topGenres[0]?.[1] ? `${topGenres[0][1]} titles` : null}
        />
        <StatCard
          label="Favorite Decade"
          value={decades.slice().sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}
          sub={decades.slice().sort((a, b) => b[1] - a[1])[0]?.[1] ? `${decades.slice().sort((a, b) => b[1] - a[1])[0][1]} titles` : null}
        />
        <StatCard
          label="Most Active Director"
          value={topDirectors[0]?.[0] ?? '—'}
          sub={topDirectors[0]?.[1] ? `${topDirectors[0][1]} titles` : null}
        />
        <StatCard
          label="Longest Title"
          value={longest[0] ? formatRuntime(longest[0]._totalRuntime) : '—'}
          sub={longest[0]?.title}
        />
      </div>

      {/* External ratings summary */}
      {itemsWithRatings.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Avg IMDb" value={avgImdb ?? '—'} sub={`${ratedImdbCount} rated`} />
          <StatCard label="Avg Metacritic" value={avgMc ?? '—'} sub={`${ratedMcCount} rated`} />
          <StatCard label="Avg Tomatometer" value={avgRt != null ? `${avgRt}%` : '—'} sub={`${ratedRtCount} rated`} />
          <StatCard label="Avg Popcornmeter" value={avgPopcorn != null ? `${avgPopcorn}%` : '—'} sub={`${ratedPopcornCount} rated`} />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChartCard title="Top Directors" hasData={topDirectorsData.labels.length > 0}>
          <BarChart
            labels={topDirectorsData.labels}
            values={topDirectorsData.values}
            color={DARK}
          />
        </ChartCard>
        <ChartCard title="Top Actors" hasData={topActorsData.labels.length > 0}>
          <BarChart
            labels={topActorsData.labels}
            values={topActorsData.values}
            color={DARK}
          />
        </ChartCard>
        <ChartCard title="Top Writers" hasData={topWritersData.labels.length > 0}>
          <BarChart
            labels={topWritersData.labels}
            values={topWritersData.values}
            color={DARK}
          />
        </ChartCard>
        <ChartCard title="Genre Distribution" hasData={topGenresData.labels.length > 0}>
          <DoughnutChart
            labels={topGenresData.labels}
            values={topGenresData.values}
          />
        </ChartCard>
        <ChartCard title="My Rating Distribution" hasData={ratedItems.length > 0}>
          <BarChart
            labels={RATING_LABELS}
            values={ratingBuckets}
            color={DARK}
            indexAxis="x"
          />
        </ChartCard>
        <ChartCard title="Watch Timeline" hasData={watched.some((m) => m.addedAt)}>
          <TimelineChart items={watched} />
        </ChartCard>
        <ChartCard title="Decade Distribution" hasData={decadesData.labels.length > 0}>
          <BarChart
            labels={decadesData.labels}
            values={decadesData.values}
            color={DARK}
            indexAxis="x"
          />
        </ChartCard>
        <ChartCard title="Avg My Rating per Genre" hasData={genreAvgData.labels.length > 0}>
          <BarChart
            labels={genreAvgData.labels}
            values={genreAvgData.values}
            color={DARK}
          />
        </ChartCard>
        <ChartCard title="Rating vs Runtime" hasData={ratingVsRuntime.length > 0}>
          <ScatterChart points={ratingVsRuntime} />
        </ChartCard>
        <ChartCard title="Metacritic Distribution" hasData={hasMcData}>
          <BarChart
            labels={MC_LABELS}
            values={mcBuckets}
            color={MC_COLORS}
            indexAxis="x"
          />
        </ChartCard>
        <ChartCard title="Tomatometer Split" hasData={hasRtData}>
          <DoughnutChart
            labels={rtSplitData.labels}
            values={rtSplitData.values}
            colors={RT_COLORS}
          />
        </ChartCard>
        <ChartCard title="Activity by Day of Week" hasData={watched.some((m) => m.addedAt)}>
          <BarChart
            labels={WEEKDAY_LABELS}
            values={weekdayBuckets}
            color={DARK}
            indexAxis="x"
          />
        </ChartCard>
        {shows.length > 0 && (
          <ChartCard title="Top Networks (TV)" hasData={topNetworksData.labels.length > 0}>
            <BarChart
              labels={topNetworksData.labels}
              values={topNetworksData.values}
              color={DARK}
            />
          </ChartCard>
        )}
        {directorActorPairs.length > 0 && (
          <ChartCard title="Director × Actor Pairs" hasData={directorPairsData.labels.length > 0}>
            <BarChart
              labels={directorPairsData.labels}
              values={directorPairsData.values}
              color={DARK}
            />
          </ChartCard>
        )}
      </div>

      {/* Top 5 rated by me */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border border-zinc-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">
            Top 5 — Your Highest Rated
          </h3>
          {topRated.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">No rated titles yet</p>
          ) : (
            <ul className="space-y-3">
              {topRated.map((m, i) => (
                <li key={`${m.kind}:${m.id}`} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-center text-xs font-bold text-zinc-400">{i + 1}</span>
                  <div className="h-16 w-11 shrink-0 overflow-hidden bg-zinc-100">
                    <SmartImage src={posterFor(m, 'w185')} alt={m.title} className="h-full w-full" objectFit="cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">{m.title}</p>
                    <p className="text-xs text-zinc-500">
                      {m.year || m.yearRange} · {m.runtime ? formatRuntime(itemTotalRuntime(m)) : '—'}
                      {m.kind === 'tv' && <span className="ml-1">· {m.seasonsCount || 0} season{(m.seasonsCount || 0) === 1 ? '' : 's'}</span>}
                    </p>
                  </div>
                  <span className="ml-auto shrink-0 text-sm font-bold text-amber-600">★ {m.myRating}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-zinc-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">
            Top 5 — Longest Watched
          </h3>
          {longest.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">No runtime data yet</p>
          ) : (
            <ul className="space-y-3">
              {longest.map((m, i) => (
                <li key={`${m.kind}:${m.id}`} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-center text-xs font-bold text-zinc-400">{i + 1}</span>
                  <div className="h-16 w-11 shrink-0 overflow-hidden bg-zinc-100">
                    <SmartImage src={posterFor(m, 'w185')} alt={m.title} className="h-full w-full" objectFit="cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">{m.title}</p>
                    <p className="text-xs text-zinc-500">
                      {m.year || m.yearRange} · {m.kind === 'tv' ? `${m.seasonsCount || 0} season${(m.seasonsCount || 0) === 1 ? '' : 's'}` : 'Film'}
                    </p>
                  </div>
                  <span className="ml-auto shrink-0 text-sm font-bold text-zinc-900">{formatRuntime(m._totalRuntime)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recently added */}
      <div className="mt-6 border border-zinc-200 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">
          Recently Added
        </h3>
        {recentlyAdded.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-400">No activity yet</p>
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
    // 销毁旧实例后再建新实例；同 canvas 上 new Chart 会报错
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

function ScatterChart({ points }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (points.length === 0) {
      chartRef.current?.destroy?.()
      chartRef.current = null
      return
    }
    chartRef.current?.destroy?.()
    chartRef.current = new Chart(ref.current, {
      type: 'scatter',
      data: {
        datasets: [{
          data: points,
          backgroundColor: 'rgba(24,24,27,0.65)',
          borderColor: PALETTE[0],
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = points[ctx.dataIndex]
                return p ? [`${p.title}`, `Runtime: ${p.runtime || '—'}m`, `My rating: ${p.y}/10`] : ''
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Runtime (min)', font: { size: 10 }, color: '#71717a' },
            grid: { color: '#f4f4f5' },
            ticks: { font: { size: 10 }, color: '#71717a' },
          },
          y: {
            title: { display: true, text: 'My Rating', font: { size: 10 }, color: '#71717a' },
            min: 0, max: 10,
            grid: { color: '#f4f4f5' },
            ticks: { font: { size: 10 }, color: '#71717a', stepSize: 1 },
          },
        },
      },
    })
    return () => chartRef.current?.destroy?.()
  }, [points])

  return <canvas ref={ref} />
}
