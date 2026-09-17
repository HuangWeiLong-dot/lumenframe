import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Card, { TEMPLATE_LIST } from './Card'
import CollapsibleSection from './CollapsibleSection'

const TEMPLATES = TEMPLATE_LIST

const SIZES = [
  { id: '1:1', w: 1080, h: 1080 },
  { id: '4:5', w: 1080, h: 1350 },
  { id: '4:3', w: 1440, h: 1080 },
  { id: '16:9', w: 1920, h: 1080 },
  { id: '9:16', w: 1080, h: 1920 },
]

const COLORS = ['#131313', '#F3EFE7', '#14432A', '#6D1F2C', '#16283F']

const TEXT_COLORS = [
  { id: 'auto', label: 'Auto', hex: null },
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'black', label: 'Black', hex: '#000000' },
  { id: 'cream', label: 'Cream', hex: '#F3EFE7' },
  { id: 'gold', label: 'Gold', hex: '#D4A857' },
  { id: 'red', label: 'Red', hex: '#E63946' },
  { id: 'blue', label: 'Blue', hex: '#4A90D9' },
]

const MOVIE_OPTIONS = [
  { key: 'showRatings', label: 'Ratings' },
  { key: 'showYear', label: 'Year' },
  { key: 'showOverview', label: 'Synopsis' },
  { key: 'showDirector', label: 'Director' },
  { key: 'showWriter', label: 'Writer' },
  { key: 'showDop', label: 'Cinematography' },
  { key: 'showCast', label: 'Cast' },
  { key: 'showSpecs', label: 'Tech Specs' },
  { key: 'showNote', label: 'My Note' },
]

const SHOW_OPTIONS = [
  { key: 'showRatings', label: 'Ratings' },
  { key: 'showYear', label: 'Year' },
  { key: 'showOverview', label: 'Synopsis' },
  { key: 'showCast', label: 'Cast' },
  { key: 'showShowYears', label: 'Years' },
  { key: 'showShowSeasons', label: 'Seasons' },
  { key: 'showShowNetwork', label: 'Network' },
  { key: 'showShowStatus', label: 'Status' },
  { key: 'showNote', label: 'My Note' },
]

const ALIGN_OPTIONS = [
  { id: 'left', label: 'Left', icon: 'M3 5h18M3 12h12M3 19h18' },
  { id: 'center', label: 'Center', icon: 'M7 5h10M5 12h14M7 19h10' },
  { id: 'right', label: 'Right', icon: 'M3 5h18M9 12h12M3 19h18' },
]

const PREVIEW_WIDTH = 440

// --- shared style fragments ---

const pill = (active) =>
  `border px-3 py-1.5 text-center text-sm transition ${
    active
      ? 'border-black bg-black text-white'
      : 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
  }`

const sectionLabel = 'text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-500'

