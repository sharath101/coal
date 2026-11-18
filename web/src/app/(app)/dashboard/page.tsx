'use client';

import { useTranslations } from 'next-intl';
import { useMe } from '@/lib/queries';

/**
 * The Dashboard answers three questions, in this order (docs/dashboard.md). Its widgets come
 * with the Dashboard block of the build; until then each section shows its empty state.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { data: me } = useMe();
  if (!me) return null;

  const sections = [t('needsMe'), t('coming'), t('howWeAreDoing')];
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('greeting', { name: me.name })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {me.productLine
            ? t('roleWithLine', { role: me.role.name, productLine: me.productLine.name })
            : t('role', { role: me.role.name })}
        </p>
      </div>
      {sections.map((title) => (
        <section key={title} className="grid gap-3">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {title}
          </h2>
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </div>
        </section>
      ))}
    </div>
  );
}
