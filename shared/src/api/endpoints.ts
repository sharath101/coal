import type { EndpointSpec } from './contract';
import {
  commentDeviation,
  listDeviations,
  recordDeviation,
  reviewDeviation,
} from '../schemas/deviations';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../schemas/notifications';
import { changeDates, getTimeline, putPlan } from '../schemas/schedule';
import { getWidget, listWidgets } from '../schemas/widgets';
import {
  createAttachment,
  listAttachments,
  createSource,
  listSources,
} from '../schemas/attachments';
import {
  compareVersions,
  createDocument,
  getDocument,
  getVersionLinks,
  listProjectDocuments,
  listSignatureRequests,
  returnRequest,
  saveVersion,
  signRequest,
  submitVersion,
} from '../schemas/documents';
import {
  activateTemplate,
  createTemplate,
  getActiveTemplate,
  getTemplate,
  getTemplateLinks,
  listDocumentTypes,
  listTemplates,
} from '../schemas/templates';
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
import { claimTask, getTask, listTasks, reassignTask, updateTask } from '../schemas/tasks';
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
  listDocumentTypes,
  listTemplates,
  getActiveTemplate,
  getTemplate,
  createTemplate,
  activateTemplate,
  getTemplateLinks,
  listProjectDocuments,
  createDocument,
  getDocument,
  saveVersion,
  getVersionLinks,
  compareVersions,
  submitVersion,
  signRequest,
  returnRequest,
  listSignatureRequests,
  createAttachment,
  listAttachments,
  createSource,
  listSources,
  getTimeline,
  putPlan,
  changeDates,
  listDeviations,
  recordDeviation,
  reviewDeviation,
  commentDeviation,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listWidgets,
  getWidget,
] as const satisfies readonly EndpointSpec[];

export type Endpoint = (typeof ENDPOINTS)[number];
export type PermissionKey = Endpoint['permission'];
