'use client';

import { calendarDaysBetween, type HealthReason } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';

/** One reason a project is amber or red, in words: "Step 12 is 11 working days late". */
export function useHealthReasonText() {
  const t = useTranslations('healthReasons');
  return (reason: HealthReason) =>
    t(reason.code, { step: reason.step ?? '', days: reason.days ?? 0 });
}

export function HealthReasons({ reasons }: { reasons: HealthReason[] }) {
  const text = useHealthReasonText();
  if (reasons.length === 0) return null;
  return (
    <ul className="list-disc pl-5 text-sm">
      {reasons.map((reason) => (
        <li key={`${reason.code}-${reason.step ?? ''}`}>{text(reason)}</li>
      ))}
    </ul>
  );
}

/** The launch as planned and as forecast, and how far apart they are: "+12 days". */
export function LaunchDates({
  plannedLaunch,
  forecastLaunch,
}: {
  plannedLaunch: string | null;
  forecastLaunch: string | null;
}) {
  const t = useTranslations('project');
  const slip =
    plannedLaunch && forecastLaunch ? calendarDaysBetween(plannedLaunch, forecastLaunch) : null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">{t('plannedLaunch')}</dt>
        <dd className="font-medium">{plannedLaunch ? formatDate(plannedLaunch) : t('notSet')}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">{t('forecastLaunch')}</dt>
        <dd className="font-medium">{forecastLaunch ? formatDate(forecastLaunch) : t('notSet')}</dd>
      </div>
      {slip !== null && (
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t('slip')}</dt>
          <dd className={slip > 0 ? 'font-medium text-red-700' : 'font-medium'}>
            {slip === 0
              ? t('onPlan')
              : slip > 0
                ? t('slipLate', { count: slip })
                : t('slipAhead', { count: -slip })}
          </dd>
        </div>
      )}
    </dl>
  );
}
