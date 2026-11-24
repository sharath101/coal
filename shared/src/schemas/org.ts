import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id } from './common';

export const RoleKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export type RoleKey = z.infer<typeof RoleKey>;

export const PositionKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export type PositionKey = z.infer<typeof PositionKey>;

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
});
export type Role = z.infer<typeof Role>;

/** A box on Jayon's org chart, with its seats (docs/roles-and-access.md#the-org-chart). */
export const Position = z.object({
  key: PositionKey,
  title: z.string(),
  /** What the position may do on the route. */
  roleKey: RoleKey,
  departmentCode: z.string().nullable(),
  /** The position it reports to. Empty: the top of its line. */
  reportsTo: PositionKey.nullable(),
  /** The seats are counted for each product line, and a person chooses their line. */
  perProductLine: z.boolean(),
  /** Seats for the whole position, or for each line. Empty: no limit. */
  seats: z.number().int().positive().nullable(),
});
export type Position = z.infer<typeof Position>;

/** A position as the sign-up form shows it: whether anyone may still take it. */
export const OpenPosition = Position.extend({
  /** No seat left (for a position counted by line: in every line). */
  full: z.boolean(),
  /** The product lines with no seat left. */
  fullProductLineIds: z.array(Id),
});
export type OpenPosition = z.infer<typeof OpenPosition>;

export const RolesResponse = z.object({
  departments: z.array(Department),
  roles: z.array(Role),
  /** The positions a person may choose, in the order of the chart. */
  positions: z.array(OpenPosition),
});
export type RolesResponse = z.infer<typeof RolesResponse>;

export const listRoles = defineEndpoint({
  id: 'org.listRoles',
  method: 'GET',
  path: '/roles',
  summary: 'Departments, roles and the positions that still have a seat, for the sign-up form',
  auth: 'public',
  permission: 'org.read',
  aiTier: 'read',
  response: RolesResponse,
});
