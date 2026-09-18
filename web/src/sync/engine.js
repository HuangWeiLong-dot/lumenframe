import { useSyncExternalStore } from 'react'
import { getSupabase, isSupabaseConfigured } from '../supabase'
import {
  subscribeLibrary, getLibraryState, applyRemoteLibrary, applyRemoteNotes, ratingStorageKey,
} from '../hooks/useLibrary'
import { subscribePinned, getPinnedState, applyRemotePinned } from '../hooks/usePinned'
import { subscribeAuth, getAuthState } from '../auth/store'
import { safeGetJSON, safeSet, safeSetJSON, getChangeOrigin } from '../storage'
import { project, toLocal, toRows, fromRows, canon, NOTES } from './projection.js'
import {
  buildLocalState, mergeStates, computeDirty, applyMetaWriteBack, scopeTransition,
  recordChanges, persistableMeta, deleteImpact, isBulkDelete, heldBackKeys, retryDelay,
} from './merge.js'

const META_KEY = 'lumenframe:sync:meta'
const DEBOUNCE_MS = 1500
const PAGE = 1000          // PostgREST 单次返回上限；不分页会静默截断大库
const PUSH_BATCH = 200
const FOCUS_PULL_MS = 60 * 1000

// 同步元数据：每个条目的本地修改时间；带 deleted 的即墓碑（本地状态的真值）。
// scope 记住这份数据属于哪个账号：换账号必须整体丢弃，
// 否则 A 的墓碑会参与 B 的合并，把 B 的条目删掉。
//
// 这里刻意**不**维护「已推送」集合：每轮同步都整库拉取，远端状态就是答案，
// 再存一份 pushed 只会多一个可能与现实不一致的副本。
let meta = { scope: null, meta: {} }
let prevProjection = null
let applyingRemote = false

let running = false
let pendingSync = false
let lastPullAt = 0

// 连续失败次数 + 待触发的重试定时器。
// 刻意用定时器而不是在 catch 里直接递归调 syncNow：那一刻 running 还是 true，
// 直接调只会置上 pendingSync、再由 finally 立刻重跑一次——永久性错误就变成死循环。
let failCount = 0
let retryTimer = null

// 上一轮是不是扣下了一批删除（= 状态停在 guard）。单独记一个布尔而不是读 statusState：
// 用户点「确认」时可能正好有一轮在跑（状态是 syncing），读状态会把这次确认吞掉。
let pendingGuard = false

// 「立即同步」在 guard 状态下点第二次 = 确认推送被扣下的那批删除。
// 只对一轮生效，且在一轮真的开始时就消费掉：中途失败也当作已经确认过，
// 下一轮重新熔断让用户再点一次，免得「点了确认但失败」之后某轮后台同步悄悄删掉。
let forceDeletes = false

// ---- 状态 store（供 UI 订阅）----

let statusState = {
  state: 'off', lastSyncedAt: null, error: null, blockedDeletes: 0,
  // attempt / retryAt 只在 error 状态下有意义：失败了几次、下次自动重试的时刻。
  // retryAt === null 且 state === 'error' = 自动重试已用完，只能用户手动点。
  attempt: 0, retryAt: null,
}
const statusListeners = new Set()

function setStatus(patch) {
  statusState = { ...statusState, ...patch }
  statusListeners.forEach((fn) => fn())
}

export function subscribeSyncStatus(fn) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

export function getSyncStatus() {
  return statusState
}

export function useSyncStatus() {
  useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
  return statusState
}

// ---- 本地状态读取 ----

function currentLocal() {
  const { library, notes } = getLibraryState()
  return { library, notes, pinned: getPinnedState() }
}

function loadMeta() {
  const raw = safeGetJSON(META_KEY, null)
  if (raw && typeof raw === 'object' && raw.meta) return { scope: raw.scope ?? null, meta: raw.meta }
  return { scope: null, meta: {} }
}

let persistTimer = null
function persistMeta() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistMetaNow()
  }, 400)
}

