import type { Department, Role, RolesResponse } from '@coal/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../../core/db/client';
import { DEPARTMENTS, ROLES } from './catalogue';
import { departments, roles } from './tables';

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
        reportsToKey: r.reportsTo,
        needsProductLine: r.needsProductLine ?? false,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: [roles.orgId, roles.key],
      set: {
        name: sql`excluded.name`,
        departmentId: sql`excluded.department_id`,
        reportsToKey: sql`excluded.reports_to_key`,
        needsProductLine: sql`excluded.needs_product_line`,
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
  const rows = await ex
    .select({
      key: roles.key,
      name: roles.name,
      departmentCode: departments.code,
      reportsTo: roles.reportsToKey,
      needsProductLine: roles.needsProductLine,
    })
    .from(roles)
    .leftJoin(departments, eq(roles.departmentId, departments.id))
    .where(eq(roles.orgId, orgId))
    .orderBy(asc(roles.sortOrder), asc(roles.key));
  return rows;
}

export async function getRole(ex: Executor, orgId: string, key: string): Promise<Role | null> {
  const all = await listRoles(ex, orgId);
  return all.find((r) => r.key === key) ?? null;
}

export async function departmentsAndRoles(ex: Executor, orgId: string): Promise<RolesResponse> {
  const [depts, allRoles] = await Promise.all([listDepartments(ex, orgId), listRoles(ex, orgId)]);
  return { departments: depts, roles: allRoles };
}
