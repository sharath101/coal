import type { PermissionKey } from '@coal/shared';
import type { Actor } from '../../core/http/context';
import { ROLES, positionSeed } from '../org/catalogue';
import { inRnd, isAboveOnChart, positionAbove, type Placed } from '../org/chart';

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
  /** Who gave it or asked for it. */
  assignedBy?: string | null;
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

/** Demo only (P113): an admin is behind this session, because switching is on and they started it. */
const adminBehindSession = (actor: Actor | null): Decision => {
  const signed = signedIn(actor);
  if (!signed.allowed) return signed;
  return (actor as Actor).switcherId ? allow : deny('The demo admin');
};

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

/** Mine, waiting in my role's queue, or given or asked for by me. */
const taskReadable = (actor: Actor, task: TaskResource): Decision => {
  if (task.assignedBy === actor.userId) return allow;
  const own = ownTask(actor, task);
  return own.allowed ? own : queuedForMyRole(actor, task);
};

/** A new task may belong to a project only for the people who work on it. */
export interface NewTaskResource {
  project: Scope | null;
}

const mayLinkTask = (actor: Actor, r: NewTaskResource): Decision =>
  !r.project || inScope(actor, r.project) ? allow : deny('Members of this project');

/**
 * What giving someone work becomes (docs/roles-and-access.md#assigning-work-and-making-requests):
 * my `own` task, `work` assigned to someone below me whom I may direct, or a `request` they
 * accept or decline. `onLineTeam`: the person is on a project of my product line. The Board
 * assigns only to the VP; everyone else to the people below them on the org chart who work in
 * R&D, and a Lead also to everyone on their line's project teams.
 */
export function howToGive(
  actor: Actor,
  assignee: Person & { id: string },
  onLineTeam: boolean,
): 'own' | 'work' | 'request' {
  if (assignee.id === actor.userId) return 'own';
  if (actor.roleKey === 'board') return assignee.roleKey === 'vp' ? 'work' : 'request';
  if (!isAbove(actor, assignee, onLineTeam)) return 'request';
  return inRnd(assignee.positionKey) ? 'work' : 'request';
}

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

/** Where a person sits: their role, their box on the org chart and their product line. */
export interface Person extends Placed {
  roleKey: string;
}

/** A person nobody is above: for a record whose person has gone. */
export const NO_ONE: Person = { roleKey: '', positionKey: '', productLineId: null };

/** The people a Lead runs by their line's projects, besides the ones below them on the chart. */
export const isTeamStaff = (roleKey: string): boolean =>
  ROLE_DEPARTMENTS.get(roleKey) === 'RND' && roleKey !== 'rd_head' && roleKey !== 'rd_lead';

/**
 * Is `actor` above `person`: on the org chart, or the Lead of the line `person` works on? A Lead
 * runs the projects of their line, so on those they stand above everyone in R&D who is on the
 * team (P112). `onLine`: the person works on a project of the actor's line.
 */
export function isAbove(actor: Person, person: Person, onLine: boolean): boolean {
  return (
    isAboveOnChart(actor, person) ||
    (actor.roleKey === 'rd_lead' && onLine && isTeamStaff(person.roleKey))
  );
}

/** The title of the position one step up the chart, if any. */
export const titleAbove = (positionKey: string): string | null => {
  const up = positionAbove(positionKey);
  return up ? (positionSeed(up)?.title ?? up) : null;
};

/** A task being explained: its assignee, and the project's scope. */
export interface DeviationRecordResource extends Scope {
  assigneeId: string | null;
}

const mayRecordDeviation = (actor: Actor, r: DeviationRecordResource): Decision => {
  if (r.assigneeId === actor.userId) return allow;
  if (['rd_lead', 'rd_head'].includes(actor.roleKey) && inScope(actor, r)) return allow;
  return deny('The person the task is assigned to', 'R&D Lead', 'R&D Head');
};

/** A deviation waiting to be confirmed: who recorded it and where they sit, and the project's scope. */
export interface DeviationReviewResource extends Scope {
  recorder: Person;
  recordedById: string;
}

