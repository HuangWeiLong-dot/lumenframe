import { useEffect, useRef, useState } from 'react'
import NavLink from './NavLink'
import { titleUrl } from '../routes'
import { useI18n } from '../i18n'

// 收藏栏（Pin）的响应式形态（条目不展示海报，只列标题/年份）：
// - ≥ sm（桌面 / 横屏平板）：左侧固定导轨。收起时整体移出屏幕（-translate-x-full），左边缘
//   保留一个常驻方形把手（Pin 图标 + 数量 + ›）：点击或鼠标悬停把手即展开，展开后由标题栏
//   的 ‹ 按钮收起。展开/收起状态全部由 JS 控制，不再混用 CSS hover / focus-within ——
//   否则鼠标停在抽屉上点「收起」会被 hover 立刻撑回去，看起来像按钮失灵
// - < sm（手机）：左下角常驻方形入口 + 底部抽屉（bottom sheet）。行内取消收藏按钮常显，
//   因为触屏没有 hover，「悬停才出现」的按钮等于不可用
// - 新 Pin 的条目从右侧滑入（pin-slide-in 动画）
const PANEL_W = 268 // 展开后的导轨宽度

const keyOf = (p) => `${p.kind}:${p.id}`

function PinIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}

function CloseIcon({ size = 12, strokeWidth = 2.5 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// dir='right' = 指向展开方向（›），'left' = 指向收起方向（‹）
function Chevron({ dir = 'right', size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'right' ? <polyline points="9 6 15 12 9 18" /> : <polyline points="15 6 9 12 15 18" />}
    </svg>
  )
}

// ≥ sm：导轨行（不展示海报：标题 + 年份 + 取消收藏）
function RailPinRow({ entry, fresh, onUnpin }) {
  const { t } = useI18n()
  const year = entry.kind === 'tv' ? entry.yearRange || entry.year || '' : entry.year || ''

  return (
    <div
      className={`group/pin relative flex items-center gap-2 py-2 pl-3 pr-2 transition duration-200 hover:bg-zinc-50 ${
        fresh ? 'animate-[pin-slide-in_380ms_cubic-bezier(0.22,1,0.36,1)]' : ''
      }`}
    >
      <NavLink
        to={titleUrl(entry.kind, entry.id, entry.title)}
        title={entry.title}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="w-full truncate text-xs font-semibold text-zinc-900">{entry.title}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
          {year}
          {entry.kind === 'tv' && <span className="ml-1 text-zinc-400">{t('common.tv')}</span>}
        </span>
      </NavLink>
      {/* 取消收藏：触屏设备没有 hover，所以常显 */}
      <button
        type="button"
        onClick={() => onUnpin?.(entry)}
        aria-label={t('pin.unpin')}
        title={t('pin.unpin')}
        className="flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-200 text-zinc-400 transition hover:border-black hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        <CloseIcon size={11} />
      </button>
    </div>
  )
}

// < sm：底部抽屉行（不展示海报：标题 + 年份 + 取消收藏）
// onClick：手机端点击条目时先收起抽屉，避免抽屉盖住刚打开的详情页。
// 注意这不是跳转——跳转由 NavLink 的 href 交给浏览器新标签页完成，当前页不动。
function SheetPinRow({ entry, fresh, onClick, onUnpin }) {
  const { t } = useI18n()
  const year = entry.kind === 'tv' ? entry.yearRange || entry.year || '' : entry.year || ''

  return (
    <div
      className={`group/pin flex items-center gap-3 py-2.5 pl-4 pr-3 transition ${
        fresh ? 'animate-[pin-slide-in_380ms_cubic-bezier(0.22,1,0.36,1)]' : ''
      }`}
    >
      <NavLink
        to={titleUrl(entry.kind, entry.id, entry.title)}
        title={entry.title}
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-start text-left active:opacity-60"
      >
        <span className="w-full truncate text-sm font-semibold text-zinc-900">{entry.title}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
          {year}
          {entry.kind === 'tv' && <span className="ml-1 text-zinc-400">{t('common.tv')}</span>}
        </span>
      </NavLink>
      <button
        type="button"
        onClick={() => onUnpin?.(entry)}
        aria-label={t('pin.unpin')}
        title={t('pin.unpin')}
        className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-200 text-zinc-400 transition active:border-black active:bg-black active:text-white"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

export default function PinnedDrawer({ pinned = [], onUnpin }) {
  const { t } = useI18n()
  // 展开状态：导轨把手 / 手机抽屉入口显式控制；桌面鼠标悬停也走这里，不再用 CSS hover
  const [open, setOpen] = useState(false)
  // 标记「这次展开是不是鼠标悬停触发的」：悬停展开的移开鼠标自动收回；点击/键盘展开的保持展开，
  // 直到用户点收起按钮 —— 状态只由 JS 管，彻底避免「点了收起却被 hover 撑回去」
  const openedByHoverRef = useRef(false)
  // 首次挂载时已存在的条目不算「新 Pin」：页面加载/刷新时整列不播放入场动画，
  // 之后新增的收藏才从右侧滑入。（用 state 初始化器：StrictMode 双渲染下结果稳定）
  const [initialKeys] = useState(() => new Set(pinned.map(keyOf)))

  function handleRailEnter() {
    openedByHoverRef.current = true
    setOpen(true)
  }

  function handleRailLeave() {
    if (!openedByHoverRef.current) return
    openedByHoverRef.current = false
    setOpen(false)
  }

  // 点击/键盘展开：保持展开（不随鼠标移开收回）
  function handleOpen() {
    openedByHoverRef.current = false
    setOpen(true)
  }

  // 收起：把手 / 标题栏按钮 / 抽屉关闭按钮 / Esc 共用
  function handleCollapse() {
    openedByHoverRef.current = false
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      handleCollapse()
    }
    // 只有手机底部抽屉需要锁背景滚动；桌面导轨是悬浮层，锁了就没法边滚动页面边看
    const isDesktop = window.matchMedia('(min-width: 640px)').matches
    const prevOverflow = document.body.style.overflow
    if (!isDesktop) document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (!isDesktop) document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (pinned.length === 0) return null

  const entries = pinned.map((p) => ({ p, fresh: !initialKeys.has(keyOf(p)) }))

  return (
    <>
      {/* 手机端遮罩：点击收起底部抽屉（≥sm 的导轨是悬浮层，不需要遮罩） */}
      <div
        onClick={handleCollapse}
        className={`fixed inset-0 z-[899] bg-black/30 transition-opacity duration-300 sm:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* ---------- ≥ sm：左侧导轨（收起时整体移出屏幕，左边缘常驻方形把手） ---------- */}
      <div className="hidden sm:block" onMouseEnter={handleRailEnter} onMouseLeave={handleRailLeave}>
        {/* 收起态的唯一入口：把手可点击（触屏平板/键盘），鼠标悬停也会展开 */}
        {!open && (
          <button
            type="button"
            onClick={handleOpen}
            aria-label={t('pin.open')}
            title={t('pin.open')}
            className="fixed left-0 top-1/2 z-[900] flex h-24 w-8 -translate-y-1/2 flex-col items-center justify-center gap-2 border border-l-0 border-zinc-200 bg-white/90 text-zinc-700 shadow-lg backdrop-blur-md transition hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            <PinIcon size={13} />
            <span className="text-[10px] font-semibold leading-none">{pinned.length}</span>
            <Chevron />
          </button>
        )}
        <aside
          role="complementary"
          aria-label={t('pin.drawerTitle')}
          inert={!open}
          className={`fixed left-0 top-1/2 z-[900] -translate-y-1/2 shadow-xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ width: PANEL_W }}
        >
          <div className="border-y border-l border-zinc-200 bg-white/95 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1.5 pl-3 pr-2">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                <PinIcon />
                {t('pin.drawerTitle')}
                <span className="font-semibold text-zinc-400">{pinned.length}</span>
              </span>
              {/* 唯一的收起控件（触屏平板 / 键盘同样可用） */}
              <button
                type="button"
                onClick={handleCollapse}
                aria-label={t('pin.close')}
                title={t('pin.close')}
                className="flex h-7 w-7 items-center justify-center border border-zinc-200 text-zinc-500 transition hover:border-black hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                <Chevron dir="left" />
              </button>
            </div>
            <div className="flex max-h-[62vh] flex-col divide-y divide-zinc-100 overflow-y-auto">
              {entries.map(({ p, fresh }) => (
                <RailPinRow
                  key={keyOf(p)}
                  entry={p}
                  fresh={fresh}
                  onUnpin={onUnpin}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ---------- < sm：左下角常驻方形入口 + 底部抽屉 ---------- */}
      {!open && (
        <button
          type="button"
          onClick={handleOpen}
          aria-label={t('pin.open')}
          className="fixed bottom-5 left-5 z-[900] flex h-11 w-11 items-center justify-center border border-zinc-300 bg-white/85 text-black shadow-lg backdrop-blur-md transition active:border-black active:bg-white sm:hidden"
        >
          <PinIcon size={16} />
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center bg-black px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
            {pinned.length}
          </span>
        </button>
      )}

      <section
        role="complementary"
        aria-label={t('pin.drawerTitle')}
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-x-0 bottom-0 z-[900] border-t border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-md transition-transform duration-300 ease-out sm:hidden ${
          open ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 pl-4 pr-3">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <PinIcon />
            {t('pin.drawerTitle')}
            <span className="font-semibold text-zinc-400">{pinned.length}</span>
          </span>
          <button
            type="button"
            onClick={handleCollapse}
            aria-label={t('pin.close')}
            className="flex h-9 w-9 items-center justify-center border border-zinc-200 text-zinc-500 transition active:border-black active:bg-black active:text-white"
          >
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="flex max-h-[68vh] flex-col divide-y divide-zinc-100 overflow-y-auto">
          {entries.map(({ p, fresh }) => (
            <SheetPinRow
              key={keyOf(p)}
              entry={p}
              fresh={fresh}
              onClick={handleCollapse}
              onUnpin={onUnpin}
            />
          ))}
        </div>
      </section>
    </>
  )
}

