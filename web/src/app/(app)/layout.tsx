'use client';

import { ApiError } from '@coal/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { TopBar } from '@/components/top-bar';
import { useMe } from '@/lib/queries';

export default function AppLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('app');
  const router = useRouter();
  const me = useMe();
  const signedOut = me.error instanceof ApiError && me.error.code === 'NOT_SIGNED_IN';

  useEffect(() => {
    if (signedOut) router.replace('/sign-in');
  }, [signedOut, router]);

  if (me.data) {
    return (
      <div className="flex min-h-[calc(100vh-2rem)] flex-col">
        <TopBar me={me.data} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    );
  }
  return (
    <div className="p-6 text-sm text-muted-foreground">
      {me.error && !signedOut ? <ProblemMessage error={me.error} /> : t('loading')}
    </div>
  );
}
