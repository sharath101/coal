'use client';

import { RUN_STATUSES } from '@coal/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { HealthBadge } from '@/components/health-badge';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/role-fields';
import { ProjectStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import { flatten, useMe, useProjects } from '@/lib/queries';
import { canManageTemplates } from '@/lib/roles';

/** Every project's status is open to everyone signed in (docs/roles-and-access.md#what-people-can-see). */
export default function ProjectsPage() {
  const t = useTranslations('projects');
  const tStatus = useTranslations('status');
  const { data: me } = useMe();
  const [status, setStatus] = useState<(typeof RUN_STATUSES)[number] | ''>('');
  const projects = useProjects(status);
  const items = flatten(projects.data?.pages);
  const isVp = me?.role.key === 'vp';

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The library is rarely changed, so it lives here and not in the top bar. */}
          {me && canManageTemplates(me.role.key) && (
            <Button asChild variant="outline">
              <Link href="/templates">{t('templates')}</Link>
            </Button>
          )}
          {isVp && (
            <Button asChild>
              <Link href="/projects/new">{t('start')}</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid max-w-xs gap-2">
        <Label htmlFor="status">{t('filterStatus')}</Label>
        <select
          id="status"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="">{t('filterAll')}</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </select>
      </div>

      <ProblemMessage error={projects.error} />
      {projects.isSuccess && items.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {isVp ? t('noneForVp') : t('none')}
        </p>
      )}
      <ul className="grid gap-2">
        {items.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 hover:bg-accent"
            >
              <div className="grid gap-0.5">
                <span className="font-medium">
                  <span className="font-mono text-sm text-muted-foreground">{p.code}</span> ·{' '}
                  {p.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.productLine.name} · {t('stage', { stage: p.stage })} ·{' '}
                  {t('by', { name: p.createdBy })}
                  {p.forecastLaunch && (
                    <> · {t('launch', { date: formatDate(p.forecastLaunch) })}</>
                  )}
                </span>
              </div>
              <span className="flex items-center gap-2">
                <HealthBadge health={p.health} />
                <ProjectStatusBadge status={p.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {projects.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          {t('more')}
        </Button>
      )}
    </div>
  );
}