/** Someone above the person who recorded it, in the project's scope; never the person who recorded it. */
const mayReviewDeviation = (actor: Actor, r: DeviationReviewResource): Decision => {
  const onLine = !!actor.productLineId && actor.productLineId === r.productLineId;
  const ok =
    actor.userId !== r.recordedById && isAbove(actor, r.recorder, onLine) && inScope(actor, r);
  if (ok) return allow;
  const up = titleAbove(r.recorder.positionKey);
  const who = [
    ...(up ? [up] : []),
    ...(isTeamStaff(r.recorder.roleKey) ? ['The R&D Lead of this product line'] : []),
  ];
  return deny(...(who.length > 0 ? who : ['Nobody: it is at the top of the line']));
};

/** A deviation's named cause, and the project's scope. */
export interface DeviationCauseResource extends Scope {
  causeUserId: string | null;
  causeRole: string | null;
}

const mayCommentOnDeviation = (actor: Actor, r: DeviationCauseResource): Decision => {
  const named =
    r.causeUserId === actor.userId ||
    (r.causeRole !== null &&
      r.causeUserId === null &&
      actor.roleKey === r.causeRole &&
      inScope(actor, r));
  return named ? allow : deny('The person or role named as the cause');
};

/**
 * Who sees a deviation's cause by name (docs/roles-and-access.md#content-is-need-to-know): the VP
 * and the Head see everyone; a person sees themselves and the people below them on the chart, and a
 * Lead everyone of their line's projects; the Board sees no names.
 */
export function causeNameVisible(
  actor: Actor,
  cause: { userId: string | null; user: Person | null } & Scope,
): boolean {
  if (['vp', 'rd_head'].includes(actor.roleKey)) return true;
  if (cause.userId === null) return inScope(actor, cause);
  if (cause.userId === actor.userId) return true;
  // The Board sees department totals, never a named person (A3).
  if (actor.roleKey === 'board' || !cause.user) return false;
  const onLine = !!actor.productLineId && actor.productLineId === cause.productLineId;
  return inScope(actor, cause) && isAbove(actor, cause.user, onLine);
}

/** A notification belongs to the person it was sent to. */
const ownNotification = (actor: Actor, n: { userId: string }): Decision =>
  n.userId === actor.userId ? allow : deny('The person it was sent to');

/** A proposal is for the person it was prepared for: only they see, change and confirm it. */
export interface ProposalResource {
  forUserId: string;
}

const ownProposal = (actor: Actor, p: ProposalResource): Decision =>
  p.forUserId === actor.userId ? allow : deny('The person it was prepared for');

/** A chat is private to the person who started it, whatever their role (docs/roles-and-access.md#content-is-need-to-know). */
export interface ChatResource {
  userId: string;
}

const ownChat = (actor: Actor, c: ChatResource): Decision =>
  c.userId === actor.userId ? allow : deny('The person who started the chat');

/** A research run is private to the person who ran it, like a chat: its results are outside material until kept. */
export interface ResearchRunResource {
  userId: string;
}

const ownRun = (actor: Actor, r: ResearchRunResource): Decision =>
  r.userId === actor.userId ? allow : deny('The person who ran it');

