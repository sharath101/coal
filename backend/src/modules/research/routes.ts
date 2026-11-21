import {
  type ActionDetail,
  createResearchSource as createResearchSourceEndpoint,
  getResearch as getResearchEndpoint,
  keepResearch as keepResearchEndpoint,
  listResearch as listResearchEndpoint,
  listResearchSources as listResearchSourcesEndpoint,
  startResearch as startResearchEndpoint,
  stopResearch as stopResearchEndpoint,
  updateResearchSource as updateResearchSourceEndpoint,
} from '@coal/shared';
import { implement, noEffects } from '../../core/http/endpoint';
import { findProject } from '../rnd/projects';
import {
  addResearchSource,
  changeResearchSource,
  getRun,
  keepResults,
  listResearchSources,
  listRuns,
  sourcePlan,
  sourceRows,
  startRun,
  stopRun,
} from './service';

export const researchRoutes = [
  implement(listResearchSourcesEndpoint, async ({ deps, ctx }) => ({
    items: await listResearchSources(deps, ctx),
  })),

  implement(createResearchSourceEndpoint, ({ deps, ctx, actor, body }) =>
    addResearchSource(deps, ctx, actor, body),
  ),

  implement(updateResearchSourceEndpoint, ({ deps, ctx, params, body }) =>
    changeResearchSource(deps, ctx, params.id, body),
  ),

  implement(
    startResearchEndpoint,
    ({ deps, ctx, actor, body }) => startRun(deps, ctx, actor, body),
    {
      // The card shows exactly the words that will leave COAL, and where they go.
      describe: async (_run, { body }, deps) => {
        const orgId = deps.config.orgId;
        const plan = sourcePlan(
          await sourceRows(deps.db, orgId, body.sourceIds),
          body.terms,
          deps.ai,
        );
        const searched = plan.filter((p) => p.searched);
        const project = body.projectId ? await findProject(deps.db, orgId, body.projectId) : null;
        const detail: ActionDetail = {
          kind: 'research',
          question: body.question,
          terms: body.terms,
          since: body.since ?? null,
          searched: searched.map((p) => ({ name: p.row.name, kind: p.row.kind })),
          linksOnly: plan.filter((p) => !p.searched).map((p) => p.row.name),
          keepIn: project
            ? `${project.code} · ${project.name}${body.stepKey ? `, step ${body.stepKey}` : ''}`
            : null,
        };
        return {
          summary:
            searched.length > 0
              ? `Search ${searched.length} source${searched.length === 1 ? '' : 's'} for: ${body.terms.join('; ')}`
              : `Prepare searches to open yourself, for: ${body.terms.join('; ')}`,
          effects: noEffects(),
          notified: [],
          detail,
        };
      },
    },
  ),

  implement(listResearchEndpoint, ({ deps, ctx, actor, query }) =>
    listRuns(deps, ctx, actor, query),
  ),

  implement(getResearchEndpoint, ({ deps, ctx, actor, params }) =>
    getRun(deps, ctx, actor, params.id),
  ),

  implement(stopResearchEndpoint, ({ deps, ctx, actor, params }) =>
    stopRun(deps, ctx, actor, params.id),
  ),

  implement(keepResearchEndpoint, async ({ deps, ctx, actor, params, body }) => ({
    items: await keepResults(deps, ctx, actor, params.id, body),
  })),
];
