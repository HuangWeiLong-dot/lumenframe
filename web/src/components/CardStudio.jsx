import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Card, { TEMPLATE_LIST } from './Card'
import CollapsibleSection from './CollapsibleSection'
import { useI18n } from '../i18n'

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

// ---- 自定义色的判定 ----
// 「自定义」= 当前值落在预设之外。两处细节：
//   · COLORS / TEXT_COLORS 的 hex 大小写混用（'#F3EFE7'），而 <input type="color"> 回传的是
//     全小写（'#f3efe7'），所以比较前必须统一小写，否则预设色也会被判成自定义。
//   · TEXT_COLORS 用 id（'auto'/'gold'…）标识，而自定义时 config.textColor 直接存 hex，
//     所以文字色这一路要连 id 一起比。
const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
const isCustomBg = (v) => !COLORS.some((c) => sameColor(c, v))
const isCustomText = (v) => !TEXT_COLORS.some((c) => sameColor(c.id, v))

// 文字色取色器的 value：预设取它的 hex，自定义就直接把 hex 交给 input。
// 不能只写 `TEXT_COLORS.find(...)?.hex || '#FFFFFF'` —— 自定义 hex 匹配不到任何 id，
// find() 落空后回落到 '#FFFFFF'，于是选完自定义色的**瞬间**取色器跳回白色（实测：
// 设成 #c8a24a 后 input.value 立刻变回 #ffffff）。受控 input 会拿这个值覆盖 DOM，
// 用户不但看不到自己选的颜色，之后再碰一下取色器还会把状态覆盖成白色。
const textColorHexOf = (v) => TEXT_COLORS.find((c) => sameColor(c.id, v))?.hex
  || (isCustomText(v) && /^#[0-9a-f]{6}$/i.test(String(v)) ? v : '#FFFFFF')

// 取色器只会回传 hex，而预设是用 id（'gold'）或大小写各异的 hex（'#F3EFE7'）标识的。
// 所以从取色器回来的值必须先「还原」成预设，否则 state 会从 'gold' 变成 '#d4a857'，
// 预设按钮随即失去选中态 —— 表现为「选好颜色后点一下屏幕，选中就被重置了」。
// 触发点：Chrome 的取色对话框被点空白处关掉时，会用**打开时**的旧值再发一次 input/change。
const textIdForHex = (hex) => TEXT_COLORS.find((c) => c.hex && sameColor(c.hex, hex))?.id
const canonicalBg = (hex) => COLORS.find((c) => sameColor(c, hex)) || hex

const MOVIE_OPTIONS = [
  { key: 'showRatings', labelKey: 'cardStudio.ratings' },
  { key: 'showYear', labelKey: 'cardStudio.year' },
  { key: 'showOverview', labelKey: 'cardStudio.synopsis' },
  { key: 'showDirector', labelKey: 'cardStudio.director' },
  { key: 'showWriter', labelKey: 'cardStudio.writer' },
  { key: 'showDop', labelKey: 'cardStudio.cinematography' },
  { key: 'showCast', labelKey: 'cardStudio.cast' },
  { key: 'showSpecs', labelKey: 'cardStudio.techSpecs' },
  { key: 'showNote', labelKey: 'cardStudio.myNote' },
]

const SHOW_OPTIONS = [
  { key: 'showRatings', labelKey: 'cardStudio.ratings' },
  { key: 'showYear', labelKey: 'cardStudio.year' },
  { key: 'showOverview', labelKey: 'cardStudio.synopsis' },
  { key: 'showCast', labelKey: 'cardStudio.cast' },
  { key: 'showShowYears', labelKey: 'cardStudio.showYears' },
  { key: 'showShowSeasons', labelKey: 'cardStudio.showSeasons' },
  { key: 'showShowNetwork', labelKey: 'cardStudio.showNetwork' },
  { key: 'showShowStatus', labelKey: 'cardStudio.showStatus' },
  { key: 'showNote', labelKey: 'cardStudio.myNote' },
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
  const { t } = useI18n()
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
    { key: 'showPersonal', label: t('cardStudio.myScore'), value: personal > 0 ? String(personal) : null },
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
    !isShow && specsLoading && t('cardStudio.techSpecs'),
    ratingsLoading && t('cardStudio.ratings'),
  ].filter(Boolean).join(' & ')

  return (
    <CollapsibleSection
      title={t('cardStudio.title')}
      defaultOpen
      action={
        <button
          onClick={download}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 border border-black bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {exporting ? t('cardStudio.rendering') : t('cardStudio.downloadPng')}
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
                aria-label={t('cardStudio.previewCard')}
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
            {t('cardStudio.clickToPreview')} · {size.w}×{size.h}px
          </p>
        </div>

        {/* --- Controls --- */}
        <div className="order-2 mt-2">

          {/* Template */}
          <Section title={t('cardStudio.template')}>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((tpl) => (
                <button key={tpl.id} onClick={() => pickTemplate(tpl.id)} className={pill(config.template === tpl.id)}>
                  {t(`cardStudio.${tpl.id}`)}
                </button>
              ))}
            </div>
          </Section>

          {/* Size + Text Align — side by side */}
          <div className="flex flex-col gap-5 border-b border-zinc-300 pb-5 mb-5 sm:flex-row">
            <div className="flex-1">
              <p className={sectionLabel}>{t('cardStudio.size')}</p>
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
              <p className={sectionLabel}>{t('cardStudio.textAlign')}</p>
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
                    title={t(`cardStudio.${a.id}`)}
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
          <Section title={t('cardStudio.background')}>
            {/* 选中态必须 ring-inset，两个理由：
                1. 外描边会被 CollapsibleSection 外层的 overflow-hidden 裁掉 —— 它和色板行
                   同宽，最左/最右那块的黑边会被切掉一半（实测：两者左边缘都是 197px）。
                   inset 画在元素内部，几何上不可能被裁。
                2. 不能改用 ring-offset 去拉开距离：offset 那层白圈在 box-shadow 列表里排
                   在黑圈**之前**，即画在黑圈**之上**，会在 1px 黑边框和 2px 黑圈之间凿出
                   一条白缝。inset 顺带也没了这个问题。
                同样处理见文字色板与各处「按图做卡片」的图片格。 */}
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set({ bgColor: c })}
                  style={{ background: c }}
                  aria-label={`${t('cardStudio.background')} ${c}`}
                  className={`h-7 w-7 border transition ${
                    sameColor(config.bgColor, c) ? 'border-black ring-2 ring-inset ring-black' : 'border-zinc-300 hover:scale-110'
                  }`}
                />
              ))}
              <input
                type="color"
                value={config.bgColor}
                onChange={(e) => set({ bgColor: canonicalBg(e.target.value) })}
                aria-label={t('cardStudio.customColor')}
                title={t('cardStudio.customColor')}
                className={`h-7 w-9 cursor-pointer border bg-white transition ${
                  isCustomBg(config.bgColor) ? 'border-black ring-2 ring-inset ring-black' : 'border-zinc-300'
                }`}
              />
            </div>
          </Section>

          {/* Font Color */}
          <Section title={t('cardStudio.fontColor')}>
            <div className="flex flex-wrap items-center gap-2">
              {TEXT_COLORS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => set({ textColor: t.id })}
                  title={t.label}
                  className={`h-7 w-7 border transition ${
                    sameColor(config.textColor, t.id)
                      ? 'border-black ring-2 ring-inset ring-black'
                      : 'border-zinc-300 hover:scale-110'
                  }`}
                  style={t.hex ? { background: t.hex } : { background: 'linear-gradient(135deg, #fff 50%, #000 50%)' }}
                />
              ))}
              <input
                type="color"
                value={textColorHexOf(config.textColor)}
                onChange={(e) => set({ textColor: textIdForHex(e.target.value) || e.target.value })}
                aria-label={t('cardStudio.customColor')}
                title={t('cardStudio.customColor')}
                className={`h-7 w-9 cursor-pointer border bg-white transition ${
                  isCustomText(config.textColor) ? 'border-black ring-2 ring-inset ring-black' : 'border-zinc-300'
                }`}
              />
            </div>
          </Section>

          {/* Layout toggles */}
          <Section title={t('cardStudio.content')}>
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
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
          </Section>

          {/* Rating Sources */}
          {config.showRatings && (
            <Section title={t('cardStudio.ratingSources')}>
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
          <Section title={t('cardStudio.myRating')}>
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
                    aria-label={t('cardStudio.rateN', { n })}
                    className={`text-lg leading-none transition ${lit ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400'}`}
                  >
                    ★
                  </button>
                )
              })}
              {personal > 0 && (
                <button onClick={() => onPersonal(0)} className="ml-2 text-xs text-zinc-500 underline underline-offset-2 hover:text-black">
                  {t('cardStudio.clear')}
                </button>
              )}
            </div>
          </Section>

          {/* Status bar */}
          <div className="border-b border-zinc-300 pb-4 mb-4">
            <div className="text-[11px] leading-relaxed text-zinc-500">
              {loadingText ? t('cardStudio.fetching', { what: loadingText }) : ''}
              {ratings
                ? `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'} · IMDb ${ratings.imdb != null ? ratings.imdb.toFixed(1) : '—'} · 🍅 ${ratings.rotten_tomatoes != null ? ratings.rotten_tomatoes + '%' : '—'} · 🍿 ${ratings.popcornmeter != null ? ratings.popcornmeter + '%' : '—'} · Metascore ${ratings.metacritic != null ? ratings.metacritic : '—'}`
                : `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'}`}
            </div>
            {cardImage && (
              <div className="mt-3 flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2 rounded">
                <p className="text-[11px] text-zinc-600">
                  {t('cardStudio.cardImage')} · <span className="font-medium text-zinc-800">{t('cardStudio.customStill')}</span>
                </p>
                <button onClick={onClearCardImage} className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-black">
                  {t('cardStudio.resetToPoster')}
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
            alt={t('cardStudio.previewAlt')}
            className="max-h-[90vh] max-w-[92vw] object-contain shadow-2xl"
          />
        </div>
      )}
    </CollapsibleSection>
  )
}
