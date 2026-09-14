import { useState } from 'react'

// 可折叠结果区：整行标题可点击，右侧可放额外操作（如外链）。
// count 以小圆徽展示结果数量；defaultOpen 控制初始展开。
export default function CollapsibleSection({ title, count, action, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-300 pb-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
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
      {open && <div className="mt-4">{children}</div>}
    </section>
  )
}
