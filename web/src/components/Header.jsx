import { useEffect, useState } from 'react'
import { posterFor } from '../api'
import SmartImage from './SmartImage'

const REFERENCES = [
  { name: 'Film Art Gallery', url: 'https://filmartgallery.com' },
  { name: 'Stillslab', url: 'https://stillslab.com/' },
  { name: 'Frameset', url: 'https://frameset.app/' },
  { name: 'Shot.Cafe', url: 'https://shot.cafe/' },
  { name: 'Filmvibes', url: 'https://filmvibes.io/' },
  { name: 'Flim', url: 'https://flim.ai/' },
  { name: 'ShotDeck', url: 'https://shotdeck.com' },
]

const API_SOURCES = [
  { name: 'TMDB API', url: 'https://developer.themoviedb.org/docs' },
  { name: 'TVmaze API', url: 'https://www.tvmaze.com/api' },
  { name: 'OMDB API', url: 'https://www.omdbapi.com/' },
  { name: 'Watchmode API', url: 'https://api.watchmode.com/docs/' },
  { name: 'TasteDive API', url: 'https://tastedive.com/api/v1/' },
  { name: 'YouTube Data API', url: 'https://developers.google.com/youtube/v3' },
  { name: 'Torrent API', url: 'https://github.com/Ryuk-me/Torrent-Api-py' },
  { name: 'ShotOnWhat?', url: 'https://shotonwhat.com' },
]

function PinnedThumbnails({ pinned, onPickPinned, onUnpin, size = 'md' }) {
  const h = size === 'sm' ? 'h-10 w-7' : 'h-12 w-8'
  return (
    <>
      {pinned.map((p) => {
        const src = posterFor(p, 'w92')
        return (
          <div key={`${p.kind}:${p.id}`} className="group relative shrink-0">
            <button
              onClick={() => onPickPinned?.(p)}
              title={p.title}
              className={`block ${h} overflow-hidden bg-zinc-100 transition hover:opacity-80`}
            >
              {src ? (
                <SmartImage src={src} alt={p.title} className="h-full w-full" objectFit="cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[8px] text-zinc-400">
                  No poster
                </span>
              )}
            </button>
            {/* 取消 pin */}
            <button
              onClick={(e) => { e.stopPropagation(); onUnpin?.(p) }}
              aria-label="Unpin"
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center bg-black/70 text-white opacity-0 transition group-hover:opacity-100"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </div>
        )
      })}
    </>
  )
}

