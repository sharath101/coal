import type { RouteDefinition, StepKey } from '@coal/shared';
import type { Executor } from '../../core/db/client';
import {
  currentStepsOfRuns,
  getRuns,
  versionsByIds,
  type RunRow,
  type RunStepRow,
} from '../process/service';
import { allProjects, memberIdsOf, type ProjectRow } from '../rnd/projects';
import { listProductLines } from '../rnd/service';
import { findUsersByIds } from '../users/service';

/** One project with everything the portfolio widgets read: its run, its steps' dates and its people. */
export interface PortfolioProject {
  project: ProjectRow;
  run: RunRow;
  route: RouteDefinition;
  steps: Map<StepKey, RunStepRow>;
  line: { id: string; code: string; name: string };
  memberIds: string[];
  /** The Lead on the project team, if there is one. */
  lead: string | null;
}

export async function loadPortfolio(ex: Executor, orgId: string): Promise<PortfolioProject[]> {
  const projects = await allProjects(ex, orgId);
  if (projects.length === 0) return [];
  const runs = await getRuns(
    ex,
    orgId,
    projects.map((p) => p.processRunId),
  );
  const [stepRows, versions, lines, members] = await Promise.all([
    currentStepsOfRuns(ex, [...runs.keys()]),
    versionsByIds(
      ex,
      [...runs.values()].map((r) => r.processVersionId),
    ),
    listProductLines(ex, orgId),
    memberIdsOf(
      ex,
      projects.map((p) => p.id),
    ),
  ]);
  const people = new Map(
    (await findUsersByIds(ex, orgId, [...members.values()].flat())).map((u) => [u.id, u]),
  );
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const stepsOfRun = new Map<string, Map<StepKey, RunStepRow>>();
  for (const s of stepRows) {
    const map = stepsOfRun.get(s.runId) ?? new Map<StepKey, RunStepRow>();
    map.set(s.stepKey, s);
    stepsOfRun.set(s.runId, map);
  }

  return projects.flatMap((project) => {
    const run = runs.get(project.processRunId);
    const version = run ? versions.get(run.processVersionId) : undefined;
    const line = lineById.get(project.productLineId);
    if (!run || !version || !line) return [];
    const memberIds = members.get(project.id) ?? [];
    return [
      {
        project,
        run,
        route: version.route,
        steps: stepsOfRun.get(run.id) ?? new Map(),
        line: { id: line.id, code: line.code, name: line.name },
        memberIds,
        lead:
          memberIds.map((id) => people.get(id)).find((u) => u?.roleKey === 'rd_lead')?.name ?? null,
      },
    ];
  });
}

export const scopeOfProject = (p: PortfolioProject) => ({
  productLineId: p.project.productLineId,
  memberIds: p.memberIds,
});
