import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import CollapsibleSection from './components/CollapsibleSection'
import MovieCollage from './components/MovieCollage'
import QuizRecommender from './components/QuizRecommender'
import FilmGrabShots from './components/FilmGrabShots'
import TrailerSection from './components/TrailerSection'
import WhereToWatch from './components/WhereToWatch'
import Torrents from './components/Torrents'
import PlaySources from './components/PlaySources'
import TasteDiveSimilar from './components/TasteDiveSimilar'
import AlsoLiked from './components/AlsoLiked'
import SmartImage from './components/SmartImage'
import ShowEpisodes from './components/ShowEpisodes'
import TvBackdrops from './components/TvBackdrops'
import Footer from './components/Footer'
import Header from './components/Header'
import PinnedDrawer from './components/PinnedDrawer'
import LanguagePicker from './components/LanguagePicker'
import { useTrending } from './hooks/useTrending'
import { onIdle } from './idle'
import { useLibrary, ratingStorageKey, entryKey } from './hooks/useLibrary'
import { usePinned } from './hooks/usePinned'
import { useI18n } from './i18n'
import { apiUrl, apiUrlWithLang, posterUrl, posterFor, downloadImage } from './api'
import { genreIdByName } from './genres'
import { BASE_PATH, resolveSpaRedirect } from './spaUrl'
import {
  titleUrl, personUrl, genreUrl, libraryUrl,
  parseTitleRoute, parsePersonRoute, parseGenreRoute, parseLibraryRoute,
  preopenTab, setTabUrl, closeTab,
} from './routes'
import NavLink from './components/NavLink'
import { setDocTitle, setTabTitle } from './docTitle'
import { safeGet, safeSet } from './storage'
import { DetailHeaderSkeleton, RatingsSkeleton, SpecsSkeleton } from './components/Skeleton'
import StatusBadge from './components/StatusBadge'

// 按需加载：这四个都只在特定路由/状态下才渲染，静态引入会把它们的代码
// （尤其是 LibraryPage → LibraryStats → chart.js，约 200 KB 源码）塞进首屏主包。
// Lighthouse 实测首屏有 188 KiB 未使用的 JS，主体就是它。
// 首页真正要用的 MovieCollage / QuizRecommender 刻意保持静态引入 ——
// 它们是 LCP 表面，延迟加载反而推迟首屏。
const CardStudio = lazy(() => import('./components/CardStudio'))
const LibraryPage = lazy(() => import('./components/LibraryPage'))
const PersonPage = lazy(() => import('./components/PersonPage'))
const GenrePage = lazy(() => import('./components/GenrePage'))

// ---- 极简 History API 路由 ----
// 电影：{BASE}movie/{tmdbId}-{slug}；剧集：{BASE}tv/{tvmazeId}-{slug}
// 演职员：{BASE}person/{tmdbPersonId}-{slug}；类型：{BASE}genre/{kind}/{id}-{slug}
// id 保证刷新/分享链接能精确还原；slug 仅用于可读 URL，非 ASCII 片名时可缺省。
//
// 路径拼装/解析都在 ./routes，内容卡片要自己拼 <a href>（新标签页打开），
// 放在这里子组件就得反向 import App.jsx。

// 深链回退（_spa 解包）与 BASE_PATH 推导已搬到 ./spaUrl：
// Supabase 的邮件回调地址也要用 BASE_PATH，从那里 import 可避免循环依赖。
// 这里必须仍在模块求值期同步调用一次——它是深链能正常还原的前提。
resolveSpaRedirect()

