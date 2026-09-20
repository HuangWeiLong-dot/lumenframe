import { resolveSpaRedirect, siteRoot } from './spaUrl'

// 构建期注入（见 web/.env.example；线上由 Cloudflare Pages 构建时注入，
// 变量配在 Pages 项目 → Settings → Environment variables，不走 GitHub）。
// 未配置时整个云端同步功能自隐藏：不出现账号入口、不发起任何请求、不加载 SDK——
// 与 FILMGRAB_BASE 为空时 Film Stills 区块自隐藏是同一条约定。
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
// 只允许 publishable（anon）key。service_role / secret key 绝不能进入前端。
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

let client = null
let loading = null

// 懒加载 + 幂等。刻意不做成模块级 createClient：
//   1) 未配置时 supabase-js 永不下载（guest 用户零成本）
//   2) App.jsx 的 resolveSpaRedirect() 是模块求值期的代码，在 import 之后才跑；
//      模块体里直接 createClient 会在 _spa 还原**之前**读 window.location，
//      而 SDK 只在构造时消费一次 URL —— 结果就是邮件回调的 session 静默建立失败。
//      懒加载保证构造发生在 URL 就位之后。
export function getSupabase() {
  if (!isSupabaseConfigured) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  if (loading) return loading

  // 幂等：_spa 已被还原时是空操作。兜住「有人在还原之前就调用了本函数」的情况
  resolveSpaRedirect()

  loading = import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        // PKCE 不把 token 放进 URL fragment。代价：code verifier 存在本机 localStorage，
        // 在**另一台设备**上点邮件确认链接会失败——但账号在服务端已确认，
        // 回登录页用密码即可进入（错误文案见 i18n 的 account.errLinkInvalid）。
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        // 与 lumenframe:* 命名空间一致，便于用户排查和「清空本站数据」
        storageKey: 'lumenframe:auth',
      },
    })
    return client
  })
  return loading
}

// 邮件确认 / 找回密码的回调地址：站点根，而不是当前深链。
// 根路径在 Pages 上是真实存在的文件，回调因此完全不必穿过 404.html 的 _spa 编码。
export function authRedirectUrl() {
  return siteRoot()
}
