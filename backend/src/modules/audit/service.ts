import { createHash } from 'node:crypto';
import { asc, desc, gt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../core/db/client';
import { newId } from '../../core/db/columns';
import type { RequestContext } from '../../core/http/context';
import { auditEvents } from './tables';

export type ActorType = 'user' | 'user_via_ai' | 'system';

export interface AuditEntry {
  /** What happened, such as `user.signed_up` or `file.uploaded`. */
  action: string;
  recordType: string;
  recordId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Only when the actor isn't the request's own, such as a new account signing itself up. */
  actor?: { type: ActorType; id: string | null };
}

export const GENESIS_HASH = '0'.repeat(64);
/** Serialises writers so the chain has one order. Held only while the entries are written. */
const AUDIT_CHAIN_LOCK = 7_400_001;

export function actorOf(ctx: RequestContext): { type: ActorType; id: string | null } {
  if (!ctx.actor) return { type: 'system', id: null };
  return { type: ctx.viaAi ? 'user_via_ai' : 'user', id: ctx.actor.userId };
}

/** JSON with sorted keys, so the same content always gives the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

interface HashedFields {
  id: string;
  orgId: string;
  at: Date;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  recordType: string;
  recordId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  prevHash: string;
}

export function hashEntry(e: HashedFields): string {
  const content = canonicalJson({ ...e, at: e.at.toISOString() });
  return createHash('sha256').update(content).digest('hex');
}

/** Stores values the way jsonb will return them, so the hash can be re-checked later. */
const asStored = (value: unknown) =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);

/** Writes entries at the end of a change's transaction (see core/db/change.ts). */
export async function writeAuditEntries(tx: Tx, ctx: RequestContext, entries: AuditEntry[]) {
  if (entries.length === 0) return;
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
  const [last] = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);

  let prevHash = last?.hash ?? GENESIS_HASH;
  const at = new Date();
  for (const entry of entries) {
    const actor = entry.actor ?? actorOf(ctx);
    const fields: HashedFields = {
      id: newId(),
      orgId: ctx.orgId,
      at,
      actorType: actor.type,
      actorId: actor.id,
      action: entry.action,
      recordType: entry.recordType,
      recordId: entry.recordId,
      before: asStored(entry.before),
      after: asStored(entry.after),
      reason: entry.reason ?? null,
      requestId: ctx.requestId,
      prevHash,
    };
    const hash = hashEntry(fields);
    await tx.insert(auditEvents).values({ ...fields, hash });
    prevHash = hash;
  }
}

export type ChainCheck =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAtSeq: number; problem: 'prev_hash' | 'hash' };

/** Walks the whole chain. Run daily by a job (docs/architecture.md#background-jobs). */
export async function verifyAuditChain(db: Db, batchSize = 1000): Promise<ChainCheck> {
  let prevHash = GENESIS_HASH;
  let afterSeq = 0;
  let checked = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(gt(auditEvents.seq, afterSeq))
      .orderBy(asc(auditEvents.seq))
      .limit(batchSize);
    if (rows.length === 0) return { ok: true, checked };

    for (const row of rows) {
      if (row.prevHash !== prevHash) {
        return { ok: false, checked, brokenAtSeq: row.seq, problem: 'prev_hash' };
      }
      const { seq: _seq, hash, createdAt: _createdAt, ...fields } = row;
      if (hashEntry(fields) !== hash) {
        return { ok: false, checked, brokenAtSeq: row.seq, problem: 'hash' };
      }
      prevHash = hash;
      afterSeq = row.seq;
      checked += 1;
    }
  }
}
