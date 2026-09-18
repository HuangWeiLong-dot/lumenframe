import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { useAuth, closeModal, setMode, USERNAME_MAX } from '../auth/store'
import { useSyncStatus, requestSync } from '../sync/engine'

// 视觉沿用 LanguagePicker 的弹窗模板：遮罩 bg-black/55、面板直角无 rounded-*、
// 品牌行 uppercase 宽字距、Esc 关闭 + 锁背景滚动。
const INPUT =
  'w-full border border-zinc-300 bg-white px-3 py-2 text-sm text-black transition outline-none placeholder:text-zinc-400 focus:border-black'

const BTN_PRIMARY =
  'w-full border border-black bg-black px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

const BTN_LINK =
  'text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 transition hover:text-black'

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </span>
      <input className={INPUT} {...props} />
    </label>
  )
}

// 显示名的编辑表单。单独成组件，免得和登录/注册表单的字段状态互相牵扯。
function UsernameForm({ current, pending, onSubmit }) {
  const { t } = useI18n()
  const [value, setValue] = useState(current)

  // user_metadata 变了（更新成功 / 换账号）时同步回来
  useEffect(() => { setValue(current) }, [current])

  const trimmed = value.trim()
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(trimmed) }}
      className="space-y-3"
    >
      <Field
        label={t('account.username')}
        type="text"
        maxLength={USERNAME_MAX}
        placeholder={t('account.usernamePlaceholder')}
        autoComplete="nickname"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        disabled={pending || !trimmed || trimmed === current}
        className={BTN_PRIMARY}
      >
        {t('account.save')}
      </button>
    </form>
  )
}

