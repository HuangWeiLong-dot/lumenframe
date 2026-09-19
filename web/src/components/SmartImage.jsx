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
}) {
  const [status, setStatus] = useState(src ? 'loading' : 'error')
  const [imgSrc, setImgSrc] = useState(null)
  const [retry, setRetry] = useState(0)
  const imgRef = useRef(null)
  const releaseRef = useRef(null)
  const cancelledRef = useRef(false)
  const timeoutRef = useRef(null)

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

    acquireSlot().then((release) => {
      if (cancelledRef.current) {
        release()
        return
      }
      releaseRef.current = release
      const actualSrc = retry > 0 ? `${src}${src.includes('?') ? '&' : '?'}_r=${retry}` : src
      setImgSrc(actualSrc)

      // 超时保护：如果 img 长时间不触发 onLoad/onError，主动重试
      timeoutRef.current = setTimeout(() => {
        if (cancelledRef.current) return
        const img = imgRef.current
        if (img && (!img.complete || img.naturalWidth === 0)) {
          release()
          releaseRef.current = null
          if (retry < MAX_RETRIES) {
            setRetry(r => r + 1)
          } else {
            setStatus('error')
          }
        }
      }, LOAD_TIMEOUT + (retry * 1000))
    })

    return () => {
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

    const delay = RETRY_DELAYS[Math.min(retry - 1, RETRY_DELAYS.length - 1)]
    const timer = setTimeout(() => {
      acquireSlot().then((release) => {
        if (cancelledRef.current) {
          release()
          return
        }
        releaseRef.current = release
        const actualSrc = `${src}${src.includes('?') ? '&' : '?'}_r=${retry}`
        setImgSrc(actualSrc)

        timeoutRef.current = setTimeout(() => {
          if (cancelledRef.current) return
          const img = imgRef.current
          if (img && (!img.complete || img.naturalWidth === 0)) {
            release()
            releaseRef.current = null
            if (retry < MAX_RETRIES) {
              setRetry(r => r + 1)
            } else {
              setStatus('error')
            }
          }
        }, LOAD_TIMEOUT + (retry * 1000))
      })
    }, delay)

    return () => {
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
        loading="lazy"
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
