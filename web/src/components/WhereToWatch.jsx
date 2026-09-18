import { useEffect, useState } from 'react'
import CollapsibleSection from './CollapsibleSection'
import { apiUrl } from '../api'
import { useI18n } from '../i18n'

function typeLabel(type, t) {
  return ({
    sub: t('whereToWatch.streaming'),
    free: t('whereToWatch.free'),
    rent: t('whereToWatch.rent'),
    buy: t('whereToWatch.buy'),
    tve: t('whereToWatch.tv'),
  })[type] || type
}

const TYPE_STYLES = {
  sub: 'bg-emerald-600 text-white',
  free: 'bg-sky-600 text-white',
  rent: 'bg-amber-500 text-white',
  buy: 'bg-orange-600 text-white',
  tve: 'bg-zinc-600 text-white',
}

const TYPE_ORDER = ['sub', 'free', 'rent', 'buy', 'tve']

const REGION_FLAGS = {
  US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺', DE: '🇩🇪', FR: '🇫🇷',
  JP: '🇯🇵', KR: '🇰🇷', IN: '🇮🇳', BR: '🇧🇷', MX: '🇲🇽', IT: '🇮🇹',
  ES: '🇪🇸', NL: '🇳🇱', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮',
  PL: '🇵🇱', NZ: '🇳🇿', IE: '🇮🇪', HK: '🇭🇰', TW: '🇹🇼', SG: '🇸🇬',
  TH: '🇹🇭', MY: '🇲🇾', PH: '🇵🇭', ID: '🇮🇩', VN: '🇻🇳', AR: '🇦🇷',
  CL: '🇨🇱', CO: '🇨🇴', PE: '🇵🇪', ZA: '🇿🇦', AE: '🇦🇪',
}

function SourceBadge({ s }) {
  const { t } = useI18n()
  const flag = REGION_FLAGS[s.region] || ''
  const price = s.price != null ? `$${s.price}` : ''

  return (
    <a
      href={s.webUrl || '#'}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 border border-zinc-200 px-3 py-2 transition hover:border-zinc-400 hover:bg-zinc-50"
    >
      <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLES[s.type]}`}>
        {typeLabel(s.type, t)}
      </span>
      <span className="truncate text-sm font-medium text-zinc-900">{s.name}</span>
      {price && <span className="shrink-0 text-xs text-zinc-500">{price}</span>}
      {flag && <span className="shrink-0 text-sm" title={s.region}>{flag}</span>}
    </a>
  )
}

export default function WhereToWatch({ movie }) {
  const { t } = useI18n()
  const isTv = movie?.kind === 'tv'
  const tmdbId = movie?.id
  const imdbId = movie?.imdb_id
  const [status, setStatus] = useState('loading')
  const [sources, setSources] = useState([])

  useEffect(() => {
    // 电影用 tmdbId；剧集用 imdb_id（无则不请求）
    if (isTv) {
      if (!imdbId) return
    } else if (!tmdbId) return
    let alive = true
    setStatus('loading')
    setSources([])

    const url = isTv
      ? apiUrl(`/api/watch/tv/${imdbId}`)
      : apiUrl(`/api/watch/${tmdbId}`)

    const timer = setTimeout(() => {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!alive) return
          setSources(data.sources || [])
          setStatus('done')
        })
        .catch(() => { if (alive) setStatus('error') })
    }, 0)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [isTv, tmdbId, imdbId])

  // 出错也保留区块，显示网络问题
  if (status === 'error') {
    return (
      <CollapsibleSection title={t('whereToWatch.title')}>
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          {t('whereToWatch.error')}
        </div>
      </CollapsibleSection>
    )
  }

  // 按类型分组，保持 TYPE_ORDER 顺序
  const grouped = TYPE_ORDER
    .map((type) => ({ type, items: sources.filter((s) => s.type === type) }))
    .filter((g) => g.items.length > 0)

  return (
    <CollapsibleSection title={t('whereToWatch.title')} count={sources.length} defaultOpen>
      {status === 'loading' && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-600">
          {t('whereToWatch.checking')}
        </div>
      )}

      {status === 'done' && sources.length === 0 && (
        <div className="border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-500">
          {t('whereToWatch.noAvail')}
        </div>
      )}

      {grouped.length > 0 && (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.type}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">
                {typeLabel(g.type, t)}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((s, i) => (
                  <SourceBadge key={`${s.name}-${i}`} s={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  )
}