export default function AuthModal() {
  const { t, dateLocale } = useI18n()
  const auth = useAuth()
  const sync = useSyncStatus()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState(null)

  // 切换模式时清空表单，避免把「注册时输的密码」带进找回密码流程
  useEffect(() => {
    setUsername('')
    setPassword('')
    setConfirm('')
    setLocalError(null)
  }, [auth.mode])

  useEffect(() => {
    if (!auth.modalOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [auth.modalOpen])

  // 未配置 Supabase 时整块不渲染（也不会有任何按钮能打开它）
  if (!auth.isConfigured || !auth.modalOpen) return null

  const signedIn = Boolean(auth.user)
  const errorKey = localError || auth.error

  function submit(e) {
    e.preventDefault()
    setLocalError(null)
    const mail = email.trim()

    if (auth.mode === 'signin') return auth.signIn(mail, password)
    if (auth.mode === 'forgot') return auth.sendReset(mail)

    if (auth.mode === 'signup') {
      const name = username.trim()
      if (!name) return setLocalError('account.usernameRequired')
      if (name.length > USERNAME_MAX) return setLocalError('account.usernameTooLong')
    }

    // signup 与 recovery 都要校验并二次确认密码
    if (password.length < 6) return setLocalError('account.passwordTooShort')
    if (password !== confirm) return setLocalError('account.passwordMismatch')
    if (auth.mode === 'signup') return auth.signUp(mail, password, username.trim())
    return auth.updatePassword(password)
  }

  function statusLine() {
    if (sync.state === 'syncing') return t('sync.syncing')
    if (sync.state === 'error') return t('sync.error')
    // 熔断：这一轮有一批删除被扣下，等用户确认（见 engine 的 requestSync）
    if (sync.state === 'guard') return t('sync.guardBlocked', { n: sync.blockedDeletes })
    if (sync.lastSyncedAt) {
      const time = new Date(sync.lastSyncedAt).toLocaleTimeString(dateLocale, {
        hour: '2-digit',
        minute: '2-digit',
      })
      return t('sync.lastSynced', { time })
    }
    return t('sync.never')
  }

  const titles = {
    signin: t('account.signIn'),
    signup: t('account.signUp'),
    forgot: t('account.resetTitle'),
    recovery: t('account.setPassword'),
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('account.dialogLabel')}
      onClick={closeModal}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[26rem] border border-zinc-200 bg-white shadow-2xl"
      >
        {/* 标题区 */}
        <div className="border-b border-zinc-200 px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">LUMENFRAME</p>
          <h2 className="mt-2 text-xl font-extrabold uppercase tracking-tight text-black">
            {signedIn ? t('account.dialogLabel') : titles[auth.mode]}
          </h2>
          {!signedIn && auth.mode === 'signin' && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t('account.subtitle')}</p>
          )}
          {!signedIn && auth.mode === 'forgot' && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t('account.resetHint')}</p>
          )}
        </div>

        <div className="p-5 sm:p-6">
          {/* 提示条 */}
          {auth.notice && (
            <p className="mb-4 border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              {t(auth.notice)}
            </p>
          )}
          {errorKey && (
            <p className="mb-4 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t(errorKey)}
            </p>
          )}

          {signedIn ? (
            <div className="space-y-5">
              <p className="truncate text-xs text-zinc-500">
                {t('account.signedInAs', { email: auth.user.email })}
              </p>

              {/* 显示名：老账号（注册时还没有这个字段）在这里补填，之后也可随时改 */}
              <UsernameForm
                current={auth.username}
                pending={auth.pending}
                onSubmit={auth.updateUsername}
              />

              <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  <span
                    className={`inline-block h-[6px] w-[6px] ${
                      sync.state === 'syncing'
                        ? 'animate-pulse bg-black'
                        : sync.state === 'error'
                          ? 'bg-red-500'
                          : sync.state === 'guard'
                            ? 'bg-amber-500'
                            : 'bg-zinc-300'
                    }`}
                  />
                  {statusLine()}
                </span>
                {/* guard 状态下这个按钮是二次确认：点下去 = 放行被扣下的删除 */}
                <button type="button" onClick={requestSync} className={BTN_LINK}>
                  {sync.state === 'error'
                    ? t('sync.retry')
                    : sync.state === 'guard'
                      ? t('sync.confirmDeletes')
                      : t('sync.now')}
                </button>
              </div>
              <button type="button" onClick={auth.signOut} className={BTN_PRIMARY}>
                {t('account.signOut')}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {auth.mode !== 'recovery' && (
                <Field
                  label={t('account.email')}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}

              {auth.mode === 'signup' && (
                <Field
                  label={t('account.username')}
                  type="text"
                  required
                  maxLength={USERNAME_MAX}
                  placeholder={t('account.usernamePlaceholder')}
                  autoComplete="nickname"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}

              {auth.mode !== 'forgot' && (
                <Field
                  label={auth.mode === 'recovery' ? t('account.newPassword') : t('account.password')}
                  type="password"
                  required
                  minLength={6}
                  autoComplete={auth.mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}

              {(auth.mode === 'signup' || auth.mode === 'recovery') && (
                <Field
                  label={t('account.confirmPassword')}
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}

              <button type="submit" disabled={auth.pending} className={BTN_PRIMARY}>
                {auth.mode === 'signup'
                  ? t('account.submitSignUp')
                  : auth.mode === 'forgot'
                    ? t('account.sendReset')
                    : auth.mode === 'recovery'
                      ? t('account.setPassword')
                      : t('account.submitSignIn')}
              </button>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {auth.mode === 'signin' && (
                  <>
                    <button type="button" onClick={() => setMode('signup')} className={BTN_LINK}>
                      {t('account.toSignUp')}
                    </button>
                    <button type="button" onClick={() => setMode('forgot')} className={BTN_LINK}>
                      {t('account.forgot')}
                    </button>
                  </>
                )}
                {auth.mode === 'signup' && (
                  <button type="button" onClick={() => setMode('signin')} className={BTN_LINK}>
                    {t('account.toSignIn')}
                  </button>
                )}
                {auth.mode === 'forgot' && (
                  <button type="button" onClick={() => setMode('signin')} className={BTN_LINK}>
                    {t('account.back')}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
