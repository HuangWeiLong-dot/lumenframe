import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 自托管字体（可变字重，按 unicode-range 分包，只下载用到的字形）。
// 必须早于 index.css 引入，保证字体栈引用时 @font-face 已注册。
// Inter 原先走 fonts.googleapis.com 的阻塞样式表 + fonts.gstatic.com 的 woff2，
// 在移动端实测占关键路径 450ms + 1097ms（且是两个第三方源）；自托管后与中文同一来源。
// 两者都只含拉丁/中文字形，各自按 unicode-range 分包，互不重叠。
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import App from './App.jsx'
import './index.css'
import './author-avatar.js'
import { initAuth } from './auth/store'
import { initSync } from './sync/engine'
import { onIdle } from './idle'

// 在 React 之外初始化：两者都是模块级单例，不在 effect 里跑。
// 若放进 useEffect，StrictMode 的双挂载会重复订阅；
// 而 initAuth 必须在 App.jsx 的模块体（含 resolveSpaRedirect）之后执行——
// main.jsx 的模块体天然满足这个顺序。
// 未配置 VITE_SUPABASE_* 时两个函数都是空操作（不加载 SDK、不发请求）。

// initSync 必须保持在这里同步执行，不能推迟。
// 它挂的是变更记录器（subscribeLibrary(record) / subscribePinned(record)）：此刻 React
// 还没挂载，用户不可能做任何操作，所以"记录器未就绪"的窗口恰好是 0。推到 idle 就会把这个
// 窗口拉长到最长 2 秒——用户在这期间删掉一条不会产生墓碑，下次从云端拉取时会把它复活。
// 推迟 initAuth 则没有这个问题：它只负责拉 @supabase/supabase-js 并建立 session，
// 晚一点跑等价于"登录态稍后才就位"，而 initSync 末尾那次 onAuthChange() 读到的同样是
// 空 session（今天 initAuth 是异步的，此时也还没拿到 session），行为完全一致。
initSync()

// 推迟 initAuth 到空闲：它会动态 import @supabase/supabase-js（约 59 KiB gzip），
// 原先紧跟主包一起下载，在移动端关键路径上和 LCP 图片抢带宽。
// 顺带一提：store 里的 state.ready 目前全仓库无人读取，所以推迟不会让 UI 闪未登录态。
// onIdle 带 2s 上限，页面长期繁忙时也不会被无限推迟。
onIdle(initAuth)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
