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

import { apiLang } from './i18n'

export const apiUrl = (path) => `${API_BASE}${path}`

// 文本类接口自动携带语言参数（TMDB 支持多语言：搜索/详情/类型/演职员/推荐）。
// 图片代理、TVmaze（剧集）、字幕、评分、流媒体等与语言无关的接口继续用 apiUrl，
// 避免同一份数据被拆成多套缓存。后端白名单校验 lang，非法值会回退 en-US。
export const apiUrlWithLang = (path) => {
  const sep = path.includes('?') ? '&' : '?'
  return apiUrl(`${path}${sep}lang=${apiLang()}`)
}

// 海报走后端图片代理；卡片导出时用 w1280 保证清晰度
export const posterUrl = (path, size = 'w500') =>
  apiUrl(`/api/image?path=${encodeURIComponent(path)}&s=${size}`)

// TVmaze 图片（static.tvmaze.com 原始 URL）走后端代理，规避跨域
export const tvImageUrl = (u) =>
  u ? apiUrl(`/api/tv/image?u=${encodeURIComponent(u)}`) : null

// 统一海报地址：优先用本 kind 的海报源，缺失时 fallback 到另一个 API 补的海报
// （后端混合搜索会把同名条目的海报互相补齐，这里确保两种字段都能渲染）
export const posterFor = (item, size = 'w500') => {
  if (!item) return null
  if (item.kind === 'tv') {
    return item.tvPoster
      ? tvImageUrl(item.tvPoster)
      : item.poster_path
        ? posterUrl(item.poster_path, size)
        : null
  }
  return item.poster_path
    ? posterUrl(item.poster_path, size)
    : item.tvPoster
      ? tvImageUrl(item.tvPoster)
      : null
}

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
