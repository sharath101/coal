import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { RoleKey } from './org';
import { ProductLine } from './rnd';

export const PersonName = z.string().trim().min(2).max(80);

export const UserRole = z.object({
  key: RoleKey,
  name: z.string(),
  departmentCode: z.string().nullable(),
});

export const User = z.object({
  id: Id,
  name: z.string(),
  role: UserRole,
  productLine: ProductLine.nullable(),
  status: z.enum(['active', 'inactive']),
});
export type User = z.infer<typeof User>;

/** My own profile. `updatedAt` is the version to send back in If-Match when editing. */
export const Me = User.extend({ updatedAt: Timestamp });
export type Me = z.infer<typeof Me>;

export const SessionResponse = z.object({ user: Me });

export const SignUpBody = z.object({
  name: PersonName,
  roleKey: RoleKey,
  productLineId: Id.optional(),
});
export type SignUpBody = z.infer<typeof SignUpBody>;

export const SignInBody = z.object({
  name: z.string().trim().min(1).max(80),
});

export const UpdateMeBody = z
  .object({
    name: PersonName.optional(),
    roleKey: RoleKey.optional(),
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
  summary: 'My profile, role and product line',
  auth: 'session',
  permission: 'me.read',
  aiTier: 'read',
  response: Me,
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
