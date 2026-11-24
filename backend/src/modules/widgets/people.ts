import {
  addCalendarDays,
  dateOfInstant,
  daysPerTask,
  MEASURE_WINDOW_DAYS,
  onTimeRate,
  openLoad,
  reworkRate,
  signTurnaround,
  type ClosedTask,
} from '@coal/shared';
import { reworkCounts } from '../documents/store';
import { isAbove } from '../permissions/rules';
import { roleName } from '../rnd/routing';
import { closedTasksSince, activeTasksOf, type TaskRow } from '../tasks/service';
import { listActiveUsers, personOf, type UserRow } from '../users/service';
import { loadPortfolio } from './portfolio';
import {
  codeOf,
  count,
  percent,
  row,
  rowLimit,
  weekEnd,
  type WidgetBody,
  type WidgetContext,
} from './context';

/**
 * The people below this person on the org chart (docs/roles-and-access.md#assigning-work-and-making-requests).
 * A Lead's also include everyone in R&D on the projects of their product line, whom they run.
 */
async function peopleBelow(w: WidgetContext): Promise<UserRow[]> {
  const everyone = await listActiveUsers(w.deps.db, w.ctx.orgId);
  const me = {
    roleKey: w.actor.roleKey,
    positionKey: w.actor.positionKey,
    productLineId: w.actor.productLineId,
  };
  let onMyLine = new Set<string>();
  if (w.actor.roleKey === 'rd_lead') {
    const portfolio = await loadPortfolio(w.deps.db, w.ctx.orgId);
    onMyLine = new Set(
      portfolio
        .filter((p) => p.project.productLineId === w.actor.productLineId)
        .flatMap((p) => p.memberIds),
    );
  }
  return everyone.filter((u) => isAbove(me, personOf(u), onMyLine.has(u.id)));
}

/** W8: open and overdue tasks of each person below me, by when they fall due. */
export async function teamWorkload(w: WidgetContext): Promise<WidgetBody> {
  const people = await peopleBelow(w);
  const tasks = await activeTasksOf(
    w.deps.db,
    w.ctx.orgId,
    people.map((p) => p.id),
  );
  const f = w.filters.project;
  const thisWeekEnd = weekEnd(w.today);
  const nextWeekEnd = addCalendarDays(thisWeekEnd, 7);
  const of = (id: string): TaskRow[] =>
    tasks.filter(
      (t) => t.assigneeId === id && (!f || t.subjectId === f || codeOf(t.subjectLabel) === f),
    );
  const rows = people
    .map((p) => {
      const mine = of(p.id);
      const { open, overdue } = openLoad(
        mine.map((t) => ({ dueOn: t.status === 'waiting' ? null : t.dueOn })),
        w.today,
      );
      const due = (t: TaskRow) => t.dueOn;
      return {
        overdue,
        r: row({
          id: p.id,
          title: p.name,
          subtitle: roleName(p.roleKey),
          tone: overdue > 0 ? 'danger' : 'neutral',
          cells: {
            role: roleName(p.roleKey),
            open,
            overdue,
            thisWeek: mine.filter(
              (t) => due(t) && (due(t) as string) >= w.today && (due(t) as string) <= thisWeekEnd,
            ).length,
            nextWeek: mine.filter(
              (t) =>
                due(t) && (due(t) as string) > thisWeekEnd && (due(t) as string) <= nextWeekEnd,
            ).length,
            later: mine.filter((t) => !due(t) || (due(t) as string) > nextWeekEnd).length,
          },
          actions: ['vp', 'rd_head', 'rd_lead'].includes(w.actor.roleKey) ? ['reassign'] : [],
          ref: { userId: p.id },
        }),
      };
    })
    .sort((a, b) => b.overdue - a.overdue);
  const totalOverdue = rows.reduce((n, r) => n + r.overdue, 0);
  return {
    counts: [
      count('people', people.length),
      count('openTasks', tasks.length),
      count('overdue', totalOverdue, totalOverdue > 0 ? 'danger' : 'neutral'),
    ],
    tabs: [],
    tab: null,
    total: rows.length,
    rows: rows.slice(0, rowLimit(w)).map((r) => r.r),
  };
}

