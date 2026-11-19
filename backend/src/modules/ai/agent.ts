import type Anthropic from '@anthropic-ai/sdk';
import {
  getProject,
  type ActionCard,
  type AiCall,
  type AssistantItem,
  type ChatEvent,
  type DraftRef,
} from '@coal/shared';
import type { FastifyRequest } from 'fastify';
import { newId } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import type { RequestContext } from '../../core/http/context';
import {
  appendMessages,
  DEFAULT_TITLE,
  loadHistory,
  presentChat,
  touchChat,
  type ChatRow,
} from './chats';
import { callEndpoint } from './endpoint-call';
import { aiClient, assertBudget, logCall, modelParams } from './gateway';
import { systemPrompt } from './prompts';
import { routeMessage } from './router';
import { runTool, tools, type ToolContext } from './tools';

export interface TurnArgs {
  deps: AppDeps;
  ctx: RequestContext;
  request: FastifyRequest;
  chat: ChatRow;
  text: string;
  purpose?: string | undefined;
  send: (event: ChatEvent) => void;
}

/** At most this many model calls in one turn, so a confused loop can't run up a bill. */
const MAX_STEPS = 12;

type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/**
 * One turn of the assistant (docs/workstation-and-ai.md#how-the-ai-works-in-the-first-release):
 * the router picks the model, then that model answers, calling tools as the person until it's done.
 * Every message is saved in order, never edited, so the chat replays exactly next turn.
 */
export async function runTurn(a: TurnArgs): Promise<void> {
  const { deps, ctx, request, chat, send } = a;
  const client = aiClient(deps);
  await assertBudget(deps, ctx);
  const scope = { deps, ctx, chatId: chat.id };
  const calls: AiCall[] = [];

  const earlier = (await presentChat(deps.db, chat)).items
    .slice(-2)
    .map((i) => `${i.role === 'user' ? 'Person' : 'Assistant'}: ${i.text.slice(0, 400)}`)
    .join('\n');
  const routed = await routeMessage(scope, a.text, earlier, a.purpose);
  if (routed.call) calls.push(routed.call);
  send({ type: 'route', route: routed.route });

  const userItem = {
    role: 'user' as const,
    id: newId(),
    text: a.text,
    at: new Date().toISOString(),
  };
  const userContent: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: a.text }];
  if (routed.stepKey) {
    userContent.push({
      type: 'text',
      text: `(COAL router: this looks like route step ${routed.stepKey}.)`,
    });
  }
  const history = await loadHistory(deps.db, chat.id);
  await appendMessages(deps.db, ctx.orgId, chat.id, [
    { role: 'user', content: userContent, display: userItem },
  ]);
  send({ type: 'user', item: userItem });
  if (chat.title === DEFAULT_TITLE && routed.title) await touchChat(deps.db, chat.id, routed.title);

  let pinnedProject = null;
  if (chat.projectId) {
    const p = await callEndpoint(
      request,
      getProject,
      { params: { id: chat.projectId } },
      { viaAi: true },
    );
    if (p.ok) {
      const project = p.json as { id: string; code: string; name: string };
      pinnedProject = { id: project.id, code: project.code, name: project.name };
    }
  }
  const system = await systemPrompt(deps, ctx.orgId, { actor: ctx.actor!, pinnedProject });

  const activity: string[] = [];
  const cards: ActionCard[] = [];
  const drafts: DraftRef[] = [];
  const texts: string[] = [];
  const tc: ToolContext = {
    request,
    deps,
    ctx,
    chat,
    calls,
    activity: (text) => {
      activity.push(text);
      send({ type: 'activity', text });
    },
    card: (card) => {
      cards.push(card);
      send({ type: 'card', card });
    },
    draft: (draft) => {
      drafts.push(draft);
      send({ type: 'draft', draft });
    },
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.messages,
    { role: 'user', content: userContent },
  ];
  const purpose = routed.purpose;

  const finish = async (content: unknown, model: string | null) => {
    const item: AssistantItem = {
      role: 'assistant',
      id: newId(),
      text: texts.join('\n\n').trim(),
      at: new Date().toISOString(),
      route: routed.route,
      activity,
      cards,
      drafts,
      usage: {
        calls,
        costUsd: Math.round(calls.reduce((sum, c) => sum + c.costUsd, 0) * 1_000_000) / 1_000_000,
      },
    };
    await appendMessages(deps.db, ctx.orgId, chat.id, [
      { role: 'assistant', content, display: item, model },
    ]);
    await touchChat(deps.db, chat.id);
    send({ type: 'done', item });
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const started = Date.now();
    const stream = client.beta.messages.stream({
      ...modelParams(purpose),
      system,
      tools: tools(),
      messages,
    });
    let streamed = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const delta = !streamed && texts.length ? `\n\n${event.delta.text}` : event.delta.text;
        streamed += event.delta.text;
        send({ type: 'text', delta });
      }
    }
    const message = await stream.finalMessage();
    calls.push(await logCall(scope, purpose.key, message, Date.now() - started));
    const text = message.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
    if (text) texts.push(text);

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );

    if (message.stop_reason === 'tool_use' && toolUses.length) {
      const results: ToolResult[] = await Promise.all(
        toolUses.map(async (block): Promise<ToolResult> => {
          try {
            const outcome = await runTool(block.name, block.input, tc);
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: outcome.content,
              ...(outcome.isError && { is_error: true }),
            };
          } catch (error) {
            request.log.error({ err: error, tool: block.name }, 'assistant tool failed');
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: `The tool failed: ${error instanceof Error ? error.message : 'unknown error'}`,
              is_error: true,
            };
          }
        }),
      );
      messages.push({ role: 'assistant', content: message.content });
      messages.push({ role: 'user', content: results });
      await appendMessages(deps.db, ctx.orgId, chat.id, [
        { role: 'assistant', content: message.content, model: message.model },
        { role: 'user', content: results },
      ]);
      continue;
    }

    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      // A tool call cut off mid-input is never run. Save only what was said.
      texts.push('I ran out of room before finishing. Ask me to continue.');
      await finish([{ type: 'text', text: texts.join('\n\n') }], message.model);
      return;
    }

    if (message.stop_reason === 'refusal') {
      const note = 'I can’t help with that one.';
      texts.push(note);
      send({ type: 'text', delta: note });
    }
    await finish(message.content, message.model);
    return;
  }

  texts.push('I stopped after many steps. Tell me how to narrow it down and I’ll carry on.');
  await finish([{ type: 'text', text: texts.at(-1)! }], null);
}
