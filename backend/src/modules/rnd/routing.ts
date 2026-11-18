import type { Executor } from '../../core/db/client';
import { ROLES } from '../org/catalogue';
import { findActiveUsersByRole, type UserRow } from '../users/service';

/**
 * Who gets a task (docs/roles-and-access.md#who-gets-a-task), in this order:
 * 1. the project team member who holds the role (if several do, the role's queue);
 * 2. for the Lead role, the Lead of the project's product line; for VP and Head, the person
 *    holding the role (if several, the queue);
 * 3. otherwise the role's queue, which anyone with the role can claim.
 */
export interface Routing {
  assignee: UserRow | null;
  queueRole: string | null;
  /** Shown in previews, when a task lands in a queue. */
  warning: string | null;
}

const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name]));
export const roleName = (key: string) => ROLE_NAMES.get(key) ?? key;

const assigned = (assignee: UserRow): Routing => ({ assignee, queueRole: null, warning: null });
const queued = (role: string, warning: string): Routing => ({
  assignee: null,
  queueRole: role,
  warning,
});

export async function routeRole(
  ex: Executor,
  orgId: string,
  scope: { productLineId: string },
  team: UserRow[],
  role: string,
): Promise<Routing> {
  const name = roleName(role);
  const onTeam = team.filter((u) => u.roleKey === role);
  if (onTeam.length === 1) return assigned(onTeam[0] as UserRow);
  if (onTeam.length > 1) {
    return queued(
      role,
      `Several ${name} people are on the team, so this goes to the ${name} queue.`,
    );
  }

  const personal = ['rd_lead', 'vp', 'rd_head'].includes(role);
  const holders = await findActiveUsersByRole(ex, orgId, role, {
    productLineId: role === 'rd_lead' ? scope.productLineId : null,
  });
  if (personal && holders.length === 1) return assigned(holders[0] as UserRow);
  if (holders.length === 0)
    return queued(role, `No ${name} user yet, so this goes to the ${name} queue.`);
  return queued(
    role,
    personal
      ? `Several ${name} people could take this, so it goes to the ${name} queue.`
      : `No ${name} is on the team, so this goes to the ${name} queue.`,
  );
}
