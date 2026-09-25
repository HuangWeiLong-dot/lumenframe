import { memo, useEffect, useRef, useState } from 'react'
import { acquireSlot } from '../imageQueue'
import { tRaw as t } from '../i18n'

// 通用图片组件：
// - 加载中显示 shimmer 骨架屏
// - 加载失败显示 "No poster" 占位
// - loading="lazy" 让视口外图片不请求
// - 支持自定义宽高比（aspect）
const MAX_RETRIES = 2
const RETRY_DELAYS = [400, 1200]
const LOAD_TIMEOUT = 8000 // 8s 无响应则重试

const SmartImage = memo(function SmartImage({
  src,
  alt = '',
  className = '',
  aspect,
  objectFit = 'cover',
  onClick,
  selected = false,
  crossOrigin,
  // lazy=false：不使用 loading="lazy"，拿到槽位就立刻发请求。
  // 给「一次给一整套、且用户已经主动展开」的图用（剧照网格）：开着的 lazy 会让
  // 视口外的图**占着槽位却不发请求**，8s 超时到点 → 重试 → 再超时 → 判失败，
  // 于是没滚到的那几张反而被标成「加载失败」。视口外就真的不该加载的场景，
  // 交给 lazy 以外的机制（条件挂载）更干净。
  lazy = true,
  // 彻底放弃时回调一次（重试已用尽），参数是原始的 src。
  onError,
}) {
  const [status, setStatus] = useState(src ? 'loading' : 'error')
  const [imgSrc, setImgSrc] = useState(null)
  const [retry, setRetry] = useState(0)
  const imgRef = useRef(null)
  const releaseRef = useRef(null)
  const cancelledRef = useRef(false)
  const timeoutRef = useRef(null)

  // 用 ref 存回调：它不该进 effect 依赖，否则调用方每次渲染换个函数就会重跑加载
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // src 变化 → 重置状态并加载
  useEffect(() => {
    cancelledRef.current = false

    // 清理上一个 slot 和 timeout
    if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }

    if (!src) {
      setStatus('error')
      return
    }

    setStatus('loading')
    setRetry(0)
    setImgSrc(null)

    // disposed 是**本次 effect 运行**的作废标记，必须与 cancelledRef 分开：
    // StrictMode 的双挂载是 挂载A → 清理A → 挂载B，而清理A 会把 cancelledRef 重置回
    // false 的是挂载B。于是排队中的 acquireSlot()（队列满时它要等）在 A 之后才 resolve，
    // 此刻 cancelledRef 已是 false，槽位被认领；紧接着 B 的 promise 也 resolve，
    // 覆盖掉 releaseRef —— A 拿到的 releaser 从此无人引用，那个槽位永久泄漏。
    // 槽位漏满 8 个，队列就彻底不动（实测 active=8 / waiting=120，页面图片全卡住）。
    let disposed = false

    acquireSlot().then((release) => {
      if (disposed || cancelledRef.current) {
        release()
        return
      }
      releaseRef.current = release
      const actualSrc = retry > 0 ? `${src}${src.includes('?') ? '&' : '?'}_r=${retry}` : src
      setImgSrc(actualSrc)

      // 超时保护：如果 img 长时间不触发 onLoad/onError，主动重试
      timeoutRef.current = setTimeout(() => {
        if (disposed || cancelledRef.current) return
        const img = imgRef.current
        if (img && (!img.complete || img.naturalWidth === 0)) {
          release()
          releaseRef.current = null
          if (retry < MAX_RETRIES) {
            setRetry(r => r + 1)
          } else {
            setStatus('error')
            onErrorRef.current?.(src)
          }
        }
      }, LOAD_TIMEOUT + (retry * 1000))
    })

    return () => {
      disposed = true
      cancelledRef.current = true
      if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    }
  }, [src])

  // 重试（带退避延迟）
  useEffect(() => {
    if (retry === 0) return
    cancelledRef.current = false
    setStatus('loading')
    setImgSrc(null)

    if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }

    // 同上：每次重试都是一次独立的 effect 运行，兜住排队中被作废的那次
    let disposed = false

    const delay = RETRY_DELAYS[Math.min(retry - 1, RETRY_DELAYS.length - 1)]
    const timer = setTimeout(() => {
      acquireSlot().then((release) => {
        if (disposed || cancelledRef.current) {
          release()
          return
        }
        releaseRef.current = release
        const actualSrc = `${src}${src.includes('?') ? '&' : '?'}_r=${retry}`
        setImgSrc(actualSrc)

        timeoutRef.current = setTimeout(() => {
          if (disposed || cancelledRef.current) return
          const img = imgRef.current
          if (img && (!img.complete || img.naturalWidth === 0)) {
            release()
            releaseRef.current = null
            if (retry < MAX_RETRIES) {
              setRetry(r => r + 1)
            } else {
              setStatus('error')
              onErrorRef.current?.(src)
            }
          }
        }, LOAD_TIMEOUT + (retry * 1000))
      })
    }, delay)

    return () => {
      disposed = true
      cancelledRef.current = true
      clearTimeout(timer)
      if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    }
  }, [retry]) // eslint-disable-line react-hooks/exhaustive-deps

  // 缓存命中检测：onLoad 先于 effect
  useEffect(() => {
    if (status !== 'loading' || !imgSrc) return
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setStatus('done')
      if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    }
  }, [status, imgSrc])

  if (status === 'error' || !src) {
    return (
      <div
        onClick={onClick}
        className={`flex items-center justify-center bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-400 ${onClick ? 'cursor-pointer' : ''} ${className}`}
        style={aspect ? { aspectRatio: aspect } : undefined}
      >
        {t('common.noPoster')}
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-zinc-100 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={aspect ? { aspectRatio: aspect } : undefined}
    >
      {/* shimmer 骨架屏：absolute 但容器有 bg-zinc-100 兜底，不会塌陷 */}
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden bg-zinc-200">
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
              animation: 'shimmer 1.5s infinite',
            }}
          />
        </div>
      )}
      <img
        ref={imgRef}
        src={imgSrc || undefined}
        alt={alt}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        crossOrigin={crossOrigin}
        onLoad={() => {
          setStatus('done')
          if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
        }}
        onError={() => {
          if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
          if (retry < MAX_RETRIES) {
            setRetry(retry + 1)
          } else {
            setStatus('error')
            onErrorRef.current?.(src)
          }
        }}
        style={{ objectFit }}
        className={`h-full w-full transition-opacity duration-300 ${
          status === 'done' ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {selected && (
        <span className="absolute bottom-2 left-2 bg-black px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          On card
        </span>
      )}
    </div>
  )
})

export default SmartImage
