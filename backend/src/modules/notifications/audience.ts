import type { RouteDefinition } from '@coal/shared';
import type { Executor } from '../../core/db/client';
import { positionSeed } from '../org/catalogue';
import { positionAbove } from '../org/chart';
import { loadRun } from '../process/service';
import { isTeamStaff } from '../permissions/rules';
import { activeMembers, findProject, type ProjectRow } from '../rnd/projects';
import { getProductLine } from '../rnd/service';
import {
  findActiveUsersByPosition,
  findActiveUsersByRole,
  positionOf,
  type UserRow,
} from '../users/service';

/** What a notification about a project needs to know: its route, its line and its team. */
export interface ProjectContext {
  project: ProjectRow;
  route: RouteDefinition;
  runId: string;
  lineName: string;
  team: UserRow[];
}

export async function projectContext(
  ex: Executor,
  orgId: string,
  projectId: string,
): Promise<ProjectContext | null> {
  const project = await findProject(ex, orgId, projectId);
  if (!project) return null;
  const [loaded, line, members] = await Promise.all([
    loadRun(ex, orgId, project.processRunId),
    getProductLine(ex, orgId, project.productLineId),
    activeMembers(ex, orgId, project.id),
  ]);
  return {
    project,
    route: loaded.route,
    runId: loaded.run.id,
    lineName: line?.name ?? '',
    team: members.map((m) => m.user),
  };
}

/** The people holding a role who would look after this project: the team, else anyone with the role (a Lead: of the line). */
export async function holdersOf(
  ex: Executor,
  orgId: string,
  ctx: ProjectContext,
  roleKey: string,
): Promise<UserRow[]> {
  const onTeam = ctx.team.filter((u) => u.roleKey === roleKey);
  if (onTeam.length > 0) return onTeam;
  return findActiveUsersByRole(ex, orgId, roleKey, {
    productLineId: roleKey === 'rd_lead' ? ctx.project.productLineId : null,
  });
}

/** The people at one box of the chart who would look after this project: the team's, else anyone's. */
async function holdersAtPosition(
  ex: Executor,
  orgId: string,
  ctx: ProjectContext,
  positionKey: string,
  productLineId: string | null,
): Promise<UserRow[]> {
  const seed = positionSeed(positionKey);
  if (seed?.role === 'board') return findActiveUsersByRole(ex, orgId, 'board');
  const line = seed?.perProductLine ? productLineId : null;
  const onTeam = ctx.team.filter(
    (u) => positionOf(u) === positionKey && (!line || u.productLineId === line),
  );
  if (onTeam.length > 0) return onTeam;
  return findActiveUsersByPosition(ex, orgId, positionKey, { productLineId: line });
}

/**
 * The people to tell when someone is late or has recorded a deviation: the nearest position above
 * theirs on the org chart that has anyone (docs/roles-and-access.md#assigning-work-and-making-requests),
 * and, for R&D staff, also the Lead of the project's line, who runs it. The Board is both the MD
 * and the CEO.
 */
export async function nextUp(
  ex: Executor,
  orgId: string,
  ctx: ProjectContext,
  person: UserRow,
): Promise<UserRow[]> {
  const found: UserRow[] = [];
  for (let up = positionAbove(positionOf(person)); up; up = positionAbove(up)) {
    const holders = await holdersAtPosition(ex, orgId, ctx, up, person.productLineId);
    if (holders.length > 0) {
      found.push(...holders);
      break;
    }
  }
  if (isTeamStaff(person.roleKey)) found.push(...(await holdersOf(ex, orgId, ctx, 'rd_lead')));
  return [...new Map(found.map((u) => [u.id, u])).values()].filter((u) => u.id !== person.id);
}
