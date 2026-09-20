// 剧集的中文元数据（数据来自 TMDB —— TVmaze 本身没有中文）。
//
// **身份仍然是 TVmaze id。** 路由是 /tv/{tvmazeId}，片库键是 `tv:{tvmazeId}`，收藏、
// 分集、图片全挂在这个 id 上，所以这里只做「叠加」：拿 TMDB 的中文片名/简介/类型
// 盖到 TVmaze 的英文载荷上，id 一个都不换。换 id 等于让所有已存的片库、收藏、深链失效。
//
// 补 `title_en` 是必须的，不是顺手：界面上每一处要拿片名去问只认英文的服务（种子站、
// 字幕、ShotOnWhat、烂番茄、TasteDive、相似推荐）用的都是 `title_en || title`。剧集
// 过去没有这个字段，靠的是「TVmaze 的 title 本来就是英文」这条隐性前提 —— title 一旦
// 变中文，兜底就没了，那些服务会被中文片名问一遍，全部落空。所以 title_en 恒为 TVmaze 的英文名。
//
// 少了中文元数据只会退回英文，不会出错；所以这里所有失败路径都是「原样返回」，不抛。

import { showSummary } from './tvmaze.js'

// 从两种形状里取外部 id：TVmaze 原始对象是 `externals.{imdb,thetvdb}`，
// getShow() 之后的载荷是摊平的 `imdb_id` / `tvdb_id`。两种都要认。
function externalsOf(x) {
  return {
    imdb: x?.externals?.imdb || x?.imdb_id || null,
    tvdb: x?.externals?.thetvdb || x?.tvdb_id || null,
  }
}

// TVmaze 剧集 → TMDB 的 tv 条目（find 结果里的 `tv_results[0]`）。
//
// 走外部 id，不按片名搜：同名剧集（《神探夏洛克》BBC 的，和别的）按名字搜会挑错，
// 而 imdb / tvdb 是唯一的。imdb 优先，没有再试 tvdb；两条都不通返回 null。
//
// 返回的是整条 find 结果，不是光一个 id：它本身就带着**本地化的** name / overview /
// genre_ids（实测 zh-CN 下 585 字节），所以搜索列表拿到这一步就够了，不必再打一次
// `/tv/{id}` —— 那会把每次搜索的 TMDB 请求数翻倍，而 `cached()` 是一个全局 200 条的
// FIFO，多塞一份 `/tv/{id}` 的大对象还会顺手挤掉别的东西。
// 只有详情页为了**类型名**才补那一次（find 只给 genre_ids，不给名字）。
export async function resolveTmdbTv(show, tmdb, lang = 'en-US') {
  const { imdb, tvdb } = externalsOf(show)
  for (const [source, ext] of [['imdb_id', imdb], ['tvdb_id', tvdb]]) {
    if (!ext) continue
    try {
      const found = await tmdb(`/find/${encodeURIComponent(ext)}`, { external_source: source }, lang)
      const hit = (found?.tv_results || [])[0]
      if (hit?.id) return hit
    } catch {
      // 这条走不通就试下一条
    }
  }
  return null
}

// 片名 + 简介：find 结果和 /tv/{id} 详情都带这两个字段
function overlayText(base, d) {
  if (!d) return base
  const out = { ...base }
  if (d.name) out.title = d.name
  if (d.overview) out.overview = d.overview
  if (d.id) out.tmdb_id = d.id
  return out
}

// 类型：只有 /tv/{id} 详情给的是**名字**（find 只给 id），所以单独一层
function overlayGenres(base, d) {
  const gs = d?.genres || []
  if (!gs.length) return base
  return {
    ...base,
    genres: gs.map((g) => g.name),
    // genre_ids 必须和 genres **同序一起**给。前端拼类型页链接是
    // `genreIdByName(名, genreSource) || movie?.genre_ids?.[idx]`（App.jsx），而
    // genres.js 那张表是**英文名** → TMDB id；中文名查不到，兜底就落在按位置取
    // genre_ids 上。位置错开一个，点「剧情」会跳到「喜剧」。
    genre_ids: gs.map((g) => g.id),
  }
}

// 详情页用：show 是 getShow() 的载荷（英文单语，无 title_en）。
export async function localizeShow(show, lang, deps) {
  // title_en 与 original_title 都填 TVmaze 的英文名，但用途不同：
  // 前者是给只认英文名的服务用的（上面那段），后者只给页面在中文片名下显示原名 ——
  // 电影页就是这么显示的（App.jsx 的 `original_title !== title` 判断），剧集页对齐它。
  const base = { ...show, title_en: show.title, original_title: show.title }
  if (lang === 'en-US') return base
  try {
    const hit = await deps.find(show, lang)
    if (!hit) return base
    const detail = await deps.detail(hit.id, lang)
    return overlayGenres(overlayText(base, detail), detail)
  } catch {
    return base
  }
}

// 搜索列表用：entries 是 TVmaze /search/shows 的原始条目（`{ score, show }`）。
// 它们自带 externals，所以每条最多多一次 /find（走 deps.find 的缓存，条目很小）。
// 逐条并行取，单条失败只让那一条退回英文。
export async function localizeSummaries(entries, lang, deps) {
  const shows = entries.map((e) => e?.show).filter(Boolean)
  const bases = shows.map((s) => ({ ...showSummary(s), title_en: s.name }))
  if (lang === 'en-US') return bases
  const hits = await Promise.all(
    shows.map((s) => deps.find(s, lang).catch(() => null))
  )
  return bases.map((b, i) => overlayText(b, hits[i]))
}