function persistMetaNow() {
  // 与磁盘上的副本逐键合并后再写：别的标签页可能刚记了更新的时间戳或墓碑，
  // 整对象覆盖会把它抹掉，于是 A 标签页删掉的条目被 B 的陈旧 meta 复活。
  meta = persistableMeta(loadMeta(), meta)
  safeSetJSON(META_KEY, meta)
}

// meta 存在 localStorage 里，是跨标签页共享的**同一份**；但内存里的副本各页一份，
// 只有本页自己记录时才更新。而 ensureLeader 只让一个标签页负责同步——本页可能正是那个
// 标签页，却拿着不含对方墓碑的陈旧副本去合并，把对方刚删掉的条目当成「远端还有」而复活。
// 所以每轮同步前先与磁盘合并一次（不做覆盖：本页可能有还在 400ms 防抖里的记录）。
function syncMetaFromDisk() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  persistMetaNow()
}

// 评分标量缓存与 watched[].myRating 是两份数据（详情页历史上读标量）。
// 远端合并改了 watched 之后必须同步刷新标量，否则详情页仍显示旧分。
function mirrorRatings(watched) {
  for (const m of Array.isArray(watched) ? watched : []) {
    if (m == null || m.id == null || !m.myRating) continue
    safeSet(ratingStorageKey(m.kind || 'movie', m.id), String(m.myRating))
  }
}

// ---- Recorder：把本地变化记成时间戳/墓碑 ----
//
// 登录与否都在跑。这不只是省事：首次登录时要判断「谁更新」，
// 登录那一刻才建时间戳就毫无意义了（全都等于 now）。
// 每次变化只做一次投影 diff，几百条的量级可以忽略。
//
// 关键约束：只有**本页用户操作**（store 的 write()）造成的消失才算删除。
// storage 事件触发的重读（别的标签页写入、清站点数据）是「本地缓存被外部改写」，
// 记成删除就等于把用户的清缓存动作变成整库删除并推上云端 —— 见 merge.recordChanges。

function record() {
  if (applyingRemote) return
  const next = project(currentLocal())

  if (prevProjection === null) {
    prevProjection = next
    return
  }

  const external = getChangeOrigin() === 'external'
  const { patch, vanished } = recordChanges(prevProjection, next, Date.now(), external)
  prevProjection = next

  if (Object.keys(patch).length) {
    Object.assign(meta.meta, patch)
    persistMeta()
    scheduleSync()
  } else if (external && vanished) {
    // 条目被本页以外的东西弄消失了（清站点数据、别的标签页 clear()、别的标签页删了条目）：
    // 一条墓碑都不记，改为拉一轮。两种情形都靠这一轮收敛——
    //   · 缓存被清空：拉到的是云端整库，落回本地 = 「清缓存 = 从云端完整恢复」；
    //   · 别的标签页删了条目：对方记的墓碑会随 syncMetaFromDisk 一起进来，
    //     本页据此把它推上云端（对方若不是 leader，它自己根本推不上去）。
    // 这里不必 persistMeta：没有墓碑要记，而 meta 里那些「活着但投影里没有」的键
    // 本来就会被 buildLocalState 当作不存在；下一轮同步结束时还会整体写回一次。
    scheduleSync()
  }
}

// 首次见到某个条目时用 addedAt 播种（而不是 now）：
// 否则首次登录时本地每一条都会「比云端新」，把对方设备上真正的修改全部压掉。
//
// 短评是唯一的例外，由 rescueUntimedNotes 打开：升级前的短评本地存的是裸字符串，
// 根本没有任何时间信息（见 useLibrary.normalizeNote），一律播成 0 就等于「首次登录必输」。
// 对**本机从未同步过任何账号**的设备（meta.scope == null）改播 now，把这批旧短评救回来。
// 代价是这台设备首次登录时它们会赢过云端同一条——一次性，且只影响这一台设备。
function seedMeta(projected, rescueUntimedNotes = false) {
  const now = Date.now()
  for (const [key, payload] of Object.entries(projected)) {
    if (key in meta.meta) continue
    if (rescueUntimedNotes && !payload?.addedAt && key.startsWith(`${NOTES}:`)) {
      meta.meta[key] = { ts: now }
    } else {
      meta.meta[key] = { ts: payload?.addedAt || 0 }
    }
  }
}

