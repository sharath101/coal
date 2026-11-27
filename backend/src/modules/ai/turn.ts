import {
  dateOfInstant,
  type ChatMessage,
  type ChatStreamEvent,
  type Citation,
  type MessagePart,
} from '@coal/shared';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { newId } from '../../core/db/columns';
import { getRole } from '../org/service';
import { proposalsOfChat } from '../proposals/service';
import type { FileRow } from '../files/service';
import { listLatestVersions } from '../process/service';
import { findProject } from '../rnd/projects';
import { getProductLine } from '../rnd/service';
import { AiProviderError, type AiProvider, type ModelImage, type TurnOutcome } from './provider';
import { costOf } from './pricing';
import { buildInstructions, PROMPT_VERSION } from './prompts';
import { earlierImages, MAX_IMAGES_SHOWN } from './attachments';
import {
  assertWithinBudget,
  attachedLine,
  insertMessage,
  logRequest,
  markOutsideText,
  plainText,
  presentMessage,
  recentMessages,
  setTitle,
  touchChat,
  webAvailable,
  webFoundInChat,
  type ChatRow,
  type MessageRow,
} from './service';
import { buildToolbox } from './toolbox';

/** The replies being written, so a person can stop one. One per chat. */
const running = new Map<string, AbortController>();

export const isReplying = (chatId: string) => running.has(chatId);

export function stopReply(chatId: string): boolean {
  const controller = running.get(chatId);
  controller?.abort();
  return !!controller;
}

export const AI_UNAVAILABLE = () =>
  new AppError(
    503,
    'AI_UNAVAILABLE',
    'The assistant is not set up here. Ask the person who runs COAL.',
  );

/**
 * Where `[S3]` tags in a reply are matched to the records read, and tags the AI invented are
 * dropped. The survivors are numbered 1, 2, 3 in the order the reply first uses them, so a reader
 * sees a tidy list however many records the AI looked at.
 */
