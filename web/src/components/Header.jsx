import { useEffect, useState } from 'react'

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
  { name: 'OMDB API', url: 'https://www.omdbapi.com/' },
  { name: 'Watchmode API', url: 'https://api.watchmode.com/docs/' },
  { name: 'YouTube Data API', url: 'https://developers.google.com/youtube/v3' },
  { name: 'Torrent API', url: 'https://github.com/Ryuk-me/Torrent-Api-py' },
  { name: 'ShotOnWhat?', url: 'https://shotonwhat.com' },
]

export default function Header({ onHome, onLibrary }) {
  const [open, setOpen] = useState(false)

  // 锁定背景滚动
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4"
        style={{ fontFamily: "'Inter', Arial, sans-serif" }}
      >
        {/* 左侧 Logo */}
        <button
          onClick={onHome}
          className="text-base font-bold uppercase tracking-[0.12em] text-black transition hover:opacity-60 sm:text-lg sm:tracking-[0.15em]"
        >
          LUMENFRAME
        </button>

        {/* 右侧：桌面 Library + References 按钮 + 移动端汉堡 */}
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

      {/* 遮罩层 */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[1001] bg-black/30 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* 右侧滑出面板 */}
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

        {/* 作者头像：面板右下角 */}
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
