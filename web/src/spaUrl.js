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
  // 递归解包 _spa= 参数（最多 20 层）
  let path = spa
  for (let i = 0; i < 20; i++) {
    const m = path.match(/_spa=([^&]+)/)
    if (!m) break
    path = decodeURIComponent(m[1])
  }
  // 确保是绝对路径
  if (!path.startsWith('/')) path = '/' + path
  window.history.replaceState(null, '', path)
}

// 运行时推导站点根路径（生产构建为相对 base './'，不能直接用 import.meta.env.BASE_URL）：
// 深链 /movie/...、/tv/... 或 /<repo>/movie/... 都能反推出根；根路径通常以 / 结尾
export function getBasePath() {
  const p = window.location.pathname
  const m = p.match(/\/(movie|tv)\//)
  if (m) return p.slice(0, m.index + 1)
  if (p.endsWith('/')) return p
  return p.slice(0, p.lastIndexOf('/') + 1)
}

export const BASE_PATH = getBasePath()

// 站点根绝对地址。用作 Supabase 邮件确认 / 找回密码的回调地址：
// 根路径在 Pages 上是真实存在的文件，回调不必穿过 404.html 的 _spa 编码。
export function siteRoot() {
  return window.location.origin + BASE_PATH
}
