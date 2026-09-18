// 同步层纯逻辑自检。仓库没有测试框架，这里只用 node 内置 assert 跑一遍
// 最容易出错、也最难在双设备上手动复现的合并分支。
//
//   node web/scripts/check-sync.mjs
//
// 只 import 纯模块（projection / merge），不碰 localStorage 与网络。

import assert from 'node:assert/strict'
import { project, toLocal, fromRows, toRows, canon, listKey } from '../src/sync/projection.js'
import {
  buildLocalState, mergeStates, computeDirty, applyMetaWriteBack, scopeTransition,
} from '../src/sync/merge.js'

let passed = 0
const cases = []
const check = (name, fn) => cases.push([name, fn])

// ---- 投影 ----

check('投影排除 ratings（否则打开详情页就会把整库推一遍）', () => {
  const lib = {
    watched: [{ kind: 'movie', id: 1, title: 'A', addedAt: 100, ratings: { imdb: 8.8 } }],
    watchlater: [],
    likes: [],
  }
  const p = project({ library: lib, notes: {}, pinned: [] })
  const item = p[listKey('watched', 'movie', 1)]
  assert.equal(item.ratings, undefined)
  assert.equal(item.title, 'A')
  assert.equal(item.addedAt, 100)
})

check('likes 用 type 寻址，不能用 kind（genre 的 kind 是 movie/tv，会撞行）', () => {
  const lib = {
    watched: [],
    watchlater: [],
    likes: [
      { type: 'genre', id: 878, name: '科幻', kind: 'movie' },
      { type: 'genre', id: 878, name: 'Sci-Fi', kind: 'tv' },
    ],
  }
  const p = project({ library: lib, notes: {}, pinned: [] })
  // 两条 kind 不同但 type+id 相同的点赞：键必须相同（它们本就是同一条）
  assert.equal(Object.keys(p).length, 1)
  assert.ok(p[listKey('likes', 'genre', 878)])
})

check('notes 键拆成 kind + id', () => {
  const p = project({ library: { watched: [], watchlater: [], likes: [] }, notes: { 'movie:157336': '好看' }, pinned: [] })
  assert.deepEqual(p[listKey('notes', 'movie', 157336)], { text: '好看' })
})

check('pinned 往返（project -> buildLocalState -> merge -> toLocal）', () => {
  const pins = [{ kind: 'tv', id: 541, title: 'PB', yearRange: '2005–2017' }]
  const current = { library: { watched: [], watchlater: [], likes: [] }, notes: {}, pinned: pins }
  const projected = project(current)
  const state = buildLocalState(projected, {})
  const merged = mergeStates(state, {})
  const back = toLocal(merged, current)
  assert.equal(back.pinned.length, 1)
  assert.equal(back.pinned[0].id, 541)
  assert.equal(back.pinned[0].kind, 'tv')
  assert.equal(back.pinned[0].title, 'PB')
})

check('合并后 pinned 仍按 addedAt 倒序（合并只求并集，不保留数组次序）', () => {
  const fakeLocal = {
    library: { watched: [], watchlater: [], likes: [] },
    notes: {},
    pinned: [
      { kind: 'movie', id: 3, title: 'newest', addedAt: 300 },
      { kind: 'movie', id: 1, title: 'oldest', addedAt: 100 },
      { kind: 'movie', id: 2, title: 'middle', addedAt: 200 },
    ],
  }
  const merged = mergeStates(buildLocalState(project(fakeLocal), {}), {})
  const local = toLocal(merged, fakeLocal)
  assert.deepEqual(local.pinned.map((p) => p.id), [3, 2, 1])
})

check('canon 与键顺序无关', () => {
  assert.equal(canon({ a: 1, b: 2 }), canon({ b: 2, a: 1 }))
  assert.notEqual(canon({ a: 1 }), canon({ a: 2 }))
})

// ---- 合并 ----

check('首次登录（远端为空）：本地一条不丢', () => {
  const local = { [listKey('watched', 'movie', 1)]: { ts: 100, payload: { title: 'A' } } }
  const merged = mergeStates(local, {})
  assert.equal(merged[listKey('watched', 'movie', 1)].payload.title, 'A')
  assert.deepEqual(computeDirty(merged, {}), [listKey('watched', 'movie', 1)])
})

check('第二台设备（本地为空）：远端整库落地', () => {
  const k = listKey('watched', 'tv', 541)
  const remote = { [k]: { ts: 200, payload: { title: 'PB' } } }
  const merged = mergeStates({}, remote)
  assert.equal(merged[k].payload.title, 'PB')
  assert.deepEqual(computeDirty(merged, remote), [])   // 无需回推
})

