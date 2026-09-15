import { useEffect, useRef, useMemo } from 'react'
import Chart from 'chart.js/auto'

const PALETTE = [
  '#18181b', '#3f3f46', '#71717a', '#a1a1aa',
  '#0f172a', '#334155', '#475569', '#64748b',
  '#1e293b', '#475569',
]

function aggregate(items, field, limit = 10) {
  const counts = {}
  for (const m of items) {
    const val = m[field]
    if (!val) continue
    if (Array.isArray(val)) {
      const seen = new Set()
      for (const v of val) {
        const name = typeof v === 'object' ? v.name : v
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

function StatCard({ label, value, sub }) {
  return (
    <div className="border border-zinc-200 p-4 text-center">
      <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-black">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="border border-zinc-200 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">{title}</h3>
      <div className="relative" style={{ height: '240px' }}>
        {children}
      </div>
    </div>
  )
}

export default function LibraryStats({ watched }) {
  if (watched.length < 3) {
    return (
      <div className="border border-dashed border-zinc-300 py-12 text-center">
        <p className="text-sm text-zinc-500">
          Add at least 3 movies to your watched list to see meaningful statistics.
        </p>
      </div>
    )
  }

  const totalRuntime = watched.reduce((sum, m) => sum + (m.runtime || 0), 0)
  const ratedMovies = watched.filter((m) => m.myRating > 0)
  const avgMyRating = ratedMovies.length
    ? (ratedMovies.reduce((s, m) => s + m.myRating, 0) / ratedMovies.length).toFixed(1)
    : '—'
  const avgTmdb = (watched.reduce((s, m) => s + (m.rating || 0), 0) / watched.length).toFixed(1)

  const topDirectors = useMemo(() => aggregate(watched, 'director'), [watched])
  const topWriters = useMemo(() => aggregate(watched, 'writers'), [watched])
  const topActors = useMemo(() => aggregate(watched, 'cast'), [watched])
  const topGenres = useMemo(() => aggregate(watched, 'genres'), [watched])

  const ratingBuckets = useMemo(() => {
    const buckets = Array(10).fill(0)
    for (const m of watched) {
      if (m.myRating >= 1 && m.myRating <= 10) buckets[m.myRating - 1]++
    }
    return buckets
  }, [watched])

  return (
    <>
      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Movies" value={watched.length} />
        <StatCard label="Watch Time" value={formatRuntime(totalRuntime)} />
        <StatCard label="Avg My Rating" value={avgMyRating} sub={`${ratedMovies.length} rated`} />
        <StatCard label="Avg TMDB" value={avgTmdb} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChartCard title="Top Directors">
          <BarChart
            labels={topDirectors.map(([n]) => n)}
            values={topDirectors.map(([, c]) => c)}
            color={PALETTE[0]}
          />
        </ChartCard>
        <ChartCard title="Top Actors">
          <BarChart
            labels={topActors.map(([n]) => n)}
            values={topActors.map(([, c]) => c)}
            color={PALETTE[2]}
          />
        </ChartCard>
        <ChartCard title="Top Writers">
          <BarChart
            labels={topWriters.map(([n]) => n)}
            values={topWriters.map(([, c]) => c)}
            color={PALETTE[4]}
          />
        </ChartCard>
        <ChartCard title="Genre Distribution">
          <DoughnutChart
            labels={topGenres.map(([n]) => n)}
            values={topGenres.map(([, c]) => c)}
          />
        </ChartCard>
        <ChartCard title="My Rating Distribution">
          <BarChart
            labels={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']}
            values={ratingBuckets}
            color={PALETTE[1]}
            indexAxis="x"
          />
        </ChartCard>
        <ChartCard title="Watch Timeline">
          <TimelineChart items={watched} />
        </ChartCard>
      </div>
    </>
  )
}

function BarChart({ labels, values, color = '#18181b', indexAxis = 'y' }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: color, borderColor: color, borderWidth: 0, borderRadius: 2 }],
      },
      options: {
        indexAxis,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: indexAxis === 'y' }, ticks: { font: { size: 10 }, color: '#71717a' } },
          y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#3f3f46' } },
        },
      },
    })
    return () => chartRef.current?.destroy()
  }, [labels, values, color, indexAxis])

  return <canvas ref={ref} />
}

function DoughnutChart({ labels, values }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: PALETTE, borderColor: '#fff', borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { font: { size: 10 }, color: '#3f3f46', boxWidth: 12 } } },
      },
    })
    return () => chartRef.current?.destroy()
  }, [labels, values])

  return <canvas ref={ref} />
}

function TimelineChart({ items }) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const sorted = [...items].filter((m) => m.addedAt).sort((a, b) => a.addedAt - b.addedAt)
    if (sorted.length === 0) return
    let cum = 0
    const labels = sorted.map((m) => new Date(m.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    const data = sorted.map((m) => { cum += m.runtime || 0; return cum })
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
    return () => chartRef.current?.destroy()
  }, [items])

  return <canvas ref={ref} />
}
