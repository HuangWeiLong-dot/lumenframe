import { useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import SmartImage from './SmartImage'
import { apiUrl, posterFor } from '../api'

const DECADES = ['any', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']

const MOVIE_GENRES = [
  { name: 'Action', id: 28 }, { name: 'Adventure', id: 12 },
  { name: 'Animation', id: 16 }, { name: 'Comedy', id: 35 },
  { name: 'Crime', id: 80 }, { name: 'Documentary', id: 99 },
  { name: 'Drama', id: 18 }, { name: 'Family', id: 10751 },
  { name: 'Fantasy', id: 14 }, { name: 'Horror', id: 27 },
  { name: 'Mystery', id: 9648 }, { name: 'Romance', id: 10749 },
  { name: 'Science Fiction', id: 878 }, { name: 'Thriller', id: 53 },
  { name: 'War', id: 10752 }, { name: 'Western', id: 37 },
]

const TV_GENRES = [
  { name: 'Action & Adventure', id: 10759 }, { name: 'Animation', id: 16 },
  { name: 'Comedy', id: 35 }, { name: 'Crime', id: 80 },
  { name: 'Documentary', id: 99 }, { name: 'Drama', id: 18 },
  { name: 'Family', id: 10751 }, { name: 'Kids', id: 10762 },
  { name: 'Mystery', id: 9648 }, { name: 'Reality', id: 10764 },
  { name: 'Sci-Fi & Fantasy', id: 10765 }, { name: 'Soap', id: 10766 },
  { name: 'Talk', id: 10767 }, { name: 'War & Politics', id: 10768 },
  { name: 'Western', id: 37 },
]

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
        active
          ? 'border-black bg-black text-white shadow-sm'
          : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  )
}

function StepIndicator({ current }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center text-[11px] font-bold transition-all ${
              i === current
                ? 'bg-black text-white'
                : i < current
                  ? 'bg-black/10 text-black'
                  : 'border border-zinc-300 text-zinc-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < 2 && (
            <div className={`h-px w-6 ${i < current ? 'bg-black' : 'bg-zinc-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function QuizRecommender({ onPick }) {
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState('movie')
  const [decade, setDecade] = useState('any')
  const [genres, setGenres] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const genreList = kind === 'tv' ? TV_GENRES : MOVIE_GENRES

  const toggleGenre = (id) => {
    setGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    )
  }

  const fetchRec = async (reroll = false) => {
    setLoading(true)
    setError('')
    if (!reroll) setResult(null)
    try {
      const qs = new URLSearchParams({ kind, decade, genres: genres.join(',') })
      const r = await fetch(apiUrl(`/api/recommend/random?${qs}`))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (!data.result) {
        setError('No match found. Try different filters.')
      } else {
        setResult(data.result)
        setStep(3)
      }
    } catch (e) {
      setError('Recommendation service unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep(0)
    setKind('movie')
    setDecade('any')
    setGenres([])
    setResult(null)
    setError('')
  }

  const poster = result ? posterFor(result, 'w342') : ''

  return (
    <CollapsibleSection title="Surprise Me" defaultOpen>
      <div className="space-y-5">
        {step < 3 && <StepIndicator current={step} />}

        {/* Step 0: 类型 — 卡片式选择 */}
        {step === 0 && (
          <div>
            <h3 className="mb-4 text-base font-bold text-zinc-900">
              What are you in the mood for?
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'movie', label: 'Movie', desc: 'Feature films' },
                { key: 'tv', label: 'TV Show', desc: 'Series & episodes' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setKind(opt.key)}
                  className={`border-2 p-4 text-left transition-all duration-200 ${
                    kind === opt.key
                      ? 'border-black bg-zinc-50 shadow-sm'
                      : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-900">{opt.label}</span>
                    <div
                      className={`h-4 w-4 border-2 transition ${
                        kind === opt.key ? 'border-black bg-black' : 'border-zinc-300'
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{opt.desc}</p>
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="bg-black px-5 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 1: 年代 */}
        {step === 1 && (
          <div>
            <h3 className="mb-4 text-base font-bold text-zinc-900">Which era?</h3>
            <div className="flex flex-wrap gap-2">
              {DECADES.map((d) => (
                <Chip key={d} active={decade === d} onClick={() => setDecade(d)}>
                  {d === 'any' ? 'Any' : d}
                </Chip>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="text-xs font-medium text-zinc-500 transition hover:text-black"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="bg-black px-5 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: 类别 */}
        {step === 2 && (
          <div>
            <h3 className="mb-1 text-base font-bold text-zinc-900">Pick genres</h3>
            <p className="mb-4 text-xs text-zinc-500">Optional — leave empty for any</p>
            <div className="flex flex-wrap gap-2">
              {genreList.map((g) => (
                <Chip
                  key={g.id}
                  active={genres.includes(g.id)}
                  onClick={() => toggleGenre(g.id)}
                >
                  {g.name}
                </Chip>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs font-medium text-zinc-500 transition hover:text-black"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => fetchRec()}
                disabled={loading}
                className="bg-black px-5 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
              >
                {loading ? 'Picking…' : 'Surprise Me'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: 结果 */}
        {step === 3 && result && (
          <div className="border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <div className="w-32 shrink-0 overflow-hidden shadow-md ring-1 ring-black/5 sm:w-32">
                <SmartImage
                  src={poster}
                  alt={result.title}
                  crossOrigin="anonymous"
                  aspect="2/3"
                  className="w-full"
                />
              </div>
              <div className="min-w-0 w-full flex-1 text-center sm:text-left">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  {result.kind === 'tv' ? 'TV Show' : 'Movie'}
                  {decade !== 'any' && ` · ${decade}`}
                </p>
                <h3 className="mt-1 text-xl font-extrabold leading-tight text-zinc-900">
                  {result.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-zinc-600 sm:justify-start">
                  <span>{result.year}</span>
                  {typeof result.rating === 'number' && (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                      ★ {result.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                {result.overview && (
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-zinc-600">
                    {result.overview}
                  </p>
                )}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {!result._tmdbOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        result.kind === 'tv'
                          ? onPick('tv', result.id)
                          : onPick('movie', result.id)
                      }
                      className="flex-1 bg-black px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-800 sm:flex-none"
                    >
                      View Details
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fetchRec(true)}
                    disabled={loading}
                    className="flex-1 border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 disabled:opacity-50 sm:flex-none"
                  >
                    {loading ? 'Picking…' : 'Reroll'}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="flex-1 border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 sm:flex-none"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
            {error}
            <button
              type="button"
              onClick={reset}
              className="ml-3 font-medium text-zinc-700 underline hover:text-black"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}
