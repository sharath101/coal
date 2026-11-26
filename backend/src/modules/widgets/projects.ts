import {
  addCalendarDays,
  calendarDaysBetween,
  dateOfInstant,
  directInputs,
  FINISHED_STATUSES,
  OPEN_STATUSES,
} from '@coal/shared';
import { roleName } from '../rnd/routing';
import { nextMilestones, type EvaluatedMilestone } from '../schedule/milestones';
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
import { loadPortfolio, type PortfolioProject } from './portfolio';

const isFinished = (status: string | undefined) => FINISHED_STATUSES.includes(status as never);

const matchesProject = (w: WidgetContext, p: PortfolioProject) =>
  !w.filters.project || p.project.id === w.filters.project || p.project.code === w.filters.project;

/** W4: the next checkpoint of each running project, with whether its inputs are ready. */
export async function upcomingCheckpoints(w: WidgetContext): Promise<WidgetBody> {
  const portfolio = await loadPortfolio(w.deps.db, w.ctx.orgId);
  const items: { at: string; late: boolean; r: ReturnType<typeof row> }[] = [];
  for (const p of portfolio) {
    if (p.run.status !== 'active' || !matchesProject(w, p)) continue;
    const step = p.route.steps.find(
      (s) =>
        s.checkpoint &&
        !isFinished(p.steps.get(s.key)?.status) &&
        p.steps.get(s.key)?.status !== 'cancelled',
    );
    if (!step) continue;
    const state = p.steps.get(step.key);
    const date = state?.forecastEnd ?? state?.plannedEnd ?? null;
    const waiting = directInputs(p.route, step).filter((k) => !isFinished(p.steps.get(k)?.status));
    const late = !!state?.plannedEnd && state.plannedEnd < w.today && state.status !== 'locked';
    const soon = !!date && date <= addCalendarDays(w.today, 14);
    items.push({
      at: date ?? '9999-12-31',
      late,
      r: row({
        id: `${p.project.id}:${step.key}`,
        title: `Step ${step.key}: ${step.name}`,
        subtitle: `${p.project.code} · ${p.project.name}`,
        link: projectLink(p.project.id, step.key),
        group: lineGroup(p.line),
        tone: late ? 'danger' : waiting.length > 0 && soon ? 'warning' : 'neutral',
        cells: {
          project: p.project.code,
          step: step.key,
          date,
          inputs:
            waiting.length === 0
              ? 'Ready'
              : `Waiting on ${waiting.map((k) => `step ${k}`).join(', ')}`,
          signer: step.signer ? roleName(step.signer) : '',
        },
        actions: ['open'],
        ref: { projectId: p.project.id, stepKey: step.key },
      }),
    });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  const within = items.filter((i) => i.at <= addCalendarDays(w.today, 14)).length;
  const lateCount = items.filter((i) => i.late).length;
  return {
    counts: [
      count('upcoming', items.length),
      count('within14Days', within, within > 0 ? 'warning' : 'neutral'),
      count('overdue', lateCount, lateCount > 0 ? 'danger' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: items.length,
    rows: items.slice(0, rowLimit(w)).map((i) => i.r),
  };
}

const projectRow = (p: PortfolioProject, w: WidgetContext, milestone?: EvaluatedMilestone) => {
  const open = [...p.steps.entries()].filter(([, s]) => OPEN_STATUSES.includes(s.status));
  const next =
    open
      .map(([, s]) => s.plannedEnd)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const status = p.run.status === 'active' ? [] : [{ label: p.run.status.replace('_', ' ') }];
  return row({
    id: p.project.id,
    title: `${p.project.code} · ${p.project.name}`,
    subtitle: p.line.name,
    link: projectLink(p.project.id),
    group: lineGroup(p.line),
    tone: healthTone(p.run.health),
    badges: [
      ...status.map((b) => ({ ...b, tone: 'neutral' as const })),
      ...(milestone?.status === 'late'
        ? [{ label: 'Milestone late', tone: 'danger' as const }]
        : milestone?.status === 'at_risk'
          ? [{ label: 'Milestone at risk', tone: 'warning' as const }]
          : []),
    ],
    cells: {
      line: p.line.code,
      stage: p.run.stage,
      health: p.run.health,
      next,
      ...(milestone && { milestone: milestone.title, milestoneDue: milestone.row.targetDate }),
      steps: open.map(([k]) => k).join(', '),
      lead: p.lead,
      daysInStage: daysInStage(p, w),
      launch: p.run.forecastLaunch,
    },
    actions: ['open'],
    ref: { projectId: p.project.id },
  });
};

/** Days since the first step of the current stage opened. */
function daysInStage(p: PortfolioProject, w: WidgetContext): number | null {
  const opened = p.route.steps
    .filter((s) => s.stage === p.run.stage)
    .map((s) => p.steps.get(s.key)?.openedAt)
    .filter((d): d is Date => !!d)
    .map((d) => dateOfInstant(d))
    .sort()[0];
  return opened ? calendarDaysBetween(opened, w.today) : null;
}

const HEALTH_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2 };

/** W5: the projects I am on, or lead. */
export async function myProjects(w: WidgetContext): Promise<WidgetBody> {
  const portfolio = await loadPortfolio(w.deps.db, w.ctx.orgId);
  const mine = portfolio.filter(
    (p) =>
      p.memberIds.includes(w.actor.userId) ||
      (w.actor.roleKey === 'rd_lead' && w.actor.productLineId === p.project.productLineId),
  );
  mine.sort(
    (a, b) =>
      (HEALTH_ORDER[a.run.health ?? 'green'] ?? 3) - (HEALTH_ORDER[b.run.health ?? 'green'] ?? 3) ||
      (a.run.forecastLaunch ?? '').localeCompare(b.run.forecastLaunch ?? ''),
  );
  const red = mine.filter((p) => p.run.health === 'red').length;
  const amber = mine.filter((p) => p.run.health === 'amber').length;
  const shown = mine.slice(0, rowLimit(w));
  const next = await nextMilestones(
    w.deps.db,
    w.ctx.orgId,
    shown.map((p) => ({
      runId: p.run.id,
      route: p.route,
      running: ['active', 'on_hold'].includes(p.run.status),
    })),
    w.now,
  );
  return {
    counts: [
      count('projects', mine.length),
      count('red', red, red > 0 ? 'danger' : 'neutral'),
      count('amber', amber, amber > 0 ? 'warning' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: mine.length,
    rows: shown.map((p) => projectRow(p, w, next.get(p.run.id))),
  };
}

/** W6: every project: by stage and product line, and how each is doing. */
export async function pipeline(w: WidgetContext): Promise<WidgetBody> {
  const portfolio = await loadPortfolio(w.deps.db, w.ctx.orgId);
  const f = w.filters;
  const shown = portfolio
    .filter((p) => !f.line || p.line.code === f.line || p.line.id === f.line)
    .filter((p) => !f.stage || String(p.run.stage) === f.stage)
    .filter((p) => !f.health || p.run.health === f.health);
  shown.sort(
    (a, b) =>
      (HEALTH_ORDER[a.run.health ?? 'green'] ?? 3) - (HEALTH_ORDER[b.run.health ?? 'green'] ?? 3) ||
      (a.run.forecastLaunch ?? '').localeCompare(b.run.forecastLaunch ?? ''),
  );
  const running = portfolio.filter((p) => ['active', 'on_hold'].includes(p.run.status));
  const stageCounts = [1, 2, 3, 4, 5, 6].map((s) =>
    count(`stage${s}`, running.filter((p) => p.run.stage === s).length),
  );
  const red = running.filter((p) => p.run.health === 'red').length;
  const amber = running.filter((p) => p.run.health === 'amber').length;
  return {
    counts: [
      ...stageCounts,
      count('red', red, red > 0 ? 'danger' : 'neutral'),
      count('amber', amber, amber > 0 ? 'warning' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: shown.length,
    rows: shown.slice(0, rowLimit(w)).map((p) => projectRow(p, w)),
  };
}
