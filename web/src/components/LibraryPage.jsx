import { useState } from 'react'
import { posterFor, apiUrl } from '../api'
import { useLibrary } from '../hooks/useLibrary'
import { useI18n } from '../i18n'
import LibraryStats from './LibraryStats'
import SmartImage from './SmartImage'
import StatusBadge from './StatusBadge'

function formatRuntime(min) {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

// 修复旧数据中错误拼接的海报 URL
// 旧格式: https://image.tmdb.org/t/p/w185https://static.tvmaze.com/...
// 新格式: /api/tv/image?u=https://static.tvmaze.com/...
function fixPosterUrl(poster) {
  if (!poster) return null
  // 检测旧格式：TMDB 前缀后紧跟另一个完整 URL
  if (poster.startsWith('https://image.tmdb.org/t/p/')) {
    const match = poster.match(/^https:\/\/image\.tmdb\.org\/t\/p\/\w+(https?:\/\/.+)/)
    if (match) {
      return apiUrl(`/api/tv/image?u=${encodeURIComponent(match[1])}`)
    }
    // 纯 TMDB 路径（movie 旧数据）：改为代理格式
    const tmdbPath = poster.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/\w+/, '')
    if (tmdbPath.startsWith('/')) {
      return apiUrl(`/api/image?path=${encodeURIComponent(tmdbPath)}&s=w185`)
    }
  }
  return poster
}

function TitleCard({ item, list, onOpen, onRemove }) {
  const { t } = useI18n()
  const isTv = item.kind === 'tv'
  const poster = posterFor(item, 'w185')
  return (
    <div className="group flex gap-3 border border-zinc-200 p-3 transition hover:border-zinc-400">
      <div className="relative w-16 shrink-0">
        <div className="aspect-[2/3] w-full overflow-hidden bg-zinc-100">
          <SmartImage
            src={poster}
            alt={item.title}
            crossOrigin="anonymous"
            objectFit="cover"
            className="h-full w-full cursor-pointer"
            onClick={() => onOpen(item.kind || 'movie', item.id)}
          />
        </div>
        <StatusBadge kind={item.kind || 'movie'} id={item.id} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onOpen(item.kind || 'movie', item.id)}
          className="block truncate text-left text-sm font-semibold text-zinc-900 hover:underline"
          title={item.title}
        >
          {isTv && (
            <span className="mr-1.5 border border-zinc-400 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              TV
            </span>
          )}
          {item.title}
          {item.year && <span className="ml-1.5 font-normal text-zinc-500">{item.year}</span>}
        </button>
        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-zinc-500">
          {list === 'watched' && item.myRating > 0 && (
            <span className="font-semibold text-amber-600">★ {item.myRating}</span>
          )}
          {item.rating != null && (
            <span>{isTv ? 'TVmaze' : 'TMDB'} {Number(item.rating).toFixed(1)}</span>
          )}
          {isTv ? (
            <>
              {item.seasonsCount != null && (
                <span>{item.seasonsCount} Season{item.seasonsCount === 1 ? '' : 's'}</span>
              )}
              {item.network && <span className="truncate">{item.network}</span>}
            </>
          ) : (
            <>
              {item.runtime > 0 && <span>{formatRuntime(item.runtime)}</span>}
              {item.director && <span className="truncate">Dir: {item.director}</span>}
            </>
          )}
        </div>
        {item.genres?.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-zinc-400">{item.genres.join(' · ')}</p>
        )}
      </div>
      <button
        onClick={() => onRemove(item.kind || 'movie', item.id)}
        aria-label={t('library.removeFromList')}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 transition hover:bg-black hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

