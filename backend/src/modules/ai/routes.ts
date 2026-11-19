import {
  confirmProposal,
  createChat,
  getAiModels,
  getChat,
  getDraftFile,
  listChats,
  rejectProposal,
  sendChatMessage,
  type ChatEvent,
} from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import { runTurn } from './agent';
import {
  createChatRow,
  findChat,
  findDraft,
  findProposal,
  listChatRows,
  presentChat,
  presentChatSummary,
} from './chats';
import { apiKey, spentToday } from './gateway';
import { listPurposes } from './models';
import { confirmCard, rejectCard } from './proposals';

export const aiRoutes = [
  implement(getAiModels, async ({ deps, ctx }) => ({
    configured: !!apiKey(deps),
    purposes: listPurposes(deps.config.ai.modelOverrides),
    spentTodayUsd: Math.round((await spentToday(deps, ctx)) * 10000) / 10000,
    dailyBudgetUsd: deps.config.ai.dailyBudgetUsd,
  })),

  implement(listChats, async ({ deps, ctx }) => ({
    items: (await listChatRows(deps.db, ctx)).map(presentChatSummary),
  })),

  implement(createChat, async ({ deps, ctx, body }) =>
    presentChatSummary(await createChatRow(deps.db, ctx, body)),
  ),

  implement(getChat, async ({ deps, ctx, actor, params }) => {
    const chat = await findChat(deps.db, ctx.orgId, params.id);
    if (!chat) throw notFound('chat');
    assertCanAccess('ai.chats.read', actor, { ownerId: chat.userId });
    return presentChat(deps.db, chat);
  }),

  /** Streams the reply as Server-Sent Events: one ChatEvent per `data:` line. */
  implement(sendChatMessage, async ({ deps, ctx, actor, params, body, http }) => {
    const chat = await findChat(deps.db, ctx.orgId, params.id);
    if (!chat) throw notFound('chat');
    assertCanAccess('ai.chats.write', actor, { ownerId: chat.userId });
    const reply = http.reply;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: ChatEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    // A comment line every 10 seconds, so proxies don't close the stream while a model writes.
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 10_000);
    try {
      await runTurn({
        deps,
        ctx,
        request: http.request,
        chat,
        text: body.text,
        purpose: body.purpose,
        send,
      });
    } catch (error) {
      const app = error instanceof AppError ? error : null;
      http.request.log.error({ err: error }, 'assistant turn failed');
      send({
        type: 'error',
        code: app?.code ?? 'AI_FAILED',
        message: app?.message ?? 'The assistant hit a problem. Try again.',
      });
    } finally {
      clearInterval(keepAlive);
      reply.raw.end();
    }
  }),

  implement(confirmProposal, async ({ deps, ctx, actor, params, http }) => {
    const row = await findProposal(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('card');
    assertCanAccess('ai.proposals.decide', actor, { ownerId: row.userId });
    return confirmCard(http.request, deps, row);
  }),

  implement(rejectProposal, async ({ deps, ctx, actor, params }) => {
    const row = await findProposal(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('card');
    assertCanAccess('ai.proposals.decide', actor, { ownerId: row.userId });
    if (row.status !== 'pending')
      throw new AppError(409, 'ALREADY_DONE', 'This card is already settled.');
    return rejectCard(deps, row);
  }),

  /** Sends the file itself. */
  implement(getDraftFile, async ({ deps, ctx, actor, params, query, http }) => {
    const draft = await findDraft(deps.db, ctx.orgId, params.id);
    if (!draft) throw notFound('draft');
    assertCanAccess('ai.drafts.read', actor, { ownerId: draft.userId });
    const pdf = query.format === 'pdf';
    const file = pdf ? draft.pdf : draft.docx;
    if (!file) throw notFound('PDF of this draft');
    const name = `${draft.title.replace(/[^\w .-]+/g, '').trim() || 'draft'}.${pdf ? 'pdf' : 'docx'}`;
    const reply = http.reply;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': pdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `${pdf ? 'inline' : 'attachment'}; filename="${name}"`,
      'content-length': String(file.length),
      'cache-control': 'private, no-store',
    });
    reply.raw.end(file);
  }),
];
