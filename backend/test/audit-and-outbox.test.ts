import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { change } from '../src/core/db/change';
import { systemContext, type RequestContext } from '../src/core/http/context';
import { runAuditChainCheck } from '../src/jobs';
import { verifyAuditChain } from '../src/modules/audit/service';
import { auditEvents } from '../src/modules/audit/tables';
import {
  OutboxDispatcher,
  startOutboxListener,
  type OutboxEvent,
} from '../src/modules/events/dispatcher';
import { outboxEvents } from '../src/modules/events/tables';
import { createTestDatabase } from './helpers';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.drop();
});

const ctx: RequestContext = {
  ...systemContext('00000000-0000-7000-8000-000000000001'),
  requestId: 'req-1',
};

async function recordSomething(n: number) {
  await change(database.db, ctx, async (_tx, log) => {
    log.audit({
      action: 'test.changed',
      recordType: 'test',
      recordId: `r${n}`,
      after: { n, at: new Date(0) },
    });
    log.event({ type: 'test.changed', payload: { n } });
  });
}

describe('the audit trail', () => {
  it('chains entries, and the chain checks out', async () => {
    await recordSomething(1);
    await recordSomething(2);
    const result = await verifyAuditChain(database.db);
    expect(result).toMatchObject({ ok: true });
    expect(result.checked).toBeGreaterThanOrEqual(2);
  });

  it('records a system actor for changes made by the system', async () => {
    const [row] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recordId, 'r1'));
    expect(row).toMatchObject({ actorType: 'system', actorId: null, requestId: 'req-1' });
  });

  it('refuses to change or remove entries', async () => {
    await expect(database.db.execute(sql`update audit_events set action = 'x'`)).rejects.toThrow();
    await expect(database.db.execute(sql`delete from audit_events`)).rejects.toThrow();
    await expect(database.db.execute(sql`truncate audit_events`)).rejects.toThrow();
  });

  it('saves nothing when the change fails, not even its audit entry or events', async () => {
    const before = await database.db.$count(auditEvents);
    const eventsBefore = await database.db.$count(outboxEvents);
    await expect(
      change(database.db, ctx, async (_tx, log) => {
        log.audit({ action: 'test.failed', recordType: 'test', recordId: 'x' });
        log.event({ type: 'test.failed', payload: {} });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await database.db.$count(auditEvents)).toBe(before);
    expect(await database.db.$count(outboxEvents)).toBe(eventsBefore);
  });

  it('detects an altered entry', async () => {
    // Only a database owner could do this, by switching the guard off.
    await database.db.execute(
      sql`alter table audit_events disable trigger audit_events_insert_only`,
    );
    await database.db.execute(
      sql`update audit_events set after = '{"n": 99}' where record_id = 'r2'`,
    );
    await database.db.execute(
      sql`alter table audit_events enable trigger audit_events_insert_only`,
    );

    const result = await runAuditChainCheck(database.db, pino({ level: 'silent' }));
    expect(result).toMatchObject({ ok: false, problem: 'hash' });
  });
});

describe('the outbox', () => {
  it('delivers events to subscribers and marks them delivered', async () => {
    const seen: OutboxEvent[] = [];
    const dispatcher = new OutboxDispatcher(database.db, [
      { type: 'test.changed', handle: async (e) => void seen.push(e) },
    ]);
    await dispatcher.drain();

    expect(seen.map((e) => e.payload)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(seen[0]).toMatchObject({ actorType: 'system', type: 'test.changed' });
    const pending = await database.db.$count(
      outboxEvents,
      sql`${outboxEvents.deliveredAt} is null`,
    );
    expect(pending).toBe(0);
  });

  it('retries a failed delivery later, keeping the error', async () => {
    await recordSomething(3);
    const dispatcher = new OutboxDispatcher(database.db, [
      {
        type: '*',
        handle: async () => {
          throw new Error('handler down');
        },
      },
    ]);
    await dispatcher.deliverBatch();

    const [row] = await database.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.payload} = '{"n": 3}'::jsonb`);
    expect(row).toMatchObject({ deliveredAt: null, attempts: 1, lastError: 'handler down' });
    expect(row!.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('wakes on NOTIFY when an event is written', async () => {
    const delivered: unknown[] = [];
    const dispatcher = new OutboxDispatcher(database.db, [
      { type: 'test.notified', handle: async (e) => void delivered.push(e.payload) },
    ]);
    const stop = await startOutboxListener(dispatcher, database.url, { pollMs: 60_000 });
    try {
      await change(database.db, ctx, async (_tx, log) => {
        log.event({ type: 'test.notified', payload: { hello: 'world' } });
      });
      await expect.poll(() => delivered, { timeout: 5000 }).toEqual([{ hello: 'world' }]);
    } finally {
      await stop();
    }
  });

  it('reconnects its listener when the database drops the connection', async () => {
    const delivered: unknown[] = [];
    const dispatcher = new OutboxDispatcher(database.db, [
      { type: 'test.reconnected', handle: async (e) => void delivered.push(e.payload) },
    ]);
    const stop = await startOutboxListener(dispatcher, database.url, {
      pollMs: 60_000,
      reconnectMs: 50,
    });
    try {
      const killed = await database.db.execute(
        sql`with listener as materialized (
              select pid from pg_stat_activity
              where datname = current_database() and query = 'LISTEN coal_outbox'
            )
            select count(*) filter (where pg_terminate_backend(pid))::int as n from listener`,
      );
      expect(killed.rows[0]).toEqual({ n: 1 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await change(database.db, ctx, async (_tx, log) => {
        log.event({ type: 'test.reconnected', payload: { again: true } });
      });
      await expect.poll(() => delivered, { timeout: 5000 }).toEqual([{ again: true }]);
    } finally {
      await stop();
    }
  });
});
