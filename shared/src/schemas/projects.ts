import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Condition, StepKey } from '../process/definition';
import { RUN_STATUSES, STEP_STATUSES } from '../process/engine';
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
});

export const ProjectDetail = ProjectSummary.extend({
  holdReason: z.string().nullable(),
  dropReason: z.string().nullable(),
  team: z.array(TeamMember),
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
  /** Late, and no deviation is recorded yet: the doers must record one before they submit. */
  needsDeviation: z.boolean(),
  /** What the signed-in person may do now. */
  actions: StepActionsView,
});
export type StepView = z.infer<typeof StepView>;

export const MilestoneView = z.object({
  key: z.string(),
  name: z.string(),
  recordedAt: StepKey.nullable(),
  recordedBy: z.array(RoleRef),
  reached: z.boolean(),
  canRecord: z.boolean(),
});

export const StageView = z.object({ no: z.number().int(), name: z.string() });

export const RouteView = z.object({
  process: z.string(),
  version: z.number().int(),
  status: ProjectStatus,
  stage: z.number().int(),
  stages: z.array(StageView),
  steps: z.array(StepView),
  milestones: z.array(MilestoneView),
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

export const recordMilestone = defineEndpoint({
  id: 'milestones.record',
  method: 'POST',
  path: '/projects/{id}/milestones',
  summary: 'Record a milestone, with a note or a file as evidence',
  auth: 'session',
  permission: 'milestones.record',
  aiTier: 'confirm',
  params: IdParams,
  query: PreviewQuery,
  body: z.object({
    milestone: z.string().min(1).max(60),
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
