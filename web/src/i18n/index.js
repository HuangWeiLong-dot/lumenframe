import { useSyncExternalStore, useCallback } from 'react'
import en from './en'
import zh from './zh'

const STORAGE_KEY = 'lumenframe:lang'
const EVENT = 'lumenframe:lang-change'

const DICTS = { en, zh }

// 浏览器语言探测结果（zh / en）。首次访问弹出语言偏好选择时用它作为「推荐」项。
function suggestedLang() {
  return navigator.language?.startsWith('zh') ? 'zh' : 'en'
}

// 用户是否已经显式选择过语言（localStorage 可用且有合法值时才算）。
// 首次访问的语言偏好弹窗据此判断是否需要出现；localStorage 被禁用时返回 false。
function hasStoredLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'en' || saved === 'zh'
  } catch {
    return false
  }
}

// 首次访问按浏览器语言探测中/英，之后以用户选择为准
function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch { /* ignore */ }
  return suggestedLang()
}

let lang = detectLang()
const listeners = new Set()

function emit() {
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  window.addEventListener('storage', onStorage)
  window.addEventListener(EVENT, onStorage)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(EVENT, onStorage)
    }
  }
}

function onStorage() {
  emit()
}

function setLang(next) {
  if (next !== 'en' && next !== 'zh') return
  lang = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch { /* ignore */ }
  emit()
}

/**
 * 取翻译值：
 * - 支持 {name} 占位符替换
 * - 缺 key → 回退英文词典，仍缺则返回 key 本身并 console.warn
 */
function t(key, vars) {
  const dict = DICTS[lang] || en
  let val = dict[key]
  if (val == null) {
    // 回退英文
    val = en[key]
    if (val == null) {
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing key: ${key}`)
      }
      return key
    }
  }
  if (vars) {
    val = val.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`))
  }
  return val
}

// 日期 locale 随语言切换：zh 用 zh-CN，en 用 en-US
function dateLocale() {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

// 后端 API 语言参数：TMDB 等支持多语言的接口用（zh → zh-CN）。
// 非响应式：可直接在 api.js 里读取；组件里用 useI18n().apiLang 拿到响应式值。
function apiLang() {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

export { apiLang }

// 非响应式辅助（供首次访问的语言偏好弹窗使用，不需要订阅语言变化）
export { suggestedLang, hasStoredLang }

// 非响应式 t 函数：读取当前 lang 模块变量，不会触发组件重渲染
// 用于不希望因语言切换而 re-render 的组件（如 SmartImage）
export { t as tRaw }

export function useI18n() {
  useSyncExternalStore(subscribe, () => lang, () => lang)
  const setLangCb = useCallback((next) => setLang(next), [])
  const tCb = useCallback((key, vars) => t(key, vars), [])
  return { lang, setLang: setLangCb, t: tCb, dateLocale: dateLocale(), apiLang: apiLang() }
}