interface PersonMeasures {
  onTime: number | null;
  daysPerTask: { actual: number; planned: number } | null;
  signTurnaround: number | null;
  rework: number | null;
  open: number;
  overdue: number;
}

/** W9: my measures, and those of each person below me (the Board sees department totals). */
export async function howItsGoing(w: WidgetContext): Promise<WidgetBody> {
  const { orgId } = w.ctx;
  const board = w.actor.roleKey === 'board';
  const below = await peopleBelow(w);
  const includeMe = !board;
  const ids = [...(includeMe ? [w.actor.userId] : []), ...below.map((u) => u.id)];
  const since = new Date(w.now.getTime() - MEASURE_WINDOW_DAYS * 86_400_000);
  const [closed, active, rework] = await Promise.all([
    closedTasksSince(w.deps.db, orgId, ids, since),
    activeTasksOf(w.deps.db, orgId, ids),
    reworkCounts(w.deps.db, orgId, ids, since),
  ]);
  const asClosed = (t: TaskRow): ClosedTask => ({
    kind: t.kind,
    createdOn: dateOfInstant(t.createdAt),
    firstDueOn: t.firstDueOn,
    doneOn: dateOfInstant(t.handedInAt ?? t.doneAt ?? t.updatedAt),
  });

  const measures = (userIds: string[]): PersonMeasures => {
    const set = new Set(userIds);
    const done = closed.filter((t) => t.assigneeId && set.has(t.assigneeId)).map(asClosed);
    const submitted = [...rework.entries()].filter(([id]) => set.has(id));
    const load = openLoad(
      active
        .filter((t) => t.assigneeId && set.has(t.assigneeId))
        .map((t) => ({ dueOn: t.status === 'waiting' ? null : t.dueOn })),
      w.today,
    );
    return {
      onTime: onTimeRate(done),
      daysPerTask: daysPerTask(w.cal, done),
      signTurnaround: signTurnaround(w.cal, done),
      rework: reworkRate(
        submitted.reduce((n, [, c]) => n + c.submitted, 0),
        submitted.reduce((n, [, c]) => n + c.returned, 0),
      ),
      ...load,
    };
  };

  const toRow = (
    id: string,
    title: string,
    role: string,
    m: PersonMeasures,
    you: boolean,
    person = true,
  ) =>
    row({
      id,
      title,
      subtitle: role,
      tone: m.overdue > 0 ? 'warning' : 'neutral',
      badges: you ? [{ label: 'You', tone: 'neutral' }] : [],
      cells: {
        role,
        onTime: percent(m.onTime),
        daysPerTask: m.daysPerTask ? `${m.daysPerTask.actual} / ${m.daysPerTask.planned}` : null,
        signTurnaround: m.signTurnaround,
        rework: percent(m.rework),
        openLoad: m.open,
        overdue: m.overdue,
      },
      ref: person ? { userId: id } : {},
    });

  const rows = [];
  const mine = measures([w.actor.userId]);
  if (board) {
    rows.push(
      toRow(
        'department',
        'Department totals',
        'R&D',
        measures(below.map((u) => u.id)),
        false,
        false,
      ),
    );
  } else {
    rows.push(toRow(w.actor.userId, w.actor.name, roleName(w.actor.roleKey), mine, true));
    for (const person of below) {
      rows.push(
        toRow(person.id, person.name, roleName(person.roleKey), measures([person.id]), false),
      );
    }
  }
  const team = below.length > 0 ? measures(below.map((u) => u.id)) : null;
  return {
    counts: [
      count(
        board ? 'departmentOnTime' : 'myOnTime',
        percent(board ? (team?.onTime ?? null) : mine.onTime),
      ),
      ...(!board && team ? [count('teamOnTime', percent(team.onTime))] : []),
    ],
    tabs: [],
    tab: null,
    total: rows.length,
    rows: rows.slice(0, rowLimit(w)),
  };
}
