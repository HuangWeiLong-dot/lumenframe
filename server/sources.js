// 在线播放源：采集站(MacCMS) / TVBox 配置 / 解析接口 的统一轮询层
//
// 五类源：
//   cms    —— 苹果CMS( MacCMS )采集站，api 指向 /api.php/provide/vod/
//   config —— TVBox 多仓/单仓配置 JSON，需展开出里面 sites[].api 才是采集站
//   parse  —— 解析接口，tpl 里 {url} 是占位符
//   direct —— 按片手工绑定的直连 m3u8，不搜不探活，命中就置顶当主源
//   nb     —— 4kvms：前端用 WASM 算签名换流地址的站，没有采集接口，靠抓页 + 签名
//
// 为什么这些请求必须在服务端发：Pages 线上是 HTTPS 而这批站绝大多数是 http://，
// 浏览器会按混合内容直接拦掉（与 CORS 无关）；即便是 https 的，采集站也不发
// Access-Control-Allow-Origin。前端只跟自家 API 说话。
//
// 为什么不复用 index.js 的 cached()：那是 index.js 的模块内函数，没有 export；
// 且它固定 30min TTL + 200 条 FIFO，会被探活结果（上百条）冲垮。按 ratings.js /
// subtitles.js 的房子风格自带缓存。
//
// 默认关闭：必须 PLAY_SOURCES=1 且 server/sources.json 存在且非空才启用。
// 公网 API 不该默认变成人人可用的采集代理。

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import express from 'express'
import { load } from 'cheerio'
import { available as nbAvailable, sign as nbSign } from './nbsign.js'
import { parseSearch as nbParseSearch, parsePlay as nbParsePlay, groupEpisodes as nbGroup } from './nbparse.js'
import { normType, normRemarks } from './playlabels.js'

const ENABLED = process.env.PLAY_SOURCES === '1'
const SOURCES_FILE = path.join(import.meta.dirname, 'sources.json')

// 站点会拦非浏览器 UA
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const PER_SITE_TIMEOUT = 5000 // 单站超时
// 配置源单独给更长的超时：全仓只有十几个，而且 小盒子单仓 那种 20 KB 的
// 在 24 路并发争带宽时会从 2s 抖到 6s+，用 5s 会被整仓丢掉（踩过）。
const CONFIG_TIMEOUT = 8000
// 整体硬预算：超了就返回已完成的部分，不假装完整。
// 这些是**服务端**预算，前端那边另给 30s —— 必须比前端小，否则前端先放弃、
// 服务端还在空烧 socket。
const CONFIG_BUDGET = 12000 // 配置源展开（多仓会再扇出一层，单独限）
const PROBE_BUDGET = 12000
const SEARCH_BUDGET = 15000
const CONFIG_MAX_SUB = 20 // 单个多仓最多展开几个子仓
const CONCURRENCY = 24 // 150~300 个目标，不能裸扇出
const MAX_HOPS = 3
const TTL_LIST = 30 * 60 * 1000
const TTL_PROBE = 10 * 60 * 1000
const TTL_SEARCH = 30 * 60 * 1000
const TTL_DETAIL = 30 * 60 * 1000
// 收录门槛。matchScore 现在只发 1 / 0.8 / 0 三档（见「片名匹配」那一节），所以这个数
// 实际只区分「同一部片」和「不是」。留成比例是为了以后再加中间档时不用改调用点。
const SEARCH_MIN_SCORE = 0.6
const SEARCH_SITE_LIMIT = 60 // 单站最多取几条候选

// ---------- nb ( 4kvms ) ----------
//
// 站点地址是内建的：它不像采集站那样「换一个 api 就是另一个站」——整套抓取逻辑
// （搜索页 / 播放页 / 签名参数名）都是照这一个站写的，清单里那条只用来开关和命名。
const NB_ORIGIN = 'https://www.4kvms.com'
// 单集解析是**外加**的扇出：一季 20 集就是 20 个请求打同一个站。CONCURRENCY(24)
// 是对上百个站摊的，砸在一个站上既不礼貌也容易招风控，所以另起一个小限流器。
const NB_CONCURRENCY = 6
// 单条线路最多解析多少集：站上偶有上百集的条目，一次详情页点开就发上百个请求，
// 宁缺毋滥。超出部分不出现（前端看到的是「这一季只有前 N 集」，不是错误）。
const NB_MAX_EPS = 80

// ---------- 出站请求 ----------

// 用 node:http/https 而不是 fetch：index.js 在设了 TMDB_PROXY 时会
// setGlobalDispatcher(new ProxyAgent(...))，而 setGlobalDispatcher 只影响 undici 的
// fetch —— 那会把这批国内站也拽进 TMDB 代理绕一圈。tvmaze.js 出于同样理由用原生模块
// （注释：绕过 undici fetch，避免 IPv6/proxy 兼容问题）。顺带白拿 family:4 强制 IPv4。
// 内网地址黑名单：config 源是**第三方文档**，它里面的 urls[]/sites[].api 会被我们
// 接着请求 —— 一份公开的多仓配置完全可能写着 http://127.0.0.1:6379/ 或云厂商的
// 169.254.169.254 元数据地址。客户端传不了裸 URL 不代表这里安全。
const PRIVATE_V4 =
  /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal'))
    return true
  if (PRIVATE_V4.test(h)) return true
  if (h.includes(':')) {
    // IPv6 回环 / 唯一本地 / 链路本地
    if (h === '::1' || h === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true
  }
  return false
}

// 采集站大量用 GBK/GB2312，而且经常不声明 charset。直接 toString('utf8') 会得到
// 一堆 U+FFFD，接着 JSON.parse 出来片名是乱码 —— 再喂给片名匹配就是必错。
// Node 20 自带 full-icu，TextDecoder('gbk') 直接可用，不需要新依赖。
function decodeBody(buf, contentType) {
  let text
  const declared = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1]
  try {
    text = new TextDecoder(declared || 'utf-8').decode(buf)
  } catch {
    text = buf.toString('utf8')
  }
  // 用命名常量而不是直接写字面量：源码里一个孤零零的 U+FFFD 和「文件本身被
  // 解坏」长得一模一样，后人很容易误以为这里是乱码而改掉
  const BAD = '�'
  if (!text.includes(BAD)) return text
  for (const alt of ['gbk', 'gb18030', 'big5']) {
    try {
      const t = new TextDecoder(alt).decode(buf)
      if (!t.includes(BAD)) return t
    } catch {
      // 该 label 不被支持就试下一个
    }
  }
  return text
}

