// 空闲调度。用于把「不影响首屏」的工作（加载 supabase SDK、建背景墙海报图）
// 推迟到首屏渲染之后，别和 LCP 抢带宽。
//
// requestIdleCallback 并非到处都有：Safari 15.4 之前没有，Node（web/scripts/sim
// 里跑真实的 sync engine）也没有。缺失时用 setTimeout 兜底 —— 语义差别只是不做空闲调度，
// 仍然在下一个宏任务执行，对这两处调用方都够用。
//
// 返回取消函数（而非 handle），调用方不必关心底层用的是哪套 API。
export function onIdle(fn, timeout = 2000) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 1)
  return () => clearTimeout(id)
}
