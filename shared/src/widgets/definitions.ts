/**
 * The widgets (docs/dashboard.md#widgets). Each is defined here, so the website, and later the
 * mobile app, draw the same thing. Each department's module adds its own the same way.
 */

export const WIDGET_KEYS = [
  'my-tasks',
  'waiting-signature',
  'coming-up',
  'upcoming-checkpoints',
  'my-projects',
  'pipeline',
  'delays-risks',
  'team-workload',
  'how-its-going',
  'messages',
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export type Question = 'needs_me' | 'coming' | 'how';

/** What can be done to a row in an expanded view. The website shows the ones it has. */
export type WidgetAction =
  'start' | 'done' | 'more_time' | 'remind' | 'sign' | 'return' | 'open' | 'mark_read' | 'reassign';

export interface WidgetDefinition {
  key: WidgetKey;
  /** The number in docs/dashboard.md. */
  no: string;
  title: string;
  question: Question;
  /** Only these roles may use it. Absent: everyone. */
  availableTo?: readonly string[];
  tabs: readonly string[];
  filters: readonly string[];
  /** The expanded table's columns, as keys of each row's `cells`. */
  columns: readonly string[];
  actions: readonly WidgetAction[];
  /** Events that make the widget refresh itself. */
  refreshOn: readonly string[];
}

const TASK_EVENTS = [
  'task.created',
  'task.assigned',
  'task.done',
  'task.cancelled',
  'task.updated',
  'task.accepted',
  'task.declined',
] as const;
const STEP_EVENTS = [
  'step.ready',
  'step.started',
  'step.submitted',
  'step.signed',
  'step.approved',
  'step.done',
  'step.returned',
  'step.reset',
  'step.cancelled',
] as const;
const SCHEDULE_EVENTS = [
  'forecast.changed',
  'timeline.changed',
  'project.health_changed',
  'deviation.recorded',
  'deviation.reviewed',
] as const;
const MILESTONE_EVENTS = [
  'project_milestone.added',
  'project_milestone.changed',
  'project_milestone.removed',
  'project_milestone.reached',
  'project_milestone.unreached',
] as const;

export const WIDGETS: readonly WidgetDefinition[] = [
  {
    key: 'my-tasks',
    no: 'W1',
    title: 'My tasks',
    question: 'needs_me',
    tabs: ['todo', 'in_progress', 'waiting', 'done'],
    filters: ['project', 'step', 'kind', 'due'],
    columns: ['project', 'step', 'kind', 'due', 'status', 'waitingOn'],
    actions: ['start', 'done', 'more_time', 'remind', 'open'],
    refreshOn: [
      ...TASK_EVENTS,
      'timeline.changed',
      'deviation.recorded',
      'step.signed',
      'signature.reminded',
    ],
  },
  {
    key: 'waiting-signature',
    no: 'W2',
    title: 'Waiting for my signature',
    question: 'needs_me',
    tabs: [],
    filters: ['project'],
    columns: ['project', 'what', 'row', 'waiting', 'due'],
    actions: ['sign', 'return', 'open'],
    refreshOn: [
      ...STEP_EVENTS,
      'signature.requested',
      'signature.signed',
      'signature.returned',
      'document.submitted',
      'document.approved',
      'document.returned',
    ],
  },
  {
    key: 'coming-up',
    no: 'W3',
    title: 'Coming up',
    question: 'coming',
    tabs: [],
    filters: ['project'],
    columns: ['project', 'step', 'starts', 'waitsFor'],
    actions: ['open'],
    refreshOn: [...STEP_EVENTS, ...SCHEDULE_EVENTS],
  },
  {
    key: 'upcoming-checkpoints',
    no: 'W4',
    title: 'Upcoming checkpoints',
    question: 'coming',
    tabs: [],
    filters: ['project'],
    columns: ['project', 'step', 'date', 'inputs', 'signer'],
    actions: ['open'],
    refreshOn: [...STEP_EVENTS, ...SCHEDULE_EVENTS],
  },
  {
    key: 'my-projects',
    no: 'W5',
    title: 'My projects',
    question: 'how',
    tabs: [],
    filters: [],
    columns: ['line', 'stage', 'health', 'next', 'milestone', 'milestoneDue'],
    actions: ['open'],
    refreshOn: [...STEP_EVENTS, ...SCHEDULE_EVENTS, ...MILESTONE_EVENTS, 'project.created'],
  },
  {
    key: 'pipeline',
    no: 'W6',
    title: 'R&D pipeline',
    question: 'how',
    tabs: [],
    filters: ['line', 'stage', 'health'],
    columns: ['line', 'stage', 'steps', 'lead', 'daysInStage', 'health', 'launch'],
    actions: ['open'],
    refreshOn: [...STEP_EVENTS, ...SCHEDULE_EVENTS, 'project.created', 'project.held'],
  },
  {
    key: 'delays-risks',
    no: 'W7',
    title: 'Delays and risks',
    question: 'how',
    tabs: ['delays', 'deviations'],
    filters: ['project', 'line'],
    columns: ['project', 'step', 'owner', 'planned', 'forecast', 'daysLate', 'reason', 'cause'],
    actions: ['open'],
    refreshOn: [...SCHEDULE_EVENTS, ...STEP_EVENTS, ...MILESTONE_EVENTS],
  },
  {
    key: 'team-workload',
    no: 'W8',
    title: 'Team workload',
    question: 'how',
    availableTo: ['vp', 'rd_head', 'rd_lead'],
    tabs: [],
    filters: ['project'],
    columns: ['role', 'open', 'overdue', 'thisWeek', 'nextWeek', 'later'],
    actions: ['reassign'],
    refreshOn: [...TASK_EVENTS, 'timeline.changed'],
  },
  {
    key: 'how-its-going',
    no: 'W9',
    title: "How it's going",
    question: 'how',
    tabs: [],
    filters: [],
    columns: ['role', 'onTime', 'daysPerTask', 'signTurnaround', 'rework', 'openLoad', 'overdue'],
    actions: [],
    refreshOn: [...TASK_EVENTS, ...STEP_EVENTS, 'deviation.recorded'],
  },
  {
    key: 'messages',
    no: 'W10',
    title: 'Messages and activity',
    question: 'needs_me',
    tabs: ['all', 'unread'],
    filters: [],
    columns: ['when', 'kind'],
    actions: ['mark_read', 'open'],
    refreshOn: ['notification'],
  },
];

export const widgetByKey = (key: string): WidgetDefinition | undefined =>
  WIDGETS.find((w) => w.key === key);

/** Each role's default layout, in order (docs/dashboard.md#default-layouts). */
export const DEFAULT_LAYOUTS: Readonly<Record<string, readonly WidgetKey[]>> = {
  board: ['waiting-signature', 'pipeline', 'delays-risks', 'upcoming-checkpoints', 'how-its-going'],
  vp: [
    'waiting-signature',
    'my-tasks',
    'pipeline',
    'delays-risks',
    'upcoming-checkpoints',
    'team-workload',
    'how-its-going',
    'messages',
  ],
  rd_head: [
    'waiting-signature',
    'my-tasks',
    'delays-risks',
    'pipeline',
    'upcoming-checkpoints',
    'team-workload',
    'how-its-going',
    'messages',
  ],
  rd_lead: [
    'my-tasks',
    'waiting-signature',
    'my-projects',
    'delays-risks',
    'upcoming-checkpoints',
    'team-workload',
    'coming-up',
    'how-its-going',
    'messages',
  ],
};

const TEAM_LAYOUT: readonly WidgetKey[] = [
  'my-tasks',
  'waiting-signature',
  'coming-up',
  'my-projects',
  'messages',
  'how-its-going',
];
const OUTSIDE_LAYOUT: readonly WidgetKey[] = ['my-tasks', 'waiting-signature', 'messages'];
const OUTSIDE_ROLES = ['company_qa', 'quality_control', 'production', 'marketing'];

export function layoutFor(roleKey: string): WidgetKey[] {
  const layout = DEFAULT_LAYOUTS[roleKey];
  if (layout) return [...layout];
  return [...(OUTSIDE_ROLES.includes(roleKey) ? OUTSIDE_LAYOUT : TEAM_LAYOUT)];
}

export function mayUseWidget(roleKey: string, key: string): boolean {
  const def = widgetByKey(key);
  if (!def) return false;
  return !def.availableTo || def.availableTo.includes(roleKey);
}