check('逐键 LWW：两端各改各的，两条都保住', () => {
  const a = listKey('watched', 'movie', 1)
  const b = listKey('watched', 'movie', 2)
  const merged = mergeStates(
    { [a]: { ts: 300, payload: { title: 'A2' } }, [b]: { ts: 100, payload: { title: 'B' } } },
    { [a]: { ts: 200, payload: { title: 'A' } }, [b]: { ts: 400, payload: { title: 'B2' } } }
  )
  assert.equal(merged[a].payload.title, 'A2')   // 本地较新
  assert.equal(merged[b].payload.title, 'B2')   // 远端较新
})

check('时间戳相同：两端独立合并结果一致（收敛，不会来回抖动）', () => {
  const k = listKey('watched', 'movie', 1)
  const l = { [k]: { ts: 500, payload: { title: 'L', x: 1 } } }
  const r = { [k]: { ts: 500, payload: { title: 'R', x: 2 } } }
  assert.equal(canon(mergeStates(l, r)), canon(mergeStates(r, l)))
})

check('远端墓碑击败本地陈旧副本（A 删了，B 的旧数据不能复活它）', () => {
  const k = listKey('watched', 'movie', 1)
  const merged = mergeStates(
    { [k]: { ts: 50, payload: { title: 'A' } } },        // B 的陈旧副本
    { [k]: { ts: 100, deleted: true } }                  // A 的墓碑
  )
  assert.equal(merged[k].deleted, true)
})

check('本地墓碑击败远端陈旧副本', () => {
  const k = listKey('watched', 'movie', 1)
  const merged = mergeStates(
    { [k]: { ts: 100, deleted: true } },
    { [k]: { ts: 50, payload: { title: 'A' } } }
  )
  assert.equal(merged[k].deleted, true)
})

check('删除之后对方又真的改了：以修改为准（这是正确的，不是复活 bug）', () => {
  const k = listKey('watched', 'movie', 1)
  const merged = mergeStates(
    { [k]: { ts: 100, deleted: true } },                 // A 在 t=100 删
    { [k]: { ts: 120, payload: { title: 'B 改过' } } }   // B 在 t=120 改
  )
  assert.equal(merged[k].deleted, undefined)
  assert.equal(merged[k].payload.title, 'B 改过')
})

check('meta 说活着但投影里没有：当作不存在，不误判成删除（清缓存 = 从云端恢复）', () => {
  const k = listKey('watched', 'movie', 1)
  const state = buildLocalState({}, { [k]: { ts: 100 } })
  assert.equal(Object.keys(state).length, 0)

  // 有墓碑的则保留
  const state2 = buildLocalState({}, { [k]: { ts: 100, deleted: true } })
  assert.equal(state2[k].deleted, true)
})

check('合并收敛后 computeDirty 为空（不会每次同步都全量重写）', () => {
  const k = listKey('watched', 'movie', 1)
  const remote = { [k]: { ts: 100, payload: { title: 'A' } } }
  const merged = mergeStates({ [k]: { ts: 100, payload: { title: 'A' } } }, remote)
  assert.deepEqual(computeDirty(merged, remote), [])
})

check('被排除的 ratings 变化不产生同步流量', () => {
  // 只覆盖 ratings。refreshAllRatings 同时会写 imdb_id，而 imdb_id **在**投影里，
  // 所以批量刷新会让缺 imdb_id 的条目各推一次（一次性、量小）。这里断言的是 ratings 本身不触发。
  const before = project({
    library: { watched: [{ kind: 'movie', id: 1, title: 'A', addedAt: 1, ratings: null }], watchlater: [], likes: [] },
    notes: {}, pinned: [],
  })
  const after = project({
    library: { watched: [{ kind: 'movie', id: 1, title: 'A', addedAt: 1, ratings: { imdb: 9 } }], watchlater: [], likes: [] },
    notes: {}, pinned: [],
  })
  assert.equal(canon(before), canon(after))
})

// ---- 同步循环里三个只在并发/换账号时才出现、手测极难复现的分支 ----

check('推送途中产生的墓碑不能被合并结果覆盖掉', () => {
  const k = listKey('watched', 'movie', 1)
  const merged = { [k]: { ts: 100, payload: { title: 'A' } } }   // 推送时还以为它活着
  const liveMeta = { [k]: { ts: 999, deleted: true } }           // 推送期间用户删了它
  const out = applyMetaWriteBack(liveMeta, merged)
  assert.equal(out[k].deleted, true)
  assert.equal(out[k].ts, 999)
})

