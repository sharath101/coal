import type { EndpointSpec } from './contract';
import { completeUpload, createUpload, getFileLink } from '../schemas/files';
import { listRoles } from '../schemas/org';
import { listProductLines } from '../schemas/rnd';
import { getMe, getUser, listUsers, signIn, signOut, signUp, updateMe } from '../schemas/users';

/**
 * Every endpoint of the API. The backend must implement each one, and the permission
 * module must have a rule and a test table entry for each permission (docs/api.md#adding-an-endpoint).
 */
export const ENDPOINTS = [
  signUp,
  signIn,
  signOut,
  getMe,
  updateMe,
  listUsers,
  getUser,
  listRoles,
  listProductLines,
  createUpload,
  completeUpload,
  getFileLink,
] as const satisfies readonly EndpointSpec[];

export type Endpoint = (typeof ENDPOINTS)[number];
export type PermissionKey = Endpoint['permission'];
