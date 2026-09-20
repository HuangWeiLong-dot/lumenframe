import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { canPlayInline, epLabel } from '../playMedia'

// 播放台：**常驻**在「在线播放」区块底部的一块，不盖整页、也不藏起来。
//
// 为什么常驻而不是选中才出现：这一块的存在本身就是给用户的答案 ——「画面会出现在这里」。
// 常驻还把 16:9 的位置先占住，选片之后不会有一下高度跳变；空闲态那句邀请语也顺势
// 教会了用法（上面选一集 → 这里出画面）。
//
// 播放台只负责「放」。选片、换线路、挑剧集全在上面的结果列表里 —— 两个面各管一件事，
// 卡片因此不必再塞一层播放控件，嵌套少一层。
//
// **控制条是自己画的，没用 <video controls>**。原因是原生控件跟这个站的样子对不上：
// 圆角、系统蓝、和各平台不一致的按钮集，一块黑底上突兀地长出一套别的东西。自绘之后
// 进度条、按钮、字色都进到站点既有的语汇里（方角、细线、zinc 灰阶），也才有地方放
// 缓冲进度这种原生控件给不了的信息 —— 这些 CDN 直出流卡起来，最有用的恰恰是
// 「前面还有多少缓冲」。键盘操作、aria、拖动都按原生控件的行为对齐，不因为自绘而少。
//
// 状态由头部那个方块的颜色表达（空闲/加载/可播/失败），不再另写一行文字 ——
// 方块本身是信息，不是装饰。
//
// 「聚合来源」「CDN 直出」那类交代**不在这里**，在 PlaySources 的 SourceNotice 里：
// 它们讲的是这一整块功能的来路，跟某条流、跟这个播放器都没有关系。
//
// 关于「能不能播」：这些直链大多是第三方 CDN 直出，实测 8 个 host 里 6 个既可达又带
// `Access-Control-Allow-Origin: *`（另两个是证书过期和超时，代理也救不了）。所以浏览器
// 直连能覆盖大部分，**不做服务端流转发** —— 那等于让 API 主机去承载整部片子的流量。

const HLS_RE = /\.m3u8(\?|#|$)/i

// 分片请求一律不带 Referer。这不是洁癖，是有些源**只有**这样才给。
//
// 实测 sns-open-qc.xhscdn.com（小红书 CDN）：无 Referer → 206；Referer 是
// www.xiaohongshu.com → 206；其余任何 Referer（含我们自己的 localhost / *.github.io）
// → 403。而浏览器对跨域子资源默认走 strict-origin-when-cross-origin，也就是**必发**
// 一个我们自己的 origin —— 于是整条流一个分片都取不回来，清单能读到、画面全黑。
//
// 不带 Referer 对我们是**弱占优**的：第三方页面本来就凑不出对方站点自己的 Referer，
// 所以「认 Referer」的源无论怎样都过不去；不带则同时满足「不校验」与「只认无 Referer」
// 这两类，没有已知的反例。
//
// hls.js 没有 referrerPolicy 这个配置项（grep 过 dist，一处都没有），只能换加载器：
// light 版有导出 FetchLoader，而 fetchSetup 拿到的 initParams 是
// { method, mode, credentials, signal, headers }，补一个字段就够。
const noRefSetup = (context, initParams) =>
  new Request(context.url, { ...initParams, referrerPolicy: 'no-referrer' })

// 少数清单会把个别分片包一层自家主机的中转，形如 /ets/<时间戳>-<十六进制>/<base64>。
// 实测 oss.douyinbit.com 那份 1691 片里有 56 片长这样，这一层已经 404（换 Referer、
// 加 Origin、带 UA 都试过），但 base64 解出来正是原始 CDN 地址 —— 抽 4 个，4/4 可取回。
// 顺手修掉，比让用户在第 1 分 30 秒卡住强。
//
// 但**不能为了它让所有源都多付一次清单请求**：按 host 记账，某个 host 的清单只要
// 干净过一次（绝大多数都是），以后直接原样交给 hls.js，连这次预取都省掉。
const etsClean = new Set()

const ETS_LINE_RE = /^\/?ets\/\d+-[0-9a-fA-F]+\/([A-Za-z0-9_-]+={0,2})$/

function decodeEtsToken(token) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const out = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return /^https?:\/\//i.test(out) ? out : ''
}

// 命中 /ets/ 才改写，且改写后**必须**每一行非注释都是绝对地址。
//
// 换掉的行我们自己会写成绝对地址，但其余相对行（分片、`#EXT-X-KEY:URI="…"` 里的密钥）
// 一旦进了 blob，就会按 blob 地址去解析，全部指错地方。所以出现任何我们没预期的
// 相对形式就整体放弃 —— 返回原地址，让 hls.js 按老样子去跑，它至少能报出真实的错。
async function prepareSource(url) {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return url
  }
  if (etsClean.has(host)) return url

  try {
    // 8s 超时。这一跳只是**预处理**：读不回来就该照原样交给 hls.js，让它去报真实的错。
    // 没有超时的话，一个连得上但不回包的 host 会让播放台一直停在「正在加载播放流…」——
    // 和 hls.js 那条路上「清单没解析出来还硬自愈」是同一类死法。
    // AbortSignal.timeout 老 Safari（<16.4）没有，拿不到就不带 —— 那是降级，不是错。
    const r = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout?.(8000) })
    if (!r.ok) return url
    const text = await r.text()
    if (!text.includes('/ets/')) {
      etsClean.add(host)
      return url
    }

    let hit = 0
    const lines = text.split('\n')
    const fixed = lines.map((line) => {
      const m = ETS_LINE_RE.exec(line.trim())
      if (!m) return line
      const target = decodeEtsToken(m[1])
      if (!target) return line
      hit++
      return target
    })
    if (!hit) {
      etsClean.add(host)
      return url
    }

    for (const line of fixed) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      if (!/^https?:\/\//i.test(s)) return url // 有我们处理不了的相对形式，整体放弃
    }

    return URL.createObjectURL(new Blob([fixed.join('\n')], { type: 'application/vnd.apple.mpegurl' }))
  } catch {
    return url // 读不回来就照原样交给 hls.js，让它自己去报错
  }
}