// ---------- 代理（可选，默认直连） ----------
//
// 本模块走 node:http **是刻意的**：绝大多数片源是国内站，绕一趟海外代理纯属浪费
// （见 nbsign.js 顶部；index.js 给 fetch 设的全局 ProxyAgent 也管不到这里）。
// 但 4kvms 是那个例外 —— 它被墙：直连 www.4kvms.com 会被解析到 115.89.129.251
// 拿到一个通用 404（1004 字节），经代理才是真的 200。原来把它当国内站是错的。
//
// 所以策略是「**先直连，失败才退回代理**」，结论按 host 记下来：
//   国内站第一次就成功 → 永远不碰代理，原设计意图不变
//   被墙站第一次失败     → 之后这个 host 直接走代理，只付一次失败的代价
//   生产机器（两个变量都没设）→ 全程直连，与改动前**完全一致**
//
// SOURCES_PROXY 是这一模块自己的开关；TMDB_PROXY 兜底 —— 「国内网络要挂代理」
// 本来就是同一件事，本地已经设过那一个就不必再设一遍。
const PROXY = (() => {
  const raw = process.env.SOURCES_PROXY || process.env.TMDB_PROXY || ''
  if (!raw) return null
  try {
    const u = new URL(raw)
    // 只认 http(s) 代理（CONNECT 隧道）。socks 之类不支持 —— 宁可直连，
    // 也不要假装走了代理而给出一个更差的结果。
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return {
      host: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      auth: u.username
        ? 'Basic ' +
          Buffer.from(
            `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
          ).toString('base64')
        : '',
    }
  } catch {
    return null
  }
})()

// 只在「直连失败、代理成功」时写入。进程级缓存，命中的 host 之后直接走代理。
const hostNeedsProxy = new Set()

// 单次请求，viaProxy 决定走哪条路。重定向在**这一层**递归，保证整条链同一条路
// （否则一个被墙站跳到自己的另一个域名就会半路摔回直连）。
function rawGet(url, ms, viaProxy, hop = 0) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(url)
    } catch {
      return reject(new Error('bad url'))
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return reject(new Error('bad protocol'))
    }
    if (isBlockedHost(u.hostname)) {
      return reject(new Error('blocked host'))
    }

    const isTls = u.protocol === 'https:'
    const port = u.port || (isTls ? 443 : 80)
    const headers = {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }

    const onResponse = (res) => {
      const status = res.statusCode || 0
      // 跟随重定向，最多 MAX_HOPS 跳（采集站换域名很频繁）
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (hop >= MAX_HOPS) return reject(new Error('too many redirects'))
        const next = new URL(res.headers.location, url).toString()
        return resolve(rawGet(next, ms, viaProxy, hop + 1))
      }
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        // 详情页可能很大，但探活只要头部；超过 4MB 直接截断，避免拖垮内存
        if (size <= 4 * 1024 * 1024) chunks.push(c)
        else res.destroy()
      })
      res.on('end', () =>
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: decodeBody(Buffer.concat(chunks), res.headers['content-type']),
        })
      )
    }

    if (!viaProxy) {
      const mod = isTls ? https : http
      const req = mod.get(
        { protocol: u.protocol, host: u.hostname, port, path: u.pathname + u.search, family: 4, headers, timeout: ms },
        onResponse
      )
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('timeout')))
      return
    }

    // 经代理。http 目标把**绝对 URI** 交给代理即可；https 目标必须先 CONNECT 打隧道，
    // 再在裸 socket 上自己起 TLS —— 少了这一步就只是「明文请求代理」，https 站会拒。
    const proxyHeaders = PROXY.auth ? { 'Proxy-Authorization': PROXY.auth } : {}
    if (!isTls) {
      const req = http.request(
        {
          host: PROXY.host,
          port: PROXY.port,
          method: 'GET',
          path: u.href,
          family: 4,
          // Host 要显式给：这里 host 是代理，Node 不会自己补目标站的 Host
          headers: { ...headers, Host: u.host, ...proxyHeaders },
          timeout: ms,
        },
        onResponse
      )
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.end()
      return
    }

    const tunnel = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${u.hostname}:${port}`,
      family: 4,
      timeout: ms,
      headers: { Host: `${u.hostname}:${port}`, ...proxyHeaders },
    })
    tunnel.on('error', reject)
    tunnel.on('timeout', () => tunnel.destroy(new Error('timeout')))
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        return reject(new Error(`proxy CONNECT ${res.statusCode}`))
      }
      // servername 必须显式给：这条路上没有 host，不写 SNI 拿不到证书对应的虚拟主机
      const req = https.request(
        { socket, servername: u.hostname, agent: false, path: u.pathname + u.search, headers: { ...headers, Host: u.host } },
        onResponse
      )
      req.on('error', reject)
      req.setTimeout(ms, () => req.destroy(new Error('timeout')))
      req.end()
    })
    tunnel.end()
  })
}

// 直连优先，失败且配了代理时退回代理，并把「这个 host 得走代理」记下来。
// 判定「失败」不只看抛错：**被墙站恰恰是答得又快又错**（4kvms 回通用 404），
// 所以非 2xx 同样要再试一次代理。
//
// opts.proxy === false 用于探活：那里上百个目标，为一个「这站活没活」的猜测让每个
// 死站都多打一次代理不划算（探活的 ok 本来就只代表列表接口答了话，见 doProbe）。
async function httpGet(url, ms = PER_SITE_TIMEOUT, hop = 0, opts = {}) {
  const allowProxy = opts.proxy !== false && !!PROXY
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {}

  const viaProxy = !!(allowProxy && host && hostNeedsProxy.has(host))
  const first = await rawGet(url, ms, viaProxy, hop).catch((e) => e)

  if (first instanceof Error) {
    if (!allowProxy || viaProxy || !host) throw first
    const alt = await rawGet(url, ms, true, hop).catch((e) => e)
    if (alt instanceof Error) throw first // 代理也不行 → 报直连的错误，那是更可信的那个
    hostNeedsProxy.add(host)
    return alt
  }

  if (first.ok || !allowProxy || viaProxy || !host) return first

  const alt = await rawGet(url, ms, true, hop).catch((e) => e)
  if (alt instanceof Error || !alt.ok) return first
  hostNeedsProxy.add(host)
  return alt
}

// 探活专用：不参与代理回退，理由见 httpGet 的 opts 注释
const probeGet = (url, ms) => httpGet(url, ms, 0, { proxy: false })

// ---------- 并发闸门 ----------
// 仓库里此前没有任何限流器（全是 Promise.all 裸扇出），这是第一个。

function createLimiter(max) {
  let active = 0
  const queue = []
  const pump = () => {
    while (active < max && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift()
      active++
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--
          pump()
        })
    }
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      pump()
    })
}

const limit = createLimiter(CONCURRENCY)

// 给一组任务加整体预算：超时的直接放弃，返回已完成的部分（不 reject）
function runWithBudget(tasks, budgetMs) {
  return new Promise((resolve) => {
    const out = []
    let done = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ results: out, completed: false })
    }, budgetMs)
    if (tasks.length === 0) {
      clearTimeout(timer)
      settled = true
      return resolve({ results: [], completed: true })
    }
    for (const t of tasks) {
      t().then(
        (r) => {
          if (settled) return
          out.push(r)
          done++
          if (done === tasks.length) {
            clearTimeout(timer)
            settled = true
            resolve({ results: out, completed: true })
          }
        },
        () => {
          done++
          if (done === tasks.length && !settled) {
            clearTimeout(timer)
            settled = true
            resolve({ results: out, completed: true })
          }
        }
      )
    }
  })
}

// ---------- 缓存 ----------

function makeCache(ttl) {
  const store = new Map()
  const flight = new Map()
  const get = async (key, fetcher) => {
    const hit = store.get(key)
    if (hit && Date.now() - hit.time < ttl) return hit.data
    if (flight.has(key)) return flight.get(key)
    const p = fetcher()
      .then((data) => {
        store.set(key, { data, time: Date.now() })
        return data
      })
      .finally(() => flight.delete(key))
    flight.set(key, p)
    return p
  }
  // 只看不拉：让调用方能「有就用、没有就算」，而不是被一次冷拉拖着等
  get.peek = (key) => {
    const hit = store.get(key)
    return hit && Date.now() - hit.time < ttl ? hit.data : null
  }
  return get
}

const cacheList = makeCache(TTL_LIST)
const cacheProbe = makeCache(TTL_PROBE)
const cacheSearch = makeCache(TTL_SEARCH)
const cacheDetail = makeCache(TTL_DETAIL)

// 搜索缓存的分代计数：探活每跑完一轮 +1，并拼进 cacheSearch 的 key。
//
// 冷启动时探活还没结果，doSearch 只能拿 loadList() 里直连的那 60 个站顶上，出来的是
// 一份**残缺**结果；探活在后台跑完（约 20s）后，同一个查询本该多出一批配置源展开的站。
// 但搜索缓存键只认 (q, year)，那份残缺结果会照端 30 分钟 —— 用户点「检测更多来源」
// 触发的重搜拿到的还是同一份缓存，按钮看起来毫无反应。跟按片名来的第二个访客也一样
// 吃亏：他本该吃到热路径，却被这份冷路径缓存挡住。
// 把代次拼进 key，探活一到手这份缓存自然作废，重搜才真的跑在完整清单上。
let probeGen = 0

// ---------- 清单加载 ----------

const hostSlug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// 采集站的路径变体（/from/xxx、/at/json）是同一个站，按 host 去重；
// 配置源的路径就是身份本身（xhztv.top 的 4k.json / xhz / dc 是三个不同仓），
// 必须按整个 URL 去重，否则会把它们误当成重复项砍掉。
function dedupKeyOf(s) {
  return s.kind === 'config' ? s.target : s.host
}

function makeId(kind, target, host) {
  const base = hostSlug(host)
  if (kind !== 'config') return base
  const p = hostSlug(new URL(target).pathname.replace(/\.[a-z0-9]+$/i, ''))
  return p ? `${base}-${p}` : base
}

