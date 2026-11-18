import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('app');
  return (
    <main className="flex min-h-[calc(100vh-2rem)] flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('name')}</h1>
        <p className="text-sm text-muted-foreground">{t('tagline')}</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
