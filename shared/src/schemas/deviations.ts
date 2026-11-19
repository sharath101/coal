import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import { DateOnly, Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Person, RoleRef } from './projects';

export const DEVIATION_KINDS = ['late', 'forecast_slip', 'rework'] as const;
export const DEVIATION_REASONS = [
  'waiting_for_step',
  'vendor_delay',
  'test_lab_delay',
  'rework',
  'person_unavailable',
  'scope_change',
  'other',
] as const;
export const CAUSE_TYPES = ['person', 'role', 'outside'] as const;

export const RecordDeviationBody = z
  .object({
    taskId: Id,
    reasonCode: z.enum(DEVIATION_REASONS),
    reasonText: z.string().trim().min(3).max(1000),
    causeType: z.enum(CAUSE_TYPES),
    causeUserId: Id.optional(),
    causeRole: z.string().max(60).optional(),
    causeParty: z.string().trim().max(120).optional(),
    /** The new expected date. */
    newDate: DateOnly,
  })
  .superRefine((b, ctx) => {
    const missing =
      (b.causeType === 'person' && !b.causeUserId && 'causeUserId') ||
      (b.causeType === 'role' && !b.causeRole && 'causeRole') ||
      (b.causeType === 'outside' && !b.causeParty && 'causeParty');
    if (missing) {
      ctx.addIssue({ code: 'custom', path: [missing], message: 'Say who or what caused it.' });
    }
  });

export const ReviewDeviationBody = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('confirmed'), note: z.string().trim().max(500).default('') }),
  z.object({
    outcome: z.literal('corrected'),
    note: z.string().trim().max(500).default(''),
    reasonCode: z.enum(DEVIATION_REASONS),
    reasonText: z.string().trim().min(3).max(1000),
    causeType: z.enum(CAUSE_TYPES),
    causeUserId: Id.optional(),
    causeRole: z.string().max(60).optional(),
    causeParty: z.string().trim().max(120).optional(),
    newDate: DateOnly,
  }),
]);

export const DeviationCause = z.object({
  type: z.enum(CAUSE_TYPES),
  /** The role or department, shown to everyone. */
  role: RoleRef.nullable(),
  /** The person or party by name, only to those allowed (docs/roles-and-access.md#content-is-need-to-know). */
  name: z.string().nullable(),
  /** Whether the viewer is allowed to see the name. */
  named: z.boolean(),
});

export const DeviationReview = z.object({
  outcome: z.enum(['confirmed', 'corrected']),
  reviewer: Person,
  note: z.string(),
  at: Timestamp,
  correctedBy: Id.nullable(),
});

export const DeviationComment = z.object({
  id: Id,
  user: Person,
  body: z.string(),
  at: Timestamp,
});

export const Deviation = z.object({
  id: Id,
  project: z.object({ id: Id, code: z.string(), name: z.string() }),
  stepKey: StepKey.nullable(),
  taskId: Id.nullable(),
  taskTitle: z.string().nullable(),
  kind: z.enum(DEVIATION_KINDS),
  plannedDate: DateOnly.nullable(),
  newDate: DateOnly.nullable(),
  reasonCode: z.enum(DEVIATION_REASONS),
  /** The sentence of explanation: only for people in the project's scope. */
  reasonText: z.string().nullable(),
  cause: DeviationCause,
  recordedBy: Person,
  createdAt: Timestamp,
  review: DeviationReview.nullable(),
  /** The deviation this one corrects, and the one that corrected it. */
  corrects: Id.nullable(),
  correctedBy: Id.nullable(),
  comments: z.array(DeviationComment),
  can: z.object({ review: z.boolean(), comment: z.boolean() }),
});
export type Deviation = z.infer<typeof Deviation>;

export const DeviationsQuery = PageQuery.extend({
  'filter[project]': Id.optional(),
  /** `review`: waiting for the next role up. */
  'filter[state]': z.enum(['all', 'review']).default('all'),
});

export const listDeviations = defineEndpoint({
  id: 'deviations.list',
  method: 'GET',
  path: '/deviations',
  summary: 'Deviations, with the named cause shown only to those allowed to see it',
  auth: 'session',
  permission: 'deviations.read',
  aiTier: 'read',
  query: DeviationsQuery,
  response: pageOf(Deviation),
});

export const recordDeviation = defineEndpoint({
  id: 'deviations.record',
  method: 'POST',
  path: '/deviations',
  summary: 'Record why work is late or will be: the reason, the cause and the new expected date',
  auth: 'session',
  permission: 'deviations.record',
  aiTier: 'confirm',
  body: RecordDeviationBody,
  response: Deviation,
  status: 201,
});

export const reviewDeviation = defineEndpoint({
  id: 'deviations.review',
  method: 'POST',
  path: '/deviations/{id}/review',
  summary:
    'The next role up confirms a deviation, or corrects it (a new record that points at the old)',
  auth: 'session',
  permission: 'deviations.review',
  aiTier: 'confirm',
  params: IdParams,
  body: ReviewDeviationBody,
  response: Deviation,
});

export const commentDeviation = defineEndpoint({
  id: 'deviations.comment',
  method: 'POST',
  path: '/deviations/{id}/comments',
  summary: 'The person or role named as the cause adds a comment',
  auth: 'session',
  permission: 'deviations.comment',
  aiTier: 'confirm',
  params: IdParams,
  body: z.object({ body: z.string().trim().min(1).max(1000) }),
  response: Deviation,
  status: 201,
});
