// 部署期注入的服务地址（Vite 只在构建时读取 VITE_ 前缀变量）：
// - 本地开发：两个变量都留空，走同源相对路径，由 vite.config.js 的代理转发
// - GitHub Pages 分域部署：
//     VITE_API_BASE=https://api.example.com
//     VITE_FILMGRAB_BASE=https://api.example.com/filmgrab  （不部署剧照服务则留空）
export const API_BASE = import.meta.env.VITE_API_BASE || ''

// FilmGrab 服务对外暴露的挂载前缀（等价于 FastAPI 的 /api 根）：
// - 本地开发：/filmgrab（Vite 代理重写到 8000 的 /api）
// - Linux 同域路径反代：https://api.example.com/filmgrab
// - 独立子域直挂 /api：  https://fg.example.com/api
// - 留空：不启用（公网构建默认，Film Stills 区块自动隐藏）
const _fgBase = import.meta.env.VITE_FILMGRAB_BASE
export const FILMGRAB_BASE =
  _fgBase != null && _fgBase !== '' ? _fgBase : import.meta.env.DEV ? '/filmgrab' : ''

export const apiUrl = (path) => `${API_BASE}${path}`

// 海报走后端图片代理；卡片导出时用 w1280 保证清晰度
export const posterUrl = (path, size = 'w500') =>
  apiUrl(`/api/image?path=${encodeURIComponent(path)}&s=${size}`)

// 下载图片：fetch blob → 触发浏览器下载（跨域需后端 CORS 允许）
export async function downloadImage(url, filename) {
  const res = await fetch(url)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}