// ---------- 对外化名 ----------
//
// 采集站和解析站的**展示名**一律换成化名，真实站名只留在服务端和 sources.json 里。
// 真实名字没法看：清单里是「🥑┃量子┃资源」「影视 | 非凡[直连]」「最大｜采集」这种，
// 带着 emoji、全角竖线、重复的品牌占位符，同一部片在七八个站上出现时列出来纯是噪音。
//
// 化名取 id 的哈希，是**纯函数、无状态**的。用计数器分配（源 01…源 96）看着更顺眼，
// 但配置源展开出来的站要等探活才知道，冷热状态下编号会漂移 —— 用户没法把
// 「上次能放的那个」认回来。哈希的话冷热路径、重启前后、换台设备看到的都是同一个标签。
//
// 这是**展示层**遮蔽，不是匿名化：响应里的 sourceId 仍由 host 推导
//（cj-lziapi-com → cj.lziapi.com），解析站的 openUrl 更是明摆着的真实域名。
// 要连域名一起藏得连这两处一起改，见 docs/play-sources.md §5.1。
function aliasOf(id) {
  let h = 0x811c9dc5 // FNV-1a 32 位
  const s = String(id || '?')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // 取 36^5 = 60466176 个桶：130 个源撞名的概率约 0.014%，真撞了也只是两个标签
  // 长得一样（化名不参与任何逻辑，只用于显示），不影响功能。
  let n = h % 60466176
  let out = ''
  for (let i = 0; i < 5; i++) {
    out = (n % 36).toString(36).toUpperCase() + out
    n = Math.floor(n / 36)
  }
  return out
}

// 把响应里的 name / host 换成化名。**只在路由层做**，不在 loadList 或各级缓存里做：
// 缓存里的对象要拿真实 host 参与去重（dedupKeyOf、buildProbeTargets 的 seen 集），
// 就地改掉会让两个不同的站因为化名撞车而被判成重复。
// host 直接不对外发 —— 前端只在 title 提示里用它，换成化名后那个提示本身也没意义了。
const pubName = (id) => aliasOf(id)

let listState = null // { at, sources }

async function loadList() {
  if (!ENABLED) return { enabled: false, sources: [], direct: [] }
  if (listState && Date.now() - listState.at < TTL_LIST) return listState.data
  let data = { enabled: false, sources: [], direct: [] }
  try {
    const raw = JSON.parse(await readFile(SOURCES_FILE, 'utf8'))
    const rows = Array.isArray(raw) ? raw : raw.sources
    const sources = []
    const direct = []
    for (const r of Array.isArray(rows) ? rows : []) {
      const kind = String(r.kind || 'cms')

      // 第四种 kind：**直连片源**。一条按片绑定的 m3u8，不做搜索、不进探活、不参与去重。
      //
      // 存在的理由：采集站给的片子全靠聚合撞运气，而有些源（如 4kvms 那种前端用 WASM
      // 现场算出地址的站）根本没有采集接口，抓不到、也搜不到。这种就只能人工把地址
      // 摘出来，写进清单里按片绑定，命中时排在结果最前当主源。
      // 它跟采集站不是一类东西：没有 id、没有剧集列表、没有镜像，所以既不进 sources，
      // 也不该被 dedupKeyOf / buildProbeTargets 看见。
      if (kind === 'direct') {
        for (const e of Array.isArray(r.entries) ? r.entries : []) {
          const url = String(e?.url || '').trim()
          let path = ''
          try {
            path = new URL(url).pathname
          } catch {
            continue // 连 URL 都拼不出来（`https://` 后面空着之类），跳过
          }
          // id 要带上路径：同一个桶上挂两部片是常态，只按 host 取 id 会让它们撞成同一个
          // key（前端列表的 React key、调试时的辨识全靠它）。
          const base = hostSlug(hostOf(url) || 'direct')
          const seg = hostSlug(path.replace(/\.[a-z0-9]+$/i, ''))
          direct.push({
            id: seg ? `${base}-${seg}` : base,
            label: String(e.label || r.name || hostOf(url) || ''),
            // tmdb / title 至少给一个，否则这条绑不上任何片
            tmdb: e.tmdb == null ? '' : String(e.tmdb).trim(),
            title: String(e.title || '').trim(),
            url,
          })
        }
        continue
      }

      // 第五种 kind：**nb（4kvms）签名源**。与采集站并列出现在搜索结果里，但接口
      // 完全不同 —— 它没有 api.php（所有变体都 404），流地址是拿前端同款 WASM 现算
      // 签名换来的。抓取逻辑内建，所以清单里这一条**不需要 target**。
      //
      // 双重门禁：既要在清单里有这一条，又要 vendor/nbmovie/ 那两个文件在位。
      // 后者是 gitignore 的（第三方产物），所以干净克隆 + 没手工放文件的线上
      // 都会自然缺席 —— 与 sources.json / FILMGRAB_BASE 同一套自隐藏约定。
      if (kind === 'nb') {
        if (!nbAvailable()) continue
        sources.push({
          id: r.id || 'nb-4kvms',
          name: String(r.name || '4kvms'),
          kind: 'nb',
          target: NB_ORIGIN,
          host: hostOf(NB_ORIGIN),
        })
        continue
      }

      const target = kind === 'config' ? r.url : kind === 'parse' ? r.tpl : r.api
      if (!target) continue
      const host = hostOf(target)
      if (!host) continue
      sources.push({
        id: r.id || makeId(kind, target, host),
        name: String(r.name || host),
        kind,
        target,
        host,
      })
    }
    // 清单里大量重名（hhzyapi.com 同时挂着「豪华」和「火狐」），去重键不能是 name。
    // 保留先出现的那条 —— 所以清单里要把它放在靠前的位置。
    const seen = new Set()
    const deduped = []
    for (const s of sources) {
      const k = dedupKeyOf(s)
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(s)
    }
    // 直连片源不参与 sources 的去重与探活，但它同样算「本功能已配置」——
    // 只填了一部片的直连、一个采集站都没配的人，区块也该显示出来。
    data = { enabled: deduped.length > 0 || direct.length > 0, sources: deduped, direct }
  } catch {
    // 文件缺失/损坏 → 视为未启用（自隐藏），不是错误
  }
  listState = { at: Date.now(), data }
  return data
}

// ---------- 片名匹配 ----------
//
// 不能复用 titlematch.js：它的 normalizeTitle 用 /[^a-z0-9]+/ 把汉字全洗掉，
// 中文片名一律归一成空串，于是 na === nb 命中「完全相同」分支返回 1.0。实测：
//   titleScore('流浪地球','三体')      = 1.000   完全不同的片子拿满分
//   titleScore('流浪地球','满江红')    = 1.000
//   titleScore('流浪地球','流浪地球2') = 0.000   正确的续集反被判死
// 而那个模块被 index.js 的 torrents / RT / ShotOnWhat / TasteDive 共用，动不得，
// 所以这里另起一套保留汉字的归一化。改成只保留「字母 + 数字」——
// \p{L} 本身就涵盖汉字，其余（空格/标点/罗马数字点号）折叠成空格。
//
// **为什么不能做「任意位置的包含」**（2026-09 改）：
// 旧版是 `na.includes(nb) || nb.includes(na)` 就保底给 0.8，判据太松 —— 只要候选
// 的某个别名里**出现过**查询串就得分。给《神探夏洛克》搜出来的东西：
//
//   淘气大侦探（欧美动漫）    别名末尾是 "Gnomeo & Juliet: Sherlock Gnomes"
//   福尔摩斯改变世界（综艺）  别名里有个就叫「神探夏洛克改变世界」
//   神探夏洛克与女儿          别名就叫「神探夏洛克与女儿」
//   女神探夏洛克（日剧）      levRatio('神探夏洛克','女神探夏洛克') = 0.833
//
// 共同点是「多出来（或少掉）的那几个字，恰好凑成了另一部片名」。所以现在分三档：
//
//   完全相同                             → 1
//   前缀包含，且多出来的那截**不是片名**   → 0.8
//   等长且只差一个字（简繁、错字）        → 0.8
//   其余                                 → 0
//
// 「多出来的那截不是片名」有两种：由**副标题分隔符**引出（《神探夏洛克：可恶的新娘》是
// 同一部剧的特别篇，而《神探夏洛克与女儿》中间什么分隔符都没有），或整截只是编号与
// 版本（第二季 / 2 / Season 3 / 国语 / 加长版）。这两条之外的尾巴一律当另一部片名。
//
// 副标题这条**必须**在保留标点的形态上判：normName 已经把「：」抹成空格了。