export function withCitations(
  raw: string,
  records: Map<string, Citation>,
): { text: string; citations: Citation[] } {
  const numbered = new Map<string, Citation>();
  const text = raw
    .replace(/\[S(\d+)\]/g, (_tag: string, n: string) => {
      const record = records.get(`S${n}`);
      if (!record) return '';
      let citation = numbered.get(record.ref);
      if (!citation) {
        citation = { ...record, ref: `S${numbered.size + 1}` };
        numbered.set(record.ref, citation);
      }
      return `[${citation.ref}]`;
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return { text, citations: [...numbered.values()] };
}

async function contextLines(
  deps: AppDeps,
  orgId: string,
  context: ChatRow['context'],
): Promise<string[]> {
  const lines: string[] = [];
  if (context.projectId) {
    const project = await findProject(deps.db, orgId, context.projectId);
    if (project) lines.push(`Project ${project.code} · ${project.name} (id ${project.id})`);
  }
  if (context.stepKey) lines.push(`Step ${context.stepKey} of that project`);
  if (context.documentId) lines.push(`Document (id ${context.documentId})`);
  if (context.taskId) lines.push(`Task (id ${context.taskId})`);
  if (context.widgetKey) lines.push(`Dashboard widget ${context.widgetKey}`);
  return lines;
}

export interface TurnArgs {
  deps: AppDeps;
  provider: AiProvider;
  ctx: RequestContext;
  actor: Actor;
  chat: ChatRow;
  text: string;
  /** Files the person attached to this message, already checked. */
  files: FileRow[];
  /** The pictures among them, for the model to look at with the message. */
  images?: ModelImage[];
  emit: (event: ChatStreamEvent) => void;
  /** Aborts the reply, when the person stops it or goes away. */
  controller: AbortController;
}

/**
 * Answers one message: checks the budget, saves it, runs the model with the person's tools,
 * streams the words, then saves the reply with its citations and action cards, and logs the
 * request and every tool call (docs/workstation-and-ai.md).
 */
export async function assertCanReply(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  chat: ChatRow,
): Promise<void> {
  if (running.has(chat.id)) {
    throw new AppError(409, 'CHAT_BUSY', 'Wait for the reply to finish, or stop it first.');
  }
  await assertWithinBudget(
    deps.db,
    ctx.orgId,
    actor.userId,
    deps.now(),
    deps.config.ai.dailyBudgetUsd,
  );
}

export async function answerMessage(
  args: TurnArgs,
): Promise<{ userMessage: ChatMessage; message: ChatMessage }> {
  const { deps, ctx, actor, chat, controller } = args;
  const { ai } = deps.config;
  await assertCanReply(deps, ctx, actor, chat);
  running.set(chat.id, controller);
  try {
    return await run(args, ai);
  } finally {
    running.delete(chat.id);
  }
}

async function run(args: TurnArgs, ai: AppDeps['config']['ai']) {
  const { deps, provider, ctx, actor, chat, controller, emit } = args;
  const started = Date.now();
  const requestId = newId();

  const recent = await recentMessages(deps.db, chat.id, ai.historyMessages);
  const history = recent
    .map((m) => ({ role: m.sender, text: plainText(m.parts) }))
    .filter((m) => m.text);
  // A file from outside makes the whole chat "outside" for good (docs/workstation-and-ai.md#safety-basics).
  const hasFile = chat.hasOutsideText || args.files.length > 0;
  if (hasFile && !chat.hasOutsideText) await markOutsideText(deps.db, chat.id);
  const userRow = await insertMessage(deps.db, {
    orgId: ctx.orgId,
    chatId: chat.id,
    sender: 'user',
    parts: [
      { type: 'text', text: args.text, citations: [] },
      ...args.files.map((f) => ({ type: 'file' as const, fileId: f.id, name: f.name })),
    ],
  });
  const prompt = [args.text, ...args.files.map((f) => attachedLine(f.name, f.id))].join('\n\n');
  // The pictures of the chat, newest last: this message's, and recent ones the model saw before.
  const images = [...(await earlierImages(deps, ctx, actor, recent)), ...(args.images ?? [])].slice(
    -MAX_IMAGES_SHOWN,
  );
  const userMessage = presentMessage(userRow);
  emit({ type: 'start', userMessage });

  const [role, line, versions, context, waiting, webFound] = await Promise.all([
    getRole(deps.db, ctx.orgId, actor.roleKey),
    actor.productLineId ? getProductLine(deps.db, ctx.orgId, actor.productLineId) : null,
    listLatestVersions(deps.db, ctx.orgId),
    contextLines(deps, ctx.orgId, chat.context),
    proposalsOfChat(deps.db, ctx.orgId, actor.userId, chat.id, deps.now()),
    chat.usedWeb ? webFoundInChat(deps.db, chat.id) : '',
  ]);
  // The web can be reached here, and the person's switch for this chat is on.
  const canReachWeb = webAvailable(deps);
  const web = canReachWeb && chat.webOn;
  const today = dateOfInstant(deps.now());
  const system = buildInstructions({
    today,
    user: {
      name: actor.name,
      roleKey: actor.roleKey,
      roleName: role?.name ?? actor.roleKey,
      productLine: line?.name ?? null,
    },
    routes: versions.map((v) => v.route),
    context,
    cards: waiting
      .filter((p) => p.status === 'pending')
      .map(
        (p) =>
          `Card ${p.id} (version ${p.version}): ${p.title}. It would: ${p.preview.actions.map((a) => a.summary).join('; ')}.`,
      ),
    hasFile,
    templateFilling: deps.config.templateFilling,
    web: web ? 'on' : canReachWeb ? 'off' : 'unavailable',
    webLookups: ai.web.lookupsPerReply,
    usedWeb: chat.usedWeb,
  });

  const toolbox = buildToolbox({
    deps,
    ctx,
    actor,
    chatId: chat.id,
    requestId,
    maxToolCalls: ai.maxToolCalls,
    signal: controller.signal,
    outsideText: hasFile,
    web,
    usedWeb: chat.usedWeb,
    said: [...history.filter((m) => m.role === 'user').map((m) => m.text), args.text].join('\n'),
    answered: history
      .filter((m) => m.role === 'assistant')
      .map((m) => m.text)
      .join('\n'),
    webFound,
    today,
    emit,
  });

  let written = '';
  let afterTool = 0;
  let outcome: TurnOutcome | null = null;
  let failure: AiProviderError | null = null;
  try {
    outcome = await provider.run({
      // Turning a sample into a template is the hardest thing asked of it: the strong model, always.
      model: hasFile ? ai.models.template : ai.models.chat,
      system,
      history,
      prompt,
      images,
      tools: toolbox.tools,
      maxSteps: ai.maxToolCalls + 1,
      signal: controller.signal,
      // A reply that may look on the web gets the time its lookups may take, on top of its own.
      timeoutMs: ai.turnTimeoutMs + (web ? ai.web.lookupsPerReply * ai.web.timeoutMs : 0),
      onText: (delta) => {
        // Words that follow a lookup start a new paragraph, not the end of the last sentence.
        const lookups = toolbox.calls.length;
        const lead = lookups > afterTool && written && !/\s$/.test(written) ? '\n\n' : '';
        afterTool = lookups;
        written += lead + delta;
        emit({ type: 'text', delta: lead + delta });
      },
    });
  } catch (error) {
    failure =
      error instanceof AiProviderError
        ? error
        : new AiProviderError(error instanceof Error ? error.message : 'The model call failed.');
  }

  const stopped = controller.signal.aborted;
  const { text, citations } = withCitations(written, toolbox.citations);
  const parts: MessagePart[] = [];
  if (toolbox.activity.length > 0) parts.push({ type: 'activity', items: toolbox.activity });
  if (
    text ||
    (!failure &&
      toolbox.cards.length === 0 &&
      toolbox.drafts.size === 0 &&
      toolbox.ideas.length === 0)
  )
    parts.push({ type: 'text', text, citations });
  for (const lookup of toolbox.webRefs) parts.push({ type: 'web', ...lookup });
  for (const proposalId of new Set(toolbox.cards)) parts.push({ type: 'card', proposalId });
  for (const draft of toolbox.drafts.values()) parts.push({ type: 'draft', ...draft });
  for (const idea of toolbox.ideas) parts.push({ type: 'idea', ...idea });

  const usage = outcome?.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
  const model = outcome?.model ?? (hasFile ? ai.models.template : ai.models.chat);
  const request = {
    id: requestId,
    orgId: ctx.orgId,
    chatId: chat.id,
    userId: actor.userId,
    provider: provider.name,
    model,
    purpose: hasFile ? 'template' : 'chat',
    promptVersion: PROMPT_VERSION,
    modelCalls: usage.calls,
    toolCalls: toolbox.calls.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: costOf(model, usage.inputTokens, usage.outputTokens),
    outcome: stopped ? ('stopped' as const) : failure ? ('error' as const) : ('completed' as const),
    errorCode: failure ? (failure.kind === 'unavailable' ? 'AI_UNAVAILABLE' : 'AI_FAILED') : null,
    durationMs: Date.now() - started,
  };

  // Nothing to show: the reply failed before it said anything, so only the log is kept.
  const saveReply =
    !failure ||
    written.length > 0 ||
    toolbox.cards.length > 0 ||
    toolbox.drafts.size > 0 ||
    toolbox.ideas.length > 0 ||
    toolbox.webRefs.length > 0;
  let reply: MessageRow | null = null;
  const firstTitle = chat.title ? undefined : args.text.replace(/\s+/g, ' ').slice(0, 60);
  await deps.db.transaction(async (tx) => {
    if (saveReply) {
      reply = await insertMessage(tx, {
        orgId: ctx.orgId,
        chatId: chat.id,
        sender: 'assistant',
        parts,
        requestId,
        stopped: stopped || !!failure,
      });
    }
    await logRequest(tx, request, toolbox.calls);
    await touchChat(tx, chat.id, firstTitle);
  });

  if (failure && !reply) {
    emit({ type: 'error', code: 'AI_UNAVAILABLE', detail: failure.message });
    throw new AppError(
      502,
      'AI_UNAVAILABLE',
      'The assistant could not answer just now. Try again in a moment.',
    );
  }
  const message = presentMessage(reply as unknown as MessageRow);
  emit({ type: 'done', message });
  if (failure) emit({ type: 'error', code: 'AI_UNAVAILABLE', detail: failure.message });

  if (!chat.title && !failure && !stopped && text) {
    await betterTitle(args, text);
  }
  return { userMessage, message };
}

/** A short title for a new chat, from the cheaper model. Best effort: the first words stay if it fails. */
async function betterTitle(args: TurnArgs, answer: string): Promise<void> {
  const { deps, provider, ctx, actor, chat, emit } = args;
  const { ai } = deps.config;
  const started = Date.now();
  let title = '';
  let outcome: TurnOutcome | null = null;
  try {
    outcome = await provider.run({
      model: ai.models.title,
      system:
        'Write a title of at most six words for this conversation. Reply with the title only: no quotes, no full stop.',
      history: [],
      prompt: `The person asked: ${args.text.slice(0, 400)}\n\nThe answer began: ${answer.slice(0, 400)}`,
      tools: [],
      maxSteps: 1,
      signal: new AbortController().signal,
      timeoutMs: 20_000,
      onText: (delta) => {
        title += delta;
      },
    });
  } catch {
    return;
  }
  title = title
    .replace(/["“”\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const usage = outcome.usage;
  await deps.db.transaction(async (tx) => {
    await logRequest(
      tx,
      {
        id: newId(),
        orgId: ctx.orgId,
        chatId: chat.id,
        userId: actor.userId,
        provider: provider.name,
        model: outcome.model,
        purpose: 'title',
        promptVersion: PROMPT_VERSION,
        modelCalls: usage.calls,
        toolCalls: 0,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: costOf(outcome.model, usage.inputTokens, usage.outputTokens),
        outcome: 'completed',
        errorCode: null,
        durationMs: Date.now() - started,
      },
      [],
    );
  });
  if (title) {
    await setTitle(deps.db, chat.id, title);
    emit({ type: 'title', title });
  }
}