function Section({ title, children, last = false }) {
  return (
    <div className={last ? '' : 'border-b border-zinc-300 pb-5 mb-5'}>
      <p className={sectionLabel}>{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

// --- component ---

export default function CardStudio({ movie, specs, specsLoading, ratings, ratingsLoading, personal, onPersonal, cardImage, onClearCardImage, note }) {
  const [config, setConfig] = useState({
    template: 'minimal',
    size: '4:5',
    bgColor: '#131313',
    textColor: 'auto',
    textAlign: 'left',
    showRatings: true,
    showRating: true,
    showImdb: true,
    showRt: true,
    showPop: true,
    showMeta: true,
    showPersonal: true,
    showYear: true,
    showOverview: true,
    showDirector: true,
    showWriter: true,
    showDop: true,
    showCast: true,
    showSpecs: true,
    showNote: false,
    showShowYears: true,
    showShowSeasons: true,
    showShowNetwork: true,
    showShowStatus: true,
  })
  const [exporting, setExporting] = useState(false)
  const [hoverRating, setHoverRating] = useState(0)
  const [previewUrl, setPreviewUrl] = useState(null)
  const canvasRef = useRef(null)
  const previewAreaRef = useRef(null)
  const [availW, setAvailW] = useState(PREVIEW_WIDTH)

  const size = SIZES.find((s) => s.id === config.size) || SIZES[1]
  const landscape = size.w >= size.h
  const currentTpl = TEMPLATES.find((t) => t.id === config.template)
  const supportedSizes = currentTpl?.sizes || SIZES.map((s) => s.id)
  const visibleSizes = SIZES.filter((s) => supportedSizes.includes(s.id))
  const ratio = size.h / size.w
  const slot = Math.min(availW, PREVIEW_WIDTH * (16 / 9))
  const slotW = slot
  const slotH = slot
  const desiredW = landscape ? PREVIEW_WIDTH * (size.w / size.h) : PREVIEW_WIDTH
  const previewW = Math.min(desiredW, slotW, slotH / ratio)
  const previewH = ratio * previewW
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }))

  const isShow = movie.kind === 'tv'
  const options = isShow ? SHOW_OPTIONS : MOVIE_OPTIONS
  const ratingSources = [
    { key: 'showRating', label: isShow ? 'TVmaze' : 'TMDB', value: typeof movie.rating === 'number' ? movie.rating.toFixed(1) : null },
    { key: 'showImdb', label: 'IMDb', value: ratings?.imdb != null ? ratings.imdb.toFixed(1) : null },
    { key: 'showRt', label: 'Tomatometer', value: ratings?.rotten_tomatoes != null ? `${ratings.rotten_tomatoes}%` : null },
    { key: 'showPop', label: 'Popcornmeter', value: ratings?.popcornmeter != null ? `${ratings.popcornmeter}%` : null },
    { key: 'showMeta', label: 'Metascore', value: ratings?.metacritic != null ? String(ratings.metacritic) : null },
    { key: 'showPersonal', label: 'My Score', value: personal > 0 ? String(personal) : null },
  ]

  useLayoutEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    const update = () => setAvailW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    if (!previewUrl) return
    const onKey = (e) => { if (e.key === 'Escape') setPreviewUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewUrl])

  function openPreview() {
    const canvas = canvasRef.current
    if (!canvas) return
    setPreviewUrl(canvas.toDataURL('image/png'))
  }

  function pickTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id)
    const sizes = t?.sizes || SIZES.map((s) => s.id)
    const nextSize = sizes.includes(config.size) ? config.size : sizes[0]
    set({ template: id, bgColor: t.bg, size: nextSize })
  }

  function download() {
    const canvas = canvasRef.current
    if (!canvas || exporting) return
    setExporting(true)
    try {
      const slug = (movie.title || '')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
      const link = document.createElement('a')
      link.download = `lumenframe-${slug || movie.id}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const loadingText = [
    !isShow && specsLoading && 'tech specs',
    ratingsLoading && 'ratings',
  ].filter(Boolean).join(' & ')

  return (
    <CollapsibleSection
      title="Card Studio"
      defaultOpen
      action={
        <button
          onClick={download}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 border border-black bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {exporting ? 'Rendering…' : 'Download PNG'}
        </button>
      }
    >
      <div className="flex flex-col">
        {/* --- Preview --- */}
        <div className="order-1 w-full">
          <div ref={previewAreaRef} className="flex w-full justify-center">
            <div
              className="relative flex items-center justify-center overflow-hidden rounded-lg"
              style={{ width: slotW, height: slotH }}
            >
              <button
                type="button"
                onClick={openPreview}
                aria-label="Preview generated card"
                className="group relative block overflow-hidden ring-0 transition-[width,height] duration-200 ease-out"
                style={{ width: previewW, height: previewH }}
              >
                <Card
                  ref={canvasRef}
                  movie={movie}
                  config={config}
                  width={size.w}
                  height={size.h}
                  specs={specs}
                  ratings={ratings}
                  personal={personal}
                  customImage={cardImage}
                  note={note}
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition duration-200 group-hover:bg-black/20 group-hover:opacity-100">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </span>
                </span>
              </button>
            </div>
          </div>
          {/* Preview hint */}
          <p className="mt-2 text-center text-[11px] text-zinc-400">
            Click card to preview · {size.w}×{size.h}px
          </p>
        </div>

        {/* --- Controls --- */}
        <div className="order-2 mt-2">

          {/* Template */}
          <Section title="Template">
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => pickTemplate(t.id)} className={pill(config.template === t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          {/* Size + Text Align — side by side */}
          <div className="flex flex-col gap-5 border-b border-zinc-300 pb-5 mb-5 sm:flex-row">
            <div className="flex-1">
              <p className={sectionLabel}>Size</p>
              <div
                className="mt-3 grid gap-2"
                style={{ gridTemplateColumns: `repeat(${visibleSizes.length}, minmax(0, 1fr))` }}
              >
                {visibleSizes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => set({ size: s.id })}
                    className={`${pill(config.size === s.id)} px-1`}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className={sectionLabel}>Text Align</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {ALIGN_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => set({ textAlign: a.id })}
                    className={`flex items-center justify-center border py-1.5 transition ${
                      config.textAlign === a.id
                        ? 'border-black bg-black text-white'
                        : 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
                    }`}
                    title={a.label}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d={a.icon} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Background */}
          <Section title="Background">
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set({ bgColor: c })}
                  style={{ background: c }}
                  aria-label={`color ${c}`}
                  className={`h-7 w-7 border transition ${
                    config.bgColor === c ? 'border-black ring-2 ring-black ring-offset-1' : 'border-zinc-300 hover:scale-110'
                  }`}
                />
              ))}
              <input
                type="color"
                value={config.bgColor}
                onChange={(e) => set({ bgColor: e.target.value })}
                aria-label="custom color"
                className="h-7 w-9 cursor-pointer border border-zinc-300 bg-white"
              />
            </div>
          </Section>

          {/* Font Color */}
          <Section title="Font Color">
            <div className="flex flex-wrap items-center gap-2">
              {TEXT_COLORS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => set({ textColor: t.id })}
                  title={t.label}
                  className={`h-7 w-7 border transition ${
                    config.textColor === t.id
                      ? 'border-black ring-2 ring-black ring-offset-1'
                      : 'border-zinc-300 hover:scale-110'
                  }`}
                  style={t.hex ? { background: t.hex } : { background: 'linear-gradient(135deg, #fff 50%, #000 50%)' }}
                />
              ))}
              <input
                type="color"
                value={TEXT_COLORS.find((t) => t.id === config.textColor)?.hex || '#FFFFFF'}
                onChange={(e) => set({ textColor: e.target.value })}
                aria-label="custom font color"
                className="h-7 w-9 cursor-pointer border border-zinc-300 bg-white"
              />
            </div>
          </Section>

          {/* Layout toggles */}
          <Section title="Content">
            <div className="grid grid-cols-2 gap-2">
              {options.map((o) => (
                <button
                  key={o.key}
                  onClick={() => set({ [o.key]: !config[o.key] })}
                  className={`w-full border px-3 py-2 text-center text-sm transition ${
                    config[o.key]
                      ? 'border-black bg-black text-white'
                      : 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Section>

          {/* Rating Sources */}
          {config.showRatings && (
            <Section title="Rating Sources">
              <div className="grid grid-cols-3 gap-2">
                {ratingSources.map((s) => {
                  const available = s.value != null
                  const active = available && config[s.key] !== false
                  return (
                    <button
                      key={s.key}
                      onClick={() => available && set({ [s.key]: !active })}
                      disabled={!available}
                      className={`border px-2 py-1.5 text-center text-xs leading-tight transition ${
                        active
                          ? 'border-black bg-black text-white'
                          : available
                            ? 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
                            : 'cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {/* My Rating */}
          <Section title="My Rating">
            <div
              className="flex flex-wrap items-center gap-1"
              onMouseLeave={() => setHoverRating(0)}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const lit = n <= (hoverRating || personal)
                return (
                  <button
                    key={n}
                    onClick={() => onPersonal(personal === n ? 0 : n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`rate ${n}`}
                    className={`text-lg leading-none transition ${lit ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400'}`}
                  >
                    ★
                  </button>
                )
              })}
              {personal > 0 && (
                <button onClick={() => onPersonal(0)} className="ml-2 text-xs text-zinc-500 underline underline-offset-2 hover:text-black">
                  Clear
                </button>
              )}
            </div>
          </Section>

          {/* Status bar */}
          <div className="border-b border-zinc-300 pb-4 mb-4">
            <div className="text-[11px] leading-relaxed text-zinc-500">
              {loadingText ? `Fetching ${loadingText}…` : ''}
              {ratings
                ? `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'} · IMDb ${ratings.imdb != null ? ratings.imdb.toFixed(1) : '—'} · 🍅 ${ratings.rotten_tomatoes != null ? ratings.rotten_tomatoes + '%' : '—'} · 🍿 ${ratings.popcornmeter != null ? ratings.popcornmeter + '%' : '—'} · Metascore ${ratings.metacritic != null ? ratings.metacritic : '—'}`
                : `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'}`}
            </div>
            {cardImage && (
              <div className="mt-3 flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2 rounded">
                <p className="text-[11px] text-zinc-600">
                  Card image · <span className="font-medium text-zinc-800">custom still / backdrop</span>
                </p>
                <button onClick={onClearCardImage} className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-black">
                  Reset to poster
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Generated card preview"
            className="max-h-[90vh] max-w-[92vw] object-contain shadow-2xl"
          />
        </div>
      )}
    </CollapsibleSection>
  )
}
