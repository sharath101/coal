/**
 * Working days (docs/dashboard.md#deadlines-alerts-and-deviations). A date is a calendar day in
 * Indian time, written `YYYY-MM-DD`. Monday to Friday are working days, unless the working
 * calendar says otherwise: holidays on weekdays, and Saturdays that are worked.
 */

export type DateKey = string;

const DAY_MS = 86_400_000;
/** India has no daylight saving: always UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toUtcMs = (date: DateKey): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

const fromUtcMs = (ms: number): DateKey => new Date(ms).toISOString().slice(0, 10);

/** The calendar day in Indian time at this instant. */
export const dateOfInstant = (instant: Date): DateKey =>
  fromUtcMs(instant.getTime() + IST_OFFSET_MS).slice(0, 10);

export const addCalendarDays = (date: DateKey, days: number): DateKey =>
  fromUtcMs(toUtcMs(date) + days * DAY_MS);

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export const calendarDaysBetween = (from: DateKey, to: DateKey): number =>
  Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);

export const maxDate = (dates: DateKey[]): DateKey | null =>
  dates.length === 0 ? null : dates.reduce((a, b) => (a >= b ? a : b));

export const minDate = (dates: DateKey[]): DateKey | null =>
  dates.length === 0 ? null : dates.reduce((a, b) => (a <= b ? a : b));

/** A day the calendar overrides: a holiday (`false`) or a worked weekend day (`true`). */
export interface CalendarException {
  date: DateKey;
  isWorkingDay: boolean;
}

export interface WorkCalendar {
  isWorkingDay(date: DateKey): boolean;
}

export function makeCalendar(exceptions: readonly CalendarException[] = []): WorkCalendar {
  const overrides = new Map(exceptions.map((e) => [e.date, e.isWorkingDay]));
  return {
    isWorkingDay(date) {
      const override = overrides.get(date);
      if (override !== undefined) return override;
      const weekday = new Date(toUtcMs(date)).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    },
  };
}

/** The date itself if it is a working day, otherwise the next working day. */
export function nextWorkingDay(cal: WorkCalendar, date: DateKey): DateKey {
  let current = date;
  for (let i = 0; i < 400 && !cal.isWorkingDay(current); i += 1) {
    current = addCalendarDays(current, 1);
  }
  return current;
}

/** Moves by `days` working days, forward or (negative) back. Zero days leaves the date as it is. */
export function addWorkingDays(cal: WorkCalendar, date: DateKey, days: number): DateKey {
  const step = days < 0 ? -1 : 1;
  let current = date;
  let left = Math.abs(days);
  while (left > 0) {
    current = addCalendarDays(current, step);
    if (cal.isWorkingDay(current)) left -= 1;
  }
  return current;
}

/**
 * Working days after `from`, up to and including `to`. Negative if `to` is before `from`.
 * Monday to Friday is 4; a date to itself is 0.
 */
export function workingDaysBetween(cal: WorkCalendar, from: DateKey, to: DateKey): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [first, last] = sign === 1 ? [from, to] : [to, from];
  let count = 0;
  for (let d = addCalendarDays(first, 1); d <= last; d = addCalendarDays(d, 1)) {
    if (cal.isWorkingDay(d)) count += 1;
  }
  return count * sign;
}
