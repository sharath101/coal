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
  uploadedBy: string | null;
  /** A record the person may see holds this file: a document version, an attachment, a template. */
  viaRecord?: boolean;
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

/** Only the person who uploaded a file may finish its upload. */
const uploaderOnly = (actor: Actor, file: FileResource): Decision =>
  actor.userId === file.uploadedBy ? allow : deny('The person who uploaded it');

/** The uploader, or anyone who may see a record that holds the file (docs/roles-and-access.md). */
const uploaderOrRecord = (actor: Actor, file: FileResource): Decision =>
  actor.userId === file.uploadedBy || file.viaRecord
    ? allow
    : deny('The person who uploaded it', 'People who can see the record it belongs to');

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

/** A template version. Everyone reads the active one; drafts and retired versions are for the VP and the Head. */
export interface TemplateResource {
  status: 'draft' | 'active' | 'retired';
}

const templateReadable = (actor: Actor, template: TemplateResource): Decision =>
  template.status === 'active' || ['vp', 'rd_head'].includes(actor.roleKey)
    ? allow
    : deny(...roleNames(['vp', 'rd_head']));

/** A document, and what decides who may read it (docs/roles-and-access.md#content-is-need-to-know). */
export interface DocumentResource extends Scope {
  sensitivity: 'normal' | 'budget';
  /** Its step is signed by the Board (steps 4 and 23). */
  boardPaper: boolean;
  /** Its step is a checkpoint. The Board reads checkpoint papers. */
  checkpoint: boolean;
  /** Roles and people asked to sign a version of it: signers see what they sign. */
  addressedRoles: string[];
  addressedUserIds: string[];
}

export type DocumentAccess = 'full' | 'outcome' | 'none';

const ROLE_DEPARTMENTS = new Map(ROLES.map((r) => [r.key, r.department]));
/** Roles of departments other than R&D (QA, QC, production, marketing), who see only what is sent to them. */
const outsideRnd = (roleKey: string) => {
  const department = ROLE_DEPARTMENTS.get(roleKey);
  return !!department && department !== 'RND';
};

/** Asked to sign: named, or holding the asked role in the project's scope (outside R&D, anywhere). */
const isAddressed = (
  actor: Actor,
  who: { roleKeys: string[]; userIds: string[] },
  scope: Scope,
): boolean =>
  who.userIds.includes(actor.userId) ||
  (who.roleKeys.includes(actor.roleKey) && (inScope(actor, scope) || outsideRnd(actor.roleKey)));

/**
 * What a person gets of a document: `full` (its content), `outcome` (that it exists and where it
 * stands, for a Lead on a Board paper) or `none`. Anything not listed is denied.
 */
export function documentAccess(actor: Actor, d: DocumentResource): DocumentAccess {
  if (isAddressed(actor, { roleKeys: d.addressedRoles, userIds: d.addressedUserIds }, d)) {
    return 'full';
  }
  const senior = ['board', 'vp', 'rd_head'].includes(actor.roleKey);
  const ownLine =
    actor.roleKey === 'rd_lead' && !!d.productLineId && actor.productLineId === d.productLineId;
  const onTeam = d.memberIds.includes(actor.userId);

  if (d.sensitivity === 'budget') {
    return senior || ownLine || (actor.roleKey === 'rd_ops' && onTeam) ? 'full' : 'none';
  }
  if (d.boardPaper) {
    if (senior) return 'full';
    return ownLine ? 'outcome' : 'none';
  }
  if (actor.roleKey === 'board') return d.checkpoint ? 'full' : 'none';
  return actor.roleKey === 'vp' || actor.roleKey === 'rd_head' || ownLine || onTeam
    ? 'full'
    : 'none';
}

/** Drafts are for the people who work on the step. Everyone else sees a version once it is submitted. */
export function canSeeDrafts(actor: Actor, scope: Scope): boolean {
  return actor.roleKey !== 'board' && inScope(actor, scope);
}

/** The whole of the document's access, as a rule: anything but `none` may open it. */
const documentReadable = (actor: Actor, d: DocumentResource): Decision =>
  documentAccess(actor, d) === 'none'
    ? deny(
        ...(d.sensitivity === 'budget'
          ? [
              'Board',
              'VP',
              'R&D Head',
              'The R&D Lead of this product line',
              'R&D Ops on the project',
            ]
          : ['People on the project', 'People asked to sign it']),
      )
    : allow;

/** A signature row: the person named, or anyone with one of the roles who is in the project's scope. */
export interface SignatureResource extends Scope {
  roleKeys: string[];
  assigneeId: string | null;
}

const mayReachRequest = (actor: Actor, r: SignatureResource): Decision => {
  if (r.assigneeId) {
    return r.assigneeId === actor.userId ? allow : deny('The person it was sent to');
  }
  return isAddressed(actor, { roleKeys: r.roleKeys, userIds: [] }, r)
    ? allow
    : deny(...roleNames(r.roleKeys));
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
  'files.read': { endpoint: signedIn, resource: uploaderOrRecord },
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
  'documentTypes.read': { endpoint: signedIn },
  'templates.read': { endpoint: signedIn, resource: templateReadable },
  'templates.write': { endpoint: onlyRoles('vp', 'rd_head') },
  // ⚠ The VP or the Head activates, including their own upload (S6).
  'templates.activate': { endpoint: onlyRoles('vp', 'rd_head') },
  // The list shows each person what they may see; each document has its own rule.
  'documents.list': { endpoint: signedIn },
  'documents.read': { endpoint: signedIn, resource: documentReadable },
  'documents.create': { endpoint: signedIn, resource: inRoles },
  'documents.write': { endpoint: signedIn, resource: inRoles },
  'documents.submit': { endpoint: signedIn, resource: inRoles },
  'signatures.read': { endpoint: signedIn },
  'signatures.sign': { endpoint: signedIn, resource: mayReachRequest },
  'signatures.return': { endpoint: signedIn, resource: mayReachRequest },
  'attachments.read': { endpoint: signedIn },
  'attachments.write': { endpoint: signedIn, resource: inRoles },
  'sources.read': { endpoint: signedIn },
  'sources.write': { endpoint: signedIn, resource: inRoles },
} satisfies Record<
  PermissionKey,
  | Rule<never>
  | Rule<FileResource>
  | Rule<RoleScope>
  | Rule<TaskResource>
  | Rule<ClaimResource>
  | Rule<TemplateResource>
  | Rule<DocumentResource>
  | Rule<SignatureResource>
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
