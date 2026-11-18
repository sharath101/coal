import { useTranslations } from 'next-intl';

/** Shown on every page while COAL holds made-up data (docs/roles-and-access.md#accounts-for-now). */
export function MadeUpDataNotice() {
  const t = useTranslations('app');
  return (
    <div className="bg-warning px-4 py-1.5 text-center text-xs text-warning-foreground">
      {t('madeUpData')}
    </div>
  );
}
