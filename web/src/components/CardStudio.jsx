import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Card, { TEMPLATE_LIST } from './Card'

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
  `border px-3 py-1.5 text-sm transition ${
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
  // 横版预览以高度为约束（440 宽会让 1920x1080 预览过高）；
  // 再按容器实测宽度收窄——窄屏手机上预览永不溢出，且比例始终严格等于所选尺寸
  const desiredW = landscape ? PREVIEW_WIDTH * (size.w / size.h) : PREVIEW_WIDTH
  const previewW = Math.min(desiredW, availW)
  const previewH = (size.h / size.w) * previewW
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }))

  // 测量预览区可用宽度（含 RO：旋转屏/地址栏收放都即时重算）
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
    <section className="mt-10 border-t border-b border-zinc-300 py-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-600">Card Studio</h3>
        <button onClick={download} disabled={exporting} className={pill(true)}>
          {exporting ? 'Rendering' : 'Download PNG'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={label}>Template</span>
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => pickTemplate(t.id)} className={pill(config.template === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={label}>Size</span>
        {visibleSizes.map((s) => (
          <button key={s.id} onClick={() => set({ size: s.id })} className={pill(config.size === s.id)}>
            {s.id}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={label}>Background</span>
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

      <div className="mt-4">
        <span className={label}>Show</span>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => set({ [o.key]: !config[o.key] })}
              className={`w-full border px-3 py-2 text-sm transition ${
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

      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        onMouseLeave={() => setHoverRating(0)}
      >
        <span className={label}>Your rating</span>
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
              className={`text-lg leading-none transition ${lit ? 'text-amber-500' : 'text-zinc-300'}`}
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

      <div className="mt-4 text-xs text-zinc-600">
        {loadingText ? `Fetching ${loadingText}…` : ''}
        {ratings
          ? ` IMDb ${ratings.imdb != null ? ratings.imdb.toFixed(1) : '—'} · Metascore ${
              ratings.metacritic != null ? ratings.metacritic : '—'
            }`
          : ''}
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

      {/* 预览区：宽度按容器实测收窄，卡片严格保持所选尺寸比例，不拉伸不裁切 */}
      <div ref={previewAreaRef} className="mt-5 flex w-full flex-col items-center">
        <button
          type="button"
          onClick={openPreview}
          aria-label="Preview generated card"
          className="group relative block overflow-hidden shadow-md ring-1 ring-zinc-200 transition hover:ring-black"
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
        <p className="mt-2 text-center text-xs text-zinc-500">Tap the card to preview full size · {config.size}</p>
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
    </section>
  )
}
