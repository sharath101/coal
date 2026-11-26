import type { ProductLine } from '@coal/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../core/db/client';
import { PRODUCT_LINES } from './catalogue';
import { productLines, projects } from './tables';

/** Loads R&D's product lines. Safe to run on every deploy. */
export async function loadProductLines(ex: Executor, orgId: string): Promise<void> {
  await ex
    .insert(productLines)
    .values(PRODUCT_LINES.map((p) => ({ orgId, code: p.code, name: p.name })))
    .onConflictDoUpdate({
      target: [productLines.orgId, productLines.code],
      set: { name: sql`excluded.name` },
    });
}

const columns = { id: productLines.id, code: productLines.code, name: productLines.name };

export async function listProductLines(ex: Executor, orgId: string): Promise<ProductLine[]> {
  return ex
    .select(columns)
    .from(productLines)
    .where(eq(productLines.orgId, orgId))
    .orderBy(asc(productLines.name));
}

/** The product line of each of these projects, by project id. */
export async function linesOfProjectIds(
  ex: Executor,
  orgId: string,
  projectIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  if (projectIds.length === 0) return new Map();
  const rows = await ex
    .select({ projectId: projects.id, id: productLines.id, name: productLines.name })
    .from(projects)
    .innerJoin(productLines, eq(projects.productLineId, productLines.id))
    .where(and(eq(projects.orgId, orgId), inArray(projects.id, projectIds)));
  return new Map(rows.map((r) => [r.projectId, { id: r.id, name: r.name }]));
}

export async function getProductLine(
  ex: Executor,
  orgId: string,
  id: string,
): Promise<ProductLine | null> {
  const [row] = await ex
    .select(columns)
    .from(productLines)
    .where(and(eq(productLines.orgId, orgId), eq(productLines.id, id)));
  return row ?? null;
}