// ---- 网络 ----

async function pull(supabase, userId) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('library_items')
      .select('list_name,kind,item_id,payload,updated_at,deleted_at')
      .eq('user_id', userId)
      // 排序必须构成**全序**：只按 updated_at 排时，时间戳相同的行在分页之间
      // 次序不稳定，会漏读或重复读。补上主键三列即可（PK 唯一）。
      .order('updated_at', { ascending: true })
      .order('list_name', { ascending: true })
      .order('kind', { ascending: true })
      .order('item_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function push(supabase, userId, state, dirty) {
  const subset = {}
  for (const key of dirty) subset[key] = state[key]
  const rows = toRows(subset, userId)
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    const { error } = await supabase
      .from('library_items')
      .upsert(rows.slice(i, i + PUSH_BATCH), { onConflict: 'user_id,list_name,kind,item_id' })
    if (error) throw new Error(error.message)
  }
}

// ---- 同步循环 ----

async function syncNow() {
  const { user } = getAuthState()
  if (!isSupabaseConfigured || !user) return
  if (running) { pendingSync = true; return }
  if (!(await ensureLeader())) return

  running = true
  setStatus({ state: 'syncing', error: null })
  const forced = forceDeletes
  forceDeletes = false
  try {
    const supabase = await getSupabase()

    // 账号作用域：只有确实换到另一个账号才丢弃 meta（详见 scopeTransition 注释）
    const { reset, scope } = scopeTransition(meta.scope, user.id)
    if (reset) {
      meta = { scope, meta: {} }
      prevProjection = null
      clearRetry() // 换账号：上一个账号的失败退避不该拖累这个账号
    } else if (meta.scope !== scope) {
      meta.scope = scope
      persistMeta()
    }

    const rows = await pull(supabase, user.id)
    lastPullAt = Date.now()
    const remote = fromRows(rows)

    // 拉取期间别的标签页可能记了墓碑。先把磁盘上的 meta 合并回来再算合并结果，
    // 否则对方刚删掉的条目会被本页用「远端还有」的结论复活（见 syncMetaFromDisk）。
    syncMetaFromDisk()

    // ★ 所有本地快照都必须在 await **之后**重新取。
    // 网络往返期间用户完全可能又改了本地数据；拿 await 之前的快照算合并结果再整体写回，
    // 会把这段时间内的新增抹掉，更糟的是「新时间戳 + 旧内容」会被判成本地更新，
    // 于是把回退后的内容当成权威推上云端。
    const before = currentLocal()
    const projected = project(before)
    if (prevProjection === null) { prevProjection = projected; seedMeta(projected) }

    const merged = mergeStates(buildLocalState(projected, meta.meta), remote)
    const nextLocal = toLocal(merged, before)

    // 只在真的变了才写回：否则每次同步都会触发一轮无意义的重渲染
    if (canon(project(nextLocal)) !== canon(projected)) {
      applyingRemote = true
      try {
        applyRemoteLibrary(nextLocal.library)
        applyRemoteNotes(nextLocal.notes)
        applyRemotePinned(nextLocal.pinned)
        mirrorRatings(nextLocal.library.watched)
      } finally {
        applyingRemote = false
      }
      prevProjection = project(currentLocal())
    }

    const dirty = computeDirty(merged, remote)

    // 批量删除熔断：要删掉的「云端还活着」的条目超过阈值就先扣下（见 merge.deleteImpact）。
    // 新增/修改照推——被扣的只是删除，用户点一次「立即同步」就放行。
    let blocked = 0
    let toPush = dirty
    if (!forced && isBulkDelete(deleteImpact(merged, dirty, remote))) {
      const held = heldBackKeys(merged, dirty, remote)
      toPush = dirty.filter((key) => !held.has(key))
      blocked = held.size
    }
    if (toPush.length) await push(supabase, user.id, merged, toPush)

    // 同样地，推送期间 recorder 可能又记了新的时间戳/墓碑，整体赋值会覆盖掉
    meta.meta = applyMetaWriteBack(meta.meta, merged)
    persistMeta()
    // 扣下删除时状态停在 guard，而且本地的墓碑还在 meta 里——下一轮会再次触发熔断。
    // 这是刻意的：用户没确认之前它就该一直亮着。
    pendingGuard = blocked > 0
    clearRetry()
    setStatus({
      state: blocked ? 'guard' : 'idle',
      lastSyncedAt: Date.now(),
      error: null,
      blockedDeletes: blocked,
      attempt: 0,
      retryAt: null,
    })
  } catch (e) {
    failCount++
    // ⚠ 此刻 running 仍是 true：只能排定时器，绝不能直接 syncNow
    const delay = scheduleRetry()
    setStatus({
      state: 'error',
      error: e?.message || 'sync failed',
      attempt: failCount,
      retryAt: delay == null ? null : Date.now() + delay,
    })
  } finally {
    running = false
    if (pendingSync) { pendingSync = false; syncNow() }
  }
}