const BTN = 'inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 text-xs transition'
const ON_DARK = 'border-white/25 text-white/75 hover:border-white hover:bg-white hover:text-black'

// 方块颜色 = 状态。zinc 空闲、amber 加载、emerald 可播、red 失败 ——
// 色值沿用站点既有的 StatusBadge 语汇，不引入新颜色。
const TONE = {
  idle: 'bg-zinc-600',
  loading: 'bg-amber-400',
  ready: 'bg-emerald-400',
  error: 'bg-red-500',
}

// 时间码。超过一小时才出小时位 —— 电影几乎都在一小时以上，但剧集不是，
// 固定 h:mm:ss 会让 42 分钟的剧集也顶一个「0:」在前面。
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

// ---------- 控制条图标 ----------
//
// 填充式（fill）而不是描边式：控制条压在画面上，描边在亮场景里会糊掉。
// 尺寸统一 14px，跟头部那排 7 高的按钮同级。

function IconPlay({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5-13-7.5z" />
    </svg>
  )
}

function IconPause({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z" />
    </svg>
  )
}

function IconVolume({ muted }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" />
      {muted ? (
        <path d="M15.2 9.2 16.6 7.8 19.4 10.6 22.2 7.8 23.6 9.2 20.8 12l2.8 2.8-1.4 1.4-2.8-2.8-2.8 2.8-1.4-1.4 2.8-2.8z" />
      ) : (
        <path d="M15.5 8.5a4.5 4.5 0 0 1 0 7v-1.7a2.9 2.9 0 0 0 0-3.6zM17.8 5.6a8 8 0 0 1 0 12.8v-1.7a6.4 6.4 0 0 0 0-9.4z" />
      )}
    </svg>
  )
}

// 集数选择。一个「三条短横 + 一列方块」的列表图标，跟控制条上其余命中式图标同一种笔法。
function IconEpisodes() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M3 5h3.5v3H3zM3 10.5h3.5v3H3zM3 16h3.5v3H3zM9.5 5.6h11.5v1.8H9.5zM9.5 11.1h11.5v1.8H9.5zM9.5 16.6h11.5v1.8H9.5z" />
    </svg>
  )
}

function IconExpand({ exit }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      {exit ? (
        <path d="M9 3h2v6H5V7h4V3zm4 0h2v4h4v2h-6V3zM5 15h6v6H9v-4H5v-2zm10 0h4v2h-4v4h-2v-6z" />
      ) : (
        <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" />
      )}
    </svg>
  )
}

