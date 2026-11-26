import { workingDaysBetween, type SignOffWait } from '@coal/shared';
import { presentDeviations } from '../deviations/service';
import { latestDeviationOfSteps, listDeviationRows } from '../deviations/store';
import { evaluateRuns } from '../schedule/milestones';
import { activeTasksOf, signOffWaits } from '../tasks/service';
import { findUsersByIds } from '../users/service';
import {
  count,
  healthTone,
  lineGroup,
  projectLink,
  row,
  rowLimit,
  type WidgetBody,
  type WidgetContext,
} from './context';
import { loadPortfolio } from './portfolio';
import { waitingOnText } from './tasks';

/**
 * W7: late and at-risk steps and milestones, with the reason and the cause. The sentence of
 * explanation and the named cause show only to those allowed (docs/roles-and-access.md#content-is-need-to-know);
 * everyone sees the category, the role and the dates, because that is status.
 */
export async function delaysAndRisks(w: WidgetContext): Promise<WidgetBody> {
  const { orgId } = w.ctx;
  const portfolio = await loadPortfolio(w.deps.db, orgId);
  const line = w.filters.line;
  const shown = portfolio
    .filter((p) => ['active', 'on_hold'].includes(p.run.status))
    .filter((p) => !line || p.line.code === line || p.line.id === line)
    .filter(
      (p) =>
        !w.filters.project ||
        p.project.id === w.filters.project ||
        p.project.code === w.filters.project,
    );

  const stepRows = shown.flatMap((p) => [...p.steps.values()]);
  const latest = await latestDeviationOfSteps(
    w.deps.db,
    stepRows.map((s) => s.id),
  );
  const presented = await presentDeviations(w.deps.db, orgId, w.actor, [...latest.values()]);
  const presentedBy = new Map(presented.map((d) => [d.id, d]));
  const tasks = await activeTasksOf(w.deps.db, orgId);
  const owners = await findUsersByIds(
    w.deps.db,
    orgId,
    tasks.flatMap((t) => (t.assigneeId ? [t.assigneeId] : [])),
  );
  const ownerName = new Map(owners.map((u) => [u.id, u.name]));
  // A step that is with its signers is theirs to finish: they are its owners, not the doers.
  const waits = await signOffWaits(
    w.deps.db,
    orgId,
    stepRows.filter((s) => s.status === 'in_review').map((s) => s.id),
    w.now,
  );
  const ownersOfStep = (runStepId: string) =>
    [
      ...new Set(
        tasks
          .filter((t) => t.runStepId === runStepId && t.kind === 'work' && t.assigneeId)
          .map((t) => ownerName.get(t.assigneeId as string) ?? ''),
      ),
    ]
      .filter(Boolean)
      .join(', ');

  const delays: { late: number; r: ReturnType<typeof row> }[] = [];
  for (const p of shown) {
    for (const step of p.route.steps) {
      const s = p.steps.get(step.key);
      if (!s || ['approved', 'done', 'cancelled', 'reset'].includes(s.status)) continue;
      const overdue = !!s.plannedEnd && s.plannedEnd < w.today;
      if (!overdue && s.health !== 'at_risk') continue;
      const late = overdue && s.plannedEnd ? workingDaysBetween(w.cal, s.plannedEnd, w.today) : 0;
      const dev = latest.get(s.id)
        ? presentedBy.get((latest.get(s.id) as { id: string }).id)
        : undefined;
      const cause = dev
        ? (dev.cause.name ??
          dev.cause.role?.name ??
          (dev.cause.type === 'outside' ? 'Outside party' : ''))
        : '';
      delays.push({
        late,
        r: row({
          id: s.id,
          title: `Step ${step.key}: ${step.name}`,
          subtitle: `${p.project.code} · ${p.project.name}`,
          link: projectLink(p.project.id, step.key),
          group: lineGroup(p.line),
          tone: healthTone(overdue ? 'overdue' : 'at_risk'),
          badges: overdue
            ? [{ label: `${late}d late`, tone: 'danger' }]
            : [{ label: 'At risk', tone: 'warning' }],
          cells: {
            project: p.project.code,
            step: step.key,
            owner: waits.has(s.id)
              ? `${(waits.get(s.id) as SignOffWait).signer.name} sign-off: ${waitingOnText(waits.get(s.id) as SignOffWait)}`
              : ownersOfStep(s.id),
            planned: s.plannedEnd,
            forecast: s.forecastEnd,
            daysLate: late,
            reason: dev?.reasonCode ?? null,
            cause,
          },
          actions: ['open'],
          ref: { projectId: p.project.id, stepKey: step.key },
        }),
      });
    }
  }
  // The step counts come before the milestones join the list.
  const overdueCount = delays.filter((d) => d.late > 0).length;
  const atRiskCount = delays.length - overdueCount;

  // Late and at-risk milestones of the same projects: their target is the date, the step's forecast the forecast.
  const milestonesByRun = await evaluateRuns(
    w.deps.db,
    orgId,
    shown.map((p) => ({ runId: p.run.id, route: p.route })),
    w.now,
  );
  let lateMilestones = 0;
  for (const p of shown) {
    for (const m of milestonesByRun.get(p.run.id) ?? []) {
      if (m.status !== 'late' && m.status !== 'at_risk') continue;
      if (m.status === 'late') lateMilestones += 1;
      const stepRow = m.row.stepKey ? p.steps.get(m.row.stepKey) : undefined;
      delays.push({
        late: m.daysLate,
        r: row({
          id: m.row.id,
          title: `Milestone: ${m.title}`,
          subtitle: `${p.project.code} · ${p.project.name}`,
          link: projectLink(p.project.id, m.row.stepKey),
          group: lineGroup(p.line),
          tone: healthTone(m.status === 'late' ? 'overdue' : 'at_risk'),
          badges: [
            { label: 'Milestone', tone: 'neutral' },
            m.status === 'late'
              ? { label: `${m.daysLate}d late`, tone: 'danger' }
              : { label: 'At risk', tone: 'warning' },
          ],
          cells: {
            project: p.project.code,
            step: m.row.stepKey,
            owner: stepRow ? ownersOfStep(stepRow.id) : '',
            planned: m.row.targetDate,
            forecast: m.forecastDate,
            daysLate: m.daysLate,
            reason: null,
            cause: '',
          },
          actions: ['open'],
          ref: { projectId: p.project.id, ...(m.row.stepKey && { stepKey: m.row.stepKey }) },
        }),
      });
    }
  }
  delays.sort((a, b) => b.late - a.late);

  const runIds = shown.map((p) => p.run.id);
  const { rows: devRows } = await listDeviationRows(w.deps.db, orgId, {
    limit: 100,
    runIds,
    state: 'all',
  });
  const devs = await presentDeviations(w.deps.db, orgId, w.actor, devRows);
  const groupOfProject = new Map(portfolio.map((p) => [p.project.id, lineGroup(p.line)]));
  const toReview = devs.filter((d) => d.can.review).length;

  const tab = w.view === 'expanded' && w.tab === 'deviations' ? 'deviations' : 'delays';
  const rows =
    tab === 'deviations'
      ? devs.map((d) =>
          row({
            id: d.id,
            title: `${d.project.code} · step ${d.stepKey ?? ''}`,
            subtitle: d.reasonText,
            link: projectLink(d.project.id, d.stepKey),
            group: groupOfProject.get(d.project.id) ?? null,
            tone: d.can.review ? 'warning' : 'neutral',
            badges: d.review
              ? [{ label: d.review.outcome, tone: 'good' }]
              : [{ label: 'To review', tone: 'warning' }],
            cells: {
              project: d.project.code,
              step: d.stepKey,
              owner: d.recordedBy.name,
              planned: d.plannedDate,
              forecast: d.newDate,
              daysLate: null,
              reason: d.reasonCode,
              cause:
                d.cause.name ??
                d.cause.role?.name ??
                (d.cause.type === 'outside' ? 'Outside party' : ''),
            },
            actions: ['open'],
            ref: { projectId: d.project.id, ...(d.stepKey && { stepKey: d.stepKey }) },
          }),
        )
      : delays.map((d) => d.r);

  return {
    counts: [
      count('overdue', overdueCount, overdueCount > 0 ? 'danger' : 'neutral'),
      count('atRisk', atRiskCount, atRiskCount > 0 ? 'warning' : 'neutral'),
      count('lateMilestones', lateMilestones, lateMilestones > 0 ? 'danger' : 'neutral'),
      count('toReview', toReview, toReview > 0 ? 'warning' : 'neutral'),
    ],
    tabs:
      w.view === 'expanded'
        ? [
            { key: 'delays', count: delays.length },
            { key: 'deviations', count: devs.length },
          ]
        : [],
    tab: w.view === 'expanded' ? tab : null,
    total: rows.length,
    rows: rows.slice(0, rowLimit(w, 3)),
  };
}
