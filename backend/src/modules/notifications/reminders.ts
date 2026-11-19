import { dateOfInstant, workingDaysBetween, type MessageKey } from '@coal/shared';
import type { Tx } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import { getRuns } from '../process/service';
import { loadCalendar, loadSettings } from '../schedule/calendar';
import { activeTasksOf, activeTasksOfStep, type TaskRow } from '../tasks/service';
import { findActiveUsersByRole, findUsersByIds, type UserRow } from '../users/service';
import { holdersOf, nextRoleUp, projectContext, type ProjectContext } from './audience';
import { notify, renderMessage, shortDate, stepVars, type NewNotification } from './service';

/**
 * Reminders and escalation (docs/dashboard.md#deadlines-alerts-and-deviations). Run each morning,
 * and safe to run twice: each reminder carries a key that stops a repeat to the same person.
 */
export async function runReminders(
  deps: AppDeps,
  orgId: string,
  now: Date = deps.now(),
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const [cal, settings, tasks] = await Promise.all([
      loadCalendar(tx, orgId),
      loadSettings(tx, orgId),
      activeTasksOf(tx, orgId),
    ]);
    const today = dateOfInstant(now);
    // Nobody is reminded on a day off.
    if (!cal.isWorkingDay(today)) return 0;
    const due = tasks.filter((t) => t.dueOn && t.runId && t.subjectId);
    const runs = await getRuns(tx, orgId, [...new Set(due.map((t) => t.runId as string))]);
    const contexts = new Map<string, ProjectContext | null>();
    const contextOf = async (projectId: string) => {
      if (!contexts.has(projectId))
        contexts.set(projectId, await projectContext(tx, orgId, projectId));
      return contexts.get(projectId) ?? null;
    };

    const out: NewNotification[] = [];
    for (const task of due) {
      if (runs.get(task.runId as string)?.status !== 'active') continue;
      const ctx = await contextOf(task.subjectId as string);
      const step = ctx?.route.steps.find((s) => s.key === task.stepKey);
      if (!ctx || !step) continue;
      const dueOn = task.dueOn as string;
      const untilDue = workingDaysBetween(cal, today, dueOn);
      const late = -untilDue;
      const assignee = task.assigneeId
        ? (await findUsersByIds(tx, orgId, [task.assigneeId]))[0]
        : undefined;
      const base = stepVars(ctx.route, step, ctx.project, ctx.lineName);
      const build = (
        people: UserRow[],
        key: MessageKey,
        kind: NewNotification['kind'],
        title: string,
        dedupe: string,
        extra: Record<string, string> = {},
      ) => {
        const body = renderMessage(ctx.route, key, { ...base, due: shortDate(dueOn), ...extra });
        for (const p of new Map(people.map((x) => [x.id, x])).values()) {
          out.push({
            userId: p.id,
            kind,
            eventType: `reminder.${key}`,
            title,
            body,
            link: `/projects/${ctx.project.id}?step=${encodeURIComponent(step.key)}`,
            projectId: ctx.project.id,
            stepKey: step.key,
            dedupeKey: `${dedupe}:${task.id}`,
          });
        }
      };

      if (task.kind === 'sign') {
        await signatureReminders(tx, orgId, ctx, task, build, {
          cal,
          today,
          every: settings.signatureReminderEveryWorkingDays,
          ladderAfter: settings.escalateToLadderWorkingDays,
          assignee,
          late,
        });
        continue;
      }
      if (!assignee) continue;
      // Doers waiting for a signature aren't reminded: the signature's own reminders cover it.
      if (task.status === 'waiting') continue;
      if (untilDue > 0 && untilDue <= settings.reminderBeforeWorkingDays) {
        build(
          [assignee],
          'reminder_due_soon',
          'reminder',
          `Step ${step.key} is due soon`,
          `soon:${dueOn}`,
        );
      }
      if (untilDue === 0) {
        const signers = step.signer ? await holdersOf(tx, orgId, ctx, step.signer) : [];
        build(
          [assignee, ...signers],
          'reminder_due_today',
          'reminder',
          `Step ${step.key} is due today`,
          `today:${dueOn}`,
        );
      }
      if (late >= settings.escalateToLadderWorkingDays) {
        build(
          await nextRoleUp(tx, orgId, ctx, assignee.roleKey),
          'escalation_late',
          'escalation',
          `${assignee.name} is late on step ${step.key}`,
          `late-ladder:${dueOn}`,
          { person: assignee.name, days: String(late) },
        );
      }
      if (late >= settings.escalateToExceptionListWorkingDays) {
        const leaders = [
          ...(await findActiveUsersByRole(tx, orgId, 'rd_head')),
          ...(await findActiveUsersByRole(tx, orgId, 'vp')),
        ];
        build(
          leaders,
          'escalation_late',
          'escalation',
          `On the exception list: step ${step.key}`,
          `late-list:${dueOn}`,
          { person: assignee.name, days: String(late) },
        );
      }
    }
    return notify(tx, orgId, out);
  });
}

type Build = (
  people: UserRow[],
  key: MessageKey,
  kind: NewNotification['kind'],
  title: string,
  dedupe: string,
  extra?: Record<string, string>,
) => void;

/**
 * A waiting signature: reminded when due and every few working days after. Late ones go up the
 * ladder, except a VP's or the Board's, which isn't escalated above them: the people who asked
 * for it are told instead.
 */
async function signatureReminders(
  tx: Tx,
  orgId: string,
  ctx: ProjectContext,
  task: TaskRow,
  build: Build,
  o: {
    cal: Parameters<typeof workingDaysBetween>[0];
    today: string;
    every: number;
    ladderAfter: number;
    assignee: UserRow | undefined;
    late: number;
  },
) {
  const dueOn = task.dueOn as string;
  if (o.late < 0) return;
  const signers = o.assignee
    ? [o.assignee]
    : task.queueRole
      ? await holdersOf(tx, orgId, ctx, task.queueRole)
      : [];
  const waited = String(workingDaysBetween(o.cal, dateOfInstant(task.createdAt), o.today));
  const every = Math.max(1, o.every);
  if (o.late % every === 0) {
    build(
      signers,
      'signature_waiting',
      'reminder',
      `A signature is waiting on step ${task.stepKey}`,
      `sign:${dueOn}:${o.late}`,
      { days: waited },
    );
  }
  const topSigner = ['vp', 'board'].includes(task.roleKey ?? '');
  if (topSigner) {
    if (o.late > 0 && o.late % every === 0) {
      const asked = (await requesters(tx, ctx, task)).filter((u) => u.id !== o.assignee?.id);
      build(
        asked,
        'signature_waiting',
        'alert',
        `Your signature request on step ${task.stepKey} is waiting`,
        `sign-asked:${dueOn}:${o.late}`,
        { days: waited },
      );
    }
  } else if (o.assignee && o.late >= o.ladderAfter) {
    build(
      await nextRoleUp(tx, orgId, ctx, o.assignee.roleKey),
      'escalation_late',
      'escalation',
      `${o.assignee.name} has not signed step ${task.stepKey}`,
      `late-ladder:${dueOn}`,
      { person: o.assignee.name, days: String(o.late) },
    );
  }
}

/** The people who asked for a signature: those still holding the step's work tasks. */
async function requesters(tx: Tx, ctx: ProjectContext, task: TaskRow): Promise<UserRow[]> {
  const open = await activeTasksOfStep(tx, ctx.runId, task.stepKey as string);
  const ids = open.flatMap((t) => (t.kind === 'work' && t.assigneeId ? [t.assigneeId] : []));
  return findUsersByIds(tx, task.orgId, ids);
}