const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// 更轻的一套：只折空白和大小写，标点原样留着，供前缀/副标题判定用
const softNorm = (s) => String(s || '').toLowerCase().replace(/[\s　]+/g, ' ').trim()

// 副标题分隔符。逗号和空格都**不算**：逗号在英文译名里到处都是（"The Good, the Bad"），
// 空格更甚 —— "Sherlock Gnomes" 就是靠一个空格多出一个词来的。
const SUBTITLE_SEP = /^ ?[：:·・—–－~～]/u

// 允许当成「同一部片的另一版本」的尾巴。判定前先去掉空白，好让 'season 1' 和
// '第三季' 走同一条路。
const TAIL_OK_RE =
  /^(?:[0-9]+|(?:第)?[0-9一二三四五六七八九十百千]+[季部集篇辑]|season[0-9]+|s[0-9]{1,2}|part[0-9]+|vol(?:ume)?[0-9]+|国语|粤语|英语|双语|中字|中英|简体|繁体|高清|超清|完整版|加长版|剧场版|特别篇|番外|版|sp)+$/i

// 编辑距离，同 titlematch.js 的算法
function levDist(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[n]
}

// b 比 a 长、且以 a 开头时，多出来的那一截算不算「同一部片的版本信息」
function tailIsVariant(tail) {
  if (SUBTITLE_SEP.test(tail)) return true
  return TAIL_OK_RE.test(tail.replace(/\s+/g, ''))
}

function matchScore(a, b) {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  // 前缀包含。反方向（查询比候选长）也走这里 —— 站点只收了基础片名、把副标题略掉
  // 的情况很常见，而「查询以候选开头」本身已经是相当强的约束了。
  const sa = softNorm(a)
  const sb = softNorm(b)
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa]
  if (long.startsWith(short) && tailIsVariant(long.slice(short.length))) return 0.8
  // 等长且只差一个字：简繁（老友记 / 老友記）和错字。按「差几个字」判而不是按比率 ——
  // 比率对短名太苛刻（3 字差 1 个只剩 0.67），对长名又太松（10 字差 4 个还有 0.6）。
  if (na.length === nb.length && levDist(na, nb) <= 1) return 0.8
  return 0
}

// ---------- 宽松 JSON ----------
//
// TVBox 配置普遍不是严格 JSON，而 JSON.parse 是。实测踩到的三种：
//
//   1. // 行注释和 /* */ 块注释 —— 官方客户端能读，JSON.parse 直接崩。
//      小盒子4K 里有一行 "//////////"，拾光多仓是 JSON 主体后面跟了尾随注释。
//   2. 字符串字面量里塞了裸控制字符 —— 小盒子4K 的 "优\n酷" 里那个是真的换行
//      而不是转义，严格 JSON 不允许字符串内有控制字符。
//   3. JSON 前后带别的东西 —— 小盒子单仓 开头是「//[所有内容仅供学习使用]」，
//      找起始括号时会先撞上注释里那个中文方括号；肥猫的配置前面也有一大段非 JSON。
//
// 所以顺序很重要：**先洗注释，再找起始括号**。反过来（先找再洗）就会把注释里的
// 方括号当成文档开头。找到候选括号后还要逐个试 —— 第一个 `{` 未必是文档的 `{`。
//
// 这三种之外的就真是死了：王二小/嗷呜 现在返回的是 HTML 导航页，饭太硬 返回的
// 是一张真 JPEG（里面没有 sites），摸鱼儿 域名已经 ENOTFOUND。

// 洗注释 + 转义字符串内的裸控制字符，一次扫描做完
function repairJsonc(s) {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) {
        out += c
        esc = false
        continue
      }
      if (c === '\\') {
        out += c
        esc = true
        continue
      }
      if (c === '"') {
        out += c
        inStr = false
        continue
      }
      const cc = c.charCodeAt(0)
      if (cc < 0x20) {
        // 裸换行/制表符在字符串里是非法的，转成转义序列
        out +=
          c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : '\\u' + cc.toString(16).padStart(4, '0')
        continue
      }
      out += c
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++
      i++
      continue
    }
    out += c
  }
  return out
}

