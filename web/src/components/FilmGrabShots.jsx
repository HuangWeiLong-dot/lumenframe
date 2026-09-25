import { useCallback, useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import SmartImage from './SmartImage'
import { FILMGRAB_BASE, downloadImage } from '../api'
import { useI18n } from '../i18n'

// 开发态默认走 Vite 的 /filmgrab 代理；公网构建只有配置了 VITE_FILMGRAB_BASE 才启用
// （FilmGrab 不接受爬取，请仅在自有/可信服务器上开启）
const ENABLED = FILMGRAB_BASE !== ''
// 列表：<挂载前缀>/screenshots
const listUrl = (qs) => `${FILMGRAB_BASE}/screenshots?${qs}`
// 接口返回 /api/proxy?url=...，把 /api 替换成对外挂载前缀
const rewrite = (u) => u.replace(/^\/api/, FILMGRAB_BASE)
// 网格里用站点的缩略图变体：500px / 54-91 KB，原图 1023-1280px / 152-299 KB。
// 一格实际只有 ~265px 宽，用原图是纯浪费 —— 65 张剧照的区块实测从 ~8.5 MB 降到 ~4.5 MB，
// 这是那个区块加载慢、十几张一直转不完的直接原因。
// 服务端推不出缩略图、或抓缩略图 404，都会自己回退原图，所以这里不必兜底。
const thumbOf = (u) => `${u}&s=thumb`

export default function FilmGrabShots({ movie, selected, onSelect }) {
  const { t } = useI18n()
  // FilmGrab 只认英文片名：中文界面下必须用 title_en，否则拿「盗梦空间」去搜永远 0 条
  // （实测 count=0，页面显示「暂无该片的剧照」——不是站点没收录，是名字搜错了）。
  // 与 Torrents / Subtitles / TasteDive / AlsoLiked 同一套规则。
  // title_en 与界面语言无关，所以切语言既不会重发请求、也不会清空已加载的剧照。
  const queryTitle = movie?.title_en || movie?.title
  const title = movie?.title // alt / 下载文件名用本地化片名
  const year = movie?.year || ''
  const [shots, setShots] = useState([])
  const [status, setStatus] = useState('loading') // loading | done | error
  const [active, setActive] = useState(null) // 灯箱当前图片
  // 展开过之后才挂载网格。折叠态下 CollapsibleSection 的子树**始终挂载**（0fr + overflow-hidden），
  // 若照常挂上去，一次点开详情页就会有 65 张图同时抢 imageQueue 的 8 个槽位，
  // 把同页海报挤到后面 —— 而用户此刻还根本没打开这一块。
  const [everOpened, setEverOpened] = useState(false)
  const [failed, setFailed] = useState(() => new Set()) // 重试完仍失败的剧照，整格隐去

  // SmartImage 放弃加载时回调：沿用原来的做法，把这一格整个收掉（不是留个占位）。
  // 用 useCallback 保住 SmartImage 的 memo —— 每次渲染换一个函数等于每格都重渲染。
  const handleTileError = useCallback((src) => {
    setFailed((prev) => (prev.has(src) ? prev : new Set(prev).add(src)))
  }, [])

  useEffect(() => {
    if (!queryTitle || !ENABLED) return
    // 不用 AbortController：开发态 StrictMode 二次挂载会立即 abort 首个请求，
    // 浏览器会把取消的 fetch 以 net::ERR_ABORTED 打进控制台。
    // 延迟到下一个宏任务发起——StrictMode 的同步 cleanup 会清掉首个定时器，
    // 实际只发一次请求；过期/卸载后的响应直接丢弃。
    let alive = true
    setStatus('loading')
    setShots([])

    const timer = setTimeout(() => {
      const qs = `movie=${encodeURIComponent(queryTitle)}&year=${encodeURIComponent(year)}`
      fetch(listUrl(qs))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          setShots((data.screenshots || []).map(rewrite))
          setStatus('done')
        })
        .catch(() => {
          if (alive) setStatus('error')
        })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [queryTitle, year])

  // 关闭灯箱：Esc
  useEffect(() => {
    if (active == null) return
    const onKey = (e) => { if (e.key === 'Escape') setActive(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // 未配置剧照服务或服务异常：显示区块 + 提示，而不是静默消失
  if (!ENABLED) {
    return (
      <CollapsibleSection title={t('filmGrab.title')}>
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.notConfigured')}
        </div>
      </CollapsibleSection>
    )
  }
  if (status === 'error') {
    return (
      <CollapsibleSection title={t('filmGrab.title')}>
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.error')}
        </div>
      </CollapsibleSection>
    )
  }

  const headerAction = (
    <a
      href="https://film-grab.com"
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs text-zinc-600 underline-offset-2 hover:underline"
    >
      {t('filmGrab.via')}
    </a>
  )

  return (
    <>
    <CollapsibleSection
      title={t('filmGrab.title')}
      count={shots.length}
      action={headerAction}
      onOpen={() => setEverOpened(true)}
    >
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.fetching')}
        </div>
      )}

      {status === 'done' && shots.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          {t('filmGrab.emptyMovie')}
        </div>
      )}

      {status === 'done' && shots.length > 0 && everOpened && (
        <>
          {/* 选中态是两条 inset 描边，都画在图片**内部** —— 外描边会被 CollapsibleSection
              的 overflow-hidden 裁掉（最左/最右一列正好和网格同宽）。
                外圈 2px 黑：inset-ring-2 inset-ring-black（box-shadow 列表里排在前面 = 画在上层）
                内圈 2px 白：ring-4 ring-inset ring-white（在下层，外侧 2px 被黑圈盖住）
              两条都要：亮图上黑圈可见、暗图上白圈可见，单靠任一条都有整类图看不出来。
              别改成外层 ring + ring-offset：offset 那层白圈在 box-shadow 列表里排在黑圈
              之前，即画在黑圈**之上**，会在黑边与图片之间凿出一条白缝。 */}
          <p className="mb-3 text-xs text-zinc-700">{t('filmGrab.tapForCard')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            {shots.map((src, i) => {
              // 失败集合按 SmartImage 拿到的那个地址记（也就是缩略图地址），
              // 不是这里原图的那个 —— 用 src 去查会永远查不到，格子就收不掉。
              const thumbSrc = thumbOf(src)
              if (failed.has(thumbSrc)) return null
              const isSelected = selected === src
              return (
                <div
                  key={src}
                  className={`group relative overflow-hidden bg-zinc-100 transition ${
                    isSelected ? 'ring-4 ring-inset ring-white inset-ring-2 inset-ring-black' : ''
                  }`}
                >
                  {/* 图片走 SmartImage：与页面其它图片共享 imageQueue 的 8 个槽位，
                      并自带 8s 超时 + 两段重试。原来这里是裸 <img loading="lazy">，
                      直接打向代理 —— 既不在限流里，也没有超时和重试，浏览器漏掉或
                      卡住的那几张就永远空着（实测 65 张里有 11-20 张一直加载不完，
                      而服务端每个请求都是 200）。
                      lazy={false}：这一片是用户主动展开的、有界的几十张，不该再让
                      浏览器按视口延迟发包 —— 视口外的图会占着槽位不发请求，8s 超时
                      一到反而被误判成加载失败。
                      卡面用缩略图，选中的那一张（卡片导出/灯箱）仍取原图。 */}
                  <div className="transition group-hover:scale-105">
                    <SmartImage
                      src={thumbSrc}
                      alt={`${title} still ${i + 1}`}
                      aspect="16 / 9"
                      crossOrigin="anonymous"
                      lazy={false}
                      onError={handleTileError}
                    />
                  </div>

                  {/* 选中/取消选中：覆盖整格的透明按钮，压在图片之上 */}
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : src)}
                    className="absolute inset-0 h-full w-full"
                    aria-label={isSelected ? t('filmGrab.removeFromCard') : t('filmGrab.useOnCard')}
                  />

                  {/* 放大预览（不影响选图） */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setActive(src) }}
                    aria-label={t('filmGrab.preview')}
                    className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-100 transition hover:bg-black/75 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </button>

                  {isSelected && (
                    <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      {t('common.onCard')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </CollapsibleSection>

      {active != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setActive(null)}
        >
          <img
            src={active}
            alt={`${title} still`}
            crossOrigin="anonymous"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadImage(active, `${title} - still.jpg`) }}
            aria-label={t('filmGrab.download')}
            className="absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}
