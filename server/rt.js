// Rotten Tomatoes 评分抓取（无公开 API，走服务端渲染页面内嵌 JSON）
// 电影页 HTML 中 <script id="media-scorecard-json" type="application/json">
// 同时包含：
//   criticsScore.score    → Tomatometer（媒体/影评人分）
//   audienceScore.score   → Popcornmeter（观众分，2025 年取代旧 Audience Score）
// 片名 → RT slug 通过搜索页 /search?search= 解析；抓不到返回 null，不伪造。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function fetchText(url, ms = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
    return res.status === 200 ? await res.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// 片名 → RT 风格 slug："Spider-Man: Brand New Day" → "spider_man_brand_new_day"
function rtSlug(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’!:?,.&()–-]/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// 搜索页中按出现顺序提取去重的 /m/<slug> 列表
async function searchSlugs(title) {
  const html = await fetchText(
    `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`
  )
  if (!html) return []
  const seen = new Set()
  const out = []
  for (const m of html.matchAll(/\/m\/([a-z0-9_]+)/g)) {
    const s = m[1]
    if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

// 从电影页 HTML 解析评分与年份
function parsePage(html) {
  const m = html.match(
    /<script[^>]*id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/
  )
  if (!m) return null
  let j
  try { j = JSON.parse(m[1]) } catch { return null }

  const toNum = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const critics = toNum(j.criticsScore?.score)
  // 未上映/暂无观众分的影片 hideAudienceScore=true
  const audience = j.hideAudienceScore ? null : toNum(j.audienceScore?.score)

  // 年份从 JSON-LD dateCreated 取，用于校验重拍/同名版本
  const yearMatch = html.match(/"dateCreated"\s*:\s*"(\d{4})/)
  const year = yearMatch ? Number(yearMatch[1]) : null

  return { critics, audience, year }
}

// 主入口：返回 { critics, audience }（缺失为 null），全部失败返回 null
export async function getRtScores(title, year) {
  const base = rtSlug(title)
  if (!base) return null
  const wantedYear = String(year)
  const slugs = await searchSlugs(title).catch(() => [])

  // 候选 slug 优先级：
  // 1) base_年份（RT 对同名/重拍的标准消歧后缀）
  // 2) base（无后缀，再用页面年份校验）
  // 3) 搜索结果中其他以 base 开头且年份匹配的 slug
  // 4) 搜索结果中以 base 开头但不带年份后缀的 slug
  const cands = []
  const push = (s) => { if (s && !cands.includes(s)) cands.push(s) }
  push(`${base}_${year}`)
  push(base)
  for (const s of slugs) {
    if (s.startsWith(`${base}_`) && s.endsWith(`_${year}`)) push(s)
  }
  for (const s of slugs) {
    if (s.startsWith(`${base}_`) && !/_\d{4}$/.test(s)) push(s)
  }
  // 搜索失败时上面两个直连候选仍然有效

  for (const slug of cands) {
    const html = await fetchText(`https://www.rottentomatoes.com/m/${slug}`)
    if (!html) continue
    const p = parsePage(html)
    if (!p) continue
    if (p.year && String(p.year) !== wantedYear) continue
    if (p.critics == null && p.audience == null) continue
    return { critics: p.critics, audience: p.audience }
  }
  return null
}
