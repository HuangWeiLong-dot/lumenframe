import { useEffect, useRef, useState } from 'react'
import CardStudio from './components/CardStudio'
import CollapsibleSection from './components/CollapsibleSection'
import MovieCollage from './components/MovieCollage'
import FilmGrabShots from './components/FilmGrabShots'
import TrailerSection from './components/TrailerSection'
import WhereToWatch from './components/WhereToWatch'
import Torrents from './components/Torrents'
import Footer from './components/Footer'
import Header from './components/Header'
import LibraryPage from './components/LibraryPage'
import { useTrending } from './hooks/useTrending'
import { useLibrary } from './hooks/useLibrary'
import { apiUrl, posterUrl, downloadImage } from './api'

// ---- 极简 History API 路由 ----
// 路由格式：{BASE}movie/{tmdbId}-{片名 slug}，如 /movie/123-dead-poets-society
// id 保证刷新/分享链接能精确还原；slug 仅用于可读 URL，非 ASCII 片名时可缺省

// 运行时推导站点根路径（生产构建为相对 base './'，不能直接用 import.meta.env.BASE_URL）：
// 深链 /movie/... 或 /<repo>/movie/... 都能反推出根；根路径通常以 / 结尾
function getBasePath() {
  const p = window.location.pathname
  const i = p.indexOf('/movie/')
  if (i >= 0) return p.slice(0, i + 1)
  if (p.endsWith('/')) return p
  return p.slice(0, p.lastIndexOf('/') + 1)
}
const BASE_PATH = getBasePath()

