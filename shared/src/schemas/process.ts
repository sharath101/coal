import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { RouteDefinition, StepDefinition } from '../process/definition';

export const ProcessSummary = z.object({
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  departmentCode: z.string(),
  stepCount: z.number().int(),
});
export type ProcessSummary = z.infer<typeof ProcessSummary>;

export const ProcessKeyParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]*$/) });
export const ProcessStepParams = ProcessKeyParams.extend({ step: z.string().min(1).max(4) });

export const listProcesses = defineEndpoint({
  id: 'processes.list',
  method: 'GET',
  path: '/processes',
  summary: 'The processes COAL runs; the R&D route is the first',
  auth: 'session',
  permission: 'processes.read',
  aiTier: 'read',
  response: z.object({ items: z.array(ProcessSummary) }),
});

export const getProcess = defineEndpoint({
  id: 'processes.get',
  method: 'GET',
  path: '/processes/{key}',
  summary: "A process's current version: steps, doers, signers and links",
  auth: 'session',
  permission: 'processes.read',
  aiTier: 'read',
  params: ProcessKeyParams,
  response: RouteDefinition,
});

export const getProcessStep = defineEndpoint({
  id: 'processes.getStep',
  method: 'GET',
  path: '/processes/{key}/steps/{step}',
  summary: "One step's definition",
  auth: 'session',
  permission: 'processes.read',
  aiTier: 'read',
  params: ProcessStepParams,
  response: StepDefinition,
});
