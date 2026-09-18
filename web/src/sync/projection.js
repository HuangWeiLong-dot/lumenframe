// 本地 localStorage 形态 <-> 云端行形态 的纯函数映射。
// 不碰 localStorage、不发请求，因此可以用 node 直接跑（见 web/scripts/check-sync.mjs）。

// 列表名（对应 library_items.list_name 的 check 约束）
export const WATCHED = 'watched'
export const WATCHLATER = 'watchlater'
export const LIKES = 'likes'
export const NOTES = 'notes'
export const PINNED = 'pinned'

// 全局条目键：`${list}:${kind}:${id}`。
// 注意与本地两个既有的键函数区分开——useLibrary.entryKey 是 `kind:id`、
// likes 用的 likeKey 是 `type:id`，它们只在「单个列表内部」唯一。
export const listKey = (list, kind, id) => `${list}:${kind}:${id}`

const reviveId = (s) => (/^-?\d+$/.test(String(s)) ? Number(s) : String(s))

// 稳定序列化：键排序后递归输出，用于「内容是否变化」的比较。
// 直接用 JSON.stringify 会受键顺序影响，同一个对象经过不同路径构造会产生不同字符串。
export function canon(v) {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
}

// 计分缓存（IMDb / RT / Metacritic / Popcornmeter）是可随时重新抓取的第三方数据，
// 必须排除在同步投影之外。否则 loadRatings（每次打开详情页）与 refreshAllRatings
// （批量刷新）都会重写条目、被变更检测当成用户编辑，把整个片库推一遍。
function stripRatings(entry) {
  const { ratings, ...rest } = entry
  return rest
}

function watchedPayload(entry) {
  return stripRatings(entry)
}

function likePayload(like) {
  const { type, id, ...rest } = like
  return rest
}

// 本地三个 store -> { [listKey]: payload }
export function project({ library, notes, pinned }) {
  const out = {}
  const lib = library || {}

  for (const [list, arr] of [[WATCHED, lib.watched], [WATCHLATER, lib.watchlater]]) {
    for (const entry of Array.isArray(arr) ? arr : []) {
      if (entry == null || entry.id == null) continue
      const kind = entry.kind || 'movie'
      out[listKey(list, kind, entry.id)] = watchedPayload(entry)
    }
  }

  for (const like of Array.isArray(lib.likes) ? lib.likes : []) {
    if (like == null || like.id == null) continue
    // 必须用 like.type（movie|tv|genre|person），不是 like.kind：
    // genre 点赞的 kind 是它所属的 movie/tv，用 kind 会把同一类目的点赞全撞成一行
    const type = like.type || 'movie'
    out[listKey(LIKES, type, like.id)] = likePayload(like)
  }

  for (const [key, note] of Object.entries(notes || {})) {
    // 兼容两代形态：旧版是裸字符串 '好看'，新版是 { text, addedAt }（见 useLibrary.normalizeNote）
    const text = typeof note === 'string' ? note : note?.text
    if (!key || typeof text !== 'string') continue
    const sep = key.indexOf(':')
    if (sep < 0) continue
    const kind = key.slice(0, sep) || 'movie'
    const id = key.slice(sep + 1)
    if (!id) continue
    // addedAt 必须进投影：engine 的 seedMeta 靠 payload.addedAt 给「meta 里没记录过」的键
    // 播种时间戳，缺了它就永远播成 0 = 年龄不详，首次登录必输给云端同一条。
    // 旧版行没有这个字段，所以 0/缺失时**不写这个键**，保持载荷与旧版逐字节一致，
    // 免得给整份短评列表做一次无意义的重推。
    const payload = { text }
    if (note?.addedAt) payload.addedAt = note.addedAt
    out[listKey(NOTES, kind, id)] = payload
  }

  for (const pin of Array.isArray(pinned) ? pinned : []) {
    if (pin == null || pin.id == null) continue
    const kind = pin.kind || 'movie'
    out[listKey(PINNED, kind, pin.id)] = { ...pin, kind, id: pin.id }
  }

  return out
}

// { [listKey]: payload } -> 云端行数组
export function toRows(state, userId) {
  return Object.entries(state).map(([key, item]) => {
    const [list, kind, ...idParts] = key.split(':')
    return {
      user_id: userId,
      list_name: list,
      kind,
      item_id: idParts.join(':'),
      payload: item.deleted ? {} : item.payload ?? {},
      updated_at: new Date(item.ts).toISOString(),
      deleted_at: item.deleted ? new Date(item.ts).toISOString() : null,
    }
  })
}

// 云端行数组 -> { [listKey]: { ts, deleted, payload } }
export function fromRows(rows) {
  const out = {}
  for (const row of rows || []) {
    const key = listKey(row.list_name, row.kind, row.item_id)
    out[key] = {
      ts: Date.parse(row.updated_at) || 0,
      deleted: row.deleted_at != null,
      payload: row.payload ?? {},
    }
  }
  return out
}

// { [listKey]: {payload} } -> 可以直接喂给 applyRemote* 的三个本地结构。
// preserve 传入当前本地结构：watched/watchlater 条目要把远端 payload 合并到本地条目上，
// 否则被排除出投影的 ratings 会在合并后被抹掉。
export function toLocal(state, current) {
  const watched = []
  const watchlater = []
  const likes = []
  const notes = {}
  const pinned = []

  const findLocal = (list, kind, id) => {
    const arr = list === WATCHED ? current?.library?.watched : current?.library?.watchlater
    return (Array.isArray(arr) ? arr : []).find(
      (m) => (m.kind || 'movie') === kind && String(m.id) === String(id)
    )
  }

  for (const [key, item] of Object.entries(state)) {
    if (item.deleted) continue
    const [list, kind, ...idParts] = key.split(':')
    const rawId = idParts.join(':')

    if (list === WATCHED || list === WATCHLATER) {
      const merged = { ...findLocal(list, kind, rawId), ...item.payload, kind, id: reviveId(rawId) }
      ;(list === WATCHED ? watched : watchlater).push(merged)
    } else if (list === LIKES) {
      likes.push({ type: kind, id: reviveId(rawId), ...item.payload })
    } else if (list === NOTES) {
      const noteKey = `${kind}:${rawId}`
      // addedAt 要从合并结果带回来：否则每轮都会判定「投影变了」，短评 store 被反复重写。
      // 云端载荷没有（旧版客户端推上去的行）就沿用本机已有的值，都没有则 0 = 年龄不详。
      const prev = current?.notes?.[noteKey]
      const addedAt =
        item.payload?.addedAt || (prev && typeof prev === 'object' ? prev.addedAt : 0) || 0
      notes[noteKey] = { text: item.payload?.text ?? '', addedAt }
    } else if (list === PINNED) {
      pinned.push({ ...item.payload, kind, id: reviveId(rawId) })
    }
  }

  // 合并是按 listKey 求并集，不保留数组次序，所以要按 addedAt 显式恢复
  // 「新条目在前」。缺 addedAt 的旧数据排到最后。
  const byAddedDesc = (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  watched.sort(byAddedDesc)
  watchlater.sort(byAddedDesc)
  likes.sort(byAddedDesc)
  pinned.sort(byAddedDesc)

  return {
    library: { watched, watchlater, likes },
    notes,
    pinned,
  }
}
