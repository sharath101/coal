import type { ActionPreview, Proposal, ProposalAction } from '@coal/shared';
import { and, desc, eq, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { validationFailed } from '../../core/http/errors';
import { proposals } from './tables';

export type ProposalRow = typeof proposals.$inferSelect;
type Status = ProposalRow['status'];

/** A pending proposal past its time is expired, whether or not anything has marked it yet. */
export const statusOf = (row: ProposalRow, now: Date): Status =>
  row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status;

export function presentProposal(row: ProposalRow, now: Date): Proposal {
  return {
    id: row.id,
    version: row.version,
    status: statusOf(row, now),
    title: row.title,
    chatId: row.chatId,
    preparedByAi: row.preparedByAi,
    actions: row.actions,
    preview: row.preview,
    expiresAt: row.expiresAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function insertProposal(
  tx: Tx,
  input: {
    orgId: string;
    forUserId: string;
    chatId: string | null;
    preparedByAi: boolean;
    title: string;
    actions: ProposalAction[];
    preview: ActionPreview[];
    expiresAt: Date;
  },
): Promise<ProposalRow> {
  const [row] = await tx
    .insert(proposals)
    .values({ ...input, preview: { actions: input.preview } })
    .returning();
  return row as ProposalRow;
}

export async function findProposal(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ProposalRow | null> {
  const query = ex
    .select()
    .from(proposals)
    .where(and(eq(proposals.orgId, orgId), eq(proposals.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function updateProposalRow(
  tx: Tx,
  id: string,
  set: Partial<
    Pick<
      ProposalRow,
      'title' | 'actions' | 'preview' | 'version' | 'status' | 'confirmedAt' | 'result'
    >
  >,
  now: Date,
): Promise<ProposalRow> {
  const [row] = await tx
    .update(proposals)
    .set({ ...set, updatedAt: now })
    .where(eq(proposals.id, id))
    .returning();
  return row as ProposalRow;
}

const encodeCursor = (row: ProposalRow) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');

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

/** A person's proposals, newest first. */
export async function listProposals(
  ex: Executor,
  orgId: string,
  userId: string,
  query: { cursor?: string | undefined; limit: number; status?: Status | undefined },
  now: Date,
): Promise<{ items: Proposal[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(proposals.orgId, orgId), eq(proposals.forUserId, userId)];
  if (query.status === 'pending') {
    conditions.push(eq(proposals.status, 'pending'), gt(proposals.expiresAt, now));
  } else if (query.status === 'expired') {
    conditions.push(
      or(
        eq(proposals.status, 'expired'),
        and(eq(proposals.status, 'pending'), lte(proposals.expiresAt, now)),
      ) as SQL,
    );
  } else if (query.status) {
    conditions.push(eq(proposals.status, query.status));
  }
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(proposals.createdAt)}, ${proposals.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(proposals)
    .where(and(...conditions))
    .orderBy(desc(msOf(proposals.createdAt)), desc(proposals.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => presentProposal(r, now)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** The proposals prepared in one chat, oldest first, as they stand now. */
export async function proposalsOfChat(
  ex: Executor,
  orgId: string,
  userId: string,
  chatId: string,
  now: Date,
): Promise<Proposal[]> {
  const rows = await ex
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.orgId, orgId),
        eq(proposals.forUserId, userId),
        eq(proposals.chatId, chatId),
      ),
    )
    .orderBy(msOf(proposals.createdAt), proposals.id);
  return rows.map((r) => presentProposal(r, now));
}
