import type { StreamHint } from '@coal/shared';
import pg from 'pg';
import type { Logger } from 'pino';
import type { LiveMessage } from './service';

interface Client {
  userId: string;
  send: (hint: StreamHint) => void;
  /** Ends the stream, when the server shuts down. */
  close: () => void;
}

/**
 * The open live streams of this API copy (docs/architecture.md#events-and-live-updates).
 * Messages arrive through the database's LISTEN/NOTIFY, so every copy hears every message and
 * passes it to its own clients. The connection that listens opens when the first client arrives.
 */
export class LiveHub {
  private readonly clients = new Set<Client>();
  private listener: pg.Client | null = null;
  private starting: Promise<void> | null = null;
  private retry: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly databaseUrl: string,
    private readonly log?: Logger,
  ) {}

  /** Adds a client. Returns how to remove it. */
  add(client: Client): () => void {
    this.clients.add(client);
    void this.ensureListening();
    return () => this.clients.delete(client);
  }

  get size(): number {
    return this.clients.size;
  }

  /** Passes a message to the clients it is for. */
  broadcast(message: LiveMessage): void {
    const hint: StreamHint =
      message.type === 'widgets'
        ? { type: 'widgets', keys: message.keys ?? [] }
        : { type: 'notification' };
    for (const client of this.clients) {
      if (!message.userIds || message.userIds.includes(client.userId)) client.send(hint);
    }
  }

  private ensureListening(): Promise<void> {
    if (this.listener || this.closed) return Promise.resolve();
    this.starting ??= this.listen().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async listen(): Promise<void> {
    const connection = new pg.Client({ connectionString: this.databaseUrl });
    connection.on('notification', (n) => {
      try {
        this.broadcast(JSON.parse(n.payload ?? '{}') as LiveMessage);
      } catch {
        // A message that isn't ours is ignored.
      }
    });
    connection.on('error', (error) => {
      if (this.listener !== connection) return;
      this.log?.warn({ err: error }, 'live stream listener lost its connection');
      this.listener = null;
      void connection.end().catch(() => undefined);
      this.scheduleRetry();
    });
    try {
      await connection.connect();
      await connection.query('LISTEN coal_live');
    } catch (error) {
      this.log?.warn({ err: error }, 'live stream listener could not connect');
      void connection.end().catch(() => undefined);
      this.scheduleRetry();
      return;
    }
    if (this.closed) {
      await connection.end().catch(() => undefined);
      return;
    }
    this.listener = connection;
  }

  private scheduleRetry(): void {
    if (this.closed || this.clients.size === 0) return;
    this.retry = setTimeout(() => void this.ensureListening(), 2000);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.retry);
    for (const client of this.clients) client.close();
    this.clients.clear();
    const connection = this.listener;
    this.listener = null;
    await connection?.end().catch(() => undefined);
  }
}
