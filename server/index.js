import express from 'express'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { getSpecs } from './sow.js'
import { getRatings } from './ratings.js'

const TMDB_API = 'https://api.themoviedb.org/3'
const TMDB_IMG = 'https://image.tmdb.org/t/p'
const API_KEY = process.env.TMDB_API_KEY
const PORT = process.env.PORT || 3001

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

async function tmdb(path, params = {}) {
  const url = new URL(TMDB_API + path)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

// 搜索电影
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  try {
    const data = await cached(`search:${q}`, () =>
      tmdb('/search/movie', { query: q, include_adult: false })
    )
    res.json({
      results: data.results.map((m) => ({
        id: m.id,
        title: m.title,
        year: (m.release_date || '').slice(0, 4),
        rating: m.vote_average,
        overview: m.overview || '',
        poster_path: m.poster_path,
      })),
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 电影详情（海报、标题、评分、年份、IMDb ID、演职员）
app.get('/api/movie/:id', async (req, res) => {
  try {
    const m = await cached(`movie:${req.params.id}`, () =>
      tmdb(`/movie/${req.params.id}`, { append_to_response: 'credits' })
    )
    // crew 中 job 字段区分导演/编剧/摄影指导；cast 已按番位排序
    const crew = m.credits?.crew || []
    const seen = new Set()
    const writers = crew
      .filter((p) => ['Screenplay', 'Writer', 'Story', 'Novel'].includes(p.job))
      .filter((p) => !seen.has(p.id) && seen.add(p.id))
      .slice(0, 3)
      .map((p) => p.name)
    res.json({
      id: m.id,
      title: m.title,
      original_title: m.original_title,
      year: (m.release_date || '').slice(0, 4),
      rating: m.vote_average,
      runtime: m.runtime || null,
      genres: (m.genres || []).map((g) => g.name),
      overview: m.overview,
      poster_path: m.poster_path,
      imdb_id: m.imdb_id,
      credits: {
        director: crew.find((p) => p.job === 'Director')?.name || null,
        writers,
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
  try {
    const data = await cached(`movie:${req.params.id}:images`, () =>
      // include_image_language=en,null：英语海报 + 无语言标注的原版海报
      tmdb(`/movie/${req.params.id}/images`, {
        language: 'en',
        include_image_language: 'en,null',
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

// 热门电影海报列表（用于背景滚动墙）
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

// 第三方评分：OMDB API（IMDb / Rotten Tomatoes / Metacritic），懒加载，成功后文件缓存
app.get('/api/ratings/:imdbId', async (req, res) => {
  const title = String(req.query.title || '').trim()
  const year = String(req.query.year || '').trim()
  if (!title || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'title and 4-digit year are required' })
  }
  try {
    const data = await getRatings(req.params.imdbId, title, year)
    res.set('x-cache', data.cache)
    res.json({ imdb: data.imdb, metacritic: data.metacritic, rotten_tomatoes: data.rotten_tomatoes, popcornmeter: data.popcornmeter })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 预告片：TMDB /movie/{id}/videos 返回官方预告片 YouTube key（无需 YouTube 搜索配额）
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

// 技术参数：从 ShotOnWhat? 抓取（懒加载，成功后本地文件永久缓存）
app.get('/api/specs/:imdbId', async (req, res) => {
  const title = String(req.query.title || '').trim()
  const year = String(req.query.year || '').trim()
  if (!title || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'title and 4-digit year are required' })
  }
  try {
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

// 同时支持两种运行方式：
// - 传统常驻进程（本地/VPS）：直接 `node index.js` 时监听端口
// - Vercel Serverless：由 api/index.js 导入 app，不监听端口
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`lumenframe server: http://localhost:${PORT}`))
}

export default app
