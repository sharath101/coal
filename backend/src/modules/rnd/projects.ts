import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { validationFailed } from '../../core/http/errors';
import { runsByStatus } from '../process/service';
import { findActiveUsersByRole, findUsersByIds, type UserRow } from '../users/service';
import { projectMembers, projects } from './tables';

export type ProjectRow = typeof projects.$inferSelect;

export async function findProject(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<ProjectRow | null> {
  const query = ex
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** The project a process run belongs to: documents and signatures point at the run. */
export async function findProjectByRun(
  ex: Executor,
  orgId: string,
  runId: string,
): Promise<ProjectRow | null> {
  const [row] = await ex
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.processRunId, runId)));
  return row ?? null;
}

/** Projects of several runs at once, keyed by run. */
export async function projectsByRuns(
  ex: Executor,
  orgId: string,
  runIds: string[],
): Promise<Map<string, ProjectRow>> {
  if (runIds.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), inArray(projects.processRunId, runIds)));
  return new Map(rows.map((r) => [r.processRunId, r]));
}

/** Every project, oldest first: the Dashboard's portfolio views. */
export async function allProjects(ex: Executor, orgId: string): Promise<ProjectRow[]> {
  return ex
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(asc(projects.createdAt), asc(projects.id));
}

/** The active team of each project, as user ids. */
export async function memberIdsOf(
  ex: Executor,
  projectIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(projectIds.map((id) => [id, []]));
  if (projectIds.length === 0) return result;
  const rows = await ex
    .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, projectIds), isNull(projectMembers.removedAt)));
  for (const row of rows) result.get(row.projectId)?.push(row.userId);
  return result;
}

const encodeCursor = (row: ProjectRow) =>
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

/** Projects, newest first. Status comes from each project's run. */
export async function listProjectRows(
  ex: Executor,
  orgId: string,
  query: {
    cursor?: string | undefined;
    limit: number;
    status?: 'active' | 'on_hold' | 'dropped' | 'completed' | 'closed' | undefined;
    productLineId?: string | undefined;
  },
): Promise<{ rows: ProjectRow[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(projects.orgId, orgId)];
  if (query.productLineId) conditions.push(eq(projects.productLineId, query.productLineId));
  if (query.status) {
    const runIds = await runsByStatus(ex, orgId, [query.status]);
    if (runIds.length === 0) return { rows: [], nextCursor: null };
    conditions.push(inArray(projects.processRunId, runIds));
  }
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(projects.createdAt)}, ${projects.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(msOf(projects.createdAt)), desc(projects.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** `SPN-26-004`: the line's code, the year, and the next number for that line and year. */
export async function nextProjectCode(
  tx: Tx,
  orgId: string,
  line: { id: string; code: string },
  now = new Date(),
): Promise<string> {
  const year = String(now.getFullYear()).slice(-2);
  // One Go at a time per line and year, so two projects can't take the same number.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`project-code:${orgId}:${line.id}:${year}`}))`,
  );
  const prefix = `${line.code}-${year}-`;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), sql`${projects.code} like ${`${prefix}%`}`));
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

export interface Member {
  user: UserRow;
  addedAt: Date;
}

/** The team: everyone added and not removed, who still has an active account. */
export async function activeMembers(
  ex: Executor,
  orgId: string,
  projectId: string,
): Promise<Member[]> {
  const rows = await ex
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), isNull(projectMembers.removedAt)))
    .orderBy(asc(projectMembers.addedAt), asc(projectMembers.id));
  const people = new Map(
    (
      await findUsersByIds(
        ex,
        orgId,
        rows.map((r) => r.userId),
      )
    ).map((u) => [u.id, u]),
  );
  return rows.flatMap((row) => {
    const user = people.get(row.userId);
    return user && user.status === 'active' ? [{ user, addedAt: row.addedAt }] : [];
  });
}

export async function addMembers(
  tx: Tx,
  orgId: string,
  projectId: string,
  users: UserRow[],
  addedBy: string,
): Promise<void> {
  if (users.length === 0) return;
  await tx
    .insert(projectMembers)
    .values(users.map((u) => ({ orgId, projectId, userId: u.id, roleKey: u.roleKey, addedBy })))
    .onConflictDoNothing();
}

export async function removeMembers(tx: Tx, projectId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .update(projectMembers)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        inArray(projectMembers.userId, userIds),
        isNull(projectMembers.removedAt),
      ),
    );
}

/** People who must exist and be active, or the request is refused. */
export async function requireActiveUsers(
  ex: Executor,
  orgId: string,
  ids: string[],
  path: string,
): Promise<UserRow[]> {
  const found = await findUsersByIds(ex, orgId, ids);
  const unique = [...new Set(ids)];
  if (found.length !== unique.length || found.some((u) => u.status !== 'active')) {
    throw validationFailed('Someone in the list has no active account.', path);
  }
  return found;
}

/**
 * The team a project starts with (docs/roles-and-access.md#project-teams): the Lead of its
 * product line, the Head and an AEMS expert, each when exactly one person holds the role.
 * Where several do, the VP or the Lead names one. Their tasks go to the role's queue until then.
 */
export async function startingTeam(ex: Executor, orgId: string, productLineId: string) {
  const team: UserRow[] = [];
  for (const [role, line] of [
    ['rd_lead', productLineId],
    ['rd_head', null],
    ['aems', null],
  ] as const) {
    const holders = await findActiveUsersByRole(ex, orgId, role, { productLineId: line });
    if (holders.length === 1) team.push(holders[0] as UserRow);
  }
  return team;
}