export default function Header({ onHome, onLibrary, pinned = [], onPickPinned, onUnpin }) {
  const [open, setOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  // 锁定背景滚动
  useEffect(() => {
    document.body.style.overflow = (open || pinOpen) ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open, pinOpen])

  const hasPins = pinned.length > 0

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between bg-white/70 px-4 py-3 backdrop-blur-md backdrop-saturate-150 sm:px-6 sm:py-4"
        style={{ fontFamily: "'Inter', Arial, sans-serif" }}
      >
        {/* 左侧 Logo + 移动端 pin 按钮 */}
        <div className="flex items-center gap-2">
          {hasPins && (
            <button
              onClick={() => setPinOpen(true)}
              aria-label="Pinned titles"
              className="flex h-8 w-8 items-center justify-center text-black transition hover:opacity-60 sm:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </button>
          )}
          <button
            onClick={onHome}
            className="text-base font-bold uppercase tracking-[0.12em] text-black transition hover:opacity-60 sm:text-lg sm:tracking-[0.15em]"
          >
            LUMENFRAME
          </button>
        </div>

        {/* 已 Pin 的标题：自适应宽度 */}
        {hasPins && (
          <div className="ml-3 hidden items-center gap-1.5 sm:flex">
            <PinnedThumbnails pinned={pinned} onPickPinned={onPickPinned} onUnpin={onUnpin} />
          </div>
        )}

        {/* 右侧：桌面 Library + References + 移动端汉堡 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onLibrary}
            className="hidden text-xs uppercase tracking-[0.2em] text-black transition hover:opacity-60 sm:block"
          >
            Library
          </button>
          <button
            onClick={() => setOpen(true)}
            className="hidden text-xs uppercase tracking-[0.2em] text-black transition hover:opacity-60 sm:block"
          >
            References
          </button>
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center text-black transition hover:opacity-60 sm:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="17" x2="21" y2="17" />
            </svg>
          </button>
        </div>
      </header>

      {/* 左侧 pin 滑块（移动端） */}
      {hasPins && (
        <>
          <div
            onClick={() => setPinOpen(false)}
            className={`fixed inset-0 z-[1001] bg-black/30 transition-opacity duration-300 ${
              pinOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
          <aside
            className={`fixed top-0 left-0 z-[1002] h-full w-72 max-w-[80vw] bg-white shadow-2xl transition-transform duration-300 ease-out ${
              pinOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            style={{ fontFamily: "'Inter', Arial, sans-serif" }}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <span className="text-xs uppercase tracking-[0.25em] text-zinc-500">Pinned</span>
              <button
                onClick={() => setPinOpen(false)}
                aria-label="Close"
                className="text-black transition hover:opacity-60"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto p-4" style={{ maxHeight: 'calc(100vh - 65px)' }}>
              {pinned.map((p) => {
                const src = posterFor(p, 'w185')
                return (
                  <div key={`${p.kind}:${p.id}`} className="group relative flex items-center gap-3 border border-zinc-100 p-2 transition hover:bg-zinc-50">
                    <button
                      onClick={() => { setPinOpen(false); onPickPinned?.(p) }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="h-16 w-11 shrink-0 overflow-hidden bg-zinc-100">
                        {src ? (
                          <SmartImage src={src} alt={p.title} className="h-full w-full" objectFit="cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[8px] text-zinc-400">No poster</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900">{p.title}</p>
                        <p className="text-xs text-zinc-500">{p.year || p.yearRange || ''}</p>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUnpin?.(p) }}
                      aria-label="Unpin"
                      className="flex h-6 w-6 shrink-0 items-center justify-center text-zinc-400 transition hover:text-red-500"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="6" y1="18" x2="18" y2="6" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>
        </>
      )}

      {/* 右侧 References 滑块 */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[1001] bg-black/30 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`fixed top-0 right-0 z-[1002] h-full w-80 max-w-[85vw] bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ fontFamily: "'Inter', Arial, sans-serif" }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-200">
          <span className="text-xs uppercase tracking-[0.25em] text-zinc-500">References</span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-black transition hover:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-col overflow-y-auto px-2 py-3" style={{ maxHeight: 'calc(100vh - 65px)' }}>
          <button
            onClick={() => { setOpen(false); onLibrary?.() }}
            className="flex items-center justify-between px-4 py-3.5 text-sm text-black transition hover:bg-zinc-100"
          >
            <span>My Library</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          <div className="mx-4 my-1 border-t border-zinc-100" />
          <span className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">API & Data Sources</span>
          {API_SOURCES.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-3 text-sm text-black transition hover:bg-zinc-100"
            >
              <span>{r.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                <path d="M7 17L17 7" />
                <path d="M7 7h10v10" />
              </svg>
            </a>
          ))}
          <div className="mx-4 my-1 border-t border-zinc-100" />
          {REFERENCES.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-3.5 text-sm text-black transition hover:bg-zinc-100"
            >
              <span>{r.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                <path d="M7 17L17 7" />
                <path d="M7 7h10v10" />
              </svg>
            </a>
          ))}
        </nav>

        {/* 作者头像 */}
        <div className="absolute bottom-5 right-5">
          {/* @ts-expect-error custom element */}
          <author-avatar
            src={`${import.meta.env.BASE_URL}avatar/1.jpg`}
            href="https://liveinpassion.me"
            target="_blank"
            alt="Author Avatar"
            size="56"
            style={{
              '--author-avatar-radius': '0',
              '--author-avatar-border': '#e5e5e5',
              '--author-avatar-border-hover': '#1a1a1a',
            }}
          />
        </div>
      </aside>
    </>
  )
}
