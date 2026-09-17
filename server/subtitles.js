// OpenSubtitles REST API（无需 API key，只需 User-Agent）
// 文档：https://trac.opensubtitles.org/wiki/DevReadLine
// 搜索：GET https://rest.opensubtitles.org/search/imdbid-xxx/season-y/episode-z/sublanguageid-eng
// 下载链接 SubDownloadLink 返回 gzip 压缩的 .srt，需 gunzip

import https from 'node:https'
import zlib from 'node:zlib'

const HOST = 'rest.opensubtitles.org'
const UA = 'Lumenframe v1.0'

// 简单内存缓存（30 分钟）
const cache = new Map()
const CACHE_TTL = 30 * 60 * 1000

function httpsGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: HOST,
      path: pathname,
      port: 443,
      family: 4,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: 15000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          buf,
          json: () => JSON.parse(buf.toString('utf8')),
          headers: res.headers,
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('opensubtitles timeout')))
  })
}

// 解析 OpenSubtitles 返回结果
function parseResults(data) {
  return (Array.isArray(data) ? data : []).map((s) => ({
    filename: s.MovieReleaseName || s.SubFileName || 'unknown.srt',
    lang: s.LanguageName || 'Unknown',
    langCode: s.SubLanguageID || '',
    rating: parseFloat(s.SubRating) || 0,
    downloads: parseInt(s.SubDownloadCount) || 0,
    downloadUrl: s.SubDownloadLink || '',
    hearingImpaired: s.SubHearingImpaired === '1',
    encoding: s.SubEncoding || 'UTF-8',
  }))
}

// 按 IMDB ID 搜索字幕
// imdbId 不带 tt 前缀
export async function searchSubtitles(imdbId, season, episode, lang, query) {
  const paddedId = String(imdbId || '').replace(/^tt/, '').padStart(7, '0')
  const key = `subs:v3:${paddedId}:${season || ''}:${episode || ''}:${lang || ''}:${query || ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data

  let results = []

  // 优先用 IMDB ID 搜索（独立路径段格式）
  if (paddedId) {
    let path = `/search/imdbid-${paddedId}`
    if (season) path += `/season-${season}`
    if (episode) path += `/episode-${episode}`
    if (lang) path += `/sublanguageid-${lang}`

    try {
      const r = await httpsGet(path)
      if (r.ok) {
        results = parseResults(r.json())
      }
    } catch (e) {
      // 忽略，走 fallback
    }
  }

  // fallback：用剧名搜索
  if (results.length === 0 && query) {
    let path = `/search/query-${encodeURIComponent(query)}`
    if (season) path += `/season-${season}`
    if (episode) path += `/episode-${episode}`
    if (lang) path += `/sublanguageid-${lang}`

    try {
      const r = await httpsGet(path)
      if (r.ok) {
        results = parseResults(r.json())
      }
    } catch (e) {
      // 忽略
    }
  }

  cache.set(key, { data: results, t: Date.now() })
  return results
}

// 下载字幕：gunzip 后返回纯文本 SRT
export async function downloadSubtitle(url) {
  // 验证 URL 来自 opensubtitles
  const u = new URL(url)
  if (!u.host.endsWith('.opensubtitles.org') && !u.host.endsWith('.opensubtitles.com')) {
    throw new Error('invalid subtitle url')
  }

  const buf = await new Promise((resolve, reject) => {
    https.get(url, {
      family: 4,
      headers: { 'User-Agent': UA },
      timeout: 15000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })

  // SubDownloadLink 返回 gzip 压缩的 SRT
  const text = zlib.gunzipSync(buf).toString('utf8')
  return text
}
