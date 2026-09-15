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

const OPTIONS = [
  { key: 'showRatings', label: 'Ratings' },
  { key: 'showYear', label: 'Year' },
  { key: 'showOverview', label: 'Synopsis' },
  { key: 'showDirector', label: 'Director' },
  { key: 'showWriter', label: 'Writer' },
  { key: 'showDop', label: 'Cinematography' },
  { key: 'showCast', label: 'Cast' },
  { key: 'showSpecs', label: 'Tech Specs' },
]

// 竖版卡片预览宽（px）。卡片按 1080px 全尺寸离屏渲染，再缩放到预览
const PREVIEW_WIDTH = 440

const pill = (active) =>
  `border px-3 py-1.5 text-center text-sm transition ${
    active
      ? 'border-black bg-black text-white'
      : 'border-zinc-300 bg-white text-zinc-600 hover:border-black'
  }`

const label = 'mr-1 text-xs uppercase tracking-[0.2em] text-zinc-600'

export default function CardStudio({ movie, specs, specsLoading, ratings, ratingsLoading, personal, onPersonal, cardImage, onClearCardImage }) {
  const [config, setConfig] = useState({
    template: 'minimal',
    size: '4:5',
    bgColor: '#131313',
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
  })
  const [exporting, setExporting] = useState(false)
  // 评分星星悬浮预览：0 = 未悬浮，显示已选评分
  const [hoverRating, setHoverRating] = useState(0)
  // 预览灯箱：存放当前卡片导出的 dataURL
  const [previewUrl, setPreviewUrl] = useState(null)
  const canvasRef = useRef(null)
  const previewAreaRef = useRef(null)
  const [availW, setAvailW] = useState(PREVIEW_WIDTH)

  const size = SIZES.find((s) => s.id === config.size) || SIZES[1]
  const landscape = size.w >= size.h
  const currentTpl = TEMPLATES.find((t) => t.id === config.template)
  const supportedSizes = currentTpl?.sizes || SIZES.map((s) => s.id)
  const visibleSizes = SIZES.filter((s) => supportedSizes.includes(s.id))
  // 固定展示槽：正方形，边长只取决于容器宽度（与所选比例无关）。
  // 两种最极端比例恰好各占一边：9:16 高=边长（宽 440），16:9 宽=边长（高 440），
  // 其余比例等比居中。切换比例时槽尺寸不变，下方按钮不发生位移。
  const ratio = size.h / size.w
  const slot = Math.min(availW, PREVIEW_WIDTH * (16 / 9))
  const slotW = slot
  const slotH = slot
  const desiredW = landscape ? PREVIEW_WIDTH * (size.w / size.h) : PREVIEW_WIDTH
  const previewW = Math.min(desiredW, slotW, slotH / ratio)
  const previewH = ratio * previewW
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }))

  // 可选择是否上卡的评分源；value 为 null 表示该评分当前不可用
  const ratingSources = [
    { key: 'showRating', label: 'TMDB', value: typeof movie.rating === 'number' ? movie.rating.toFixed(1) : null },
    { key: 'showImdb', label: 'IMDb', value: ratings?.imdb != null ? ratings.imdb.toFixed(1) : null },
    { key: 'showRt', label: 'Tomatometer', value: ratings?.rotten_tomatoes != null ? `${ratings.rotten_tomatoes}%` : null },
    { key: 'showPop', label: 'Popcornmeter', value: ratings?.popcornmeter != null ? `${ratings.popcornmeter}%` : null },
    { key: 'showMeta', label: 'Metascore', value: ratings?.metacritic != null ? String(ratings.metacritic) : null },
    { key: 'showPersonal', label: 'My Score', value: personal > 0 ? String(personal) : null },
  ]

  // 测量预览区可用宽度（RO：旋转屏/窗口缩放即时重算）
  useLayoutEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    const update = () => {
      setAvailW(el.clientWidth)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // 灯箱 Esc 关闭
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
    // 切换模板时，如果当前尺寸不被新模板支持，自动落到第一个支持的尺寸
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
    specsLoading && 'tech specs',
    ratingsLoading && 'ratings',
  ]
    .filter(Boolean)
    .join(' & ')

  return (
    <CollapsibleSection
      title="Card Studio"
      defaultOpen
      action={
        <button
          onClick={download}
          disabled={exporting}
          className={pill(true)}
        >
          {exporting ? 'Rendering' : 'Download PNG'}
        </button>
      }
    >
      {/* 所有设备统一：海报吸顶在上，控件在下 */}
      <div className="flex flex-col">
      {/* 控件组 */}
      <div className="order-2">
      <div className="mt-4 flex flex-col gap-2">
        <span className={label}>Template</span>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => pickTemplate(t.id)} className={pill(config.template === t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <span className={label}>Size</span>
        <div
          className="grid gap-2"
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

      <div className="mt-3 flex flex-col gap-2">
        <span className={label}>Background</span>
        <div className="flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => set({ bgColor: c })}
              style={{ background: c }}
              aria-label={`color ${c}`}
              className={`h-6 w-6 border transition ${
                config.bgColor === c ? 'border-black ring-1 ring-black ring-offset-1' : 'border-zinc-300'
              }`}
            />
          ))}
          <input
            type="color"
            value={config.bgColor}
            onChange={(e) => set({ bgColor: e.target.value })}
            aria-label="custom color"
            className="h-6 w-8 cursor-pointer border border-zinc-300 bg-white"
          />
        </div>
      </div>

      <div className="mt-4">
        <span className={label}>Show</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => (
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
      </div>

      {config.showRatings && (
        <div className="mt-3 flex flex-col gap-2">
          <span className={label}>Rating sources</span>
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
                  <span className={active ? 'ml-1 opacity-70' : 'ml-1 opacity-50'}>
                    {s.value ?? '—'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div
        className="mt-3 flex flex-col gap-2"
        onMouseLeave={() => setHoverRating(0)}
      >
        <span className={label}>My rating</span>
        <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          // 悬浮时预览悬停位置（前 N 颗全亮），否则显示已选评分
          const lit = n <= (hoverRating || personal)
          return (
            <button
              key={n}
              onClick={() => onPersonal(personal === n ? 0 : n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`rate ${n}`}
              className={`text-base leading-none transition ${lit ? 'text-amber-500' : 'text-zinc-300'}`}
            >
              ★
            </button>
          )
        })}
        {personal > 0 && (
          <button onClick={() => onPersonal(0)} className="ml-1 text-xs text-zinc-600 underline">
            clear
          </button>
        )}
        </div>
      </div>

      <div className="mt-4 text-xs text-zinc-600">
        {loadingText ? `Fetching ${loadingText}…` : ''}
        {ratings
          ? `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'} · IMDb ${ratings.imdb != null ? ratings.imdb.toFixed(1) : '—'} · 🍅 ${ratings.rotten_tomatoes != null ? ratings.rotten_tomatoes + '%' : '—'} · 🍿 ${ratings.popcornmeter != null ? ratings.popcornmeter + '%' : '—'} · Metascore ${ratings.metacritic != null ? ratings.metacritic : '—'}`
          : `TMDB ${typeof movie.rating === 'number' ? movie.rating.toFixed(1) : '—'}`}
      </div>

      {cardImage && (
        <div className="mt-4 flex items-center justify-between gap-3 border border-zinc-300 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-700">
            Card image · <span className="font-semibold">custom still / backdrop</span>
          </p>
          <button onClick={onClearCardImage} className="text-xs text-zinc-600 underline underline-offset-2 hover:text-black">
            Reset to poster
          </button>
        </div>
      )}
      </div>

      {/* 预览：普通文档流，海报在控件上方；固定展示槽，无白框无吸顶 */}
      <div className="order-1 mt-5 w-full">
      {/* 测量层：占满整行宽度 */}
      <div ref={previewAreaRef} className="flex w-full justify-center">
        {/* 固定槽：尺寸只随容器宽度变化，切比例时不变，海报在内等比居中 */}
        <div
          className="relative flex items-center justify-center overflow-hidden"
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
          />
          {/* 悬浮/触摸提示：点击放大 */}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition duration-200 group-hover:bg-black/25 group-hover:opacity-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
