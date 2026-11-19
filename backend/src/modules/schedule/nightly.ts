import { change } from '../../core/db/change';
import type { AppDeps } from '../../core/deps';
import { systemContext } from '../../core/http/context';
import { getRuns } from '../process/service';
import { allProjects } from '../rnd/projects';
import { recompute } from './service';

/**
 * Time passing makes steps late, so every running project's dates and health are worked out
 * again each night (docs/dashboard.md#deadlines-alerts-and-deviations). Returns how many it did.
 */
export async function recomputeAll(
  deps: AppDeps,
  orgId: string,
  now: Date = deps.now(),
): Promise<number> {
  const projects = await allProjects(deps.db, orgId);
  const runs = await getRuns(
    deps.db,
    orgId,
    projects.map((p) => p.processRunId),
  );
  let done = 0;
  for (const project of projects) {
    const status = runs.get(project.processRunId)?.status;
    if (status !== 'active' && status !== 'on_hold') continue;
    await change(deps.db, systemContext(orgId, 'job'), async (tx, log) => {
      await recompute(tx, log, now, orgId, project.id, project.processRunId);
    });
    done += 1;
  }
  return done;
}
