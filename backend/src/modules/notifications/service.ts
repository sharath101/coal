import type { MessageKey, Notification, RouteDefinition, StepDefinition } from '@coal/shared';
import { directInputs } from '@coal/shared';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { notFound, validationFailed } from '../../core/http/errors';
import { roleName } from '../rnd/routing';
import { notifications } from './tables';

export type NotificationRow = typeof notifications.$inferSelect;

/** The words a work message can use (docs/dashboard.md#notifications-and-work-messages). */
export interface MessageVars {
  project: string;
  project_name: string;
  step: string;
  step_name: string;
  team: string;
  signer: string;
  due: string;
  inputs: string;
  person: string;
  days: string;
  decision: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-27` → `27 Nov`. */
export function shortDate(date: string | null): string {
  if (!date) return 'a date to be set';
  const [, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]}`;
}

/** Fills the template of the route with the words it uses. Unknown or missing words become empty. */
export function renderMessage(
  route: RouteDefinition,
  key: MessageKey,
  vars: Partial<MessageVars>,
): string {
  return route.messages[key]
    .replace(/\{([a-z_]+)\}/g, (_, word: string) => vars[word as keyof MessageVars] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a step contributes to a message: its name, who signs it and what it takes as input. */
export function stepVars(
  route: RouteDefinition,
  step: StepDefinition,
  project: { code: string; name: string },
  lineName: string,
): Partial<MessageVars> {
  const inputs = directInputs(route, step).flatMap(
    (key) => route.steps.find((s) => s.key === key)?.outputs ?? [],
  );
  return {
    project: project.code,
    project_name: project.name,
    step: step.key,
    step_name: step.name,
    team: `the ${lineName} Lead`,
    signer: step.signer ? `The ${roleName(step.signer)}` : 'Nobody',
    inputs: inputs.length > 0 ? inputs.join('; ') : 'none',
  };
}

export interface NewNotification {
  userId: string;
  kind: NotificationRow['kind'];
  eventType: string;
  title: string;
  body: string;
  link?: string | null;
  projectId?: string | null;
  stepKey?: string | null;
  dedupeKey?: string | null;
}

/**
 * Sends in-app notifications. A repeat of the same `dedupeKey` to the same person is skipped.
 * Open clients are told to fetch them, through the database's NOTIFY, once the change commits.
 */
export async function notify(tx: Tx, orgId: string, inputs: NewNotification[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const rows = await tx
    .insert(notifications)
    .values(
      inputs.map((n) => ({
        orgId,
        userId: n.userId,
        kind: n.kind,
        eventType: n.eventType,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        projectId: n.projectId ?? null,
        stepKey: n.stepKey ?? null,
        dedupeKey: n.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: notifications.userId });
  if (rows.length > 0) {
    const userIds = [...new Set(rows.map((r) => r.userId))];
    await sendLiveHint(tx, { type: 'notification', userIds });
  }
  return rows.length;
}

export interface LiveMessage {
  type: 'notification' | 'widgets';
  /** Only these people hear it. Absent: everyone connected. */
  userIds?: string[];
  keys?: string[];
}

/** Tells every API copy's open streams to pass a hint on (delivered when the transaction commits). */
export async function sendLiveHint(tx: Tx, message: LiveMessage): Promise<void> {
  await tx.execute(sql`select pg_notify('coal_live', ${JSON.stringify(message)})`);
}

const present = (row: NotificationRow): Notification => ({
  id: row.id,
  kind: row.kind,
  eventType: row.eventType,
  title: row.title,
  body: row.body,
  link: row.link,
  projectId: row.projectId,
  stepKey: row.stepKey,
  sentAt: row.sentAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

const encodeCursor = (row: NotificationRow) =>
  Buffer.from(JSON.stringify([row.sentAt.toISOString(), row.id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') {
      return [value[0], value[1]];
    }
  } catch {
    // fall through
  }
  throw validationFailed('The cursor is not valid.', 'cursor');
}

export async function unreadCount(ex: Executor, orgId: string, userId: string): Promise<number> {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

export async function listNotifications(
  ex: Executor,
  orgId: string,
  userId: string,
  query: { cursor?: string | undefined; limit: number; unreadOnly: boolean },
) {
  const conditions: SQL[] = [eq(notifications.orgId, orgId), eq(notifications.userId, userId)];
  if (query.unreadOnly) conditions.push(isNull(notifications.readAt));
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(notifications.sentAt)}, ${notifications.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(msOf(notifications.sentAt)), desc(notifications.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(present),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    unread: await unreadCount(ex, orgId, userId),
  };
}

export async function findNotification(
  ex: Executor,
  orgId: string,
  id: string,
): Promise<NotificationRow | null> {
  const [row] = await ex
    .select()
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.id, id)));
  return row ?? null;
}

export async function markRead(tx: Tx, orgId: string, id: string): Promise<Notification> {
  const [row] = await tx
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.orgId, orgId), eq(notifications.id, id)))
    .returning();
  if (!row) throw notFound('notification');
  return present(row);
}

export async function markAllRead(tx: Tx, orgId: string, userId: string): Promise<number> {
  const rows = await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

/** The latest notifications of one person, for the Messages widget. */
export async function recentNotifications(
  ex: Executor,
  orgId: string,
  userId: string,
  options: { limit: number; unreadOnly: boolean },
) {
  return listNotifications(ex, orgId, userId, {
    limit: options.limit,
    unreadOnly: options.unreadOnly,
  });
}
