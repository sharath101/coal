import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import { DateOnly, Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Person, RoleRef, SignOffWait } from './projects';

export const TASK_KINDS = [
  'work',
  'review',
  'sign',
  'decision',
  'corrective_action',
  'request',
  'own',
] as const;
export const TASK_STATUSES = [
  'open',
  'in_progress',
  'waiting',
  'done',
  'declined',
  'cancelled',
] as const;

export const Task = z.object({
  id: Id,
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  body: z.string(),
  status: z.enum(TASK_STATUSES),
  stepKey: z.string().nullable(),
  assignee: Person.nullable(),
  /** The role whose queue holds it, until someone claims it. */
  queueRole: RoleRef.nullable(),
  /** When it is due now (a person's new date from a deviation moves it), and whether that has passed. */
  dueOn: DateOnly.nullable(),
  daysLate: z.number().int(),
  /** What the task belongs to, such as a project, for linking. */
  subject: z.object({ type: z.string(), id: Id, label: z.string() }).nullable(),
  /** The product line of the project it belongs to, to divide lists by line; null on no project. */
  productLine: z.object({ id: Id, name: z.string() }).nullable(),
  /** Made by the route for a step: its dates are on the plan, and a late one needs a deviation. */
  onPlan: z.boolean(),
  /**
   * Its status follows its step (open, waiting while with the signer, done when the step is signed
   * off), so it is started and handed in from the step, never by hand. Corrective actions, own
   * tasks, assignments and requests are not like this.
   */
  followsStep: z.boolean(),
  /** A doer's task that is waiting: the signers it waits on. Null otherwise. */
  waitingOn: SignOffWait.nullable(),
  /** Who gave it or asked for it; empty for work the route made. */
  assignedBy: Person.nullable(),
  /** Prepared by the AI in the Workstation, and confirmed by the person who gave it. */
  viaAi: z.boolean(),
  /** A request waits for its assignee to accept or decline it. Empty for anything else. */
  request: z
    .object({
      state: z.enum(['pending', 'accepted', 'declined']),
      declineReason: z.string().nullable(),
    })
    .nullable(),
  createdAt: Timestamp,
});
export type Task = z.infer<typeof Task>;

export const TasksQuery = PageQuery.extend({
  /** `mine`: assigned to me. `queue`: waiting in the queue of my role. `sent`: what I gave or asked others for. */
  scope: z.enum(['mine', 'queue', 'sent']).default('mine'),
  'filter[status]': z.enum(['active', 'closed']).default('active'),
});

export const listTasks = defineEndpoint({
  id: 'tasks.list',
  method: 'GET',
  path: '/tasks',
  summary: 'My tasks, or the tasks waiting in my role queue',
  auth: 'session',
  permission: 'tasks.read',
  aiTier: 'read',
  query: TasksQuery,
  response: pageOf(Task),
});

export const getTask = defineEndpoint({
  id: 'tasks.get',
  method: 'GET',
  path: '/tasks/{id}',
  summary: 'One task: mine, or one waiting in my role queue',
  auth: 'session',
  permission: 'tasks.readOne',
  aiTier: 'read',
  params: IdParams,
  response: Task,
});

export const updateTask = defineEndpoint({
  id: 'tasks.update',
  method: 'PATCH',
  path: '/tasks/{id}',
  summary:
    'Update the status of one of my own tasks, assignments or requests, or a corrective action. A task of a step follows its step and is refused (`USE_THE_STEP`)',
  auth: 'session',
  permission: 'tasks.update',
  aiTier: 'auto',
  params: IdParams,
  body: z.object({ status: z.enum(['open', 'in_progress', 'done']) }),
  response: Task,
});

export const claimTask = defineEndpoint({
  id: 'tasks.claim',
  method: 'POST',
  path: '/tasks/{id}/claim',
  summary: 'Claim a task from my role queue. The project team gains me if I am not on it',
  auth: 'session',
  permission: 'tasks.claim',
  aiTier: 'confirm',
  params: IdParams,
  response: Task,
});

export const reassignTask = defineEndpoint({
  id: 'tasks.reassign',
  method: 'POST',
  path: '/tasks/{id}/reassign',
  summary: 'Give a task to someone who holds its role (the Lead, the Head or the VP)',
  auth: 'session',
  permission: 'tasks.reassign',
  aiTier: 'confirm',
  params: IdParams,
  body: z.object({ assigneeId: Id }),
  response: Task,
});

export const CreateTaskBody = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().max(2000).default(''),
  /** Who it is for. Left out: me. */
  assigneeId: Id.optional(),
  dueOn: DateOnly.optional(),
  /** The project it belongs to, and optionally its step. Only for people who work on the project. */
  projectId: Id.optional(),
  stepKey: StepKey.optional(),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;

export const CreatedTask = z.object({
  saved: z.boolean(),
  /** Its kind says what it became: `own` for myself, `work` when I may assign it to them, otherwise a `request` (docs/roles-and-access.md#assigning-work-and-making-requests). */
  task: Task,
  warnings: z.array(z.string()),
});
export type CreatedTask = z.infer<typeof CreatedTask>;

export const createTask = defineEndpoint({
  id: 'tasks.create',
  method: 'POST',
  path: '/tasks',
  summary:
    'Make a task for myself, assign work to someone below me on the ladder, or ask anyone else (a request). With ?preview=true, shows which it would be',
  auth: 'session',
  permission: 'tasks.create',
  // The AI makes the user's own tasks directly; work for anyone else goes on an action card.
  aiTier: 'auto',
  query: z.object({ preview: z.stringbool().default(false) }),
  body: CreateTaskBody,
  response: CreatedTask,
  status: 201,
});

export const acceptTask = defineEndpoint({
  id: 'tasks.accept',
  method: 'POST',
  path: '/tasks/{id}/accept',
  summary: 'Accept a request made of me: it becomes my task',
  auth: 'session',
  permission: 'tasks.answer',
  aiTier: 'confirm',
  params: IdParams,
  response: Task,
});

export const declineTask = defineEndpoint({
  id: 'tasks.decline',
  method: 'POST',
  path: '/tasks/{id}/decline',
  summary: 'Decline a request made of me, with a reason the person who asked will see',
  auth: 'session',
  permission: 'tasks.answer',
  aiTier: 'confirm',
  params: IdParams,
  body: z.object({ reason: z.string().trim().min(3).max(500) }),
  response: Task,
});
