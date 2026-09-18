# scripts/sim —— 同步层在 node 里的真机实验

把 `src/sync/engine.js` 连同一整套 store / auth 原样搬进 node 跑，只把
`src/supabase.js` 换成一个内存假客户端（见 `vite.sim.config.js` 的别名插件），
断言直接读那张内存表。react 一起打进产物，不依赖浏览器的任何东西。

和 `scripts/check-sync.mjs` 的分工：那个测**纯函数**的合并分支（projection / merge），
这里测**接线**——`initSync` 的订阅顺序、`record()` 有没有在正确的时机记下时间戳、
快照是不是在 await 之后取的、登录时到底推了什么上去。这些纯函数测试覆盖不到。

```bash
npm run sim       --prefix web    # 访客收藏 → 登录（8 项断言）
npm run sim:wipe  --prefix web    # 四种危险状态各跑一遍
```

## 一条必须遵守的约定

`run.js` 是**唯一**入口，`browser-env.js` 与 `preload.js` 必须排在 store 之前求值——
store 的 module-level cache 是 import 期读一次 localStorage 的。靠的是 ESM 静态导入的
求值顺序，所以：

- 不要拆成两个入口：rollup 会抽共享 chunk，求值顺序立刻失控（实测：preload 变成空操作）
- 别名插件返回的路径必须用正斜杠：rollup 用 id 字符串判重，Windows 反斜杠会让同一个
  文件变成两个模块，于是「假云端」有两份内存表（实测：查出来 0 行）

## 实测到的行为（2026-09-18）

| 情景 | 状态 | 结果 |
| --- | --- | --- |
| C | 访客收藏 + 云端有数据 | **双向并集**：访客那条推上去，云端全部拉下来，双方都不丢 |
| A | 设备上留着事故期写下的墓碑（`sync:meta`），本地已空 | 登录时**被熔断扣下**（状态 guard），点「确认删除并同步」才真的删 |
| B | 云端是墓碑（事故后没做 SQL 清理），本地还有数据 | 登录即把本地删空——熔断管不着（这一轮根本没有「推」），只能靠 SQL 善后 |
| D | 照恢复步骤把 `sync:meta` 删掉再登录 | 云端保住，本地从云端整库恢复 |

结论：**合并是双向的，能删掉数据的只有墓碑。** 所谓「登录后本地把云端覆盖了」，
现场是 A——那台设备还带着 2026-09-18 事故留下的 `lumenframe:sync:meta`
（旧代码把「清站点数据」录成了整库删除）。批量删除熔断（`merge.isBulkDelete`）
就是为此加的：一次同步要删掉的云端活条目 ≥ 10 条且过半时，删除不推、状态变琥珀色，
用户确认后才放行。B 那个方向只能靠上面那条 SQL 善后。