function slugify(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

function movieUrl(id, title) {
  const slug = slugify(title)
  return `${BASE_PATH}movie/${id}${slug ? `-${slug}` : ''}`
}

// 从当前 location 解析电影路由；非电影页返回 null
function parseMovieRoute() {
  const m = window.location.pathname.match(/\/movie\/(\d+)(?:-.*)?\/?$/)
  return m ? Number(m[1]) : null
}

function libraryUrl() {
  return `${BASE_PATH}library`
}

function parseLibraryRoute() {
  return /\/library\/?$/.test(window.location.pathname)
}


// 滚动海报背景墙（Canvas 绘制，海报来源 = TMDB 本周热门）
function PosterBackground() {
  const canvasRef = useRef(null)
  const posters = useTrending()

  // 只在 posters 变化时重新构建列数据，不重建 RAF/监听
  const colsRef = useRef([])

  // 动画 + 尺寸监听（posters 不变时不会重建）
  useEffect(() => {
    if (posters.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const GAP = 8

    function calcColumns(w) {
      if (w >= 1600) return 7
      if (w >= 1280) return 6
      if (w >= 1024) return 5
      if (w >= 768) return 4
      if (w >= 480) return 3
      return 2
    }

    function buildCols(n) {
      return Array.from({ length: n }, (_, i) => ({
        items: posters.filter((_, idx) => idx % n === i),
        offset: -i * 60,
        speed: 0.25 + (i % 3) * 0.12,
        reverse: i % 2 === 1,
      }))
    }

    const imgMap = new Map()
    posters.forEach((p) => {
      const img = new Image()
      img.crossOrigin = 'anonymous' // 跨域部署时保证背景 canvas 不被标记为 tainted
      img.src = posterUrl(p.poster_path, 'w342')
      imgMap.set(p.id, img)
    })

    let COLUMNS = calcColumns(window.innerWidth)
    let cols = buildCols(COLUMNS)
    colsRef.current = cols

    let colW = 0, posterH = 0
    function resize() {
      const w = window.innerWidth, h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = calcColumns(w)
      if (n !== COLUMNS) { COLUMNS = n; cols = buildCols(n); colsRef.current = cols }
      colW = (w - GAP * (COLUMNS + 1)) / COLUMNS
      posterH = colW * 1.5
    }
    resize()
    window.addEventListener('resize', resize)

    // 视口外暂停动画，节省 CPU
    let visible = true
    const io = new IntersectionObserver(
      (entries) => { visible = entries[0].isIntersecting },
      { threshold: 0 }
    )
    io.observe(canvas)

    let raf
    function draw() {
      raf = requestAnimationFrame(draw)
      if (!visible) return
      const w = window.innerWidth, h = window.innerHeight
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = 0.38
      const colsNow = colsRef.current
      colsNow.forEach((col, i) => {
        const x = GAP + i * (colW + GAP)
        const items = col.items
        const span = items.length * (posterH + GAP)
        let y = col.offset
        for (let k = 0; k < 2; k++) {
          for (const p of items) {
            if (y <= h && y + posterH >= 0) {
              const img = imgMap.get(p.id)
              if (img && img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, x, y, colW, posterH)
              }
            }
            y += posterH + GAP
          }
          if (k === 0) y = col.offset + span
        }
        col.offset += col.reverse ? -col.speed : col.speed
        if (col.offset > 0) col.offset -= span
        if (col.offset < -span) col.offset += span
      })
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      io.disconnect()
    }
  }, [posters])

  return (
    <div className="poster-wall" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}

// 添加到观影库的按钮
function WatchButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] transition ${
        active
          ? 'border-black bg-black text-white'
          : 'border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50'
      }`}
    >
      {active && (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {label}
    </button>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [error, setError] = useState('')
  const [movie, setMovie] = useState(null)
  // 首屏若是深链（/movie/...），直接进入加载态，避免首页闪一下
  const initialMovieIdRef = useRef(parseMovieRoute())
  const initialLibraryRef = useRef(parseLibraryRoute())
  const [view, setView] = useState(initialLibraryRef.current ? 'library' : 'home')
  const [detailLoading, setDetailLoading] = useState(initialMovieIdRef.current != null)
  const [specs, setSpecs] = useState(null)
  const [specsLoading, setSpecsLoading] = useState(false)
  const [ratings, setRatings] = useState(null)
  const [ratingsLoading, setRatingsLoading] = useState(false)
  const [backdrops, setBackdrops] = useState([])
  const [posters, setPosters] = useState([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [personal, setPersonal] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  // 从 Posters / Film Stills / Backdrops 中挑选、用于生成卡片的自定义图片（null = 官方主海报）
  const [cardImage, setCardImage] = useState(null)
  // Backdrops / Posters 灯箱当前图片
  const [activeBackdrop, setActiveBackdrop] = useState(null)
  const [activePoster, setActivePoster] = useState(null)
  const searchBoxRef = useRef(null)
  // 每次打开电影自增；过期异步响应（旧电影晚到的 specs/ratings/images）一律丢弃
  const reqTokenRef = useRef(0)
  // 本地观影库（watched / watch later）
  const lib = useLibrary()
  // 当前电影页能否用浏览器后退：应用内点选进来为 true（回到上一页）；
  // 深链直接打开为 false（Back 按钮改走回主页）
  const canBackRef = useRef(false)

  // 灯箱：Esc 关闭（Backdrops / Posters 共用）
  useEffect(() => {
    if (activeBackdrop == null && activePoster == null) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setActiveBackdrop(null)
      setActivePoster(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeBackdrop, activePoster])

  // 输入时实时搜索：300ms 防抖 + 序号守卫防止旧请求晚返回造成乱序。
  // 不用 AbortController——取消在途 fetch 会让浏览器打印 net::ERR_ABORTED；
  // 旧响应靠 seq 丢弃即可（请求本身很轻，且后端有缓存）。
  const searchSeqRef = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSuggestLoading(false)
      return
    }
    setSuggestLoading(true)
    const seq = ++searchSeqRef.current
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`))
        const data = await res.json()
        if (seq !== searchSeqRef.current) return
        if (!res.ok) throw new Error(data.error || 'Search failed')
        setResults(data.results || [])
      } catch {
        if (seq === searchSeqRef.current) setResults([])
      } finally {
        if (seq === searchSeqRef.current) setSuggestLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // 点击下拉外部或按 Esc 关闭
  useEffect(() => {
    if (!dropdownOpen) return
    const onDown = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setDropdownOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setDropdownOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dropdownOpen])

  // 回车提交无需重新请求：输入时防抖搜索已拿到当前 query 的结果，这里只确保下拉展开
  function handleSearch(e) {
    e.preventDefault()
    if (query.trim()) setDropdownOpen(true)
  }

  async function loadSpecs(m, token) {
    setSpecs(null)
    setSpecsLoading(true)
    if (!m.imdb_id) {
      if (token === reqTokenRef.current) setSpecsLoading(false)
      return
    }
    try {
      const url = apiUrl(`/api/specs/${m.imdb_id}?title=${encodeURIComponent(m.title)}&year=${m.year}`)
      const res = await fetch(url)
      if (token !== reqTokenRef.current) return
      setSpecs(res.ok ? await res.json() : { found: false })
    } catch {
      if (token !== reqTokenRef.current) return
      setSpecs({ found: false })
    } finally {
      if (token === reqTokenRef.current) setSpecsLoading(false)
    }
  }

  async function loadRatings(m, token) {
    setRatings(null)
    setRatingsLoading(true)
    if (!m.imdb_id) {
      if (token === reqTokenRef.current) setRatingsLoading(false)
      return
    }
    try {
      const url = apiUrl(`/api/ratings/${m.imdb_id}?title=${encodeURIComponent(m.title)}&year=${m.year}`)
      const res = await fetch(url)
      if (token !== reqTokenRef.current) return
      setRatings(res.ok ? await res.json() : { imdb: null, metacritic: null, rotten_tomatoes: null, popcornmeter: null })
    } catch {
      if (token !== reqTokenRef.current) return
      setRatings({ imdb: null, metacritic: null, rotten_tomatoes: null, popcornmeter: null })
    } finally {
      if (token === reqTokenRef.current) setRatingsLoading(false)
    }
  }

  async function loadImages(id, token) {
    setBackdrops([])
    setPosters([])
    setImagesLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/movie/${id}/images`))
      if (token !== reqTokenRef.current) return
      if (res.ok) {
        const data = await res.json()
        setBackdrops(data.backdrops || [])
        setPosters(data.posters || [])
      }
    } catch {
      if (token !== reqTokenRef.current) return
      setBackdrops([])
      setPosters([])
    } finally {
      if (token === reqTokenRef.current) setImagesLoading(false)
    }
  }

  // 个人评分仅保存在本机浏览器，按 TMDB id 区分；同时同步到观影库
  function changePersonal(v) {
    setPersonal(v)
    if (movie) {
      localStorage.setItem(`lumenframe:myrating:${movie.id}`, String(v))
      lib.updateMyRating(movie.id, v)
    }
  }

  // 打分：设置评分，若不在 watched 则自动加入 watched
  function handleRate(n) {
    const v = personal === n ? 0 : n
    changePersonal(v)
    if (v > 0 && movie && !lib.isInWatched(movie.id)) {
      lib.addToWatched(movie, v)
    }
  }

  // 清空当前电影的全部视图状态（回主页 / 前进后退到主页时复用）
  function resetMovieView() {
    setError('')
    setCardImage(null)
    setActiveBackdrop(null)
    setActivePoster(null)
    setSpecs(null)
    setRatings(null)
    setBackdrops([])
    setPosters([])
    setMovie(null)
  }

  // history: 'push' 点击选片（新增历史条目）；'none' 前进后退/深链/首屏（URL 已就位）
  async function openMovie(id, { history = 'push', scroll = true } = {}) {
    // 新请求使所有在途旧请求失效，杜绝快速切换时旧电影数据串到新电影页面
    const token = ++reqTokenRef.current
    setView('movie')
    setDetailLoading(true)
    setError('')
    setDropdownOpen(false)
    setQuery('')
    setCardImage(null)
    setActiveBackdrop(null)
    setActivePoster(null)
    setSpecs(null)
    setRatings(null)
    setBackdrops([])
    setPosters([])
    try {
      const res = await fetch(apiUrl(`/api/movie/${id}`))
      if (token !== reqTokenRef.current) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load movie')
      setMovie(data)
      setPersonal(Number(localStorage.getItem(`lumenframe:myrating:${data.id}`)) || 0)
      // 同步规范 URL（含正式片名 slug）；popstate/深链只在 slug 缺失或不符时 replace
      const canonical = movieUrl(data.id, data.title)
      if (history === 'push') {
        window.history.pushState({ movieId: data.id }, '', canonical)
        canBackRef.current = true
      } else if (window.location.pathname !== canonical) {
        window.history.replaceState({ movieId: data.id }, '', canonical)
      }
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' })
      loadSpecs(data, token)
      loadRatings(data, token)
      loadImages(id, token)
    } catch (err) {
      setError(err.message)
    } finally {
      if (token === reqTokenRef.current) setDetailLoading(false)
    }
  }

  // 回主页：清状态 + URL 回根（已是根则不入栈）
  function goHome() {
    reqTokenRef.current++
    resetMovieView()
    setView('home')
    if (window.location.pathname !== BASE_PATH) {
      window.history.pushState({ home: true }, '', BASE_PATH)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 打开观影库
  function goLibrary() {
    reqTokenRef.current++
    resetMovieView()
    setView('library')
    window.history.pushState({ library: true }, '', libraryUrl())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 首屏深链直开
  useEffect(() => {
    if (initialMovieIdRef.current != null) {
      openMovie(initialMovieIdRef.current, { history: 'none', scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 浏览器前进 / 后退
  useEffect(() => {
    const onPop = () => {
      const id = parseMovieRoute()
      // 后退/前进到电影页时仍可继续后退；落到主页/库页则 Back 应回主页
      canBackRef.current = id != null
      if (id != null) {
        openMovie(id, { history: 'none', scroll: false })
      } else if (parseLibraryRoute()) {
        reqTokenRef.current++
        resetMovieView()
        setView('library')
      } else {
        reqTokenRef.current++
        resetMovieView()
        setView('home')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      <PosterBackground />
      <Header onHome={goHome} onLibrary={goLibrary} />

      {view === 'library' ? (
        <main
          className="mx-auto flex w-full flex-1 flex-col pt-24"
          style={{ fontFamily: "'Inter', Arial, sans-serif" }}
        >
          <LibraryPage
            onOpenMovie={(id) => openMovie(id)}
            onGoHome={goHome}
          />
        </main>
      ) : (
      <main
        className={`mx-auto flex w-full flex-1 flex-col pt-20 sm:pt-24 ${
          movie ? 'max-w-5xl px-4 sm:px-6' : 'px-4 sm:px-8 lg:px-12'
        }`}
        style={{ fontFamily: "'Inter', Arial, sans-serif" }}
      >
      <h1>
        <button
          onClick={goHome}
          className="block w-full text-center text-5xl font-bold uppercase tracking-tight text-black transition hover:opacity-70"
        >
          LUMENFRAME
        </button>
      </h1>
      <p className="mt-3 text-center text-xs uppercase tracking-[0.3em] text-zinc-700">Every Frame Tells A Story</p>

      {/* 搜索框 + 紧贴下方的实时建议下拉面板（不必通栏：桌面收窄居中，移动端自然铺满） */}
      <div ref={searchBoxRef} className="relative z-40 mx-auto mt-12 w-full max-w-xl">
        <form onSubmit={handleSearch} className="flex gap-0 border-b border-black">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
            onFocus={() => { if (query.trim()) setDropdownOpen(true) }}
            placeholder="Search a movie, e.g. Interstellar"
            autoComplete="off"
            className="flex-1 bg-transparent py-3 text-base text-black outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={suggestLoading || !query.trim()}
            className="px-6 py-3 text-sm uppercase tracking-widest text-black transition hover:bg-black hover:text-white disabled:opacity-40"
          >
            {suggestLoading ? 'Searching' : 'Search'}
          </button>
        </form>

        {dropdownOpen && query.trim() && (
          <div className="absolute inset-x-0 top-full max-h-[60vh] overflow-y-auto border border-zinc-300 border-t-0 bg-white shadow-xl">
            {suggestLoading && results.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-zinc-600">Searching…</p>
            )}
            {!suggestLoading && results.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-zinc-600">No results found</p>
            )}
            {results.map((m) => (
              <button
                key={m.id}
                onClick={() => openMovie(m.id)}
                className="flex w-full gap-3 border-b border-zinc-100 px-3 py-3 text-left transition last:border-0 hover:bg-zinc-50"
              >
                {/* 固定 2:3 海报框 + object-cover，任何海报都不会拉伸 */}
                <div className="h-24 w-16 shrink-0 overflow-hidden bg-zinc-100">
                  {m.poster_path ? (
                    <img
                      src={posterUrl(m.poster_path, 'w185')}
                      alt=""
                      loading="lazy"
                      crossOrigin="anonymous"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-zinc-500">
                      No poster
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {m.title}
                    {m.year && <span className="ml-1.5 font-normal text-zinc-500">{m.year}</span>}
                    {m.rating > 0 && (
                      <span className="ml-2 font-normal text-amber-600">★ {m.rating.toFixed(1)}</span>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                    {m.overview || 'No description available.'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {!movie && !detailLoading && <MovieCollage onPick={openMovie} />}

      {detailLoading && <p className="mt-8 text-sm text-zinc-600">Loading…</p>}

      {movie && !detailLoading && (
        // 返回：应用内进入走浏览器历史；深链直开（无上一页）则回主页
        <button
          type="button"
          onClick={() => (canBackRef.current ? window.history.back() : goHome())}
          className="mt-8 inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-600 transition hover:text-black"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
      )}

      {movie && !detailLoading && (
        // 移动端纵向堆叠（海报居中在上、信息在下全宽）；sm 及以上恢复海报左 + 信息右
        <section className="mt-6 flex flex-col items-center gap-5 sm:mt-8 sm:flex-row sm:items-start sm:gap-6">
          {/* 只固定宽度，高度按海报真实比例自适应：完整、不拉伸、不裁切、无白边 */}
          {movie.poster_path ? (
            <img
              src={posterUrl(movie.poster_path, 'w342')}
              alt={movie.title}
              crossOrigin="anonymous"
              className="h-auto w-32 shrink-0 self-center sm:w-40 sm:self-start"
            />
          ) : (
            <div className="flex aspect-[2/3] w-32 shrink-0 self-center items-center justify-center border border-zinc-300 text-xs text-zinc-600 sm:w-40 sm:self-start">
              No poster
            </div>
          )}
          <div className="min-w-0 w-full flex-1 text-center sm:text-left">
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">{movie.title}</h2>
            {movie.original_title !== movie.title && (
              <p className="mt-1 truncate text-sm text-zinc-600">{movie.original_title}</p>
            )}
            {/* 信息行：时长优先展示，评分依次；移动端居中换行，桌面端左对齐 */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-700 sm:justify-start sm:text-sm">
              <span>{movie.year}</span>
              {movie.runtime > 0 && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span>
                </>
              )}
              <span className="text-zinc-300">·</span>
              <span>TMDB {movie.rating.toFixed(1)}</span>
              {ratings?.imdb != null && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>IMDb {ratings.imdb.toFixed(1)}</span>
                </>
              )}
              {ratings?.rotten_tomatoes != null && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>🍅 {ratings.rotten_tomatoes}%</span>
                </>
              )}
              {ratings?.popcornmeter != null && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>🍿 {ratings.popcornmeter}%</span>
                </>
              )}
              {ratings?.metacritic != null && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>Metascore {ratings.metacritic}</span>
                </>
              )}
            </div>
            {/* 打分 + Watched / Watch Later：移动端居中堆叠，桌面端同行左对齐 */}
            <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-4 sm:justify-start">
              <div className="flex flex-wrap items-center justify-center gap-0.5 sm:gap-1">
                <span className="text-[11px] text-zinc-600 sm:text-xs">My score</span>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => handleRate(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`rate ${n}`}
                    className={`text-xs leading-none transition sm:text-sm ${
                      n <= (hoverRating || personal) ? 'text-amber-500' : 'text-zinc-300 hover:text-zinc-400'
                    }`}
                  >
                    ★
                  </button>
                ))}
                {personal > 0 && (
                  <button
                    onClick={() => changePersonal(0)}
                    className="ml-1 text-[11px] text-zinc-500 underline hover:text-zinc-700 sm:text-xs"
                  >
                    clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <WatchButton
                  active={lib.isInWatched(movie.id)}
                  onClick={() =>
                    lib.isInWatched(movie.id)
                      ? lib.removeFromWatched(movie.id)
                      : lib.addToWatched(movie, personal)
                  }
                  label="Watched"
                />
                <WatchButton
                  active={lib.isInWatchLater(movie.id)}
                  onClick={() =>
                    lib.isInWatchLater(movie.id)
                      ? lib.removeFromWatchLater(movie.id)
                      : lib.addToWatchLater(movie)
                  }
                  label="Watch Later"
                />
              </div>
            </div>
            {movie.credits?.director && (
              <p className="mt-2 text-sm text-zinc-700">Director · {movie.credits.director}</p>
            )}
            {movie.credits?.cast?.length > 0 && (
              <p className="mt-1 text-sm text-zinc-700">
                Starring · {movie.credits.cast.slice(0, 3).map((p) => p.name).join(', ')}
              </p>
            )}
            {specs?.cameras?.length > 0 && (
              <p className="mt-1 text-sm text-zinc-700">Camera · {specs.cameras.slice(0, 3).join(', ')}</p>
            )}
            {specs?.lenses?.length > 0 && (
              <p className="mt-1 text-sm text-zinc-700">Lenses · {specs.lenses.slice(0, 2).join(', ')}</p>
            )}
            {movie.overview && (
              <p className="mt-4 text-sm leading-relaxed text-zinc-800 sm:line-clamp-4">{movie.overview}</p>
            )}
          </div>
        </section>
      )}

      {movie && !detailLoading && (() => {
        // 只属于当前电影的备选海报：排除头部主海报，至多 10 张
        const altPosters = posters
          .filter((p) => p.file_path !== movie.poster_path)
          .slice(0, 10)
        return (
          <CollapsibleSection title="Posters" count={altPosters.length} defaultOpen>
            {imagesLoading ? (
              <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                Loading posters…
              </div>
            ) : altPosters.length === 0 ? (
              <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                No alternative posters available for this movie.
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-zinc-700">Tap a poster to use it on your generated card.</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
                  {altPosters.map((p, i) => {
                    const thumb = apiUrl(`/api/image?path=${encodeURIComponent(p.file_path)}&s=w342`)
                    const full = apiUrl(`/api/image?path=${encodeURIComponent(p.file_path)}&s=w780`)
                    const isSelected = cardImage === full
                    return (
                      <div
                        key={p.file_path || i}
                        className={`group relative aspect-[2/3] overflow-hidden bg-zinc-100 transition ${
                          isSelected ? 'ring-2 ring-black ring-offset-2' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setCardImage(isSelected ? null : full)}
                          className="absolute inset-0 h-full w-full"
                          aria-label={isSelected ? 'Remove poster from card' : 'Use this poster on card'}
                        >
                          <img
                            src={thumb}
                            alt={`${movie.title} poster ${i + 1}`}
                            loading="lazy"
                            crossOrigin="anonymous"
                            className="h-full w-full object-cover transition group-hover:scale-105"
                          />
                        </button>

                        {/* 放大预览（不影响选图） */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setActivePoster(full) }}
                          aria-label="Preview poster"
                          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="15 3 21 3 21 9" />
                            <polyline points="9 21 3 21 3 15" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                            <line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                        </button>

                        {isSelected && (
                          <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            On card
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </CollapsibleSection>
        )
      })()}

      {activePoster != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setActivePoster(null)}
        >
          <img
            src={activePoster}
            alt={`${movie?.title || ''} poster`}
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(activePoster, `${movie?.title || 'poster'} - poster.jpg`) }}
            aria-label="Download poster"
            className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      )}

      {movie && !detailLoading && (
        <CollapsibleSection title="Backdrops" count={backdrops.length}>
          {imagesLoading ? (
              <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                Loading backdrops…
              </div>
            ) : backdrops.length === 0 ? (
              <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                No backdrops available for this movie.
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-zinc-700">Tap a backdrop to use it on your generated card.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                {backdrops.map((b, i) => {
                  const thumb = apiUrl(`/api/image?path=${encodeURIComponent(b.file_path)}&s=w780`)
                  const full = apiUrl(`/api/image?path=${encodeURIComponent(b.file_path)}&s=w1280`)
                  const isSelected = cardImage === full
                  return (
                    <div
                      key={b.file_path || i}
                      className={`group relative aspect-video overflow-hidden bg-zinc-100 transition ${
                        isSelected ? 'ring-2 ring-black ring-offset-2' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setCardImage(isSelected ? null : full)}
                        className="absolute inset-0 h-full w-full"
                        aria-label={isSelected ? 'Remove backdrop from card' : 'Use this backdrop on card'}
                      >
                        <img
                          src={thumb}
                          alt={`${movie.title} backdrop ${i + 1}`}
                          loading="lazy"
                          crossOrigin="anonymous"
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      </button>

                      {/* 放大预览（不影响选图） */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveBackdrop(full) }}
                        aria-label="Preview backdrop"
                        className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="15 3 21 3 21 9" />
                          <polyline points="9 21 3 21 3 15" />
                          <line x1="21" y1="3" x2="14" y2="10" />
                          <line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                      </button>

                      {isSelected && (
                        <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          On card
                        </span>
                      )}
                    </div>
                  )
                })}
                </div>
              </>
            )}
        </CollapsibleSection>
      )}

      {activeBackdrop != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setActiveBackdrop(null)}
        >
          <img
            src={activeBackdrop}
            alt={`${movie?.title || ''} backdrop`}
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(activeBackdrop, `${movie?.title || 'backdrop'} - backdrop.jpg`) }}
            aria-label="Download backdrop"
            className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      )}

      {movie && !detailLoading && (
        <TrailerSection key={`trailer-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <WhereToWatch key={`watch-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <Torrents key={`torrents-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <FilmGrabShots
          key={movie.id}
          movie={movie}
          selected={cardImage}
          onSelect={setCardImage}
        />
      )}

      {movie && !detailLoading && (
        <CardStudio
          movie={movie}
          specs={specs}
          specsLoading={specsLoading}
          ratings={ratings}
          ratingsLoading={ratingsLoading}
          personal={personal}
          onPersonal={changePersonal}
          cardImage={cardImage}
          onClearCardImage={() => setCardImage(null)}
        />
      )}

    </main>
      )}
      <Footer />
    </div>
  )
}
