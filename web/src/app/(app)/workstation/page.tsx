'use client';

import { Plus, SendHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function Pane({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/**
 * The Workstation: tasks and projects, the conversation, and the preview
 * (docs/workstation-and-ai.md#the-workstation). The assistant arrives with the Workstation block.
 */
export default function WorkstationPage() {
  const t = useTranslations('workstation');
  return (
    <div className="grid flex-1 grid-cols-1 md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_20rem]">
      <aside className="grid content-start gap-6 border-b p-4 md:border-r md:border-b-0">
        <Pane title={t('myTasks')}>
          <p className="text-sm text-muted-foreground">{t('noTasks')}</p>
        </Pane>
        <Pane title={t('projects')}>
          <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
        </Pane>
        <Pane title={t('generalChats')}>
          <Button variant="outline" size="sm" disabled>
            <Plus aria-hidden />
            {t('newChat')}
          </Button>
        </Pane>
      </aside>

      <div className="flex min-h-[24rem] flex-col">
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {t('conversationEmpty')}
          </p>
        </div>
        <form className="flex gap-2 border-t p-4" onSubmit={(e) => e.preventDefault()}>
          <Input placeholder={t('inputPlaceholder')} disabled aria-describedby="assistant-status" />
          <Button type="submit" size="icon" disabled title={t('send')}>
            <SendHorizontal aria-hidden />
            <span className="sr-only">{t('send')}</span>
          </Button>
        </form>
        <p id="assistant-status" className="px-4 pb-3 text-xs text-muted-foreground">
          {t('notYet')}
        </p>
      </div>

      <aside className="hidden border-l p-4 lg:block">
        <Pane title={t('preview')}>
          <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>
        </Pane>
      </aside>
    </div>
  );
}