export const RULES = {
  'auth.signUp': { endpoint: anyone },
  'auth.signIn': { endpoint: anyone },
  'auth.signOut': { endpoint: signedIn },
  // Demo only (P113): the admin behind this session, while switching is on.
  'auth.switch': { endpoint: adminBehindSession },
  'me.read': { endpoint: signedIn },
  'me.update': { endpoint: signedIn },
  'users.read': { endpoint: signedIn },
  'org.read': { endpoint: anyone },
  // Who reports to whom and who holds each position is open to everyone signed in.
  'org.chart': { endpoint: signedIn },
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
  // The doers who handed the step in (docs/dashboard.md#deadlines-alerts-and-deviations).
  'steps.remind': { endpoint: signedIn, resource: inRoles },
  'steps.approve': { endpoint: signedIn, resource: inRoles },
  'steps.return': { endpoint: signedIn, resource: inRoles },
  'steps.decide': { endpoint: signedIn, resource: inRoles },
  'steps.sendBack': { endpoint: signedIn, resource: inRoles },
  'milestones.record': { endpoint: signedIn, resource: inRoles },
  'correctiveActions.create': { endpoint: onlyRoles('rd_lead'), resource: inRoles },
  'tasks.read': { endpoint: signedIn },
  'tasks.readOne': { endpoint: signedIn, resource: taskReadable },
  'tasks.update': { endpoint: signedIn, resource: ownTask },
  'tasks.claim': { endpoint: signedIn, resource: claimable },
  'tasks.reassign': { endpoint: onlyRoles('vp', 'rd_head', 'rd_lead'), resource: inRoles },
  // Anyone may make their own tasks and ask anyone; the ladder decides what it becomes.
  'tasks.create': { endpoint: signedIn, resource: mayLinkTask },
  'tasks.answer': { endpoint: signedIn, resource: ownTask },
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
  'timeline.read': { endpoint: signedIn },
  'timeline.plan': { endpoint: signedIn, resource: inRoles },
  // ⚠ The Head changes dates; the VP too, and only the VP, if the launch moves (W13).
  'timeline.change': { endpoint: onlyRoles('rd_head', 'vp'), resource: inRoles },
  'deviations.read': { endpoint: signedIn },
  'deviations.record': { endpoint: signedIn, resource: mayRecordDeviation },
  'deviations.review': { endpoint: signedIn, resource: mayReviewDeviation },
  'deviations.comment': { endpoint: signedIn, resource: mayCommentOnDeviation },
  'notifications.read': { endpoint: signedIn },
  'notifications.markRead': { endpoint: signedIn, resource: ownNotification },
  'notifications.markAllRead': { endpoint: signedIn },
  'widgets.read': { endpoint: signedIn },
  'proposals.create': { endpoint: signedIn },
  'proposals.list': { endpoint: signedIn },
  'proposals.read': { endpoint: signedIn, resource: ownProposal },
  'proposals.write': { endpoint: signedIn, resource: ownProposal },
  // Each result is filtered by the rule of what it is (docs/roles-and-access.md#how-access-is-enforced).
  'search.read': { endpoint: signedIn },
  'ai.chats.create': { endpoint: signedIn },
  'ai.chats.list': { endpoint: signedIn },
  'ai.chats.read': { endpoint: signedIn, resource: ownChat },
  'ai.chats.write': { endpoint: signedIn, resource: ownChat },
  'ai.feedback': { endpoint: signedIn, resource: ownChat },
  'ai.attachments.read': { endpoint: signedIn, resource: ownChat },
  'research.sources.read': { endpoint: signedIn },
  // ⚠ The VP, the R&D Head and the R&D Leads keep the source library (A11).
  'research.sources.write': { endpoint: onlyRoles('vp', 'rd_head', 'rd_lead') },
  // ⚠ The people of steps C, 1 and 2 research: the VP, the R&D Head, the R&D Leads and R&D Ops (A11).
  'research.run': { endpoint: onlyRoles('vp', 'rd_head', 'rd_lead', 'rd_ops') },
  'research.read': { endpoint: signedIn, resource: ownRun },
  'research.write': { endpoint: signedIn, resource: ownRun },
} satisfies Record<
  PermissionKey,
  | Rule<never>
  | Rule<FileResource>
  | Rule<RoleScope>
  | Rule<TaskResource>
  | Rule<ClaimResource>
  | Rule<NewTaskResource>
  | Rule<TemplateResource>
  | Rule<DocumentResource>
  | Rule<SignatureResource>
  | Rule<DeviationRecordResource>
  | Rule<DeviationReviewResource>
  | Rule<DeviationCauseResource>
  | Rule<{ userId: string }>
  | Rule<ProposalResource>
  | Rule<ChatResource>
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
