// 给 node 装一个刚好够 engine / hooks / auth store 跑起来的最小浏览器环境。
//
// 必须在这些模块被求值**之前**装好：靠 ESM 静态导入的求值顺序保证——
// run.js 把本文件放在第一个 import。
// 不提供 navigator.locks：engine.ensureLeader 会退化成「总是 leader」（和 Safari 一样）。

class MemStorage {
  constructor() {
    this.map = new Map()
  }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { const s = String(k); return this.map.has(s) ? this.map.get(s) : null }
  setItem(k, v) { this.map.set(String(k), String(v)) }
  removeItem(k) { this.map.delete(String(k)) }
  clear() { this.map.clear() }
}

const domListeners = new Map()

export const memStorage = new MemStorage()
globalThis.localStorage = memStorage

globalThis.window = {
  location: { href: 'https://sim.test/', pathname: '/', search: '', hash: '' },
  history: { replaceState() {}, pushState() {} },
  addEventListener(type, fn) {
    if (!domListeners.has(type)) domListeners.set(type, new Set())
    domListeners.get(type).add(fn)
  },
  removeEventListener(type, fn) { domListeners.get(type)?.delete(fn) },
  dispatchEvent() { return true },
}

globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
}

// node 24 自己带一个只读的 navigator（没有 locks，正好是我们要的退化路径），改不动就留着
try { globalThis.navigator = {} } catch { /* 只读 getter：本身就没有 locks，无需覆盖 */ }
globalThis.self = globalThis
