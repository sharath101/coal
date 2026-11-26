import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Condition, StepKey } from '../process/definition';
import { RUN_STATUSES, STEP_STATUSES } from '../process/engine';
import { MILESTONE_STATUSES } from '../rules/schedule';
import {
  DateOnly,
  HealthEnum,
  HealthReason,
  StepHealthEnum,
  Id,
  IdParams,
  PageQuery,
  Timestamp,
  pageOf,
} from './common';
import { ProductLine } from './rnd';
import { User } from './users';

const PreviewQuery = z.object({ preview: z.stringbool().default(false) });

export const ProjectStatus = z.enum(RUN_STATUSES);
export const StepStatusEnum = z.enum(STEP_STATUSES);

export const Person = z.object({ id: Id, name: z.string() });
export const RoleRef = z.object({ key: z.string(), name: z.string() });

// Milestones: the targets the VP sets for a project (docs/dashboard.md#milestones)

export const MilestoneStatusEnum = z.enum(MILESTONE_STATUSES);

export const ProjectMilestone = z.object({
  id: Id,
  /** A route step, reached when the step is signed off, or a title in the VP's own words, ticked off by hand. */
  kind: z.enum(['step', 'own']),
  stepKey: StepKey.nullable(),
  /** The step's name, or the VP's words. */
  title: z.string(),
  targetDate: DateOnly.nullable(),
  status: MilestoneStatusEnum,
  /** Working days past the target: until today, or until it was reached. */
  daysLate: z.number().int(),
  /** A step milestone's forecast: the step's forecast end. */
  forecastDate: DateOnly.nullable(),
  reachedOn: DateOnly.nullable(),
  /** Who ticked it off (own words only). */
  reachedBy: Person.nullable(),
  /** The note given when it was ticked off. Content: only for people in the project's scope. */
  note: z.string().nullable(),
});
export type ProjectMilestone = z.infer<typeof ProjectMilestone>;

/** The next milestone not reached yet, for project cards. */
export const NextMilestone = ProjectMilestone.pick({
  id: true,
  title: true,
  targetDate: true,
  status: true,
  daysLate: true,
});

const MilestoneTitle = z.string().trim().min(2).max(120);

/** A milestone to add: a route step, or a title in your own words. */
export const MilestoneInput = z
  .object({
    stepKey: StepKey.optional(),
    title: MilestoneTitle.optional(),
    targetDate: DateOnly.optional(),
  })
  .refine((m) => (m.stepKey === undefined) !== (m.title === undefined), {
    message: 'Give a step or a title, not both.',
    path: ['title'],
  });
export type MilestoneInput = z.infer<typeof MilestoneInput>;

