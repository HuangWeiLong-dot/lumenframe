import express from 'express'
import { setDefaultResultOrder } from 'dns'
// 强制 IPv4 优先：部分云服务器无 IPv6 路由，Node.js fetch 默认尝试 IPv6 会 "fetch failed"
setDefaultResultOrder('ipv4first')
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { getSpecs } from './sow.js'
import { getRatings } from './ratings.js'
import { tastediveSimilar } from './tastedive.js'
import { titleScore, normalizeTitle } from './titlematch.js'
import { searchShows, getShow, getEpisodes, parseTvImageUrl, fetchTvImage } from './tvmaze.js'
import { searchSubtitles, downloadSubtitle } from './subtitles.js'

const TMDB_API = 'https://api.themoviedb.org/3'
const TMDB_IMG = 'https://image.tmdb.org/t/p'

// TMDB 剧集类型 ID（稳定），用于把 TVmaze 的 genre 字符串映射到 TMDB discover/tv 的 with_genres
const TMDB_TV_GENRES = {
  Drama: 18, Comedy: 35, Crime: 80, Mystery: 9648, Romance: 10749,
  Family: 10751, Animation: 16, Documentary: 99, Music: 10402, Musical: 10402,
  Western: 37, News: 10763, Kids: 10762, Reality: 10764, 'Reality-TV': 10764,
  Talk: 10767, 'Talk-Show': 10767,
  // TVmaze 无对应 TMDB 分类时，归到语义最近的
  Action: 10759, Adventure: 10759, 'Action & Adventure': 10759,
  'Science-Fiction': 10765, 'Sci-Fi & Fantasy': 10765, Fantasy: 10765, Horror: 10765,
  Thriller: 9648, War: 10768, 'War & Politics': 10768, History: 10768,
  Biography: 18, Sport: 18, Legal: 18, Medical: 18, 'Game-Show': 10764,
}

// TMDB 电影类型 ID
const TMDB_MOVIE_GENRES = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80,
  Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
  Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Science Fiction': 878,
  Thriller: 53, War: 10752, Western: 37,
}
const API_KEY = process.env.TMDB_API_KEY
const TASTEDRIVE_KEY = process.env.TASTEDRIVE_API_KEY
const PORT = process.env.PORT || 3002

// 国内网络需要代理访问 TMDB；部署到海外服务器时 TMDB_PROXY 留空即直连
if (process.env.TMDB_PROXY) {
  setGlobalDispatcher(new ProxyAgent(process.env.TMDB_PROXY))
}

const app = express()

