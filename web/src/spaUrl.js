// 站点根路径与 GitHub Pages / Nginx 的 SPA 深链回退。
// 从 App.jsx 原样搬出（函数体未改），因为 Supabase 的邮件回调地址也要用 BASE_PATH，
// 而从 App.jsx 反向 import 会形成循环依赖。

// 服务器 SPA 重定向修复：部分 nginx/CDN 用 _spa= 参数重定向而非 try_files，
// 刷新 /tv/541-prison-break → /tv/?_spa=/tv/541-prison-break，
// 递归解码后 replaceState 回正确路径，避免 URL 无限嵌套
export function resolveSpaRedirect() {
  const params = new URLSearchParams(window.location.search)
  const spa = params.get('_spa')
  if (!spa) return
  // 递归解包 _spa= 参数。上限 64：404 段表漏段的年代曾产生过 30 多层嵌套的脏链
  // （收藏夹/分享出去的 URL），20 层解不完会留下残渣；64 足够余量且仍防失控。
  let path = spa
  for (let i = 0; i < 64; i++) {
    // _spa 后面的 = 也可能被再编码成 %3D（多层重定向链里出现过），一并匹配
    const m = path.match(/_spa(?:=|%3d)([^&]+)/i)
    if (!m) break
    path = decodeURIComponent(m[1])
  }
  // 确保是绝对路径
  if (!path.startsWith('/')) path = '/' + path
  window.history.replaceState(null, '', path)
}

// 站内一级路由段。与 public/404.html 的 detectRoot 是同一份判据，改一处必须改另一处。
// 漏段的下场：/discover/tv 曾因缺 'discover' 让 getBasePath 把 'tv' 当仓库前缀，
// BASE_PATH 冻结成 /discover/，页内所有链接都被带上这个前缀（404 → 循环）。
const ROUTE_SEGMENTS = new Set(['movie', 'tv', 'person', 'genre', 'discover', 'library'])

// 运行时推导站点根路径。不能直接用 import.meta.env.BASE_URL：它是构建期写死的
// （'/' 或 '/<repo>/'），而这里要在运行时同时应付两种布局。
// （曾据此以为「生产构建用相对 base './'」，那是**错的** —— 相对 base 会让深链白屏，
// 见 vite.config.js 的 base 与 deploy-pages.yml 的 BASE_PATH 两处注释。）
// 深链 /movie/...、/tv/... 或 /<repo>/movie/... 都能反推出根；根路径通常以 / 结尾。
//
// 必须按**路径分段**找第一个路由段，不能用 /(movie|tv)\// 这类子串匹配：
//   /<repo>/person/123-tom-hanks   → 子串法返回 /<repo>/person/（错）
//   /<repo>/genre/movie/18-action  → 子串法返回 /<repo>/genre/（错，先命中 genre 里的 movie）
// BASE_PATH 是模块求值期冻结的常量，算错一次之后每个链接都是 /<repo>/person/movie/123 这种垃圾。
export function getBasePath() {
  const segs = window.location.pathname.split('/')
  // segs[0] 恒为空串，从 1 开始；命中第一个路由段就截断到它之前
  for (let i = 1; i < segs.length; i++) {
    if (ROUTE_SEGMENTS.has(segs[i])) return i === 1 ? '/' : '/' + segs.slice(1, i).join('/') + '/'
  }
  // 没有任何路由段（根路径、或已带尾斜杠的仓库根）：沿用原来的兜底
  const p = window.location.pathname
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1)
}

export const BASE_PATH = getBasePath()

// 站点根绝对地址。用作 Supabase 邮件确认 / 找回密码的回调地址：
// 根路径在 Pages 上是真实存在的文件，回调不必穿过 404.html 的 _spa 编码。
export function siteRoot() {
  return window.location.origin + BASE_PATH
}
