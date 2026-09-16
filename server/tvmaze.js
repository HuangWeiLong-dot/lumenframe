// TVmaze（剧集元数据，免费、无需 API key）
// 使用 Node.js 原生 https 模块，绕过 undici fetch（避免 IPv6/proxy 兼容问题）
// 与 curl 使用相同的系统网络栈，连通性一致
import https from 'node:https'

const BASE = 'api.tvmaze.com'
const IMG_HOST = 'static.tvmaze.com'
const UA = 'Lumenframe/1.0 (movie & tv metadata app; https://github.com/lumenframe)'

function httpsGet(pathname, host = BASE) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host,
      path: pathname,
      port: 443,
      family: 4, // 强制 IPv4
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: 15000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          body,
          json: () => JSON.parse(body),
          headers: res.headers,
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('tvmaze timeout')))
  })
}

async function tvmaze(pathname) {
  const r = await httpsGet(pathname)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`tvmaze ${r.status}`)
  return r.json()
}

// TVmaze 剧情/简介是 HTML 片段（<p>、<b>…），去标签 + 还原常见实体
export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function networkName(s) {
  return s.network?.name || s.webChannel?.name || null
}

function bestImage(s) {
  return s.image?.original || s.image?.medium || null
}

// 剧集搜索：/search/shows?q=
export async function searchShows(q) {
  const data = await tvmaze(`/search/shows?q=${encodeURIComponent(q)}`)
  if (!data) return []
  return data.map(({ show: s }) => ({
    kind: 'tv',
    id: s.id,
    title: s.name,
    year: (s.premiered || '').slice(0, 4),
    rating: s.rating?.average ?? null,
    overview: stripHtml(s.summary),
    genres: s.genres || [],
    tvPoster: bestImage(s),
  }))
}

// 剧集详情：内嵌 cast / seasons / episodes（一次性拿全，服务端有缓存）
export async function getShow(id) {
  const emb = ['cast', 'seasons', 'episodes'].map((e) => `embed[]=${e}`).join('&')
  const s = await tvmaze(`/shows/${id}?${emb}`)
  if (!s) return null

  const embedded = s._embedded || {}
  const rawSeasons = embedded.seasons || []
  const episodes = (embedded.episodes || []).filter((e) => e.season >= 1)

  const countBySeason = new Map()
  for (const e of episodes) {
    countBySeason.set(e.season, (countBySeason.get(e.season) || 0) + 1)
  }
  const seasons = rawSeasons
    .filter((x) => x.number >= 1)
    .map((x) => ({
      number: x.number,
      episodeCount: countBySeason.get(x.number) ?? x.episodeOrder ?? 0,
      premiered: x.premiereDate || null,
      ended: x.endDate || null,
      image: x.image?.original || x.image?.medium || null,
      summary: stripHtml(x.summary),
      network: x.network?.name || x.webChannel?.name || null,
    }))
    .sort((a, b) => a.number - b.number)

  const startYear = (s.premiered || '').slice(0, 4)
  const endYear = (s.ended || '').slice(0, 4)
  const running = s.status === 'Running'
  const yearRange = startYear
    ? `${startYear}–${endYear && endYear !== startYear ? endYear : running ? '' : startYear}`
    : ''

  return {
    kind: 'tv',
    id: s.id,
    title: s.name,
    original_title: null,
    year: startYear,
    yearRange,
    rating: s.rating?.average ?? null,
    ratingSource: 'TVmaze',
    runtime: s.averageRuntime || s.runtime || null,
    genres: s.genres || [],
    status: s.status || null,
    network: networkName(s),
    overview: stripHtml(s.summary),
    tvPoster: bestImage(s),
    imdb_id: s.externals?.imdb || null,
    tvmaze_url: s.url || `https://www.tvmaze.com/shows/${s.id}`,
    seasonsCount: seasons.length,
    episodesCount: episodes.length,
    seasons,
    credits: {
      director: null,
      writers: [],
      dop: null,
      cast: (embedded.cast || []).slice(0, 8).map((c) => ({
        id: c.person?.id,
        name: c.person?.name,
        character: c.character?.name || null,
      })),
    },
  }
}

export async function getEpisodes(id) {
  const data = await tvmaze(`/shows/${id}/episodes`)
  if (!data) return []
  return data
    .filter((e) => e.season >= 1)
    .map((e) => ({
      season: e.season,
      number: e.number,
      name: e.name || `Episode ${e.number}`,
      airdate: e.airdate || null,
      runtime: e.runtime || null,
      summary: stripHtml(e.summary),
      image: e.image?.original || e.image?.medium || null,
    }))
}

// 校验并代理 static.tvmaze.com 图片
export function parseTvImageUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.host !== IMG_HOST) return null
  if (!u.pathname.startsWith('/uploads/')) return null
  if (!/\.(jpg|jpeg|png|webp)$/i.test(u.pathname)) return null
  return u
}

export async function fetchTvImage(u) {
  const url = new URL(u)
  const r = await httpsGet(url.pathname + url.search, url.host)
  if (!r.ok) throw new Error(`tvmaze image ${r.status}`)
  return {
    buf: Buffer.from(r.body, 'binary'),
    contentType: r.headers['content-type'] || 'image/jpeg',
  }
}
