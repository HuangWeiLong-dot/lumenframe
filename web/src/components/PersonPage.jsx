import { useEffect, useState } from 'react'
import SmartImage from './SmartImage'
import StatusBadge from './StatusBadge'
import NavLink from './NavLink'
import { apiUrlWithLang, posterUrl } from '../api'
import { titleUrl, preopenTab, setTabUrl, closeTab } from '../routes'
import { useI18n } from '../i18n'

function formatLifeSpan(birth, death) {
  if (!birth) return null
  const start = birth.slice(0, 4)
  if (death) return `${start}–${death.slice(0, 4)}`
  return `b. ${start}`
}

function WorkCard({ work, onOpen }) {
  const { t } = useI18n()
  const poster = work.poster_path ? posterUrl(work.poster_path, 'w185') : null
  // 电影：work.id 就是本站用的 TMDB id，能直接拼 href → 真 <a>，新标签页。
  // 剧集：work.id 是 TMDB id，本站用的是 TVmaze id，得先按片名搜，只能走 onOpen 异步处理。
  const isMovie = work.kind !== 'tv'
  const Tag = isMovie ? NavLink : 'button'
  const linkProps = isMovie
    ? { to: titleUrl('movie', work.id, work.title) }
    : { type: 'button', onClick: () => onOpen(work) }
  return (
    <Tag
      {...linkProps}
      className="group flex flex-col gap-1 text-left"
      title={`${work.title}${work.year ? ` (${work.year})` : ''}`}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-100">
        {poster ? (
          <SmartImage
            src={poster}
            alt={work.title}
            className="h-full w-full transition group-hover:opacity-80"
            objectFit="cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400">
            {t('common.noPoster')}
          </div>
        )}
        <StatusBadge kind={work.kind || 'movie'} id={work.id} size="md" />
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-tight text-zinc-900">
        {work.title}
        {work.year && <span className="ml-1 font-normal text-zinc-500">{work.year}</span>}
      </p>
      {work.character && (
        <p className="truncate text-[11px] text-zinc-500">{t('person.as', { character: work.character })}</p>
      )}
      {work.episode_count > 0 && (
        <p className="text-[11px] text-zinc-500">{t('person.episodes', { n: work.episode_count })}</p>
      )}
      {work.vote_average > 0 && (
        <p className="text-[11px] font-semibold text-amber-600">★ {work.vote_average.toFixed(1)}</p>
      )}
    </Tag>
  )
}

