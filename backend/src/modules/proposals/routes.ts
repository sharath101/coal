import {
  confirmProposal,
  createProposal,
  getProposal,
  listProposals as listProposalsEndpoint,
  rejectProposal,
  updateProposal,
  type ActionPreview,
} from '@coal/shared';
import { change } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { canonicalJson, writeAuditEntries } from '../audit/service';
import { writeEvents } from '../events/service';
import { assertCanAccess } from '../permissions';
import { previewActions, runActions, type RunContext } from './runner';
import {
  findProposal,
  insertProposal,
  listProposals,
  presentProposal,
  statusOf,
  updateProposalRow,
  type ProposalRow,
} from './service';

const runContext = (
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  proposal: { id: string; chatId: string | null; preparedByAi: boolean },
): RunContext => ({ deps, ctx, actor, proposal });

/** `3` or `"3"`: the version the person saw. Confirming needs it; editing checks it when sent. */
function versionOf(ifMatch: string | undefined, required: boolean): number | null {
  if (!ifMatch) {
    if (required) throw validationFailed('Send If-Match with the version you saw.', 'If-Match');
    return null;
  }
  const n = Number(ifMatch.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(n))
    throw validationFailed('If-Match must be a version number.', 'If-Match');
  return n;
}

/** Loads a pending proposal of the person's, locked, at the version they saw. */
async function openPending(
  tx: Tx,
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  version: number | null,
): Promise<ProposalRow> {
  const row = await findProposal(tx, ctx.orgId, id, { forUpdate: true });
  if (!row) throw notFound('proposal');
  assertCanAccess('proposals.write', actor, row);
  const status = statusOf(row, deps.now());
  if (status === 'expired') {
    throw new AppError(409, 'PROPOSAL_EXPIRED', 'This card has expired. Ask again for a new one.');
  }
  if (status !== 'pending') {
    throw new AppError(409, 'ALREADY_DONE', `This card was already ${status}.`);
  }
  if (version !== null && version !== row.version) {
    throw new AppError(
      412,
      'VERSION_CONFLICT',
      'This card has changed since you saw it. Look at it again.',
    );
  }
  return row;
}

const proposalCtx = (row: ProposalRow) => ({
  id: row.id,
  chatId: row.chatId,
  preparedByAi: row.preparedByAi,
});

class PreviewChanged extends Error {
  constructor(readonly previews: ActionPreview[]) {
    super('The preview changed');
  }
}

