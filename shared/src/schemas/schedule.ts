import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import {
  DateOnly,
  HealthEnum,
  HealthReason,
  Id,
  IdParams,
  StepHealthEnum,
  Timestamp,
} from './common';
import { StepStatusEnum } from './projects';

/** One role's dates on one step. */
export const PlanItem = z
  .object({
    stepKey: StepKey,
    roleKey: z.string().min(1).max(60),
    plannedStart: DateOnly,
    plannedEnd: DateOnly,
  })
  .refine((i) => i.plannedStart <= i.plannedEnd, {
    message: 'The end must not be before the start.',
    path: ['plannedEnd'],
  });
export type PlanItem = z.infer<typeof PlanItem>;

export const PlanBody = z.object({ items: z.array(PlanItem).max(300) });

export const ChangeBody = z
  .object({
    stepKey: StepKey,
    roleKey: z.string().min(1).max(60),
    plannedStart: DateOnly,
    plannedEnd: DateOnly,
    reason: z.string().trim().min(3).max(500),
  })
  .refine((i) => i.plannedStart <= i.plannedEnd, {
    message: 'The end must not be before the start.',
    path: ['plannedEnd'],
  });

export const TimelineStep = z.object({
  key: StepKey,
  name: z.string(),
  stage: z.number().int(),
  status: StepStatusEnum,
  plannedStart: DateOnly.nullable(),
  plannedEnd: DateOnly.nullable(),
  forecastStart: DateOnly.nullable(),
  forecastEnd: DateOnly.nullable(),
  health: StepHealthEnum.nullable(),
  daysLate: z.number().int(),
  /** Late and not yet explained: a deviation is due. */
  needsDeviation: z.boolean(),
});
export type TimelineStep = z.infer<typeof TimelineStep>;

export const PlanItemView = z.object({
  id: Id,
  kind: z.enum(['draft', 'baseline', 'change']),
  baselineNo: z.number().int(),
  stepKey: StepKey,
  roleKey: z.string(),
  plannedStart: DateOnly,
  plannedEnd: DateOnly,
  reason: z.string().nullable(),
  recordedBy: z.string(),
  createdAt: Timestamp,
});

export const Timeline = z.object({
  projectId: Id,
  today: DateOnly,
  baselineNo: z.number().int(),
  plannedLaunch: DateOnly.nullable(),
  forecastLaunch: DateOnly.nullable(),
  /** Days the forecast launch is past the planned one (negative: ahead). */
  slipDays: z.number().int().nullable(),
  health: HealthEnum.nullable(),
  healthReasons: z.array(HealthReason),
  /** The step whose sign-off turns the plan into the baseline. */
  planStep: StepKey.nullable(),
  steps: z.array(TimelineStep),
  /** The plan being written; empty once signed. */
  draft: z.array(PlanItemView),
  /** The baseline, then every change, oldest first. */
  items: z.array(PlanItemView),
  can: z.object({
    editPlan: z.boolean(),
    change: z.boolean(),
    /** Changing the launch step's dates also needs the VP. */
    changeLaunch: z.boolean(),
  }),
});
export type Timeline = z.infer<typeof Timeline>;

export const getTimeline = defineEndpoint({
  id: 'timeline.get',
  method: 'GET',
  path: '/projects/{id}/timeline',
  summary: "A project's planned and forecast dates, its baseline and its changes",
  auth: 'session',
  permission: 'timeline.read',
  aiTier: 'read',
  params: IdParams,
  response: Timeline,
});

export const putPlan = defineEndpoint({
  id: 'timeline.putPlan',
  method: 'PUT',
  path: '/projects/{id}/timeline/plan',
  summary:
    'Write the dates for each role on each remaining step, while the Action Plan step is open. The sign-off makes them the baseline',
  auth: 'session',
  permission: 'timeline.plan',
  aiTier: 'confirm',
  params: IdParams,
  body: PlanBody,
  response: Timeline,
});

export const changeDates = defineEndpoint({
  id: 'timeline.change',
  method: 'POST',
  path: '/projects/{id}/timeline/changes',
  summary:
    'Change a planned date after the baseline: the Head, or the VP if the launch moves. Recorded, and the baseline is kept',
  auth: 'session',
  permission: 'timeline.change',
  aiTier: 'confirm',
  params: IdParams,
  body: ChangeBody,
  response: Timeline,
});
