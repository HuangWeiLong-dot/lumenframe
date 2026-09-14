// 第三方评分抓取：
// - IMDb 评分：cinemeta（Stremio 元数据库，数据源自 IMDb）https://v3-cinemeta.strem.io/meta/movie/<imdbId>.json
// - Metascore：metacritic.com 电影页内嵌 JSON-LD 的 aggregateRating.ratingValue
// 两个源相互独立，任一失败不影响另一个；抓不到就是 null，不伪造。成功结果写文件长期缓存。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

// Vercel 等 serverless 平台文件系统只读，缓存改放 /tmp（实例回收后失效，属正常降级）
const CACHE_DIR = process.env.VERCEL
  ? path.join(tmpdir(), 'lumenframe', 'ratings')
  : path.join(import.meta.dirname, '.cache', 'ratings')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const FAIL_TTL = 10 * 60 * 1000

const failCache = new Map()

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchText(url, ms = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

async function getImdbRating(imdbId) {
  try {
    const r = await fetchText(`https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`)
    if (r.status !== 200) return null
    const v = JSON.parse(r.text)?.meta?.imdbRating
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(1)) : null
  } catch {
    return null
  }
}

async function getMetascore(title, year) {
  try {
    const r = await fetchText(`https://www.metacritic.com/movie/${slugify(title)}/`)
    if (r.status !== 200) return null
    // JSON-LD 中同时含 datePublished（用于确认是同年版本，避免重拍/同名撞 slug）
    const yearMatch = r.text.match(/"datePublished"\s*:\s*"(\d{4})/)
    if (yearMatch && yearMatch[1] !== String(year)) return null
    const m = r.text.match(/"aggregateRating"\s*:\s*\{[^{}]*?"name"\s*:\s*"Metascore"[^{}]*?"ratingValue"\s*:\s*(\d+)/)
    if (!m) {
      // 部分页面字段顺序不同，退化为任意 aggregateRating
      const m2 = r.text.match(/"aggregateRating"\s*:\s*\{[^{}]*?"ratingValue"\s*:\s*(\d+)/)
      return m2 ? Number(m2[1]) : null
    }
    return Number(m[1])
  } catch {
    return null
  }
}

export async function getRatings(imdbId, title, year) {
  const fail = failCache.get(imdbId)
  if (fail && Date.now() - fail < FAIL_TTL) return { imdb: null, metacritic: null, cache: 'fail' }

  const cacheFile = path.join(CACHE_DIR, `${imdbId}.json`)
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
    return { ...cached, cache: 'hit' }
  } catch {}

  const [imdb, metacritic] = await Promise.all([
    getImdbRating(imdbId),
    getMetascore(title, year),
  ])
  const data = { imdb, metacritic }

  if (imdb == null && metacritic == null) {
    failCache.set(imdbId, Date.now())
    return { ...data, cache: 'miss' }
  }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(data), 'utf8')
  return { ...data, cache: 'miss' }
}
