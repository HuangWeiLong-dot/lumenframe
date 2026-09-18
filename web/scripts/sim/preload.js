// 「这个浏览器在本次打开之前就有的东西」——必须在本文件被求值时就写好：
// useLibrary / usePinned 的 module-level cache 是 import 期读一次的，
// 之后再写 localStorage 对内存里的 store 已经没有影响了。
//
// run.js 把它排在 browser-env.js 之后、store 之前，靠的就是 ESM 静态导入的求值顺序。
// 所以整个 sim 只有一个入口文件——拆成两个入口时 rollup 会抽出共享 chunk，
// 求值顺序就不受控了（实测：preload 变成了空操作）。

import { IDS, DAY, NOW, cloudPayload } from './fixtures.js'

const mode = process.argv[2] || 'guest'
const CASE = mode.startsWith('wipe:') ? mode.slice(5).toUpperCase() : null

const setLib = (watched) =>
  localStorage.setItem('lumenframe:library', JSON.stringify({ watched, watchlater: [], likes: [] }))

localStorage.setItem('lumenframe:notes', '{}')

if (CASE) {
  // ---- 反例实验的四种状态 ----
  if (CASE === 'B') {
    // 本地还有数据，云端是墓碑（事故后没做 SQL 清理）
    setLib(IDS.map((id) => ({ ...cloudPayload(id) })))
  } else if (CASE === 'C') {
    // 对照组：干净的访客数据
    setLib([{ kind: 'movie', id: 900, title: '访客新加的', addedAt: NOW }])
  } else {
    // A / D：清空过的那台设备，本地片库为空
    setLib([])
    if (CASE === 'A') {
      // A 留着那份有毒的 meta（旧代码把「清站点数据」录成了整库删除）
      localStorage.setItem('lumenframe:sync:meta', JSON.stringify({
        scope: 'user-A',
        meta: Object.fromEntries(IDS.map((id) => [`watched:movie:${id}`, { ts: NOW - DAY, deleted: true }])),
      }))
    }
    // D 是照恢复步骤把 sync:meta 删掉之后再打开
  }
} else {
  // ---- 访客场景 ----
  // 访客在更早的一次会话里收藏的：addedAt 很老，meta 里没有时间戳
  // → 首次同步靠 seedMeta 拿 addedAt 播种（正是「首次播种用 addedAt」那条路径）
  setLib([{ kind: 'movie', id: 100, title: 'Dune（本地旧副本）', year: 2021, addedAt: NOW - 48 * DAY, myRating: 7 }])
  // 短评没有 addedAt：播种成 0 = 年龄不详，输给任何一条远端记录
  localStorage.setItem('lumenframe:notes', JSON.stringify({ 'movie:100': '本地写的短评' }))
}
