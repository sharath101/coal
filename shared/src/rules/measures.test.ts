import { describe, expect, it } from 'vitest';
import { makeCalendar } from './calendar';
import {
  daysPerTask,
  onTimeRate,
  openLoad,
  reworkRate,
  signTurnaround,
  type ClosedTask,
} from './measures';

const cal = makeCalendar();
const task = (
  firstDueOn: string | null,
  doneOn: string,
  createdOn = '2026-11-02',
  kind = 'work',
): ClosedTask => ({ kind, createdOn, firstDueOn, doneOn });

describe('the measures', () => {
  it('counts a task on time when it is done by its first due date', () => {
    expect(onTimeRate([task('2026-11-09', '2026-11-09'), task('2026-11-09', '2026-11-10')])).toBe(
      0.5,
    );
  });

  it('leaves out tasks with no due date and signatures, and has no rate without tasks', () => {
    expect(
      onTimeRate([
        task(null, '2026-11-09'),
        task('2026-11-09', '2026-11-12', '2026-11-02', 'sign'),
      ]),
    ).toBeNull();
    expect(onTimeRate([])).toBeNull();
  });

  it('compares working days taken with working days planned', () => {
    // Opened Monday, planned for Friday (4 days), done the next Tuesday (6 days).
    expect(daysPerTask(cal, [task('2026-11-06', '2026-11-10')])).toEqual({ actual: 6, planned: 4 });
    expect(daysPerTask(cal, [])).toBeNull();
  });

  it('averages the time from a signature request to the signature', () => {
    const signed = [
      task('2026-11-05', '2026-11-04', '2026-11-02', 'sign'),
      task('2026-11-05', '2026-11-06', '2026-11-02', 'sign'),
    ];
    expect(signTurnaround(cal, signed)).toBe(3);
    expect(signTurnaround(cal, [task('2026-11-09', '2026-11-09')])).toBeNull();
  });

  it('works out the share returned', () => {
    expect(reworkRate(4, 1)).toBe(0.25);
    expect(reworkRate(0, 0)).toBeNull();
  });

  it('counts open tasks and the overdue ones', () => {
    expect(
      openLoad([{ dueOn: '2026-11-01' }, { dueOn: '2026-11-20' }, { dueOn: null }], '2026-11-10'),
    ).toEqual({
      open: 3,
      overdue: 1,
    });
  });
});
