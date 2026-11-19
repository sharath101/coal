import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Person, RoleRef } from './projects';

const PreviewQuery = z.object({ preview: z.stringbool().default(false) });

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
  /** What the task belongs to, such as a project, for linking. */
  subject: z.object({ type: z.string(), id: Id, label: z.string() }).nullable(),
  createdAt: Timestamp,
});
export type Task = z.infer<typeof Task>;

export const TasksQuery = PageQuery.extend({
  /** `mine`: assigned to me. `queue`: waiting in the queue of my role. */
  scope: z.enum(['mine', 'queue']).default('mine'),
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
  summary: 'Update the status of one of my tasks',
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
  assigneeId: Id,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).default(''),
  /** The project it belongs to, if any. */
  projectId: Id.optional(),
  stepKey: z.string().max(8).optional(),
});

export const CreatedTask = z.object({ saved: z.boolean(), task: Task });

/** Asks someone to do something: a request task (docs/workstation-and-ai.md#assigning-work). */
export const createTask = defineEndpoint({
  id: 'tasks.create',
  method: 'POST',
  path: '/tasks',
  summary: 'Ask someone to do something. It becomes a request in their tasks',
  auth: 'session',
  permission: 'tasks.create',
  aiTier: 'confirm',
  query: PreviewQuery,
  body: CreateTaskBody,
  response: CreatedTask,
  status: 201,
});
