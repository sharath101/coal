import {
  addCalendarDays,
  calendarDaysBetween,
  dateOfInstant,
  directInputs,
  FINISHED_STATUSES,
} from '@coal/shared';
import { listWaiting } from '../documents/service';
import { roleName } from '../rnd/routing';
import { activeTasksOf, recentDoneTasks, type TaskRow } from '../tasks/service';
import {
  codeOf,
  count,
  dueTone,
  projectLink,
  row,
  rowLimit,
  weekEnd,
  type WidgetBody,
  type WidgetContext,
} from './context';
import { loadPortfolio } from './portfolio';

const TASK_TABS = ['todo', 'in_progress', 'waiting', 'done'] as const;

function matchesFilters(w: WidgetContext, t: TaskRow): boolean {
  const f = w.filters;
  if (f.project && t.subjectId !== f.project && codeOf(t.subjectLabel) !== f.project) return false;
  if (f.step && t.stepKey !== f.step) return false;
  if (f.kind && t.kind !== f.kind) return false;
  if (f.due) {
    const due = t.dueOn;
    if (f.due === 'overdue' && !(due && due < w.today)) return false;
    if (f.due === 'week' && !(due && due >= w.today && due <= weekEnd(w.today))) return false;
    if (f.due === 'later' && !(due && due > weekEnd(w.today))) return false;
    if (f.due === 'none' && due) return false;
  }
  return true;
}

/** W1: the tasks assigned to me, with what is overdue and due this week. */
export async function myTasks(w: WidgetContext): Promise<WidgetBody> {
  const { orgId } = w.ctx;
  const [active, done] = await Promise.all([
    activeTasksOf(w.deps.db, orgId, [w.actor.userId]),
    w.view === 'expanded' && w.tab === 'done'
      ? recentDoneTasks(w.deps.db, orgId, w.actor.userId, 50)
      : Promise.resolve([] as TaskRow[]),
  ]);
  // Signatures are on their own widget.
  const mine = active.filter((t) => t.kind !== 'sign');
  // A task waiting for the signer isn't late: the signature has its own due date.
  const running = mine.filter((t) => t.status !== 'waiting');
  const overdue = running.filter((t) => t.dueOn && t.dueOn < w.today).length;
  const thisWeek = running.filter(
    (t) => t.dueOn && t.dueOn >= w.today && t.dueOn <= weekEnd(w.today),
  ).length;
  const inProgress = mine.filter((t) => t.status === 'in_progress').length;
  const counts = [
    count('overdue', overdue, overdue > 0 ? 'danger' : 'neutral'),
    count('dueThisWeek', thisWeek, thisWeek > 0 ? 'warning' : 'neutral'),
    count('inProgress', inProgress),
  ];

  const tabOf = (t: TaskRow) =>
    t.status === 'in_progress' ? 'in_progress' : t.status === 'waiting' ? 'waiting' : 'todo';
  const tabs = TASK_TABS.map((key) => ({
    key,
    count: key === 'done' ? 0 : mine.filter((t) => tabOf(t) === key).length,
  }));
  const tab =
    w.view === 'expanded' ? (w.tab && TASK_TABS.includes(w.tab as never) ? w.tab : 'todo') : null;
  const source = tab === 'done' ? done : tab ? mine.filter((t) => tabOf(t) === tab) : mine;
  const filtered = source.filter((t) => matchesFilters(w, t));
  const shown = filtered.slice(0, rowLimit(w));

  return {
    counts,
    tabs: w.view === 'expanded' ? tabs : [],
    tab,
    total: filtered.length,
    rows: shown.map((t) => {
      const late =
        t.status !== 'waiting' && t.dueOn && t.dueOn < w.today
          ? calendarDaysBetween(t.dueOn, w.today)
          : 0;
      return row({
        id: t.id,
        title: t.title,
        subtitle: t.subjectLabel,
        link: t.subjectId ? projectLink(t.subjectId, t.stepKey) : null,
        tone: t.status === 'done' || t.status === 'waiting' ? 'neutral' : dueTone(w, t.dueOn),
        badges: late > 0 ? [{ label: `${late}d late`, tone: 'danger' }] : [],
        cells: {
          project: codeOf(t.subjectLabel),
          step: t.stepKey,
          kind: t.kind,
          due: t.dueOn,
          status: t.status,
        },
        actions:
          t.status === 'done'
            ? ['open']
            : t.status === 'in_progress'
              ? ['done', 'more_time', 'open']
              : ['start', 'done', 'more_time', 'open'],
        ref: {
          taskId: t.id,
          ...(t.subjectId && { projectId: t.subjectId }),
          ...(t.stepKey && { stepKey: t.stepKey }),
        },
      });
    }),
  };
}

