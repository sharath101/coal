'use client';

import type { Preview } from '@coal/shared';
import { useTranslations } from 'next-intl';

/** What an action would do or did: the steps that move, the tasks and who gets them, and warnings. */
export function PreviewPanel({
  preview,
  showTeam = false,
}: {
  preview: Preview;
  showTeam?: boolean;
}) {
  const t = useTranslations('preview');
  return (
    <div className="grid gap-4 rounded-lg border bg-muted/40 p-4 text-sm">
      {preview.warnings.length > 0 && (
        <section className="grid gap-1 rounded-md bg-warning p-3 text-warning-foreground">
          <h4 className="text-xs font-medium tracking-wide uppercase">{t('warnings')}</h4>
          <ul className="list-disc pl-4">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-1">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('steps')}
        </h4>
        <ul className="grid gap-0.5">
          {preview.steps.map((s, i) => (
            <li key={`${s.key}-${s.change}-${i}`}>
              <span className="font-medium">{t('stepLine', { key: s.key, name: s.name })}</span>{' '}
              <span className="text-muted-foreground">
                {t(`change.${s.change}`, { iteration: s.iteration })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-1">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('tasks')}
        </h4>
        {preview.tasks.length === 0 ? (
          <p className="text-muted-foreground">{t('noTasks')}</p>
        ) : (
          <ul className="grid gap-0.5">
            {preview.tasks.map((task, i) => (
              <li key={`${task.title}-${i}`}>
                {task.title} <span className="text-muted-foreground">→</span>{' '}
                <span className="font-medium">
                  {task.assignee?.name ??
                    (task.queueRole ? t('unassigned', { role: task.queueRole.name }) : '')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {preview.cancelledTasks > 0 && (
          <p className="text-muted-foreground">
            {t('cancelled', { count: preview.cancelledTasks })}
          </p>
        )}
      </section>

      {showTeam && preview.team.length > 0 && (
        <section className="grid gap-1">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('team')}
          </h4>
          <p>{preview.team.map((p) => p.name).join(', ')}</p>
        </section>
      )}
    </div>
  );
}
