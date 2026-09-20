import { useEffect, useState } from 'react'
import { posterFor, posterUrl, apiUrl, apiUrlWithLang } from '../api'
import { useLibrary } from '../hooks/useLibrary'
import { useI18n } from '../i18n'
import { titleUrl, personUrl, genreUrl } from '../routes'
import LibraryStats from './LibraryStats'
import NavLink from './NavLink'
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

function TitleCard({ item, list, onRemove }) {
  const { t } = useI18n()
  const isTv = item.kind === 'tv'
  const poster = posterFor(item, 'w185')
  const to = titleUrl(item.kind || 'movie', item.id, item.title)
  return (
    <div className="group flex gap-3 border border-zinc-200 p-3 transition hover:border-zinc-400">
      <div className="relative w-16 shrink-0">
        <NavLink to={to} className="block aspect-[2/3] w-full overflow-hidden bg-zinc-100">
          <SmartImage
            src={poster}
            alt={item.title}
            crossOrigin="anonymous"
            objectFit="cover"
            className="h-full w-full cursor-pointer"
          />
        </NavLink>
        <StatusBadge kind={item.kind || 'movie'} id={item.id} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <NavLink
          to={to}
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
        </NavLink>
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

function LikeCard({ item, onRemove }) {
  const { t } = useI18n()
  const isTitle = item.type === 'movie' || item.type === 'tv'
  // 旧 genre like 数据可能缺 kind 字段 → 拼不出 URL，禁用点击
  const genreDisabled = item.type === 'genre' && !item.kind

  // 三类点赞各自的落地页：片子 / 演职员 / 类型
  const to = isTitle
    ? titleUrl(item.type, item.id, item.name)
    : item.type === 'person'
      ? personUrl(item.id, item.name)
      : item.type === 'genre' && !genreDisabled
        ? genreUrl(item.kind, item.id, item.name)
        : null

  const className = `group flex items-center gap-3 border border-zinc-200 p-3 transition hover:border-zinc-400 ${to ? 'cursor-pointer' : 'cursor-default'}`
  const title = genreDisabled ? t('library.genreMissingKind') : undefined

  // 卡片内容两态共用；区别只在最外层是「能新标签页打开的链接」还是「不可点的 div」
  const body = (
    <>
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
      {/* 移除按钮嵌在可点容器内部：必须 preventDefault，否则点「移除」会顺手开一个新标签页 */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
        aria-label={t('library.removeFromLikes')}
        className="flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 transition hover:bg-black hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </>
  )

  if (!to) {
    return <div className={className} title={title}>{body}</div>
  }
  return <NavLink to={to} className={className} title={title}>{body}</NavLink>
}

export default function LibraryPage({ onGoHome }) {
  const [tab, setTab] = useState('watched')
  const { t, apiLang } = useI18n()
  // 解构带默认值：即使存储层返回的数据形状异常（如 localStorage 被禁用），列表也不会是 undefined
  const {
    watched = [],
    watchlater = [],
    likes = [],
    removeFromWatched,
    removeFromWatchLater,
    removeFromLikes,
    refreshAllRatings,
    updateEntriesMeta,
    updateLikesMeta,
  } = useLibrary()

  // 语言切换后回填本地化元信息：观影库（看过/待看）与「喜欢」里的条目存的是
  // 加入/点赞那一刻的语言快照，不随语言实时变化。
  // 电影与剧集都要回填 —— 剧集的中文片名/类型名是后端从 TMDB 叠上去的
  // （server/tvmeta.js），不回填的话英文界面下加入的剧集永远是英文名。
  // 两类**共用同一个数字空间**（TMDB id / TVmaze id），去重集合必须分开，
  // 否则 movie 335 会把 tv 335 当成同一条吃掉。
  // 例外（上游本身不随语言变，无需重取）：演职员姓名来自 TMDB person，无中文本地化。
  // 类型点赞只有 id，靠 /api/genres 拿到当前语言的类型名。
  useEffect(() => {
    // 同一部作品可能既在观影库又在「喜欢」里：按 id 去重，只取一次数据、两处各自回填。
    // 观影库的 kind 可能缺失（老数据在读取时按 movie 迁移），likes 则一律带 type。
    const idsOf = (kind) => {
      const seen = new Set()
      return [
        [...watched, ...watchlater]
          .filter((m) => (m.kind || 'movie') === kind && !seen.has(m.id) && seen.add(m.id))
          .map((m) => m.id),
        likes
          .filter((l) => l.type === kind && !seen.has(l.id) && seen.add(l.id))
          .map((l) => l.id),
      ].flat()
    }
    const movieIds = [...new Set(idsOf('movie'))]
    const tvIds = [...new Set(idsOf('tv'))]
    const likedGenres = likes.filter((l) => l.type === 'genre')
    if (movieIds.length === 0 && tvIds.length === 0 && likedGenres.length === 0) return

    let alive = true
    ;(async () => {
      const fetchMeta = (kind, id) =>
        fetch(apiUrlWithLang(kind === 'tv' ? `/api/tv/${id}` : `/api/movie/${id}`))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((d) =>
            d ? { kind, id, title: d.title, genres: d.genres, poster_path: d.poster_path } : null
          )
      const [metaResults, genreList] = await Promise.all([
        Promise.all([
          ...movieIds.map((id) => fetchMeta('movie', id)),
          ...tvIds.map((id) => fetchMeta('tv', id)),
        ]),
        likedGenres.length > 0
          ? fetch(apiUrlWithLang('/api/genres'))
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
      ])
      if (!alive) return

      const rows = metaResults.filter(Boolean)
      if (rows.length > 0) updateEntriesMeta(rows)
      // 电影 / 剧集 / 类型几类点赞合并成一次写入：只通知一次，也不会出现「电影已换语言、类型还没换」的中间态
      if (rows.length > 0 || (genreList && likedGenres.length > 0)) {
        const likePatches = rows.map((m) => ({
          type: m.kind,
          id: m.id,
          name: m.title,
          // 「喜欢」只更新标题与海报（无类型名等字段）；海报缺失时保留原值
          //（剧集的 tvPoster 与语言无关，本来就不需要回填）
          poster: m.poster_path ? posterUrl(m.poster_path, 'w185') : undefined,
        }))
        if (genreList) {
          for (const l of likedGenres) {
            const table = genreList[l.kind === 'tv' ? 'tv' : 'movie'] || []
            const hit = table.find((g) => Number(g.id) === Number(l.id))
            if (hit) likePatches.push({ type: 'genre', id: l.id, name: hit.name })
          }
        }
        updateLikesMeta(likePatches)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLang])

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
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
