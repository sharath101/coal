import {
  createChat,
  getChat,
  listChats as listChatsEndpoint,
  sendFeedback,
  sendMessage,
  stopReply as stopReplyEndpoint,
  type ChatContext,
  type ChatStreamEvent,
} from '@coal/shared';
import { callEndpoint } from '../../core/http/call';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { implement, implementationOf } from '../../core/http/endpoint';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { assertUsableEvidence, type FileRow } from '../files/service';
import { assertCanAccess } from '../permissions';
import { proposalsOfChat } from '../proposals/service';
import { findProject } from '../rnd/projects';
import { findTask } from '../tasks/service';
import {
  feedbackFor,
  findMessage,
  insertChat,
  listChats,
  presentChat,
  presentMessage,
  recentMessages,
  requireChat,
  saveFeedback,
} from './service';
import { AI_UNAVAILABLE, answerMessage, assertCanReply, stopReply } from './turn';

/** What the chat is pinned to must exist, and be something the person may open. */
async function checkContext(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  context: ChatContext,
): Promise<{ runId: string | null }> {
  if (context.stepKey && !context.projectId) {
    throw validationFailed('A step needs its project.', 'context.stepKey');
  }
  let runId: string | null = null;
  if (context.projectId) {
    const project = await findProject(deps.db, ctx.orgId, context.projectId);
    if (!project) throw notFound('project');
    runId = project.processRunId;
  }
  if (context.taskId) {
    const task = await findTask(deps.db, ctx.orgId, context.taskId);
    if (!task) throw notFound('task');
    assertCanAccess('tasks.readOne', actor, task);
  }
  if (context.documentId) {
    // Opening it as the person is the check: the document's own rule decides.
    const impl = implementationOf('documents.get');
    if (impl) await callEndpoint(impl, deps, ctx, actor, { params: { id: context.documentId } });
  }
  return { runId };
}

/** What may be attached for now: a Word file or a PDF, finished uploading, the person's own. */
async function attachments(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  ids: string[],
): Promise<FileRow[]> {
  const rows: FileRow[] = [];
  for (const [i, id] of [...new Set(ids)].entries()) {
    const row = await assertUsableEvidence(deps.db, ctx.orgId, actor, id, `fileIds.${i}`);
    if (!/\.(docx|pdf)$/i.test(row.name)) {
      throw validationFailed('Only Word files and PDFs can be attached for now.', `fileIds.${i}`);
    }
    rows.push(row);
  }
  return rows;
}

const sse = (raw: NodeJS.WritableStream & { writableEnded: boolean }, event: ChatStreamEvent) => {
  if (!raw.writableEnded) raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
};

export const aiRoutes = [
  implement(createChat, async ({ deps, ctx, actor, body }) => {
    const { runId } = await checkContext(deps, ctx, actor, body.context);
    const row = await deps.db.transaction((tx) =>
      insertChat(tx, { orgId: ctx.orgId, userId: actor.userId, runId, context: body.context }),
    );
    return presentChat(row);
  }),

  implement(listChatsEndpoint, async ({ deps, ctx, actor, query }) => {
    let runId: string | undefined;
    if (query['filter[project]']) {
      const project = await findProject(deps.db, ctx.orgId, query['filter[project]']);
      if (!project) return { items: [], nextCursor: null };
      runId = project.processRunId;
    }
    return listChats(deps.db, ctx.orgId, actor.userId, {
      limit: query.limit,
      cursor: query.cursor,
      runId,
    });
  }),

  implement(getChat, async ({ deps, ctx, actor, params }) => {
    const chat = await requireChat(deps.db, ctx.orgId, params.id);
    assertCanAccess('ai.chats.read', actor, chat);
    const rows = await recentMessages(deps.db, chat.id, 200);
    const ratings = await feedbackFor(
      deps.db,
      actor.userId,
      rows.map((r) => r.id),
    );
    return {
      ...presentChat(chat),
      messages: rows.map((r) => presentMessage(r, ratings.get(r.id) ?? null)),
      proposals: await proposalsOfChat(deps.db, ctx.orgId, actor.userId, chat.id, deps.now()),
    };
  }),

  implement(
    sendMessage,
    async ({ deps, ctx, actor, params, body, http }) => {
      const provider = deps.ai;
      if (!provider) throw AI_UNAVAILABLE();
      const chat = await requireChat(deps.db, ctx.orgId, params.id);
      assertCanAccess('ai.chats.write', actor, chat);
      const controller = new AbortController();
      const files = await attachments(deps, ctx, actor, body.fileIds);
      const args = { deps, provider, ctx, actor, chat, text: body.text, files, controller };

      if (!http.request.headers.accept?.includes('text/event-stream')) {
        return answerMessage({ ...args, emit: () => undefined });
      }

      // Refusals come back as a normal problem response, before the stream starts.
      await assertCanReply(deps, ctx, actor, chat);
      const { reply } = http;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(201, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      let failed = false;
      const emit = (event: ChatStreamEvent) => {
        if (event.type === 'error') failed = true;
        sse(raw, event);
      };
      // A person who closes the page no longer wants the reply.
      raw.on('close', () => {
        if (!raw.writableFinished) controller.abort();
      });
      try {
        await answerMessage({ ...args, emit });
      } catch (error) {
        if (!failed) {
          if (error instanceof AppError)
            emit({ type: 'error', code: error.code, detail: error.message });
          else {
            http.request.log.error({ err: error }, 'the AI reply failed');
            emit({ type: 'error', code: 'INTERNAL', detail: 'Something went wrong.' });
          }
        }
      } finally {
        raw.end();
      }
      return undefined as never;
    },
    { rateLimit: () => ({ max: 30, timeWindow: '1 minute' }) },
  ),

  implement(stopReplyEndpoint, async ({ deps, ctx, actor, params }) => {
    const chat = await requireChat(deps.db, ctx.orgId, params.id);
    assertCanAccess('ai.chats.write', actor, chat);
    return { stopped: stopReply(chat.id) };
  }),

  implement(sendFeedback, async ({ deps, ctx, actor, body }) => {
    const message = await findMessage(deps.db, ctx.orgId, body.messageId);
    if (!message) throw notFound('message');
    const chat = await requireChat(deps.db, ctx.orgId, message.chatId);
    assertCanAccess('ai.feedback', actor, chat);
    if (message.sender !== 'assistant') {
      throw validationFailed('Only a reply can be rated.', 'messageId');
    }
    await deps.db.transaction((tx) =>
      saveFeedback(tx, {
        orgId: ctx.orgId,
        messageId: message.id,
        userId: actor.userId,
        rating: body.rating,
        comment: body.comment ?? null,
      }),
    );
    return presentMessage(message, body.rating);
  }),
];
