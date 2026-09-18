// 反例实验：什么样的本地状态会让「登录」把片库删掉，以及熔断怎么拦住它。
// 四种状态，一个 case 一个进程（本地存储必须在 store 被 import 前写好）。
//
//   A 设备上留着事故期写下的墓碑，本地已无数据，云端是好的
//        → 登录时熔断扣下这批删除（guard），点「确认删除并同步」才真的删
//   B 云端是墓碑、本地还有数据
//        → 合并把云端墓碑当权威，登录即把本地删空。熔断管不着（这一轮根本没有「推」），
//          只能靠 SQL 善后清掉那些行
//   C 干净的访客数据 + 好的云端 → 双向并集，一条不丢
//   D 善后后的 A：把 sync:meta 删掉再登录 → 云端保住，本地从云端整库恢复

import { sim, SIM_USER_ID } from './stub-supabase.js'
import { initSync, getSyncStatus, requestSync } from '../../src/sync/engine.js'
import { initAuth, actions } from '../../src/auth/store.js'
import { getLibraryState } from '../../src/hooks/useLibrary.js'
import { IDS, DAY, NOW, cloudPayload } from './fixtures.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const CASES = ['A', 'B', 'C', 'D']

export async function runWipeCase(CASE) {
  // 云端：A / C / D 是好的活记录；B 是事故留下的墓碑（payload 已被写成 {}）
  sim.seed(IDS.map((id) => ({
    user_id: SIM_USER_ID,
    list_name: 'watched',
    kind: 'movie',
    item_id: id,
    payload: CASE === 'B' ? {} : cloudPayload(id),
    updated_at: new Date(NOW - (CASE === 'B' ? DAY : 400 * DAY)).toISOString(),
    deleted_at: CASE === 'B' ? new Date(NOW - DAY).toISOString() : null,
  })))

  const local = () => getLibraryState().library.watched.length
  console.log(`\n情景 ${CASE}：登录前 本地 ${local()} 部 / 云端 活 ${sim.live().length} 墓碑 ${sim.tombstones().length}`)

  await initAuth()
  initSync()
  await actions.signIn('sim@test', 'password')
  await sleep(150)
  await sleep(900)

  const st = getSyncStatus()
  console.log(`登录后 → 本地 ${local()} 部 / 云端 活 ${sim.live().length} 墓碑 ${sim.tombstones().length} / 状态 ${st.state}${st.blockedDeletes ? `（扣下 ${st.blockedDeletes} 条删除）` : ''}`)

  // A 的第二步：点「立即同步」= 二次确认，放行被扣下的删除
  let confirmed = false
  if (CASE === 'A') {
    confirmed = st.state === 'guard'
    await requestSync()
    await sleep(900)
    console.log(`点「确认删除并同步」后 → 云端 活 ${sim.live().length} 墓碑 ${sim.tombstones().length} / 状态 ${getSyncStatus().state}`)
  }

  const live = sim.live().length
  const tomb = sim.tombstones().length
  const verdict = {
    A: !(confirmed && live === 0 && tomb === IDS.length) &&
       `✗ 预期：先熔断扣下 ${IDS.length} 条删除、确认后才真的删`,
    B: local() !== 0 && `✗ 预期：云端墓碑把本地删空（熔断拦不住这个方向，要靠 SQL 善后）`,
    C: !(live === IDS.length + 1 && local() === IDS.length + 1) && `✗ 预期：双向并集`,
    D: !(live === IDS.length && local() === IDS.length) && `✗ 预期：云端保住，本地整库恢复`,
  }[CASE]

  if (verdict) console.log(`  ${verdict}`)
  else console.log(`  ✓ ${{
    A: `熔断拦住了整库删除，确认后才真的删掉 ${IDS.length} 条`,
    B: '本地被云端墓碑删空（复现：这就是必须做 SQL 善后的原因）',
    C: '双向并集：访客那条上去了，云端全部下来了',
    D: '云端保住，本地从云端整库恢复',
  }[CASE]}`)
  console.log(`同步状态：${getSyncStatus().state}${getSyncStatus().error ? ' / ' + getSyncStatus().error : ''}`)
}
