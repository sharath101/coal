import { writeAuditEntries, type AuditEntry } from '../../modules/audit/service';
import { writeEvents, type EventInput } from '../../modules/events/service';
import type { RequestContext } from '../http/context';
import type { Db, Tx } from './client';

export interface ChangeLog {
  audit(entry: AuditEntry): void;
  event(event: EventInput): void;
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
