import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { WIDGET_KEYS, WIDGETS } from '../widgets/definitions';
import { Id, Timestamp } from './common';

export const Tone = z.enum(['neutral', 'good', 'warning', 'danger']);
export type Tone = z.infer<typeof Tone>;

const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** One line of a widget: a task, a project, a person, a notification. */
export const WidgetRow = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** A path on the website that the row opens. */
  link: z.string().nullable(),
  tone: Tone,
  badges: z.array(z.object({ label: z.string(), tone: Tone })),
  /** The values of the expanded table's columns, by column key. */
  cells: z.record(z.string(), Cell),
  /** What the viewer may do with the row now (action keys of the widget). */
  actions: z.array(z.string()),
  ref: z.object({
    taskId: Id.optional(),
    requestId: Id.optional(),
    projectId: Id.optional(),
    stepKey: z.string().optional(),
    notificationId: Id.optional(),
    userId: Id.optional(),
  }),
});
export type WidgetRow = z.infer<typeof WidgetRow>;

export const WidgetCount = z.object({
  key: z.string(),
  /** Null where there is nothing to measure yet, such as a rate with no finished tasks. */
  value: z.number().nullable(),
  tone: Tone,
});

export const WidgetData = z.object({
  key: z.enum(WIDGET_KEYS),
  view: z.enum(['compact', 'expanded']),
  asOf: Timestamp,
  /** The headline numbers of the compact card. */
  counts: z.array(WidgetCount),
  /** The top few rows in the compact view; the whole tab in the expanded view. */
  rows: z.array(WidgetRow),
  tabs: z.array(z.object({ key: z.string(), count: z.number().int() })),
  tab: z.string().nullable(),
  /** Rows in the tab before the limit. */
  total: z.number().int(),
});
export type WidgetData = z.infer<typeof WidgetData>;

export const WidgetInfo = z.object({
  key: z.enum(WIDGET_KEYS),
  no: z.string(),
  title: z.string(),
  question: z.enum(['needs_me', 'coming', 'how']),
  tabs: z.array(z.string()),
  filters: z.array(z.string()),
  columns: z.array(z.string()),
  actions: z.array(z.string()),
  refreshOn: z.array(z.string()),
});

export const WidgetKeyParams = z.object({ key: z.enum(WIDGET_KEYS) });

export const WidgetQuery = z.object({
  view: z.enum(['compact', 'expanded']).default('compact'),
  tab: z.string().max(40).optional(),
  'filter[project]': z.string().max(80).optional(),
  'filter[step]': z.string().max(10).optional(),
  'filter[kind]': z.string().max(40).optional(),
  'filter[due]': z.string().max(20).optional(),
  'filter[line]': z.string().max(80).optional(),
  'filter[stage]': z.string().max(10).optional(),
  'filter[health]': z.string().max(10).optional(),
});

export const listWidgets = defineEndpoint({
  id: 'widgets.list',
  method: 'GET',
  path: '/widgets',
  summary: 'The widgets I can use, and my layout: the keys in order',
  auth: 'session',
  permission: 'widgets.read',
  aiTier: 'read',
  response: z.object({ layout: z.array(z.enum(WIDGET_KEYS)), widgets: z.array(WidgetInfo) }),
});

export const getWidget = defineEndpoint({
  id: 'widgets.get',
  method: 'GET',
  path: '/widgets/{key}',
  summary:
    "One widget's data, counting only what I may see. Compact for the card, expanded for the panel",
  auth: 'session',
  permission: 'widgets.read',
  aiTier: 'read',
  params: WidgetKeyParams,
  query: WidgetQuery,
  response: WidgetData,
});

/** The definitions as the API lists them. */
export const WIDGET_INFOS = WIDGETS.map((w) => ({
  key: w.key,
  no: w.no,
  title: w.title,
  question: w.question,
  tabs: [...w.tabs],
  filters: [...w.filters],
  columns: [...w.columns],
  actions: [...w.actions],
  refreshOn: [...w.refreshOn],
}));
