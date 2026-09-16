import { useEffect, useState } from 'react'

// 通用图片组件：
// - 加载中显示骨架屏（skeleton）
// - 加载失败显示 "No poster" 占位
// - 原生 loading="lazy" 实现分批加载（浏览器视口外不请求）
// - 支持自定义宽高比（aspect），无则按图片真实比例
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

  // src 变化时重置状态
  useEffect(() => {
    setStatus(src ? 'loading' : 'error')
  }, [src])

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
