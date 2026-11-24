import type { Department, Role } from '@coal/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { DEPARTMENTS, POSITIONS, ROLES } from './catalogue';
import { departments, positions, roles } from './tables';

/** Loads the catalogue into the tables. Safe to run on every deploy. */
export async function loadOrgCatalogue(ex: Executor, orgId: string): Promise<void> {
  const deptRows = await ex
    .insert(departments)
    .values(
      DEPARTMENTS.map((d, index) => ({ orgId, code: d.code, name: d.name, sortOrder: index })),
    )
    .onConflictDoUpdate({
      target: [departments.orgId, departments.code],
      set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
    })
    .returning({ id: departments.id, code: departments.code });
  const deptId = new Map(deptRows.map((d) => [d.code, d.id]));

  await ex
    .insert(roles)
    .values(
      ROLES.map((r, index) => ({
        orgId,
        key: r.key,
        name: r.name,
        departmentId: r.department ? deptId.get(r.department) : null,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: [roles.orgId, roles.key],
      set: {
        name: sql`excluded.name`,
        departmentId: sql`excluded.department_id`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  await ex
    .insert(positions)
    .values(
      POSITIONS.map((p, index) => ({
        orgId,
        key: p.key,
        title: p.title,
        roleKey: p.role,
        reportsToKey: p.reportsTo,
        perProductLine: p.perProductLine ?? false,
        seats: p.seats,
        selfService: p.selfService ?? true,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: [positions.orgId, positions.key],
      set: {
        title: sql`excluded.title`,
        roleKey: sql`excluded.role_key`,
        reportsToKey: sql`excluded.reports_to_key`,
        perProductLine: sql`excluded.per_product_line`,
        seats: sql`excluded.seats`,
        selfService: sql`excluded.self_service`,
        sortOrder: sql`excluded.sort_order`,
      },
    });
}

export async function listDepartments(ex: Executor, orgId: string): Promise<Department[]> {
  return ex
    .select({ code: departments.code, name: departments.name })
    .from(departments)
    .where(eq(departments.orgId, orgId))
    .orderBy(asc(departments.sortOrder), asc(departments.code));
}

export async function listRoles(ex: Executor, orgId: string): Promise<Role[]> {
  return ex
    .select({ key: roles.key, name: roles.name, departmentCode: departments.code })
    .from(roles)
    .leftJoin(departments, eq(roles.departmentId, departments.id))
    .where(eq(roles.orgId, orgId))
    .orderBy(asc(roles.sortOrder), asc(roles.key));
}

export async function getRole(ex: Executor, orgId: string, key: string): Promise<Role | null> {
  const all = await listRoles(ex, orgId);
  return all.find((r) => r.key === key) ?? null;
}

/** A position as stored: what the chart shows, and whether people may choose it themselves. */
export interface PositionInfo {
  key: string;
  title: string;
  roleKey: string;
  departmentCode: string | null;
  reportsTo: string | null;
  perProductLine: boolean;
  seats: number | null;
  selfService: boolean;
}

export async function listPositions(ex: Executor, orgId: string): Promise<PositionInfo[]> {
  return ex
    .select({
      key: positions.key,
      title: positions.title,
      roleKey: positions.roleKey,
      departmentCode: departments.code,
      reportsTo: positions.reportsToKey,
      perProductLine: positions.perProductLine,
      seats: positions.seats,
      selfService: positions.selfService,
    })
    .from(positions)
    .innerJoin(roles, and(eq(positions.orgId, roles.orgId), eq(positions.roleKey, roles.key)))
    .leftJoin(departments, eq(roles.departmentId, departments.id))
    .where(eq(positions.orgId, orgId))
    .orderBy(asc(positions.sortOrder), asc(positions.key));
}

/**
 * The position with its row locked, so two people taking the last seat are counted one after the
 * other (docs/roles-and-access.md#seats).
 */
export async function lockPosition(
  tx: Tx,
  orgId: string,
  key: string,
): Promise<PositionInfo | null> {
  const locked = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.orgId, orgId), eq(positions.key, key)))
    .for('update');
  if (locked.length === 0) return null;
  return (await listPositions(tx, orgId)).find((p) => p.key === key) ?? null;
}
