// 真跑一遍 sync/engine.js：把 src 下的同步层、store、auth 直接搬进 node，
// 用内存表冒充 Supabase，验证「访客收藏 → 登录」这个流程到底做了什么。
//
//   npm run sim       --prefix web        访客收藏 → 登录
//   npm run sim:wipe  --prefix web        四种危险状态各跑一遍
//
// 与 check-sync.mjs 的分工：那个测纯函数的合并分支，这个测**接线**——订阅顺序、
// 快照时机、recorder 有没有把访客的改动记成时间戳，纯函数测试都覆盖不到。
//
// 本文件必须是唯一的入口：拆成两个入口时 rollup 会抽共享 chunk，
// browser-env / preload 与 store 的求值顺序就不受控了。

import './browser-env.js'
import './preload.js'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sim, SIM_USER_ID } from './stub-supabase.js'
import { initSync, getSyncStatus } from '../../src/sync/engine.js'
import { initAuth, actions, getAuthState } from '../../src/auth/store.js'
import { getLibraryState, applyRemoteLibrary, applyRemoteNotes } from '../../src/hooks/useLibrary.js'
import { CASES, runWipeCase } from './wipe-cases.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mode = process.argv[2] || 'guest'

// 本地存储必须在 store 被 import 之前写好，而一个进程里只能有一份 store 状态
// → 每个 case 各起一个子进程
if (mode === 'wipe') {
  for (const c of CASES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `wipe:${c}`], { stdio: 'inherit' })
    if (r.status) process.exitCode = r.status
  }
  process.exit(process.exitCode ?? 0)
}

if (mode.startsWith('wipe:')) {
  await runWipeCase(mode.slice(5).toUpperCase())
  process.exit(process.exitCode ?? 0)
}

