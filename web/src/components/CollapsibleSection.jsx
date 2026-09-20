import { useState } from 'react'

// 可折叠结果区：整行标题可点击，右侧可放额外操作（如外链）。
// count 以小圆徽展示结果数量；defaultOpen 控制初始展开。
// 展开/折叠用 CSS grid 0fr→1fr 过渡，无需知道内容高度。
//
// onOpen 在**首次展开**时回调，用于把请求推迟到用户真的要看的时候 —— 在线播放源
// 那种一次打几十个站的搜索，不该在每次打开详情页时都发一遍。
//
// 注意别在 setOpen 的 updater 里调 onOpen：React 19 StrictMode 会把 updater
// 跑两遍，回调就变成两次。
//
// onCollapse 在**收起**时回调。collapse 是 grid 0fr + overflow-hidden，子元素**始终挂载**，
// 所以任何「还活着就会有副作用」的东西（正在播的 <video>）必须自己收摊 —— 否则折叠之后
// 画面没了、声音还在响。
export default function CollapsibleSection({
  title,
  count,
  action,
  defaultOpen = false,
  onOpen,
  onCollapse,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && onOpen) onOpen()
    if (!next && onCollapse) onCollapse()
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-300 pb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="group flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 ${
              open ? 'rotate-90' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span className="text-xs uppercase tracking-[0.3em] text-zinc-700 transition group-hover:text-black">
            {title}
          </span>
          {count > 0 && (
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium leading-none text-zinc-600">
              {count}
            </span>
          )}
        </button>
        {action}
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  )
}
