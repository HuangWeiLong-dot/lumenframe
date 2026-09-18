import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { isSupabaseConfigured } from '../supabase'
import { useAuth, openModal } from '../auth/store'
import { useSyncStatus } from '../sync/engine'
import AuthModal from './AuthModal'

// 同步状态圆点：灰=空闲、黑闪=同步中、红=失败
function SyncDot({ state }) {
  return (
    <span
      className={`inline-block h-[6px] w-[6px] shrink-0 ${
        state === 'syncing' ? 'animate-pulse bg-black' : state === 'error' ? 'bg-red-500' : 'bg-zinc-300'
      }`}
    />
  )
}

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
  { name: 'OpenSubtitles API', url: 'https://trac.opensubtitles.org/wiki/DevReadLine' },
  { name: 'ShotOnWhat?', url: 'https://shotonwhat.com' },
]

export default function Header({ onHome, onLibrary }) {
  const [open, setOpen] = useState(false)
  const { t, lang, setLang } = useI18n()
  const auth = useAuth()
  const sync = useSyncStatus()

  // 锁定背景滚动
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between bg-white/70 px-4 py-3 backdrop-blur-md backdrop-saturate-150 sm:px-6 sm:py-4"
      >
        {/* 左侧 Logo（Pin 收藏栏已独立为左侧固定抽屉：components/PinnedDrawer.jsx） */}
        <div className="flex items-center gap-2">
          <button
            onClick={onHome}
            className="text-base font-bold uppercase tracking-[0.12em] text-black transition hover:opacity-60 sm:text-lg sm:tracking-[0.15em]"
          >
            LUMENFRAME
          </button>
        </div>

        {/* 右侧：桌面 Library + References + 移动端汉堡 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onLibrary}
            className="hidden text-xs uppercase tracking-[0.2em] text-black transition hover:opacity-60 sm:block"
          >
            {t('header.library')}
          </button>
          {/* 账号：未配置 Supabase 时整块不渲染（同 Film Stills 区块的自隐藏约定） */}
          {isSupabaseConfigured && (
            <button
              onClick={() => openModal('signin')}
              className="hidden max-w-[11rem] items-center gap-2 text-xs uppercase tracking-[0.2em] text-black transition hover:opacity-60 sm:flex"
            >
              <span className="truncate">
                {auth.user ? auth.username || auth.user.email.split('@')[0] : t('account.signIn')}
              </span>
              {auth.user && <SyncDot state={sync.state} />}
            </button>
          )}
          <button
            onClick={() => setOpen(true)}
            className="hidden text-xs uppercase tracking-[0.2em] text-black transition hover:opacity-60 sm:block"
          >
            {t('header.references')}
          </button>
          <button
            onClick={() => setOpen(true)}
            aria-label={t('header.openMenu')}
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
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-200">
          <span className="text-xs uppercase tracking-[0.25em] text-zinc-500">{t('header.references')}</span>
          <button
            onClick={() => setOpen(false)}
            aria-label={t('header.close')}
            className="text-black transition hover:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-col overflow-y-auto px-2 py-3" style={{ maxHeight: 'calc(100vh - 65px)' }}>
          {/* 账号：< sm 时顶栏按钮隐藏，改从这里进 */}
          {isSupabaseConfigured && (
            <button
              onClick={() => { setOpen(false); openModal('signin') }}
              className="flex items-center justify-between px-4 py-3.5 text-sm text-black transition hover:bg-zinc-100"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">
                  {auth.user ? auth.username || auth.user.email : t('account.signIn')}
                </span>
                {auth.user && <SyncDot state={sync.state} />}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onLibrary?.() }}
            className="flex items-center justify-between px-4 py-3.5 text-sm text-black transition hover:bg-zinc-100"
          >
            <span>{t('header.myLibrary')}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          {/* 语言切换：< sm 时右下角悬浮按钮已隐藏，改从滑块里切换 */}
          <div className="flex items-center justify-between px-4 py-3 text-sm text-black">
            <span>{t('header.language')}</span>
            <div className="flex items-center gap-1">
              {['en', 'zh'].map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={`flex h-8 min-w-[44px] items-center justify-center border px-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition ${
                    lang === code
                      ? 'border-black bg-black text-white'
                      : 'border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:text-black'
                  }`}
                >
                  {code === 'en' ? t('lang.en') : t('lang.zh')}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-4 my-1 border-t border-zinc-100" />
          <span className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">{t('header.apiSources')}</span>
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

      {/* 语言切换：≥ sm 用右下角悬浮按钮；< sm 收进右侧滑块里（见上方 nav 的 Language 行） */}
      <button
        onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
        aria-label={t('header.switchLang')}
        className="fixed bottom-5 right-5 z-[1000] hidden h-10 w-10 items-center justify-center border border-zinc-300 bg-white/80 text-xs font-semibold uppercase tracking-wider text-zinc-700 shadow-lg backdrop-blur-md transition hover:bg-white hover:text-black sm:flex"
      >
        {lang === 'en' ? t('lang.zh') : t('lang.en')}
      </button>

      {/* 账号弹窗放在触发按钮所在的组件里，两者不会各自漂移 */}
      <AuthModal />
    </>
  )
}
