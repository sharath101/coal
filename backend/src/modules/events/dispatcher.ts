import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Db, Tx } from '../../core/db/client';
import { outboxEvents } from './tables';

export type OutboxEvent = typeof outboxEvents.$inferSelect;

/**
 * Handles one event. Runs inside the delivery transaction, so database writes it makes
 * (notifications, for example) commit together with marking the event delivered.
 * Handlers must be safe to run twice.
 */
export type EventHandler = (event: OutboxEvent, tx: Tx) => Promise<void>;

export interface Subscription {
  /** An event type, or `*` for every event. */
  type: string;
  handle: EventHandler;
}

const MAX_BACKOFF_MS = 15 * 60 * 1000;
export const retryDelayMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);

/** Delivers outbox events to subscribers (docs/architecture.md#events-and-live-updates). */
export class OutboxDispatcher {
  constructor(
    private readonly db: Db,
    private readonly subscriptions: Subscription[],
    private readonly log?: Logger,
  ) {}

  /** Delivers up to `limit` due events. Returns how many were claimed. */
  async deliverBatch(limit = 50): Promise<number> {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.deliveredAt), lte(outboxEvents.availableAt, new Date())))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });

      for (const event of due) {
        try {
          await tx.transaction(async (savepoint) => {
            for (const sub of this.subscriptions) {
              if (sub.type === '*' || sub.type === event.type) await sub.handle(event, savepoint);
            }
          });
          await tx
            .update(outboxEvents)
            .set({ deliveredAt: new Date(), attempts: event.attempts + 1, lastError: null })
            .where(eq(outboxEvents.id, event.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log?.warn(
            { eventId: event.id, type: event.type, err: message },
            'event delivery failed',
          );
          await tx
            .update(outboxEvents)
            .set({
              attempts: event.attempts + 1,
              lastError: message.slice(0, 1000),
              availableAt: new Date(Date.now() + retryDelayMs(event.attempts + 1)),
            })
            .where(eq(outboxEvents.id, event.id));
        }
      }
      return due.length;
    });
  }

  /** Delivers until nothing is due. */
  async drain(limit = 50): Promise<void> {
    while ((await this.deliverBatch(limit)) === limit) {
      /* keep going */
    }
  }
}

/**
 * Wakes the dispatcher on NOTIFY coal_outbox (sent by a trigger on insert), and polls as a
 * fallback. With several backend copies, each one's listener receives the notification.
 * The listener has its own connection, outside the pool, because it stays open.
 */
export async function startOutboxListener(
  dispatcher: OutboxDispatcher,
  databaseUrl: string,
  options: { pollMs: number; log?: Logger; reconnectMs?: number },
) {
  let running = false;
  let again = false;
  let stopped = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await dispatcher.drain();
      } while (again);
    } catch (error) {
      options.log?.error({ err: error }, 'outbox delivery stopped');
    } finally {
      running = false;
    }
  };

  // The connection can drop (a database restart, a network timeout). Polling keeps events
  // moving meanwhile, and the listener reconnects with growing gaps.
  const firstDelay = options.reconnectMs ?? 1000;
  let client: pg.Client | null = null;
  let retryTimer: NodeJS.Timeout | undefined;
  const retry = (delay: number) => {
    if (!stopped) retryTimer = setTimeout(() => void listen(Math.min(delay * 2, 30_000)), delay);
  };

  const listen = async (delay: number): Promise<void> => {
    const connection = new pg.Client({ connectionString: databaseUrl });
    connection.on('notification', () => void run());
    connection.on('error', (error) => {
      if (client !== connection) return;
      options.log?.warn({ err: error }, 'outbox listener lost its connection');
      client = null;
      void connection.end().catch(() => undefined);
      retry(firstDelay);
    });
    try {
      await connection.connect();
      await connection.query('LISTEN coal_outbox');
    } catch (error) {
      options.log?.warn({ err: error }, 'outbox listener could not connect');
      void connection.end().catch(() => undefined);
      retry(delay);
      return;
    }
    if (stopped) {
      await connection.end().catch(() => undefined);
      return;
    }
    client = connection;
    void run();
  };

  await listen(firstDelay);
  const timer = setInterval(() => void run(), options.pollMs);

  return async function stop() {
    stopped = true;
    clearInterval(timer);
    clearTimeout(retryTimer);
    const connection = client;
    client = null;
    await connection?.end().catch(() => undefined);
    while (running) await new Promise((resolve) => setTimeout(resolve, 10));
  };
}
