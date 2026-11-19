import type { PermissionKey } from '@coal/shared';
import type { Actor } from '../../core/http/context';
import { ROLES } from '../org/catalogue';

/**
 * The one permission module (docs/roles-and-access.md#how-access-is-enforced).
 * Every endpoint's permission has a rule here, checked by the type below, and an entry in
 * the test table in permissions.test.ts.
 */
export type Decision =
  { allowed: true } | { allowed: false; code: 'NOT_SIGNED_IN' | 'NOT_ALLOWED'; whoCan: string[] };

export interface FileResource {
  uploadedBy: string;
}

/** Whose project it is: its product line and its team. */
export interface Scope {
  productLineId: string | null;
  memberIds: string[];
}

/** A project, and the roles that may act on it right now (worked out from the route and its state). */
export interface RoleScope extends Scope {
  /** Role keys, or `team` for the project team. */
  roles: string[];
}

/** Something that belongs to one person: their chats with the assistant, its drafts and cards. */
export interface OwnedResource {
  ownerId: string;
}

export interface TaskResource {
  assigneeId: string | null;
  queueRole: string | null;
}

/** A queued task, with the product line of the project it belongs to (empty outside a project). */
export interface ClaimResource extends TaskResource {
  productLineId: string | null;
}

interface Rule<R> {
  /** Checked before the handler runs, without the record. */
  endpoint: (actor: Actor | null) => Decision;
  /** Checked once the record is loaded. */
  resource?: (actor: Actor, resource: R) => Decision;
}

const allow: Decision = { allowed: true };
const deny = (...whoCan: string[]): Decision => ({ allowed: false, code: 'NOT_ALLOWED', whoCan });

const anyone = (): Decision => allow;
const signedIn = (actor: Actor | null): Decision =>
  actor ? allow : { allowed: false, code: 'NOT_SIGNED_IN', whoCan: ['Anyone signed in'] };

/** Until attachments exist, only the uploader may use a file. Attachments will widen this. */
const uploaderOnly = (actor: Actor, file: FileResource): Decision =>
  actor.userId === file.uploadedBy ? allow : deny('The person who uploaded it');

const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name]));
const roleNames = (keys: string[]) =>
  keys.map((k) => (k === 'team' ? 'The project team' : (ROLE_NAMES.get(k) ?? k)));

/** Endpoint rule: signed in, with one of these roles. */
const onlyRoles =
  (...keys: string[]) =>
  (actor: Actor | null): Decision => {
    const signed = signedIn(actor);
    if (!signed.allowed) return signed;
    return keys.includes((actor as Actor).roleKey) ? allow : deny(...roleNames(keys));
  };

/**
 * Who may act within a project (docs/roles-and-access.md): the Board, the VP and the Head on any
 * project, a Lead on their product line's, everyone else on projects they are a team member of.
 */
export function inScope(actor: Actor, scope: Scope): boolean {
  if (['board', 'vp', 'rd_head'].includes(actor.roleKey)) return true;
  if (scope.memberIds.includes(actor.userId)) return true;
  return (
    actor.roleKey === 'rd_lead' &&
    !!scope.productLineId &&
    actor.productLineId === scope.productLineId
  );
}

const inRoles = (actor: Actor, scope: RoleScope): Decision => {
  const roleOk =
    scope.roles.includes(actor.roleKey) ||
    (scope.roles.includes('team') && scope.memberIds.includes(actor.userId));
  if (!roleOk) return deny(...roleNames(scope.roles));
  return inScope(actor, scope) ? allow : deny('Members of this project');
};

const ownerOnly = (actor: Actor, owned: OwnedResource): Decision =>
  actor.userId === owned.ownerId ? allow : deny('The person it belongs to');

const ownTask = (actor: Actor, task: TaskResource): Decision =>
  task.assigneeId === actor.userId ? allow : deny('The person it is assigned to');

const queuedForMyRole = (actor: Actor, task: TaskResource): Decision =>
  task.assigneeId === null && task.queueRole === actor.roleKey
    ? allow
    : deny(...roleNames(task.queueRole ? [task.queueRole] : []));

