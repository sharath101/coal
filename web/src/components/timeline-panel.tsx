'use client';

import type { RouteView } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChangeDatesDialog } from '@/components/change-dates-dialog';
import { DeviationsPanel } from '@/components/deviations-panel';
import { HealthBadge, StepHealthBadge } from '@/components/health-badge';
import { HealthReasons, LaunchDates } from '@/components/project-health';
import { PlanEditor } from '@/components/plan-editor';
import { ProblemMessage } from '@/components/problem-message';
import { StepStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/lib/format';
import { useRoles, useTimeline } from '@/lib/queries';

/** The Timeline tab: planned against forecast, the baseline, the changes, and the deviations. */
export function TimelinePanel({ projectId, route }: { projectId: string; route: RouteView }) {
  const t = useTranslations('timeline');
  const timeline = useTimeline(projectId);
  const roles = useRoles();
  const [changing, setChanging] = useState(false);
  const tl = timeline.data;

  if (timeline.error) return <ProblemMessage error={timeline.error} />;
  if (!tl) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const roleName = (key: string) => roles.data?.roles.find((r) => r.key === key)?.name ?? key;
  const dates = (start: string, end: string) => `${formatDate(start)} – ${formatDate(end)}`;
  const changes = tl.items.filter((i) => i.kind === 'change').toReversed();

  return (
    <div className="grid gap-8">
      <section className="grid gap-3" aria-labelledby="timeline-summary">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="timeline-summary" className="text-lg font-semibold">
            {t('heading')}
          </h2>
          <HealthBadge health={tl.health} />
          <span className="text-sm text-muted-foreground">
            {tl.baselineNo > 0 ? t('baseline', { no: tl.baselineNo }) : t('noBaseline')}
          </span>
        </div>
        <LaunchDates plannedLaunch={tl.plannedLaunch} forecastLaunch={tl.forecastLaunch} />
        <HealthReasons reasons={tl.healthReasons} />
        {tl.baselineNo === 0 && !tl.can.editPlan && (
          <p className="text-sm text-muted-foreground">{t('baselineLater')}</p>
        )}
      </section>

      {tl.can.editPlan ? (
        <PlanEditor projectId={projectId} route={route} timeline={tl} />
      ) : (
        tl.draft.length > 0 && (
          <section className="grid gap-2" aria-labelledby="draft-heading">
            <h3 id="draft-heading" className="font-medium">
              {t('draftHeading')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('draftText')}</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('step')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('role')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('dates')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('writtenBy')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tl.draft.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="px-3 py-2">{d.stepKey}</td>
                      <td className="px-3 py-2">{roleName(d.roleKey)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {dates(d.plannedStart, d.plannedEnd)}
                      </td>
                      <td className="px-3 py-2">{d.recordedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      <section className="grid gap-2" aria-labelledby="steps-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="steps-heading" className="font-medium">
            {t('stepsHeading')}
          </h3>
          {tl.can.change && (
            <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
              {t('changeDate')}
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('step')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('status')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('plannedStart')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('plannedEnd')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('forecastEnd')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('health')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('late')}
                </th>
              </tr>
            </thead>
            {route.stages.map((stage) => {
              const steps = tl.steps.filter((s) => s.stage === stage.no);
              if (steps.length === 0) return null;
              return (
                <tbody key={stage.no}>
                  <tr className="border-t bg-muted/30">
                    <th scope="colgroup" colSpan={7} className="px-3 py-1.5 text-xs font-medium">
                      {t('stage', { no: stage.no, name: stage.name })}
                    </th>
                  </tr>
                  {steps.map((s) => (
                    <tr key={s.key} className="border-t align-top">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-muted-foreground">{s.key}</span>{' '}
                        {s.name}
                      </td>
                      <td className="px-3 py-2">
                        <StepStatusBadge status={s.status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.plannedStart ? formatDate(s.plannedStart) : t('noDate')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.plannedEnd ? formatDate(s.plannedEnd) : t('noDate')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.forecastEnd ? formatDate(s.forecastEnd) : t('noDate')}
                      </td>
                      <td className="px-3 py-2">
                        {s.health ? <StepHealthBadge health={s.health} /> : t('noDate')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.daysLate > 0 ? (
                          <span className="font-medium text-red-700">
                            {t('workingDays', { count: s.daysLate })}
                          </span>
                        ) : (
                          t('noDate')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="changes-heading">
        <h3 id="changes-heading" className="font-medium">
          {t('changesHeading')}
        </h3>
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
        ) : (
          <ul className="grid gap-2">
            {changes.map((c) => (
              <li key={c.id} className="grid gap-0.5 rounded-lg border p-3 text-sm">
                <span className="font-medium">
                  {t('changeLine', {
                    step: c.stepKey,
                    role: roleName(c.roleKey),
                    dates: dates(c.plannedStart, c.plannedEnd),
                  })}
                </span>
                {c.reason && <span>{c.reason}</span>}
                <span className="text-xs text-muted-foreground">
                  {t('changedBy', { name: c.recordedBy, when: formatDateTime(c.createdAt) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeviationsPanel projectId={projectId} />

      {tl.can.change && (
        <ChangeDatesDialog
          open={changing}
          onOpenChange={setChanging}
          projectId={projectId}
          route={route}
          timeline={tl}
        />
      )}
    </div>
  );
}
