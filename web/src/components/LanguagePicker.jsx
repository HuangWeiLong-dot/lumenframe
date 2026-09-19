import { useEffect, useState } from 'react'
import { hasStoredLang, suggestedLang, useI18n } from '../i18n'

// 首次访问的语言偏好弹窗：
// - 只在 localStorage 里没有显式语言选择时出现；选定（或跳过）后记账，不再打扰
// - 视觉沿用站点基调：zinc 灰阶 + 黑白 + 直角（无 rounded-*）、大写宽字距小标题
// - 响应式：手机选项竖排、≥sm 并排两列；面板宽度 min(92vw, 30rem)
export default function LanguagePicker() {
  const { t, setLang } = useI18n()
  // state 初始化器：StrictMode 双渲染下结果稳定
  const [open, setOpen] = useState(() => !hasStoredLang())
  // 浏览器语言探测结果：加「推荐」角标；跳过时按它记账
  const recommended = suggestedLang()

  // 点击选项 / 跳过 / Esc：写入选择并关闭
  function choose(code) {
    setLang(code)
    setOpen(false)
  }

  // 打开时锁背景滚动；Esc = 采用浏览器推荐语言（等同「跳过」，避免反复弹）
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') choose(recommended) }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const options = [
    { code: 'en', label: t('langModal.english'), desc: t('langModal.englishDesc') },
    { code: 'zh', label: t('langModal.chinese'), desc: t('langModal.chineseDesc') },
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('langModal.dialogLabel')}
      onClick={() => choose(recommended)}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[30rem] border border-zinc-200 bg-white shadow-2xl"
      >
        {/* 标题区 */}
        <div className="border-b border-zinc-200 px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">LUMENFRAME</p>
          <h2 className="mt-2 text-xl font-extrabold uppercase tracking-tight text-black sm:text-2xl">
            {t('langModal.title')}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t('langModal.subtitle')}</p>
        </div>

        {/* 语言选项：手机竖排，≥sm 两列并排 */}
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 sm:gap-3 sm:p-6">
          {options.map(({ code, label, desc }) => {
            const isRec = code === recommended
            // 中文选项的文字直接用系统字体（见 index.css 的 .font-system-cjk）。
            // 这个弹窗首屏必现，而英文界面下它是页面上唯一的汉字来源 ——
            // 实测仅「中文」+ 那句描述就会拉下 7 个 Noto Sans SC 分片、约 380 KiB。
            // 只作用于中文项：英文项在界面切到中文时也含汉字，但那时全站已是中文，
            // 自托管中文字体本来就要加载，没必要（也不该）换成系统字体。
            const cjkFont = code === 'zh' ? 'font-system-cjk' : ''
            return (
              <button
                key={code}
                type="button"
                autoFocus={isRec}
                onClick={() => choose(code)}
                className="flex flex-col items-start border border-zinc-300 bg-white px-4 py-4 text-left transition hover:border-black hover:bg-zinc-50 focus:border-black focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-5 sm:py-5"
              >
                {/* 角标紧贴语言名（不 justify-between）：首行 min-h 固定，两张卡片的描述文字才会对齐 */}
                <span className="flex min-h-[15px] items-center gap-2">
                  <span className={`truncate text-sm font-bold uppercase tracking-[0.2em] text-black ${cjkFont}`}>{label}</span>
                  {isRec && (
                    <span className="shrink-0 whitespace-nowrap border border-zinc-300 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-zinc-500">
                      {t('langModal.recommended')}
                    </span>
                  )}
                </span>
                <span className={`mt-2 text-[11px] leading-relaxed text-zinc-500 ${cjkFont}`}>{desc}</span>
              </button>
            )
          })}
        </div>

        {/* 跳过：采用浏览器推荐语言，同样只记一次 */}
        <div className="flex items-center justify-end border-t border-zinc-100 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => choose(recommended)}
            className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 transition hover:text-black"
          >
            {t('langModal.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
