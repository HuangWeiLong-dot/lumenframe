// 在线播放这一块里，列表（PlaySources）和播放台（VideoPlayer）必须共用同一套判据的两件事：
// 「这条地址能不能内嵌播」和「一集、一条线路该叫什么」。
//
// 分成两份就会各写一份，而它们一旦分叉，症状是「列表里点得到、播放器里点不动」
// 这种没人一眼看得明白的错。所以放这里共用，两边都只 import。

// 能不能在页面里播；播不了的话，是**哪一种**播不了。返回 null 表示能播。
//
// 两种情况必须分开说，因为给用户的结论不一样：
//   insecure —— 地址是 http 而页面是 https。混合内容，浏览器直接掐掉，跟 CORS
//               无关，服务端也救不了，只能换一条线路。
//   notStream —— 地址压根不是流文件。**采集站里这种最多**：ffzy 系每个源的
//               first line 恒定是 `…/share/<32位十六进制>` 那种网页（真流挂在
//               同一个源的 `ffm3u8` 线上），它是给人打开去看的，不是给 <video> 的。
//               这一条以前被归进「不是 http 地址」里悄悄丢掉，结果就是展开线路、
//               点一下剧集、什么都没发生，也没有任何解释。
export function playBlocker(u) {
  const s = String(u || '')
  if (location.protocol === 'https:' && s.startsWith('http:') && /\.(m3u8|mp4)(\?|#|$)/i.test(s))
    return 'insecure'
  if (!/^https?:\/\//i.test(s) || !/\.(m3u8|mp4)(\?|#|$)/i.test(s)) return 'notStream'
  return null
}

export const canPlayInline = (u) => playBlocker(u) === null

// 只留内嵌播得动的线路与单集。
//
// **采集站里播不了是常态，不是例外**：ffzy 系每个源的 first line 恒定是
// `…/share/<32 位十六进制>` 那种网页地址（真流挂在同源的 ffm3u8 线上），那是给人打开
// 去看的，<video> 取不到。以前的做法是把它们列出来、再解释「这条线路给的是网页地址，
// 换一条线路试试」；用户要的不是解释，是别摆出来 —— 所以这里直接删掉，
// 卡片上连警告都不需要（play.notStream 只剩手绑主源那一处还在用）。
//
// 判据只用 notStream 那一档，**不含 insecure**：http 直链在 https 页面上会被浏览器拦掉，
// 但那个结论取决于**页面**的协议 —— 同一条源在本机 dev（http）能播、在 Pages（https）不能。
// 把它也滤掉，同一份清单在两种部署下会变成两批完全不同的线路；而 https 那边真正该说的
// 是「这条是 http，浏览器里播不了」，不是把整条线路藏起来（那一档的提示保留）。
export function keepPlayable(groups) {
  return (groups || [])
    .map((g) => ({
      ...g,
      episodes: (g.episodes || []).filter((e) => playBlocker(e.url) !== 'notStream'),
    }))
    .filter((g) => g.episodes.length > 0)
}

// 剧集按钮上的字。「第 12 集」这种只留序号：76 集的网格里，满屏重复的「第…集」
// 是纯噪声，序号才是用户在找的东西。真有名字的（综艺、特别篇）原样保留，
// 完整名字始终在 title 提示里。
//
// 列表和播放器的集数选择都要用它 —— 同一个源，两处显示的字必须一模一样，
// 否则用户会以为播放器里那份是另一批剧集。
const EP_NUM_RE = /^第\s*(\d+)\s*[集期话]/
export function epLabel(name, i) {
  const m = EP_NUM_RE.exec(String(name || '').trim())
  return m ? m[1] : String(name || i + 1)
}

// 线路名在采集站那边是「ffm3u8」「量子」「优质」这类**站内代号**，用户既读不出也记不住，
// 而线路之间唯一的区别就是「这是第几条」—— 所以列表里按序号叫「线路一、线路二」。
// 原始代号不丢，挂在按钮的 title 上：它是排查时唯一能把这条线路对回某个站的线索。
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function cnNumber(n) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v <= 0) return String(n)
  if (v < 10) return CN_DIGITS[v]
  if (v < 20) return `十${v % 10 ? CN_DIGITS[v % 10] : ''}`
  if (v < 100) return `${CN_DIGITS[Math.floor(v / 10)]}十${v % 10 ? CN_DIGITS[v % 10] : ''}`
  return String(v)
}
