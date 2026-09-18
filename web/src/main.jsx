import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 自托管中文字体（可变字重 100-900，按 unicode-range 分包，只下载用到的字形）
// 必须早于 index.css 引入，保证字体栈引用时 @font-face 已注册
import '@fontsource-variable/noto-sans-sc'
import App from './App.jsx'
import './index.css'
import './author-avatar.js'
import { initAuth } from './auth/store'
import { initSync } from './sync/engine'

// 在 React 之外初始化：两者都是模块级单例，不在 effect 里跑。
// 若放进 useEffect，StrictMode 的双挂载会重复订阅；
// 而 initAuth 必须在 App.jsx 的模块体（含 resolveSpaRedirect）之后执行——
// main.jsx 的模块体天然满足这个顺序。
// 未配置 VITE_SUPABASE_* 时两个函数都是空操作（不加载 SDK、不发请求）。
initAuth()
initSync()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
