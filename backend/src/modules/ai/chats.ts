import type Anthropic from '@anthropic-ai/sdk';
import type {
  ActionCard,
  AssistantItem,
  ChatDetail,
  ChatItem,
  ChatSummary,
  DraftRef,
} from '@coal/shared';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import type { Executor } from '../../core/db/client';
import type { RequestContext } from '../../core/http/context';
import { modelName } from './models';
import { aiChats, aiDrafts, aiMessages, aiProposals } from './tables';

/** Saving and showing chats, action cards and drafts (docs/workstation-and-ai.md). */

export type ChatRow = typeof aiChats.$inferSelect;
export type ProposalRow = typeof aiProposals.$inferSelect;
export type DraftRow = typeof aiDrafts.$inferSelect;

export const DEFAULT_TITLE = 'New chat';

export const presentChatSummary = (row: ChatRow): ChatSummary => ({
  id: row.id,
  title: row.title,
  projectId: row.projectId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function createChatRow(
  ex: Executor,
  ctx: RequestContext,
  input: { title?: string; projectId?: string },
): Promise<ChatRow> {
  const [row] = await ex
    .insert(aiChats)
    .values({
      orgId: ctx.orgId,
      userId: ctx.actor!.userId,
      title: input.title ?? DEFAULT_TITLE,
      projectId: input.projectId ?? null,
    })
    .returning();
  return row!;
}

export async function listChatRows(ex: Executor, ctx: RequestContext): Promise<ChatRow[]> {
  return ex
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.orgId, ctx.orgId), eq(aiChats.userId, ctx.actor!.userId)))
    .orderBy(desc(aiChats.updatedAt))
    .limit(50);
}

export async function findChat(ex: Executor, orgId: string, id: string): Promise<ChatRow | null> {
  const [row] = await ex
    .select()
    .from(aiChats)
    .where(and(eq(aiChats.orgId, orgId), eq(aiChats.id, id)));
  return row ?? null;
}

export async function touchChat(ex: Executor, chatId: string, title?: string): Promise<void> {
  await ex
    .update(aiChats)
    .set({ updatedAt: new Date(), ...(title && { title }) })
    .where(eq(aiChats.id, chatId));
}

/** The chat as the model saw it, in order, never edited (so it can be replayed exactly). */
export async function loadHistory(
  ex: Executor,
  chatId: string,
): Promise<{ messages: Anthropic.Beta.BetaMessageParam[]; nextSeq: number }> {
  const rows = await ex
    .select({ seq: aiMessages.seq, role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.chatId, chatId))
    .orderBy(asc(aiMessages.seq));
  return {
    messages: rows.map(
      (r) => ({ role: r.role, content: r.content }) as Anthropic.Beta.BetaMessageParam,
    ),
    nextSeq: (rows.at(-1)?.seq ?? 0) + 1,
  };
}

export async function nextSeq(ex: Executor, chatId: string): Promise<number> {
  const [row] = await ex
    .select({ last: max(aiMessages.seq) })
    .from(aiMessages)
    .where(eq(aiMessages.chatId, chatId));
  return (row?.last ?? 0) + 1;
}

export interface NewMessage {
  role: 'user' | 'assistant';
  content: unknown;
  display?: ChatItem | null;
  model?: string | null;
}

export async function appendMessages(
  ex: Executor,
  orgId: string,
  chatId: string,
  messages: NewMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const first = await nextSeq(ex, chatId);
  await ex.insert(aiMessages).values(
    messages.map((m, i) => ({
      orgId,
      chatId,
      seq: first + i,
      role: m.role,
      content: m.content,
      display: m.display ?? null,
      model: m.model ?? null,
    })),
  );
}

export const presentCard = (row: ProposalRow): ActionCard => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  lines: row.lines as string[],
  warnings: row.warnings as string[],
  status: row.status,
  href: row.href,
  result: row.result,
});

export const presentDraft = (
  row: Pick<DraftRow, 'id' | 'title' | 'stepKey' | 'template' | 'gaps' | 'model' | 'createdAt'>,
): DraftRef => ({
  id: row.id,
  title: row.title,
  stepKey: row.stepKey,
  template: row.template,
  gaps: row.gaps as string[],
  modelName: modelName(row.model),
  createdAt: row.createdAt.toISOString(),
});

export async function findProposal(ex: Executor, orgId: string, id: string) {
  const [row] = await ex
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.orgId, orgId), eq(aiProposals.id, id)));
  return row ?? null;
}

export async function findDraft(ex: Executor, orgId: string, id: string) {
  const [row] = await ex
    .select()
    .from(aiDrafts)
    .where(and(eq(aiDrafts.orgId, orgId), eq(aiDrafts.id, id)));
  return row ?? null;
}

/** The chat as a channel shows it. Action cards show their current status. */
export async function presentChat(ex: Executor, chat: ChatRow): Promise<ChatDetail> {
  const rows = await ex
    .select({ display: aiMessages.display })
    .from(aiMessages)
    .where(eq(aiMessages.chatId, chat.id))
    .orderBy(asc(aiMessages.seq));
  const items = rows.map((r) => r.display).filter((d): d is ChatItem => d !== null);
  const cardIds = items.flatMap((i) => (i.role === 'assistant' ? i.cards.map((c) => c.id) : []));
  const cards = cardIds.length
    ? await ex.select().from(aiProposals).where(inArray(aiProposals.id, cardIds))
    : [];
  const current = new Map(cards.map((c) => [c.id, presentCard(c)]));
  return {
    chat: presentChatSummary(chat),
    items: items.map((item) =>
      item.role === 'assistant'
        ? ({
            ...item,
            cards: item.cards.map((c) => current.get(c.id) ?? c),
          } satisfies AssistantItem)
        : item,
    ),
  };
}
