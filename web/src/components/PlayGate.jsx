import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

// 在线播放的口令门。
//
// 由构建期变量 VITE_PLAY_PASSWORD 打开：**没配就没有这道门**，整块行为与改动前一致
// （与 FILMGRAB_BASE === ''、VITE_SUPABASE_* 缺席同一套「不配就不存在」的规则）。
//
// 先说清楚它拦得住什么：口令是**编进 JS bundle** 的，任何拿得到这个页面的人都能从
// 源码里读出来，`/api/sources/*` 也照样能直接打。它拦的是「随手点进来」和「被顺手
// 转出去」的人，不是访问控制。真正的门只有一条：不公开部署（见 CLAUDE.md「Play
// sources」）。所以别把它当权限系统用，也别指望它挡住任何存心要看的人。
//
// 同一个组件里两张面孔，因为用户**不点也得知道该找谁**：
//   锁定卡 —— 常驻。一句说明 + 一个按钮 + 管理员邮箱。
//   弹窗   —— 点了按钮才出现。输入框和邮箱都在里面（管理员邮箱要求与弹窗同一界面）。
// 邮箱两处都写，不是为了重复，是「没点按钮的人」和「点开的人」都得看得见。

export const PLAY_CONTACT = 'reel@lumenframe.cc'

const INPUT =
  'w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition outline-none placeholder:text-zinc-400 focus:border-black'

const BTN_PRIMARY =
  'w-full border border-black bg-black px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

const CONTACT =
  'underline decoration-zinc-300 underline-offset-2 transition hover:text-black hover:decoration-black'

function ContactLine({ className = '' }) {
  const { t } = useI18n()
  return (
    <p className={className}>
      {/* 整句都是 mailto：这一行的全部用途就是把人送去写信，而不是让他抄地址 */}
      <a href={`mailto:${PLAY_CONTACT}`} className={CONTACT}>
        {t('play.gateContact', { email: PLAY_CONTACT })}
      </a>
    </p>
  )
}

function GateModal({ onClose, onUnlock }) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  const inputRef = useRef(null)

  // Esc 关闭 + 锁住背景滚动，与 AuthModal 同一套。
  // onClose 必须是稳定引用：它一换，这个 effect 就重跑，而下面那句 focus() 会把光标
  // 顶到行尾 —— 用户每敲一个字都会跳一次。父组件用 useCallback 保证它不变。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  function submit(e) {
    e.preventDefault()
    if (!value) return
    // 通过则不必自己收场：父组件把整块换成真内容，这个弹窗跟着卸载
    if (onUnlock(value)) return
    setWrong(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('play.gateTitle')}
      onClick={onClose}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[26rem] border border-zinc-200 bg-white shadow-2xl"
      >
        <div className="border-b border-zinc-200 px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">LUMENFRAME</p>
          <h2 className="mt-2 text-xl font-extrabold uppercase tracking-tight text-black">
            {t('play.gateTitle')}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t('play.gateBody')}</p>
        </div>

        <form onSubmit={submit} className="p-5 sm:p-6">
          {wrong && (
            <p className="mb-4 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('play.gateWrong')}
            </p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {t('play.gateLabel')}
            </span>
            <input
              ref={inputRef}
              type="password"
              className={INPUT}
              value={value}
              // 改一下就撤掉报错：「口令不对」留在屏幕上，用户会以为改了也没用
              onChange={(e) => {
                setValue(e.target.value)
                setWrong(false)
              }}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </label>

          <button type="submit" disabled={!value} className={`${BTN_PRIMARY} mt-4`}>
            {t('play.gateSubmit')}
          </button>

          <ContactLine className="mt-4 border-t border-zinc-100 pt-4 text-[11px] leading-relaxed text-zinc-500" />
        </form>
      </div>
    </div>
  )
}

// props.onUnlock(口令) → 通过返回 true，父组件随后解锁整块
export default function PlayGate({ onUnlock }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <div className="border border-dashed border-zinc-300 px-4 py-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-700">
          {t('play.gateLocked')}
        </p>
        <p className="mx-auto mt-2 max-w-[34rem] text-[11px] leading-relaxed text-zinc-500">
          {t('play.gateLockedBody')}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 border border-black bg-black px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-zinc-800"
        >
          {t('play.gateOpen')}
        </button>
        <ContactLine className="mt-4 text-[11px] text-zinc-500" />
      </div>

      {open && <GateModal onClose={close} onUnlock={onUnlock} />}
    </>
  )
}
