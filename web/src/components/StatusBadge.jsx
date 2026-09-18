import { useLibrary } from '../hooks/useLibrary'

// 状态角标：watched=黑底白对勾，watchlater=黑底时钟；无状态返回 null
// 组件自取 useLibrary store，避免 props 透传
export default function StatusBadge({ kind, id, size = 'md' }) {
  const { isInWatched, isInWatchLater } = useLibrary()
  if (!kind || id == null) return null
  const watched = isInWatched(kind, id)
  const later = isInWatchLater(kind, id)
  if (!watched && !later) return null

  // sm=小海报(64px)，md=网格大图
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const iconSize = size === 'sm' ? 9 : 11
  const offset = size === 'sm' ? 'right-1 top-1' : 'right-1.5 top-1.5'

  return (
    <div className={`absolute ${offset} z-10 flex ${dim} items-center justify-center bg-black/80 text-white`}>
      {watched ? (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      )}
    </div>
  )
}