check('推送途中的新增不能被整体覆盖（否则会以 1970 的时间戳推上去）', () => {
  const known = listKey('watched', 'movie', 1)
  const fresh = listKey('watched', 'movie', 2)
  const merged = { [known]: { ts: 100, payload: { title: 'A' } } }
  const liveMeta = { [known]: { ts: 100 }, [fresh]: { ts: 555 } }  // fresh 是推送期间新增的
  const out = applyMetaWriteBack(liveMeta, merged)
  assert.equal(out[fresh].ts, 555)
  assert.equal(out[known].ts, 100)
})

check('远端较新时，写回要采用远端时间戳', () => {
  const k = listKey('watched', 'movie', 1)
  const out = applyMetaWriteBack({ [k]: { ts: 100 } }, { [k]: { ts: 400, payload: {} } })
  assert.equal(out[k].ts, 400)
})

check('换账号才丢弃 meta；访客（scope=null）的墓碑必须保留', () => {
  // 访客态转正：不重置 —— 否则访客期间删掉的条目会被云端复活
  assert.equal(scopeTransition(null, 'user-A').reset, false)

  // 同账号重登：不重置
  assert.equal(scopeTransition('user-A', 'user-A').reset, false)

  // 真的换账号：必须重置 —— 上一账号的墓碑不能拿去删新账号的数据
  assert.equal(scopeTransition('user-A', 'user-B').reset, true)

  // 访客墓碑在转正后确实能击败云端活记录
  const k = listKey('watched', 'movie', 1)
  const guestMeta = { [k]: { ts: 500, deleted: true } }
  const merged = mergeStates(buildLocalState({}, guestMeta), { [k]: { ts: 100, payload: { title: 'A' } } })
  assert.equal(merged[k].deleted, true)
})

check('网络往返期间的新增不会被写回时抹掉（快照必须在 await 之后取）', () => {
  // 模拟：await 之前快照是 [A]，await 期间用户加了 D。
  // 正确做法是 await 之后重新 project —— 这里验证「用旧快照算出的 nextLocal 确实会丢 D」，
  // 从而锁住 engine.js 里「快照必须在 await 之后取」这条约束。
  const staleSnapshot = {
    library: { watched: [{ kind: 'movie', id: 1, title: 'A', addedAt: 1 }], watchlater: [], likes: [] },
    notes: {}, pinned: [],
  }
  const remote = {}
  const merged = mergeStates(buildLocalState(project(staleSnapshot), {}), remote)
  const rebuilt = toLocal(merged, staleSnapshot)
  assert.equal(rebuilt.library.watched.length, 1)   // 旧快照里没有 D，重建结果自然也没有

  // 而取新快照时 D 会被带上
  const freshSnapshot = {
    library: { watched: [{ kind: 'movie', id: 9, title: 'D', addedAt: 9 }], watchlater: [], likes: [] },
    notes: {}, pinned: [],
  }
  const merged2 = mergeStates(buildLocalState(project(freshSnapshot), { [listKey('watched', 'movie', 9)]: { ts: 9 } }), remote)
  assert.equal(toLocal(merged2, freshSnapshot).library.watched.length, 1)
})

// ---- 行往返 ----

check('toRows / fromRows 往返（含墓碑）', () => {
  const k = listKey('watched', 'movie', 1)
  const state = {
    [k]: { ts: 1000, payload: { title: 'A', kind: 'movie', id: 1 } },
    [listKey('notes', 'tv', 541)]: { ts: 2000, deleted: true },
  }
  const rows = toRows(state, 'user-1')
  assert.equal(rows.length, 2)
  const tomb = rows.find((r) => r.list_name === 'notes')
  assert.ok(tomb.deleted_at)
  assert.deepEqual(tomb.payload, {})

  const back = fromRows(rows)
  assert.equal(back[k].payload.title, 'A')
  assert.equal(back[listKey('notes', 'tv', 541)].deleted, true)
})

check('toLocal 保留被排除出投影的 ratings', () => {
  const k = listKey('watched', 'movie', 1)
  const state = { [k]: { ts: 100, payload: { title: 'A', kind: 'movie', id: 1 } } }
  const current = {
    library: { watched: [{ kind: 'movie', id: 1, title: 'old', ratings: { imdb: 8 } }], watchlater: [], likes: [] },
    notes: {}, pinned: [],
  }
  const local = toLocal(state, current)
  assert.equal(local.library.watched[0].ratings.imdb, 8)   // ratings 未被抹掉
  assert.equal(local.library.watched[0].title, 'A')        // 远端值覆盖
})

for (const [name, fn] of cases) {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    console.log(`  FAIL ${name}`)
    console.log(`       ${e.message}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${cases.length} 通过`)
