import type { Actor } from '../../core/http/context';
import { notFound } from '../../core/http/errors';
import type { Executor } from '../../core/db/client';
import { loadRun } from '../process/service';
import { countOpenCorrectiveActions } from '../tasks/service';
import { assertCanAccess, canAccess, canSeeContent } from '../permissions';
import type { ResourceOf } from '../permissions/rules';
import type { Env } from './actions';
import { activeMembers, findProject } from './projects';

/** Loads a project with its run's state and its team. `forUpdate` locks the run for an action. */
export async function loadEnv(
  ex: Executor,
  orgId: string,
  actor: Actor,
  projectId: string,
  options: { forUpdate?: boolean } = {},
): Promise<Env> {
  const project = await findProject(ex, orgId, projectId);
  if (!project) throw notFound('project');
  // The run is locked first, so the open corrective actions are counted after any other action on it.
  const loaded = await loadRun(ex, orgId, project.processRunId, options);
  loaded.state.openCorrectiveActions = await countOpenCorrectiveActions(ex, loaded.run.id);
  const members = await activeMembers(ex, orgId, project.id);
  return { orgId, actor, project, loaded, team: members.map((m) => m.user) };
}

/** What the permission module needs to know about a project. */
export const scopeOf = (env: Env) => ({
  productLineId: env.project.productLineId,
  memberIds: env.team.map((u) => u.id),
});

/** Status is open to everyone signed in; comments, reasons and details only to people in the project's scope. */
export const canSeeProjectContent = (env: Env): boolean => canSeeContent(env.actor, scopeOf(env));

export type ScopedPermission =
  | 'steps.start'
  | 'steps.submit'
  | 'steps.approve'
  | 'steps.return'
  | 'steps.decide'
  | 'steps.sendBack'
  | 'milestones.record'
  | 'correctiveActions.create'
  | 'projects.team.write'
  | 'projects.hold'
  | 'projects.resume'
  | 'projects.drop'
  | 'tasks.reassign';

const resourceFor = (env: Env, roles: string[]) =>
  ({ ...scopeOf(env), roles }) as ResourceOf<ScopedPermission>;

/** May this person do it now, given the roles the route allows? An empty list: nobody. */
export function may(env: Env, permission: ScopedPermission, roles: string[]): boolean {
  return roles.length > 0 && canAccess(permission, env.actor, resourceFor(env, roles)).allowed;
}

/**
 * Refuses, naming who can, unless the person is in one of the roles. An empty list passes:
 * nothing is allowed at all then, and the engine explains why (for example, a step with no signer).
 */
export function assertMay(env: Env, permission: ScopedPermission, roles: string[]): void {
  if (roles.length > 0) assertCanAccess(permission, env.actor, resourceFor(env, roles));
}
