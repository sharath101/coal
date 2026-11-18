import type { Tx } from '../../core/db/client';
import type { RequestContext } from '../../core/http/context';
import { actorOf } from '../audit/service';
import { outboxEvents } from './tables';

/** An event as written by a change (docs/api.md#events). */
export interface EventInput {
  type: string;
  payload: Record<string, unknown>;
  projectId?: string | null;
  stepKey?: string | null;
}

export async function writeEvents(tx: Tx, ctx: RequestContext, events: EventInput[]) {
  if (events.length === 0) return;
  const actor = actorOf(ctx);
  await tx.insert(outboxEvents).values(
    events.map((e) => ({
      orgId: ctx.orgId,
      type: e.type,
      actorType: actor.type,
      actorId: actor.id,
      projectId: e.projectId ?? null,
      stepKey: e.stepKey ?? null,
      payload: e.payload,
    })),
  );
}
