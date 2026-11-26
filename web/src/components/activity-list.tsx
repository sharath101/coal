'use client';

import { stepLabel } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';
import { flatten, useActivity } from '@/lib/queries';

type Values = Record<string, string | number>;

/** Turns an event's payload into the values its text needs. */
function valuesOf(payload: Record<string, unknown>): Values {
  const out: Values = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = key === 'step' ? stepLabel(String(value)) : value;
    }
  }
  return out;
}

export function ActivityList({ projectId }: { projectId: string }) {
  const t = useTranslations('project');
  const tA = useTranslations('activity');
  const activity = useActivity(projectId);
  const items = flatten(activity.data?.pages);

  const label = (type: string, payload: Record<string, unknown>) => {
    // Message keys can't contain dots, so `step.ready` is `step_ready`.
    const key = `type.${type.replace('.', '_')}` as Parameters<typeof tA>[0];
    return tA.has(key) ? tA(key, valuesOf(payload) as never) : tA('generic', { type });
  };

  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {t('activity')}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noActivity')}</p>
      ) : (
        <ul className="grid gap-1.5 text-sm">
          {items.map((e) => (
            <li key={e.id} className="grid gap-0.5">
              <span>{label(e.type, e.payload)}</span>
              <span className="text-xs text-muted-foreground">
                {e.actor.name
                  ? e.actor.type === 'user_via_ai'
                    ? tA('via', { name: e.actor.name })
                    : tA('by', { name: e.actor.name })
                  : tA('system')}{' '}
                · {formatTime(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {activity.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {t('moreActivity')}
        </Button>
      )}
    </section>
  );
}
