import { POSITIONS, ROLES, positionSeed } from './catalogue';

/**
 * Who reports to whom (docs/roles-and-access.md#the-org-chart). Pure: the permission rules, the
 * Dashboard and the reminders all ask it, so the chart has one home.
 */

/** Where a person sits: their box, and their product line where the box has one. */
export interface Placed {
  positionKey: string;
  productLineId: string | null;
}

const ROLE_DEPARTMENT = new Map(ROLES.map((r) => [r.key, r.department]));

/** The position one step up, if any. */
export const positionAbove = (positionKey: string): string | null =>
  positionSeed(positionKey)?.reportsTo ?? null;

/** The role of a position. */
export const roleOfPosition = (positionKey: string): string | null =>
  positionSeed(positionKey)?.role ?? null;

/** Is the position part of R&D (including the VP's and the Head's)? The Board and the admin aren't. */
export function inRnd(positionKey: string): boolean {
  const role = roleOfPosition(positionKey);
  if (!role) return false;
  return role === 'vp' || ROLE_DEPARTMENT.get(role) === 'RND';
}

/**
 * Is `above` anywhere above `below` on the chart? A box with one seat per product line only
 * counts for the people of its own line, so the Spine Lead is above Spine's design engineers and
 * not Trauma's. The Board sits above everyone else, as the MD and the CEO both sign as it.
 */
export function isAboveOnChart(above: Placed, below: Placed): boolean {
  const topRole = roleOfPosition(above.positionKey);
  const lowRole = roleOfPosition(below.positionKey);
  if (!topRole || !lowRole || topRole === 'admin' || lowRole === 'admin') return false;
  if (topRole === 'board') return lowRole !== 'board';
  for (let up = positionAbove(below.positionKey); up; up = positionAbove(up)) {
    if (up !== above.positionKey) continue;
    return !positionSeed(up)?.perProductLine || above.productLineId === below.productLineId;
  }
  return false;
}

/** Positions that report directly to this one, in the order of the chart. */
export const reportsOf = (positionKey: string): string[] =>
  POSITIONS.filter((p) => p.reportsTo === positionKey).map((p) => p.key);

/** Does anyone report to this position? (A manager, who therefore sees a team.) */
export const isManager = (positionKey: string): boolean => reportsOf(positionKey).length > 0;