export const proposalsRoutes = [
  implement(createProposal, async ({ deps, ctx, actor, body }) => {
    // Set by the backend while the AI answers in a chat; a client can't name a chat.
    const chatId = ctx.aiChat?.chatId ?? null;
    const draft = { id: 'new', chatId, preparedByAi: ctx.viaAi };
    const preview = await previewActions(runContext(deps, ctx, actor, draft), body.actions);
    return change(deps.db, ctx, async (tx, log) => {
      const row = await insertProposal(tx, {
        orgId: ctx.orgId,
        forUserId: actor.userId,
        chatId,
        preparedByAi: ctx.viaAi,
        title: body.title,
        actions: body.actions,
        preview,
        expiresAt: new Date(deps.now().getTime() + deps.config.proposals.expiryHours * 3_600_000),
      });
      log.audit({
        action: 'proposal.created',
        recordType: 'proposal',
        recordId: row.id,
        after: { title: row.title, endpoints: row.actions.map((a) => a.endpoint), chatId },
      });
      log.event({ type: 'proposal.created', payload: { proposalId: row.id } });
      return presentProposal(row, deps.now());
    });
  }),

  implement(listProposalsEndpoint, ({ deps, ctx, actor, query }) =>
    listProposals(deps.db, ctx.orgId, actor.userId, query, deps.now()),
  ),

  implement(getProposal, async ({ deps, ctx, actor, params }) => {
    const row = await findProposal(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('proposal');
    assertCanAccess('proposals.read', actor, row);
    return presentProposal(row, deps.now());
  }),

  implement(updateProposal, async ({ deps, ctx, actor, params, body, ifMatch }) => {
    const seen = versionOf(ifMatch, false);
    const current = await findProposal(deps.db, ctx.orgId, params.id);
    if (!current) throw notFound('proposal');
    assertCanAccess('proposals.write', actor, current);
    const preview = await previewActions(
      runContext(deps, ctx, actor, proposalCtx(current)),
      body.actions,
    );
    return change(deps.db, ctx, async (tx, log) => {
      const row = await openPending(tx, deps, ctx, actor, params.id, seen ?? current.version);
      const updated = await updateProposalRow(
        tx,
        row.id,
        {
          title: body.title ?? row.title,
          actions: body.actions,
          preview: { actions: preview },
          version: row.version + 1,
        },
        deps.now(),
      );
      log.audit({
        action: 'proposal.updated',
        recordType: 'proposal',
        recordId: row.id,
        before: { version: row.version },
        after: { version: updated.version, endpoints: updated.actions.map((a) => a.endpoint) },
      });
      return presentProposal(updated, deps.now());
    });
  }),

  implement(confirmProposal, async ({ deps, ctx, actor, params, ifMatch }) => {
    const seen = versionOf(ifMatch, true);
    try {
      return await deps.db.transaction(async (tx) => {
        const row = await openPending(tx, deps, ctx, actor, params.id, seen);
        // Run for real, then check the effect is still what the person saw; if not, undo it all.
        const { previews, outputs } = await runActions(
          tx,
          runContext(deps, ctx, actor, proposalCtx(row)),
          row.actions,
          { dry: false },
        );
        if (canonicalJson(previews) !== canonicalJson(row.preview.actions)) {
          throw new PreviewChanged(previews);
        }
        const now = deps.now();
        const updated = await updateProposalRow(
          tx,
          row.id,
          { status: 'confirmed', confirmedAt: now, result: outputs },
          now,
        );
        const own = { ...ctx, viaAi: false };
        await writeEvents(tx, own, [
          { type: 'proposal.confirmed', payload: { proposalId: row.id, chatId: row.chatId } },
        ]);
        await writeAuditEntries(tx, own, [
          {
            action: 'proposal.confirmed',
            recordType: 'proposal',
            recordId: row.id,
            after: {
              version: row.version,
              chatId: row.chatId,
              preparedByAi: row.preparedByAi,
              endpoints: row.actions.map((a) => a.endpoint),
            },
          },
        ]);
        return presentProposal(updated, now);
      });
    } catch (error) {
      if (!(error instanceof PreviewChanged)) throw error;
      // Keep the new preview as the next version, so the card shows exactly what would happen now.
      await change(deps.db, ctx, async (tx, log) => {
        const row = await openPending(tx, deps, ctx, actor, params.id, seen);
        await updateProposalRow(
          tx,
          row.id,
          { preview: { actions: error.previews }, version: row.version + 1 },
          deps.now(),
        );
        log.audit({
          action: 'proposal.preview_changed',
          recordType: 'proposal',
          recordId: row.id,
          before: { version: row.version },
          after: { version: row.version + 1 },
        });
      });
      throw new AppError(
        409,
        'PREVIEW_CHANGED',
        'What this card would do has changed since you saw it. Look at it again before confirming.',
      );
    }
  }),

  implement(rejectProposal, ({ deps, ctx, actor, params }) =>
    change(deps.db, ctx, async (tx, log) => {
      const row = await openPending(tx, deps, ctx, actor, params.id, null);
      const updated = await updateProposalRow(tx, row.id, { status: 'rejected' }, deps.now());
      log.audit({
        action: 'proposal.rejected',
        recordType: 'proposal',
        recordId: row.id,
        before: { status: 'pending' },
        after: { status: 'rejected' },
      });
      log.event({ type: 'proposal.rejected', payload: { proposalId: row.id } });
      return presentProposal(updated, deps.now());
    }),
  ),
];
