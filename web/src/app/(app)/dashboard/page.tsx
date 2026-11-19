'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { DashboardWidgets } from '@/components/widgets/dashboard-widgets';
import { useMe } from '@/lib/queries';
import { canManageTemplates } from '@/lib/roles';

/**
 * The Dashboard answers three questions, in this order (docs/dashboard.md): the widgets of my
 * layout, grouped under What needs me now?, What's coming? and How are we doing?
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 sm:p-6">
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
      {canManageTemplates(me.role.key) && (
        <Link
          href="/templates"
          className="flex items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-accent"
        >
          <FileText className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="grid gap-0.5">
            <span className="font-medium">{t('templatesTitle')}</span>
            <span className="text-sm text-muted-foreground">{t('templatesText')}</span>
          </span>
        </Link>
      )}
      <Suspense fallback={null}>
        <DashboardWidgets />
      </Suspense>
    </div>
  );
}
