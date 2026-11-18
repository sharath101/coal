import { writeAuditEntries, type AuditEntry } from '../../modules/audit/service';
import { writeEvents, type EventInput } from '../../modules/events/service';
import type { RequestContext } from '../http/context';
import type { Db, Tx } from './client';

export interface ChangeLog {
  audit(entry: AuditEntry): void;
  event(event: EventInput): void;
}

/**
 * Runs the same change as `change`, but when `preview` is set it rolls everything back at the
 * end and returns what it would have done. A preview therefore can't drift from the real thing:
 * it is the real code path, minus the commit (docs/architecture.md#the-process-engine).
 */
export async function previewable<T>(
  db: Db,
  ctx: RequestContext,
  preview: boolean,
  fn: (tx: Tx, log: ChangeLog) => Promise<T>,
): Promise<T> {
  if (!preview) return change(db, ctx, fn);
  const outcome: { value?: T } = {};
  const rollback = new Error('preview');
  try {
    await db.transaction(async (tx) => {
      outcome.value = await fn(tx, { audit: () => undefined, event: () => undefined });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return outcome.value as T;
}

/**
 * Runs a change in one transaction, and writes its audit entries and events in that same
 * transaction (docs/data-model.md#conventions). If they can't be written, nothing is saved.
 */
export async function change<T>(
  db: Db,
  ctx: RequestContext,
  fn: (tx: Tx, log: ChangeLog) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const audits: AuditEntry[] = [];
    const events: EventInput[] = [];
    const result = await fn(tx, {
      audit: (entry) => audits.push(entry),
      event: (event) => events.push(event),
    });
    await writeEvents(tx, ctx, events);
    await writeAuditEntries(tx, ctx, audits);
    return result;
  });
}