/** W2: what waits for my signature: document rows and step sign-offs. */
export async function waitingSignature(w: WidgetContext): Promise<WidgetBody> {
  const { orgId } = w.ctx;
  const [documents, active] = await Promise.all([
    listWaiting(w.deps, w.ctx, w.actor),
    activeTasksOf(w.deps.db, orgId, [w.actor.userId]),
  ]);
  const signOffs = active.filter((t) => t.kind === 'sign');
  const rows = [
    ...documents.map((d) => ({
      at: dateOfInstant(new Date(d.requestedAt)),
      project: d.project.id,
      code: d.project.code,
      r: row({
        id: d.id,
        title: `${d.number} · ${d.title}`,
        subtitle: `${d.project.code} · step ${d.stepKey}`,
        link: `/projects/${d.project.id}/documents/${d.documentId}`,
        tone: 'neutral',
        badges: [{ label: d.meaning, tone: 'neutral' }],
        cells: {
          project: d.project.code,
          what: 'Document',
          row: d.meaning,
          waiting: calendarDaysBetween(dateOfInstant(new Date(d.requestedAt)), w.today),
          due: null,
        },
        actions: ['sign', 'return', 'open'],
        ref: { requestId: d.id, projectId: d.project.id, stepKey: d.stepKey },
      }),
    })),
    ...signOffs.map((t) => ({
      at: dateOfInstant(t.createdAt),
      project: t.subjectId ?? '',
      code: codeOf(t.subjectLabel),
      r: row({
        id: t.id,
        title: t.title,
        subtitle: t.subjectLabel,
        link: t.subjectId ? projectLink(t.subjectId, t.stepKey) : null,
        tone: dueTone(w, t.dueOn),
        badges: [{ label: 'Step sign-off', tone: 'neutral' }],
        cells: {
          project: codeOf(t.subjectLabel),
          what: 'Step sign-off',
          row: 'approved',
          waiting: calendarDaysBetween(dateOfInstant(t.createdAt), w.today),
          due: t.dueOn,
        },
        actions: ['open'],
        ref: {
          taskId: t.id,
          ...(t.subjectId && { projectId: t.subjectId }),
          ...(t.stepKey && { stepKey: t.stepKey }),
        },
      }),
    })),
  ]
    .filter(
      (x) => !w.filters.project || x.project === w.filters.project || x.code === w.filters.project,
    )
    .sort((a, b) => a.at.localeCompare(b.at));

  const oldest = rows[0] ? calendarDaysBetween(rows[0].at, w.today) : 0;
  const lateSignOffs = signOffs.filter((t) => t.dueOn && t.dueOn < w.today).length;
  return {
    counts: [
      count('waiting', rows.length, rows.length > 0 ? 'warning' : 'neutral'),
      count('oldestDays', oldest, oldest > 3 ? 'warning' : 'neutral'),
      count('overdue', lateSignOffs, lateSignOffs > 0 ? 'danger' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: rows.length,
    rows: rows.slice(0, rowLimit(w, 3)).map((x) => x.r),
  };
}

/** W3: the steps of mine that will open soon, and what each waits for. */
export async function comingUp(w: WidgetContext): Promise<WidgetBody> {
  const portfolio = await loadPortfolio(w.deps.db, w.ctx.orgId);
  const items: { at: string; r: ReturnType<typeof row> }[] = [];
  for (const p of portfolio) {
    if (p.run.status !== 'active') continue;
    if (
      w.filters.project &&
      p.project.id !== w.filters.project &&
      p.project.code !== w.filters.project
    )
      continue;
    const onTeam = p.memberIds.includes(w.actor.userId);
    const myLead =
      w.actor.roleKey === 'rd_lead' && w.actor.productLineId === p.project.productLineId;
    for (const step of p.route.steps) {
      const state = p.steps.get(step.key);
      if (!state || state.status !== 'locked') continue;
      const mine =
        step.doers.includes(w.actor.roleKey) || (step.doers.includes('team') && (onTeam || myLead));
      if (!mine || !(onTeam || myLead || ['vp', 'rd_head', 'board'].includes(w.actor.roleKey)))
        continue;
      const starts = state.forecastStart ?? w.today;
      const waiting = directInputs(p.route, step).filter(
        (k) => !FINISHED_STATUSES.includes(p.steps.get(k)?.status as never),
      );
      const waitsFor =
        waiting.length === 0
          ? 'Waiting to open'
          : `Your part starts after ${waiting.map((k) => `step ${k}`).join(' and ')}, expected ${starts}`;
      items.push({
        at: starts,
        r: row({
          id: `${p.project.id}:${step.key}`,
          title: `Step ${step.key}: ${step.name}`,
          subtitle: `${p.project.code} · ${p.project.name}`,
          link: projectLink(p.project.id, step.key),
          cells: { project: p.project.code, step: step.key, starts, waitsFor },
          actions: ['open'],
          ref: { projectId: p.project.id, stepKey: step.key },
        }),
      });
    }
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  const soon = items.filter((i) => i.at <= addCalendarDays(w.today, 14)).length;
  return {
    counts: [
      count('upcoming', items.length),
      count('startingSoon', soon, soon > 0 ? 'warning' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: items.length,
    rows: items.slice(0, rowLimit(w)).map((i) => i.r),
  };
}

export { roleName };
