import { useEffect, useRef, useState } from 'react'

// 通用图片组件：
// - 加载中显示骨架屏（skeleton）
// - 加载失败显示 "No poster" 占位
// - 原生 loading="lazy" 实现分批加载（浏览器视口外不请求）
// - 支持自定义宽高比（aspect），无则按图片真实比例
// - 超时兜底：10s 未加载完成自动降级为 error，防止骨架屏永久转圈
const TIMEOUT_MS = 10000

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
  const imgRef = useRef(null)
  const timerRef = useRef(null)

  // src 变化时重置状态
  useEffect(() => {
    if (!src) {
      setStatus('error')
      return
    }
    setStatus('loading')

    // 清除旧的 timer
    if (timerRef.current) clearTimeout(timerRef.current)

    // 超时兜底：图片卡住时降级为 error
    timerRef.current = setTimeout(() => {
      setStatus((s) => (s === 'loading' ? 'error' : s))
    }, TIMEOUT_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [src])

  // 检查缓存图片是否已完成加载（onLoad 可能先于 effect 执行）
  useEffect(() => {
    if (status !== 'loading') return
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setStatus('done')
    }
  }, [status, src])

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
      {/* 骨架屏：加载中显示，图片加载完成后隐藏 */}
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-zinc-200" />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        crossOrigin={crossOrigin}
        onLoad={() => setStatus('done')}
        onError={() => setStatus('error')}
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