function RoleSection({ title, movies, tv, onOpen }) {
  const { t } = useI18n()
  if (!movies.length && !tv.length) return null
  return (
    <section className="mt-8">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-600">{title}</h3>
      {movies.length > 0 && (
        <div className="mb-5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">{t('person.movies')}</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {movies.map((w) => (
              <WorkCard key={`m:${w.id}`} work={w} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      {tv.length > 0 && (
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">{t('person.tvShows')}</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {tv.map((w) => (
              <WorkCard key={`t:${w.id}`} work={w} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function PersonPage({ personId, isInLikes, toggleLike, onBack, onOpenShow }) {
  const { t, apiLang } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    ;(async () => {
      try {
        const r = await fetch(apiUrlWithLang(`/api/person/${personId}/credits`))
        if (cancelled) return
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        setData(json)
      } catch (e) {
        if (!cancelled) setError(e.message || t('common.error'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // apiLang：切换语言后重新拉取（简介、作品片名随语言变化）
  }, [personId, apiLang])

  // 剧集作品：work.id 是 TMDB id，与本站使用的 TVmaze id 不一致，先按 title+year 搜到再打开。
  // 电影的作品卡片本身就是 <NavLink>（同步能拼出 href），走不到这里。
  async function handleOpenWork(work) {
    // 先在点击的同步阶段占一个标签页：下面的 await 之后调用栈已退出点击事件，
    // 那时再 window.open 会被弹窗拦截
    const tab = preopenTab()
    // 用原名（original_title）搜：TVmaze 只有英文名，中文界面下的本地化剧名匹配不到
    try {
      const qs = new URLSearchParams({ q: work.original_title || work.title, limit: '3' })
      const r = await fetch(apiUrlWithLang(`/api/search?${qs}`))
      if (!r.ok) { closeTab(tab); return }
      const data = await r.json()
      const candidates = (data.results || []).filter((m) => m.kind === 'tv')
      const match = candidates.find((m) => m.year === work.year) || candidates[0]
      if (!match) { closeTab(tab); return }
      // tab 为 null = 被弹窗拦截，退回原地跳转
      if (tab) setTabUrl(tab, titleUrl('tv', match.id, match.title))
      else onOpenShow(match.id, { history: 'push' })
    } catch {
      closeTab(tab)
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 sm:px-6"
    >
      <button
        type="button"
        onClick={onBack}
        className="mt-8 inline-flex w-fit items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-600 transition hover:text-black"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        {t('common.back')}
      </button>

      {loading && <p className="mt-8 text-sm text-zinc-600">{t('common.loading')}</p>}
      {error && <p className="mt-8 text-sm text-red-500">{error}</p>}

      {data && (
        <>
          <header className="relative mt-6 flex flex-col items-center gap-6 sm:mt-8 sm:flex-row sm:items-start sm:gap-8">
            {/* Like 按钮 */}
            <button
              onClick={() => {
                if (isInLikes('person', personId)) {
                  toggleLike('person', personId)
                } else {
                  toggleLike('person', personId, {
                    name: data.name,
                    job: data.known_for_department || '',
                    poster: data.profile_path ? `https://image.tmdb.org/t/p/w185${data.profile_path}` : null,
                  })
                }
              }}
              aria-label={isInLikes('person', personId) ? t('common.removeFromLikes') : t('common.addToLikes')}
              title={isInLikes('person', personId) ? t('common.removeFromLikes') : t('common.addToLikes')}
              className={`absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center transition hover:opacity-70 ${
                isInLikes('person', personId) ? 'text-red-500' : 'text-zinc-300 hover:text-zinc-500'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isInLikes('person', personId) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </button>
            <div className="h-48 w-36 shrink-0 overflow-hidden bg-zinc-100 shadow-md ring-1 ring-black/5 sm:h-64 sm:w-44">
              {data.profile_path ? (
                <SmartImage
                  src={posterUrl(data.profile_path, 'w342')}
                  alt={data.name}
                  className="h-full w-full"
                  objectFit="cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400">
                  {t('common.noPhoto')}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
                {data.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-zinc-600 sm:justify-start">
                {data.known_for_department && (
                  <span className="font-medium text-zinc-800">{data.known_for_department}</span>
                )}
                {data.birthday && (
                  <>
                    <span className="text-zinc-300">•</span>
                    <span>{formatLifeSpan(data.birthday, data.deathday)}</span>
                  </>
                )}
                {data.place_of_birth && (
                  <>
                    <span className="text-zinc-300">•</span>
                    <span className="truncate">{data.place_of_birth}</span>
                  </>
                )}
              </div>
              {data.biography && (
                <p className="mt-4 line-clamp-6 text-sm leading-relaxed text-zinc-700">
                  {data.biography}
                </p>
              )}
            </div>
          </header>

          {data.credits && (
            <>
              <RoleSection
                title={t('person.acting')}
                movies={data.credits.acting.movies}
                tv={data.credits.acting.tv}
                onOpen={handleOpenWork}
              />
              <RoleSection
                title={t('person.directing')}
                movies={data.credits.directing.movies}
                tv={data.credits.directing.tv}
                onOpen={handleOpenWork}
              />
              <RoleSection
                title={t('person.writing')}
                movies={data.credits.writing.movies}
                tv={data.credits.writing.tv}
                onOpen={handleOpenWork}
              />
            </>
          )}

          {data.credits
            && data.credits.acting.movies.length === 0
            && data.credits.acting.tv.length === 0
            && data.credits.directing.movies.length === 0
            && data.credits.directing.tv.length === 0
            && data.credits.writing.movies.length === 0
            && data.credits.writing.tv.length === 0 && (
              <p className="mt-12 text-center text-sm text-zinc-500">
                {t('person.noCredits')}
              </p>
            )}
        </>
      )}
    </div>
  )
}