// 集数选择内建在播放器里，而不是只留在上面那张卡片上。理由：**换集是看剧时最频繁的动作**，
// 而卡片在列表里、播放台在列表下方 —— 每换一集都要滚上去、展开、点一下、再滚回来，
// 这条路上有一半时间花在找那个按钮。放在播放器里之后，「换集」和「看下一集」是同一个视线。
// （卡片上那个网格照旧在，它管的是「哪条来源、哪条线路」，不重复。）
//
// 所以 item 里除了地址，还带着**这一条线路的整张剧集表**（见 PlaySources 的 onPlay）。
// 播放器只负责换 url 和集名，片名/来路/剧集表都从 item 原样留用。
export default function VideoPlayer({ item, onClose, onSwitch }) {
  const { t } = useI18n()
  const videoRef = useRef(null)
  const wrapRef = useRef(null)
  const barRef = useRef(null)
  // 卸载/换源之后 hls.js 和 <video> 还会继续抛事件，用 ref 而不是闭包变量，
  // 好让 JSX 上的 onError 也能看见同一个标志
  const disposedRef = useRef(false)
  // 走 hls.js 时 <video> 是挂在 MSE 上的，缓冲抖动会让它抛 media error，而 hls.js
  // 自己正在 recoverMediaError 处理 —— 有 hls 实例在就说明这条流归它管，
  // <video> 的 onError 必须让路，否则一次瞬时抖动就把能播的流判死。
  const hlsRef = useRef(null)
  // 「原生认 HLS」这件事不能只信 canPlayType。实测 Chrome 153（Windows 153 的
  // HeadlessChrome 也一样）对 application/vnd.apple.mpegurl 回的是 "maybe"，
  // 可真把 TS 清单递给 <video> 却只得到一个 MEDIA_ERR_SRC_NOT_SUPPORTED ——
  // 清单取得到（200）、Content-Type 也确实是 application/vnd.apple.mpegurl，
  // 它就是解不了。于是原生那条路一个分片都拉不到，hls.js 那条根本走不到。
  //
  // 所以原生只当「先试一下」，试失败就翻成 hls.js。这里记的是**哪个地址**上
  // 已经失败过，而不是一个布尔：换片时它自然失效，不必另外清账。
  const [forceHls, setForceHls] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [reason, setReason] = useState('')
  // 第几次尝试拉这条流。它不是给用户看的数字，只是 effect 的一个触发源：
  // effect 的依赖里只有 url，而「刚刚失败的那一集再点一次」url 是不变的 ——
  // 不变，effect 就不重跑，屏幕上的错误态于是原样挂着，用户那一下点了跟没点一样。
  // 重试按钮 +1，下面那个 effect 在「item 换了对象但地址没换」时也 +1。
  const [attempt, setAttempt] = useState(0)

  // ---- 自绘控制条的状态 ----
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)
  // 集数选择的展开态。它跟着 url 一起关（见下面那个 [url] 的 effect）：选完一集就该看见画面。
  const [pickOpen, setPickOpen] = useState(false)
  // 画面正中那一下闪现的播放/暂停图标。**画面里必须有回声**：这个播放台的自绘控制条
  // 在播放时是自动收起的，点一下画面（最常用的操作）如果什么都不动，用户没法判断
  // 这一下是按到了还是点空了 —— 尤其在这些直出流上，暂停和卡住长得一模一样。
  // 它只闪一下、不常驻（常驻就成了遮挡），所以由定时器清掉，透明度过渡做淡出。
  const [tap, setTap] = useState({ on: false, kind: 'play' })
  const tapTimerRef = useRef(0)
  // 进度条上指针的位置（0~1）。悬停就出，不只在拖动时出 ——
  // 「这条流总共多久、我想去的那一段在哪儿」是悬停时唯一想问的事。
  const [hover, setHover] = useState(null)
  // 指针停在**控制条这一带**（画面下缘那一条）。停在那儿就不自动收控制条。
  //
  // 这不是手感问题，是「点不到」的问题：控制条收起时整条是 pointer-events-none，
  // 那时在下缘点一下会**穿透到画面**上，被当成「播放/暂停」—— 用户看到的是
  // 「点了有反应（画面动了），可我想点的那个组件根本没出来」。全屏里尤其致命：
  // 整个屏幕都是画面，下缘是唯一能碰到控制条的地方。
  const [atBottom, setAtBottom] = useState(false)
  // 中途卡住的回声。这些直出流「卡住」和「暂停」在画面上长得一模一样：控制条在播放时
  // 是自动收起的，而卡住时 `playing` 仍然是 true（`pause` 事件根本不会来），所以整块
  // 屏幕上没有任何东西改变 —— 用户只能动一下鼠标才知道是不是卡了。缓冲进度条回答了
  // 「前面还有多少」，但前提是它得在屏幕上：这里让它在卡住期间**不再自动收**。
  //
  // 等 700ms 才亮：HLS 每次切分片都可能闪一下 waiting，立刻亮等于给正常播放加噪点。
  const [stalled, setStalled] = useState(false)
  const stallTimerRef = useRef(0)
  const clearStall = useCallback(() => {
    clearTimeout(stallTimerRef.current)
    setStalled(false)
  }, [])
  const markStall = useCallback(() => {
    clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => setStalled(true), 700)
  }, [])

  // 拖动进度时不能用 timeupdate 回写 current：那会把滑块从手指底下拽回去
  const draggingRef = useRef(false)
  // 已经跳过去、还没等到 seeked 的目标位置（null = 没有在途的跳转）。见 seekTo。
  const seekTargetRef = useRef(null)
  const hideTimerRef = useRef(0)

  const url = item?.url || ''
  const on = Boolean(url)
  // 没选片时 status 还停在上一次的 error 上 —— 空闲态的方块必须是锌灰，不能继承旧状态
  const phase = on ? status : 'idle'

  // 这一条流所在线路的剧集表。一条都没有（电影、手绑直链）或只有一集时不摆集数选择 ——
  // 那时候它只是个多出来的按钮，点开是一个只有一格的列表。
  const episodes = useMemo(
    () => (Array.isArray(item?.episodes) && item.episodes.length > 1 ? item.episodes : []),
    [item]
  )
  // 正在播的那一集在表里的位置。**取不到就不摆这个控件**（-1）：那说明这条地址不是
  // 表里来的，切换只会得到「点了没反应」。
  const epIdx = episodes.findIndex((e) => e.url === url)

  // 控制条的显隐就**两条规则**：
  //   · 暂停 / 加载中 / 出错 —— **常驻**。那三种状态下它都是「接下来要点什么」的答案，
  //     藏起来只会让用户先晃一下鼠标才敢动；暂停时尤其要一直在，因为那正是要拖动的时候。
  //   · 播放中 —— 鼠标动过就亮，2.6s 没动静再自己收。用的是「鼠标动过」而不是
  //     「鼠标在不在画面里」：指针停在画面上不动，就该让画面干净。
  // 另两条不改可见性，只**推迟**收纳：集数选择开着（正在用的东西，不碰鼠标就收掉是荒唐的），
  // 以及指针就停在控制条那一条上（这一条不只是手感 —— 收起时整条是 pointer-events-none，
  // 停在那儿的指针点下去会穿透到画面上，变成「点了有反应，但我想点的组件根本没出来」）。
  // 卡住时同理不收：那正是用户最想知道「前面还有多少缓冲」的一刻，而这一刻指针多半
  // 一动不动（人就在等），不收的话他永远看不到那根缓冲条。
  const showUi = uiVisible || !playing || status !== 'ready' || pickOpen || atBottom || stalled
  const pct = (v) => `${duration > 0 ? Math.min(100, (v / duration) * 100) : 0}%`

  const fail = useCallback((key) => {
    if (disposedRef.current) return
    // 流死在跳转途中时那个 seeked 不会来了，进度条会永远停在目标位置不动
    seekTargetRef.current = null
    setReason(key)
    setStatus('error')
  }, [])

  const bump = useCallback(() => {
    setUiVisible(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setUiVisible(false), 2600)
  }, [])

  // 闪一下播放/暂停。触发点是 <video> 自己的 play/pause 事件，不是那几个按钮 ——
  // 点画面、按空格、按 k、自动播放、乃至播放器自己从缓冲里恢复，走的都是同一条路，
  // 挂在事件上就只有一份真相。520ms 够看清，又不至于挡着画面。
  const showTap = useCallback((kind) => {
    setTap({ on: true, kind })
    clearTimeout(tapTimerRef.current)
    tapTimerRef.current = setTimeout(() => setTap((s) => ({ ...s, on: false })), 520)
  }, [])

  useEffect(
    () => () => {
      clearTimeout(hideTimerRef.current)
      clearTimeout(tapTimerRef.current)
      clearTimeout(stallTimerRef.current)
    },
    []
  )

  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      const p = v.play()
      if (p?.catch) p.catch(() => {}) // 自动播放被拦是常事，交给用户点
    } else {
      v.pause()
    }
  }, [])

  const nudge = useCallback((delta) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta))
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (v) v.muted = !v.muted
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
      return
    }
    // iPhone 上**元素级** Fullscreen API 根本不存在（Safari 只给 <video> 开了
    // webkitEnterFullscreen），没有这条退路的话那个按钮按下去什么都不会发生 ——
    // 而这个播放台恰好是要在 iOS 上走原生 HLS 的（省掉整个 hls.js 分片）。
    // 走这条路时是全交给系统播放器，自绘控件不见了，那是 iOS 的正常形态。
    if (el.requestFullscreen) el.requestFullscreen()
    else videoRef.current?.webkitEnterFullscreen?.()
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // 播放中才自动收控制条；一暂停就立刻显出来
  useEffect(() => {
    if (playing && status === 'ready') bump()
    else setUiVisible(true)
  }, [playing, status, bump])

  // 播放台在列表**下方**，而用户刚点的是列表上方的某个剧集 —— 不滚一下的话
  // 那块在他视野之外，"没反应"和"放不了"就分不清了。
  // block:'nearest' 是关键：已经看得见就一动不动，不要为了播放把页面硬拽一下。
  // 平滑滚动要**自己**查 prefers-reduced-motion —— 这个选项不归 CSS 管，
  // 浏览器不会替我们尊重那条设置。
  useEffect(() => {
    if (!url) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    wrapRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
  }, [url])

  // 「同一条地址又点了一次」= 重试。判据有三条：item 的**引用**变了、url 没变、
  // 而且此刻正停在错误态上。PlaySources 每次 onPlay / onSwitch 都给一个新对象，
  // 换集时 url 也跟着变，所以前两条只在「用户把刚失败的那一集/那条直连又点了一遍」
  // 时成立 —— 而那是用户面对「打不开」唯一会做的动作，不该毫无反应。
  //
  // 第三条（错误态）是必须的：正在播的时候再点一次同一集，用户想要的绝不是
  // 「从头重来」。只有屏幕上明摆着一条「拉流失败」时，重来才是他想要的那个意思。
  const lastItemRef = useRef(null)
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])
  useEffect(() => {
    const prev = lastItemRef.current
    lastItemRef.current = item
    if (!item || !prev) return
    if (item !== prev && item.url === prev.url && statusRef.current === 'error') setAttempt((n) => n + 1)
  }, [item])

  // 换源时把这套自绘状态清干净：不清的话上一条流的时间码、进度、缓冲会留在新片上，
  // 而 <video> 要等 loadedmetadata 才回新值，中间那段就是错的。
  // 集数选择也一起收：集数是在里面选的，选完就该看见画面（外部换源同理）。
  useEffect(() => {
    setCurrent(0)
    setDuration(0)
    setBuffered(0)
    setPlaying(false)
    setUiVisible(true)
    setPickOpen(false)
    setHover(null)
    // 在途的跳转跟着上一条流一起作废，否则新的那一条会一直等一个不会来的 seeked
    seekTargetRef.current = null
    // 上一条流的卡住态不能留给下一条
    clearStall()
  }, [url, clearStall])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !url) return undefined
    disposedRef.current = false
    setStatus('loading')
    setReason('')

    // 自动播放不保证成功：带声音的自动播放会被拦，这里只「尽力而为」，
    // 失败就当无事发生 —— 用户自己点一下即可。
    const tryPlay = () => {
      const p = el.play()
      if (p?.catch) p.catch(() => {})
    }

    let hls = null
    let objUrl = ''
    const teardown = () => {
      disposedRef.current = true
      if (hls) {
        hls.destroy()
        hls = null
      }
      hlsRef.current = null
      if (objUrl) {
        URL.revokeObjectURL(objUrl)
        objUrl = ''
      }
      el.pause()
      el.removeAttribute('src')
      el.load()
    }

    // 两条不需要 hls.js 的路：mp4 直接给 src；Safari / iOS 原生就认 HLS。
    // 后者能省掉整个 ~110 KiB 的 hls.js 分片。
    //
    // 判据只当参考 —— canPlayType 说 "maybe" 的浏览器里就有解不了的（见 forceHls
    // 那段说明）。所以这里只是**先试**：真报 SRC_NOT_SUPPORTED 时由下面 <video> 的
    // onError 把 forceHls 翻过来，effect 重跑一次改走 hls.js。真能原生播的浏览器
    // （Safari / iOS）一次都不会翻，那 110 KiB 就还是省住了。
    if (!HLS_RE.test(url) || (forceHls !== url && el.canPlayType('application/vnd.apple.mpegurl'))) {
      el.src = url
      el.addEventListener('loadedmetadata', tryPlay)
      return () => {
        el.removeEventListener('loadedmetadata', tryPlay)
        teardown()
      }
    }

    // hls.js 走**动态 import**：分片只在用户真的点过播放之后才下载，首页完全不碰它。
    // 和 supabase 那条规则一样（配置缺失时分片根本不加载），只是这里更极端一点。
    //
    // 用 light 版而不是完整版：砍掉字幕轨、多音轨和 DRM，产物 118 KiB gzip（完整版
    // 约 160 KiB），而且**不写进 index.html**，只在点播放时才拉。
    // 「light 会不会把加密流也砍了」验证过：拿线上那条 AES-128 的清单喂给 light 的
    // M3U8Parser，2480 个分片全部带上了 decryptdata（method=AES-128，相对 URI
    // `enc.key` 也已按清单地址解析成绝对地址）——解密器完整保留，别为了再小一点去换别的版本。
    let cancelled = false
    import('hls.js/light')
      .then(async ({ default: Hls, ErrorTypes, FetchLoader, fetchSupported }) => {
        if (cancelled || disposedRef.current) return
        if (!Hls.isSupported()) return fail('play.errUnsupported')

        // 清单先过一道 prepareSource：绝大多数源原样返回，只有命中 /ets/ 包装的
        // 才会被改写成一个 blob 地址（见该函数上方的说明）。
        const src = await prepareSource(url)
        if (cancelled || disposedRef.current) {
          if (src.startsWith('blob:')) URL.revokeObjectURL(src)
          return
        }
        if (src.startsWith('blob:')) objUrl = src

        hls = new Hls({
          enableWorker: true,
          // FetchLoader 要 self.fetch / Request / AbortController / ReadableStream 齐备，
          // 老 Safari 可能缺 —— 缺就退回 hls.js 默认的 XhrLoader（那条路改不了 Referer，
          // 但至少别的源不受影响）。见文件头 noRefSetup 的说明。
          ...(fetchSupported() ? { loader: FetchLoader, fetchSetup: noRefSetup } : {}),
        })
        hlsRef.current = hls
        // 网络/媒体类致命错误先让它自愈一次（换 CDN 重试、跳过分片），
        // 只有第二次还失败才认输 —— 这类源抖动很常见，一次就报错太吵。
        //
        // 但自愈有个前提：**清单本身得已经读进来了**（levels 非空）。清单 404 / 403 /
        // 域名没了的时候，hls.js 自己已经按它的策略重试过一轮（manifestLoadPolicy
        // 默认重试一次），此刻 hls.levels 还是空的 —— startLoad() 这时什么也不做，
        // 也不会再抛第二次错，于是**播放台永远停在「正在加载播放流…」**：没有报错、
        // 没有换线路的提示，只有一个转不完的圈。实测（2026-09-20）喂一份 404 的清单
        // 就是这个症状，而这恰恰是最该说话的一种失败（源已失效）。
        // 所以：清单没解析出来就直接认输，别再自愈。
        let recovered = false
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return
          if (!recovered && (hls.levels?.length || 0) > 0) {
            if (data.type === ErrorTypes.NETWORK_ERROR) {
              recovered = true
              hls.startLoad()
              return
            }
            if (data.type === ErrorTypes.MEDIA_ERROR) {
              recovered = true
              hls.recoverMediaError()
              return
            }
          }
          hls.destroy()
          hls = null
          hlsRef.current = null
          fail(data.type === ErrorTypes.NETWORK_ERROR ? 'play.errNetwork' : 'play.errMedia')
        })
        hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)
        hls.loadSource(src)
        hls.attachMedia(el)
      })
      .catch(() => fail('play.errUnsupported'))

    return () => {
      cancelled = true
      teardown()
    }
  }, [url, fail, forceHls, attempt])

  // 画面上的指针移动：既给控制条续命，也判断指针是不是停在控制条那一条上。
  // 下缘那一带（控制条高约 68px）够宽容，又不会盖住画面主体 —— 宁可多留 20px，
  // 也别让用户「明明对着进度条，控制条却收起来了」。
  //
  // 但它得**跟着播放台的高度缩**：窄屏上播放台本身只有两百来像素高，固定 96px
  // 等于「指针在画面下半部就算停在控制条上」，控制条于是再也不会自动收 ——
  // 自动收本身是这块画面的主要好处（播放时不留一条黑边在下面），不能这么丢掉。
  const CONTROL_ZONE = 96
  const stageMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAtBottom(e.clientY > r.bottom - Math.min(CONTROL_ZONE, r.height * 0.4))
    bump()
  }

  // 进全屏先亮一次控制条：那一下点击落点就是全屏按钮，用户的手还在原处，
  // 而这时控制条的位置已经换了一处 —— 不亮的话屏幕上什么都没有，看着像卡住了。
  useEffect(() => {
    if (fullscreen) bump()
  }, [fullscreen, bump])

  // ---- 进度条：拖动、点击、键盘 ----

  const ratioAt = (clientX) => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    if (!r.width) return 0
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  // 跳转是**异步**的：`currentTime` 写下去之后，到 `seeked` 之前 `timeupdate` 报回来的
  // 还是旧位置。几百毫秒里进度条会先弹回去、再跳到目标 —— 用户看到的又是
  // 「点的位置和它跳到的位置不一样」。所以按下之后到 `seeked` 之间，显示的**就是**
  // 目标位置，元素说什么都不听（见 onTimeUpdate / onSeeked）。
  const seekTo = (ratio) => {
    const el = videoRef.current
    if (!el || !Number.isFinite(el.duration)) return
    const t = ratio * el.duration
    seekTargetRef.current = t
    el.currentTime = t
    setCurrent(t)
  }

  const barDown = (e) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const r = ratioAt(e.clientX)
    setHover(r)
    seekTo(r)
  }

  // 悬停和拖动共用一个 pointermove：拖动时它顺带就是「跳到哪儿」，不拖时只报位置。
  const barMove = (e) => {
    const r = ratioAt(e.clientX)
    setHover(r)
    if (draggingRef.current) seekTo(r)
  }

  const barUp = (e) => {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    // 在进度条**外面**松手（拖出去了）：指针离开的事件被 capture 吃掉了，得自己收，
    // 否则那枚时间气泡会一直挂在条上。条内松手保留 —— 指针还悬着，气泡就该在。
    const el = barRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right) setHover(null)
    }
  }

  const barKey = (e) => {
    const step = e.shiftKey ? 30 : 5
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      nudge(-step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      nudge(step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      seekTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      seekTo(1)
    }
  }

  // 键盘快捷键挂在**画面**上：焦点在进度条或音量条上时，它们的 onKeyDown 已经
  // preventDefault 过了，这里用 defaultPrevented 让路，免得按一下方向键既调音量又跳时间。
  const stageKey = (e) => {
    if (e.defaultPrevented) return
    const el = videoRef.current
    if (!el) return
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      nudge(-5)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      nudge(5)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      el.volume = Math.min(1, el.volume + 0.1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      el.volume = Math.max(0, el.volume - 0.1)
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      toggleMute()
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      toggleFullscreen()
    } else if (e.key === 'Escape' && pickOpen) {
      // 全屏里的 Escape 归浏览器（退出全屏），这里只管集数选择
      e.preventDefault()
      setPickOpen(false)
    }
  }

  return (
    <div
      ref={wrapRef}
      // 全屏时**不留任何外框**：mt-4 的留白和 border 这时都会变成画面之外的一圈边，
      // 而全屏的意思就是「只剩画面」。头行同理，见下面。
      className={`${fullscreen ? 'flex h-full w-full flex-col bg-black' : 'mt-4 border border-zinc-900'}`}
    >
      {/* 头行（状态方块 + 片名 + 来路 + 关闭）在全屏里**不渲染**。
          它是播放台挂在页面里的那一截壳：全屏时黑底占着顶上一条，画面就被顶下去一截，
          用户看到的是「全屏了，上面还有一条黑边」。全屏里退出靠 Esc / F / 控制条那个按钮，
          关闭播放台不必在全屏里做 —— 关掉之后还停在全屏空台上才是怪事。 */}
      {!fullscreen && (
        <div className="flex items-center gap-2.5 bg-zinc-900 px-3 py-2 text-white">
          <span className={`h-2 w-2 shrink-0 ${TONE[phase]}`} aria-hidden="true" />

          {/* 空闲时头行只有台名；选中后才把「片名 | 线路·剧集」摆出来。
              中间那条竖线是分隔，不是装饰 —— 片名和来路是两种信息。 */}
          {item ? (
            <span className="flex min-w-0 flex-1 items-center gap-2.5 text-xs">
              <span className="truncate font-medium text-white/90">{item.title}</span>
              {/* 来路 = 「来源 · 线路」+ 正在播的那一集。两截分开存（见 PlaySources 的
                  onPlay），播放器内换集只换后面那截。 */}
              {(item.subtitle || item.epName) && (
                <>
                  <span className="h-3 w-px shrink-0 bg-white/25" aria-hidden="true" />
                  <span className="truncate text-white/50">
                    {[item.subtitle, item.epName].filter(Boolean).join(' · ')}
                  </span>
                </>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-white/55">{t('play.stage')}</span>
          )}

          {on && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('play.playerClose')}
              className={`${BTN} px-2.5 ${ON_DARK}`}
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div
        // min-h-0 是 flex 子项的必须项：不给的话它按内容高度撑，flex-1 收不住，
        // 画面就会被自己顶出屏幕外。
        className={`relative bg-black ${fullscreen ? 'min-h-0 flex-1' : 'aspect-video'} ${
          on && !showUi && status === 'ready' ? 'cursor-none' : ''
        }`}
        onClick={on ? toggle : undefined}
        onPointerMove={on ? stageMove : undefined}
        // 进入画面和按下都算「用户来了」：只靠 pointermove 的话，指针**停在原地**
        // 时点一下是不会亮控制条的（全屏里最常见 —— 屏幕就一个画面，指针常常停着不动）。
        onPointerEnter={on ? bump : undefined}
        onPointerDown={on ? bump : undefined}
        onPointerLeave={on ? () => setAtBottom(false) : undefined}
        onKeyDown={on ? stageKey : undefined}
        tabIndex={on ? 0 : -1}
        role={on ? 'button' : undefined}
        aria-label={on ? t('play.togglePlay') : undefined}
      >
        {on ? (
          <video
            ref={videoRef}
            playsInline
            autoPlay
            onLoadedMetadata={(e) => {
              setStatus('ready')
              setDuration(e.currentTarget.duration || 0)
            }}
            onPlay={() => {
              setPlaying(true)
              showTap('play')
            }}
            onPause={() => {
              setPlaying(false)
              showTap('pause')
            }}
            // 卡住 / 恢复。用这一对事件而不是看 currentTime 走不走：事件是元素自己报的
            // 「我现在没有数据可放」，而时间戳不动也可能是用户暂停。判据只有一份。
            onWaiting={markStall}
            onPlaying={clearStall}
            // 拖动之后元素必然先 waiting 一下，那一下不是「流卡了」，别闪
            onSeeking={clearStall}
            onTimeUpdate={(e) => {
              // 跳转在途时以目标位置为准（见 seekTo）：拖动的 suppress 只管手指按着那一段
              if (draggingRef.current || seekTargetRef.current !== null) return
              setCurrent(e.currentTarget.currentTime)
            }}
            onSeeked={(e) => {
              seekTargetRef.current = null
              setCurrent(e.currentTarget.currentTime)
            }}
            onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
            onProgress={(e) => {
              const el = e.currentTarget
              setBuffered(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0)
            }}
            onVolumeChange={(e) => {
              setMuted(e.currentTarget.muted)
              setVolume(e.currentTarget.volume)
            }}
            onError={() => {
              if (hlsRef.current) return // 归 hls.js 管，它会自己 recover
              // 原生这条路说「不支持」先别急着判死：Chrome 把 TS 清单也报成
              // SRC_NOT_SUPPORTED（4），而它在 application/vnd.apple.mpegurl 上回的
              // 就是 "maybe" —— 这正是 hls.js 存在的意义。翻一次开关让 effect 重跑，
              // 第二次还失败才认输。非 HLS 的地址没有第二条路，照旧直接报。
              if (HLS_RE.test(url) && videoRef.current?.error?.code === 4 && forceHls !== url) {
                setForceHls(url)
                return
              }
              fail(HLS_RE.test(url) ? 'play.errNetwork' : 'play.errMedia')
            }}
            className={`h-full w-full ${fullscreen ? 'object-contain' : ''}`}
          />
        ) : (
          // 空闲态不挂 <video>：空 src 的原生控件是一排死按钮，比空白更糟。
          // 高度照样占住（aspect-video 交给外层），所以选片时不会有跳变。
          <div className="flex h-full w-full items-center justify-center px-6">
            {/* /55 而不是 /40：黑底上的 12px 小字要过 4.5:1，/40 只有约 3.7 */}
            <p className="max-w-[22rem] text-center text-xs leading-relaxed text-white/55">
              {t('play.stageIdle')}
            </p>
          </div>
        )}

        {/* 播放/暂停的回应：画面正中闪一下。控制条在播放时是自动收起的，点画面之后
            如果什么都不动，用户没法区分「按到了」和「点空了」——尤其是这些直出流，
            暂停和卡住看起来一模一样。只闪不常驻（常驻就是遮挡），淡出靠透明度过渡。
            图标用播放/暂停**各自**那一个：这里要回答的是「刚才那一下做了什么」。 */}
        {on && status === 'ready' && (
          <div
            className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 motion-reduce:transition-none ${
              tap.on ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          >
            <span className="flex h-16 w-16 items-center justify-center bg-black/55 text-white">
              {tap.kind === 'pause' ? <IconPause className="h-8 w-8" /> : <IconPlay className="h-8 w-8" />}
            </span>
          </div>
        )}

        {on && status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="bg-black/60 px-3 py-1.5 text-xs text-white/80">{t('play.playerLoading')}</p>
          </div>
        )}

        {/* 播放中途卡住。位置和样式跟上面那句**完全一样**：对用户来说是同一件事
            （现在没有画面，原因是这个），区别只在时机 —— 那句是还没出过画面，
            这句是画面停住了。另起一套长相只会让同一件事读起来像两件事。 */}
        {on && status === 'ready' && stalled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="bg-black/60 px-3 py-1.5 text-xs text-white/80">{t('play.buffering')}</p>
          </div>
        )}

        {/* ---- 自绘控制条 ---- */}
        {on && status === 'ready' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 motion-reduce:transition-none ${
              showUi ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            {/* 集数选择：摊在控制条**上方**（同一个停靠容器里，它在进度条前面）。
                黑底半透明而不是实底：它是压着画面的浮层，底下的画面得透出来 ——
                换集时用户正看着上一集的画面在找下一集。
                按钮本身跟卡片里那个网格同一套语汇（方角、细线、等宽数字），
                连字都一样（epLabel），否则用户会以为两边给的是两批剧集。 */}
            {pickOpen && episodes.length > 1 && (
              <div className="border-t border-white/15 bg-black/80 px-3 py-2.5">
                <p className="mb-2 text-[11px] text-white/50">{t('play.episodes')}</p>
                <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                  {episodes.map((ep, i) => {
                    const active = ep.url === url
                    // 播不了的（http 直链在 https 页面上）照样列出来，但不可点、并说明原因：
                    // 直接删掉的话，用户会在卡片上看到它、在播放器里找不到，像丢了一集。
                    const ok = canPlayInline(ep.url)
                    return (
                      <button
                        key={`${ep.url}-${i}`}
                        type="button"
                        // 点一集就播，不等二次确认（跟卡片上一样）。收起由 [url] 那个 effect 做，
                        // 不在 onClick 里再写一遍。
                        onClick={() => ok && onSwitch?.(ep)}
                        disabled={!ok}
                        title={ok ? ep.name : t('play.insecure')}
                        aria-current={active ? 'true' : undefined}
                        className={`min-w-[2.5rem] border px-1.5 py-1 text-center text-xs tabular-nums transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? 'border-white bg-white text-black'
                            : 'border-white/25 text-white/75 hover:border-white hover:bg-white hover:text-black'
                        }`}
                      >
                        {epLabel(ep.name, i)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 进度条：白=已播，白/30=已缓冲，白/15=全长。缓冲这一段是自绘的理由之一 ——
                这种直出流卡住时，用户唯一需要知道的就是「前面还有多少」。
                外层的 py-2 是命中的热区，真正画出来的线只有 2px。 */}
            <div className="px-3 pb-0.5 pt-2">
              <div
                ref={barRef}
                role="slider"
                tabIndex={0}
                aria-label={t('play.seek')}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration) || 0}
                aria-valuenow={Math.round(current) || 0}
                aria-valuetext={`${fmtTime(current)} / ${fmtTime(duration)}`}
                onPointerDown={barDown}
                onPointerMove={barMove}
                onPointerUp={barUp}
                onPointerCancel={barUp}
                onPointerLeave={() => setHover(null)}
                onKeyDown={barKey}
                className="group/bar relative cursor-pointer touch-none py-1.5 focus:outline-none"
              >
                {/* 三个填充**并排**铺在整条上，一个套一个是不行的。
                    原来「已播」和缓冲是父子关系（已播套在缓冲里），于是已播那段的
                    `width: 50%` 是**缓冲段宽度**的 50% —— 缓冲只到 76% 时，点在 50%
                    处，白条画在 38% 的位置。用户看到的就是「我点的和它跳到的不是一个地方」
                    （跳转本身是准的，错的是那根白条）。凹槽 `relative` 当定位基准，
                    三条都用 left+width 的百分比，各自对整条负责。 */}
                <div className="relative h-0.5 w-full bg-white/15 transition-all group-hover/bar:h-1 group-focus-visible/bar:h-1">
                  <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: pct(buffered) }} />
                  <div className="absolute inset-y-0 left-0 bg-white" style={{ width: pct(current) }}>
                    {/* 方形滑块，跟站点的圆角语汇一致（这里一个圆角都没有） */}
                    <span
                      className="absolute -right-0.5 top-1/2 h-2.5 w-1.5 -translate-y-1/2 bg-white opacity-0 transition-opacity group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100"
                      aria-hidden="true"
                    />
                  </div>
                  {/* 悬停时那一道竖线：气泡跟着它走，落点才看得出来。
                      它和气泡的百分比都相对**整条**，所以两者始终指同一个位置。 */}
                  {hover !== null && (
                    <span
                      className="absolute -top-1 h-2.5 w-px bg-white/70"
                      style={{ left: pct(hover * duration) }}
                      aria-hidden="true"
                    />
                  )}
                </div>

                {/* 悬停时的时间气泡：进度条上唯一说不清的就是「这一段在哪儿」，
                    而它只在指针底下的那个点上才有一句话可说，所以跟着指针走。
                    贴边时换个对齐方式，否则气泡会从播放器里探出去。 */}
                {hover !== null && duration > 0 && (
                  <span
                    className="pointer-events-none absolute bottom-full mb-1 block whitespace-nowrap bg-black/85 px-1.5 py-0.5 text-[11px] leading-4 tabular-nums text-white"
                    style={{
                      left: pct(hover * duration),
                      transform:
                        hover < 0.04 ? 'translateX(0)' : hover > 0.96 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    {fmtTime(hover * duration)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 bg-gradient-to-t from-black/90 to-black/50 px-3 py-2">
              <button
                type="button"
                onClick={toggle}
                aria-label={t(playing ? 'play.pause' : 'play.play')}
                className={`${BTN} px-2.5 ${ON_DARK}`}
              >
                {playing ? <IconPause /> : <IconPlay />}
              </button>

              <span className="shrink-0 text-xs tabular-nums text-white/70">
                {fmtTime(current)}
                <span className="text-white/35"> / {fmtTime(duration)}</span>
              </span>

              <span className="flex-1" />

              {/* 集数选择。按钮上是「当前第几集 / 共几集」——它同时回答了
                  「能不能换」和「现在看到哪儿了」。epIdx < 0 时不摆（见上面的说明）。 */}
              {episodes.length > 1 && epIdx >= 0 && (
                <button
                  type="button"
                  onClick={() => setPickOpen((v) => !v)}
                  aria-expanded={pickOpen}
                  aria-label={`${t('play.episodes')} ${epIdx + 1}/${episodes.length}`}
                  className={`${BTN} px-2 ${ON_DARK}`}
                >
                  <IconEpisodes />
                  <span className="tabular-nums">
                    {epIdx + 1}/{episodes.length}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleMute}
                aria-label={t(muted ? 'play.unmute' : 'play.mute')}
                className={`${BTN} px-2 ${ON_DARK}`}
              >
                <IconVolume muted={muted || volume === 0} />
              </button>
              {/* 音量条窄屏收起：手机上物理音量键更好用，留着只会挤掉进度 */}
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const el = videoRef.current
                  if (!el) return
                  const n = Number(e.target.value)
                  el.volume = n
                  el.muted = n === 0
                }}
                aria-label={t('play.volume')}
                className="hidden h-1 w-16 cursor-pointer accent-white sm:block"
              />

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={t(fullscreen ? 'play.exitFullscreen' : 'play.enterFullscreen')}
                className={`${BTN} px-2 ${ON_DARK}`}
              >
                <IconExpand exit={fullscreen} />
              </button>
            </div>
          </div>
        )}

        {/* 出错铺满整块，盖住控制条：这时候该看的是「怎么办」，不是进度条。
            stopPropagation 是必须的：这一层压在画面上，不拦的话点它会穿透到
            外层的 toggle —— 用户想点「重试」，画面却先闪一下播放/暂停。 */}
        {on && status === 'error' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center"
          >
            <p className="text-sm text-white/85">{t(reason || 'play.errMedia')}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* 重试排在最前：这些源抖动是常事，多数情况下再拉一次就好了，
                  而不用回头去列表里换线路（重试按钮不在时，用户唯一能做的就是那个）。
                  同一条地址重试靠 attempt 让上面的 effect 重跑，见它的说明。 */}
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="border border-white bg-white px-3 py-1.5 text-xs text-black transition hover:bg-white/85"
              >
                {t('play.playerRetry')}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="border border-white/30 px-3 py-1.5 text-xs text-white transition hover:border-white hover:bg-white hover:text-black"
              >
                {t('play.playerFallback')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
