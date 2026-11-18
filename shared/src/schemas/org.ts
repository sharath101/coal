import { z } from 'zod';
import { defineEndpoint } from '../api/contract';

export const RoleKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export type RoleKey = z.infer<typeof RoleKey>;

export const Department = z.object({
  code: z.string(),
  name: z.string(),
});
export type Department = z.infer<typeof Department>;

export const Role = z.object({
  key: RoleKey,
  name: z.string(),
  /** Empty for the Board and the VP, who sit above departments. */
  departmentCode: z.string().nullable(),
  /** The role the reporting line runs to, until there's an org chart (P8). */
  reportsTo: RoleKey.nullable(),
  /** An R&D Lead chooses a product line. */
  needsProductLine: z.boolean(),
});
export type Role = z.infer<typeof Role>;

export const RolesResponse = z.object({
  departments: z.array(Department),
  roles: z.array(Role),
});
export type RolesResponse = z.infer<typeof RolesResponse>;

export const listRoles = defineEndpoint({
  id: 'org.listRoles',
  method: 'GET',
  path: '/roles',
  summary: 'Departments and their roles, for the sign-up form',
  auth: 'public',
  permission: 'org.read',
  aiTier: 'read',
  response: RolesResponse,
});
