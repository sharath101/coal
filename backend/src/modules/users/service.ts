import {
  normalizePersonName,
  type Me,
  type OpenPosition,
  type OrgChartResponse,
  type User,
} from '@coal/shared';
import { and, asc, eq, ilike, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import type { Actor } from '../../core/http/context';
import { isUniqueViolation } from '../../core/db/errors';
import { containing } from '../../core/db/search';
import { AppError, validationFailed } from '../../core/http/errors';
import { firstPositionOfRole } from '../org/catalogue';
import { positionAbove } from '../org/chart';
import { listPositions, listRoles, lockPosition, type PositionInfo } from '../org/service';
import type { Person } from '../permissions/rules';
import { getProductLine, listProductLines } from '../rnd/service';
import { users } from './tables';

export type UserRow = typeof users.$inferSelect;

/** The person's box on the chart. An account made before positions is read as its role's first one. */
export const positionOf = (row: Pick<UserRow, 'positionKey' | 'roleKey'>): string =>
  row.positionKey ?? firstPositionOfRole(row.roleKey)?.key ?? row.roleKey;

/** Where the person sits, for the rules about who is above whom. */
export const personOf = (row: UserRow): Person => ({
  roleKey: row.roleKey,
  positionKey: positionOf(row),
  productLineId: row.productLineId,
});

/** A person as the permission rules see them when they aren't the one making the request. */
export const actorOf = (row: UserRow): Actor => ({
  userId: row.id,
  name: row.name,
  ...personOf(row),
  switcherId: null,
});

/** What the audit trail records about a person. */
export const userSnapshot = (row: UserRow) => ({
  name: row.name,
  roleKey: row.roleKey,
  positionKey: positionOf(row),
  productLineId: row.productLineId,
  status: row.status,
});

/** The demo admin is no one's colleague: left out of the directory, search, teams and the chart. */
const notAdmin = ne(users.roleKey, 'admin');

export async function present(ex: Executor, orgId: string, rows: UserRow[]): Promise<User[]> {
  if (rows.length === 0) return [];
  const [roleList, lines, positionList] = await Promise.all([
    listRoles(ex, orgId),
    listProductLines(ex, orgId),
    listPositions(ex, orgId),
  ]);
  const roleByKey = new Map(roleList.map((r) => [r.key, r]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const positionByKey = new Map(positionList.map((p) => [p.key, p]));
  return rows.map((row) => {
    const role = roleByKey.get(row.roleKey);
    const positionKey = positionOf(row);
    return {
      id: row.id,
      name: row.name,
      role: {
        key: row.roleKey,
        name: role?.name ?? row.roleKey,
        departmentCode: role?.departmentCode ?? null,
      },
      position: { key: positionKey, title: positionByKey.get(positionKey)?.title ?? positionKey },
      productLine: row.productLineId ? (lineById.get(row.productLineId) ?? null) : null,
      status: row.status,
    };
  });
}

/** Who someone reports to: the first person at the nearest position above theirs that has anyone. */
async function managerOf(ex: Executor, orgId: string, row: UserRow, positionList: PositionInfo[]) {
  const chain: string[] = [];
  for (let up = positionAbove(positionOf(row)); up; up = positionAbove(up)) chain.push(up);
  if (chain.length === 0) return null;
  const people = await ex
    .select()
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.status, 'active'),
        notAdmin,
        inArray(users.positionKey, chain),
      ),
    )
    .orderBy(sql`lower(${users.name})`, asc(users.id));
  const byKey = new Map(positionList.map((p) => [p.key, p]));
  for (const key of chain) {
    const holder = people.find(
      (p) =>
        p.positionKey === key &&
        (!byKey.get(key)?.perProductLine || p.productLineId === row.productLineId),
    );
    if (holder) {
      return {
        id: holder.id,
        name: holder.name,
        positionTitle: byKey.get(key)?.title ?? key,
      };
    }
  }
  return null;
}

