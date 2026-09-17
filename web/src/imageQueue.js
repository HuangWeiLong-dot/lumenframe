// 全局图片加载队列：限制并发请求数，避免 API 代理被打满
// 用法：acquireSlot().then(release => { /* 加载图片 */ release() })

const MAX_CONCURRENT = 8
let active = 0
const waiters = []

export function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve(() => releaseSlot())
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++
      resolve(() => releaseSlot())
    })
  })
}

function releaseSlot() {
  active = Math.max(0, active - 1)
  if (waiters.length > 0 && active < MAX_CONCURRENT) {
    const next = waiters.shift()
    next()
  }
}

// 调试用
export function queueStats() {
  return { active, waiting: waiters.length }
}