/**
 * Anyone with the role may claim from its queue, but a Lead's scope is their product line: a
 * Lead can't claim, and so can't join, another line's project.
 */
const claimable = (actor: Actor, task: ClaimResource): Decision => {
  const queued = queuedForMyRole(actor, task);
  if (!queued.allowed) return queued;
  const otherLine =
    actor.roleKey === 'rd_lead' &&
    task.productLineId !== null &&
    actor.productLineId !== task.productLineId;
  return otherLine ? deny('The R&D Lead of this product line') : allow;
};

export const RULES = {
  'auth.signUp': { endpoint: anyone },
  'auth.signIn': { endpoint: anyone },
  'auth.signOut': { endpoint: signedIn },
  'me.read': { endpoint: signedIn },
  'me.update': { endpoint: signedIn },
  'users.read': { endpoint: signedIn },
  'org.read': { endpoint: anyone },
  'rnd.productLines.read': { endpoint: anyone },
  'files.upload': { endpoint: signedIn, resource: uploaderOnly },
  'files.read': { endpoint: signedIn, resource: uploaderOnly },
  'processes.read': { endpoint: signedIn },
  // Status is open to everyone signed in; content rules come with documents (docs/roles-and-access.md).
  'projects.read': { endpoint: signedIn },
  // ⚠ Only the VP creates projects (A5).
  'projects.create': { endpoint: onlyRoles('vp') },
  'projects.team.write': { endpoint: onlyRoles('rd_head', 'rd_lead'), resource: inRoles },
  'projects.hold': { endpoint: onlyRoles('vp'), resource: inRoles },
  'projects.resume': { endpoint: onlyRoles('vp'), resource: inRoles },
  'projects.drop': { endpoint: onlyRoles('vp', 'board'), resource: inRoles },
  'steps.start': { endpoint: signedIn, resource: inRoles },
  'steps.submit': { endpoint: signedIn, resource: inRoles },
  'steps.approve': { endpoint: signedIn, resource: inRoles },
  'steps.return': { endpoint: signedIn, resource: inRoles },
  'steps.decide': { endpoint: signedIn, resource: inRoles },
  'steps.sendBack': { endpoint: signedIn, resource: inRoles },
  'milestones.record': { endpoint: signedIn, resource: inRoles },
  'correctiveActions.create': { endpoint: onlyRoles('rd_lead'), resource: inRoles },
  'tasks.read': { endpoint: signedIn },
  'tasks.readOne': {
    endpoint: signedIn,
    resource: (a: Actor, t: TaskResource) => {
      const own = ownTask(a, t);
      return own.allowed ? own : queuedForMyRole(a, t);
    },
  },
  'tasks.update': { endpoint: signedIn, resource: ownTask },
  'tasks.claim': { endpoint: signedIn, resource: claimable },
  'tasks.reassign': { endpoint: onlyRoles('vp', 'rd_head', 'rd_lead'), resource: inRoles },
  // ⚠ Anyone may ask anyone for now; the ladder decides assignment versus request later (AI9).
  'tasks.create': { endpoint: signedIn },
  'ai.models.read': { endpoint: signedIn },
  'ai.chats.read': { endpoint: signedIn, resource: ownerOnly },
  'ai.chats.write': { endpoint: signedIn, resource: ownerOnly },
  'ai.proposals.decide': { endpoint: signedIn, resource: ownerOnly },
  'ai.drafts.read': { endpoint: signedIn, resource: ownerOnly },
} satisfies Record<
  PermissionKey,
  | Rule<never>
  | Rule<FileResource>
  | Rule<RoleScope>
  | Rule<TaskResource>
  | Rule<ClaimResource>
  | Rule<OwnedResource>
>;

type Rules = typeof RULES;
export type ResourceOf<K extends PermissionKey> = Rules[K] extends {
  resource: (actor: Actor, resource: infer R) => Decision;
}
  ? R
  : never;
export type ResourcePermission = {
  [K in PermissionKey]: Rules[K] extends { resource: unknown } ? K : never;
}[PermissionKey];
