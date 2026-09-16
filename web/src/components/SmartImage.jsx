import { useEffect, useRef, useState } from 'react'
import { acquireSlot } from '../imageQueue'

// 通用图片组件：
// - 全局并发限流（同时最多 4 张），排队中显示骨架屏
// - 加载中显示骨架屏（skeleton）
// - 加载失败显示 "No poster" 占位
// - loading="lazy" 让视口外图片不请求
// - 支持自定义宽高比（aspect）
const MAX_RETRIES = 1

export default function SmartImage({
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

  // src 变化 → 重置状态，排队请求加载
  useEffect(() => {
    cancelledRef.current = false

    if (!src) {
      setStatus('error')
      return
    }

    setStatus('loading')
    setRetry(0)
    setImgSrc(null)

    // 释放上一个 slot
    if (releaseRef.current) {
      releaseRef.current()
      releaseRef.current = null
    }

    let releasedEarly = false
    acquireSlot().then((release) => {
      if (cancelledRef.current) {
        // 组件已卸载或 src 已变，直接释放
        release()
        return
      }
      releaseRef.current = release

      // 重试时加 cache-buster
      const actualSrc = retry > 0 ? `${src}${src.includes('?') ? '&' : '?'}_r=${retry}` : src
      setImgSrc(actualSrc)
    })

    return () => {
      cancelledRef.current = true
      if (releaseRef.current) {
        releaseRef.current()
        releaseRef.current = null
      }
    }
  }, [src])

  // 重试时重新排队
  useEffect(() => {
    if (retry === 0) return
    cancelledRef.current = false
    setStatus('loading')
    setImgSrc(null)

    if (releaseRef.current) {
      releaseRef.current()
      releaseRef.current = null
    }

    acquireSlot().then((release) => {
      if (cancelledRef.current) {
        release()
        return
      }
      releaseRef.current = release
      const actualSrc = `${src}${src.includes('?') ? '&' : '?'}_r=${retry}`
      setImgSrc(actualSrc)
    })

    return () => {
      cancelledRef.current = true
      if (releaseRef.current) {
        releaseRef.current()
        releaseRef.current = null
      }
    }
  }, [retry])

  // 缓存命中检测：onLoad 先于 effect
  useEffect(() => {
    if (status !== 'loading' || !imgSrc) return
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setStatus('done')
      if (releaseRef.current) {
        releaseRef.current()
        releaseRef.current = null
      }
    }
  }, [status, imgSrc])

  if (status === 'error' || !src) {
    return (
      <div
        onClick={onClick}
        className={`flex items-center justify-center bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-400 ${onClick ? 'cursor-pointer' : ''} ${className}`}
        style={aspect ? { aspectRatio: aspect } : undefined}
      >
        No poster
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={aspect ? { aspectRatio: aspect } : undefined}
    >
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-zinc-200" />
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
          if (releaseRef.current) {
            releaseRef.current()
            releaseRef.current = null
          }
        }}
        onError={() => {
          if (releaseRef.current) {
            releaseRef.current()
            releaseRef.current = null
          }
          if (retry < MAX_RETRIES) {
            setRetry(retry + 1)
          } else {
            setStatus('error')
          }
        }}
        style={{ objectFit }}
        className={`h-full w-full transition ${
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
}
