'use client';

import type { StepView } from '@coal/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { ActivityList } from '@/components/activity-list';
import { HealthBadge } from '@/components/health-badge';
import { Milestones } from '@/components/milestones';
import { HealthReasons, LaunchDates, useHealthReasonText } from '@/components/project-health';
import { ProjectActions } from '@/components/project-actions';
import { ProblemMessage } from '@/components/problem-message';
import { ProjectStatusBadge } from '@/components/status-badge';
import { StepCard } from '@/components/step-card';
import { TeamPanel } from '@/components/team-panel';
import { TimelinePanel } from '@/components/timeline-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProject, useProjectDocuments, useProjectRoute, useRefreshProject } from '@/lib/queries';

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectView />
    </Suspense>
  );
}

/**
 * The project page: the route by stage, with each step's state and what you may do now, and a
 * Timeline tab with the dates. `?tab=timeline` opens the tab; `?step=12` opens and shows a step.
 */
function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('project');
  const tProjects = useTranslations('projects');
  const router = useRouter();
  const search = useSearchParams();
  const tab = search.get('tab') === 'timeline' ? 'timeline' : 'route';
  const focusedStep = search.get('step');
  const project = useProject(id);
  const route = useProjectRoute(id);
  const documents = useProjectDocuments(id);
  const refresh = useRefreshProject(id);
  const reasonText = useHealthReasonText();
  const changed = () => void refresh();

  if (project.error || route.error) {
    return (
      <div className="p-6">
        <ProblemMessage error={project.error ?? route.error} />
      </div>
    );
  }
  if (!project.data || !route.data) return null;
  const p = project.data;
  const r = route.data;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="font-mono text-lg text-muted-foreground">{p.code}</span> · {p.name}
          </h1>
          <ProjectStatusBadge status={p.status} />
          <HealthBadge health={p.health} title={p.healthReasons.map(reasonText).join('\n')} />
        </div>
        <p className="text-sm text-muted-foreground">
          {p.productLine.name} · {tProjects('stage', { stage: p.stage })} ·{' '}
          {t('startedBy', { name: p.createdBy })}
        </p>
        <LaunchDates plannedLaunch={p.plannedLaunch} forecastLaunch={p.forecastLaunch} />
        <HealthReasons reasons={p.healthReasons} />
        {p.description && <p className="max-w-3xl text-sm">{p.description}</p>}
        {p.status === 'on_hold' && p.holdReason && (
          <p className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
            {t('holdReason', { reason: p.holdReason })}
          </p>
        )}
        {p.status === 'dropped' && p.dropReason && (
          <p className="rounded-md bg-muted p-3 text-sm">
            {t('dropReason', { reason: p.dropReason })}
          </p>
        )}
        <ProjectActions project={p} onChanged={changed} />
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          router.replace(
            value === 'timeline' ? `/projects/${id}?tab=timeline` : `/projects/${id}`,
            {
              scroll: false,
            },
          )
        }
      >
        <TabsList aria-label={t('views')}>
          <TabsTrigger value="route">{t('route')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('timeline')}</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-6">
          <TimelinePanel projectId={id} route={r} />
        </TabsContent>

        <TabsContent value="route" className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-6">
            <p className="text-xs text-muted-foreground">{t('signOffNote')}</p>
            <ProblemMessage error={documents.error} />
            {r.openCorrectiveActions > 0 && (
              <p className="text-sm font-medium">
                {t('corrective', { count: r.openCorrectiveActions })}
              </p>
            )}

            <section className="grid gap-6" aria-label={t('route')}>
              {r.stages.map((stage) => {
                const steps = r.steps.filter((s: StepView) => s.stage === stage.no);
                return (
                  <div key={stage.no} className="grid gap-2">
                    <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                      {t('stageHeading', { no: stage.no, name: stage.name })}
                    </h2>
                    <ul className="grid gap-2">
                      {steps.map((step) => (
                        <StepCard
                          key={`${step.key}-${step.iteration}`}
                          projectId={id}
                          step={step}
                          route={r}
                          documents={(documents.data ?? []).filter((d) => d.stepKey === step.key)}
                          focused={step.key === focusedStep}
                          onChanged={changed}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </div>

          <aside className="grid content-start gap-8">
            <TeamPanel project={p} onChanged={changed} />
            <Milestones projectId={id} route={r} onChanged={changed} />
            <ActivityList projectId={id} />
          </aside>
        </TabsContent>
      </Tabs>
    </div>
  );
}
