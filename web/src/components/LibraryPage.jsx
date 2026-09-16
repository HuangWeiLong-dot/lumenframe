import { useState } from 'react'
import { posterFor, apiUrl } from '../api'
import { useLibrary } from '../hooks/useLibrary'
import LibraryStats from './LibraryStats'
import SmartImage from './SmartImage'

function formatRuntime(min) {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function TitleCard({ item, list, onOpen, onRemove }) {
  const isTv = item.kind === 'tv'
  const poster = posterFor(item, 'w185')
  return (
    <div className="group flex gap-3 border border-zinc-200 p-3 transition hover:border-zinc-400">
      <SmartImage
        src={poster}
        alt={item.title}
        crossOrigin="anonymous"
        objectFit="cover"
        className="h-auto w-16 shrink-0 cursor-pointer"
        onClick={() => onOpen(item.kind || 'movie', item.id)}
      />
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
        aria-label="Remove from list"
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

export default function LibraryPage({ onOpenTitle, onGoHome }) {
  const [tab, setTab] = useState('watched')
  const { watched, watchlater, removeFromWatched, removeFromWatchLater, refreshAllRatings } = useLibrary()

  const tabs = [
    { id: 'watched', label: 'Watched', count: watched.length },
    { id: 'watchlater', label: 'Watch Later', count: watchlater.length },
    { id: 'stats', label: 'Statistics' },
  ]

  const items = tab === 'watched' ? watched : tab === 'watchlater' ? watchlater : []
  const handleRemove = tab === 'watched' ? removeFromWatched : removeFromWatchLater

  return (
    <div
      className="mx-auto w-full max-w-5xl px-6"
      style={{ fontFamily: "'Inter', Arial, sans-serif" }}
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
        Back
      </button>

      <h2 className="mt-4 text-3xl font-bold uppercase tracking-tight">My Library</h2>

      {/* Tabs */}
      <div className="mt-6 flex gap-6 border-b border-zinc-300">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative pb-2 text-xs uppercase tracking-[0.2em] transition ${
              tab === t.id ? 'font-semibold text-black' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className="ml-1.5 text-zinc-400">{t.count}</span>
            )}
            {tab === t.id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-black" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-6">
        {tab === 'stats' ? (
          <LibraryStats watched={watched} onRefreshRatings={(onProgress) => refreshAllRatings(apiUrl, onProgress)} />
        ) : items.length === 0 ? (
          <div className="border border-dashed border-zinc-300 py-16 text-center">
            <p className="text-sm text-zinc-500">
              {tab === 'watched'
                ? 'Your watched list is empty. Search for movies and add them here.'
                : 'Your watch later list is empty.'}
            </p>
            <button
              onClick={onGoHome}
              className="mt-4 border border-black px-4 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-black hover:text-white"
            >
              Find Movies
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
