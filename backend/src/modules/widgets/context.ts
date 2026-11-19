import {
  addCalendarDays,
  type DateKey,
  type ScheduleSettings,
  type Tone,
  type WidgetData,
  type WidgetRow,
  type WorkCalendar,
} from '@coal/shared';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';

/** What a widget needs to know about who is looking, and when. */
export interface WidgetContext {
  deps: AppDeps;
  ctx: RequestContext;
  actor: Actor;
  now: Date;
  today: DateKey;
  cal: WorkCalendar;
  settings: ScheduleSettings;
  view: 'compact' | 'expanded';
  tab: string | null;
  filters: {
    project?: string | undefined;
    step?: string | undefined;
    kind?: string | undefined;
    due?: string | undefined;
    line?: string | undefined;
    stage?: string | undefined;
    health?: string | undefined;
  };
}

export type WidgetBody = Omit<WidgetData, 'key' | 'view' | 'asOf'>;
export type WidgetHandler = (w: WidgetContext) => Promise<WidgetBody>;

/** How many rows the compact card shows, and the most an expanded view returns. */
export const COMPACT_ROWS = 5;
export const EXPANDED_ROWS = 100;
export const rowLimit = (w: WidgetContext, compact = COMPACT_ROWS) =>
  w.view === 'compact' ? compact : EXPANDED_ROWS;

export function row(r: Partial<WidgetRow> & { id: string; title: string }): WidgetRow {
  return {
    subtitle: null,
    link: null,
    tone: 'neutral',
    badges: [],
    cells: {},
    actions: [],
    ref: {},
    ...r,
  };
}

export const count = (key: string, value: number | null, tone: Tone = 'neutral') => ({
  key,
  value,
  tone,
});

/** The Sunday that ends this week (a Sunday is its own week's end). */
export function weekEnd(today: DateKey): DateKey {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addCalendarDays(today, (7 - weekday) % 7);
}

export const projectLink = (projectId: string, stepKey?: string | null) =>
  stepKey ? `/projects/${projectId}?step=${encodeURIComponent(stepKey)}` : `/projects/${projectId}`;

/** Red when late, amber when due within a couple of working days. */
export function dueTone(w: WidgetContext, dueOn: DateKey | null): Tone {
  if (!dueOn) return 'neutral';
  if (dueOn < w.today) return 'danger';
  return dueOn <= addCalendarDays(w.today, 2) ? 'warning' : 'neutral';
}

export const healthTone = (health: string | null): Tone =>
  health === 'red' || health === 'overdue'
    ? 'danger'
    : health === 'amber' || health === 'at_risk'
      ? 'warning'
      : health === 'green'
        ? 'good'
        : 'neutral';

export const percent = (fraction: number | null): number | null =>
  fraction === null ? null : Math.round(fraction * 100);

/** The first part of a task's subject label (`SPN-26-002 · Name`): the project code. */
export const codeOf = (label: string | null): string => (label ?? '').split(' · ')[0] ?? '';