let debounceTimer = null
function scheduleSync() {
  const { user } = getAuthState()
  if (!isSupabaseConfigured || !user) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    syncNow()
  }, DEBOUNCE_MS)
}

// ---- 失败重试 ----

// 排下一次自动重试，返回等待毫秒数；null = 已经试满次数，不再自动重试
function scheduleRetry() {
  if (retryTimer) return null // 已排就不重排：连续失败沿用原定节奏，不累加
  const delay = retryDelay(failCount)
  if (delay == null) return null
  retryTimer = setTimeout(() => {
    retryTimer = null
    syncNow()
  }, delay)
  return delay
}

// 成功 / 登出 / 换账号 / 用户手动重试：撤掉定时器并把失败计数归零
function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  failCount = 0
}

// ---- 多标签页：只让一个标签页负责同步 ----
// 两个标签页同时读-合并-写是幂等的，但会白白多打一轮网络；storage 事件已经负责跨标签页同步数据。

let leaderPromise = null
function ensureLeader() {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return Promise.resolve(true)
  if (leaderPromise) return leaderPromise
  leaderPromise = new Promise((resolve) => {
    navigator.locks.request('lumenframe-sync', { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        leaderPromise = null    // 下轮再试：leader 标签页可能已经关了
        resolve(false)
        return undefined
      }
      resolve(true)
      return new Promise(() => {})   // 一直持有到本页关闭
    })
  })
  return leaderPromise
}

// ---- 生命周期 ----

let started = false

function onAuthChange() {
  const { user, ready } = getAuthState()
  if (!ready) return
  if (!user) {
    clearRetry() // 登出后不该再为上一个账号重试
    setStatus({ state: 'off', error: null, blockedDeletes: 0, attempt: 0, retryAt: null })
    return
  }
  syncNow()
}

function onFocus() {
  const { user } = getAuthState()
  if (!user || document.visibilityState === 'hidden') return
  if (Date.now() - lastPullAt < FOCUS_PULL_MS) return
  syncNow()
}

export function initSync() {
  if (started || !isSupabaseConfigured) return
  started = true

  meta = loadMeta()
  prevProjection = project(currentLocal())
  // meta.scope == null = 本机从未同步过任何账号 → 这次登录是「访客数据认领」，
  // 顺手把升级前就存在、没有时间戳的旧短评一起救回来（见 seedMeta）
  seedMeta(prevProjection, meta.scope == null)

  subscribeLibrary(record)
  subscribePinned(record)
  subscribeAuth(onAuthChange)

  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  window.addEventListener('online', () => syncNow())

  onAuthChange()
}

// 供 UI 的「立即同步」按钮使用。
// guard 状态下点它是**二次确认**：放行上一轮被扣下的那批删除（只对一轮生效）；
// error 状态下点它是**手动重试**：撤掉自动重试的定时器与计数，立刻再试一次。
export function requestSync() {
  if (pendingGuard) forceDeletes = true
  clearRetry()
  return syncNow()
}
