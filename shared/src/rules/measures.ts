import { workingDaysBetween, type DateKey, type WorkCalendar } from './calendar';

/**
 * The measures (docs/dashboard.md#measures). They count the flow of work, never activity.
 * Pure functions: the backend loads the tasks and calls these.
 */

/** Tasks closed within this many days count (the last 90 days). */
export const MEASURE_WINDOW_DAYS = 90;

export interface ClosedTask {
  kind: string;
  createdOn: DateKey;
  /** The first due date: moving a date never improves the rate. */
  firstDueOn: DateKey | null;
  doneOn: DateKey;
}

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of finished tasks done by their first due date, 0 to 1. Signatures are measured separately. */
export function onTimeRate(tasks: readonly ClosedTask[]): number | null {
  const counted = tasks.filter((t) => t.kind !== 'sign' && t.firstDueOn);
  if (counted.length === 0) return null;
  const onTime = counted.filter((t) => t.doneOn <= (t.firstDueOn as DateKey)).length;
  return onTime / counted.length;
}

/** Working days from opening to done, and the days planned, on average. */
export function daysPerTask(
  cal: WorkCalendar,
  tasks: readonly ClosedTask[],
): { actual: number; planned: number } | null {
  const counted = tasks.filter((t) => t.kind !== 'sign' && t.firstDueOn);
  if (counted.length === 0) return null;
  const actual = average(
    counted.map((t) => Math.max(0, workingDaysBetween(cal, t.createdOn, t.doneOn))),
  );
  const planned = average(
    counted.map((t) => Math.max(0, workingDaysBetween(cal, t.createdOn, t.firstDueOn as DateKey))),
  );
  return { actual: round1(actual as number), planned: round1(planned as number) };
}

/** Working days from the request for a signature to the signature, on average. */
export function signTurnaround(cal: WorkCalendar, tasks: readonly ClosedTask[]): number | null {
  const signed = tasks.filter((t) => t.kind === 'sign');
  const days = average(
    signed.map((t) => Math.max(0, workingDaysBetween(cal, t.createdOn, t.doneOn))),
  );
  return days === null ? null : round1(days);
}

/** Share of submitted work that was returned, 0 to 1. */
export function reworkRate(submitted: number, returned: number): number | null {
  return submitted === 0 ? null : returned / submitted;
}

/** Open tasks now, and how many are overdue. */
export function openLoad(
  tasks: readonly { dueOn: DateKey | null }[],
  today: DateKey,
): { open: number; overdue: number } {
  return {
    open: tasks.length,
    overdue: tasks.filter((t) => t.dueOn !== null && t.dueOn < today).length,
  };
}