export const ProjectSummary = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  description: z.string(),
  productLine: ProductLine,
  status: ProjectStatus,
  stage: z.number().int(),
  /** Null once the project is dropped or finished. */
  health: HealthEnum.nullable(),
  healthReasons: z.array(HealthReason),
  plannedLaunch: DateOnly.nullable(),
  forecastLaunch: DateOnly.nullable(),
  /** The first milestone not reached yet, while the project is running. */
  nextMilestone: NextMilestone.nullable(),
  createdAt: Timestamp,
  createdBy: z.string(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const TeamMember = z.object({ user: User, addedAt: Timestamp });

/** What the signed-in person may do with the project as a whole. */
export const ProjectCan = z.object({
  hold: z.boolean(),
  resume: z.boolean(),
  drop: z.boolean(),
  editTeam: z.boolean(),
  /** Add, change and remove milestones (the VP and the R&D Head, while the project runs). */
  editMilestones: z.boolean(),
  /** Tick off a milestone in your own words, or undo it. */
  reachMilestones: z.boolean(),
});

export const ProjectDetail = ProjectSummary.extend({
  holdReason: z.string().nullable(),
  dropReason: z.string().nullable(),
  team: z.array(TeamMember),
  /** By target date, those without one last, then in route order. */
  milestones: z.array(ProjectMilestone),
  can: ProjectCan,
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

/** What an action would do, or did: the steps that move, the tasks made, the warnings (docs/api.md#conventions). */
export const PREVIEW_STEP_CHANGES = [
  'ready',
  'started',
  'submitted',
  'signed',
  'approved',
  'done',
  'returned',
  'reset',
  'cancelled',
] as const;

export const PreviewTask = z.object({
  stepKey: StepKey.nullable(),
  kind: z.string(),
  title: z.string(),
  assignee: Person.nullable(),
  queueRole: RoleRef.nullable(),
});

export const Preview = z.object({
  steps: z.array(
    z.object({
      key: StepKey,
      name: z.string(),
      iteration: z.number().int(),
      change: z.enum(PREVIEW_STEP_CHANGES),
    }),
  ),
  tasks: z.array(PreviewTask),
  cancelledTasks: z.number().int(),
  team: z.array(Person),
  warnings: z.array(z.string()),
});
export type Preview = z.infer<typeof Preview>;

export const ActionResult = z.object({ saved: z.boolean(), preview: Preview });
export type ActionResult = z.infer<typeof ActionResult>;

// Projects

export const GoBody = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  productLineId: Id,
  /** People to add to the starting team, besides the Lead, the Head and the AEMS expert. */
  teamUserIds: z.array(Id).max(30).default([]),
  /** The project's milestones, if the VP sets any now. They can be added or changed later. */
  milestones: z.array(MilestoneInput).max(20).default([]),
});

export const ProjectsQuery = PageQuery.extend({
  'filter[status]': ProjectStatus.optional(),
  'filter[productLine]': Id.optional(),
});

export const createProject = defineEndpoint({
  id: 'projects.create',
  method: 'POST',
  path: '/projects',
  summary:
    'Go: create a project from a concept. With ?preview=true, shows what would open and who gets the tasks',
  auth: 'session',
  permission: 'projects.create',
  aiTier: 'never',
  query: PreviewQuery,
  body: GoBody,
  response: z.object({
    saved: z.boolean(),
    preview: Preview,
    project: ProjectDetail.nullable(),
  }),
  status: 201,
});

export const previewGo = defineEndpoint({
  id: 'projects.previewGo',
  method: 'POST',
  path: '/projects/preview',
  summary:
    'What Go would do for this concept, without doing it: the steps that open, the tasks, and who gets them. Changes nothing, so the assistant may use it',
  auth: 'session',
  permission: 'projects.create',
  aiTier: 'read',
  body: GoBody,
  response: z.object({ preview: Preview }),
});

export const listProjects = defineEndpoint({
  id: 'projects.list',
  method: 'GET',
  path: '/projects',
  summary: "Every project's status (open to everyone signed in)",
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  query: ProjectsQuery,
  response: pageOf(ProjectSummary),
});

export const getProject = defineEndpoint({
  id: 'projects.get',
  method: 'GET',
  path: '/projects/{id}',
  summary: 'One project: status, team and what the signed-in person may do',
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  params: IdParams,
  response: ProjectDetail,
});

// The route view

/**
 * A step that is with its signers: who has not signed yet, since when, and the date they were asked
 * to sign by. The doers' tasks wait on it; the lateness is the signers', not theirs.
 */
export const SignOffWait = z.object({
  signer: RoleRef,
  /** The people who have not signed yet. Empty when it waits in the signer role's queue. */
  pending: z.array(Person),
  queued: z.boolean(),
  since: Timestamp,
  dueOn: DateOnly.nullable(),
  /** Working days past `dueOn`. */
  daysLate: z.number().int(),
  /** The last time the doers reminded them, and who did. */
  lastReminder: z.object({ at: Timestamp, by: Person }).nullable(),
  /** They can be reminded once a day. */
  remindedToday: z.boolean(),
});
export type SignOffWait = z.infer<typeof SignOffWait>;

export const StepTask = z.object({
  id: Id,
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  dueOn: DateOnly.nullable(),
  assignee: Person.nullable(),
  queueRole: RoleRef.nullable(),
});

export const DecisionView = z.object({
  key: z.string(),
  name: z.string(),
  by: RoleRef,
  options: z.array(z.object({ value: z.string(), name: z.string() })),
  answer: z.string().nullable(),
});

export const StepActionsView = z.object({
  start: z.boolean(),
  submit: z.boolean(),
  approve: z.boolean(),
  return: z.boolean(),
  decide: z.array(z.string()),
  sendBack: z.array(StepKey),
  correctiveActions: z.boolean(),
  /** Remind the signers who have not signed yet (the doers, once a day). */
  remind: z.boolean(),
});

export const StepView = z.object({
  key: StepKey,
  name: z.string(),
  stage: z.number().int(),
  checkpoint: z.boolean(),
  new: z.boolean(),
  iteration: z.number().int(),
  status: StepStatusEnum,
  path: z.string().nullable(),
  doers: z.array(RoleRef),
  signer: RoleRef.nullable(),
  outside: z.array(z.string()),
  outputs: z.array(z.string()),
  /** What a locked step still waits for. */
  waitsFor: z.array(Condition),
  /** What submitting or approving still needs. */
  submitNeeds: z.array(Condition),
  approveNeeds: z.array(Condition),
  /** The step's documents that are not made, uploaded or filled in yet: submitting waits for them. */
  documentNeeds: z.array(z.string()),
  approvedBy: z.array(Person),
  decisions: z.array(DecisionView),
  tasks: z.array(StepTask),
  /** Dates and health (docs/dashboard.md). Null until the step has dates. */
  plannedStart: DateOnly.nullable(),
  plannedEnd: DateOnly.nullable(),
  forecastEnd: DateOnly.nullable(),
  health: StepHealthEnum.nullable(),
  daysLate: z.number().int(),
  /** Late, not handed in yet, and no deviation is recorded: the doers must record one before they submit. */
  needsDeviation: z.boolean(),
  /** Handed in and with its signers: who has not signed yet and how late they are. */
  withSigners: SignOffWait.nullable(),
  /** What the signed-in person may do now. */
  actions: StepActionsView,
});
export type StepView = z.infer<typeof StepView>;

/**
 * A fact a person records that a step waits for, such as "material received" (docs/workflow.md#starting-steps).
 * The route file calls these milestones (`milestone_reached`); they are not the project's milestones.
 */
export const PrerequisiteView = z.object({
  key: z.string(),
  name: z.string(),
  /** The step it is recorded at, or null if it can be recorded any time. */
  recordedAt: StepKey.nullable(),
  recordedBy: z.array(RoleRef),
  /** The steps that wait for it, to start, submit or be approved. */
  holdsUp: z.array(StepKey),
  reached: z.boolean(),
  canRecord: z.boolean(),
});
export type PrerequisiteView = z.infer<typeof PrerequisiteView>;

export const StageView = z.object({ no: z.number().int(), name: z.string() });

export const RouteView = z.object({
  process: z.string(),
  version: z.number().int(),
  status: ProjectStatus,
  stage: z.number().int(),
  stages: z.array(StageView),
  steps: z.array(StepView),
  prerequisites: z.array(PrerequisiteView),
  openCorrectiveActions: z.number().int(),
});
export type RouteView = z.infer<typeof RouteView>;

export const getProjectRoute = defineEndpoint({
  id: 'projects.route',
  method: 'GET',
  path: '/projects/{id}/route',
  summary: "Each step's state and iteration, for the route view",
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  params: IdParams,
  response: RouteView,
});

// Team

export const TeamResponse = z.object({ items: z.array(TeamMember) });

export const getTeam = defineEndpoint({
  id: 'projects.team.get',
  method: 'GET',
  path: '/projects/{id}/team',
  summary: 'The project team',
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  params: IdParams,
  response: TeamResponse,
});

export const putTeam = defineEndpoint({
  id: 'projects.team.put',
  method: 'PUT',
  path: '/projects/{id}/team',
  summary: 'Set the project team (the Lead or the Head). Every change is recorded',
  auth: 'session',
  permission: 'projects.team.write',
  aiTier: 'confirm',
  params: IdParams,
  body: z.object({ userIds: z.array(Id).min(1).max(60) }),
  response: TeamResponse,
});

// Hold, resume and drop

export const ReasonBody = z.object({ reason: z.string().trim().min(3).max(1000) });

export const holdProject = defineEndpoint({
  id: 'projects.hold',
  method: 'POST',
  path: '/projects/{id}/hold',
  summary: 'Put the project on hold, with a reason',
  auth: 'session',
  permission: 'projects.hold',
  aiTier: 'never',
  params: IdParams,
  query: PreviewQuery,
  body: ReasonBody,
  response: ActionResult,
});

export const resumeProject = defineEndpoint({
  id: 'projects.resume',
  method: 'POST',
  path: '/projects/{id}/resume',
  summary: 'Resume a project that is on hold, with a reason',
  auth: 'session',
  permission: 'projects.resume',
  aiTier: 'never',
  params: IdParams,
  query: PreviewQuery,
  body: ReasonBody,
  response: ActionResult,
});

export const dropProject = defineEndpoint({
  id: 'projects.drop',
  method: 'POST',
  path: '/projects/{id}/drop',
  summary: 'Drop the project, with a reason. Open tasks are cancelled; every record is kept',
  auth: 'session',
  permission: 'projects.drop',
  aiTier: 'never',
  params: IdParams,
  query: PreviewQuery,
  body: ReasonBody,
  response: ActionResult,
});

// Activity

export const ActivityItem = z.object({
  id: Id,
  type: z.string(),
  at: Timestamp,
  actor: z.object({
    type: z.enum(['user', 'user_via_ai', 'system']),
    id: Id.nullable(),
    name: z.string().nullable(),
  }),
  stepKey: StepKey.nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export type ActivityItem = z.infer<typeof ActivityItem>;

export const getActivity = defineEndpoint({
  id: 'projects.activity',
  method: 'GET',
  path: '/projects/{id}/activity',
  summary: "The project's activity and history",
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  params: IdParams,
  query: PageQuery,
  response: pageOf(ActivityItem),
});

// Steps

export const StepParams = z.object({ id: Id, key: StepKey });

export const StepIteration = z.object({
  iteration: z.number().int(),
  status: StepStatusEnum,
  openedAt: Timestamp.nullable(),
  submittedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
  /** Why the iteration was closed, when a send-back reset it. */
  resetReason: z.string().nullable(),
});

export const StepDecisionRecord = z.object({
  iteration: z.number().int().nullable(),
  decision: z.string(),
  value: z.string(),
  reason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  at: Timestamp,
});

export const StepDetail = z.object({
  step: StepView,
  iterations: z.array(StepIteration),
  decisions: z.array(StepDecisionRecord),
});

export const getStep = defineEndpoint({
  id: 'steps.get',
  method: 'GET',
  path: '/projects/{id}/steps/{key}',
  summary: 'A step: its current iteration, earlier ones and its decisions',
  auth: 'session',
  permission: 'projects.read',
  aiTier: 'read',
  params: StepParams,
  response: StepDetail,
});

export const startStep = defineEndpoint({
  id: 'steps.start',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/start',
  summary: 'Start work on a step that is ready',
  auth: 'session',
  permission: 'steps.start',
  aiTier: 'confirm',
  params: StepParams,
  query: PreviewQuery,
  response: ActionResult,
});

export const submitStep = defineEndpoint({
  id: 'steps.submit',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/submit',
  summary:
    'Submit for sign-off (or mark done, for steps without one). With ?preview=true, shows what happens',
  auth: 'session',
  permission: 'steps.submit',
  aiTier: 'confirm',
  params: StepParams,
  query: PreviewQuery,
  response: ActionResult,
});

// Until passkeys (the Documents and signing block), the sign-off is a confirmed click; this
// pair is then replaced by POST /signatures and POST /signature-requests/{id}/return.
export const approveStep = defineEndpoint({
  id: 'steps.approve',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/approve',
  summary: "Sign off a step (placeholder click until passkeys). The signer's choice",
  auth: 'session',
  permission: 'steps.approve',
  aiTier: 'never',
  params: StepParams,
  query: PreviewQuery,
  response: ActionResult,
});

export const returnStep = defineEndpoint({
  id: 'steps.return',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/return',
  summary: 'Return a step to its authors with comments (placeholder until passkeys)',
  auth: 'session',
  permission: 'steps.return',
  aiTier: 'never',
  params: StepParams,
  query: PreviewQuery,
  body: z.object({ comment: z.string().trim().min(3).max(2000) }),
  response: ActionResult,
});

export const decideStep = defineEndpoint({
  id: 'steps.decide',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/decisions',
  summary: 'Record a decision at a step (placeholder click until passkeys)',
  auth: 'session',
  permission: 'steps.decide',
  aiTier: 'never',
  params: StepParams,
  query: PreviewQuery,
  body: z.object({
    decision: z.string().min(1).max(60),
    value: z.string().min(1).max(60),
    reason: z.string().trim().max(1000).optional(),
  }),
  response: ActionResult,
});

export const sendBackStep = defineEndpoint({
  id: 'steps.sendBack',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/send-back',
  summary: 'Send work back to an earlier step. With ?preview=true, shows which steps would reset',
  auth: 'session',
  permission: 'steps.sendBack',
  aiTier: 'never',
  params: StepParams,
  query: PreviewQuery,
  body: z.object({
    to: StepKey,
    reason: z.string().trim().min(3).max(2000),
    evidenceFileId: Id.optional(),
  }),
  response: ActionResult,
});

export const RemindResult = z.object({
  /** The people told. Everyone holding the signer role, when it waits in a queue. */
  reminded: z.array(Person),
  at: Timestamp,
});

export const remindSigners = defineEndpoint({
  id: 'steps.remind',
  method: 'POST',
  path: '/projects/{id}/steps/{key}/remind',
  summary:
    'Remind the signers who have not signed a step yet: each gets a notification. The doers, once a day',
  auth: 'session',
  permission: 'steps.remind',
  aiTier: 'confirm',
  params: StepParams,
  response: RemindResult,
});

export const recordPrerequisite = defineEndpoint({
  id: 'prerequisites.record',
  method: 'POST',
  path: '/projects/{id}/prerequisites',
  summary:
    'Record a prerequisite a step waits for, such as material received, with a note or a file as evidence',
  auth: 'session',
  permission: 'prerequisites.record',
  aiTier: 'confirm',
  params: IdParams,
  query: PreviewQuery,
  body: z.object({
    prerequisite: z.string().min(1).max(60),
    note: z.string().trim().max(1000).optional(),
    evidenceFileId: Id.optional(),
  }),
  response: ActionResult,
});

export const createCorrectiveAction = defineEndpoint({
  id: 'correctiveActions.create',
  method: 'POST',
  path: '/projects/{id}/corrective-actions',
  summary: 'Raise a corrective action from the case study. Step 18 waits until all are closed',
  auth: 'session',
  permission: 'correctiveActions.create',
  aiTier: 'confirm',
  params: IdParams,
  query: PreviewQuery,
  body: z.object({
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().max(2000).default(''),
    assigneeId: Id.optional(),
  }),
  response: ActionResult,
  status: 201,
});

// Milestones (docs/dashboard.md#milestones). The VP and the R&D Head set them; the assistant only reads them.

export const MilestoneParams = z.object({ id: Id, milestoneId: Id });
export const MilestoneList = z.object({ items: z.array(ProjectMilestone) });

export const addMilestone = defineEndpoint({
  id: 'milestones.add',
  method: 'POST',
  path: '/projects/{id}/milestones',
  summary:
    'Add a milestone to a project: a route step, or a title in your own words, with a target date',
  auth: 'session',
  permission: 'milestones.write',
  aiTier: 'never',
  params: IdParams,
  body: MilestoneInput,
  response: MilestoneList,
  status: 201,
});

export const updateMilestone = defineEndpoint({
  id: 'milestones.update',
  method: 'PATCH',
  path: '/projects/{id}/milestones/{milestoneId}',
  summary:
    "Change a milestone's target date (null clears it), or the title of one in your own words",
  auth: 'session',
  permission: 'milestones.write',
  aiTier: 'never',
  params: MilestoneParams,
  body: z
    .object({ title: MilestoneTitle.optional(), targetDate: DateOnly.nullable().optional() })
    .refine((b) => b.title !== undefined || b.targetDate !== undefined, {
      message: 'Give a new title or target date.',
      path: ['targetDate'],
    }),
  response: MilestoneList,
});

export const removeMilestone = defineEndpoint({
  id: 'milestones.remove',
  method: 'DELETE',
  path: '/projects/{id}/milestones/{milestoneId}',
  summary: 'Remove a milestone. Its record is kept',
  auth: 'session',
  permission: 'milestones.write',
  aiTier: 'never',
  params: MilestoneParams,
  response: MilestoneList,
});

export const reachMilestone = defineEndpoint({
  id: 'milestones.reach',
  method: 'PUT',
  path: '/projects/{id}/milestones/{milestoneId}/reached',
  summary:
    'Tick off a milestone in your own words, with a note, or undo it. A step milestone is reached when its step is signed off',
  auth: 'session',
  permission: 'milestones.reach',
  aiTier: 'never',
  params: MilestoneParams,
  body: z.object({ reached: z.boolean(), note: z.string().trim().max(1000).optional() }),
  response: MilestoneList,
});
