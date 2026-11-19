import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  addWorkingDays,
  calendarDaysBetween,
  dateOfInstant,
  makeCalendar,
  nextWorkingDay,
  workingDaysBetween,
} from './calendar';

describe('the working calendar', () => {
  const plain = makeCalendar();

  it('treats Monday to Friday as working days', () => {
    expect(plain.isWorkingDay('2026-11-06')).toBe(true); // Friday
    expect(plain.isWorkingDay('2026-11-07')).toBe(false); // Saturday
    expect(plain.isWorkingDay('2026-11-08')).toBe(false); // Sunday
  });

  it('skips weekends when adding working days', () => {
    expect(addWorkingDays(plain, '2026-11-06', 1)).toBe('2026-11-09');
    expect(addWorkingDays(plain, '2026-11-02', 5)).toBe('2026-11-09');
    expect(addWorkingDays(plain, '2026-11-07', 1)).toBe('2026-11-09');
  });

  it('leaves the date alone when adding zero days', () => {
    expect(addWorkingDays(plain, '2026-11-07', 0)).toBe('2026-11-07');
  });

  it('moves back over weekends when given negative days', () => {
    expect(addWorkingDays(plain, '2026-11-09', -1)).toBe('2026-11-06');
    expect(addWorkingDays(plain, '2026-11-09', -5)).toBe('2026-11-02');
  });

  it('skips holidays and counts worked Saturdays', () => {
    const cal = makeCalendar([
      { date: '2026-11-09', isWorkingDay: false },
      { date: '2026-11-07', isWorkingDay: true },
    ]);
    expect(cal.isWorkingDay('2026-11-09')).toBe(false);
    expect(addWorkingDays(cal, '2026-11-06', 1)).toBe('2026-11-07');
    expect(addWorkingDays(cal, '2026-11-07', 1)).toBe('2026-11-10');
    expect(nextWorkingDay(cal, '2026-11-08')).toBe('2026-11-10');
  });

  it('counts the working days after one date, up to and including another', () => {
    expect(workingDaysBetween(plain, '2026-11-02', '2026-11-06')).toBe(4);
    expect(workingDaysBetween(plain, '2026-11-06', '2026-11-09')).toBe(1);
    expect(workingDaysBetween(plain, '2026-11-09', '2026-11-06')).toBe(-1);
    expect(workingDaysBetween(plain, '2026-11-09', '2026-11-09')).toBe(0);
  });

  it('works out Indian dates from instants, which differ from UTC after 18:30', () => {
    expect(dateOfInstant(new Date('2026-11-02T18:29:00Z'))).toBe('2026-11-02');
    expect(dateOfInstant(new Date('2026-11-02T18:31:00Z'))).toBe('2026-11-03');
  });

  it('does simple calendar arithmetic', () => {
    expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(calendarDaysBetween('2026-11-01', '2026-12-01')).toBe(30);
  });
});
