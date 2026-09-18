// 站内路由：路径拼装 + 解析，外加「新标签页打开」需要的几个小工具。
//
// 这些函数原本是 App.jsx 的模块私有函数，搬到这里的唯一原因是：
// 内容卡片散落在各个子组件里，它们要自己拼 <a href>（新标签页打开），
// 而从 App.jsx 反向 import 会形成循环依赖。
//
// 函数体与搬家前逐字一致。

import { BASE_PATH } from './spaUrl'

// ---- 路径拼装 ----

function slugify(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

export function titleUrl(kind, id, title) {
  const slug = slugify(title)
  return `${BASE_PATH}${kind === 'tv' ? 'tv' : 'movie'}/${id}${slug ? `-${slug}` : ''}`
}

export function personUrl(id, name) {
  const slug = slugify(name)
  return `${BASE_PATH}person/${id}${slug ? `-${slug}` : ''}`
}

export function genreUrl(kind, id, name) {
  const slug = slugify(name)
  return `${BASE_PATH}genre/${kind}/${id}${slug ? `-${slug}` : ''}`
}

export function libraryUrl() {
  return `${BASE_PATH}library`
}

// ---- 路径解析（从当前 location 判断落在哪个页面）----

// 从当前 location 解析标题路由；非标题页返回 null
export function parseTitleRoute() {
  const m = window.location.pathname.match(/\/(movie|tv)\/(\d+)(?:-.*)?\/?$/)
  return m ? { kind: m[1] === 'tv' ? 'tv' : 'movie', id: Number(m[2]) } : null
}

export function parsePersonRoute() {
  const m = window.location.pathname.match(/\/person\/(\d+)(?:-.*)?\/?$/)
  return m ? { id: Number(m[1]) } : null
}

export function parseGenreRoute() {
  const m = window.location.pathname.match(/\/genre\/(movie|tv)\/(\d+)(?:-.*)?\/?$/)
  return m ? { kind: m[1], id: Number(m[2]) } : null
}

export function parseLibraryRoute() {
  return /\/library\/?$/.test(window.location.pathname)
}

// ---- 新标签页 ----

// 站内路径 → 新标签页需要的绝对地址（带 origin）。
// 相对路径在新标签页里会被解析到当前路径下，深链就废了。
export function absUrl(path) {
  return window.location.origin + path
}

// 同步开一个空白标签页占位，返回 window 句柄（被弹窗拦截时返回 null）。
//
// 浏览器的弹窗拦截只在**点击的同步阶段**放行，所以「需要先异步查 id 才能确定 URL」
// 的跳转（剧集演职员要先把 TVmaze id 换成 TMDB id、PersonPage 的剧集作品要先搜 TVmaze id）
// 必须先把标签页占下来，查到之后再改它的地址。
export function preopenTab() {
  return window.open('', '_blank')
}

// 把占位标签页指向目标
export function setTabUrl(tab, path) {
  if (tab) tab.location.replace(absUrl(path))
}

// 关掉占位标签页：异步解析失败时不能留个白页给用户
export function closeTab(tab) {
  if (tab) tab.close()
}
