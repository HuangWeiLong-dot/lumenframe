import { useI18n } from '../i18n'

export default function Footer() {
  const { t } = useI18n()
  return (
    <footer
      className="w-full shrink-0 border-t border-zinc-300 px-6 py-12 text-center"
    >
      <p className="text-sm text-zinc-700">
        {t('footer.copyright')}
      </p>
    </footer>
  )
}
