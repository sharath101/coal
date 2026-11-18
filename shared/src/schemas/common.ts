import { z } from 'zod';

/** Every id is a UUIDv7. */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** UTC, ISO 8601. Clients show it in Indian time. */
export const Timestamp = z.iso.datetime({ offset: true });

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