export async function presentMe(ex: Executor, orgId: string, row: UserRow): Promise<Me> {
  const [[user], positionList] = await Promise.all([
    present(ex, orgId, [row]),
    listPositions(ex, orgId),
  ]);
  return {
    ...(user as User),
    updatedAt: row.updatedAt.toISOString(),
    reportsTo: await managerOf(ex, orgId, row, positionList),
  };
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

/** Active people in one box of the chart, in a product line where the box is counted by line. */
export async function findActiveUsersByPosition(
  ex: Executor,
  orgId: string,
  positionKey: string,
  options: { productLineId?: string | null } = {},
): Promise<UserRow[]> {
  return ex
    .select()
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.positionKey, positionKey),
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
    .where(and(eq(users.orgId, orgId), eq(users.status, 'active'), notAdmin))
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
      and(
        eq(users.orgId, orgId),
        eq(users.status, 'active'),
        notAdmin,
        ilike(users.name, containing(q)),
      ),
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

/** Active people in each position, and in each product line for the positions counted by line. */
async function seatsTaken(ex: Executor, orgId: string): Promise<Map<string, number>> {
  const rows = await ex
    .select({
      positionKey: users.positionKey,
      productLineId: users.productLineId,
      taken: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.status, 'active')))
    .groupBy(users.positionKey, users.productLineId);
  const taken = new Map<string, number>();
  for (const r of rows) {
    if (!r.positionKey) continue;
    const add = (key: string) => taken.set(key, (taken.get(key) ?? 0) + r.taken);
    add(r.positionKey);
    if (r.productLineId) add(`${r.positionKey}|${r.productLineId}`);
  }
  return taken;
}

/** The positions a person may choose, and which of them have no seat left (docs/roles-and-access.md#seats). */
export async function openPositions(ex: Executor, orgId: string): Promise<OpenPosition[]> {
  const [positionList, lines, taken] = await Promise.all([
    listPositions(ex, orgId),
    listProductLines(ex, orgId),
    seatsTaken(ex, orgId),
  ]);
  return positionList
    .filter((p) => p.selfService)
    .map(({ selfService: _selfService, ...p }) => {
      const seats = p.seats;
      if (seats === null) return { ...p, full: false, fullProductLineIds: [] };
      if (!p.perProductLine) {
        return { ...p, full: (taken.get(p.key) ?? 0) >= seats, fullProductLineIds: [] };
      }
      const fullLines = lines.filter((l) => (taken.get(`${p.key}|${l.id}`) ?? 0) >= seats);
      return {
        ...p,
        full: lines.length > 0 && fullLines.length === lines.length,
        fullProductLineIds: fullLines.map((l) => l.id),
      };
    });
}

/**
 * Checks the position, the product line and the seat, and gives the role the position holds. A
 * product line is kept only for positions counted by line. A seat is checked only when the box or
 * the line changes, so a person who is already in a full box can still change their name.
 */