// 演职员链接（导演 / 编剧 / 主演共用）。
// 电影：TMDB person id 就在手上，直接拼 href —— 真 <a>，新标签页。
// 剧集：cast 来自 TVmaze，id 是 TVmaze 的，得先用名字查 TMDB person，
//       所以只能交给 App 的 openPerson 在点击的同步阶段先占一个标签页（target:'new'）。
function Credit({ id, name, source, onLookup, children }) {
  const className = 'text-left text-zinc-800 underline-offset-2 transition hover:text-black hover:underline'
  if (source === 'tmdb' && id) {
    return <NavLink to={personUrl(id, name)} className={className}>{children}</NavLink>
  }
  return (
    <button type="button" onClick={() => onLookup({ id, name, source })} className={className}>
      {children}
    </button>
  )
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

    // 海报墙的图像延后到浏览器空闲再建。canvas 的 Image() 没有懒加载：原先
    // /api/trending 一返回就并发拉 20 张 w342（约 1 MB），正好在 LCP 那张海报图
    // 要下载时把慢速 4G 的带宽吃干净 —— 这是首屏 LCP 最大的单一干扰源。
    // 本墙画在 rgba(255,255,255,0.85) 遮罩 + 灰度滤镜下，canvas globalAlpha 0.38，
    // 有效不透明度约 5.7%，晚出现几秒、尺寸降一档都看不出来。
    // w185 与 MovieCollage 的 srcset 移动端档位一致，可复用同一份 HTTP 缓存。
    const imgMap = new Map()
    const buildImages = () => {
      posters.forEach((p) => {
        const img = new Image()
        img.crossOrigin = 'anonymous' // 跨域部署时保证背景 canvas 不被标记为 tainted
        img.src = posterUrl(p.poster_path, 'w185')
        imgMap.set(p.id, img)
      })
    }
    const cancelIdleBuild = onIdle(buildImages, 3000)

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
      cancelIdleBuild()
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
      className={`inline-flex min-w-[120px] items-center justify-center gap-1.5 border px-4 py-2 text-sm font-medium uppercase tracking-[0.1em] transition ${
        active
          ? 'border-black bg-black text-white'
          : 'border-zinc-300 text-zinc-700 hover:border-zinc-500 hover:bg-zinc-50'
      }`}
    >
      <svg
        className={`h-3 w-3 transition ${active ? 'opacity-100' : 'opacity-0'}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {label}
    </button>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [personResults, setPersonResults] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [error, setError] = useState('')
  const [movie, setMovie] = useState(null)
  // 首屏若是深链（/movie/... 或 /tv/...），直接进入加载态，避免首页闪一下
  const initialTitleRef = useRef(parseTitleRoute())
  const initialLibraryRef = useRef(parseLibraryRoute())
  const initialPersonRef = useRef(parsePersonRoute())
  const initialGenreRef = useRef(parseGenreRoute())
  const [view, setView] = useState(
    initialLibraryRef.current
      ? 'library'
      : initialPersonRef.current
        ? 'person'
        : initialGenreRef.current
          ? 'genre'
          : 'home'
  )
  const [person, setPerson] = useState(
    initialPersonRef.current ? { id: initialPersonRef.current.id, name: '' } : null
  )
  const [genre, setGenre] = useState(
    initialGenreRef.current
      ? { kind: initialGenreRef.current.kind, id: initialGenreRef.current.id, name: '' }
      : null
  )
  const [personSearchLoading, setPersonSearchLoading] = useState(false)
  const [personSearchError, setPersonSearchError] = useState('')
  const [detailLoading, setDetailLoading] = useState(initialTitleRef.current != null)
  const [specs, setSpecs] = useState(null)
  const [specsLoading, setSpecsLoading] = useState(false)
  const [ratings, setRatings] = useState(null)
  const [ratingsLoading, setRatingsLoading] = useState(false)
  const [backdrops, setBackdrops] = useState([])
  const [posters, setPosters] = useState([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [personal, setPersonal] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  // 短评：加载电影时从 library 读取；防抖保存
  const [note, setNoteState] = useState('')
  const noteTimerRef = useRef(null)
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
  const pins = usePinned()
  const { t, apiLang, lang } = useI18n()
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
  // 同时并行查 TMDB person（演职员），让用户能直接搜导演/演员名进入其作品页。
  const searchSeqRef = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setPersonResults([])
      setSuggestLoading(false)
      return
    }
    setSuggestLoading(true)
    const seq = ++searchSeqRef.current
    const timer = setTimeout(async () => {
      const [titleRes, personRes] = await Promise.allSettled([
        fetch(apiUrlWithLang(`/api/search?q=${encodeURIComponent(q)}`)),
        fetch(apiUrlWithLang(`/api/person/search?q=${encodeURIComponent(q)}&limit=5`)),
      ])
      if (seq !== searchSeqRef.current) return
      try {
        if (titleRes.status === 'fulfilled' && titleRes.value.ok) {
          const data = await titleRes.value.json()
          setResults(data.results || [])
        } else {
          setResults([])
        }
      } catch { setResults([]) }
      try {
        if (personRes.status === 'fulfilled' && personRes.value.ok) {
          const data = await personRes.value.json()
          setPersonResults(data.results || [])
        } else {
          setPersonResults([])
        }
      } catch { setPersonResults([]) }
      finally {
        if (seq === searchSeqRef.current) setSuggestLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
    // apiLang：切换语言后搜索结果也要跟着变成对应语言
  }, [query, apiLang])

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
      // ShotOnWhat 只认英文片名：中文界面下用 title_en（后端也会做一次 IMDb 反查兜底）
      const url = apiUrl(`/api/specs/${m.imdb_id}?title=${encodeURIComponent(m.title_en || m.title)}&year=${m.year}`)
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
      // RT 页面抓取只认英文片名（同上）
      const url = apiUrl(`/api/ratings/${m.imdb_id}?title=${encodeURIComponent(m.title_en || m.title)}&year=${m.year}`)
      const res = await fetch(url)
      if (token !== reqTokenRef.current) return
      const data = res.ok
        ? await res.json()
        : { imdb: null, metacritic: null, rotten_tomatoes: null, popcornmeter: null }
      setRatings(data)
      // 同步到观影库，让数据分析页能聚合多源评分
      const kind = m.kind === 'tv' ? 'tv' : 'movie'
      lib.updateRatings(kind, m.id, data)
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
      const res = await fetch(apiUrlWithLang(`/api/movie/${id}/images`))
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

  function changePersonal(v) {
    setPersonal(v)
    if (movie) {
      const kind = movie.kind === 'tv' ? 'tv' : 'movie'
      safeSet(ratingStorageKey(kind, movie.id), String(v))
      lib.updateMyRating(kind, movie.id, v)
    }
  }

  // 打分：设置评分，若不在 watched 则自动加入 watched
  function handleRate(n) {
    const v = personal === n ? 0 : n
    changePersonal(v)
    if (v > 0 && movie) {
      const kind = movie.kind === 'tv' ? 'tv' : 'movie'
      if (!lib.isInWatched(kind, movie.id)) lib.addToWatched({ ...movie, ratings }, v)
    }
  }

  // 短评：防抖 500ms 保存到 library
  function handleNoteChange(text) {
    setNoteState(text)
    if (!movie) return
    const kind = movie.kind === 'tv' ? 'tv' : 'movie'
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      lib.setNote(kind, movie.id, text.trim())
    }, 500)
  }

  // 清空当前标题的全部视图状态（回主页 / 前进后退到主页时复用）
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
  async function openTitle(kind, id, { history = 'push', scroll = true } = {}) {
    // 新请求使所有在途旧请求失效，杜绝快速切换时旧数据串到新页面
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
      const endpoint = kind === 'tv' ? `/api/tv/${id}` : `/api/movie/${id}`
      // 电影与剧集都是可本地化接口：剧集的载荷本体来自 TVmaze（英文），
      // 后端在 ?lang= 下把 TMDB 的中文片名/简介/类型叠上去（server/tvmeta.js）
      const res = await fetch(apiUrlWithLang(endpoint))
      if (token !== reqTokenRef.current) return
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to load ${kind === 'tv' ? 'show' : 'movie'}`)
      setMovie(data)
      // 语言可能已切换：把最新的本地化元信息（标题 / 类型名 / 海报）同步回收藏、观影库与「喜欢」
      // 本地存的是当初打开时的语言快照；未命中的条目 / 未变的字段不会写入
      pins.updateEntry(kind, data.id, { title: data.title })
      lib.updateEntryMeta(kind, data.id, { title: data.title, genres: data.genres, poster_path: data.poster_path })
      lib.updateLikesMeta([{
        type: kind,
        id: data.id,
        name: data.title,
        poster: data.poster_path ? posterUrl(data.poster_path, 'w185') : undefined,
      }])
      // 评分优先取观影库条目：云端合并后 watched[].myRating 才是权威值，
      // 标量 key 仅作为「评了分但没加入片库」时的兜底（否则合并后详情页会显示旧分）
      const ratedEntry = lib.watched.find(
        (m) => entryKey(m.kind, m.id) === entryKey(kind, data.id)
      )
      setPersonal(
        ratedEntry
          ? Number(ratedEntry.myRating) || 0
          : Number(safeGet(ratingStorageKey(kind, data.id))) || 0
      )
      // 加载短评
      setNoteState(lib.getNote(kind, data.id))
      // 同步规范 URL（含正式片名 slug）；popstate/深链只在 slug 缺失或不符时 replace
      const canonical = titleUrl(kind, data.id, data.title)
      if (history === 'push') {
        window.history.pushState({ kind, id: data.id }, '', canonical)
        canBackRef.current = true
      } else if (window.location.pathname !== canonical) {
        window.history.replaceState({ kind, id: data.id }, '', canonical)
      }
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' })
      loadRatings(data, token)
      if (kind === 'movie') {
        loadSpecs(data, token)
        loadImages(id, token)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      if (token === reqTokenRef.current) setDetailLoading(false)
    }
  }

  function openShow(id, opts) {
    return openTitle('tv', id, opts)
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

  // 打开演职员详情页：source='tmdb' 时 id 直接是 TMDB person id；
  // source='tvmaze'（剧集 cast）时需先用名字查 TMDB person，再跳转
  //
  // target='new'：同步能拼出 URL 的调用点直接用 <NavLink> 了，走不到这里；
  // 会走到这里的是「剧集演职员」这类要先 await 查 id 的。await 期间调用栈已经退出点击事件，
  // 那时再 window.open 会被弹窗拦截，所以必须在点击的**同步阶段**先占一个空白标签页。
  async function openPerson({ id, name, source = 'tmdb' } = {},
                            { history: historyOpt = 'push', scroll = true, target = 'self' } = {}) {
    let tab = target === 'new' ? preopenTab() : null
    if (target === 'new' && !tab) target = 'self' // 被拦截 → 退回原地跳转
    // 占位标签页在查到 TMDB id 之前标题是 about:blank，先把人名填上
    if (tab) setTabTitle(tab, name)

    let tmdbId = null
    if (source === 'tmdb' && id) {
      tmdbId = id
    } else if (name) {
      setPersonSearchLoading(true)
      setPersonSearchError('')
      try {
        const qs = new URLSearchParams({ q: name, limit: '1' })
        const r = await fetch(apiUrlWithLang(`/api/person/search?${qs}`))
        if (r.ok) {
          const data = await r.json()
          tmdbId = data.results?.[0]?.id
        }
      } catch { /* swallow */ }
      finally {
        setPersonSearchLoading(false)
      }
      if (!tmdbId) {
        closeTab(tab) // 查不到就别留个空白标签页
        setPersonSearchError(t('detail.couldntFindPerson', { name }))
        // 5 秒后自动清掉错误提示
        setTimeout(() => setPersonSearchError(''), 5000)
        return
      }
    }
    if (!tmdbId) { closeTab(tab); return }

    // 新标签页分支：当前页面完全不动，所以不碰 reqTokenRef / resetMovieView
    if (tab) {
      setTabUrl(tab, personUrl(tmdbId, name))
      return
    }

    reqTokenRef.current++
    resetMovieView()
    setPerson({ id: tmdbId, name: name || '' })
    setView('person')
    const url = personUrl(tmdbId, name)
    if (historyOpt === 'push') {
      window.history.pushState({ person: true, id: tmdbId, name: name || '' }, '', url)
      canBackRef.current = true
    } else if (window.location.pathname !== url) {
      window.history.replaceState({ person: true, id: tmdbId, name: name || '' }, '', url)
    }
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // <Credit> 的回调：剧集演职员没有 TMDB id，先占标签页再异步查（见 openPerson）
  function lookupPersonInNewTab(args) {
    return openPerson(args, { target: 'new' })
  }

  // 打开类型浏览页（已有 TMDB id）
  function openGenre(kind, id, name, { history: historyOpt = 'push', scroll = true } = {}) {
    if (!id) return
    reqTokenRef.current++
    resetMovieView()
    setGenre({ kind, id, name: name || '' })
    setView('genre')
    const url = genreUrl(kind, id, name)
    if (historyOpt === 'push') {
      window.history.pushState({ genre: true, kind, id, name: name || '' }, '', url)
      canBackRef.current = true
    } else if (window.location.pathname !== url) {
      window.history.replaceState({ genre: true, kind, id, name: name || '' }, '', url)
    }
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 详情页点击 genres 字符串时调用：优先用静态英文名映射表反查 TMDB id；
  // 中文界面下类型名是中文（映射表命中不了），用后端返回的 genre_ids[idx] 兜底
  function openGenreByName(name, kind, idx) {
    const id = genreIdByName(name, kind) || movie?.genre_ids?.[idx] || null
    if (!id) return
    openGenre(kind, id, name)
  }

  // 语言切换：当前详情页立即用新语言重拉。
  // 电影和剧集都要 —— 剧集的载荷虽然来自 TVmaze，中文片名/简介/类型是后端从 TMDB
  // 叠上去的（server/tvmeta.js），不重拉就一直是上一个语言的。
  const prevApiLangRef = useRef(apiLang)
  useEffect(() => {
    if (prevApiLangRef.current === apiLang) return
    prevApiLangRef.current = apiLang
    if (view === 'movie' && movie) {
      openTitle(movie.kind === 'tv' ? 'tv' : 'movie', movie.id, { history: 'none', scroll: false })
    }
    // 仅在语言变化时触发；openTitle 每次渲染都是新引用，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLang])

  // 标签页标题：当前页面 + 当前语言。
  // 电影/剧集、观影库、首页在这里统管；演职员页和类型页由各自组件设置 ——
  // App 手里只有 URL 里的 id，名字要等子组件取到数据 / 类型名录才有。
  // lang 必须在依赖里：观影库标题是「我的观影库 / My Library」，与数据无关，只在语言变化时变。
  useEffect(() => {
    if (view === 'movie') setDocTitle(movie?.title)
    else if (view === 'library') setDocTitle(t('library.myLibrary'))
    else if (view === 'home') setDocTitle(null)
  }, [view, movie?.title, lang])

  // 首屏深链直开
  useEffect(() => {
    if (initialTitleRef.current != null) {
      const { kind, id } = initialTitleRef.current
      openTitle(kind, id, { history: 'none', scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 浏览器前进 / 后退
  useEffect(() => {
    const onPop = () => {
      const titleRoute = parseTitleRoute()
      const personRoute = parsePersonRoute()
      const genreRoute = parseGenreRoute()
      // 后退/前进到标题/演职员/类型页时仍可继续后退；落到主页/库页则 Back 应回主页
      canBackRef.current = titleRoute != null || personRoute != null || genreRoute != null
      if (titleRoute != null) {
        openTitle(titleRoute.kind, titleRoute.id, { history: 'none', scroll: false })
      } else if (personRoute != null) {
        reqTokenRef.current++
        resetMovieView()
        setPerson({ id: personRoute.id, name: '' })
        setView('person')
      } else if (genreRoute != null) {
        reqTokenRef.current++
        resetMovieView()
        setGenre({ kind: genreRoute.kind, id: genreRoute.id, name: '' })
        setView('genre')
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
      {/* 首次访问（localStorage 里还没有语言选择）时弹出的语言偏好选择 */}
      <LanguagePicker />
      <Header onHome={goHome} onLibrary={goLibrary} />
      {/* 左侧固定收藏栏（收起的抽屉）：Pin 后卡片从右侧滑入并常驻页面左边缘 */}
      <PinnedDrawer
        pinned={pins.pinned}
        onUnpin={(p) => pins.removePin(p.kind, p.id)}
      />

      {/* TV 演员跳转 TMDB 时的查找提示：右下角 toast（上移避开语言切换按钮） */}
      {(personSearchLoading || personSearchError) && (
        <div className="fixed bottom-20 right-6 z-[1100] border border-zinc-200 bg-white px-4 py-3 text-xs shadow-lg">
          {personSearchLoading ? (
            <span className="text-zinc-700">{t('detail.lookingUpPerson')}</span>
          ) : (
            <span className="text-red-600">{personSearchError}</span>
          )}
        </div>
      )}
      {view === 'library' ? (
        <main
          className="mx-auto flex w-full flex-1 flex-col pt-24"
        >
          <Suspense fallback={null}>
            <LibraryPage onGoHome={goHome} />
          </Suspense>
        </main>
      ) : view === 'person' ? (
        <main
          className="mx-auto flex w-full flex-1 flex-col pt-20 sm:pt-24"
        >
          {person && (
            <Suspense fallback={null}>
              <PersonPage
                personId={person.id}
                isInLikes={lib.isInLikes}
                toggleLike={lib.toggleLike}
                onBack={() => (canBackRef.current ? window.history.back() : goHome())}
                onOpenShow={openShow}
              />
            </Suspense>
          )}
        </main>
      ) : view === 'genre' ? (
        <main
          className="mx-auto flex w-full flex-1 flex-col pt-20 sm:pt-24"
        >
          {genre && (
            <Suspense fallback={null}>
              <GenrePage
                kind={genre.kind}
                genreId={genre.id}
                genreName={genre.name}
                isInLikes={lib.isInLikes}
                toggleLike={lib.toggleLike}
                onBack={() => (canBackRef.current ? window.history.back() : goHome())}
              />
            </Suspense>
          )}
        </main>
      ) : (
      <main
        className={`mx-auto flex w-full flex-1 flex-col pt-20 sm:pt-24 ${
          movie || detailLoading ? 'max-w-5xl px-4 sm:px-6' : 'px-4 sm:px-8 lg:px-12'
        }`}
      >
      <h1>
        <button
          onClick={goHome}
          className="block w-full text-center text-5xl font-bold uppercase tracking-tight text-black transition hover:opacity-70"
        >
          LUMENFRAME
        </button>
      </h1>
      <p className="mt-3 text-center text-xs uppercase tracking-[0.3em] text-zinc-700">{t('footer.tagline')}</p>

      {/* 搜索框 + 紧贴下方的实时建议下拉面板（电影与剧集混合搜索，无需切换） */}
      <div ref={searchBoxRef} className="relative z-40 mx-auto mt-12 w-full max-w-xl">
        <form onSubmit={handleSearch} className="flex gap-0 border-b border-black">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
            onFocus={() => { if (query.trim()) setDropdownOpen(true) }}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            className="flex-1 bg-transparent py-3 text-base text-black outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={suggestLoading || !query.trim()}
            className="px-6 py-3 text-sm uppercase tracking-widest text-black transition hover:bg-black hover:text-white disabled:opacity-40"
          >
            {suggestLoading ? t('common.searching') : t('common.search')}
          </button>
        </form>

        {dropdownOpen && query.trim() && (
          <div className="absolute inset-x-0 top-full max-h-[60vh] overflow-y-auto border border-zinc-300 border-t-0 bg-white shadow-xl">
            {suggestLoading && results.length === 0 && personResults.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-zinc-600">{t('common.searching')}…</p>
            )}
            {!suggestLoading && results.length === 0 && personResults.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-zinc-600">{t('common.noResults')}</p>
            )}

            {/* People 段：TMDB 演职员结果 */}
            {personResults.length > 0 && (
              <>
                <p className="sticky top-0 bg-white px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-400">
                  {t('common.people')}
                </p>
                {personResults.map((p) => {
                  const profile = p.profile_path ? posterUrl(p.profile_path, 'w185') : null
                  const knownTitles = (p.known_for || [])
                    .map((k) => k.title)
                    .filter(Boolean)
                    .slice(0, 3)
                  return (
                    <NavLink
                      key={`p:${p.id}`}
                      to={personUrl(p.id, p.name)}
                      // onClick 只关下拉：不要 preventDefault，那会取消新标签页
                      onClick={() => { setDropdownOpen(false); setQuery('') }}
                      className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-3 text-left transition hover:bg-zinc-50"
                    >
                      <div className="h-16 w-12 shrink-0 overflow-hidden bg-zinc-100">
                        {profile ? (
                          <SmartImage src={profile} alt="" className="h-full w-full" objectFit="cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-zinc-400">
                            {t('common.noPhoto')}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {p.name}
                          {p.known_for_department && (
                            <span className="ml-2 border border-zinc-300 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                              {p.known_for_department}
                            </span>
                          )}
                        </p>
                        {knownTitles.length > 0 && (
                          <p className="mt-1 line-clamp-1 text-xs text-zinc-600">
                            {t('search.knownFor')}{knownTitles.join(', ')}
                          </p>
                        )}
                      </div>
                    </NavLink>
                  )
                })}
                <p className="sticky bottom-0 bg-white px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-400">
                  {t('common.titles')}
                </p>
              </>
            )}

            {results.map((m) => {
              const isTv = m.kind === 'tv'
              const poster = posterFor(m, 'w185')
              return (
                <NavLink
                  key={`${isTv ? 'tv' : 'm'}:${m.id}`}
                  to={titleUrl(isTv ? 'tv' : 'movie', m.id, m.title)}
                  onClick={() => { setDropdownOpen(false); setQuery('') }}
                  className="flex w-full gap-3 border-b border-zinc-100 px-3 py-3 text-left transition last:border-0 hover:bg-zinc-50"
                >
                  {/* 固定 2:3 海报框 + object-cover，任何海报都不会拉伸 */}
                  <div className="relative h-24 w-16 shrink-0 overflow-hidden bg-zinc-100">
                    <SmartImage src={poster} alt="" className="h-full w-full" />
                    <StatusBadge kind={isTv ? 'tv' : 'movie'} id={m.id} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {isTv && (
                        <span className="mr-1.5 border border-zinc-400 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                          TV
                        </span>
                      )}
                      {m.title}
                      {m.year && <span className="ml-1.5 font-normal text-zinc-500">{m.year}</span>}
                      {m.rating > 0 && (
                        <span className="ml-2 font-normal text-amber-600">★ {m.rating.toFixed(1)}</span>
                      )}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                      {m.overview || t('common.noDescription')}
                    </p>
                  </div>
                </NavLink>
              )
            })}
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {!movie && !detailLoading && <QuizRecommender />}

      {!movie && !detailLoading && <MovieCollage />}

      {detailLoading && <DetailHeaderSkeleton />}

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
          {t('detail.back')}
        </button>
      )}

      {movie && !detailLoading && (() => {
        const isTv = movie.kind === 'tv'
        const kind = isTv ? 'tv' : 'movie'
        const poster = posterFor(movie, 'w342')
        return (
        // 移动端纵向堆叠（海报居中在上、信息在下全宽）；sm 及以上恢复海报左 + 信息右
        <section className="relative mt-6 flex flex-col items-center gap-5 sm:mt-8 sm:flex-row sm:items-stretch sm:gap-8">
          {/* 右上角：Pin + Like 图标按钮 */}
          <div className="absolute right-0 top-0 z-10 flex items-center gap-1">
            <button
              onClick={() => {
                if (lib.isInLikes(kind, movie.id)) {
                  lib.removeFromLikes(kind, movie.id)
                } else {
                  lib.toggleLike(kind, movie.id, {
                    name: movie.title,
                    year: movie.year,
                    poster: posterFor(movie, 'w185'),
                    yearRange: movie.yearRange || '',
                  })
                }
              }}
              aria-label={lib.isInLikes(kind, movie.id) ? t('detail.removeFromLikes') : t('detail.addToLikes')}
              title={lib.isInLikes(kind, movie.id) ? t('detail.removeFromLikes') : t('detail.addToLikes')}
              className={`flex h-8 w-8 items-center justify-center transition hover:opacity-70 ${
                lib.isInLikes(kind, movie.id) ? 'text-red-500' : 'text-zinc-300 hover:text-zinc-500'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={lib.isInLikes(kind, movie.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </button>
            <button
              onClick={() => pins.togglePin(movie)}
              aria-label={pins.isPinned(kind, movie.id) ? t('detail.unpinFromNav') : t('detail.pinToNav')}
              title={pins.isPinned(kind, movie.id) ? t('detail.unpinFromNav') : t('detail.pinToNav')}
              className={`flex h-8 w-8 items-center justify-center transition hover:opacity-70 ${
                pins.isPinned(kind, movie.id) ? 'text-black' : 'text-zinc-300 hover:text-zinc-500'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={pins.isPinned(kind, movie.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </button>
          </div>
          {/* 固定 2:3 海报框：与 DetailHeaderSkeleton 完全一致，shimmer 尺寸 = 海报尺寸，加载完成零跳动 */}
          <SmartImage
            src={poster}
            alt={movie.title}
            crossOrigin="anonymous"
            aspect="2/3"
            objectFit="cover"
            className="w-32 shrink-0 self-center shadow-md ring-1 ring-black/5 sm:w-48 sm:self-start"
          />
          <div className="min-w-0 w-full flex-1 text-center sm:flex sm:flex-col sm:text-left">
            {/* 标题 */}
            <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-3xl">
              {isTv && (
                <span className="mr-2 inline-block align-middle border border-zinc-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  TV
                </span>
              )}
              {movie.title}
            </h2>
            {movie.original_title && movie.original_title !== movie.title && (
              <p className="mt-1 text-sm text-zinc-500">{movie.original_title}</p>
            )}

            {/* 元信息行 */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-zinc-600 sm:justify-start">
              <span className="font-medium text-zinc-800">{isTv ? (movie.yearRange || movie.year) : movie.year}</span>
              {!isTv && movie.runtime > 0 && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span>
                </>
              )}
              {isTv && movie.status && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>{movie.status}</span>
                </>
              )}
              {isTv && movie.seasonsCount != null && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>{movie.seasonsCount} {movie.seasonsCount === 1 ? t('common.season') : t('common.seasons')}</span>
                </>
              )}
              {isTv && movie.network && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>{movie.network}</span>
                </>
              )}
              {movie.genres?.[0] && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>{movie.genres.slice(0, 2).join(' / ')}</span>
                </>
              )}
            </div>

            {/* 评分卡片 + My Score + Watched/Watch Later */}
            <div className="mt-4 flex flex-col items-center gap-3 sm:mt-auto sm:flex-row sm:items-end sm:justify-between">
              {/* 评分卡片：垂直排列，label 在上 value 在下 */}
              {(() => {
                const chips = []
                if (typeof movie.rating === 'number') {
                  chips.push({ label: isTv ? t('detail.tvmaze') : t('detail.tmdb'), value: movie.rating.toFixed(1), icon: '★' })
                }
                if (ratings?.imdb != null) {
                  chips.push({ label: t('detail.imdb'), value: ratings.imdb.toFixed(1) })
                }
                if (ratings?.rotten_tomatoes != null) {
                  chips.push({ label: t('detail.critics'), value: `${ratings.rotten_tomatoes}%`, tone: ratings.rotten_tomatoes >= 60 ? 'green' : 'red' })
                }
                if (ratings?.popcornmeter != null) {
                  chips.push({ label: t('detail.audience'), value: `${ratings.popcornmeter}%`, tone: ratings.popcornmeter >= 60 ? 'green' : 'red' })
                }
                if (ratings?.metacritic != null) {
                  const mc = ratings.metacritic
                  const mcTone = mc >= 60 ? 'green' : mc >= 40 ? 'amber' : 'red'
                  chips.push({ label: t('detail.metascore'), value: String(mc), tone: mcTone })
                }
                if (ratingsLoading) return <RatingsSkeleton />
                if (chips.length === 0) return null
                const toneStyles = {
                  green: { box: 'border-green-200 bg-green-50', text: 'text-green-700' },
                  amber: { box: 'border-amber-200 bg-amber-50', text: 'text-amber-700' },
                  red: { box: 'border-red-200 bg-red-50', text: 'text-red-700' },
                }
                return (
                  <div className="flex flex-wrap items-stretch justify-center gap-2 sm:justify-start">
                    {chips.map((c) => {
                      const tone = toneStyles[c.tone] || { box: 'border-zinc-200 bg-zinc-50', text: 'text-zinc-900' }
                      return (
                        <div
                          key={c.label}
                          className={`flex min-w-[68px] flex-col items-center justify-center border px-3 py-2 ${tone.box}`}
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            {c.label}
                          </span>
                          <span className={`mt-0.5 text-lg font-extrabold leading-none ${tone.text}`}>
                            {c.icon && <span className="mr-0.5 text-amber-500">{c.icon}</span>}
                            {c.value}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* 右侧：My Score 在上，Watched/Watch Later 在下，垂直对齐 */}
              <div className="flex flex-col items-center gap-2">
                {/* My Score 星级 */}
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t('detail.myScore')}</span>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => handleRate(n)}
                        onMouseEnter={() => setHoverRating(n)}
                        onMouseLeave={() => setHoverRating(0)}
                        aria-label={`rate ${n}`}
                        className={`text-base leading-none transition hover:scale-125 ${
                          n <= (hoverRating || personal) ? 'text-amber-500' : 'text-zinc-300 hover:text-zinc-400'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  {personal > 0 && (
                    <button
                      onClick={() => changePersonal(0)}
                      className="ml-1 text-xs text-zinc-400 underline transition hover:text-zinc-600"
                    >
                      {t('common.clear')}
                    </button>
                  )}
                </div>
                {/* Watched / Watch Later 按钮 */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <WatchButton
                    active={lib.isInWatched(kind, movie.id)}
                    onClick={() =>
                      lib.isInWatched(kind, movie.id)
                        ? lib.removeFromWatched(kind, movie.id)
                        : lib.addToWatched({ ...movie, ratings }, personal)
                    }
                    label={t('detail.watched')}
                  />
                  <WatchButton
                    active={lib.isInWatchLater(kind, movie.id)}
                    onClick={() =>
                      lib.isInWatchLater(kind, movie.id)
                        ? lib.removeFromWatchLater(kind, movie.id)
                        : lib.addToWatchLater(movie)
                    }
                    label={t('detail.watchLater')}
                  />
                </div>
              </div>
            </div>

            {/* 短评区：防抖 500ms 保存到 library */}
            <div className="mt-5 border-t border-zinc-200 pt-4">
              <div className="mb-2 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('detail.myNote')}</span>
                {note && (
                  <span className="text-[10px] text-zinc-400">{t('detail.autoSaved')}</span>
                )}
              </div>
              <textarea
                value={note}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder={t('detail.notePlaceholder')}
                rows={3}
                className="w-full resize-none border border-zinc-300 bg-white p-3 text-sm leading-relaxed text-zinc-800 outline-none transition focus:border-black"
              />
            </div>
          </div>
        </section>
        )
      })()}

      {/* Description：剧情简介 + 各类信息（导演/演员/技术参数/奖项/类型），不折叠 */}
      {movie && !detailLoading && (() => {
        const isTv = movie.kind === 'tv'
        const genreSource = isTv ? 'tv' : 'movie'
        return (
        <section className="mt-6 border-t border-zinc-200 pt-6 sm:mt-8 sm:pt-8">
          {movie.overview && (
            <p className="text-sm leading-relaxed text-zinc-800">{movie.overview}</p>
          )}
          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {movie.genres?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.genres')}</dt>
                <dd className="text-zinc-800">
                  {movie.genres.map((g, idx) => {
                    // 类型名 -> TMDB genre id 能同步解析出来就直接拼 href（新标签页）；
                    // 解析不出的极端情况（中文界面且后端没给 genre_ids）退回原地跳转
                    const gid = genreIdByName(g, genreSource) || movie?.genre_ids?.[idx] || null
                    const cls = 'text-left text-zinc-800 underline-offset-2 transition hover:text-black hover:underline'
                    return gid ? (
                      <NavLink key={`${g}-${idx}`} to={genreUrl(genreSource, gid, g)} className={cls}>
                        {idx > 0 && <span className="text-zinc-400">, </span>}
                        {g}
                      </NavLink>
                    ) : (
                      <button
                        key={`${g}-${idx}`}
                        onClick={() => openGenreByName(g, genreSource, idx)}
                        className={cls}
                      >
                        {idx > 0 && <span className="text-zinc-400">, </span>}
                        {g}
                      </button>
                    )
                  })}
                </dd>
              </div>
            )}
            {movie.credits?.director && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.director')}</dt>
                <dd className="text-zinc-800">
                  <Credit
                    id={movie.credits.directorId}
                    name={movie.credits.director}
                    source={movie.credits.directorId ? 'tmdb' : 'tvmaze'}
                    onLookup={lookupPersonInNewTab}
                  >
                    {movie.credits.director}
                  </Credit>
                </dd>
              </div>
            )}
            {movie.credits?.writers?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.writers')}</dt>
                <dd className="text-zinc-800">
                  {movie.credits.writers.map((name, idx) => (
                    <Credit
                      key={`${name}-${idx}`}
                      id={movie.credits.writerIds?.[idx]}
                      name={name}
                      source={movie.credits.writerIds?.[idx] ? 'tmdb' : 'tvmaze'}
                      onLookup={lookupPersonInNewTab}
                    >
                      {idx > 0 && <span className="text-zinc-400">, </span>}
                      {name}
                    </Credit>
                  ))}
                </dd>
              </div>
            )}
            {movie.credits?.cast?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.starring')}</dt>
                <dd className="text-zinc-800">
                  {movie.credits.cast.slice(0, 5).map((p, idx) => (
                    <Credit
                      key={`${p.id || p.name}-${idx}`}
                      id={p.id}
                      name={p.name}
                      source={isTv ? 'tvmaze' : 'tmdb'}
                      onLookup={lookupPersonInNewTab}
                    >
                      {idx > 0 && <span className="text-zinc-400">, </span>}
                      {p.name}
                      {p.character && (
                        <span className="text-zinc-500"> ({p.character})</span>
                      )}
                    </Credit>
                  ))}
                </dd>
              </div>
            )}
            {specsLoading && <SpecsSkeleton />}
            {specs?.cameras?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.camera')}</dt>
                <dd className="text-zinc-800">{specs.cameras.slice(0, 3).join(', ')}</dd>
              </div>
            )}
            {specs?.lenses?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.lenses')}</dt>
                <dd className="text-zinc-800">{specs.lenses.slice(0, 2).join(', ')}</dd>
              </div>
            )}
            {specs?.aspectRatios?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.aspectRatio')}</dt>
                <dd className="text-zinc-800">{specs.aspectRatios[0]}</dd>
              </div>
            )}
            {specs?.negativeStocks?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.negative')}</dt>
                <dd className="text-zinc-800">{specs.negativeStocks[0]}</dd>
              </div>
            )}
            {specs?.processes?.length > 0 && (
              <div className="flex gap-2 text-sm">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.process')}</dt>
                <dd className="text-zinc-800">{specs.processes[0]}</dd>
              </div>
            )}
            {ratings?.awards && (
              <div className="flex gap-2 text-sm sm:col-span-2">
                <dt className="shrink-0 font-medium text-zinc-500">{t('detail.awards')}</dt>
                <dd className="text-zinc-800">{ratings.awards}</dd>
              </div>
            )}
          </dl>
        </section>
        )
      })()}

      {movie && !detailLoading && movie.kind !== 'tv' && (() => {
        const altPosters = posters
          .filter((p) => p.file_path !== movie.poster_path)
          .slice(0, 10)
        const total = altPosters.length + backdrops.length
        return (
          <CollapsibleSection title={t('detail.postersAndBackdrops')} count={total}>
            {/* Posters */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">{t('detail.posters')}</h3>
              {imagesLoading ? (
                <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                  {t('detail.loadingPosters')}
                </div>
              ) : altPosters.length === 0 ? (
                <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
                  {t('detail.noAltPosters')}
                </div>
              ) : (
                <>
                  {/* 选中描边必须 ring-inset：外描边会被 CollapsibleSection 的 overflow-hidden 裁掉
                      （最左/最右一列正好和网格同宽），且 ring-offset 的白圈画在黑圈**之上**、
                      会在图片与黑边之间凿出一条白缝。inset 画在元素内部，永远裁不到。 */}
                  <p className="mb-3 text-xs text-zinc-700">{t('detail.tapPosterForCard')}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
                    {altPosters.map((p, i) => {
                      const thumb = apiUrl(`/api/image?path=${encodeURIComponent(p.file_path)}&s=w342`)
                      const full = apiUrl(`/api/image?path=${encodeURIComponent(p.file_path)}&s=w780`)
                      const isSelected = cardImage === full
                      return (
                        <div
                          key={p.file_path || i}
                          className={`group relative aspect-[2/3] overflow-hidden bg-zinc-100 transition ${
                            isSelected ? 'ring-2 ring-inset ring-black' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setCardImage(isSelected ? null : full)}
                            className="absolute inset-0 h-full w-full"
                            aria-label={isSelected ? t('detail.removePosterFromCard') : t('detail.useThisPosterOnCard')}
                          >
                            <img
                              src={thumb}
                              alt={`${movie.title} poster ${i + 1}`}
                              loading="lazy"
                              crossOrigin="anonymous"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActivePoster(full) }}
                            aria-label={t('detail.previewPoster')}
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
                              {t('common.onCard')}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Backdrops */}
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">{t('detail.backdrops')}</h3>
              {imagesLoading ? (
                <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
                  {t('detail.loadingBackdrops')}
                </div>
              ) : backdrops.length === 0 ? (
                <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
                  {t('detail.noBackdrops')}
                </div>
              ) : (
                <>
                  <p className="mb-3 text-xs text-zinc-700">{t('detail.tapBackdropForCard')}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                    {backdrops.map((b, i) => {
                      const thumb = apiUrl(`/api/image?path=${encodeURIComponent(b.file_path)}&s=w780`)
                      const full = apiUrl(`/api/image?path=${encodeURIComponent(b.file_path)}&s=w1280`)
                      const isSelected = cardImage === full
                      return (
                        <div
                          key={b.file_path || i}
                          className={`group relative aspect-video overflow-hidden bg-zinc-100 transition ${
                            isSelected ? 'ring-2 ring-inset ring-black' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setCardImage(isSelected ? null : full)}
                            className="absolute inset-0 h-full w-full"
                            aria-label={isSelected ? t('detail.removeBackdropFromCard') : t('detail.useThisBackdropOnCard')}
                          >
                            <img
                              src={thumb}
                              alt={`${movie.title} backdrop ${i + 1}`}
                              loading="lazy"
                              crossOrigin="anonymous"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveBackdrop(full) }}
                            aria-label={t('detail.previewBackdrop')}
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
                              {t('common.onCard')}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
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
            aria-label={t('detail.downloadPoster')}
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
            aria-label={t('detail.downloadBackdrop')}
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

      {movie && !detailLoading && movie.kind === 'tv' && (
        <ShowEpisodes
          key={`episodes-${movie.id}`}
          show={movie}
          cardImage={cardImage}
          onSelectCardImage={setCardImage}
        />
      )}

      {movie && !detailLoading && movie.kind === 'tv' && (
        <TvBackdrops
          key={`backdrops-${movie.id}`}
          show={movie}
          selected={cardImage}
          onSelect={setCardImage}
        />
      )}

      {movie && !detailLoading && (
        <TrailerSection key={`trailer-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <WhereToWatch key={`watch-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <CollapsibleSection title={t('detail.recommendations')}>
          <TasteDiveSimilar key={`similar-${movie.id}`} movie={movie} embed />
          <AlsoLiked key={`liked-${movie.id}`} movie={movie} embed />
        </CollapsibleSection>
      )}

      {movie && !detailLoading && (
        <Torrents key={`torrents-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && (
        <PlaySources key={`play-${movie.kind}-${movie.id}`} movie={movie} />
      )}

      {movie && !detailLoading && movie.kind !== 'tv' && (
        <FilmGrabShots
          key={movie.id}
          movie={movie}
          selected={cardImage}
          onSelect={setCardImage}
        />
      )}

      {movie && !detailLoading && (
        <Suspense fallback={null}>
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
            note={note}
          />
        </Suspense>
      )}

    </main>
      )}
      <Footer />
    </div>
  )
}
