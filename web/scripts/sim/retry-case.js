// 场景：本机有访客数据 → 登录 → **第一次上传失败** → 引擎自己退避重试
//
//   npm run sim:retry --prefix web
//
// 为什么必须单独测接线：retryDelay 是纯函数（check-sync.mjs 覆盖），
// 但「失败后有没有真的排定时器」「退避期间会不会打出一串请求」只有真跑引擎才知道。
// 后者尤其关键——在 catch 里直接递归调 syncNow 是个很容易犯的错：
// 那一刻 running 还是 true，递归调用只会置上 pendingSync，再由 finally 立刻重跑，
// 于是永久性错误变成死循环、把上游打爆。本文件里 `sim.upserts()` 的断言就是防这个的。

import { sim } from './stub-supabase.js'
import { initSync, getSyncStatus } from '../../src/sync/engine.js'
import { initAuth, actions } from '../../src/auth/store.js'
import { getLibraryState } from '../../src/hooks/useLibrary.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// 必须是导出的函数、不能是模块顶层代码：run.js 会无条件 import 本文件，
// 顶层副作用会在 guest / wipe 场景里一起跑掉（把假云端清空、把引擎提前启动）。
export async function runRetryCase() {
  console.log('场景：本地有访客数据 → 登录 → 首次上传失败 → 自动退避重试\n')

  sim.seed([]) // 云端是空的：这一轮的全部内容都靠「本地推上去」

  await initAuth()
  initSync()

  const localCount = getLibraryState().library.watched.length
  assert(localCount > 0, 'preload 应该留下了一条访客数据')

  // 让第一次 push 失败
  sim.failNextUpserts(1)

  await actions.signIn('sim@retry', 'password')
  await sleep(600) // 等 onAuthStateChange -> handleSession -> syncNow 跑完这一轮

  check('首次上传失败后状态是 error，并记下了失败次数与下次重试时刻', () => {
    const st = getSyncStatus()
    assert(st.state === 'error', `state=${st.state}`)
    assert(st.attempt === 1, `attempt=${st.attempt}（应为 1）`)
    assert(typeof st.retryAt === 'number' && st.retryAt > Date.now() - 1000, `retryAt=${st.retryAt}`)
  })

  check('失败时云端仍是空的（没有半推上去的东西）', () => {
    assert(sim.live().length === 0, `云端有 ${sim.live().length} 行`)
  })

  // ---- 退避期间不许再打请求 ----
  // 第一条退避是 3s。这里等 2s，期间如果引擎在 catch 里递归重跑（或在 finally 里立刻重跑），
  // upsertCalls 早就涨上去了。
  await sleep(2000)
  check('退避期间没有反复重试（catch 里没有递归 syncNow）', () => {
    assert(sim.upserts() === 1, `退避 2s 内 upsert 被调了 ${sim.upserts()} 次，应为 1 次`)
    assert(getSyncStatus().state === 'error', `state=${getSyncStatus().state}`)
  })

  // ---- 等退避走完，重试应当自动发生 ----
  await sleep(2500) // 累计 4.5s > 3s 的第一条退避
  for (let i = 0; i < 200 && getSyncStatus().state === 'syncing'; i++) await sleep(20)

  check('退避结束后自动重试，数据补传上去', () => {
    const st = getSyncStatus()
    assert(st.state === 'idle', `state=${st.state} error=${st.error}`)
    assert(st.attempt === 0 && st.retryAt === null, `成功后退避状态没清零：${JSON.stringify(st)}`)
    assert(sim.upserts() === 2, `upsert 次数 ${sim.upserts()}，应为 2（失败一次 + 重试一次）`)
  })

  check('重试真的把本地数据推上了云端（片库条目 + 短评）', () => {
    // 云端行数 = 本地片库条数 + 有文字的短评条数（preload 两条都留了）
    const noteCount = Object.values(getLibraryState().notes).filter((n) => n?.text).length
    assert(
      sim.live().length === localCount + noteCount,
      `云端 ${sim.live().length} 行，本地应为 ${localCount} 条片库 + ${noteCount} 条短评`
    )
    assert(
      sim.live().some((r) => r.list_name === 'watched' && r.item_id === '100'),
      '原本在本地的那条片库没被推上去'
    )
    assert(
      sim.live().some((r) => r.list_name === 'notes' && r.item_id === '100'),
      '原本在本地的短评没被推上去'
    )
  })

  console.log(`\n${passed}/${passed + failures.length} 通过`)
  if (failures.length) {
    console.log(`失败：${failures.join(' / ')}`)
    process.exitCode = 1
  }
}
