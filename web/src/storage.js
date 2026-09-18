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

// 最近一次 store 通知的来源：
//   'local'    —— 本页调用了 write()，即用户操作
//   'external' —— storage 事件触发的重读，即存储被本页以外的东西改写了
//               （清站点数据、别的标签页清空、浏览器策略把存储抹掉）
//
// 同步层的录制器必须区分这两者：条目「消失」在用户手里是删除，在外部改写里是
// 本地缓存被清空。两者都记成删除，用户清一次站点数据就会把云端整库删掉。
// 见 sync/merge.js 的 recordChanges。
let changeOrigin = 'local'

export function setChangeOrigin(origin) {
  changeOrigin = origin
}

export function getChangeOrigin() {
  return changeOrigin
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
