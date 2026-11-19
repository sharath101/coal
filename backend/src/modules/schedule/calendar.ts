import type { CalendarException, DateKey } from '@coal/shared';
import { makeCalendar, ScheduleSettings, type WorkCalendar } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../core/db/client';
import { settings, workCalendar } from './tables';

export async function loadCalendar(ex: Executor, orgId: string): Promise<WorkCalendar> {
  const rows = await ex.select().from(workCalendar).where(eq(workCalendar.orgId, orgId));
  const exceptions: CalendarException[] = rows.map((r) => ({
    date: r.date,
    isWorkingDay: r.isWorkingDay,
  }));
  return makeCalendar(exceptions);
}

/** The thresholds and timings: the stored values over the defaults (docs/dashboard.md). */
export async function loadSettings(ex: Executor, orgId: string): Promise<ScheduleSettings> {
  const [row] = await ex
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.orgId, orgId), eq(settings.key, 'schedule')));
  return ScheduleSettings.parse(row?.value ?? {});
}

/**
 * Made-up holidays, so dates work before Jayon sends its calendar (open question W22). The real
 * list is loaded the same way, as rows of `work_calendar`.
 */
export const SAMPLE_HOLIDAYS: { date: DateKey; note: string }[] = [
  { date: '2026-12-25', note: 'Sample holiday: Christmas' },
  { date: '2027-01-26', note: 'Sample holiday: Republic Day' },
  { date: '2027-03-22', note: 'Sample holiday: spring festival' },
  { date: '2027-08-16', note: 'Sample holiday: Independence Day (observed)' },
  { date: '2027-10-02', note: 'Sample holiday: Gandhi Jayanti' },
  { date: '2027-11-04', note: 'Sample holiday: autumn festival' },
];

export async function loadSampleCalendar(ex: Executor, orgId: string): Promise<void> {
  await ex
    .insert(workCalendar)
    .values(
      SAMPLE_HOLIDAYS.map((h) => ({ orgId, date: h.date, isWorkingDay: false, note: h.note })),
    )
    .onConflictDoNothing();
}
