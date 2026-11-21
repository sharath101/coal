import { and, eq, lt } from 'drizzle-orm';
import type { AppDeps } from '../../core/deps';
import type { Subscription } from '../events/dispatcher';
import { researchRuns } from './tables';

/** A run waits for the worker this long before the sweep sends it again (its event may have been missed). */
const WAITING_MS = 60_000;
/** A run still running this long after its time limit was left behind by a worker that stopped. */
const GRACE_MS = 5 * 60_000;

/** A confirmed run is handed to the job queue when its event is delivered. */
export function researchSubscriptions(send: (runId: string) => Promise<void>): Subscription[] {
  return [
    {
      type: 'research.requested',
      handle: async (event) => {
        const runId = (event.payload as { runId?: unknown }).runId;
        if (typeof runId === 'string') await send(runId);
      },
    },
  ];
}

/**
 * Every minute: sends again the runs that waited too long, and ends those a stopped worker left
 * running, keeping what they found. Safe to run twice: a run is only taken while it is queued.
 */
export async function sweepResearch(
  deps: AppDeps,
  send: (runId: string) => Promise<void>,
): Promise<{ resent: number; abandoned: number }> {
  const now = deps.now().getTime();
  const waiting = await deps.db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.status, 'queued'),
        lt(researchRuns.createdAt, new Date(now - WAITING_MS)),
      ),
    );
  for (const run of waiting) await send(run.id);
  const abandoned = await deps.db
    .update(researchRuns)
    .set({
      status: 'failed',
      error: 'The research stopped unexpectedly. What was found so far is kept.',
      finishedAt: new Date(now),
    })
    .where(
      and(
        eq(researchRuns.status, 'running'),
        lt(researchRuns.startedAt, new Date(now - deps.config.research.timeoutMs - GRACE_MS)),
      ),
    )
    .returning({ id: researchRuns.id });
  return { resent: waiting.length, abandoned: abandoned.length };
}
