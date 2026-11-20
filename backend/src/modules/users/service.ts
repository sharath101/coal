import { normalizePersonName, type Me, type User } from '@coal/shared';
import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { isUniqueViolation } from '../../core/db/errors';
import { containing } from '../../core/db/search';
import { AppError, validationFailed } from '../../core/http/errors';
import { getRole, listRoles } from '../org/service';
import { getProductLine, listProductLines } from '../rnd/service';
import { users } from './tables';

export type UserRow = typeof users.$inferSelect;

/** What the audit trail records about a person. */
export const userSnapshot = (row: UserRow) => ({
  name: row.name,
  roleKey: row.roleKey,
  productLineId: row.productLineId,
  status: row.status,
});

export async function present(ex: Executor, orgId: string, rows: UserRow[]): Promise<User[]> {
  if (rows.length === 0) return [];
  const [roleList, lines] = await Promise.all([listRoles(ex, orgId), listProductLines(ex, orgId)]);
  const roleByKey = new Map(roleList.map((r) => [r.key, r]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  return rows.map((row) => {
    const role = roleByKey.get(row.roleKey);
    return {
      id: row.id,
      name: row.name,
      role: {
        key: row.roleKey,
        name: role?.name ?? row.roleKey,
        departmentCode: role?.departmentCode ?? null,
      },
      productLine: row.productLineId ? (lineById.get(row.productLineId) ?? null) : null,
      status: row.status,
    };
  });
}

export async function presentMe(ex: Executor, orgId: string, row: UserRow): Promise<Me> {
  const [user] = await present(ex, orgId, [row]);
  return { ...(user as User), updatedAt: row.updatedAt.toISOString() };
}

export async function findUser(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<UserRow | null> {
  const query = ex
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function findUsersByIds(
  ex: Executor,
  orgId: string,
  ids: string[],
): Promise<UserRow[]> {
  if (ids.length === 0) return [];
  return ex
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), inArray(users.id, [...new Set(ids)])));
}

/** Active people holding a role, optionally only those on one product line (a Lead's). */
export async function findActiveUsersByRole(
  ex: Executor,
  orgId: string,
  roleKey: string,
  options: { productLineId?: string | null } = {},
): Promise<UserRow[]> {
  return ex
    .select()
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.roleKey, roleKey),
        eq(users.status, 'active'),
        options.productLineId ? eq(users.productLineId, options.productLineId) : undefined,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
}

/** Everyone with an active account, for the Dashboard's team views. */
export async function listActiveUsers(ex: Executor, orgId: string): Promise<UserRow[]> {
  return ex
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.status, 'active')))
    .orderBy(sql`lower(${users.name})`, asc(users.id));
}

/** Active people whose name contains the words, for search: the directory is open to everyone signed in. */
export async function searchUsers(
  ex: Executor,
  orgId: string,
  q: string,
  limit: number,
): Promise<UserRow[]> {
  return ex
    .select()
    .from(users)
    .where(
      and(eq(users.orgId, orgId), eq(users.status, 'active'), ilike(users.name, containing(q))),
    )
    .orderBy(sql`lower(${users.name})`, asc(users.id))
    .limit(limit);
}

export async function findUserByName(ex: Executor, orgId: string, name: string) {
  const [row] = await ex
    .select()
    .from(users)
    .where(
      and(eq(users.orgId, orgId), sql`lower(${users.name}) = lower(${normalizePersonName(name)})`),
    );
  return row ?? null;
}

/** Checks the role and the product line. A product line is kept only for roles that need one. */
async function resolveRole(
  ex: Executor,
  orgId: string,
  roleKey: string,
  productLineId: string | null,
): Promise<{ roleKey: string; productLineId: string | null }> {
  const role = await getRole(ex, orgId, roleKey);
  if (!role) throw validationFailed('There is no such role.', 'roleKey');
  if (!role.needsProductLine) return { roleKey, productLineId: null };
  if (!productLineId) {
    throw new AppError(400, 'PRODUCT_LINE_REQUIRED', `A ${role.name} must choose a product line.`);
  }
  if (!(await getProductLine(ex, orgId, productLineId))) {
    throw validationFailed('There is no such product line.', 'productLineId');
  }
  return { roleKey, productLineId };
}

const nameTaken = (name: string) =>
  new AppError(
    409,
    'NAME_TAKEN',
    `Someone is already called "${name}". Add an initial or a surname.`,
  );

export async function createUser(
  tx: Tx,
  orgId: string,
  input: { name: string; roleKey: string; productLineId?: string | undefined },
): Promise<UserRow> {
  const name = normalizePersonName(input.name);
  const profile = await resolveRole(tx, orgId, input.roleKey, input.productLineId ?? null);
  try {
    const [row] = await tx
      .insert(users)
      .values({ orgId, name, ...profile })
      .returning();
    return row as UserRow;
  } catch (error) {
    if (isUniqueViolation(error, 'users_org_name_ci')) throw nameTaken(name);
    throw error;
  }
}

export async function updateUser(
  tx: Tx,
  orgId: string,
  current: UserRow,
  patch: {
    name?: string | undefined;
    roleKey?: string | undefined;
    productLineId?: string | null | undefined;
  },
): Promise<UserRow> {
  const name = patch.name === undefined ? current.name : normalizePersonName(patch.name);
  const profile = await resolveRole(
    tx,
    orgId,
    patch.roleKey ?? current.roleKey,
    patch.productLineId === undefined ? current.productLineId : patch.productLineId,
  );
  try {
    const [row] = await tx
      .update(users)
      .set({ name, ...profile })
      .where(and(eq(users.orgId, orgId), eq(users.id, current.id)))
      .returning();
    return row as UserRow;
  } catch (error) {
    if (isUniqueViolation(error, 'users_org_name_ci')) throw nameTaken(name);
    throw error;
  }
}

const encodeCursor = (row: UserRow) =>
  Buffer.from(JSON.stringify([row.name.toLowerCase(), row.id])).toString('base64url');

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

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The people directory, sorted by name, with cursor paging. */
export async function listUsers(
  ex: Executor,
  orgId: string,
  query: {
    cursor?: string | undefined;
    limit: number;
    'filter[role]'?: string | undefined;
    q?: string | undefined;
  },
): Promise<{ items: User[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(users.orgId, orgId)];
  if (query['filter[role]']) conditions.push(eq(users.roleKey, query['filter[role]']));
  if (query.q) conditions.push(ilike(users.name, `%${escapeLike(query.q)}%`));
  if (query.cursor) {
    const [name, id] = decodeCursor(query.cursor);
    conditions.push(sql`(lower(${users.name}), ${users.id}) > (${name}, ${id}::uuid)`);
  }

  const rows = await ex
    .select()
    .from(users)
    .where(and(...conditions))
    .orderBy(sql`lower(${users.name})`, asc(users.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await present(ex, orgId, page),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}
