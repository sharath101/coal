import { z } from 'zod';

/** Every id is a UUIDv7. */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** UTC, ISO 8601. Clients show it in Indian time. */
export const Timestamp = z.iso.datetime({ offset: true });

/** A calendar day in Indian time, `YYYY-MM-DD`. */
export const DateOnly = z.iso.date();

export const StepHealthEnum = z.enum(['ok', 'at_risk', 'overdue']);
export const HealthEnum = z.enum(['green', 'amber', 'red']);

/** Why a project is amber or red (docs/dashboard.md#health). */
export const HealthReason = z.object({
  code: z.enum([
    'checkpoint_overdue',
    'launch_slipped',
    'step_far_overdue',
    'step_overdue',
    'step_at_risk',
  ]),
  step: z.string().optional(),
  days: z.number().int().optional(),
});
export type HealthReason = z.infer<typeof HealthReason>;

export const PageQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const IdParams = z.object({ id: Id });