function LikeCard({ item, onOpen, onOpenPerson, onOpenGenre, onRemove }) {
  const { t } = useI18n()
  const isTitle = item.type === 'movie' || item.type === 'tv'
  // 旧 genre like 数据可能缺 kind 字段 → 禁用点击
  const genreDisabled = item.type === 'genre' && !item.kind

  const handleOpen = () => {
    if (item.type === 'movie' || item.type === 'tv') {
      onOpen(item.type, item.id)
    } else if (item.type === 'person') {
      onOpenPerson?.({ id: item.id, name: item.name, source: 'tmdb' })
    } else if (item.type === 'genre' && !genreDisabled) {
      onOpenGenre?.(item.kind, item.id, item.name)
    }
  }

  const clickable = isTitle || item.type === 'person' || (item.type === 'genre' && !genreDisabled)

  return (
    <div
      className={`group flex items-center gap-3 border border-zinc-200 p-3 transition hover:border-zinc-400 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={clickable ? handleOpen : undefined}
      title={genreDisabled ? t('library.genreMissingKind') : undefined}
    >
      <div className="relative shrink-0">
        {item.poster ? (
          <SmartImage
            src={fixPosterUrl(item.poster)}
            alt={item.name}
            crossOrigin="anonymous"
            objectFit="cover"
            className="h-16 w-12"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center bg-zinc-100 text-lg font-bold text-zinc-400">
            {item.type === 'genre' ? '🎬' : '👤'}
          </div>
        )}
        {isTitle && <StatusBadge kind={item.type} id={item.id} size="sm" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="block truncate text-left text-sm font-semibold text-zinc-900" title={item.name}>
          {item.type === 'tv' && (
            <span className="mr-1.5 border border-zinc-400 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              TV
            </span>
          )}
          {item.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {item.type === 'genre' && t('library.genre')}
          {item.type === 'person' && (item.job ? `${item.job}` : t('library.person'))}
          {item.type === 'movie' && item.year ? item.year : ''}
          {item.type === 'tv' && item.yearRange ? item.yearRange : ''}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label={t('library.removeFromLikes')}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 transition hover:bg-black hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export default function LibraryPage({ onOpenTitle, onOpenPerson, onOpenGenre, onGoHome }) {
  const [tab, setTab] = useState('watched')
  const { t } = useI18n()
  // 解构带默认值：即使存储层返回的数据形状异常（如 localStorage 被禁用），列表也不会是 undefined
  const {
    watched = [],
    watchlater = [],
    likes = [],
    removeFromWatched,
    removeFromWatchLater,
    removeFromLikes,
    refreshAllRatings,
  } = useLibrary()

  const tabs = [
    { id: 'watched', label: t('library.watched'), count: watched.length },
    { id: 'watchlater', label: t('library.watchLater'), count: watchlater.length },
    { id: 'likes', label: t('library.likes'), count: likes.length },
    { id: 'stats', label: t('library.statistics') },
  ]

  const items = tab === 'watched' ? watched : tab === 'watchlater' ? watchlater : []
  const handleRemove = tab === 'watched' ? removeFromWatched : removeFromWatchLater
  // Likes 分组
  const likesByType = {
    movie: likes.filter((l) => l.type === 'movie'),
    tv: likes.filter((l) => l.type === 'tv'),
    genre: likes.filter((l) => l.type === 'genre'),
    person: likes.filter((l) => l.type === 'person'),
  }

  return (
    <div
      className="mx-auto w-full max-w-5xl px-6"
    >
      {/* Back */}
      <button
        type="button"
        onClick={onGoHome}
        className="mt-8 inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-600 transition hover:text-black"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        {t('library.back')}
      </button>

      <h2 className="mt-4 text-3xl font-bold uppercase tracking-tight">{t('library.myLibrary')}</h2>

      {/* Tabs：< sm 可横向滚动（不换行、不超出屏幕），≥ sm 恢复原间距 */}
      <div className="no-scrollbar -mx-6 mt-6 flex gap-4 overflow-x-auto border-b border-zinc-300 px-6 sm:mx-0 sm:gap-6 sm:px-0">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            className={`relative shrink-0 whitespace-nowrap pb-2 text-xs uppercase tracking-[0.15em] transition sm:tracking-[0.2em] ${
              tab === tabItem.id ? 'font-semibold text-black' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tabItem.label}
            {tabItem.count != null && (
              <span className="ml-1.5 text-zinc-400">{tabItem.count}</span>
            )}
            {tab === tabItem.id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-black" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-6">
        {tab === 'likes' ? (
          likes.length === 0 ? (
            <div className="border border-dashed border-zinc-300 py-16 text-center">
              <p className="text-sm text-zinc-500">
                {t('library.noLikes')}
              </p>
              <button
                onClick={onGoHome}
                className="mt-4 border border-black px-4 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-black hover:text-white"
              >
                {t('common.explore')}
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {[
                { type: 'movie', label: t('library.movies'), items: likesByType.movie },
                { type: 'tv', label: t('library.tvShows'), items: likesByType.tv },
                { type: 'genre', label: t('library.genres'), items: likesByType.genre },
                { type: 'person', label: t('library.people'), items: likesByType.person },
              ].map(({ type, label, items: typeItems }) =>
                typeItems.length === 0 ? null : (
                  <div key={type}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      {label} <span className="text-zinc-400">{typeItems.length}</span>
                    </h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {typeItems.map((item) => (
                        <LikeCard
                          key={`${item.type}:${item.id}`}
                          item={item}
                          onOpen={onOpenTitle}
                          onOpenPerson={onOpenPerson}
                          onOpenGenre={onOpenGenre}
                          onRemove={() => removeFromLikes(item.type, item.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          )
        ) : tab === 'stats' ? (
          <LibraryStats watched={watched} onRefreshRatings={(onProgress) => refreshAllRatings(apiUrl, onProgress)} />
        ) : items.length === 0 ? (
          <div className="border border-dashed border-zinc-300 py-16 text-center">
            <p className="text-sm text-zinc-500">
              {tab === 'watched'
                ? t('library.watchedEmpty')
                : t('library.watchLaterEmpty')}
            </p>
            <button
              onClick={onGoHome}
              className="mt-4 border border-black px-4 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-black hover:text-white"
            >
              {t('library.findMovies')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <TitleCard
                key={`${item.kind || 'movie'}:${item.id}`}
                item={item}
                list={tab}
                onOpen={onOpenTitle}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
