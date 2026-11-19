import type { RouteDefinition } from '@coal/shared';
import type { Executor } from '../../core/db/client';
import { loadRun } from '../process/service';
import { roleAbove } from '../permissions/rules';
import { activeMembers, findProject, type ProjectRow } from '../rnd/projects';
import { getProductLine } from '../rnd/service';
import { findActiveUsersByRole, type UserRow } from '../users/service';

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

/** The next role up the ladder that has someone to tell, and those people (docs/roles-and-access.md#assigning-work-and-making-requests). */
export async function nextRoleUp(
  ex: Executor,
  orgId: string,
  ctx: ProjectContext,
  roleKey: string,
): Promise<UserRow[]> {
  for (let up = roleAbove(roleKey); up; up = roleAbove(up)) {
    const people = await holdersOf(ex, orgId, ctx, up);
    if (people.length > 0) return people;
  }
  return [];
}
