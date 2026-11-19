import type { ActionCard, Preview, Task } from '@coal/shared';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../../core/deps';
import type { RequestContext } from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { presentCard, type ProposalRow } from './chats';
import { callEndpoint, endpointById, problemText, type EndpointInput } from './endpoint-call';
import { aiProposals } from './tables';

/**
 * Action cards (docs/api.md#proposals-and-action-cards). The AI prepares an action; the server
 * previews it without saving; only the person confirms it, from their own session.
 */

export interface StoredAction extends EndpointInput {
  endpointId: string;
}

const canPreview = (endpointId: string) => {
  const e = endpointById(endpointId);
  return !!e?.query && 'preview' in e.query.shape;
};

const CHANGE_WORDS: Record<string, string> = {
  ready: 'opens',
  started: 'starts',
  submitted: 'goes for sign-off',
  approved: 'is approved',
  done: 'is done',
  returned: 'goes back to its authors',
  reset: 'is reset',
  skipped: 'is skipped',
};

/** A preview in plain words: what changes, who gets what. */
export function describeResult(json: unknown): { lines: string[]; warnings: string[] } {
  const value = json as { preview?: Preview; task?: Task } | null;
  const lines: string[] = [];
  const warnings: string[] = [];
  if (value?.task) {
    const t = value.task;
    lines.push(`${t.assignee?.name ?? 'Unassigned'} gets a request: “${t.title}”`);
    if (t.body) lines.push(t.body);
    if (t.subject) lines.push(`About ${t.subject.label}`);
  }
  const p = value?.preview;
  if (p) {
    for (const s of p.steps)
      lines.push(`Step ${s.key} · ${s.name} ${CHANGE_WORDS[s.change] ?? s.change}`);
    for (const t of p.tasks) {
      const who =
        t.assignee?.name ?? (t.queueRole ? `the ${t.queueRole.name} queue` : 'nobody yet');
      lines.push(`${t.title} → ${who}`);
    }
    if (p.cancelledTasks) lines.push(`${p.cancelledTasks} open task(s) are cancelled`);
    if (p.team.length) lines.push(`Team: ${p.team.map((m) => m.name).join(', ')}`);
    warnings.push(...p.warnings);
  }
  return { lines, warnings };
}

/** Previews the action as the person (it changes nothing) and saves it as a pending card. */
export async function proposeAction(
  request: FastifyRequest,
  deps: AppDeps,
  ctx: RequestContext,
  chatId: string,
  title: string,
  action: StoredAction,
  extraLines: string[] = [],
): Promise<{ card: ActionCard } | { error: string }> {
  const endpoint = endpointById(action.endpointId);
  if (!endpoint || endpoint.aiTier !== 'confirm')
    return { error: 'That action cannot be proposed.' };
  let lines = [...extraLines];
  let warnings: string[] = [];
  if (canPreview(action.endpointId)) {
    // Not marked "via AI": a preview changes nothing, and the person still has to confirm.
    const preview = await callEndpoint(request, endpoint, action, { viaAi: false, preview: true });
    if (!preview.ok) return { error: problemText(preview) };
    const described = describeResult(preview.json);
    lines = [...described.lines, ...lines];
    warnings = described.warnings;
  }
  const [row] = await deps.db
    .insert(aiProposals)
    .values({
      orgId: ctx.orgId,
      userId: ctx.actor!.userId,
      chatId,
      kind: 'proposal',
      title,
      actions: [action],
      lines,
      warnings,
    })
    .returning();
  return { card: presentCard(row!) };
}

/** A never-tier action the AI prepared: the card links to the screen where the person does it. */
export async function linkCard(
  deps: AppDeps,
  ctx: RequestContext,
  chatId: string,
  card: { title: string; lines: string[]; warnings: string[]; href: string },
): Promise<ActionCard> {
  const [row] = await deps.db
    .insert(aiProposals)
    .values({
      orgId: ctx.orgId,
      userId: ctx.actor!.userId,
      chatId,
      kind: 'link',
      title: card.title,
      actions: [],
      lines: card.lines,
      warnings: card.warnings,
      href: card.href,
    })
    .returning();
  return presentCard(row!);
}

async function settle(
  deps: AppDeps,
  row: ProposalRow,
  status: ProposalRow['status'],
  result: string,
) {
  const [updated] = await deps.db
    .update(aiProposals)
    .set({ status, result, decidedAt: new Date() })
    .where(eq(aiProposals.id, row.id))
    .returning();
  return presentCard(updated!);
}

/**
 * Carries out a card. It previews again first: if what would happen has changed, the card is
 * updated and nothing is done, so the person always confirms exactly what happens.
 */
export async function confirmCard(
  request: FastifyRequest,
  deps: AppDeps,
  row: ProposalRow,
): Promise<ActionCard> {
  if (row.kind !== 'proposal') throw new AppError(409, 'ALREADY_DONE', 'This card is a link.');
  if (row.status !== 'pending')
    throw new AppError(409, 'ALREADY_DONE', 'This card is already settled.');
  const actions = row.actions as StoredAction[];
  for (const action of actions) {
    if (!canPreview(action.endpointId)) continue;
    const endpoint = endpointById(action.endpointId)!;
    const preview = await callEndpoint(request, endpoint, action, { viaAi: false, preview: true });
    if (!preview.ok) return settle(deps, row, 'failed', problemText(preview));
    const now = describeResult(preview.json).lines;
    const before = (row.lines as string[]).slice(0, now.length);
    if (JSON.stringify(now) !== JSON.stringify(before)) {
      const [updated] = await deps.db
        .update(aiProposals)
        .set({ lines: now, warnings: ['Things changed since this card was made. Check it again.'] })
        .where(eq(aiProposals.id, row.id))
        .returning();
      // Still pending, with the new effect: the person reads it and confirms again.
      return presentCard(updated!);
    }
  }
  const done: string[] = [];
  for (const action of actions) {
    const endpoint = endpointById(action.endpointId)!;
    // The person's own act, from their own session: not marked "via AI".
    const result = await callEndpoint(request, endpoint, action, { viaAi: false });
    if (!result.ok) return settle(deps, row, 'failed', problemText(result));
    done.push(describeResult(result.json).lines[0] ?? 'Done');
  }
  return settle(deps, row, 'confirmed', done.join(' · '));
}

export const rejectCard = (deps: AppDeps, row: ProposalRow) =>
  settle(deps, row, 'rejected', 'Discarded');
