// 第三方评分抓取：OMDB API 一次返回 IMDb / Rotten Tomatoes / Metacritic 三家评分
// 文档：https://www.omdbapi.com/
// 抓不到就是 null，不伪造。成功结果写文件长期缓存。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getRtScores } from './rt.js'

// 缓存结构版本：升级字段后旧缓存自动失效重抓一次
const CACHE_VERSION = 2

const OMDB_API_KEY = process.env.OMDB_API_KEY
const OMDB_URL = 'https://www.omdbapi.com/'

// Vercel 等 serverless 平台文件系统只读，缓存改放 /tmp（实例回收后失效，属正常降级）
const CACHE_DIR = process.env.VERCEL
  ? path.join(tmpdir(), 'lumenframe', 'ratings')
  : path.join(import.meta.dirname, '.cache', 'ratings')
const FAIL_TTL = 10 * 60 * 1000

const failCache = new Map()

async function fetchJson(url, ms = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return null
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function getOmdbRatings(imdbId) {
  if (!OMDB_API_KEY) return null
  try {
    const data = await fetchJson(`${OMDB_URL}?i=${imdbId}&apikey=${OMDB_API_KEY}`)
    if (!data || data.Response === 'False') return null

    const imdb = Number(data.imdbRating)
    const metascore = data.Metascore && data.Metascore !== 'N/A' ? Number(data.Metascore) : null
    const rtEntry = Array.isArray(data.Ratings)
      ? data.Ratings.find(r => r.Source === 'Rotten Tomatoes')
      : null
    const rottenTomatoes = rtEntry && rtEntry.Value
      ? Number(rtEntry.Value.replace('%', ''))
      : null

    return {
      imdb: Number.isFinite(imdb) && imdb > 0 ? Number(imdb.toFixed(1)) : null,
      metacritic: Number.isFinite(metascore) && metascore > 0 ? metascore : null,
      rotten_tomatoes: Number.isFinite(rottenTomatoes) ? rottenTomatoes : null,
    }
  } catch {
    return null
  }
}

export async function getRatings(imdbId, title, year) {
  const empty = { imdb: null, metacritic: null, rotten_tomatoes: null, popcornmeter: null }
  const fail = failCache.get(imdbId)
  if (fail && Date.now() - fail < FAIL_TTL) return { ...empty, cache: 'fail' }

  const cacheFile = path.join(CACHE_DIR, `${imdbId}.json`)
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
    if (cached.v >= CACHE_VERSION) return { ...cached, cache: 'hit' }
  } catch {}

  // OMDB：IMDb / Tomatometer / Metacritic；RT 页面：Tomatometer 兜底 + Popcornmeter
  const [omdb, rt] = await Promise.all([
    getOmdbRatings(imdbId),
    getRtScores(title, year).catch(() => null),
  ])

  const data = {
    v: CACHE_VERSION,
    imdb: omdb?.imdb ?? null,
    metacritic: omdb?.metacritic ?? null,
    rotten_tomatoes: omdb?.rotten_tomatoes ?? rt?.critics ?? null,
    popcornmeter: rt?.audience ?? null,
  }

  if (data.imdb == null && data.metacritic == null &&
      data.rotten_tomatoes == null && data.popcornmeter == null) {
    failCache.set(imdbId, Date.now())
    return { ...data, cache: 'miss' }
  }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(cacheFile, JSON.stringify(data), 'utf8')
  return { ...data, cache: 'miss' }
}
