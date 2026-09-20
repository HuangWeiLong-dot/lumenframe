// 4kvms(nb 源)的 HTML 解析。**纯函数**：进 HTML，出数据，不碰网络。
//
// 单独拆出来是为了能拿存下来的页面离线验解析 —— 这个站两处页面结构完全不同，
// 而且都是 Tailwind 类名堆出来的、没有语义 id，选择器写错只会「静默返回空」
// 而不会报错，最需要能被单独盯住。
//
// 抓取与拼请求在 sources.js（复用那边的 httpGet），签名在 nbsign.js。

import { load } from 'cheerio'

// 站点把剧**按季拆成独立条目**（「绝命毒师: 第1季」是单独一条），
// 所以一条结果 = 一个可以整体解析的剧集列表，不是一季里的一集。

// ---------- 搜索页 /search?q= ----------

// 卡片结构（2026-09 实测）：
//   <div class="group relative">
//     <a href="/play/<slug>">
//       <div class="relative aspect-[2/3] …">
//         <img alt="片名" …>
//         <div class="absolute inset-0 …"><p>简介…</p></div>      ← hover 简介
//         <div class="absolute top-2 left-2 …">2019</div>          ← 年份
//       </div>
//       <div class="mt-2"><h3>片名</h3></div>
//     </a>
//   </div>
export function parseSearch(html) {
  const $ = load(html)
  const out = []
  const seen = new Set()

  $('a[href^="/play/"]').each((_, el) => {
    const a = $(el)
    const slug = (a.attr('href').match(/^\/play\/([a-z0-9]+)/) || [])[1]
    if (!slug || seen.has(slug)) return

    // 标题优先取 h3；没有就用封面 alt（两种布局里总有一个在）
    const title = (a.find('h3').first().text() || a.find('img').first().attr('alt') || '').trim()
    if (!title) return

    // 年份是左上角一个**只有四位数字**的徽章。不能直接在整张卡片里找
    // /(19|20)\d{2}/ —— hover 的简介文本里也常出现年份，会抓错。
    const year = a
      .find('*')
      .filter((__, e) => /^(19|20)\d{2}$/.test($(e).text().trim()))
      .first()
      .text()
      .trim()

    seen.add(slug)
    out.push({ slug, title, year, desc: a.find('p').first().text().trim() })
  })

  return out
}

// ---------- 播放页 /play/<slug> ----------

// 同一页里有三样东西要取：
//   1. <meta id="nb-st"> / <meta id="nb-plt">  —— 见 nbsign.js，实测不进签名
//   2. #navbar 的 Alpine x-data 里的 userlink: '…'  —— 访问令牌，匿名访客也有
//   3. 剧集锚点。属性顺序是 href, @click, x-show, data-line, data-episode, dataid，
//      而且整个标签**跨多行**，所以按属性逐个取，不要假设顺序或行数。
//
// 星标：<a href="/play/<secret>" @click.prevent="handleEpisodeClick($el.getAttribute('href'), '2800', 1, 1)"
//          x-show="showEpisode(1)" data-line="1" data-episode="1" dataid="2800" …>
//
// data-line 是**线路**（同一集的不同镜像），data-episode 是集号，两者都是 1 起。
export function parsePlay(html) {
  const $ = load(html)

  // userlink 在服务端渲染的 HTML 里，不在任何 JS 文件里，所以只能从原文抠。
  // 用 DOM 选择器反而更脆：#navbar 的 x-data 是一个巨大的表达式字符串。
  const userlink = (html.match(/userlink:\s*'([^']*)'/) || [])[1] || ''

  // 播放页自己那块的 h1（<title> 也带片名，但格式是「片名 - 第N集 -4k影视」，
  // 而剧集的片名里本身就含「: 第1季」，按 " - 第" 切会误伤）
  const title = $('h1').first().text().trim()

  const eps = []
  $('a[dataid][data-episode]').each((_, el) => {
    const a = $(el)
    const secret = ((a.attr('href') || '').match(/\/play\/([a-z0-9]+)/) || [])[1] || ''
    const dataid = String(a.attr('dataid') || '').trim()
    const ep = Number(a.attr('data-episode'))
    const line = Number(a.attr('data-line')) || 1
    // 没有 secret 就签不出名，没有 dataid 就无从签，直接丢
    if (!dataid || !secret || !ep) return
    eps.push({ dataid, secret, line, ep })
  })

  return { userlink, title, eps }
}

// 把锚点按线路收成 sources.js 要的 groups 形状：[{ from, episodes: [{name, url}] }]
//
// url 在调用方解析出来后填 —— 这里只负责分组和命名，因为它俩是纯的、可离线验的部分。
export function groupEpisodes(eps) {
  const byLine = new Map()
  for (const e of eps) {
    if (!byLine.has(e.line)) byLine.set(e.line, [])
    byLine.get(e.line).push(e)
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, list]) => ({
      // 站点在多线路时才渲染线路名标签，单线路没有可读名。沿用 parsePlayUrls 的
      // 兜底命名，保证和采集站线路在 UI 上长得一样。
      from: `线路${line}`,
      episodes: list.sort((a, b) => a.ep - b.ep),
    }))
}
