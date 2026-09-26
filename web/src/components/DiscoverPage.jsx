import { useEffect, useRef, useState } from 'react'
import SmartImage from './SmartImage'
import StatusBadge from './StatusBadge'
import NavLink from './NavLink'
import { ShimmerBlock } from './Skeleton'
import { apiUrlWithLang, posterUrl } from '../api'
import { titleUrl } from '../routes'
import { genreDisplayName } from '../genres'
import { setDocTitle } from '../docTitle'
import { useI18n } from '../i18n'

// 筛选发现页：B 站式「索引页」——排序行 + 结果网格 + 右侧筛选面板（地区/类型/年份）。
// 数据来自 /api/discover/:kind（TMDB discover 白名单代理），卡片沿用类型页的样式：
// 真 <a> 新标签页打开（NavLink），海报走 SmartImage 全局并发队列。

// 与 server/index.js 的 DISCOVER_COUNTRIES / DISCOVER_DECADES 对齐的取值集
const COUNTRIES = ['CN', 'JP', 'US', 'GB', 'KR']
const DECADES = ['2020s', '2010s', '2000s', '1990s', '1980s', 'older']
const SORTS = ['popularity', 'newest', 'rating', 'votes']

// 筛选行：左侧固定标签 + 右侧可换行选项。选中项黑字下划线（全站黑白基调，
// 不用 B 站的蓝色高亮），未选中灰字悬停变黑。
function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex gap-3">
      <span className="w-10 shrink-0 pt-0.5 text-xs leading-5 text-zinc-400">{label}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((opt) => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => !selected && onChange(opt.value)}
              className={`text-xs leading-5 transition ${
                selected
                  ? 'font-medium text-black underline decoration-black/60 underline-offset-4'
                  : 'text-zinc-500 hover:text-black'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 结果卡片：与 GenrePage 的 TitleCard 同构（海报 2:3 + 标题 + 年份 + 评分），
// 剧集条目解析不出 TVmaze id 时渲染为不可点进的纯卡片，而不是指错剧的链接。
function DiscoverCard({ item }) {
  const { t } = useI18n()
  const poster = item.poster_path ? posterUrl(item.poster_path, 'w185') : null
  const inner = (
    <>
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-100">
        {poster ? (
          <SmartImage
            src={poster}
            alt={item.title}
            className="h-full w-full transition group-hover:opacity-80"
            objectFit="cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400">
            {t('common.noPoster')}
          </div>
        )}
        <StatusBadge kind={item.kind} id={item.id} size="md" />
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-tight text-zinc-900">
        {item.title}
        {item.year && <span className="ml-1 font-normal text-zinc-500">{item.year}</span>}
      </p>
      {item.rating > 0 && (
        <p className="text-[11px] font-semibold text-amber-600">★ {item.rating.toFixed(1)}</p>
      )}
    </>
  )
  if (item.id == null) {
    return <div className="group flex flex-col gap-1 text-left" title={item.title}>{inner}</div>
  }
  return (
    <NavLink
      to={titleUrl(item.kind, item.id, item.title)}
      className="group flex flex-col gap-1 text-left"
      title={`${item.title}${item.year ? ` (${item.year})` : ''}`}
    >
      {inner}
    </NavLink>
  )
}

// 加载骨架：12 格 2:3 shimmer 块（复用全站 shimmer 动画约定）
function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1">
          <ShimmerBlock className="aspect-[2/3] w-full" />
          <ShimmerBlock className="h-3 w-4/5" />
          <ShimmerBlock className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  )
}

export default function DiscoverPage({ kind, onKindChange, onBack }) {
  const { t, apiLang } = useI18n()
  // 筛选/排序状态留在组件内（URL 只记 kind，见 routes.js 的 discoverUrl）
  const [sort, setSort] = useState('popularity')
  const [country, setCountry] = useState('')
  const [genre, setGenre] = useState('')
  const [decade, setDecade] = useState('')
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)

  const [genreLists, setGenreLists] = useState({ movie: [], tv: [] })
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  // 标签页标题
  useEffect(() => {
    setDocTitle(t('discover.title'))
    // t 的引用不变，语言切换靠 apiLang 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLang])

  // 类型名录（本地化 id → 名称），两个 kind 各一套 id 命名空间
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(apiUrlWithLang('/api/genres'))
        if (!r.ok) return
        const data = await r.json()
        if (alive) setGenreLists({ movie: data.movie || [], tv: data.tv || [] })
      } catch { /* 静默：类型行拿不到就不显示，不影响其余筛选 */ }
    })()
    return () => { alive = false }
  }, [apiLang])

  function buildQuery(nextPage) {
    const qs = new URLSearchParams()
    if (genre) qs.set('genre', genre)
    if (country) qs.set('country', country)
    if (decade) qs.set('decade', decade)
    if (sort !== 'popularity') qs.set('sort', sort)
    if (nextPage > 1) qs.set('page', String(nextPage))
    return qs.toString()
  }

  // 序号守卫丢弃晚到的旧响应（不用 AbortController，见 App.jsx 同类注释）
  const fetchSeqRef = useRef(0)
  useEffect(() => {
    const seq = ++fetchSeqRef.current
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const qs = buildQuery(1)
        const r = await fetch(apiUrlWithLang(`/api/discover/${kind}${qs ? `?${qs}` : ''}`))
        if (seq !== fetchSeqRef.current) return
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setItems(data.items || [])
        setPage(1)
        setTotalPages(Math.min(data.total_pages || 1, 50))
      } catch (e) {
        if (seq === fetchSeqRef.current) setError(e.message || t('common.error'))
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false)
      }
    })()
    // apiLang：切换语言后片名/类型名要跟着换
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, genre, country, decade, sort, apiLang])

  async function loadMore() {
    if (loadingMore || page >= totalPages) return
    const next = page + 1
    setLoadingMore(true)
    try {
      const qs = buildQuery(next)
      const r = await fetch(apiUrlWithLang(`/api/discover/${kind}${qs ? `?${qs}` : ''}`))
      if (!r.ok) return
      const data = await r.json()
      setItems((prev) => [...prev, ...(data.items || [])])
      setPage(next)
      setTotalPages(Math.min(data.total_pages || totalPages, 50))
    } catch { /* swallow：下一页失败保留已加载内容 */ }
    finally {
      setLoadingMore(false)
    }
  }

  // 切 kind 标签：movie/tv 的 genre id 是两套命名空间，类型筛选必须清空；
  // 地区/年代/排序语义一致，保留
  function switchKind(next) {
    if (next === kind) return
    setGenre('')
    setMobilePanelOpen(false)
    onKindChange(next)
  }

  const countryOptions = [
    { value: '', label: t('discover.all') },
    ...COUNTRIES.map((c) => ({ value: c, label: t(`discover.region.${c.toLowerCase()}`) })),
  ]
  const decadeOptions = [
    { value: '', label: t('discover.all') },
    ...DECADES.map((d) => ({ value: d, label: t(`discover.decade.${d}`) })),
  ]
  const genreOptions = [
    { value: '', label: t('discover.all') },
    // /api/genres 的名字是 TMDB 按语言本地化的，个别类型 TMDB 没给中文 → 词典覆盖
    ...genreLists[kind].map((g) => ({ value: String(g.id), label: genreDisplayName(g, t) })),
  ]

  const panel = (
    <div className="flex flex-col gap-4">
      <FilterRow label={t('discover.region')} options={countryOptions} value={country} onChange={setCountry} />
      {genreOptions.length > 1 && (
        <FilterRow label={t('discover.genre')} options={genreOptions} value={genre} onChange={setGenre} />
      )}
      <FilterRow label={t('discover.year')} options={decadeOptions} value={decade} onChange={setDecade} />
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-600 transition hover:text-black"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        {t('common.back')}
      </button>

      <h1 className="mt-4 text-3xl font-bold uppercase tracking-tight text-zinc-900 sm:text-4xl">
        {t('discover.title')}
      </h1>
      <p className="mt-1 text-xs uppercase tracking-[0.25em] text-zinc-500">
        {t('discover.subtitle')}
      </p>

      {/* 电影 / 剧集 标签 */}
      <div className="mt-6 flex items-center gap-6 border-b border-zinc-200">
        {(['tv', 'movie']).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={`-mb-px border-b-2 pb-3 text-sm transition ${
              kind === k
                ? 'border-black font-medium text-black'
                : 'border-transparent text-zinc-500 hover:text-black'
            }`}
          >
            {k === 'tv' ? t('genre.tvShows') : t('genre.movies')}
          </button>
        ))}
      </div>

      {/* 排序行：左侧排序项，右侧移动端筛选开关（桌面筛选面板常驻右侧） */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-400">{t('discover.sortLabel')}</span>
        {SORTS.map((s) => {
          const selected = sort === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`text-xs transition ${
                selected
                  ? 'font-medium text-black underline decoration-black/60 underline-offset-4'
                  : 'text-zinc-500 hover:text-black'
              }`}
            >
              {t(`discover.sort.${s}`)}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMobilePanelOpen((o) => !o)}
          className="ml-auto inline-flex items-center gap-1.5 border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 transition hover:border-black hover:text-black lg:hidden"
          aria-expanded={mobilePanelOpen}
        >
          {t('discover.filters')}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${mobilePanelOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-8 pb-16 lg:flex-row lg:items-start">
        {/* 结果网格 */}
        <div className="min-w-0 flex-1">
          {loading && <GridSkeleton />}
          {error && !loading && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <div className="border border-dashed border-zinc-300 py-16 text-center">
              <p className="text-sm text-zinc-500">{t('discover.noResults')}</p>
            </div>
          )}
          {!loading && !error && items.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
                {items.map((m, idx) => (
                  <DiscoverCard key={`${m.kind}:${m.id ?? m.tmdb_id}:${idx}`} item={m} />
                ))}
              </div>
              {page < totalPages && (
                <div className="mt-8 text-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="border border-black px-6 py-2 text-xs uppercase tracking-[0.2em] text-black transition hover:bg-black hover:text-white disabled:opacity-50"
                  >
                    {loadingMore ? t('common.loading') : t('genre.loadMore', { page: page + 1, total: totalPages })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 筛选面板：lg+ 常驻右侧；< lg 收进「筛选」开关，展开时置于网格上方 */}
        <aside className={`${mobilePanelOpen ? 'block' : 'hidden'} shrink-0 border border-zinc-200 p-5 lg:block lg:w-56 lg:border-0 lg:p-0`}>
          <p className="mb-4 text-sm font-medium text-black lg:hidden">{t('discover.filters')}</p>
          {panel}
        </aside>
      </div>
    </div>
  )
}
