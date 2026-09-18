import { useSyncExternalStore } from 'react'
import { getSupabase, isSupabaseConfigured, authRedirectUrl } from '../supabase'

// 登录态 store。与 useLibrary / usePinned / i18n 同一套 module-level 骨架：
// 全仓库没有任何 createContext，而同步引擎也不是组件、需要在 React 之外读 session。
//
// 本模块**不** import 同步引擎；反向依赖由 sync/engine.js 订阅本 store 完成，
// 避免 auth <-> sync 循环。

let state = {
  ready: false,        // initAuth 是否已跑完（避免首屏闪一下未登录）
  session: null,
  user: null,
  modalOpen: false,
  mode: 'signin',      // signin | signup | forgot | recovery
  notice: null,        // i18n key：成功类提示（如「确认邮件已发出」）
  error: null,         // i18n key：错误提示
  pending: false,      // 请求进行中（按钮禁用）
}

const listeners = new Set()
let inited = false

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function subscribeAuth(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getAuthState() {
  return state
}

// 用户名是**显示名**，存在 auth.users.raw_user_meta_data 里（注册时随 data 一起写入）。
// 刻意不建 profiles 表：不保证唯一、不需要额外 RLS，也就不存在重名竞态。
// 以后若要做「按用户名搜人」，再迁到带唯一索引的表。
export const USERNAME_MAX = 32

export function usernameOf(user) {
  return String(user?.user_metadata?.username || '').trim()
}

export function useAuth() {
  useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
  return {
    ...state,
    isConfigured: isSupabaseConfigured,
    username: usernameOf(state.user),
    ...actions,
  }
}

// supabase 的 error.code -> i18n key
const ERROR_KEYS = {
  invalid_credentials: 'account.errInvalid',
  email_not_confirmed: 'account.errNotConfirmed',
  user_already_exists: 'account.errExists',
  email_exists: 'account.errExists',
  weak_password: 'account.errWeak',
  over_email_send_rate_limit: 'account.errRateLimit',
  over_request_rate_limit: 'account.errRateLimit',
  same_password: 'account.errSamePassword',
  otp_expired: 'account.errLinkInvalid',
  flow_state_not_found: 'account.errLinkInvalid',
  flow_state_expired: 'account.errLinkInvalid',
}

function mapError(e) {
  return ERROR_KEYS[e?.code] || 'account.errGeneric'
}

// 把 ?code= / ?error= / #error= 从地址栏清掉。
// supabase-js 并非在所有版本都清理，留一个已作废的 code 在地址栏既难看也容易误分享。
function clearAuthParams() {
  try {
    const url = new URL(window.location.href)
    let dirty = false
    for (const p of ['code', 'error', 'error_code', 'error_description', 'state']) {
      if (url.searchParams.has(p)) { url.searchParams.delete(p); dirty = true }
    }
    if (url.hash && /(access_token|error_code|error_description|refresh_token|type=recovery)/.test(url.hash)) {
      url.hash = ''
      dirty = true
    }
    if (dirty) {
      const qs = url.searchParams.toString()
      window.history.replaceState(null, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
    }
  } catch { /* ignore */ }
}

// 确认链接过期/已使用时，Supabase 会带着错误参数跳回来
function readUrlError() {
  try {
    const q = new URLSearchParams(window.location.search)
    const h = new URLSearchParams(String(window.location.hash).replace(/^#/, ''))
    const code = q.get('error_code') || h.get('error_code')
    const err = q.get('error') || h.get('error')
    if (code || err) {
      return ERROR_KEYS[code] || 'account.errLinkInvalid'
    }
  } catch { /* ignore */ }
  return null
}

function handleSession(session, event) {
  clearAuthParams()
  // 找回密码的链接必须落到「设置新密码」表单，绝不能静默把人登进去
  if (event === 'PASSWORD_RECOVERY') {
    set({ session, user: session?.user ?? null, modalOpen: true, mode: 'recovery', error: null, notice: null })
    return
  }
  set({ session, user: session?.user ?? null })
}

export async function initAuth() {
  if (inited) return
  inited = true
  if (!isSupabaseConfigured) {
    set({ ready: true })
    return
  }

  const supabase = await getSupabase()
  const urlError = readUrlError()
  if (urlError) set({ error: urlError, modalOpen: true, mode: 'signin' })

  supabase.auth.onAuthStateChange((event, session) => {
    // 绝不在回调里 await：该回调运行在 auth 锁内，await 会重入同一把锁而死锁
    setTimeout(() => handleSession(session, event), 0)
  })

  const { data } = await supabase.auth.getSession()
  handleSession(data?.session ?? null, 'INITIAL')
  set({ ready: true })
}

// ---- 动作 ----

async function run(fn) {
  set({ pending: true, error: null, notice: null })
  try {
    const supabase = await getSupabase()
    return await fn(supabase)
  } catch (e) {
    set({ error: mapError(e) })
    return null
  } finally {
    set({ pending: false })
  }
}

async function signIn(email, password) {
  const res = await run((sb) => sb.auth.signInWithPassword({ email, password }))
  if (!res) return
  if (res.error) { set({ error: mapError(res.error) }); return }
  set({ modalOpen: false, notice: null, error: null })
}

async function signUp(email, password, username) {
  const res = await run((sb) =>
    sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authRedirectUrl(),
        // 显示名随注册一起写进 user_metadata；邮箱确认开着时它也一并生效
        data: { username: String(username || '').trim() },
      },
    })
  )
  if (!res) return
  if (res.error) { set({ error: mapError(res.error) }); return }
  // 开了邮箱确认时不会立刻返回 session：这是正常路径，不是错误
  if (!res.data?.session) {
    set({ notice: 'account.checkEmail', error: null, mode: 'signin' })
    return
  }
  set({ modalOpen: false, notice: null, error: null })
}

// 修改/补填显示名。updateUser 会触发 USER_UPDATED 事件，
// onAuthStateChange 里重新 set user，头部与弹窗自动刷新。
async function updateUsername(username) {
  const clean = String(username || '').trim()
  if (!clean) { set({ error: 'account.usernameRequired', notice: null }); return }
  if (clean.length > USERNAME_MAX) { set({ error: 'account.usernameTooLong', notice: null }); return }
  const res = await run((sb) => sb.auth.updateUser({ data: { username: clean } }))
  if (!res) return
  if (res.error) { set({ error: mapError(res.error) }); return }
  set({ notice: 'account.saved', error: null })
}

async function sendReset(email) {
  const res = await run((sb) =>
    sb.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
  )
  if (!res) return
  if (res.error) { set({ error: mapError(res.error) }); return }
  set({ notice: 'account.resetSent', mode: 'signin' })
}

async function updatePassword(password) {
  const res = await run((sb) => sb.auth.updateUser({ password }))
  if (!res) return
  if (res.error) { set({ error: mapError(res.error) }); return }
  set({ modalOpen: false, mode: 'signin', notice: 'account.passwordUpdated' })
}

async function signOut() {
  // 只登出，绝不动任何 lumenframe:* 本地数据：
  // 登出后的访客模式必须与「从未登录过」字节一致
  await run((sb) => sb.auth.signOut())
  set({ modalOpen: false, notice: null, error: null })
}

export const actions = { signIn, signUp, sendReset, updatePassword, updateUsername, signOut }

export function openModal(mode = 'signin') {
  set({ modalOpen: true, mode, error: null, notice: null })
}

export function closeModal() {
  set({ modalOpen: false, error: null, notice: null })
}

export function setMode(mode) {
  set({ mode, error: null, notice: null })
}
