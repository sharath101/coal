import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Position, PositionKey, RoleKey } from './org';
import { ProductLine } from './rnd';

export const PersonName = z.string().trim().min(2).max(80);

export const UserRole = z.object({
  key: RoleKey,
  name: z.string(),
  departmentCode: z.string().nullable(),
});

/** A person's box on the org chart: what they are called there. */
export const UserPosition = z.object({ key: PositionKey, title: z.string() });

export const User = z.object({
  id: Id,
  name: z.string(),
  role: UserRole,
  position: UserPosition,
  productLine: ProductLine.nullable(),
  status: z.enum(['active', 'inactive']),
});
export type User = z.infer<typeof User>;

/** Who someone reports to: the nearest person above them on the chart. */
export const Manager = z.object({ id: Id, name: z.string(), positionTitle: z.string() });
export type Manager = z.infer<typeof Manager>;

/** My own profile. `updatedAt` is the version to send back in If-Match when editing. */
export const Me = User.extend({ updatedAt: Timestamp, reportsTo: Manager.nullable() });
export type Me = z.infer<typeof Me>;

/** What is switched on or set in this deployment, so the website hides what is parked and knows its limits (docs/architecture.md). */
export const Features = z.object({
  /** Filling templates in COAL: fields from records, the document form, the assistant drafting a template. */
  templateFilling: z.boolean(),
  /** The largest file that may be attached to a message in the AI chat, in bytes (`AI_UPLOAD_MAX_MB`). */
  chatUploadMaxBytes: z.number().int().positive(),
  /** The assistant can look things up on the web here (`AI_WEB`, and a provider with a web search). */
  aiWeb: z.boolean(),
});
export type Features = z.infer<typeof Features>;

/**
 * `GET /me`: my profile and what is switched on. `switcher` is the admin behind this session, when
 * there is one: the demo's way of moving between people (docs/roles-and-access.md#switching-people-for-the-demo).
 */
export const MeView = Me.extend({
  features: Features,
  switcher: z.object({ id: Id, name: z.string() }).nullable(),
});
export type MeView = z.infer<typeof MeView>;

export const SessionResponse = z.object({ user: Me });

export const SignUpBody = z.object({
  name: PersonName,
  positionKey: PositionKey,
  /** For a position counted by product line (a Lead, a design engineer). */
  productLineId: Id.optional(),
});
export type SignUpBody = z.infer<typeof SignUpBody>;

export const SignInBody = z.object({
  name: z.string().trim().min(1).max(80),
});

export const UpdateMeBody = z
  .object({
    name: PersonName.optional(),
    positionKey: PositionKey.optional(),
    productLineId: Id.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Change at least one thing',
  });

export const UsersQuery = PageQuery.extend({
  'filter[role]': RoleKey.optional(),
  q: z.string().trim().max(80).optional(),
});

// Accounts are a placeholder until real sign-in (docs/roles-and-access.md#accounts-for-now).

export const signUp = defineEndpoint({
  id: 'auth.signUp',
  method: 'POST',
  path: '/auth/sign-up',
  summary: 'Create an account with a name and a role (placeholder). Starts a session',
  auth: 'public',
  permission: 'auth.signUp',
  aiTier: 'none',
  body: SignUpBody,
  response: SessionResponse,
  status: 201,
});

export const signIn = defineEndpoint({
  id: 'auth.signIn',
  method: 'POST',
  path: '/auth/sign-in',
  summary: 'Sign in by name (placeholder). Starts a session',
  auth: 'public',
  permission: 'auth.signIn',
  aiTier: 'none',
  body: SignInBody,
  response: SessionResponse,
});

export const SwitchBody = z.object({ userId: Id });

/**
 * A stand-in for the demo, like name-only sign-in, to be removed before the hand-off
 * (docs/roles-and-access.md#switching-people-for-the-demo).
 */
export const switchPerson = defineEndpoint({
  id: 'auth.switch',
  method: 'POST',
  path: '/auth/switch',
  summary:
    'Demo only: the admin takes the place of another person, or goes back to being the admin',
  auth: 'session',
  permission: 'auth.switch',
  aiTier: 'none',
  body: SwitchBody,
  response: SessionResponse,
});

export const signOut = defineEndpoint({
  id: 'auth.signOut',
  method: 'POST',
  path: '/auth/sign-out',
  summary: 'End the session',
  auth: 'session',
  permission: 'auth.signOut',
  aiTier: 'none',
  status: 204,
});

export const getMe = defineEndpoint({
  id: 'me.get',
  method: 'GET',
  path: '/me',
  summary: 'My profile, role and product line, and what is switched on',
  auth: 'session',
  permission: 'me.read',
  aiTier: 'read',
  response: MeView,
});

export const updateMe = defineEndpoint({
  id: 'me.update',
  method: 'PATCH',
  path: '/me',
  summary: 'Change my name, role or product line (only until there is an admin)',
  auth: 'session',
  permission: 'me.update',
  aiTier: 'none',
  body: UpdateMeBody,
  response: Me,
});

export const listUsers = defineEndpoint({
  id: 'users.list',
  method: 'GET',
  path: '/users',
  summary: 'The people directory',
  auth: 'session',
  permission: 'users.read',
  aiTier: 'read',
  query: UsersQuery,
  response: pageOf(User),
});

/** A box on the chart, with the people who hold it. */
export const ChartPosition = Position.extend({
  holders: z.array(z.object({ id: Id, name: z.string(), productLine: ProductLine.nullable() })),
});
export type ChartPosition = z.infer<typeof ChartPosition>;

export const OrgChartResponse = z.object({ positions: z.array(ChartPosition) });
export type OrgChartResponse = z.infer<typeof OrgChartResponse>;

export const getOrgChart = defineEndpoint({
  id: 'org.chart',
  method: 'GET',
  path: '/org-chart',
  summary: 'The org chart: every position, who reports to whom, and who holds each',
  auth: 'session',
  permission: 'org.chart',
  aiTier: 'read',
  response: OrgChartResponse,
});

export const getUser = defineEndpoint({
  id: 'users.get',
  method: 'GET',
  path: '/users/{id}',
  summary: 'One person in the directory',
  auth: 'session',
  permission: 'users.read',
  aiTier: 'read',
  params: IdParams,
  response: User,
});
