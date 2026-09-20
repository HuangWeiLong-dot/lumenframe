import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import PlayGate from './PlayGate'
import VideoPlayer from './VideoPlayer'
import { apiUrl } from '../api'
import { useI18n } from '../i18n'
import { canPlayInline, cnNumber, epLabel, keepPlayable, playBlocker } from '../playMedia'
import { safeGet, safeSet } from '../storage'

// 在线播放源：/api/sources 由 Node 后端提供（server/sources.js），清单放在
// server/sources.json —— 那个文件是 gitignored 的，所以**公网部署上默认没有**，
// 服务端会回 { enabled: false }，本区块整体隐藏。这与 FILMGRAB_BASE === '' 是同一套规则。
//
// 两个面，各管一件事：
//   结果列表 —— **只负责选**。片名 → 线路 → 剧集，三级都在这里完成。
//   播放台   —— **只负责放**。常驻在区块底部（VideoPlayer.jsx），空闲时是一句邀请语。
// 分开的好处是嵌套少一层：卡片里不再塞播放控件，"换一条线路"也只是在列表里换个选择，
// 播放台不用跟着搬家。
//
// 探活不再是一个按钮，而是**加载策略的一部分**：展开这一块就开始搜，冷搜（服务端
// 那一轮还没走过探活）拿到结果之后自己再补一轮探活、补完再重搜一次，用户什么都不用点。
// 所以这里的探活请求是去**等**服务端已经踢出去的那一轮，不是另起一轮（见 runDetect）。

// 前端超时必须**大于**服务端预算，否则前端先放弃、服务端还在空烧 socket。
// 服务端：搜索 15s（冷的时候还会顺带踢一轮探活）、探活 12s + 配置展开 12s。
const SEARCH_TIMEOUT = 30000
const DETAIL_TIMEOUT = 12000
const PROBE_TIMEOUT = 35000

// 只在中文界面开放。采集站索引的是**中文片名**，返回的片名、线路名、剧集名也全是中文，
// 英文界面下用户会拿到一整列看不懂的结果，还得自己去猜哪条能点。
// 与 FILMGRAB_BASE === '' 同一套「不可用就整体隐藏」的规则，只是这里的开关是界面语言。
const OPEN_FOR_LANG = 'zh'

// 口令门。构建期变量：**没配就没有这道门**，整块与改动前完全一致。
// 它是软的（口令编在 bundle 里，见 PlayGate.jsx 顶部那段），拦「随手点进来」而已。
// trim 是有必要的：CI 里 Variables 漏配时会拿到空串，粘错的还会带个换行，
// 那种值当口令用会让正确口令永远对不上 —— 与其静默失灵，不如归一化掉。
const PLAY_PASSWORD = (import.meta.env.VITE_PLAY_PASSWORD || '').trim()
// 存的是**口令本身**而不是一个 true 标记：换口令时全世界的浏览器一起重新上锁。
// 明文不额外暴露什么 —— 同一串字符本来就躺在 bundle 里。
const UNLOCK_KEY = 'lumenframe:play-unlock'

// 清单只取一次，整页共享 —— 但**只记住成功的那一次**。
//
// 失败/超时如果也记下来，这一整页就再也不会有这一块了：后端刚起来、或一次瞬时抖动，
// 用户得到的是一整页都没有「在线播放」，而不是晚一秒出现。所以失败时把记忆清掉，
// 下一次挂载（换个片子、或者切回中文）再试一次 —— 反正没拿到清单时这一块本来就不渲染，
// 重试没有闪烁。反过来，反复重试也不会发生：失败只在**挂载**时触发，不是定时轮询。
let listPromise = null
function fetchSourceList() {
  if (listPromise) return listPromise
  const fetchP = fetch(apiUrl('/api/sources'))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const timeoutP = new Promise((resolve) => setTimeout(() => resolve(null), 8000))
  listPromise = Promise.race([fetchP, timeoutP]).then((d) => {
    if (!d) listPromise = null
    return d
  })
  return listPromise
}

// 后端不可达/超时一律当 null 处理：调用方按「无结果」渲染，不弹错误态。
// 不用 AbortController —— React 19 StrictMode 双挂载会刷 net::ERR_ABORTED。
async function getJson(url, ms) {
  const fetchP = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const timeoutP = new Promise((resolve) => setTimeout(() => resolve(null), ms))
  return Promise.race([fetchP, timeoutP])
}

// ---------- 小图标 ----------

function PlayIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 3 14 9-14 9V3z" />
    </svg>
  )
}

