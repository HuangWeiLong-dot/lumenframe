// 带扩展名：这两个模块是纯函数，要能被 node 直接跑（web/scripts/check-sync.mjs），
// 而 node 的 ESM 解析不做扩展名补全（Vite 会）。
import { canon } from './projection.js'

// 本地状态 = 当前投影 + 同步元数据（时间戳与墓碑）拼出来的。
//
//   projected: { [listKey]: payload }        当前 store 里的活条目
//   meta:      { [listKey]: { ts, deleted? } } 由 recorder 在 store 变化的当下记录
//
// 只有 meta 记了墓碑、而投影里已经没有的键才当删除。
// 反过来「meta 说还活着、投影里却没有」的情况（典型：用户手动清了 localStorage）
// 当作**不存在**而不是删除——这样清缓存 = 从云端完整恢复，而不是把云端也一起清掉。
export function buildLocalState(projected, meta) {
  const out = {}
  for (const key of new Set([...Object.keys(projected), ...Object.keys(meta)])) {
    if (key in projected) {
      // ts 未知时取 0：意味着「年龄不详」，输给任何一条远端记录（诚实规则）
      out[key] = { ts: meta[key]?.ts ?? 0, payload: projected[key] }
    } else if (meta[key]?.deleted) {
      out[key] = { ts: meta[key].ts, deleted: true }
    }
  }
  return out
}

// 把「投影变了」翻译成同步元数据（时间戳 / 墓碑）。
//
//   prev / next: { [listKey]: payload }  前后两次投影
//   external:    这次变化是否来自 storage 事件触发的存储重读
//                （清站点数据、别的标签页清空、浏览器把存储抹掉），而不是本页的用户操作
//
// external 时**绝不记墓碑**。这是本文件里 buildLocalState 那条不变式的上游：既然
// 「meta 说活着、投影里却没有」要当作不存在（清缓存 = 从云端完整恢复），那么
// 「外部改写把投影抹空了」就更不能反过来记成「用户删了每一条」——记了就会把整库
// 删除当作权威推上云端：用户清一次站点数据，那台设备同步过的所有数据就全没了。
//
// vanished 供调用方判断「本地缓存被外部清空」，据此拉一轮把云端数据恢复回来。
export function recordChanges(prev, next, now, external) {
  const patch = {}
  let vanished = false
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
  for (const key of keys) {
    const a = prev?.[key]
    const b = next?.[key]
    if (b === undefined) {
      if (a === undefined) continue
      vanished = true
      if (external) continue                        // 外部改写：是缓存被清，不是删除
      patch[key] = { ts: now, deleted: true }
    } else if (a === undefined) {
      patch[key] = { ts: now }                      // 新增（或删除后重新加回，顺带清掉墓碑）
    } else if (canon(a) !== canon(b)) {
      patch[key] = { ts: now }
    }
  }
  return { patch, vanished }
}

// 落盘前的 meta：与磁盘上的副本逐键合并，谁新保留谁。
// 别的标签页可能刚记了更新的时间戳或墓碑，整对象覆盖会把它抹掉——典型后果是
// A 标签页删掉的条目，被 B 标签页的陈旧 meta 覆盖后复活。
//
// scope 不同才整体覆盖：那个 scope 属于另一个账号，它的墓碑本就不该带过来。
// scope === null（访客态）不走这条：访客期间记下的墓碑必须留到转正之后。
export function persistableMeta(disk, local) {
  if (disk && disk.scope != null && disk.scope !== local.scope) return local
  return { scope: local.scope, meta: applyMetaWriteBack(disk?.meta || {}, local.meta) }
}

// 并集合并，逐键 last-write-wins。两端各自独立执行必须得到同一个结果。
export function mergeStates(local, remote) {
  const out = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const li = local[key]
    const ri = remote[key]
    if (!ri) { out[key] = li; continue }   // 远端从没见过 -> 本地新增 / 本地墓碑
    if (!li) { out[key] = ri; continue }   // 本地没有   -> 远端新增 / 远端墓碑
    if (li.ts > ri.ts) { out[key] = li; continue }
    if (li.ts < ri.ts) { out[key] = ri; continue }
    // 时间戳相同：退化为内容比较（仍只依赖内容，保证收敛）。
    // 墓碑 payload 为 null，canon 后是 'null'，小于任何 '{"..."}' —— 即同秒冲突时活条目胜出，
    // 避免因时钟精度造成无意义的删除。
    out[key] = canon(li.payload) >= canon(ri.payload) ? li : ri
  }
  return out
}

// 账号作用域转换。决定这次同步要不要把 meta 整体丢弃。
//
// 只有**确实换到了另一个账号**才丢：上一个账号的墓碑不能拿去删新账号的数据。
// scope === null 表示「本机还没为任何账号同步过」——新装，或者登出后作为访客继续用，
// 这份 meta 必须保留并参与合并，否则访客期间删掉的条目会被云端数据复活。
export function scopeTransition(prevScope, userId) {
  return { reset: Boolean(prevScope) && prevScope !== userId, scope: userId }
}

// 推送期间 recorder 可能又往 meta 里记了新的时间戳或墓碑。
// 用合并结果整体覆盖会把它们抹掉——典型后果：推送途中删掉的条目，墓碑丢失，
// 下一轮 buildLocalState 把它当成「不存在」而忽略，云端那条活记录又被拉回来，
// 用户的删除静默失效。逐键写回，谁更新保留谁。
export function applyMetaWriteBack(metaMeta, merged) {
  const out = { ...metaMeta }
  for (const [key, item] of Object.entries(merged)) {
    const cur = out[key]
    if (cur && cur.ts >= item.ts) continue     // recorder 记的更晚，保留它
    out[key] = item.deleted ? { ts: item.ts, deleted: true } : { ts: item.ts }
  }
  return out
}

// 合并结果里哪些键需要推回云端。无变化就不推，避免每次同步都全量写一遍。
export function computeDirty(merged, remote) {
  const dirty = []
  for (const [key, m] of Object.entries(merged)) {
    const r = remote[key]
    if (!r) { dirty.push(key); continue }
    if (m.ts > r.ts) { dirty.push(key); continue }
    if (Boolean(m.deleted) !== Boolean(r.deleted)) { dirty.push(key); continue }
    if (!m.deleted && canon(m.payload) !== canon(r.payload)) dirty.push(key)
  }
  return dirty
}
