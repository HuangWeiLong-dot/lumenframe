// localStorage 可能被浏览器策略/隐私模式禁用，也可能被写满：
// 读写一律走安全包装，避免「加入观影库 / 评分 / 短评」等交互抛错崩掉整页。
//
// 注意 safeGetJSON 的 fallback 语义：调用方若依赖「每次调用返回新对象」
// （useSyncExternalStore 靠引用变化触发重渲染），fallback 必须传 null 再自行兜底，
// 不要传共享的字面量对象，否则快照引用不变、组件不会刷新。

export function safeGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch { /* ignore */ }
}

export function safeGetJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function safeSetJSON(key, value) {
  safeSet(key, JSON.stringify(value))
}

export function safeRemove(key) {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}
