// ShotOnWhat? 技术参数抓取
// 站点为 WordPress 服务端直出，详情页结构：
//   <div class="tablediv">分类名</div><div class="tablediv_content"><a>值</a><br/>...</div>
// 无需无头浏览器；抓取成功后写入本地文件做永久缓存（技术参数上映后基本不变）
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { load } from 'cheerio'

const BASE = 'https://shotonwhat.com'
// Vercel 等 serverless 平台文件系统只读，缓存改放 /tmp（实例回收后失效，属正常降级）
const CACHE_DIR = process.env.VERCEL
  ? path.join(tmpdir(), 'lumenframe', 'sow')
  : path.join(import.meta.dirname, '.cache', 'sow')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const FAIL_TTL = 10 * 60 * 1000

// 失败结果只做短期内存缓存，避免反复抓取；成功结果走文件永久缓存
const failCache = new Map()

class HttpError extends Error {}
class SpecNotFound extends Error {}

async function fetchHtml(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    return { status: res.status, html: await res.text(), url: res.url }
  } finally {
    clearTimeout(timer)
  }
}

function slugify(title) {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
  )
}

// 站内搜索兜底：WordPress 搜索是 AND 语义，所以只丢片名、用年份过滤结果
async function searchMovieUrl(title, year) {
  const variants = [title, title.replace(/\s*[（(][^）)]*[）)]/g, '').trim()].filter(Boolean)
  for (const q of [...new Set(variants)]) {
    const search = await fetchHtml(`${BASE}/?s=${encodeURIComponent(q)}`)
    if (search.status !== 200) throw new HttpError(`SOW search ${search.status}`)
    for (const m of search.html.matchAll(/href="(https:\/\/shotonwhat\.com\/[a-z0-9][a-z0-9-]+)"/g)) {
      const u = m[1]
      if (!new URL(u).pathname.endsWith(`-${year}`)) continue
      const page = await fetchHtml(u)
      if (page.status === 200 && page.html.includes('class="tablediv"')) return page
    }
  }
  throw new SpecNotFound('not found on ShotOnWhat?')
}

// 定位电影详情页：先直拼 slug（站点会 301 到规范 URL），失败再用站内搜索兜底
async function findMovieUrl(title, year) {
  const slug = slugify(title)
  if (slug) {
    const direct = await fetchHtml(`${BASE}/${slug}-${year}`)
    if (direct.status === 200 && direct.html.includes('class="tablediv"')) return direct
  }
  return searchMovieUrl(title, year)
}

// 将 tablediv/tablediv_content 成对解析为 { 分类: [值...] }
function parseSpecs(html, pageUrl) {
  const $ = load(html)
  const blocks = {}
  $('div.tablediv').each((_, el) => {
    const label = $(el).text().trim()
    const values = []
    $(el)
      .nextAll('div.tablediv_content')
      .first()
      .find('a')
      .each((_, a) => {
        const $a = $(a)
        if ($a.hasClass('addinfonow')) return // “Add a Camera” 之类的占位链接
        const text = $a.text().trim()
        if (text && !/^add a /i.test(text)) values.push(text)
      })
    if (label && values.length) blocks[label] = [...new Set(values)]
  })

  // 硬失败：一个规格块都没解析到，说明页面结构变化或抓错页面
  if (Object.keys(blocks).length === 0) throw new Error('parse failed: no spec blocks')

  return {
    source: 'shotonwhat.com',
    url: pageUrl,
    cameras: blocks['Cameras'] || [],
    lenses: blocks['Lenses'] || [],
    aspectRatios: blocks['Distributed Aspect Ratio'] || [],
    negativeStocks: blocks['Film Negative Stock'] || [],
    negativeWidths: blocks['Film Negative Width'] || [],
    printStocks: blocks['Film Print Stock'] || [],
    processes: blocks['Additional Post Processes'] || [],
    editingSystems: blocks['Editing System'] || [],
  }
}

export async function getSpecs(imdbId, title, year) {
  // 1) 短期失败缓存
  const fail = failCache.get(imdbId)
  if (fail && Date.now() - fail < FAIL_TTL) return { found: false }

  // 2) 文件永久缓存
  const cacheFile = path.join(CACHE_DIR, `${imdbId}.json`)
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
    return { found: true, specs: cached, cache: 'hit' }
  } catch {}

  // 3) 实时抓取
  try {
    const page = await findMovieUrl(title, year)
    const specs = parseSpecs(page.html, page.url)
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(specs, null, 2), 'utf8')
    return { found: true, specs, cache: 'miss' }
  } catch (e) {
    if (e instanceof SpecNotFound) {
      failCache.set(imdbId, Date.now())
      return { found: false }
    }
    throw e
  }
}
