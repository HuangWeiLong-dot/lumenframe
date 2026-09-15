import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { apiUrl, FILMGRAB_BASE } from '../api'

// 39967 -> "39.9K"，1250000 -> "1.25M"
function compact(n) {
  if (n == null) return ''
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
}

// "2016-10-09T11:25:41Z" -> "Oct 9, 2016"（只取日期部分，避免时区漂移）
function formatDate(iso) {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

function CommentItem({ c }) {
  const [expanded, setExpanded] = useState(false)
  const [avatarOk, setAvatarOk] = useState(true)
  const long = c.text.length > 280 || c.text.split('\n').length > 5

  return (
    <article className="flex gap-3 border-b border-zinc-200 py-4 last:border-b-0">
      {avatarOk && c.avatar ? (
        <img
          src={c.avatar}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          onError={() => setAvatarOk(false)}
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white">
          {(c.author || '?').replace(/^@/, '').charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold text-zinc-900">{c.author}</span>
          <span className="text-xs text-zinc-500">{formatDate(c.publishedAt)}</span>
        </div>
        <p
          className={`mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 ${
            !expanded && long ? 'line-clamp-4' : ''
          }`}
        >
          {c.text}
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M2 10.5h4.5V20H3a1 1 0 0 1-1-1v-8.5Zm5.5 0L13 2.6c.7-.9 2.1-.4 2.2.8l.7 5.1h4.4a1.8 1.8 0 0 1 1.7 2.3l-1.5 6.5A2 2 0 0 1 18.6 19H7.5v-8.5Z" />
            </svg>
            {compact(c.likes)}
          </span>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

export default function TrailerSection({ movie }) {
  const tmdbId = movie?.id

  const [status, setStatus] = useState('loading') // loading | done | error
  const [trailer, setTrailer] = useState(null)    // null | false(无) | 对象
  const [comments, setComments] = useState([])
  const [commentsStatus, setCommentsStatus] = useState('loading')
  const [playing, setPlaying] = useState(false)

  // 取预告片：TMDB /movie/{id}/videos（经 Node 后端代理，自带缓存）
  useEffect(() => {
    if (!tmdbId) return
    let alive = true
    setStatus('loading')
    setTrailer(null)
    setPlaying(false)
    setComments([])
    setCommentsStatus('loading')

    const timer = setTimeout(() => {
      fetch(apiUrl(`/api/trailer/${tmdbId}`))
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          setTrailer(data.videoId ? data : false)
          setStatus('done')
        })
        .catch(() => { if (alive) setStatus('error') })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [tmdbId])

  // 预告片确定后取热门评论（YouTube Data API，经 Python 服务代理）
  const videoId = trailer?.videoId
  useEffect(() => {
    if (!videoId || FILMGRAB_BASE === '') return
    let alive = true
    setCommentsStatus('loading')
    fetch(`${FILMGRAB_BASE}/comments?videoId=${encodeURIComponent(videoId)}&max=20`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => { if (alive) { setComments(data.comments || []); setCommentsStatus('done') } })
      .catch(() => { if (alive) setCommentsStatus('error') })
    return () => { alive = false }
  }, [videoId])

  // 预告片不可达或正常但无预告片：仍保留区块，提示状态
  if (status === 'error') {
    return (
      <CollapsibleSection title="Trailer">
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          Trailer service unavailable right now.
        </div>
      </CollapsibleSection>
    )
  }
  if (status === 'done' && !trailer) {
    return (
      <CollapsibleSection title="Trailer">
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          No trailer found for this title.
        </div>
      </CollapsibleSection>
    )
  }

  const headerAction = trailer && (
    <a
      href={`https://www.youtube.com/watch?v=${encodeURIComponent(trailer.videoId)}`}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs text-zinc-600 underline-offset-2 hover:underline"
    >
      Open on YouTube
    </a>
  )

  return (
    <CollapsibleSection title="Trailer" defaultOpen action={headerAction}>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-600">
          Loading trailer…
        </div>
      )}

      {trailer && (
        <div>
          <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
            {playing ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube.com/embed/${trailer.videoId}?autoplay=1&rel=0`}
                title={trailer.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play trailer"
                className="group absolute inset-0 flex items-center justify-center"
              >
                <img
                  src={`https://i.ytimg.com/vi/${trailer.videoId}/hqdefault.jpg`}
                  alt={trailer.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-80 transition group-hover:opacity-100"
                />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-black/70 transition group-hover:scale-110 group-hover:bg-red-600">
                  <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 text-white" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7L8 5Z" />
                  </svg>
                </span>
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
            {trailer.official && <span className="font-medium text-zinc-800">Official</span>}
            {trailer.publishedAt && <span>· {formatDate(trailer.publishedAt)}</span>}
          </div>

          {FILMGRAB_BASE !== '' && commentsStatus !== 'error' && comments.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-700">
                Top YouTube Comments
              </h3>
              <div className="mt-2">
                {comments.map((c, i) => <CommentItem key={`${c.author}-${i}`} c={c} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  )
}
