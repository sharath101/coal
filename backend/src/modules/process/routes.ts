import { getProcess, getProcessStep, listProcesses } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { notFound } from '../../core/http/errors';
import { latestVersion, listLatestVersions } from './service';

export const processRoutes = [
  implement(listProcesses, async ({ deps, ctx }) => ({
    items: (await listLatestVersions(deps.db, ctx.orgId)).map((v) => ({
      key: v.key,
      version: v.version,
      name: v.route.name,
      departmentCode: v.route.department,
      stepCount: v.route.steps.length,
    })),
  })),

  implement(getProcess, async ({ deps, ctx, params }) => {
    const version = await latestVersion(deps.db, ctx.orgId, params.key);
    if (!version) throw notFound('process');
    return version.route;
  }),

  implement(getProcessStep, async ({ deps, ctx, params }) => {
    const version = await latestVersion(deps.db, ctx.orgId, params.key);
    const step = version?.route.steps.find((s) => s.key === params.step);
    if (!step) throw notFound('step');
    return step;
  }),
];