async function resolvePosition(
  tx: Tx,
  orgId: string,
  want: { positionKey: string; productLineId: string | null },
  options: { current?: UserRow; reserved?: boolean },
): Promise<{ roleKey: string; positionKey: string; productLineId: string | null }> {
  const position = await lockPosition(tx, orgId, want.positionKey);
  if (!position) throw validationFailed('There is no such position.', 'positionKey');
  const { current } = options;
  const unchanged = current ? positionOf(current) === position.key : false;
  if (!position.selfService && !options.reserved && !unchanged) {
    throw validationFailed(`${position.title} is not a position you can choose.`, 'positionKey');
  }
  let productLineId: string | null = null;
  if (position.perProductLine) {
    productLineId = want.productLineId;
    if (!productLineId) {
      throw new AppError(
        400,
        'PRODUCT_LINE_REQUIRED',
        `A ${position.title} must choose a product line.`,
      );
    }
    if (!(await getProductLine(tx, orgId, productLineId))) {
      throw validationFailed('There is no such product line.', 'productLineId');
    }
  }
  const unmoved = unchanged && current?.productLineId === productLineId;
  if (position.seats !== null && !unmoved) {
    const [{ taken = 0 } = {}] = await tx
      .select({ taken: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          eq(users.positionKey, position.key),
          eq(users.status, 'active'),
          productLineId ? eq(users.productLineId, productLineId) : undefined,
          current ? ne(users.id, current.id) : undefined,
        ),
      );
    if (taken >= position.seats) {
      const line = productLineId ? await getProductLine(tx, orgId, productLineId) : null;
      const where = line ? ` on ${line.name}` : '';
      throw new AppError(
        409,
        'POSITION_FULL',
        position.seats === 1
          ? `The ${position.title}${where} seat is already taken.`
          : `All ${position.seats} ${position.title} seats${where} are taken.`,
      );
    }
  }
  return { roleKey: position.roleKey, positionKey: position.key, productLineId };
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
  input: { name: string; positionKey: string; productLineId?: string | undefined },
  options: { reserved?: boolean } = {},
): Promise<UserRow> {
  const name = normalizePersonName(input.name);
  const profile = await resolvePosition(
    tx,
    orgId,
    { positionKey: input.positionKey, productLineId: input.productLineId ?? null },
    options,
  );
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
    positionKey?: string | undefined;
    productLineId?: string | null | undefined;
  },
): Promise<UserRow> {
  const name = patch.name === undefined ? current.name : normalizePersonName(patch.name);
  const profile = await resolvePosition(
    tx,
    orgId,
    {
      positionKey: patch.positionKey ?? positionOf(current),
      productLineId:
        patch.productLineId === undefined ? current.productLineId : patch.productLineId,
    },
    { current },
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

/**
 * The org chart: every position that can be chosen, with the people who hold it. The admin's own
 * box and the admin are left out (P113).
 */
export async function orgChart(ex: Executor, orgId: string): Promise<OrgChartResponse> {
  const [positionList, lines, people] = await Promise.all([
    listPositions(ex, orgId),
    listProductLines(ex, orgId),
    listActiveUsers(ex, orgId),
  ]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  return {
    positions: positionList
      .filter((p) => p.selfService)
      .map(({ selfService: _selfService, ...p }) => ({
        ...p,
        holders: people
          .filter((u) => positionOf(u) === p.key)
          .map((u) => ({
            id: u.id,
            name: u.name,
            productLine: u.productLineId ? (lineById.get(u.productLineId) ?? null) : null,
          })),
      })),
  };
}

/**
 * Places the accounts made before positions: each takes the first position of its role that
 * still has a seat, else the last one. Safe to run on every deploy: it only touches unplaced ones.
 */
export async function placeUnplacedUsers(ex: Executor, orgId: string): Promise<void> {
  const unplaced = await ex
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.positionKey)))
    .orderBy(asc(users.createdAt), asc(users.id));
  if (unplaced.length === 0) return;
  const positionList = await listPositions(ex, orgId);
  const taken = await seatsTaken(ex, orgId);
  for (const user of unplaced) {
    const own = positionList.filter((p) => p.roleKey === user.roleKey);
    if (own.length === 0) continue;
    const open = own.find((p) => {
      if (p.seats === null) return true;
      const key = p.perProductLine && user.productLineId ? `${p.key}|${user.productLineId}` : p.key;
      return (taken.get(key) ?? 0) < p.seats;
    });
    const chosen = open ?? own[own.length - 1]!;
    taken.set(chosen.key, (taken.get(chosen.key) ?? 0) + 1);
    if (chosen.perProductLine && user.productLineId) {
      const lineKey = `${chosen.key}|${user.productLineId}`;
      taken.set(lineKey, (taken.get(lineKey) ?? 0) + 1);
    }
    await ex
      .update(users)
      .set({ positionKey: chosen.key })
      .where(and(eq(users.orgId, orgId), eq(users.id, user.id)));
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
  const conditions: SQL[] = [eq(users.orgId, orgId), notAdmin];
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