// 从 start 处的开括号开始，按配对切出第一个完整对象（跳过字符串内的括号）
function sliceBalanced(text, start, limit) {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length && i < limit; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// 起始括号后面必须跟得上 JSON 的值/键，否则就是散文里的方括号（`[所有内容…]`）
const JSON_START = /[[{](?=\s*["[{\]}\dtfn-])/g

const SCAN_LIMIT = 4096 // 起始位置只在前 4 KiB 里找
const MAX_CANDIDATES = 32 // 每个候选都是一次 slice+parse，封个顶
const SLICE_LIMIT = 512 * 1024

function parseLooseJson(raw) {
  const text = String(raw || '').replace(/^﻿/, '')
  if (!text) return null
  // 洗注释必须排在定位之前，理由见文件头注释
  for (const body of [repairJsonc(text), text]) {
    JSON_START.lastIndex = 0
    let m
    let tried = 0
    while ((m = JSON_START.exec(body)) && tried < MAX_CANDIDATES) {
      if (m.index > SCAN_LIMIT) break
      tried++
      // 整段先试一次（文档本来就是完整 JSON 时最快），再试括号配对切出来的
      for (const cand of [body.slice(m.index), sliceBalanced(body, m.index, m.index + SLICE_LIMIT)]) {
        if (!cand) continue
        let j
        try {
          j = JSON.parse(cand)
        } catch {
          continue
        }
        // 只有对象/数组才算命中：散文里的 `[x, y]` 也可能凑巧是合法 JSON
        if (j && typeof j === 'object') return j
      }
    }
  }
  return null
}

// ---------- MacCMS 响应解析 ----------

function withQuery(base, qs) {
  return base + (base.includes('?') ? '&' : '?') + qs
}

// MacCMS 默认回 JSON；部分部署只给 XML（at=xml），有的对 ac=list 一律回 XML。
// 两种都要认。返回 null 表示「不是已知结构」——上层归类为「格式未知」，不判死。
function parseCmsList(text) {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    let j
    try {
      j = JSON.parse(t)
    } catch {
      return null
    }
    if (Array.isArray(j)) return { count: j.length }
    if (j && typeof j === 'object' && ('code' in j || 'list' in j)) {
      return {
        count: Array.isArray(j.list) ? j.list.length : 0,
        code: Number(j.code),
        msg: String(j.msg || ''),
      }
    }
    return null
  }
  if (t.startsWith('<')) {
    try {
      const $ = load(t, { xmlMode: true })
      const n = $('video').length || $('list > item').length
      return { count: n }
    } catch {
      return null
    }
  }
  return null
}

// vod_play_from: "线路1$$$线路2"（部分部署用逗号分隔，如 "m3u8,iframe"）
// vod_play_url:  "第1集$http://a#第2集$http://b$$$第1集$http://c"
// （$$$ 分线路、# 分集、$ 分「集名$地址」）
//
// 集名取**第一个** $ 之前的部分：地址的 query 里本身就带 $ 的情况很多，
// 用 split('$') 会把地址劈碎。
function parsePlayUrls(from, url) {
  const froms = String(from || '')
    .split(/\$\$\$|,/)
    .map((s) => s.trim())
  const blocks = String(url || '').split('$$$')
  const groups = blocks
    .map((blk, i) => {
      const episodes = blk
        .split('#')
        .map((ep) => {
          const s = ep.trim()
          if (!s) return null
          const idx = s.indexOf('$')
          const name = idx >= 0 ? s.slice(0, idx).trim() : ''
          const link = (idx >= 0 ? s.slice(idx + 1) : s).trim()
          if (!/^https?:\/\//i.test(link)) return null
          return { name: name || link, url: link }
        })
        .filter(Boolean)
      return { from: froms[i] || '', episodes }
    })
    .filter((g) => g.episodes.length > 0)
  // 线路名数量对不上时（脏数据太常见），宁可全部用序号，也不要按下标硬配 ——
  // 错配会让用户点开「线路2」实际拿到线路1 的内容
  const aligned = froms.filter(Boolean).length === groups.length
  return groups.map((g, i) => ({ from: (aligned && froms[i]) || `线路${i + 1}`, episodes: g.episodes }))
}

function pickYear(v) {
  const m = String(v || '').match(/(19|20)\d{2}/)
  return m ? m[0] : ''
}

// ---------- 探活 ----------

async function probeCms(src) {
  const t0 = Date.now()
  const r = await probeGet(withQuery(src.target, 'ac=list&pg=1'), PER_SITE_TIMEOUT)
  const ms = Date.now() - t0
  if (!r.ok) return { ok: false, ms, note: `http ${r.status}` }
  const parsed = parseCmsList(r.text)
  if (!parsed) return { ok: false, ms, note: '格式未知', unknown: true }
  if (parsed.code !== undefined && parsed.code !== 1) {
    return { ok: false, ms, note: `code ${parsed.code}`, unknown: true }
  }
  return { ok: parsed.count > 0, ms, count: parsed.count, note: parsed.count > 0 ? '' : '空列表' }
}

// config 源探活：能否展开出采集站（顺带把展开结果喂给探活用）
async function expandConfig(src, depth = 0) {
  if (depth > 1) return []
  const r = await httpGet(src.target, CONFIG_TIMEOUT)
  if (!r.ok) throw new Error(`http ${r.status}`)
  // 嗷呜那种把 JSON 伪装成 .webp 的、以及带注释的 JSONC 都走这里
  const j = parseLooseJson(r.text)
  if (!j || typeof j !== 'object') throw new Error('非 JSON')
  const out = []
  if (Array.isArray(j.sites)) {
    for (const s of j.sites) {
      if (!s || !s.api) continue
      // type 0/1 是苹果CMS(json/xml)；其它 type 是 csp/appysv 等，接口形态不同，先不收
      if (s.type !== undefined && s.type !== 0 && s.type !== 1) continue
      const api = String(s.api)
      const host = hostOf(api)
      if (!host) continue
      out.push({ id: hostSlug(host), name: String(s.name || host), kind: 'cms', target: api, host })
    }
  } else if (Array.isArray(j.urls)) {
    // 多仓：每个 url 指向一个单仓配置，再展开一层。
    // 必须并发 —— 串行拉 20 个子仓 × 5s 超时会直接把预算吃光。
    const subs = j.urls
      .slice(0, CONFIG_MAX_SUB)
      .map((u) => (typeof u === 'string' ? u : u && u.url))
      .filter(Boolean)
    const nested = await Promise.all(
      subs.map((sub) =>
        limit(() => expandConfig({ target: String(sub) }, depth + 1).catch(() => []))
      )
    )
    for (const arr of nested) out.push(...arr)
  }
  return out
}

async function buildProbeTargets() {
  const { sources } = await loadList()
  const cms = []
  const parse = []
  const configs = []
  for (const s of sources) {
    if (s.kind === 'cms') cms.push(s)
    else if (s.kind === 'parse') parse.push(s)
    // 必须显式判 config，**不能**用 else 兜底：nb 源会被兜进 configs，
    // 接着被 expandConfig 当成 TVBox 配置去抓一次，白白多一个探活目标和一条假报错。
    else if (s.kind === 'config') configs.push(s)
  }
  // 展开阶段一样要吃预算：多仓会再扇出一层，没有 deadline 的话
  // 14 个配置源足够把一次探活拖到几分钟（这里踩过，实测 45s 还没返回）。
  const configTasks = configs.map((c) => () =>
    limit(async () => {
      const t0 = Date.now()
      try {
        const sites = await expandConfig(c)
        return {
          id: c.id,
          name: c.name,
          kind: 'config',
          host: c.host,
          ok: sites.length > 0,
          ms: Date.now() - t0,
          count: sites.length,
          note: sites.length > 0 ? '' : '未展开出采集站',
          sites,
        }
      } catch (e) {
        return {
          id: c.id,
          name: c.name,
          kind: 'config',
          host: c.host,
          ok: false,
          ms: Date.now() - t0,
          note: e.message === 'timeout' ? '超时' : '展开失败',
          sites: [],
        }
      }
    })
  )
  const { results: configResults, completed: configDone } = await runWithBudget(
    configTasks,
    CONFIG_BUDGET
  )
  for (const r of configResults) cms.push(...(r.sites || []))
  for (const r of configResults) delete r.sites
  if (!configDone) {
    configResults.push({
      id: '_pending',
      name: '其余配置源',
      kind: 'config',
      host: '',
      ok: false,
      ms: CONFIG_BUDGET,
      note: '超出预算未展开',
    })
  }
  // 展开出来的采集站再按 host 去重一次（多仓之间大量重叠）
  const seen = new Set()
  const dedupedCms = []
  for (const s of cms) {
    if (seen.has(s.host)) continue
    seen.add(s.host)
    dedupedCms.push(s)
  }
  return { configs: configResults, cms: dedupedCms, parse }
}

async function doProbe() {
  const { configs, cms, parse } = await buildProbeTargets()
  const tasks = cms.map((s) => () =>
    limit(async () => {
      try {
        const r = await probeCms(s)
        return { id: s.id, name: s.name, kind: 'cms', host: s.host, ...r }
      } catch (e) {
        return {
          id: s.id,
          name: s.name,
          kind: 'cms',
          host: s.host,
          ok: false,
          ms: PER_SITE_TIMEOUT,
          note: e.message === 'timeout' ? '超时' : '连接失败',
        }
      }
    })
  )
  // 解析站只探可达性：真正「能不能解开某个视频页」必须拿真实剧集 URL 去试，
  // 且依赖对方服务端渲染，不能假装验证过。
  for (const s of parse) {
    tasks.push(() =>
      limit(async () => {
        const t0 = Date.now()
        try {
          const r = await probeGet(s.target, PER_SITE_TIMEOUT)
          return {
            id: s.id,
            name: s.name,
            kind: 'parse',
            host: s.host,
            ok: r.ok,
            ms: Date.now() - t0,
            note: r.ok ? '可达' : `http ${r.status}`,
          }
        } catch (e) {
          return {
            id: s.id,
            name: s.name,
            kind: 'parse',
            host: s.host,
            ok: false,
            ms: Date.now() - t0,
            note: e.message === 'timeout' ? '超时' : '连接失败',
          }
        }
      })
    )
  }
  const total = tasks.length + configs.length
  const { results, completed } = await runWithBudget(tasks, PROBE_BUDGET)
  const all = [...configs, ...results]
  all.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms)
  // 这一轮探活定下了新的站点池，作废掉基于旧池算出来的搜索结果（见 probeGen 注释）
  probeGen += 1
  // **只把活着的交出去。** 没通过的直接删掉，不留在响应里。
  //
  // 失败的那些以前是跟着响应一起发的，前端于是只能拿一句「124 个采集站，30 个可用」
  // 把内部记账念给用户听 —— 那是把「我筛掉了一堆没用的」说成了用户需要知道的事。
  // 探活的唯一产出就是「哪些站能用」；筛掉的那些没有第二个用途，也没有第二个读者
  // （`doSearch` 的热路径本来就按 ok 过滤，这里删掉只是让它少滤一遍）。
  const alive = all.filter((r) => r.ok)
  return {
    probedAt: Date.now(),
    total,
    probed: all.length,
    pending: completed ? 0 : Math.max(0, total - all.length),
    alive: alive.length,
    results: alive,
    // 探活顺带算出来的**完整**采集站清单（直连的 + 配置源展开出来的），
    // 搜索的热路径要用它。只靠 loadList() 的直连站是不行的 —— 展开出来的站不在
    // 那份清单里，热路径反而会比冷路径窄。路由必须把这个字段从响应里摘掉：
    // 它带着上游 api 地址（results 里已经 delete 掉了 sites，这里同理）。
    cmsTargets: cms,
  }
}

// ---------- 搜索聚合 ----------

// 「解说」类条目的排除规则。
//
// 采集站里同一部片常另有一条 [电影解说]（几分钟讲完剧情）和一条 [预告片]。搜索是按片名
// 匹配的，这两条跟正片得分**一样高**（实测都是 0.8），于是跟正片并排出现在结果里，
// 点进去才发现只有十几分钟 —— 《流浪地球》《甄嬛传》《满江红》三个都撞上了。
//
// 判定分两层，**都不能只对 vod_name 做子串匹配**：
//   - `type_name` / `vod_remarks` 本身就是分类字段，整串当关键词匹（「电影解说」「预告片」）
//   - `vod_name` 只在**括号内**匹（`流浪地球[电影解说]`）—— 不限定括号的话，片名里
//     含「片段」二字的正片会被误杀，而漏掉一条总比错杀一部强
//
// 想收窄或放宽就改这两个正则；想改成「降权而不是剔除」，把调用点从 return 换成减分即可。
const JUNK_RE = /解说|预告|花絮|片段|混剪|速看/
const JUNK_TAG_RE = /[[【(（][^\]】)）]*?(?:解说|预告|花絮|片段|混剪|速看)[^\]】)）]*[\]】)）]/