// 前端与 API 分域部署时（GitHub Pages + Vercel）需要跨域许可。
// 全部接口都是只读 GET、不携带凭证，直接放行任意来源。
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 简单内存缓存：相同请求 30 分钟内不重复打 TMDB（免费版限额 50 次/分钟）
// inFlight 做并发单飞：同一 key 的多个冷请求只打一次上游
const cache = new Map()
const inFlight = new Map()
const CACHE_MAX = 200
const TTL = 30 * 60 * 1000
async function cached(key, fetcher) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.time < TTL) return hit.data
  if (inFlight.has(key)) return inFlight.get(key)
  const p = fetcher()
    .then((data) => {
      // 顺手清掉过期条目，再按 FIFO 限制总量
      const now = Date.now()
      for (const [k, v] of cache) if (now - v.time >= TTL) cache.delete(k)
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
      cache.set(key, { data, time: now })
      return data
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

// 图片不在服务端缓存二进制（w1280/original 单张可达数 MB，按 size 多份驻留内存代价过高；
// 浏览器已通过 Cache-Control 长期缓存），仅对并发中的相同请求做单飞去重
const imgInFlight = new Map()
async function getImage(path, size) {
  const key = `${size}:${path}`
  if (imgInFlight.has(key)) return imgInFlight.get(key)
  const p = (async () => {
    // TMDB 经代理访问偶发抖动，失败重试一次
    let lastErr
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const upstream = await fetch(`${TMDB_IMG}/${size}${path}`)
        if (upstream.ok) {
          return {
            buf: Buffer.from(await upstream.arrayBuffer()),
            contentType: upstream.headers.get('content-type') || 'image/jpeg',
          }
        }
        lastErr = new Error(`image ${upstream.status}`)
      } catch (e) {
        lastErr = e
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw lastErr
  })()
  const shared = p.finally(() => imgInFlight.delete(key))
  imgInFlight.set(key, shared)
  return shared
}

// TMDB 支持多语言：language 先写入，params 里的 language 仍可覆盖（/images 路由需要）
async function tmdb(path, params = {}, lang = 'en-US') {
  const url = new URL(TMDB_API + path)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('language', lang)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

// ---- 多语言（API 层面支持中文）----
// 前端通过 ?lang=zh-CN 请求中文本地化信息（标题/简介/类型/人物简介等）。
// 例外（无中文能力或依赖英文做匹配，一律固定 en-US，见各路由注释）：
//   TVmaze（剧集）、TasteDive（英文片名匹配）、ShotOnWhat / Rotten Tomatoes（按英文片名抓取）、
//   trailer（预告片排序依赖英文 "Official Trailer"）。
const LANGS = new Set(['en-US', 'zh-CN', 'zh-TW'])
function reqLang(req) {
  const raw = String(req.query.lang || '').trim()
  if (LANGS.has(raw)) return raw
  if (/^zh\b/i.test(raw)) return 'zh-CN' // zh / zh-Hans / zh-CN 统一到简体
  return 'en-US'
}
// 语言相关结果必须按语言分桶缓存，否则中英会互相污染
const lk = (key, lang) => `${key}:${lang}`
// 纯 ASCII 判定：非 ASCII 片名交给英文源（OMDB/RT/ShotOnWhat）查询必然失败，需先反查英文名
const isAsciiText = (s) => !/[^\x20-\x7E]/.test(String(s || ''))

// 用 IMDb ID 反查英文片名（TMDB find + en-US），供只认英文名的第三方服务使用
async function englishTitleByImdb(imdbId, title) {
  if (isAsciiText(title)) return title
  try {
    return await cached(lk(`entitle:${imdbId}`, 'en-US'), async () => {
      const found = await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' }, 'en-US')
      const hit = (found.movie_results || [])[0] || (found.tv_results || [])[0]
      return hit?.title || hit?.name || title
    })
  } catch {
    return title
  }
}

// 用 TMDB id 反查英文片名（TasteDive 等只认英文名，中文界面下的中文片名需先还原）
async function englishTitleByTmdbId(id, title) {
  if (isAsciiText(title)) return title
  try {
    const m = await moviePayload(id, 'en-US')
    return m?.title || title
  } catch {
    return title
  }
}

// 取某语言的 TMDB 电影原始载荷（键与 /api/movie/:id 完全一致，两个路由互相命中缓存）
async function moviePayload(id, lang) {
  return cached(lk(`movie:${id}`, lang), () =>
    tmdb(`/movie/${id}`, { append_to_response: 'credits' }, lang)
  )
}

// 中文界面下，把「靠英文匹配得到的 TMDB 电影列表」回填为中文标题/海报
// （TasteDive 用英文片名匹配，其输出默认是英文；此处按目标语言补齐）
async function localizeMovieList(items, lang) {
  if (lang === 'en-US' || items.length === 0) return items
  return Promise.all(
    items.map(async (it) => {
      const movieId = it.tmdb_id ?? it.id
      if (!movieId) return it
      try {
        const m = await moviePayload(movieId, lang)
        return {
          ...it,
          title: m.title || it.title,
          year: (m.release_date || '').slice(0, 4) || it.year,
          rating: m.vote_average ?? it.rating,
          poster_path: m.poster_path || it.poster_path,
        }
      } catch {
        return it
      }
    })
  )
}

// 混合搜索：TMDB 电影 + TVmaze 剧集，一次返回两类结果（kind 字段区分）。
// 两个 API 结果互相补全海报：当某条缺海报时，从另一个 API 的同名（+同年）条目中取海报。
// 不额外发请求，仅复用本次两个搜索结果，避免触碰各自的 rate limit。
// 语言：电影部分跟随 ?lang（中文关键词可直接搜到中文片名/简介）；剧集来自 TVmaze，恒为英文。
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  const lang = reqLang(req)
  try {
    const [tmdbRes, tvRes] = await Promise.all([
      cached(lk(`search:movie:${q}`, lang), () =>
        tmdb('/search/movie', { query: q, include_adult: false }, lang)
      ),
      cached(`search:tv:${q}`, () => searchShows(q)).catch((e) => {
        console.error('[search] TVmaze search failed:', e.message)
        return []
      }),
    ])
    const movies = (tmdbRes.results || []).map((m) => ({
      kind: 'movie',
      id: m.id,
      title: m.title,
      original_title: m.original_title || null, // 跨源海报互补 / 英文服务查询用
      year: (m.release_date || '').slice(0, 4),
      rating: m.vote_average,
      overview: m.overview || '',
      poster_path: m.poster_path,
    }))
    const shows = (tvRes || []).map((s) => ({
      kind: 'tv',
      id: s.id,
      title: s.title,
      year: s.year,
      rating: s.rating,
      overview: s.overview || '',
      tvPoster: s.tvPoster,
    }))

    // 海报互补：以 normalizeTitle + year 为键，收集所有有海报的条目；
    // 缺海报的条目从同键的另一个 API 结果取海报字段。
    // 注意：lang=zh 时 TMDB 标题是中文，而 normalizeTitle 会过滤掉非 ASCII（结果为空串），
    // 会导致同年条目 key 全部塌缩到一起 —— 所以电影统一用 original_title 参与配对。
    const posterPool = new Map() // key -> { poster_path?, tvPoster? }
    const keyTitle = (it) => (it.kind === 'movie' ? it.original_title || it.title : it.title)
    const keyOf = (t, y) => `${normalizeTitle(t) || String(t || '').trim().toLowerCase()}::${y || ''}`
    for (const it of [...movies, ...shows]) {
      const k = keyOf(keyTitle(it), it.year)
      const cur = posterPool.get(k) || {}
      if (it.poster_path) cur.poster_path = it.poster_path
      if (it.tvPoster) cur.tvPoster = it.tvPoster
      posterPool.set(k, cur)
    }
    const fillPoster = (it) => {
      if (it.poster_path || it.tvPoster) return it
      const p = posterPool.get(keyOf(keyTitle(it), it.year))
      if (!p) return it
      return { ...it, poster_path: p.poster_path || null, tvPoster: p.tvPoster || null }
    }

    const merged = [...movies.map(fillPoster), ...shows.map(fillPoster)].sort(
      (a, b) => (b.rating ?? -1) - (a.rating ?? -1)
    )
    res.json({ results: merged })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 电影详情（海报、标题、评分、年份、IMDb ID、演职员）
// ?lang=zh-CN 返回中文标题/简介/类型名；同时给出 title_en（英文原名）供只认英文名的服务使用
app.get('/api/movie/:id', async (req, res) => {
  const lang = reqLang(req)
  try {
    // en-US 详情与目标语言详情并行取（前者用于 title_en，且与英文页共享缓存）
    const enPromise = lang === 'en-US' ? null : moviePayload(req.params.id, 'en-US').catch(() => null)
    const m = await moviePayload(req.params.id, lang)
    const en = enPromise ? await enPromise : null
    // crew 中 job 字段区分导演/编剧/摄影指导；cast 已按番位排序
    const crew = m.credits?.crew || []
    const seen = new Set()
    const writerRows = crew
      .filter((p) => ['Screenplay', 'Writer', 'Story', 'Novel'].includes(p.job))
      .filter((p) => !seen.has(p.id) && seen.add(p.id))
      .slice(0, 3)
    const directorRow = crew.find((p) => p.job === 'Director')
    res.json({
      id: m.id,
      title: m.title,
      original_title: m.original_title,
      title_en: en?.title || m.title,
      year: (m.release_date || '').slice(0, 4),
      rating: m.vote_average,
      runtime: m.runtime || null,
      // genres 是本地化后的名称（供展示），genre_ids 供点击跳转时反查（中文名无法命中静态映射表）
      genres: (m.genres || []).map((g) => g.name),
      genre_ids: (m.genres || []).map((g) => g.id),
      overview: m.overview,
      poster_path: m.poster_path,
      imdb_id: m.imdb_id,
      credits: {
        director: directorRow?.name || null,
        directorId: directorRow?.id || null,
        writers: writerRows.map((p) => p.name),
        writerIds: writerRows.map((p) => p.id),
        dop: crew.find((p) => p.job === 'Director of Photography')?.name || null,
        cast: (m.credits?.cast || []).slice(0, 5).map((p) => ({
          id: p.id,
          name: p.name,
          character: p.character,
        })),
      },
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 电影图片：备选海报（至多 10 张）+ 剧照 backdrops
app.get('/api/movie/:id/images', async (req, res) => {
  const lang = reqLang(req)
  // 中文界面额外纳入中文海报（TMDB 上不少影片有简体海报）；en,null 始终保留做兜底
  const imgLangs = lang.startsWith('zh') ? `${lang},en,null` : 'en,null'
  try {
    const data = await cached(lk(`movie:${req.params.id}:images`, lang), () =>
      tmdb(`/movie/${req.params.id}/images`, {
        language: 'en',
        include_image_language: imgLangs,
      })
    )
    const posters = (data.posters || [])
      .sort((a, b) => b.vote_count - a.vote_count)
      .slice(0, 10)
      .map((p) => ({
        file_path: p.file_path,
        width: p.width,
        height: p.height,
      }))
    const backdrops = (data.backdrops || [])
      .sort((a, b) => b.vote_count - a.vote_count)
      .slice(0, 12)
      .map((b) => ({
        file_path: b.file_path,
        width: b.width,
        height: b.height,
      }))
    res.json({ posters, backdrops })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 热门电影海报列表（用于背景滚动墙）——仅用海报，与语言无关，不做 lang 处理
app.get('/api/trending', async (req, res) => {
  try {
    const data = await cached('trending:week', () =>
      tmdb('/trending/movie/week', { page: 1 })
    )
    // 过滤有海报的，取前 30 部
    const posters = data.results
      .filter((m) => m.poster_path)
      .slice(0, 30)
      .map((m) => ({
        id: m.id,
        title: m.title,
        poster_path: m.poster_path,
        backdrop_path: m.backdrop_path || null,
        year: m.release_date ? m.release_date.slice(0, 4) : '',
      }))
    res.json({ posters })
  } catch (e) {
    res.status(502).json({ error: e.message, posters: [] })
  }
})

// 演职员搜索：用名字查 TMDB person id（用于在 TV 剧集 cast 上做跨源跳转）
// 中文界面下 TMDB 会返回本地化人名/代表作片名
app.get('/api/person/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  const lang = reqLang(req)
  try {
    const data = await cached(lk(`person:search:${q}`, lang), () =>
      tmdb('/search/person', { query: q, include_adult: false }, lang)
    )
    const limit = Number(req.query.limit) || 5
    const results = (data.results || [])
      .filter((p) => p.profile_path || p.known_for_department)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        name: p.name,
        profile_path: p.profile_path,
        known_for_department: p.known_for_department || null,
        known_for: (p.known_for || []).slice(0, 3).map((k) => ({
          id: k.id,
          title: k.title || k.name || null,
          poster_path: k.poster_path || null,
          vote_average: k.vote_average || 0,
          media_type: k.media_type || null,
          release_date: k.release_date || k.first_air_date || null,
        })),
      }))
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 演职员详情 + 全部作品（电影 + 剧集），按 cast / Directing / Writing 分组
// ?lang=zh-CN：人物简介、出生地、作品片名走中文（TMDB 无中文资料时自动回退原名）
app.get('/api/person/:id/credits', async (req, res) => {
  const lang = reqLang(req)
  try {
    const [creditsData, info] = await Promise.all([
      cached(lk(`person:${req.params.id}:credits`, lang), () =>
        tmdb(`/person/${req.params.id}/combined_credits`, {}, lang)
      ),
      cached(lk(`person:${req.params.id}:info`, lang), () =>
        tmdb(`/person/${req.params.id}`, {}, lang)
      ).catch(() => ({})),
    ])

    const sortByPop = (arr) =>
      arr
        .slice()
        .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.popularity || 0) - (a.popularity || 0))

    // combined_credits 返回扁平的 cast / crew 数组，每条带 media_type: 'movie'|'tv'
    // 区分电影/剧集字段名：movie 用 title + release_date，tv 用 name + first_air_date
    const mapEntry = (e) =>
      e.media_type === 'tv'
        ? {
            kind: 'tv',
            id: e.id,
            title: e.name || e.original_name || '',
            original_title: e.original_name || null, // 原名：中文界面下用它去 TVmaze 匹配（TVmaze 只有英文名）
            year: (e.first_air_date || '').slice(0, 4),
            character: e.character || null,
            job: e.job || null,
            poster_path: e.poster_path || null,
            vote_average: e.vote_average || 0,
            episode_count: e.episode_count || 0,
          }
        : {
            kind: 'movie',
            id: e.id,
            title: e.title || e.original_title || '',
            original_title: e.original_title || null,
            year: (e.release_date || '').slice(0, 4),
            character: e.character || null,
            job: e.job || null,
            poster_path: e.poster_path || null,
            vote_average: e.vote_average || 0,
          }

    const castArr = creditsData.cast || []
    const crewArr = creditsData.crew || []

    const actingMovies = sortByPop(castArr.filter((c) => c.media_type === 'movie')).slice(0, 30).map(mapEntry)
    const actingTv = sortByPop(castArr.filter((c) => c.media_type === 'tv')).slice(0, 30).map(mapEntry)
    const directingMovies = sortByPop(crewArr.filter((c) => c.media_type === 'movie' && c.job === 'Director')).slice(0, 20).map(mapEntry)
    const directingTv = sortByPop(crewArr.filter((c) => c.media_type === 'tv' && c.job === 'Director')).slice(0, 20).map(mapEntry)
    const writingMovies = sortByPop(crewArr.filter((c) => c.media_type === 'movie' && ['Screenplay', 'Writer', 'Story', 'Novel'].includes(c.job))).slice(0, 20).map(mapEntry)
    const writingTv = sortByPop(crewArr.filter((c) => c.media_type === 'tv' && ['Screenplay', 'Writer', 'Story', 'Creator'].includes(c.job))).slice(0, 20).map(mapEntry)

    res.json({
      id: info.id || Number(req.params.id),
      name: info.name || null,
      birthday: info.birthday || null,
      deathday: info.deathday || null,
      place_of_birth: info.place_of_birth || null,
      biography: info.biography || null,
      profile_path: info.profile_path || null,
      known_for_department: info.known_for_department || null,
      credits: {
        acting: { movies: actingMovies, tv: actingTv },
        directing: { movies: directingMovies, tv: directingTv },
        writing: { movies: writingMovies, tv: writingTv },
      },
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 类型发现：列出某 genre 下的电影或剧集，分页
// ?lang=zh-CN：片名/简介本地化
app.get('/api/genre/:kind/:id', async (req, res) => {
  const kind = req.params.kind === 'tv' ? 'tv' : 'movie'
  const genreId = Number(req.params.id)
  const page = Math.max(1, Number(req.query.page) || 1)
  const lang = reqLang(req)
  if (!genreId) return res.status(400).json({ error: 'invalid genre id' })
  try {
    // 客户端每页 10 条，TMDB 每页 20 条 → 拆分取半
    const tmdbPage = Math.ceil(page / 2)
    const isFirstHalf = page % 2 === 1
    const data = await cached(lk(`genre:${kind}:${genreId}:p${tmdbPage}`, lang), () =>
      tmdb(`/discover/${kind}`, {
        with_genres: genreId,
        sort_by: 'popularity.desc',
        page: tmdbPage,
        'vote_count.gte': kind === 'tv' ? 50 : 100,
      }, lang)
    )
    const allItems = (data.results || [])
      .filter((m) => m.poster_path)
      .map((m) => ({
        id: m.id,
        title: m.title || m.name,
        year: (m.release_date || m.first_air_date || '').slice(0, 4),
        rating: m.vote_average,
        poster_path: m.poster_path,
        overview: m.overview || '',
      }))
    const items = allItems.slice(isFirstHalf ? 0 : 10, isFirstHalf ? 10 : 20)
    res.json({
      page,
      total_pages: Math.ceil((data.total_results || 0) / 10),
      total_results: data.total_results,
      items,
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 类型名录（本地化 id → 名称）：观影库「喜欢」里的类型条目只有 id，
// 切换语言后要用当前语言的名称回填，本接口即该映射的唯一来源（按语言缓存）。
app.get('/api/genres', async (req, res) => {
  const lang = reqLang(req)
  try {
    const [mv, tv] = await Promise.all([
      cached(lk('genres:movie', lang), () => tmdb('/genre/movie/list', {}, lang)),
      cached(lk('genres:tv', lang), () => tmdb('/genre/tv/list', {}, lang)),
    ])
    const pick = (data) =>
      (data.genres || []).map((g) => ({ id: g.id, name: g.name }))
    res.json({ movie: pick(mv), tv: pick(tv) })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 第三方评分：OMDB API（IMDb / Rotten Tomatoes / Metacritic），懒加载，成功后文件缓存
// RT 页面抓取只认英文片名：中文界面传进来的中文片名会先用 IMDb id 反查英文名
app.get('/api/ratings/:imdbId', async (req, res) => {
  const rawTitle = String(req.query.title || '').trim()
  const year = String(req.query.year || '').trim()
  if (!rawTitle || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'title and 4-digit year are required' })
  }
  try {
    const title = await englishTitleByImdb(req.params.imdbId, rawTitle)
    const data = await getRatings(req.params.imdbId, title, year)
    res.set('x-cache', data.cache)
    res.json({ imdb: data.imdb, metacritic: data.metacritic, rotten_tomatoes: data.rotten_tomatoes, popcornmeter: data.popcornmeter, awards: data.awards })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 预告片：TMDB /movie/{id}/videos 返回官方预告片 YouTube key（无需 YouTube 搜索配额）
// 固定 en-US：挑选规则里的 "Official Trailer" 关键词依赖英文视频名，本地化会让排序失效
app.get('/api/trailer/:tmdbId', async (req, res) => {
  const id = req.params.tmdbId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tmdbId' })
  try {
    const data = await cached(`trailer:${id}`, () => tmdb(`/movie/${id}/videos`))
    const vids = (data.results || []).filter((v) => v.site === 'YouTube' && v.official !== false)
    // Trailer 优先于 Teaser；"Official Trailer" 标题优先；1080p 优先
    const score = (v) =>
      (v.type === 'Trailer' ? 100 : v.type === 'Teaser' ? 50 : 0) +
      (/official\s*trailer/i.test(v.name) ? 30 : 0) +
      (v.size === 1080 ? 10 : 0)
    vids.sort((a, b) => score(b) - score(a))
    const best = vids[0]
    if (!best) return res.json({ videoId: null })
    res.json({
      videoId: best.key,
      title: best.name,
      official: best.official,
      publishedAt: best.published_at || '',
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 流媒体可用性：Watchmode API（where to watch）
const WATCHMODE_API = 'https://api.watchmode.com/v1'
const WATCHMODE_KEY = process.env.WATCHMODE_API_KEY

app.get('/api/watch/:tmdbId', async (req, res) => {
  const id = req.params.tmdbId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tmdbId' })
  if (!WATCHMODE_KEY) return res.json({ sources: [] })
  try {
    const result = await cached(`watch:${id}`, async () => {
      // 1. 按 TMDB ID 搜 Watchmode title ID
      const sRes = await fetch(
        `${WATCHMODE_API}/search/?apiKey=${WATCHMODE_KEY}&search_field=tmdb_movie_id&search_value=${id}`
      )
      if (!sRes.ok) throw new Error(`watchmode search ${sRes.status}`)
      const sData = await sRes.json()
      const wmId = sData.title_results?.[0]?.id
      if (!wmId) return { sources: [] }

      // 2. 获取流媒体来源（1 次 API 调用拿所有类型/地区）
      const srcRes = await fetch(
        `${WATCHMODE_API}/title/${wmId}/sources/?apiKey=${WATCHMODE_KEY}`
      )
      if (!srcRes.ok) throw new Error(`watchmode sources ${srcRes.status}`)
      const sources = await srcRes.json()

      // 按平台去重（同一平台多个类型只保留最高优先级：sub > free > rent > buy > tve）
      const typeRank = { sub: 0, free: 1, rent: 2, buy: 3, tve: 4 }
      const byName = new Map()
      for (const s of sources) {
        const name = s.name
        if (!byName.has(name) || typeRank[s.type] < typeRank[byName.get(name).type]) {
          byName.set(name, s)
        }
      }
      const deduped = [...byName.values()].sort((a, b) => typeRank[a.type] - typeRank[b.type])

      return {
        sources: deduped.map((s) => ({
          name: s.name,
          type: s.type,             // sub | free | rent | buy | tve
          webUrl: s.web_url || null,
          price: s.price != null ? s.price : null,
          currency: s.currency || 'USD',
          region: s.region || 'US',
        })),
      }
    })
    res.json(result)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 剧集 Where to Watch：用 IMDb ID 在 Watchmode 搜索（剧集无 TMDB movie id）
app.get('/api/watch/tv/:imdbId', async (req, res) => {
  const imdbId = String(req.params.imdbId || '').trim()
  if (!/^tt\d+$/.test(imdbId)) return res.status(400).json({ error: 'invalid imdbId' })
  if (!WATCHMODE_KEY) return res.json({ sources: [] })
  try {
    const result = await cached(`watchtv:${imdbId}`, async () => {
      const sRes = await fetch(
        `${WATCHMODE_API}/search/?apiKey=${WATCHMODE_KEY}&search_field=imdb_id&search_value=${imdbId}`
      )
      if (!sRes.ok) throw new Error(`watchmode search ${sRes.status}`)
      const sData = await sRes.json()
      const wmId = sData.title_results?.[0]?.id
      if (!wmId) return { sources: [] }

      const srcRes = await fetch(`${WATCHMODE_API}/title/${wmId}/sources/?apiKey=${WATCHMODE_KEY}`)
      if (!srcRes.ok) throw new Error(`watchmode sources ${srcRes.status}`)
      const sources = await srcRes.json()

      const typeRank = { sub: 0, free: 1, rent: 2, buy: 3, tve: 4 }
      const byName = new Map()
      for (const s of sources) {
        const name = s.name
        if (!byName.has(name) || typeRank[s.type] < typeRank[byName.get(name).type]) {
          byName.set(name, s)
        }
      }
      const deduped = [...byName.values()].sort((a, b) => typeRank[a.type] - typeRank[b.type])
      return {
        sources: deduped.map((s) => ({
          name: s.name,
          type: s.type,
          webUrl: s.web_url || null,
          price: s.price != null ? s.price : null,
          currency: s.currency || 'USD',
          region: s.region || 'US',
        })),
      }
    })
    res.json(result)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 相似影片推荐：基于类别（genres）—— 用当前电影的类型去 TMDB discover 找同类型高分片
// ?lang=zh-CN：推荐结果标题本地化；类型 id 与语言无关，复用同语言的详情缓存即可
app.get('/api/similar/:tmdbId', async (req, res) => {
  const id = req.params.tmdbId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tmdbId' })
  const lang = reqLang(req)
  try {
    const results = await cached(lk(`sim:movie:${id}`, lang), async () => {
      // 1. 取当前电影的 genre_ids（复用 movie: 缓存，若无则请求一次）
      let genreIds = []
      try {
        const detail = await moviePayload(id, lang)
        genreIds = (detail.genres || []).map((g) => g.id)
      } catch {
        return []
      }
      if (genreIds.length === 0) return []

      // 2. TMDB discover 按类型找高分热门片；with_genres 是 OR 关系（命中任一类型）
      const data = await tmdb('/discover/movie', {
        with_genres: genreIds.join(','),
        sort_by: 'vote_count.desc',
        'vote_average.gte': 6,
        'vote_count.gte': 100,
        include_adult: false,
        page: 1,
      }, lang)
      const picks = (data.results || [])
        .filter((m) => m.poster_path && String(m.id) !== String(id))
        .slice(0, 5)
        .map((m) => ({
          tmdb_id: m.id,
          title: m.title,
          year: (m.release_date || '').slice(0, 4),
          rating: m.vote_average,
          poster_path: m.poster_path,
        }))
      // 去重
      const seen = new Set()
      return picks.filter((m) => !seen.has(m.tmdb_id) && seen.add(m.tmdb_id)).slice(0, 5)
    })
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

// 剧集相似推荐：基于类别（genres）—— 把 TVmaze 的类型映射到 TMDB tv genre id，
// 用 TMDB discover/tv 找同类型高分剧，再用 TVmaze 搜索匹配回 TVmaze 条目（含海报）
// 固定 en-US：TMDB 剧名要与 TVmaze 英文名做 titleScore 匹配，且输出条目本身来自 TVmaze（无中文）
app.get('/api/similar/tv/:tvmazeId', async (req, res) => {
  const id = req.params.tvmazeId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tvmazeId' })
  try {
    const results = await cached(`sim:tv:${id}`, async () => {
      // 1. 取当前剧集的 genres（TVmaze 字符串数组），映射到 TMDB tv genre id
      let genreIds = []
      try {
        const show = await cached(`tvshow:${id}`, () => getShow(Number(id)))
        genreIds = [...new Set(
          (show.genres || []).map((g) => TMDB_TV_GENRES[g]).filter(Boolean)
        )]
      } catch {
        return []
      }
      if (genreIds.length === 0) return []

      // 2. TMDB discover/tv 按类型找高分热门剧
      const data = await tmdb('/discover/tv', {
        with_genres: genreIds.join(','),
        sort_by: 'vote_count.desc',
        'vote_average.gte': 6,
        'vote_count.gte': 50,
        include_adult: false,
        page: 1,
      })
      const candidates = (data.results || [])
        .filter((t) => t.poster_path)
        .slice(0, 8)

      // 3. 用 TVmaze 搜索把 TMDB 剧集名匹配回 TVmaze 条目（拿 tvmaze_id + tvPoster）
      const resolveShow = async (name, year) =>
        cached(`simtvresolve:${name.toLowerCase()}:${year}`, async () => {
          const data = await searchShows(name)
          let best = null
          for (const s of data.filter((x) => x.tvPoster)) {
            // 标题相似度 + 年份接近（±1 年）综合打分
            const sScore = titleScore(name, s.title)
            const yearHit = s.year && year ? Math.abs(Number(s.year) - Number(year)) <= 1 : true
            const score = sScore * (yearHit ? 1 : 0.5)
            if (!best || score > best.score) best = { show: s, score }
          }
          if (!best || best.score < 0.6) return null
          return {
            tvmaze_id: best.show.id,
            title: best.show.title,
            year: best.show.year,
            rating: best.show.rating,
            tvPoster: best.show.tvPoster,
          }
        })

      const matched = await Promise.all(
        candidates.map((t) => resolveShow(t.name, (t.first_air_date || '').slice(0, 4)))
      )
      const seen = new Set([Number(id)])
      return matched
        .filter(Boolean)
        .filter((m) => !seen.has(m.tvmaze_id) && seen.add(m.tvmaze_id))
        .slice(0, 5)
    })
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

// "看过这个的还喜欢"：优先 TasteDive 协同过滤，被 Cloudflare 封锁时降级 TMDB recommendations
// ?lang=zh-CN：TasteDive 用英文片名匹配（内部固定 en-US），匹配结果再回填中文标题
app.get('/api/liked/:tmdbId', async (req, res) => {
  const id = req.params.tmdbId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tmdbId' })
  const rawTitle = String(req.query.title || '').trim()
  if (!rawTitle) return res.status(400).json({ error: 'title is required' })
  const lang = reqLang(req)
  try {
    // TasteDive 只认英文片名：中文界面传进来的中文片名先按 TMDB id 还原英文名
    const title = await englishTitleByTmdbId(id, rawTitle)
    const results = await cached(lk(`liked:movie:${id}`, lang), async () => {
      // 1) 优先 TasteDive
      if (TASTEDRIVE_KEY) {
        try {
          const td = await tastediveSimilar(title, TASTEDRIVE_KEY, 12, 'movie')
          const similar = td.similar || td.Similar || {}
          const raw = similar.results || similar.Results || []
          const names = raw
            .map((r) => (r.name || r.Name || '').trim())
            .filter(Boolean)
            .filter((n) => n.toLowerCase() !== title.toLowerCase())

          if (names.length > 0) {
            const resolveByName = async (name) =>
              cached(`likedresolve:${name.toLowerCase()}`, async () => {
                let pick = null
                try {
                  const data = await cached(`tdsearch:${name.toLowerCase()}`, () =>
                    tmdb('/search/movie', { query: name, include_adult: false })
                  )
                  let best = null
                  for (const m of (data.results || []).filter((x) => x.poster_path).slice(0, 10)) {
                    const s = titleScore(name, m.title)
                    if (!best || s > best.s) best = { m, s }
                  }
                  if (best && best.s >= 0.75) pick = best.m
                } catch {}
                if (!pick && process.env.OMDB_API_KEY) {
                  try {
                    const u = new URL('https://www.omdbapi.com/')
                    u.searchParams.set('t', name); u.searchParams.set('type', 'movie')
                    u.searchParams.set('apikey', process.env.OMDB_API_KEY)
                    const d = await (await fetch(u)).json()
                    if (d.Response === 'True' && /^tt\d+$/.test(d.imdbID || '') &&
                        titleScore(name, d.Title || '') >= 0.75) {
                      const f = await tmdb(`/find/${d.imdbID}`, { external_source: 'imdb_id' })
                      pick = (f.movie_results || []).find((m) => m.poster_path) || null
                    }
                  } catch { pick = null }
                }
                if (!pick || String(pick.id) === String(id)) return null
                return { tmdb_id: pick.id, title: pick.title,
                  year: (pick.release_date || '').slice(0, 4),
                  rating: pick.vote_average, poster_path: pick.poster_path }
              })
            const matched = await Promise.all(names.map(resolveByName))
            const seen = new Set([Number(id)])
            const filtered = matched
              .filter(Boolean)
              .filter((m) => !seen.has(m.tmdb_id) && seen.add(m.tmdb_id))
              .slice(0, 5)
            if (filtered.length > 0) return localizeMovieList(filtered, lang)
          }
        } catch {
          // TasteDive 失败（Cloudflare 403 等），降级到 TMDB recommendations
        }
      }

      // 2) 降级：TMDB recommendations（直接返回带海报的完整条目，标题已是目标语言）
      const data = await tmdb(`/movie/${id}/recommendations`, {}, lang)
      const picks = (data.results || [])
        .filter((m) => m.poster_path && String(m.id) !== String(id))
        .slice(0, 5)
        .map((m) => ({
          tmdb_id: m.id, title: m.title,
          year: (m.release_date || '').slice(0, 4),
          rating: m.vote_average, poster_path: m.poster_path,
        }))
      return picks
    })
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

// 剧集"看过这个的还喜欢"：优先 TasteDive，降级 TMDB tv recommendations
// 固定 en-US：TasteDive 与 TVmaze 均为英文条目（TMDB 仅用于按英文剧名反查 TVmaze 条目）
app.get('/api/liked/tv/:tvmazeId', async (req, res) => {
  const id = req.params.tvmazeId
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid tvmazeId' })
  const title = String(req.query.title || '').trim()
  const imdbId = String(req.query.imdb || '').trim()
  if (!title) return res.status(400).json({ error: 'title is required' })
  try {
    const results = await cached(`liked:tv:${id}`, async () => {
      // 1) 优先 TasteDive
      if (TASTEDRIVE_KEY) {
        try {
          const td = await tastediveSimilar(title, TASTEDRIVE_KEY, 12, 'show')
          const similar = td.similar || td.Similar || {}
          const raw = similar.results || similar.Results || []
          const names = raw
            .map((r) => (r.name || r.Name || '').trim())
            .filter(Boolean)
            .filter((n) => n.toLowerCase() !== title.toLowerCase())

          if (names.length > 0) {
            const resolveShow = async (name) =>
              cached(`likedtvresolve:${name.toLowerCase()}`, async () => {
                const data = await searchShows(name)
                let best = null
                for (const s of data.filter((x) => x.tvPoster)) {
                  const sScore = titleScore(name, s.title)
                  if (!best || sScore > best.score) best = { show: s, score: sScore }
                }
                if (!best || best.score < 0.75) return null
                if (String(best.show.id) === String(id)) return null
                return { tvmaze_id: best.show.id, title: best.show.title,
                  year: best.show.year, rating: best.show.rating, tvPoster: best.show.tvPoster }
              })
            const matched = await Promise.all(names.map(resolveShow))
            const seen = new Set([Number(id)])
            const filtered = matched
              .filter(Boolean)
              .filter((m) => !seen.has(m.tvmaze_id) && seen.add(m.tvmaze_id))
              .slice(0, 5)
            if (filtered.length > 0) return filtered
          }
        } catch { /* 降级 TMDB */ }
      }

      // 2) 降级：TMDB tv recommendations（用 imdb_id 找到 tmdb tv id）
      if (/^tt\d+$/.test(imdbId)) {
        try {
          const f = await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' })
          const tv = (f.tv_results || [])[0]
          if (tv?.id) {
            const data = await tmdb(`/tv/${tv.id}/recommendations`)
            const picks = (data.results || [])
              .filter((t) => t.poster_path)
              .slice(0, 5)
            // 用剧名在 TVmaze 匹配回 tvmaze_id + tvPoster
            const resolveShow = async (name, year) => {
              const data = await searchShows(name)
              let best = null
              for (const s of data.filter((x) => x.tvPoster)) {
                const sScore = titleScore(name, s.title)
                const yearHit = s.year && year ? Math.abs(Number(s.year) - Number(year)) <= 1 : true
                const score = sScore * (yearHit ? 1 : 0.5)
                if (!best || score > best.score) best = { show: s, score }
              }
              if (!best || best.score < 0.6) return null
              if (String(best.show.id) === String(id)) return null
              return { tvmaze_id: best.show.id, title: best.show.title,
                year: best.show.year, rating: best.show.rating, tvPoster: best.show.tvPoster }
            }
            const matched = await Promise.all(
              picks.map((t) => resolveShow(t.name, (t.first_air_date || '').slice(0, 4)))
            )
            const seen = new Set([Number(id)])
            return matched
              .filter(Boolean)
              .filter((m) => !seen.has(m.tvmaze_id) && seen.add(m.tvmaze_id))
              .slice(0, 5)
          }
        } catch {}
      }
      return []
    })
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

// 技术参数：从 ShotOnWhat? 抓取（懒加载，成功后本地文件永久缓存）
// 站点只认英文片名：中文界面传进来的中文片名会先用 IMDb id 反查英文名
app.get('/api/specs/:imdbId', async (req, res) => {
  const rawTitle = String(req.query.title || '').trim()
  const year = String(req.query.year || '').trim()
  if (!rawTitle || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'title and 4-digit year are required' })
  }
  try {
    const title = await englishTitleByImdb(req.params.imdbId, rawTitle)
    const result = await getSpecs(req.params.imdbId, title, year)
    // “查不到”是正常空结果（新片未收录），用 200 返回避免浏览器把 404 打进控制台
    if (!result.found) return res.json({ found: false })
    res.set('x-cache', result.cache)
    res.json({ found: true, ...result.specs })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

const IMG_SIZES = ['w185', 'w342', 'w500', 'w780', 'w1280', 'original']

// 图片代理：绕过 image.tmdb.org 的网络限制，同时规避 html2canvas 导出时的跨域问题
app.get('/api/image', async (req, res) => {
  const path = String(req.query.path || '')
  const size = IMG_SIZES.includes(String(req.query.s)) ? String(req.query.s) : 'w500'
  if (!/^\/[\w-]+\.(jpg|jpeg|png|webp|svg)$/i.test(path)) {
    return res.status(400).json({ error: 'invalid path' })
  }
  try {
    const { buf, contentType } = await getImage(path, size)
    res.set('Content-Type', contentType)
    // TMDB 图片路径为内容哈希，永不变更，可安全 immutable 长缓存
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 随机推荐：根据类型/年代/类别从 TMDB discover 随机选一部
// GET /api/recommend/random?kind=movie|tv&decade=2010s|any&genres=28,12
app.get('/api/recommend/random', async (req, res) => {
  const kind = req.query.kind === 'tv' ? 'tv' : 'movie'
  const decade = String(req.query.decade || 'any').trim()
  const genres = String(req.query.genres || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)

  // 年代 → 年份范围
  let yearGte = '', yearLte = ''
  if (decade !== 'any') {
    const m = /^(\d{4})s$/.exec(decade)
    if (m) {
      const start = Number(m[1])
      yearGte = `${start}-01-01`
      yearLte = `${start + 9}-12-31`
    }
  }

  const params = {
    sort_by: 'popularity.desc',
    include_adult: false,
    'vote_count.gte': kind === 'tv' ? 30 : 100,
    page: String(Math.floor(Math.random() * 50) + 1), // 随机页
  }
  if (genres.length > 0) params.with_genres = genres.join(',')
  if (yearGte) {
    if (kind === 'movie') {
      params['primary_release_date.gte'] = yearGte
      params['primary_release_date.lte'] = yearLte
    } else {
      params['first_air_date.gte'] = yearGte
      params['first_air_date.lte'] = yearLte
    }
  }

  try {
    const endpoint = kind === 'movie' ? '/discover/movie' : '/discover/tv'
    // 电影结果直接展示给用户 → 跟随 ?lang；剧集要用 TMDB 剧名匹配 TVmaze，固定 en-US
    const lang = kind === 'movie' ? reqLang(req) : 'en-US'
    // 先请求第一页拿到 total_pages，再在有效范围内随机选页
    const first = await tmdb(endpoint, { ...params, page: '1' }, lang)
    const totalPages = Math.min(first.total_pages || 1, 30)
    const randPage = Math.floor(Math.random() * totalPages) + 1
    const data = randPage === 1 ? first : await tmdb(endpoint, { ...params, page: String(randPage) }, lang)
    const list = (data.results || []).filter((x) => x.poster_path)
    if (list.length === 0) return res.json({ result: null })

    // 从结果里随机选一个
    const pick = list[Math.floor(Math.random() * list.length)]

    if (kind === 'movie') {
      return res.json({
        result: {
          kind: 'movie',
          id: pick.id,
          title: pick.title,
          year: (pick.release_date || '').slice(0, 4),
          rating: pick.vote_average,
          overview: pick.overview || '',
          poster_path: pick.poster_path,
        },
      })
    }

    // 剧集：用剧名在 TVmaze 匹配回 tvmaze_id
    const shows = await searchShows(pick.name)
    const year = (pick.first_air_date || '').slice(0, 4)
    let best = null
    for (const s of shows.filter((x) => x.tvPoster)) {
      const sScore = titleScore(pick.name, s.title)
      const yearHit = s.year && year ? Math.abs(Number(s.year) - Number(year)) <= 1 : true
      const score = sScore * (yearHit ? 1 : 0.5)
      if (!best || score > best.score) best = { show: s, score }
    }
    if (!best || best.score < 0.6) {
      // TVmaze 匹配失败，返回 TMDB 原始数据（前端可用，但无法点进详情页）
      return res.json({
        result: {
          kind: 'tv', id: null, title: pick.name, year,
          rating: pick.vote_average, overview: pick.overview || '',
          poster_path: pick.poster_path, _tmdbOnly: true,
        },
      })
    }
    return res.json({
      result: {
        kind: 'tv', id: best.show.id, title: best.show.title,
        year: best.show.year, rating: best.show.rating,
        overview: pick.overview || best.show.overview || '',
        tvPoster: best.show.tvPoster,
      },
    })
  } catch (e) {
    res.status(502).json({ error: e.message, result: null })
  }
})

// ============ TVmaze 剧集 ============

// 剧集搜索
app.get('/api/tv/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  try {
    const results = await cached(`tvsearch:${q}`, () => searchShows(q))
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// TVmaze 图片代理：必须在 /api/tv/:id 之前注册，避免被当成 id
const tvImgInFlight = new Map()
app.get('/api/tv/image', async (req, res) => {
  const u = parseTvImageUrl(String(req.query.u || ''))
  if (!u) return res.status(400).json({ error: 'invalid tvmaze image url' })
  const key = u.toString()
  try {
    const job = tvImgInFlight.has(key)
      ? tvImgInFlight.get(key)
      : (() => {
          const p = fetchTvImage(u).finally(() => tvImgInFlight.delete(key))
          tvImgInFlight.set(key, p)
          return p
        })()
    const { buf, contentType } = await job
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=604800, immutable')
    res.send(buf)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 剧集详情（含 cast、季、分集数）
app.get('/api/tv/:id(\\d+)', async (req, res) => {
  try {
    const show = await cached(`tvshow:${req.params.id}`, () => getShow(Number(req.params.id)))
    if (!show) return res.status(404).json({ error: 'show not found' })
    res.json(show)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 剧集分集列表
app.get('/api/tv/:id(\\d+)/episodes', async (req, res) => {
  try {
    const episodes = await cached(`tveps:${req.params.id}`, () => getEpisodes(Number(req.params.id)))
    res.json({ episodes })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 字幕搜索
app.get('/api/subtitles', async (req, res) => {
  try {
    const { imdb_id, season, episode, lang, query } = req.query
    if (!imdb_id && !query) return res.status(400).json({ error: 'imdb_id or query required' })
    const rawImdb = (imdb_id || '').replace(/^tt/, '')
    const results = await searchSubtitles(rawImdb, season, episode, lang || 'eng', query)
    res.json({ results })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 字幕下载（gunzip → 纯 SRT 文本）
app.get('/api/subtitle/download', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'url required' })
    const text = await downloadSubtitle(url)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="subtitle.srt"')
    res.send(text)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 同时支持两种运行方式：
// - 传统常驻进程（本地/VPS）：直接 `node index.js` 时监听端口
// - Vercel Serverless：由 api/index.js 导入 app，不监听端口
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`lumenframe server: http://localhost:${PORT}`))
}

export default app