// ================= 访客收藏 → 登录 =================

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(`       ${e.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const row = (list, kind, id, payload, updatedAt) => ({
  user_id: SIM_USER_ID,
  list_name: list,
  kind,
  item_id: String(id),
  payload,
  updated_at: updatedAt,
  deleted_at: null,
})

// 云端既有数据（账号里原来就有的，来自另一台设备）
sim.seed([
  row('watched', 'movie', 100, { kind: 'movie', id: 100, title: 'Dune (2021)', year: 2021, addedAt: Date.parse('2025-12-01'), myRating: 9 }, '2026-09-10T00:00:00.000Z'),
  row('watched', 'tv', 200, { kind: 'tv', id: 200, title: 'Severance', addedAt: Date.parse('2025-12-02') }, '2026-02-01T00:00:00.000Z'),
  row('notes', 'movie', 100, { text: 'cloud note' }, '2026-03-01T00:00:00.000Z'),
])

async function settle(what) {
  const t0 = Date.now()
  for (;;) {
    await sleep(20)
    const st = getSyncStatus().state
    if (st === 'idle') return
    if (st === 'error') throw new Error(`${what} 同步失败：${getSyncStatus().error}`)
    if (Date.now() - t0 > 4000) throw new Error(`${what} 同步没有结束（state=${st}）`)
  }
}

console.log('场景：浏览器未登录 → 访客收藏 → 登录已有账号\n')

await initAuth()
initSync()
assert(getAuthState().user === null, '初始应为未登录')

// 访客收藏：这里用 applyRemoteLibrary / applyRemoteNotes 是因为它们就是 store 的 write()
// 通道，与 UI 里「加入观影库 / 写短评」走的是同一条 write() -> notify() -> recorder 路径。
// （hooks 的公开添加函数只在 React 组件里拿得到，node 里没有 renderer。）
// 注意 write() 是**整对象替换**，所以要照 addToWatched 的语义把新条目并进当前库。
const guestLib = getLibraryState().library
applyRemoteLibrary({
  ...guestLib,
  watched: [
    { kind: 'movie', id: 300, title: 'Sicario', year: 2015, addedAt: Date.now(), myRating: 0, ratings: null },
    ...guestLib.watched,
  ],
})
applyRemoteNotes({ 'movie:100': '本地写的短评', 'movie:300': '访客短评' })

assert(getLibraryState().library.watched.length === 2, `访客本机应有 2 部，实际 ${getLibraryState().library.watched.length}`)

await actions.signIn('sim@test', 'password')
await sleep(150)              // 等 store 的 onAuthStateChange -> setTimeout(handleSession)
await settle('登录后')
await sleep(1800)             // 让 recorder 的 1.5s 防抖那一轮也跑完
await settle('收尾')

const cloud = sim.all()
const live = sim.live()
const tomb = sim.tombstones()
const local = getLibraryState()
const ids = local.library.watched.map((m) => `${m.kind}:${m.id}`).sort()

console.log('\n云端现状：')
for (const r of cloud) {
  console.log(`  ${r.list_name.padEnd(10)} ${r.kind}:${r.item_id}  ${r.deleted_at ? '墓碑' : '活'}  ${JSON.stringify(r.payload).slice(0, 60)}`)
}
console.log(`本地片库：${ids.join(', ')}`)
console.log(`本地短评：${JSON.stringify(local.notes)}\n`)

// ---- 本地推上去 ----
check('访客收藏的条目被推上云端', () => {
  const r = live.find((x) => x.list_name === 'watched' && x.item_id === '300')
  assert(r, '云端没有 watched:movie:300')
  assert(r.payload.title === 'Sicario', `payload 不对：${JSON.stringify(r.payload)}`)
})

check('访客写的短评被推上云端', () => {
  const r = live.find((x) => x.list_name === 'notes' && x.item_id === '300')
  assert(r, '云端没有 notes:movie:300')
  assert(r.payload.text === '访客短评', `payload 不对：${JSON.stringify(r.payload)}`)
})

// ---- 云端不许被覆盖 ----
check('云端原有的条目一条都没被删（没有墓碑）', () => {
  assert(tomb.length === 0, `出现了 ${tomb.length} 条墓碑：${JSON.stringify(tomb.map((t) => `${t.list_name}:${t.item_id}`))}`)
  assert(live.length === 5, `云端应有 5 条活记录，实际 ${live.length}`)
})

check('云端原有的 watched 仍在且仍为活', () => {
  assert(live.some((r) => r.list_name === 'watched' && r.item_id === '200'), 'watched:tv:200 没了')
  assert(live.some((r) => r.list_name === 'notes' && r.item_id === '100'), 'notes:movie:100 没了')
})

check('本地陈旧副本没有把云端较新的版本压掉（远端较新者胜）', () => {
  const r = live.find((x) => x.list_name === 'watched' && x.item_id === '100')
  assert(r, 'watched:movie:100 没了')
  assert(r.payload.title === 'Dune (2021)', `云端被本地旧标题覆盖了：${r.payload.title}`)
})

// ---- 云端拉下来 ----
check('登录后本地能看到账号原有的条目（并集）', () => {
  assert(ids.length === 3, `本地应有 3 部，实际 ${ids.length}：${ids}`)
  assert(ids.includes('movie:100'), '缺 movie:100')
  assert(ids.includes('tv:200'), '缺 tv:200（这台设备上原本没有的条目）')
  assert(ids.includes('movie:300'), '缺 movie:300')
})

check('短评也合并了两端', () => {
  assert(local.notes['movie:100'] === 'cloud note', `movie:100 短评：${local.notes['movie:100']}`)
  assert(local.notes['movie:300'] === '访客短评', `movie:300 短评：${local.notes['movie:300']}`)
})

check('同步状态正常结束', () => {
  const st = getSyncStatus()
  assert(st.state === 'idle', `state=${st.state} error=${st.error}`)
  assert(st.lastSyncedAt, '没有 lastSyncedAt')
})

console.log(`\n${passed}/${passed + failures.length} 通过`)
if (failures.length) {
  console.log(`失败：${failures.join(' / ')}`)
  process.exitCode = 1
}