function isJunkEntry(name, typeName, remarks) {
  return JUNK_RE.test(typeName) || JUNK_RE.test(remarks) || JUNK_TAG_RE.test(name)
}

// vod_sub / vod_en 不是「另一个名字」，是**一堆**名字：
//   "吉诺密欧与朱丽叶2 / 神探福尔摩侏(港) / 糯尔摩斯(台) / Gnomeo & Juliet: Sherlock Gnomes"
// 整串拿去比，任何一个别名沾边都算命中 —— 数据里那批噪声全是这么进来的。
// 拆开逐条比，并把「(港)(台)」这种地区括注去掉：它是译名的注脚，不参与识别。
const ALIAS_SEP_RE = /\s*(?:\/|\\|\||｜|;|；|　|\s{2,})\s*/
const PAREN_RE = /[（(][^)）]{0,12}[)）]/g

function splitAliases(s) {
  return String(s || '')
    .split(ALIAS_SEP_RE)
    .map((x) => x.replace(PAREN_RE, ' ').trim())
    .filter(Boolean)
}

async function searchOne(src, queries, year) {
  const out = []
  const seen = new Set()
  // 逐个片名**分别**发请求，命中就停。
  //
  // 不能把几个片名拼成一个关键词：采集站把 wd 当模糊串，拼出来的是
  // 「流浪地球 The Wandering Earth」这种整串，中文站一条都召回不到 ——
  // 实测同一个站单发中文名出 17 个源，拼上英文名只剩 3 个。调用方按召回率
  // 从高到低传（本地化名在前），所以常见情况第一个就命中，只花一次往返。
  for (const q of queries) {
    const r = await httpGet(withQuery(src.target, `ac=detail&wd=${encodeURIComponent(q)}`))
    if (!r.ok) continue
    const j = parseLooseJson(r.text)
    if (!j || typeof j !== 'object') continue
    const list = Array.isArray(j.list) ? j.list : []
    for (const v of list.slice(0, SEARCH_SITE_LIMIT)) {
      const name = String(v.vod_name || '').trim()
      if (!name) continue
      const vodId = String(v.vod_id || '')
      // 第二个片名可能召回同一批条目，按 vodId 去重
      if (vodId && seen.has(vodId)) continue
      const sub = String(v.vod_sub || v.vod_en || '').trim()
      // 主名和别名**逐条**比，取最高分。中文站索引用的是中文 vod_name，但大多也存了
      // 原名，所以两边都要比 —— 只是不能再把别名整串当成一个字符串比（见 splitAliases）。
      const cands = [name, ...splitAliases(sub)]
      let score = 0
      for (const qq of queries) {
        for (const c of cands) score = Math.max(score, matchScore(qq, c))
        if (score === 1) break
      }
      if (score < SEARCH_MIN_SCORE) continue
      const y = pickYear(v.vod_year || v.vod_pubdate || v.vod_time)
      // 有年份就 ±1 硬过滤（剧集调用方不传年份：多季，加了反而缩结果）
      if (year && y && Math.abs(Number(y) - Number(year)) > 1) continue
      const typeName = String(v.type_name || '').trim()
      const remarks = String(v.vod_remarks || '').trim()
      // 解说/预告这类不是正片的条目在这里就丢掉，不写进 seen —— 后面的片名还能再召回
      if (isJunkEntry(name, typeName, remarks)) continue
      if (vodId) seen.add(vodId)
      // 类型与备注在各站是自己手填的（同一部片有「科幻片/科幻」「HD/正片」等写法），
      // 归一之后才好在列表里横向比。原文（remarks）照样带上：归一表判错时，
      // 排查要靠它，而且 mirrors 一直用的就是这个字段。
      const { status, quality } = normRemarks(remarks, typeName)
      out.push({
        sourceId: src.id,
        sourceName: src.name,
        kind: 'cms',
        vodId,
        vodName: name,
        vodSub: sub,
        year: y,
        typeName: normType(typeName),
        status,
        quality,
        remarks,
        score,
        lines: String(v.vod_play_from || '')
          .split('$$$')
          .map((s) => s.trim())
          .filter(Boolean),
      })
    }
    if (out.length > 0) break
  }
  return out
}