function ChevronIcon({ open, className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`${className} transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

// ---------- 通用小件 ----------

// 横向内边距**不放进基础串**：图标按钮要 w-8 + px-0，而 px-0 和 px-3 是同层
// 冲突的工具类，谁生效取决于 Tailwind 生成顺序而不是 class 的书写顺序。
const BTN =
  'inline-flex h-8 items-center justify-center gap-1.5 border text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const BTN_PRIMARY = 'border-black bg-black text-white hover:border-zinc-700 hover:bg-zinc-700'
const BTN_GHOST = 'border-zinc-300 text-zinc-700 hover:border-black hover:bg-black hover:text-white'
// 卡片里的分组小标题（「线路」「剧集」）。用 500 而不是 400：白底上 400 只有
// 2.5:1，而这两行是导航用的，不是装饰。
const CAPTION = 'text-[11px] font-normal text-zinc-500'

// 空态。`action` 是这一块**唯一**留下的手动作 —— 自动加载（见 runDetect）没有按钮，
// 但搜索本身会失败（站点超时、后端不可达），那两句话底下必须有一个「再来一次」，
// 否则用户只能刷新整页。它不是常驻控件：没出错就不出现。
function Hint({ children, action }) {
  return (
    <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function RescanButton({ onClick }) {
  const { t } = useI18n()
  return (
    <button type="button" onClick={onClick} className={`${BTN} px-2.5 ${BTN_GHOST}`}>
      {t('play.retry')}
    </button>
  )
}

// playBlocker / canPlayInline / keepPlayable / epLabel / cnNumber 都在 ../playMedia.js：
// 播放台里也有一个集数选择，它和这张卡片必须用同一套判据和同一套叫法。

// 一行结果的身份。也是「这一行已经退场了」的记账键（见主区块的 hidden）。
const rowKey = (r) => `${r.sourceId}:${r.vodId}`

// 季格上的字。nb 那边一季就是一条结果，片名里带着「庆余年 第一季」这样的前缀，
// 一排季格每个都顶着同一截片名只会把真正要选的那两个字（第几季）挤到后面去，
// 所以把页面的片名前缀去掉；去掉之后什么都不剩（片名本身就是完整名字）就照原样留着。
const SEASON_SEP_RE = /^[\s:：·\-—_]+/
function seasonLabel(name, title) {
  const n = String(name || '').trim()
  const p = String(title || '').trim()
  if (!p || !n.startsWith(p)) return n
  return n.slice(p.length).replace(SEASON_SEP_RE, '').trim() || n
}

// ---------- 单条搜索结果 ----------

// 采集站只在 ac=detail&ids= 时才回剧集表，所以线路和剧集要等展开才拉。
//
// `no` 是来源编号（同一来源在整列结果里是同一个号，见下面的 sourceNo）。
// 它取代了以前那个 5 位哈希化名（TF93T、WYFNG…）：化名读不出来也记不住，
// 而它的全部用途只是「在这一列里指认一行」，一个序号就够了。
//
// `primary` 是**主源卡**（搜索结果里的 nb / 4kvms 那一批，由主区块摘出来置顶）。
// 它和结果卡是同一套交互（展开 → 挑线路 → 挑剧集），差别只在优先级，
// 所以共用这个组件、只换边框和徽章 —— 另起一个组件会把下面这套状态机抄一遍。
//
// `activeUrl` 是播放台**正在播**的那条地址。播放台自己也有集数选择，在那里换集会绕过
// 这张卡片的地方状态（episode），高亮就会停在上一次点过的那一集上 —— 拿它兜住。
//
// `seasons` 是**多季**（只有主源卡会传）。nb 把每一季当成独立的一条搜索结果
// （庆余年 第一季 / 第二季 各一条），所以「主源」这一张卡要自己分季 —— 不传就是普通卡。
// `title` 是页面片名，用来把「庆余年 第一季」缩成「第一季」（见 seasonLabel）。
function ResultCard({ row, no, primary = false, seasons = null, title = '', activeUrl = '', onPlay, onEmpty }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | done
  const [line, setLine] = useState(0)
  const [episode, setEpisode] = useState(null)

  // 多季只发生在「这一张卡里有多条」，一条时不摆季控件（它只会是个只有一格的列表）
  const list = seasons && seasons.length > 1 ? seasons : null
  const [pick, setPick] = useState(0)
  // 展开后发现「这一季没有可播线路」的，记在这里：它的季格变灰，其余照旧。
  // 不整张卡退场 —— 上一季下有货就作废整张主源卡，用户会以为这部片的主源没了。
  const [dead, setDead] = useState(() => new Set())
  const cur = list ? list[pick] || list[0] : row

  // 拉某一季的线路与剧集。返回 false = 这一条没有可播的东西（网页地址的线路会被
  // keepPlayable 删干净），调用方决定是退场还是换一季。
  const load = useCallback(async (target) => {
    setStatus('loading')
    const d = await getJson(
      apiUrl(
        `/api/sources/detail?sourceId=${encodeURIComponent(target.sourceId)}` +
          `&vodId=${encodeURIComponent(target.vodId)}`
      ),
      DETAIL_TIMEOUT
    )
    // 网页地址的线路在这里就没了，所以「第一条线路」不再是「第一条**能播**的线路」——
    // 过滤之后剩下的每一条都能播，直接落在第一条上。旧版要专门去找第一条能播的，
    // 正是因为 ffzy 系那一批的第一条恒定是 share/<hex> 网页地址。
    const gs = keepPlayable(d?.groups)
    if (gs.length === 0) return false
    setDetail({ ...d, groups: gs })
    setLine(0)
    setStatus('done')
    return true
  }, [])

  // 展开/换季都走这里。一条季都没有货时整张卡退场（对每一季都报一次 onEmpty，
  // 让主区块把这几条一起摘掉），否则落到还有货的那一季上。
  //
  // **「换下一季」必须用循环，不能递归。** 每一季都可能是空的（采集站里整季只给网页
  // 地址是常事），所以「这季没货就试下一季」要能连着走好几步。早先写成 openTarget
  // 里再调 openTarget，而递归用的是**这次渲染闭包里的 dead**：第一步标死的季，第二步
  // 就看不见了，于是第二步又回头去试第一季 —— 两步之间无限乒乓。实测（2026-09-20）
  // 三季全空的卡片一展开，15 秒发出 **15074** 个 /detail 请求，而三格季一个都不变灰
  // （那正是 dead 丢了的外部症状）。累加的那份集必须**随循环往下传**，不能只靠 state。
  const openTarget = useCallback(
    async (start) => {
      const tried = new Set(dead)
      for (let i = start; ; ) {
        const target = list ? list[i] : row
        setEpisode(null)
        setDetail(null)
        if (list) setPick(i)
        if (await load(target)) return
        if (!list) {
          onEmpty?.(target.sourceId, target.vodId)
          return
        }
        tried.add(i)
        setDead(new Set(tried))
        if (tried.size >= list.length) {
          for (const r of list) onEmpty?.(r.sourceId, r.vodId)
          return
        }
        const alt = list.findIndex((_, j) => !tried.has(j))
        if (alt < 0) return
        i = alt
      }
    },
    [list, row, load, dead, onEmpty]
  )

  // 季表换了（重搜之后）就把「这一季没货」这份账作废：新结果里的同一季是新的机会，
  // 不该继承上一轮那次展开的结论。size 为 0 时原样返回，免得白白触发一次渲染。
  // 判据用 list 的**引用**：主源卡的 seasons 是 memo 过的，重搜才会换新的。
  useEffect(() => {
    setDead((s) => (s.size ? new Set() : s))
  }, [list])

  const toggle = () => {
    const next = !open
    setOpen(next)
    // 只在首次展开时拉，重复折叠不再打接口
    if (next && status === 'idle') openTarget(pick)
  }

  // memo 掉：不然 detail 为空时每次渲染都是新的 []，下面那个 effect 会白跑
  const groups = useMemo(() => detail?.groups || [], [detail])
  const current = groups[line]

  // **点剧集即播**，不再「先选中、再跑到卡片外面去按播放」。
  // 播放台在这一整块的最下面，onPlay 会把它滚进视野，所以一步到位不会丢掉上下文；
  // 而多两步只是为了「选中但不播」这个没人要的中间态。
  //
  // 播放台头行那句「来路」跟卡片上摆的是同一个东西：普通卡是来源编号，主源卡是「主源」。
  // 主源卡的 no 恒为 0，照原样拼出来会得到「来源 0」。
  const sourceLabel = primary ? t('play.directBadge') : no > 0 ? t('play.sourceNo', { n: no }) : ''
  const play = useCallback(
    (ep) => {
      setEpisode(ep)
      if (!canPlayInline(ep?.url)) return
      const eps = current?.episodes || []
      onPlay?.({
        url: ep.url,
        // 主源卡多季时，播放台头行报的是**这一季**的名字（庆余年 第二季），
        // 否则换季之后屏幕上的片名还是上一季的。
        title: cur.vodName,
        // 来路拆成两截交给播放台：定死的（来源 · 线路）和会变的那一集分开存 ——
        // 播放器里换集只要换后一截，不必反过来解析一个拼好的字符串。
        subtitle: [sourceLabel, current?.from].filter(Boolean).join(' · '),
        epName: ep.name,
        // 整张剧集表跟着走，播放器里就能直接换集（见 VideoPlayer）。
        // 只有一集时不带：那会在播放器里多出一个只有一格的列表。
        episodes: eps.length > 1 ? eps : null,
      })
    },
    [sourceLabel, onPlay, cur.vodName, current]
  )

  const only = current?.episodes?.length === 1 ? current.episodes[0] : null
  const playable = (ep) => canPlayInline(ep?.url)

  // 元信息行（片名下面那一行）的每一格，从左到右按「值不值得点」排。
  // 主源卡的 no 恒为 0，所以这里不必再判 primary —— 编号那一格自己就不出现。
  const meta = [
    // 来源编号排在最前，而且比同行的元信息深一档：同一部剧往往有七八行长得一模一样的
    // 结果，用户真正在比较的就是「哪一条来源」，它才是这一行的决策项。
    no > 0 ? (
      <span key="no" className="tabular-nums text-zinc-700">{t('play.sourceNo', { n: no })}</span>
    ) : null,
    // 类型、状态、画质三段都在服务端归过一（server/playlabels.js）：各站自己手填的
    // 「科幻片/科幻」「HD/正片」在列表里并排时没法比，归一之后同一部片在每家读起来
    // 才是同一句话。
    row.typeName ? <span key="type">{row.typeName}</span> : null,
    row.status ? <span key="status">{row.status}</span> : null,
    row.quality ? <span key="quality">{row.quality}</span> : null,
    // 「N 条线路」「另 N 个来源」这两格删掉了：前者的数字只有展开之后才算数（线路要过
    // 一遍 keepPlayable，服务端给的条数里有一半是网页地址），后者的「来源」既点不动、
    // 也不改变用户下一步做什么 —— 两格都只是在替服务端念记账。
  ].filter(Boolean)

  return (
    <div className={`border transition ${primary ? 'border-zinc-900' : open ? 'border-zinc-400' : 'border-zinc-200 hover:border-zinc-400'}`}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <ChevronIcon open={open} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* 主源卡的徽章跟 direct 卡一样摆在片名**前头**，不沉到第二行去：
                nb 行没有类型/状态/画质（那些字段在服务端就是空的，见 nbSearchOne），
                徽章放第二行的话，那一行就只剩它一个，读起来像被落下了。 */}
            {primary && (
              <span className="shrink-0 bg-zinc-900 px-1.5 text-[10px] font-bold leading-4 tracking-wider text-white">
                {t('play.directBadge')}
              </span>
            )}
            <span className="truncate text-sm font-medium text-zinc-900">{cur.vodName}</span>
            {/* 年份、备注一律 zinc-500 打底：zinc-400 在白底上只有 2.5:1，
                而这几项都是要读的信息，不是装饰 */}
            {cur.year && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{cur.year}</span>}
          </span>
          {/* 元信息行整行可空（nb 行就是空的），全空时干脆不渲染 —— 留一个 mt-0.5 的空行
              只会把卡片撑高一截。 */}
          {meta.length > 0 && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500">
              {meta}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 px-3 py-3">
          {/* 季在最上面：它是这一张卡里**最外层**的选择 —— 先定看哪一季，再谈哪条线路、
              哪一集。位置也说明层级：下面的线路和剧集都属于选中的这一季。 */}
          {list && (
            <>
              <p className={`mb-1.5 ${CAPTION}`}>{t('play.seasons')}</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {list.map((s, i) => (
                  <button
                    key={rowKey(s)}
                    type="button"
                    // 每一季都是另一条结果，名字里带「第几季」；title 用全名，
                    // 被缩掉的片名前缀在那儿还看得见。
                    title={s.vodName}
                    disabled={dead.has(i)}
                    onClick={() => {
                      if (i !== pick) openTarget(i)
                    }}
                    className={`border px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      i === pick
                        ? 'border-black bg-black text-white'
                        : 'border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:bg-zinc-50'
                    }`}
                  >
                    {seasonLabel(s.vodName, title) || s.vodName}
                    {s.year && (
                      <span className={`ml-2 tabular-nums ${i === pick ? 'text-white/55' : 'text-zinc-500'}`}>
                        {s.year}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {status === 'loading' && <p className="text-xs text-zinc-500">{t('play.loadingDetail')}</p>}

          {/* 这里没有「该源没有返回剧集列表」那种状态：一条线路都没剩下时，
              load() 的调用方已经处理掉了（单季整张卡退场，多季换到还有货的那一季，
              见 openTarget），展开态根本不会渲染到这儿。 */}

          {status === 'done' && groups.length > 0 && (
            <>
              <p className={`mb-1.5 ${CAPTION}`}>{t('play.lines')}</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g, i) => (
                  <button
                    key={`${g.from}-${i}`}
                    type="button"
                    // 站内代号只留在 title 里（见 playMedia.js 的 cnNumber）：摆出来是噪声，
                    // 但排查「这条线路到底是哪个站」时它是唯一的线索。
                    title={g.from}
                    onClick={() => {
                      setLine(i)
                      setEpisode(null)
                    }}
                    className={`inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs transition ${
                      i === line
                        ? 'border-black bg-black text-white'
                        : 'border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="font-medium">{t('play.line', { n: i + 1, cn: cnNumber(i + 1) })}</span>
                    <span className={`tabular-nums ${i === line ? 'text-white/55' : 'text-zinc-500'}`}>
                      {g.episodes.length}
                    </span>
                  </button>
                ))}
              </div>

              {/* 线路这一层不再需要「这条线路播不了」的提示：网页地址的线路在 load()
                  里已经被 keepPlayable 删掉了，能出现在这里的每一条都至少有一集可播。
                  剩下的只有 insecure 一种（http 直链在 https 页面上），那句话跟着
                  选中的那一集说，见下面。 */}

              {/* 单集的线路（电影几乎都是）没有「挑哪一集」这回事，直接给一个播放键，
                  不再摆一个只有一个格子的网格。 */}
              {only && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => play(only)}
                    disabled={!playable(only)}
                    className={`${BTN} px-2.5 ${BTN_PRIMARY}`}
                  >
                    <PlayIcon className="h-3.5 w-3.5" />
                    {t('play.play')}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={only.name}>
                    {only.name}
                  </span>
                </div>
              )}

              {current?.episodes.length > 1 && (
                <>
                  <p className={`mb-1.5 mt-3 ${CAPTION}`}>{t('play.episodes')}</p>
                  <div className="flex flex-wrap gap-1">
                    {current.episodes.map((ep, i) => (
                      <button
                        key={`${ep.url}-${i}`}
                        type="button"
                        onClick={() => play(ep)}
                        title={ep.name}
                        className={`min-w-[2.5rem] border px-1.5 py-1 text-center text-xs tabular-nums transition ${
                          episode?.url === ep.url || activeUrl === ep.url
                            ? 'border-black bg-zinc-900 text-white'
                            : 'border-zinc-200 text-zinc-700 hover:border-zinc-400'
                        }`}
                      >
                        {epLabel(ep.name, i)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* 播不了就把原因说清楚，否则用户只会觉得「点了没反应」。
                  现在只剩 insecure 一种原因（网页地址的线路已经在 load() 里删掉了），
                  它给的是「换一条线路」这个下一步。 */}
              {(() => {
                const chosen = only || episode
                if (!chosen || playBlocker(chosen.url) !== 'insecure') return null
                return <p className="mt-2 text-[11px] text-amber-600">{t('play.insecure')}</p>
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- 直连主源 ----------

// 清单里 kind:"direct" 的那一批：按片手工绑定一条地址，不搜索、不探活、不参与去重。
//
// 它存在的理由是有些源**根本搜不到** —— 比如前端用 WASM 现场算出地址的站，没有采集
// 接口可打。那种只能人工把地址抄出来写进清单，所以这条走的是 TMDB id 精确绑定，
// 而不是像下面那样靠片名去撞。
function matchDirect(list, movie) {
  const rows = Array.isArray(list) ? list : []
  if (rows.length === 0) return []
  // 电影才有 TMDB id 可比（详情页路由就是 /movie/{tmdbId}）；剧集的数据来自 TVmaze，
  // 手上那个数字是 TVmaze 的 id，跟 TMDB 不是一个空间，比了只会张冠李戴。
  //
  // 判据是「**不是** tv」而不是「等于 movie」：/api/movie/:id 的响应里根本没有 kind 字段
  // （只有 TVmaze 那条返回 kind:"tv"），写 `=== 'movie'` 会对每一部电影都为假，
  // tmdb 绑定就永远匹配不上、静默退化成按片名撞。下面 year 的取法也是同一个约定。
  const id = movie?.kind !== 'tv' && movie?.id != null ? String(movie.id) : null
  const names = new Set(
    [movie?.title, movie?.title_en].filter(Boolean).map((s) => String(s).trim().toLowerCase())
  )
  return rows.filter((d) => {
    if (d.tmdb) return id !== null && d.tmdb === id
    return d.title ? names.has(d.title.toLowerCase()) : false
  })
}

// 置顶的主源卡。「主源」两个字要经得起追问：它**不来自搜索**，是清单里点名写给这部片
// 的，所以既不该混进下面那列（用户会以为也是撞出来的某一条），也不该被搜索状态左右 ——
// 搜索空着、转着、甚至整站都挂了，它照样该在。
//
// 视觉上只比结果卡重一档：边框 zinc-900 对结果卡的 zinc-200，仅此而已。它和结果卡是
// 同类东西（一条能播的地址），只是优先级不同，多糊一层底色或阴影就把它读成另一种东西了。
//
// 不做折叠：里面就一条地址，没有「展开才知道有没有」的层次。
// 也不摆地址本身：地址是拿来播的，不是拿来读的；列出来只会让人以为要复制它去别处用。
function DirectCard({ entry, title, onPlay }) {
  const { t } = useI18n()
  const why = playBlocker(entry.url)
  const ok = why === null

  return (
    <div className="border border-zinc-900">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
        <span className="shrink-0 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">
          {t('play.directBadge')}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
          {entry.label || t('play.directSource')}
        </span>

        {/* 地址不是可播的流文件时不摆播放键 —— 摆了也只是把「打不开」换个地方发生 */}
        {ok && (
          <button
            type="button"
            onClick={() => onPlay({ url: entry.url, title, subtitle: entry.label })}
            className={`${BTN} px-2.5 ${BTN_PRIMARY}`}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {t('play.play')}
          </button>
        )}
      </div>

      {why && (
        <p className="border-t border-zinc-200 px-3 py-2 text-[11px] text-amber-600">
          {t(why === 'insecure' ? 'play.insecure' : 'play.notStream')}
        </p>
      )}
    </div>
  )
}

// ---------- 说明 ----------

// 来路与播放这两句交代**合在一起**，是区块级的一句话 —— 不属于任何一条结果，
// 也不属于播放台。
//
// 以前它们分在两处：一句在结果列表底下（「聚合自第三方采集站」），一句**紧贴在播放器
// 正下方**（「播放的是第三方 CDN 直出的流」），后者的位置等于说「这是这个播放器的
// 属性」。它讲的其实是整块功能的来路，跟某条流的状态无关，贴在视频下面只会让人以为
// 是在解释画面为什么转圈。所以归到一处，放在列表**之前** —— 先交代来路，再给结果。
//
// 只剩**一句**：这是一段没人会重读的免责声明，用户来这儿是找片子的，两行字里
// 「本站不存储」和「本站不中转」说的是同一件事（没有原件、也没有经手），
// 合成一句之后照样把责任撇清了，还短一半。
function SourceNotice() {
  const { t } = useI18n()
  return (
    <div className="mb-3 border-l-2 border-zinc-300 pl-3">
      <p className="text-[11px] leading-relaxed text-zinc-500">{t('play.notice')}</p>
    </div>
  )
}

// ---------- 主区块 ----------

export default function PlaySources({ movie }) {
  const { t, lang } = useI18n()
  const [cfg, setCfg] = useState(null) // /api/sources 的整个响应；null = 未知

  // 搜索
  const [status, setStatus] = useState('idle')
  const [data, setData] = useState(null)
  const [started, setStarted] = useState(false)
  const [nonce, setNonce] = useState(0)

  // 「正在把源铺开」：冷搜之后自动补的那一轮（探活 + 重搜）在跑。它不是用户点出来的
  // 动作，所以只有一行进度，没有按钮（见下面的 runDetect）。
  const [widening, setWidening] = useState(false)

  // 静默重搜：铺开那一轮的结果到手前**不清空列表**，用户看到的是源自己长出来，
  // 而不是「点了什么之后换了一批」。
  const silentRef = useRef(false)
  // 这一轮结果是不是窄的（服务端那轮没走过探活）。补过一次就不再补，但要**真拿到
  // 探活结果**才算补过 —— 探活失败时留着 false，用户点「重新搜索」还能再补一次。
  const probedRef = useRef(false)
  const probingRef = useRef(false)

  // 播放台上在播的那条流。放在这一层是为了全页只有一个 <video>：卡片可折叠、可同时展开
  // 多条，播放器塞进卡片里迟早会有两个在后台一起拉流。
  const [playing, setPlaying] = useState(null)

  // 展开后才发现「没有可播剧集」的行，在这里记账，不再显示（见 ResultCard 的 onEmpty）。
  //
  // 用一份 Set 而不是从 data.results 里删：来源编号按**结果顺序**分配（见 sourceNo），
  // 真删一条会让后面所有编号整体前移，看起来像整列结果换了一批。所以只做渲染层过滤。
  const [hidden, setHidden] = useState(() => new Set())

  // 口令门：配了 VITE_PLAY_PASSWORD 才存在。解锁状态记在 localStorage 里，
  // 一次输入之后这个浏览器就一直开着（见 PlayGate.jsx）。
  const gateOn = PLAY_PASSWORD !== ''
  const [unlocked, setUnlocked] = useState(
    () => !gateOn || safeGet(UNLOCK_KEY) === PLAY_PASSWORD
  )
  const unlock = useCallback((pw) => {
    if (pw !== PLAY_PASSWORD) return false
    safeSet(UNLOCK_KEY, pw)
    setUnlocked(true)
    return true
  }, [])

  // 语言不对就整个功能不存在：连清单都不去拉。
  // 依赖 lang 是为了切回中文时能重新判定 —— fetchSourceList 是模块级记忆的，重进很便宜。
  //
  // **上锁时它也是 false**，这一条是刻意的：下面那个取清单的 effect 挂在它上面，
  // 于是没解锁就连 /api/sources 都不会发，更不会去搜那几十个采集站。解锁后它变真，
  // 取数自然接上，不需要另开一条重试路径。
  const open = lang === OPEN_FOR_LANG && (!gateOn || unlocked)

  // 片名：采集站索引的是**中文名**为主，所以两种名字都发。
  //
  // 顺序有意义：服务端逐个片名分别查询、命中即停，所以召回率高的要排前面 ——
  // 中文站单发中文名能出结果，发英文名基本空手。剧集也是这一套：中文名由后端从
  // TMDB 叠上去（server/tvmeta.js），title_en 是 TVmaze 原名，两个值都发。
  // （英文界面下 OPEN_FOR_LANG 直接让整个区块返回 null，走不到这里。）
  // title_en 与界面语言无关 —— 切换语言不会重发请求，也不会清空已加载的结果。
  const titles = useMemo(() => {
    const raw = [movie?.title, movie?.title_en].filter(Boolean).map((s) => String(s).trim())
    return [...new Set(raw.filter(Boolean))].slice(0, 3)
  }, [movie?.title, movie?.title_en])
  // 剧集不传年份：多季，首播年会把后几季硬过滤掉（服务端做 ±1 硬过滤）
  const year = movie?.kind === 'tv' ? '' : movie?.year || ''

  const queryKey = titles.join('|')

  // 「能搜」与「配了直连」是两件事，分开记：只往清单里塞了一条直连、一个采集站都没配的人
  // 也该看得见这一块，但他不该看见搜索按钮和「正在搜索采集站…」——那个永远不会回来的转圈
  // 比不显示这一块更糟。
  const searchable = (cfg?.sources?.length || 0) > 0
  // 这部片绑到的直连主源。matchDirect 只是遍历一个几条长的小数组，不值得 memo。
  const direct = matchDirect(cfg?.direct, movie)

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    fetchSourceList().then((d) => {
      if (!alive) return
      setCfg(d)
    })
    return () => {
      alive = false
    }
  }, [open])

  // 搜索：展开这一块就发（onOpen → started）。没有「刷新」「检测」这类按钮 ——
  // 补探活和补搜都在下面的 runDetect 里自动接上。
  useEffect(() => {
    if (!searchable || !started || titles.length === 0) return
    let alive = true
    const silent = silentRef.current
    silentRef.current = false
    // 静默那一轮（铺开后的重搜）不清列表、不摆「正在搜索」：屏幕上已经有结果了，
    // 抹掉再长回来就是一次闪烁，而这一轮只是把多出来的站补进去。
    if (!silent) {
      setStatus('loading')
      setData(null)
    }
    // 这里**不**动播放台：换片子时 App.jsx 的 key 会让整个组件重挂，playing 自然归零；
    // 而重搜这一路上搜的是同一部片，把正在看的流掐掉纯属倒退。
    const qs = titles.map((q) => `q=${encodeURIComponent(q)}`).join('&')
    const url = apiUrl(`/api/sources/search?${qs}${year ? `&year=${encodeURIComponent(year)}` : ''}`)
    // 仓库惯例：不用 AbortController，用 alive 标志丢弃过期响应
    const timer = setTimeout(() => {
      getJson(url, SEARCH_TIMEOUT).then((d) => {
        if (!alive) return
        setWidening(false)
        // 静默那一轮失败就当没发生过：现有结果比空列表有用，也别把错误态盖到一屏
        // 已经能点的源上。
        if (silent && !d) return
        setData(d)
        setStatus(d && Array.isArray(d.results) ? 'done' : 'error')
      })
    }, 0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // queryKey 已经唯一决定了 titles 的成员和顺序，不必再单列 titles
  }, [searchable, started, queryKey, year, nonce])

  // 自动补一轮：拿到**窄**结果（服务端这轮没走过探活，见 server/sources.js 的
  // probed 字段）就自己去把它铺开 —— 探活 → 探完重搜一次。
  //
  // 这不是另起一轮探活，是去**等**服务端已经踢出去的那一轮：冷搜索里 doSearch 会
  // `cacheProbe('all', doProbe)` 地把探活挂到后台，而 cacheProbe 对同一个 key 是
  // single-flight 的（server/sources.js 的 makeCache），所以这里 /probe 拿到的就是
  // 那一次的结果，不会把站点再打一遍。
  //
  // 探完必须**重搜**：多出来的那批站只有重搜一次才会出现在结果里。这一步的判据是
  // 服务端的 probeGen —— 探活一到手它就走一格，搜索缓存的 key 随之作废，所以这次
  // 重搜真的是在新池子上跑的，不是又读回那份窄的缓存。
  //
  // 整个过程用户什么都不用点：他要的是「点开就有」，不是「点开有一个按钮」。
  useEffect(() => {
    if (!searchable || !started) return
    if (status !== 'done' || !data || data.probed) return
    if (probedRef.current || probingRef.current) return
    probingRef.current = true
    setWidening(true)
    getJson(apiUrl('/api/sources/probe'), PROBE_TIMEOUT).then((d) => {
      probingRef.current = false
      // 探活自己失败（后端不可达/超时）就不认账：probedRef 留着 false，重搜之后再补，
      // 用户也可以点空态里的「重新搜索」再触发一次。
      if (!d) {
        setWidening(false)
        return
      }
      probedRef.current = true
      silentRef.current = true
      setNonce((n) => n + 1)
    })
  }, [searchable, started, status, data])

  // 重搜一次。空态里那个「重新搜索」按钮用 —— 这是这一块**唯一**的手动入口，
  // 而且只在已经出错/空手的时候才出现。
  const rescan = useCallback(() => setNonce((n) => n + 1), [])

  // 播放台内换集：只改地址和集名，片名/来路/整张剧集表原样留着 ——
  // 换完之后头行那句「来源 · 线路 · 第几集」和集数选择里的高亮都还是对的。
  const switchEpisode = useCallback((ep) => {
    setPlaying((p) => (p && ep ? { ...p, url: ep.url, epName: ep.name } : p))
  }, [])

  // 稳定的引用：播放台的 props 和折叠回调都用到它，每次渲染换新函数会让它们反复失效
  const closePlayer = useCallback(() => setPlaying(null), [])

  // 结果的引用要稳：下面 sourceNo 依赖它，每次渲染给新的 [] 会让那个 memo 白算
  const rows = useMemo(() => data?.results || [], [data])

  // 主源：搜索结果里的 nb（4kvms）行，由服务端标了 kind。
  //
  // 它跟采集站不是一类东西 —— 点开就是直链 m3u8，不用过解析站 —— 所以摘出来置顶成
  // 主源卡，而不是混在下面按评分排序（那正是服务端不肯把 nb 并进 mirrors 的理由）。
  //
  // 「哪几条算主源」得挑，不能把 nb 行全摆上去：**片名对不上的那些是常事，而且是
  // 另一部片**。实测（2026-09-19）4kvms 回的片名分三类：
  //   score 1   片名完全相同：流浪地球 / 琅琊榜
  //   score 0.8 前缀 + 副标题或版本尾巴：流浪地球：飞跃2020特别版（2020）、狂飙: 第1季（2023）
  //   score 0.8 但其实是**另一部片**：流浪地球2（2023）
  // 后两类靠**年份**分得开 —— 续集和重剪版的年份与本地页面不同，而剧集那一类
  // （站点上普遍叫「XX 第1季」，2010/2019/2023）年份正好与本页一致。
  // 所以：完全同名直接算；否则要 0.8 且年份对得上。
  //
  // **剧集命中几条就摘几条**（2026-09-19 改）：一季在 nb 那边就是独立的一条结果
  // （庆余年 第一季 / 第二季），只取第一条的话第二季会掉进下面那列结果里，用户得在
  // 两处分别找同一部剧。摘成一张卡里的「季」，选季就是换一条结果、重新拉它的线路与剧集。
  // 这也是「主源」该有的样子：它是这部片在这一站的答案，而不只是其中一季的答案。
  const mainSeasons = useMemo(() => {
    const y = Number(movie?.year) || 0
    // 完全同名直接算（它在服务端按 score 降序排过，所以总在最前）；否则要 0.8
    // **且年份对得上** —— 年份是唯一能把「同一部剧的另一季」和「另一部片」分开的信号。
    const hit = rows.filter(
      (r) =>
        r.kind === 'nb' &&
        (r.score === 1 || (r.score >= 0.8 && y && r.year && Math.abs(Number(r.year) - y) <= 1))
    )
    // 电影不这么干：同一部电影的 0.8 行是**另一个版本**（重剪、特别版），不是「第几季」，
    // 摆成季格反而误导 —— 它在下面那列结果里本来就能点。所以电影仍旧只取一条。
    if (movie?.kind !== 'tv') return hit.slice(0, 1)
    // 按年份排（站点顺序大致就是季序，但年份更硬），没给年份的按站点顺序垫在后面。
    // sort 是稳定的，所以同年同序的（神探夏洛克 第1~4季全在 2010）不会被搅乱。
    return [...hit].sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999))
  }, [rows, movie?.year, movie?.kind])

  // 摘进主源卡的这几条不再出现在下面的结果列里（含没被摘中的 nb 行 —— 它们照样要有
  // 来源编号，否则卡片上什么都不显示）
  const mainKeys = useMemo(() => new Set(mainSeasons.map(rowKey)), [mainSeasons])
  const plainRows = useMemo(() => rows.filter((r) => !mainKeys.has(rowKey(r))), [rows, mainKeys])
  // 主源整块在不在，看还有没有活着的一条（全没了就是每一季都试过且都没货，见 openTarget）
  const mainLive = useMemo(
    () => mainSeasons.length > 0 && mainSeasons.some((r) => !hidden.has(rowKey(r))),
    [mainSeasons, hidden]
  )
  const listRows = useMemo(() => plainRows.filter((r) => !hidden.has(rowKey(r))), [plainRows, hidden])

  // 一轮新结果（重搜 / 铺开后的补搜）到手，这份账就作废 —— 新结果里的同一行是新的一次
  // 机会，不该继承上一轮的退场。size 为 0 时原样返回，免得白白触发一次渲染。
  useEffect(() => {
    setHidden((s) => (s.size ? new Set() : s))
  }, [data])

  const hideRow = useCallback((sourceId, vodId) => {
    setHidden((s) => (s.has(`${sourceId}:${vodId}`) ? s : new Set(s).add(`${sourceId}:${vodId}`)))
  }, [])

  // 来源编号：按结果里**首次出现**的顺序编 1、2、3…
  //
  // 同一个来源在整列里永远是同一个号 —— 这点很重要，按行号编的话同一条来源会在
  // 不同行上显示成不同的数字，反而更乱。它是给「在这一列里指认某一行」用的，
  // 所以只要在一次结果内稳定就够，不需要跨次搜索稳定。
  //
  // 用**没过滤过退场行**的 plainRows 编：否则退场一条，它后面所有来源的号会整体前移。
  const sourceNo = useMemo(() => {
    const m = new Map()
    for (const r of plainRows) if (!m.has(r.sourceId)) m.set(r.sourceId, m.size + 1)
    return m
  }, [plainRows])

  // 上了锁：给出锁定卡。此时 cfg 还是 null（清单压根没拉），所以这一段必须在
  // 下面那些判据**之前**，否则整块会先消失，用户连「这里有东西、只是要口令」都看不到。
  if (!open && lang === OPEN_FOR_LANG) {
    return (
      <CollapsibleSection title={t('play.title')} onOpen={() => setStarted(true)}>
        <PlayGate onUnlock={unlock} />
      </CollapsibleSection>
    )
  }
  // 语言不对、配置未知、或未配置：什么都不渲染。
  // 未知时也返回 null 是有意的 —— 先渲染一个占位再抹掉会造成 CLS，
  // 而这块在折叠状态下只占标题那一行，晚一点出现几乎无感。
  if (!open || cfg?.enabled !== true) return null
  // 清单里只有采集站、这部片又没有直连主源时照常走搜索那条路（下面会渲染）。
  // 但**一个采集站都没配**的人，如果这部片也没绑直连，这一块对他就只是一句
  // 「未找到该片的播放源」——那不是信息，是把「我没配」说成了「没有」。
  if (!searchable && direct.length === 0) return null

  const busy = status === 'loading'

  // 播放台头行显示的片名。带直连时它上面是「片名 | 线路名」，跟结果卡那条一致；
  // movie.title 缺席（理论上不会，兜一下）就退回线路名，总比空着强。
  const filmTitle = movie?.title || movie?.title_en || ''

  return (
    <CollapsibleSection
      title={t('play.title')}
      // 主源永远算一条 —— 它不依赖搜索，折叠着也该被数进去。
      // 主源卡里的季不另算：上面那个数字是「有几种选择」，一张卡就是一种。
      count={direct.length + (status === 'done' ? (mainLive ? 1 : 0) + listRows.length : 0)}
      // 搜索要打几十个站，推迟到用户真的展开这一块再发
      onOpen={() => setStarted(true)}
      // 折叠只是把 grid 行收成 0fr，播放台**不会卸载** —— 不收掉的话声音会继续响
      onCollapse={closePlayer}
    >
      {/* 主源排在最上面，**在搜索控件之前**：它才是这部片的答案，下面那一整段是备选。
          顺序反过来的话，「往下翻」就成了读这块的第一件事，而主源正是为了省掉这件事。

          两批主源的先后是固定的：手绑的 direct（清单里就有，立刻在），
          然后是搜索出来的 nb（要等那一轮跑完）。nb 排前面的话，它一到手就把手绑的
          那条往下挤 —— 内容是后到的，位置却是前面的。 */}
      {direct.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {direct.map((d) => (
            <DirectCard key={d.id} entry={d} title={filmTitle || d.label} onPlay={setPlaying} />
          ))}
        </div>
      )}

      {mainLive && (
        <div className="mb-3 space-y-1.5">
          {/* 主源卡只有**一张**：命中的那几条季都在它里面（见 ResultCard 的 seasons）。
              key 跟着第一条走 —— 换片时 App.jsx 已经重挂整块，这里只是别让补搜之后
              季表变了还复用旧状态。 */}
          <ResultCard
            key={`main-${rowKey(mainSeasons[0])}`}
            row={mainSeasons[0]}
            seasons={mainSeasons}
            title={filmTitle}
            no={0}
            primary
            activeUrl={playing?.url}
            onPlay={setPlaying}
            onEmpty={hideRow}
          />
        </div>
      )}

      {searchable && (
        <>
          <SourceNotice />

          {/* 铺开那一轮的进度就一行字，没有按钮 —— 它是自动发生的，摆个控件在那儿
              只会让用户以为得点一下（见 runDetect 那段说明）。 */}
          {widening && status === 'done' && (
            <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">{t('play.probeRunning')}</p>
          )}

          {busy && <Hint>{t('play.searching')}</Hint>}
          {/* 出错和空结果都配一个「重新搜索」：这一块没有常驻按钮了，而搜索失败是常事
              （站点超时、后端不可达）。没有它，用户唯一能做的就是刷新整页。 */}
          {status === 'error' && <Hint action={<RescanButton onClick={rescan} />}>{t('play.unavailable')}</Hint>}
          {/* 有主源时不能说「未找到该片的播放源」——屏幕上方就摆着一条，自相矛盾。
              但也不能闭嘴不提：用户得知道搜索确实跑过了、只是没撞上。
              判据是**剩下几行**而不是结果总数：全部行都因为「展开后没有可播剧集」退场时，
              列表就是空的，这时同样得给一句话，不能让区块留一块白。 */}
          {status === 'done' && listRows.length === 0 && (
            <Hint action={<RescanButton onClick={rescan} />}>
              {direct.length > 0 || mainLive ? t('play.noResultsDirect') : t('play.noResults')}
            </Hint>
          )}

          {status === 'done' && listRows.length > 0 && (
            <div className="space-y-1.5">
              {/* key 里**不带下标**：铺开那一轮的静默重搜会让结果多出一批、顺序也变，
                  带上下标就会让同一行前后是两个 key，React 按 key 重挂 —— 用户刚展开
                  的那张卡会自己收起来。一行结果的身份就是「哪个站的哪一条」，下标不是。 */}
              {listRows.map((row) => (
                <ResultCard
                  key={rowKey(row)}
                  row={row}
                  no={sourceNo.get(row.sourceId) || 0}
                  activeUrl={playing?.url}
                  onPlay={setPlaying}
                  onEmpty={hideRow}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 没有可搜的站、只有直连主源时，说明块还是该在 —— 它讲的是整块功能的来路 */}
      {!searchable && <SourceNotice />}

      {/* 播放台常驻在最后一行，且不属于任何一条结果 —— 它挂在这一层，
          既保证了整页同时只有一个 <video>，也保证了它永远在列表下方。
          onSwitch 给播放台内建的集数选择用（见 VideoPlayer）：换集只改地址和集名，
          其余原样留着，所以换完之后头行和集数选择都还是对的。 */}
      <VideoPlayer item={playing} onClose={closePlayer} onSwitch={switchEpisode} />
    </CollapsibleSection>
  )
}
