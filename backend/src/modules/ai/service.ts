import {
  chatFileKind,
  dateOfInstant,
  type Chat,
  type ChatContext,
  type ChatMessage,
  type MessagePart,
} from '@coal/shared';
import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { aiChats, aiFeedback, aiMessages, aiRequests, aiToolCalls, aiWebLookups } from './tables';

export type ChatRow = typeof aiChats.$inferSelect;
export type MessageRow = typeof aiMessages.$inferSelect;

export const presentChat = (row: ChatRow): Chat => ({
  id: row.id,
  title: row.title,
  channel: row.channel,
  context: row.context,
  hasOutsideText: row.hasOutsideText,
  webOn: row.webOn,
  usedWeb: row.usedWeb,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The assistant can look things up on the web here: switched on, and a provider with a web search
 * (docs/workstation-and-ai.md#looking-things-up-on-the-web).
 */
export const webAvailable = (deps: Pick<AppDeps, 'config' | 'ai'>): boolean =>
  deps.config.ai.web.enabled && !!deps.ai?.lookUpWeb;

/** The person's Web switch for a chat. */
export async function setWebOn(ex: Executor, id: string, on: boolean): Promise<void> {
  await ex.update(aiChats).set({ webOn: on }).where(eq(aiChats.id, id));
}

/** The words of a web report, which a card may carry into a document once the person has checked them. */
export const reportText = (report: (typeof aiWebLookups.$inferSelect)['report']): string =>
  [report.answer, ...report.findings, ...report.notFound, ...report.cautions].join('\n');

/** What the web returned in a chat so far, as text. */
export async function webFoundInChat(ex: Executor, chatId: string): Promise<string> {
  const rows = await ex
    .select({ report: aiWebLookups.report })
    .from(aiWebLookups)
    .where(eq(aiWebLookups.chatId, chatId))
    .orderBy(asc(aiWebLookups.createdAt));
  return rows.map((r) => reportText(r.report)).join('\n');
}

export const presentMessage = (
  row: MessageRow,
  feedback: 'up' | 'down' | null = null,
): ChatMessage => ({
  id: row.id,
  sender: row.sender,
  parts: row.parts,
  stopped: row.stopped,
  feedback,
  createdAt: row.createdAt.toISOString(),
});

export async function insertChat(
  tx: Tx,
  input: { orgId: string; userId: string; runId: string | null; context: ChatContext },
): Promise<ChatRow> {
  const [row] = await tx.insert(aiChats).values(input).returning();
  return row as ChatRow;
}

export async function findChat(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ChatRow | null> {
  const query = ex
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.orgId, orgId), eq(aiChats.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function requireChat(ex: Executor, orgId: string, id: string): Promise<ChatRow> {
  const row = await findChat(ex, orgId, id);
  if (!row) throw notFound('chat');
  return row;
}

export async function insertMessage(
  ex: Executor,
  input: {
    orgId: string;
    chatId: string;
    sender: 'user' | 'assistant';
    parts: MessagePart[];
    requestId?: string | null;
    stopped?: boolean;
  },
): Promise<MessageRow> {
  const [row] = await ex.insert(aiMessages).values(input).returning();
  return row as MessageRow;
}

/** The latest messages of a chat, oldest first. */
export async function recentMessages(
  ex: Executor,
  chatId: string,
  limit: number,
): Promise<MessageRow[]> {
  if (limit <= 0) return [];
  const rows = await ex
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.chatId, chatId))
    .orderBy(desc(msOf(aiMessages.createdAt)), desc(aiMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** The person's rating of each message, for the messages shown. */
export async function feedbackFor(
  ex: Executor,
  userId: string,
  messageIds: string[],
): Promise<Map<string, 'up' | 'down'>> {
  if (messageIds.length === 0) return new Map();
  const rows = await ex
    .select({ messageId: aiFeedback.messageId, rating: aiFeedback.rating })
    .from(aiFeedback)
    .where(and(eq(aiFeedback.userId, userId), inArray(aiFeedback.messageId, messageIds)));
  return new Map(rows.map((r) => [r.messageId, r.rating]));
}

export async function findMessage(
  ex: Executor,
  orgId: string,
  id: string,
): Promise<MessageRow | null> {
  const [row] = await ex
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.orgId, orgId), eq(aiMessages.id, id)));
  return row ?? null;
}

export async function saveFeedback(
  tx: Tx,
  input: {
    orgId: string;
    messageId: string;
    userId: string;
    rating: 'up' | 'down';
    comment: string | null;
  },
): Promise<void> {
  await tx
    .insert(aiFeedback)
    .values(input)
    .onConflictDoUpdate({
      target: [aiFeedback.messageId, aiFeedback.userId],
      set: { rating: input.rating, comment: input.comment, updatedAt: new Date() },
    });
}

/**
 * How a file on a message is told to the model: a picture is shown with the message, a document is
 * read with `read_attachment` using the id.
 */
export const attachedLine = (name: string, fileId: string): string =>
  `[Attached ${chatFileKind(name) === 'image' ? 'picture' : 'file'}: ${name}, file id ${fileId}]`;

/** The text of a message, without the source tags, for showing the model what was said. */
export const plainText = (parts: MessagePart[]): string =>
  parts
    .flatMap((p) =>
      p.type === 'text' ? [p.text] : p.type === 'file' ? [attachedLine(p.name, p.fileId)] : [],
    )
    .join('\n\n')
    .replace(/\s*\[S\d+\]/g, '')
    .trim();

/** The files attached to the messages of a chat: what the assistant may read in it. */
export async function attachedFileIds(ex: Executor, chatId: string): Promise<Set<string>> {
  const rows = await ex
    .select({ parts: aiMessages.parts })
    .from(aiMessages)
    .where(and(eq(aiMessages.chatId, chatId), eq(aiMessages.sender, 'user')));
  return new Set(
    rows.flatMap((r) => r.parts.flatMap((p) => (p.type === 'file' ? [p.fileId] : []))),
  );
}

export async function touchChat(tx: Tx, id: string, title?: string): Promise<void> {
  await tx
    .update(aiChats)
    .set({ updatedAt: new Date(), ...(title && { title }) })
    .where(eq(aiChats.id, id));
}

/** A file from outside is in the chat: from now on the assistant only prepares action cards. Never unset. */
export async function markOutsideText(ex: Executor, id: string): Promise<void> {
  await ex.update(aiChats).set({ hasOutsideText: true }).where(eq(aiChats.id, id));
}

export async function setTitle(ex: Executor, id: string, title: string): Promise<void> {
  await ex.update(aiChats).set({ title }).where(eq(aiChats.id, id));
}

// Listing

const encodeCursor = (row: ChatRow) =>
  Buffer.from(JSON.stringify([row.updatedAt.toISOString(), row.id])).toString('base64url');

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

/** A person's chats, most recently used first. */
export async function listChats(
  ex: Executor,
  orgId: string,
  userId: string,
  query: { cursor?: string | undefined; limit: number; runId?: string | undefined },
): Promise<{ items: Chat[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(aiChats.orgId, orgId), eq(aiChats.userId, userId)];
  if (query.runId) conditions.push(eq(aiChats.runId, query.runId));
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(aiChats.updatedAt)}, ${aiChats.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(aiChats)
    .where(and(...conditions))
    .orderBy(desc(msOf(aiChats.updatedAt)), desc(aiChats.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(presentChat),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

// Budget

/** What the person has spent on the AI today (Indian time), in US dollars. */
export async function spentToday(
  ex: Executor,
  orgId: string,
  userId: string,
  now: Date,
): Promise<number> {
  const dayStart = new Date(`${dateOfInstant(now)}T00:00:00+05:30`);
  const [row] = await ex
    .select({ total: sql<string>`coalesce(sum(${aiRequests.costUsd}), 0)` })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.orgId, orgId),
        eq(aiRequests.userId, userId),
        gte(aiRequests.createdAt, dayStart),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function assertWithinBudget(
  ex: Executor,
  orgId: string,
  userId: string,
  now: Date,
  limitUsd: number,
): Promise<void> {
  if ((await spentToday(ex, orgId, userId, now)) >= limitUsd) {
    throw new AppError(
      429,
      'AI_BUDGET_REACHED',
      'You have used today’s AI budget. It starts again tomorrow (Indian time).',
    );
  }
}

// Logs

export interface RequestLog {
  id: string;
  orgId: string;
  chatId: string | null;
  userId: string;
  provider: string;
  model: string;
  purpose: string;
  promptVersion: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outcome: 'completed' | 'stopped' | 'error';
  errorCode: string | null;
  durationMs: number;
}

export interface ToolCallLog {
  tool: string;
  endpoint: string;
  tier: string;
  allowed: boolean;
  denialReason: string | null;
  input: unknown;
  recordsReturned: { type: string; id: string; version?: number }[];
  proposalId: string | null;
  durationMs: number;
}

/** Writes a request and its tool calls (both insert-only), in the caller's transaction. */
export async function logRequest(tx: Tx, request: RequestLog, calls: ToolCallLog[]): Promise<void> {
  await tx.insert(aiRequests).values({ ...request, costUsd: request.costUsd.toFixed(6) });
  if (calls.length > 0) {
    await tx
      .insert(aiToolCalls)
      .values(calls.map((c) => ({ ...c, orgId: request.orgId, requestId: request.id })));
  }
}
