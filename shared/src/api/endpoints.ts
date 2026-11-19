import type { EndpointSpec } from './contract';
import { completeUpload, createUpload, getFileLink } from '../schemas/files';
import { listRoles } from '../schemas/org';
import { getProcess, getProcessStep, listProcesses } from '../schemas/process';
import {
  approveStep,
  createCorrectiveAction,
  createProject,
  decideStep,
  dropProject,
  getActivity,
  getProject,
  getProjectRoute,
  getStep,
  getTeam,
  holdProject,
  listProjects,
  putTeam,
  recordMilestone,
  resumeProject,
  returnStep,
  sendBackStep,
  startStep,
  submitStep,
} from '../schemas/projects';
import {
  claimTask,
  createTask,
  getTask,
  listTasks,
  reassignTask,
  updateTask,
} from '../schemas/tasks';
import {
  confirmProposal,
  createChat,
  getAiModels,
  getChat,
  getDraftFile,
  listChats,
  rejectProposal,
  sendChatMessage,
} from '../schemas/ai';
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
  listProcesses,
  getProcess,
  getProcessStep,
  createProject,
  listProjects,
  getProject,
  getProjectRoute,
  getTeam,
  putTeam,
  holdProject,
  resumeProject,
  dropProject,
  getActivity,
  getStep,
  startStep,
  submitStep,
  approveStep,
  returnStep,
  decideStep,
  sendBackStep,
  recordMilestone,
  createCorrectiveAction,
  listTasks,
  getTask,
  updateTask,
  claimTask,
  reassignTask,
  createTask,
  getAiModels,
  listChats,
  createChat,
  getChat,
  sendChatMessage,
  confirmProposal,
  rejectProposal,
  getDraftFile,
] as const satisfies readonly EndpointSpec[];

export type Endpoint = (typeof ENDPOINTS)[number];
export type PermissionKey = Endpoint['permission'];
