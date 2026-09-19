// 全局图片加载队列：限制同时打向图片代理的请求数，避免代理被打满。
//
// 为什么不能取消限流（2026-09-19 回归）：
//   SmartImage 的 8s 超时是从「拿到槽位、真正开始加载」才起算的。一旦去掉槽位上限，
//   一屏几十张海报会在同一瞬间全部开始计时，而浏览器对单个源只有约 6 条并发连接，
//   排在后面的图还没被发出去，超时就已经到点 → 触发 _r= 重试 → 请求量再翻一倍。
//   于是本该慢慢加载完的图成片显示 "No poster"；服务端图片代理此时也要同时驻留
//   几十张原图 buffer，内存被打满后进程退出，后续图片请求经 Vite 代理回来就是 500。
//   槽位上限的作用是把「排队」放在计时开始之前，超时只对真正卡住的请求生效。
//
// 用法：acquireSlot().then(release => { /* 加载图片 */ release() })

const MAX_CONCURRENT = 8
let active = 0
const waiters = []

export function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve(makeReleaser())
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++
      resolve(makeReleaser())
    })
  })
}

// 释放必须幂等：调用方重复 release 会把 active 减穿，减穿之后 MAX_CONCURRENT 就形同虚设，
// 并发会重新失控 —— 而这正是这个模块要防的事。
function makeReleaser() {
  let released = false
  return function release() {
    if (released) return
    released = true
    releaseSlot()
  }
}

function releaseSlot() {
  active = Math.max(0, active - 1)
  if (waiters.length > 0 && active < MAX_CONCURRENT) {
    waiters.shift()()
  }
}

// 调试用：限流再次出问题时先看这里的 active / waiting
export function queueStats() {
  return { active, waiting: waiters.length }
}