async function doSearch(queries, year) {
  const { sources } = await loadList()
  const direct = sources.filter((s) => s.kind === 'cms')
  // 只查上一轮探活确认活着的站：否则每翻一个详情页就要打 200 个站。
  //
  // 但探活缓存冷的时候**不能等** —— 冷探活要 20s（配置展开 8s + 探活 12s），
  // 叠上搜索预算就是 35s，前端早放弃了，服务端还在空烧。所以冷的时候
  // 先用直连采集站顶上，同时后台踢一轮探活，下次自然带上展开出来的站。
  const probe = cacheProbe.peek('all')
  const aliveIds = probe
    ? new Set(probe.results.filter((r) => r.kind === 'cms' && r.ok).map((r) => r.id))
    : null
  // 热路径用探活缓存里的完整清单，**不是** direct。
  //
  // direct 来自 loadList()，只有清单文件里直接列出的采集站；配置源展开出来的站
  // 只存在于探活缓存里。早先写成 direct.filter(aliveIds.has) 的话，展开出来的站
  // 因为不在 direct 里被全部滤掉 —— 热路径反而比冷路径窄，实测 19 个站出 3 个源，
  // 而冷路径 60 个站出 17 个源，等于探活白做。
  const pool = probe?.cmsTargets?.length ? probe.cmsTargets : direct
  const targets = aliveIds ? pool.filter((s) => aliveIds.has(s.id)) : pool
  const tasks = targets.map((s) => () =>
    limit(() => searchOne(s, queries, year).catch(() => []))
  )
  // nb 源**与这批搜索并发**跑，跑完再合池。放这里而不是塞进 tasks：
  // 它不走 limit 那 24 个槽（自己一条链、每次一个请求），塞进去反而会被
  // 上百个采集站挤在后面，把「冷路径超时」那套问题再演一遍。
  const nbSrc = sources.find((s) => s.kind === 'nb')
  const nbRows = nbSrc
    ? cacheNbSearch(`${queries.join('|')}|${year || ''}`, () =>
        nbSearchOne(nbSrc, queries, year).catch(() => [])
      )
    : Promise.resolve([])
  const { results, completed } = await runWithBudget(tasks, SEARCH_BUDGET)
  // 探活的补跑必须**等搜索全部结束**再踢。
  //
  // 早先是并发踢的，注释里还写着「同时」—— 实测这是错的：冷路径下 60 个搜索请求
  // 和 14 个配置展开 + 96 个探活目标一起抢那 24 个并发槽，带宽被打满之后采集站的
  // 响应集体超过 5s 单站超时，60 个站只剩 1 个有结果，而同一个站单独发请求是能出的。
  // 串行补跑只让下一轮搜索晚几秒拿到完整清单，比第一轮直接搜出个空壳强得多。
  if (!probe) cacheProbe('all', doProbe).catch(() => {})
  // nb 的条目**不并进上面的池子**，单独成行。
  //
  // 并进去的话，同分时它会被排到 mirrors 里 —— 而前端的 mirrors 只是一句
  // 「这些来源也有：…」的**纯文本提示，点不了**（PlaySources.jsx 的 mirrorHint）。
  // 那样 4kvms 就彻底是个摆设：搜得到、列得出来、但没有任何路径能播。
  // 单独成行还能顺带保住它和采集站真正不同的地方 —— 一个点开就是直链 m3u8，
  // 一个还要过解析站，混在一条里反而看不出区别。
  const nbList = (await nbRows).map((r) => ({ ...r, mirrors: [] }))
  const flat = results.flat()
  // 同一部片在很多站都有：按 片名+年份 聚合，取分最高的那条做主条目，
  // 其余来源收进 mirrors —— 用户既能看到「有几个站有」，也能按需切到别的站
  const groups = new Map()
  for (const row of flat) {
    const key = `${row.vodName}|${row.year}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const merged = []
  for (const rows of groups.values()) {
    rows.sort((a, b) => b.score - a.score)
    const [top, ...rest] = rows
    merged.push({
      ...top,
      mirrors: rest.map((r) => ({
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        vodId: r.vodId,
        remarks: r.remarks,
        lines: r.lines,
      })),
    })
  }
  merged.push(...nbList)
  merged.sort((a, b) => b.score - a.score)
  return {
    results: merged.slice(0, 80),
    searched: targets.length,
    // probed=false 表示这轮没走过探活筛选，结果只覆盖直连采集站
    probed: Boolean(probe),
    probedTotal: probe ? probe.total : 0,
    partial: !completed,
  }
}

// ---------- nb ( 4kvms ) 抓取 ----------
//
// 完整链路（2026-09 实测，每一步都有对应的注释解释为什么不能换别的做法）：
//
//   GET /search?q=<片名>        搜索页，卡片里能拿到 slug / 片名 / 年份
//   GET /play/<slug>            播放页，能拿到 userlink(访问令牌) 和剧集锚点
//                                每个锚点带 dataid + 自己的 /play/<secret>
//   build_play_url(...)   ← WASM 现算签名，得到 /video/play?p=&v=&q=&s=&t=&k=
//   GET 那个地址                JSON，data.quality_urls[].url 就是 m3u8
//
// 关键约束：
//   * 签名 = f(dataid, secret, 当前毫秒)，**不含**清晰度/令牌/nb-st。t 每次现取，
//     所以长驻进程 init 一次 wasm 就够（详见 nbsign.js）。
//   * 令牌必须来自同一次播放页请求，缺了会 401「请提供访问令牌」。
//   * 业务错误一律是 **HTTP 200 + code!=200**：4k→403「仅支持客户端播放」，
//     720/480→401「需要VIP」。只看 res.ok 会把它们全当成「这站没片」。
//   * 一个播放页的令牌能解析**该页所有集**（实测 7/7），所以详情页一次解析整季，
//     不像采集站那样能省 —— 不解析的话 episodes[].url 拿不到，前端就没得播。

const limitNb = createLimiter(NB_CONCURRENCY)
const cacheNbSearch = makeCache(TTL_SEARCH)
const cacheNbDetail = makeCache(TTL_DETAIL)

// 注意只接受一个参数：httpGet 的第三个参数是**重定向跳数**，不是 Referer。
// 早先这里传过 `${NB_ORIGIN}/play/<slug>` 当 Referer，实际被当成 hop 吃掉了
// （于是 hop 变成字符串，`hop >= MAX_HOPS` 永远为 false，重定向链就没人兜底了）。
// 那些地址本来就不验 Referer，去掉即可 —— 站点的 /video/play 与 oss.douyinbit.com
// 都是无 Referer 直接 200。
async function nbGet(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : NB_ORIGIN + pathOrUrl
  const r = await httpGet(url, PER_SITE_TIMEOUT)
  if (!r.ok) throw new Error(`http ${r.status}`)
  return r.text
}

// 从 /video/play 的 JSON 里挑一条能播的流地址。
// 挑不到就返回空串 —— 调用方据此把这一集整个丢掉，而不是给前端一条死链。
function nbPickStream(text) {
  let j
  try {
    j = JSON.parse(text)
  } catch {
    return ''
  }
  if (!j || j.code !== 200) return ''
  const list = Array.isArray(j.data?.quality_urls) ? j.data.quality_urls : []
  const usable = list.filter(
    (q) =>
      q &&
      typeof q.url === 'string' &&
      /^https?:\/\//i.test(q.url) &&
      // url 恰为 "1" 是站点自己的「VIP 锁位」约定（前端就是这么判的，判到就弹会员层）
      q.url !== '1' &&
      q.isvip !== true &&
      q.locked !== true
  )
  // 高码率优先。正常情况下只返回一条（我们只要了 1080），
  // 但站点偶尔一次给多条，按码率挑比按数组顺序稳。
  usable.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
  return usable[0]?.url || ''
}

// 按片名搜。策略与 searchOne 一致：**逐个**片名分别发请求，命中即停
// （拼成一串会同时丢掉中文和英文两个方向的召回，那边有实测注释）。
async function nbSearchOne(src, queries, year) {
  const out = []
  const seen = new Set()
  for (const q of queries) {
    let html
    try {
      html = await nbGet(`/search?q=${encodeURIComponent(q)}`)
    } catch {
      continue
    }
    for (const cand of nbParseSearch(html).slice(0, SEARCH_SITE_LIMIT)) {
      if (seen.has(cand.slug)) continue
      // 复用采集站那套保留汉字的匹配（不能换 titlematch.js，见本文件顶部注释）
      let score = 0
      for (const qq of queries) score = Math.max(score, matchScore(qq, cand.title))
      if (score < SEARCH_MIN_SCORE) continue
      // 年份只有 ±1 硬过滤，且卡片没年份时不否决
      if (year && cand.year && Math.abs(Number(cand.year) - Number(year)) > 1) continue
      if (isJunkEntry(cand.title, '', '')) continue
      seen.add(cand.slug)
      out.push({
        sourceId: src.id,
        sourceName: src.name,
        // 前端靠这个把 nb 行摘出来置顶成主源卡（它跟采集站不是一类东西：点开就是直链
        // m3u8，不用过解析站）。
        kind: 'nb',
        vodId: cand.slug,
        vodName: cand.title,
        vodSub: '',
        year: cand.year,
        // 播放页和搜索卡片上都没有类型 / 备注（只有热度和评分），留空。
        // 归一也就无从下手 —— 前端据此不摆这两个格子。
        typeName: '',
        status: '',
        quality: '',
        remarks: '',
        score,
        lines: [],
      })
    }
    if (out.length > 0) break
  }
  return out
}

// 详情：抓播放页 → 逐集签名换 m3u8。返回 { title, groups }。
async function nbDetail(slug) {
  const html = await nbGet(`/play/${encodeURIComponent(slug)}`)
  const { userlink, title, eps } = nbParsePlay(html)
  if (!userlink || eps.length === 0) return { title, groups: [] }

  // 先分组再按**线路**截断，不是对全集数组截断 —— 否则多线路时会把后面的线路整条切没
  const groups = nbGroup(eps)
    .map((g) => ({ ...g, episodes: g.episodes.slice(0, NB_MAX_EPS) }))
    .filter((g) => g.episodes.length > 0)

  const resolved = await Promise.all(
    groups.map(async (g) => ({
      from: g.from,
      episodes: (
        await Promise.all(
          g.episodes.map((e) =>
            limitNb(async () => {
              const path = await nbSign(e.dataid, e.secret, userlink)
              if (!path) return null
              const url = nbPickStream(await nbGet(path))
              // 解析不出来的单集直接不出现：前端把 episodes 当全集列表，
              // 塞一条死链进去会变成「能点、点了报错」，不如不给
              return url ? { name: `第${e.ep}集`, url } : null
            }).catch(() => null)
          )
        )
      ).filter(Boolean),
    }))
  )

  return { title, groups: resolved.filter((g) => g.episodes.length > 0) }
}

// ---------- 详情 ----------

async function doDetail(sourceId, vodId) {
  const { sources } = await loadList()
  // nb 是另一套接口，先分出去：它的 vodId 是播放页 slug，没有 ac=detail 可查。
  // year/typeName/remarks 站点播放页上都没有（只有热度和评分），留空 ——
  // 前端只读 groups，这三个字段在这里是给 API 形状的一致性兜底。
  const nbSrc = sources.find((s) => s.kind === 'nb' && s.id === sourceId)
  if (nbSrc) {
    const d = await cacheNbDetail(vodId, () => nbDetail(vodId))
    return {
      sourceId,
      sourceName: nbSrc.name,
      vodId,
      vodName: d.title,
      year: '',
      typeName: '',
      remarks: '',
      groups: d.groups,
    }
  }
  // 配置源展开出来的采集站**不在 loadList 里**，只活在探活缓存里 —— 实测 95 个探活目标
  // 有 36 个属于这类。只查 loadList 的话，搜索能搜到这些站、点开却永远「没有剧集」，
  // 而且因为它只在探活缓存里出现过，看起来像这个站没片，不像解析失败。
  const probe = cacheProbe.peek('all')
  const src =
    sources.find((s) => s.id === sourceId && s.kind === 'cms') ||
    probe?.cmsTargets?.find((s) => s.id === sourceId)
  if (!src) return null
  const r = await httpGet(withQuery(src.target, `ac=detail&ids=${encodeURIComponent(vodId)}`))
  if (!r.ok) throw new Error(`http ${r.status}`)
  const j = parseLooseJson(r.text)
  if (!j || typeof j !== 'object') throw new Error('非 JSON')
  const v = (Array.isArray(j.list) ? j.list : [])[0]
  if (!v) return null
  return {
    sourceId,
    sourceName: src.name,
    vodId: String(v.vod_id || vodId),
    vodName: String(v.vod_name || ''),
    year: pickYear(v.vod_year || v.vod_pubdate),
    typeName: String(v.type_name || ''),
    remarks: String(v.vod_remarks || ''),
    groups: parsePlayUrls(v.vod_play_from, v.vod_play_url),
  }
}

// ---------- 解析轮询 ----------

const STREAM_RE = /https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/gi

// 流地址基本都埋在 JSON/JS 字符串里，斜杠被转义成 \/ 或 \u002F。
// 不先还原就直接匹配 .m3u8 是**一条都扫不到**的 —— 这是最容易漏的一步。
function unescapeStreams(text) {
  return String(text)
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/&#x2[fF];/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&amp;/gi, '&')
}

// 光靠正则不够：解析站常把参数原样回吐，形如
//   https://jx.jiexila.com/?url=https://cdn.x/y/index.m3u8
// 这种**播放器页面**里也含 `.m3u8`，正则会连整个 wrapper 一起匹到，前端就会把
// 它当成直链标成 HLS —— 实测 pangujiexi 就是这么骗过 STREAM_RE 的。
// 要求 **pathname** 本身以扩展名结尾才算数：真直链的扩展名在路径上，
// wrapper 的扩展名只在查询串里。
function extractStreams(text) {
  const out = new Set()
  for (const m of unescapeStreams(text).matchAll(STREAM_RE)) {
    try {
      const p = new URL(m[0]).pathname.toLowerCase()
      if (p.endsWith('.m3u8') || p.endsWith('.mp4')) out.add(m[0])
    } catch {
      // 拼不成合法 URL 的直接丢
    }
  }
  return [...out]
}

async function doParse(videoUrl) {
  const { sources } = await loadList()
  const parsers = sources.filter((s) => s.kind === 'parse')
  const tasks = parsers.map((s) => () =>
    limit(async () => {
      const t0 = Date.now()
      const target = s.target.includes('{url}')
        ? s.target.replace('{url}', encodeURIComponent(videoUrl))
        : withQuery(s.target, `url=${encodeURIComponent(videoUrl)}`)
      // openUrl 才是主推用法：让解析站的 JS 播放器在**真实浏览器**里跑，
      // 带上真实 IP / Referer / Cookie。服务端抽出来的直链往往有时效和防盗链，
      // 拿到别的机器上多半 403 —— 抽不到才是常态，不是失败。
      const openUrl = target
      try {
        const r = await httpGet(target, PER_SITE_TIMEOUT)
        const ms = Date.now() - t0
        if (!r.ok) {
          return { id: s.id, name: s.name, ok: false, ms, streams: [], openUrl, note: `http ${r.status}` }
        }
        const found = extractStreams(r.text)
        return {
          id: s.id,
          name: s.name,
          ok: true,
          ms,
          streams: found,
          openUrl,
          // 只给「有没有命中」，不回传上游响应体
          note: found.length > 0 ? `内联了 ${found.length} 条直链` : '只有播放器壳',
        }
      } catch (e) {
        return {
          id: s.id,
          name: s.name,
          ok: false,
          ms: Date.now() - t0,
          streams: [],
          openUrl,
          note: e.message === 'timeout' ? '超时' : '连接失败',
        }
      }
    })
  )
  const { results, completed } = await runWithBudget(tasks, PROBE_BUDGET)
  // ok 优先于条数：只按条数排的话，连不上的站（条数必然 0）会排在「有响应但没抽到
  // 直链」的站前面，前端取前 N 个「用解析站打开」的链接时就会先列一堆死站。
  results.sort(
    (a, b) => Number(b.ok) - Number(a.ok) || b.streams.length - a.streams.length || a.ms - b.ms
  )
  return { url: videoUrl, results, partial: !completed }
}

// ---------- 限流 ----------
// server/ 是公网的，防止被当成采集 API 代理刷

const buckets = new Map()
const RATE_MAX = 90
const RATE_WINDOW = 5 * 60 * 1000

function rateLimited(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?'
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now - b.start > RATE_WINDOW) {
    buckets.set(ip, { start: now, n: 1 })
    if (buckets.size > 5000) buckets.clear() // 简单的内存保护
    return false
  }
  b.n++
  return b.n > RATE_MAX
}

// ---------- 路由 ----------

const router = express.Router()

router.use((req, res, next) => {
  if (!ENABLED) return res.json({ enabled: false, sources: [] })
  if (rateLimited(req)) return res.status(429).json({ error: 'too many requests' })
  next()
})

// 搜索/详情/解析的出口统一换化名。放在路由层而不是 doSearch 里，是因为那几层都有
// 30 分钟缓存，缓存里的对象得留着真实站名（mirrors 的合并、日志排查都要看它）。
function maskSearch(data) {
  return {
    ...data,
    results: (data?.results || []).map((r) => ({
      ...r,
      sourceName: pubName(r.sourceId),
      mirrors: (r.mirrors || []).map((m) => ({ ...m, sourceName: pubName(m.sourceId) })),
    })),
  }
}

router.get('/', async (req, res) => {
  const { enabled, sources, direct } = await loadList()
  // host 不外发：前端只在 title 提示里用它，换成化名之后那个提示本身也没信息量了
  res.json({
    enabled,
    sources: sources.map(({ id, kind }) => ({ id, name: pubName(id), kind })),
    // 直连片源整条随这个列表下发（地址本来就是要给前端播的，不是秘密）：它不做搜索，
    // 前端只能在本地下发的清单里按 tmdb id / 片名自己挑，多一次请求没有意义。
    direct,
  })
})

router.get('/probe', async (req, res) => {
  try {
    const kind = String(req.query.kind || 'all')
    const data = await cacheProbe('all', doProbe)
    const results = kind === 'all' ? data.results : data.results.filter((r) => r.kind === kind)
    // cmsTargets 是服务端内部用的（带着上游 api 地址），不能跟着 ...data 漏出去
    const { cmsTargets, ...rest } = data
    const pub = results.map(({ host, ...r }) => ({ ...r, name: pubName(r.id) }))
    res.json({ ...rest, results: pub, alive: pub.filter((r) => r.ok).length })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

router.get('/search', async (req, res) => {
  // q 可重复：采集站索引的是中文名，英文名召回很差，前端两个都发
  const raw = req.query.q
  const queries = (Array.isArray(raw) ? raw : [raw])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  if (queries.length === 0) return res.status(400).json({ error: 'q is required' })
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : ''
  try {
    const key = `${queries.join('|').toLowerCase()}:${year}:${probeGen}`
    res.json(maskSearch(await cacheSearch(key, () => doSearch(queries, year))))
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

router.get('/detail', async (req, res) => {
  const sourceId = String(req.query.sourceId || '').trim()
  const vodId = String(req.query.vodId || '').trim()
  if (!sourceId || !vodId) return res.status(400).json({ error: 'sourceId and vodId are required' })
  if (!/^[\w-]{1,64}$/.test(sourceId) || !/^[\w.-]{1,64}$/.test(vodId)) {
    return res.status(400).json({ error: 'invalid id' })
  }
  try {
    const data = await cacheDetail(`${sourceId}:${vodId}`, () => doDetail(sourceId, vodId))
    // 「查不到」是正常空结果，用 200 返回避免浏览器把 404 打进控制台
    res.json(data ? { ...data, sourceName: pubName(sourceId) } : { sourceId, vodId, groups: [] })
  } catch (e) {
    res.status(502).json({ error: e.message, groups: [] })
  }
})

router.get('/parse', async (req, res) => {
  const url = String(req.query.url || '').trim()
  // url 只作为 query 参数转发给白名单内的解析站，不参与服务端目标选择；
  // 这里做前缀和长度校验，避免被当成任意 URL 的中转
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return res.status(400).json({ error: 'invalid url' })
  }
  try {
    const d = await doParse(url)
    // id 要留着（前端拿它当 key、后端拿它排序），只换展示名
    res.json({ ...d, results: d.results.map((r) => ({ ...r, name: pubName(r.id) })) })
  } catch (e) {
    res.status(502).json({ error: e.message, results: [] })
  }
})

export default router
