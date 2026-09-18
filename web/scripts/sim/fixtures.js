// 反例实验共用的常量。条数取 12 是为了**真的越过熔断阈值**（BULK_DELETE_MIN = 10）——
// 3 条的话熔断根本不触发，实验会得出「没拦住」的错误结论。
export const IDS = Array.from({ length: 12 }, (_, i) => String(100 + i))
export const DAY = 86400000
export const NOW = Date.now()
export const cloudPayload = (id) => ({
  kind: 'movie',
  id: Number(id),
  title: `云端收藏 ${id}`,
  addedAt: NOW - 400 * DAY,
})
