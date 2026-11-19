import type Anthropic from '@anthropic-ai/sdk';
import {
  createProject,
  ENDPOINTS,
  type ActionCard,
  type AiCall,
  type DraftRef,
  type EndpointSpec,
} from '@coal/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../core/deps';
import type { RequestContext } from '../../core/http/context';
import type { ChatRow } from './chats';
import { draftDocument, readDraft, readTemplate, templateList } from './drafts';
import { callEndpoint, endpointById, problemText, type EndpointInput } from './endpoint-call';
import { describeResult, linkCard, proposeAction } from './proposals';

/**
 * The assistant's tools (docs/workstation-and-ai.md#what-the-ai-may-do). They are made from the
 * endpoint contracts: every `read` and `auto` endpoint is a tool, every `confirm` endpoint is a
 * `propose_…` tool that makes an action card, and `never` endpoints are not tools at all.
 */

export interface ToolContext {
  request: FastifyRequest;
  deps: AppDeps;
  ctx: RequestContext;
  chat: ChatRow;
  activity: (text: string) => void;
  card: (card: ActionCard) => void;
  draft: (draft: DraftRef) => void;
  calls: AiCall[];
}

export interface ToolOutcome {
  content: string | Anthropic.Beta.BetaToolResultBlockParam['content'];
  isError?: boolean;
}

type JsonSchema = Record<string, unknown>;

/** JSON Schema for a tool input, trimmed of what only costs tokens. */
function jsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema') continue;
      if (key === 'pattern' && (node as JsonSchema).format === 'uuid') continue;
      if ((key === 'maximum' || key === 'minimum') && Math.abs(Number(value)) > 1e12) continue;
      out[key] = clean(value);
    }
    return out;
  };
  return clean(raw) as JsonSchema;
}

function endpointInputSchema(e: EndpointSpec, extra: Record<string, JsonSchema> = {}) {
  const properties: Record<string, JsonSchema> = { ...extra };
  const required: string[] = Object.keys(extra);
  if (e.params) {
    properties.params = jsonSchema(e.params);
    required.push('params');
  }
  if (e.query) {
    const shape = { ...e.query.shape } as Record<string, z.ZodType>;
    delete shape.preview;
    if (Object.keys(shape).length) properties.query = jsonSchema(z.object(shape));
  }
  if (e.body) {
    properties.body = jsonSchema(e.body);
    required.push('body');
  }
  return { type: 'object' as const, properties, required, additionalProperties: false };
}

const toolName = (id: string) => id.replace(/\./g, '_');

const READ_ENDPOINTS = (ENDPOINTS as readonly EndpointSpec[]).filter(
  (e) =>
    (e.aiTier === 'read' || e.aiTier === 'auto') &&
    !e.id.startsWith('files.') &&
    !e.id.startsWith('ai.'),
);

const PROPOSE_ENDPOINTS = (ENDPOINTS as readonly EndpointSpec[]).filter(
  (e) => e.aiTier === 'confirm',
);

const HINTS: Record<string, string> = {
  'users.list':
    ' Search by name with query.q. Use it to resolve a person before proposing work for them.',
  'tasks.list': ' scope "mine" is assigned to the person; "queue" is waiting for their role.',
  'projects.route': ' The whole route of a project: every step, its status, doers and signer.',
  'processes.getStep': ' The definition of one route step. The R&D route key is "rnd-route".',
  'tasks.update': ' Only for the person’s own tasks.',
};

const ACTIVITY: Record<string, string> = {
  'projects.list': 'Looked at the projects',
  'projects.get': 'Opened a project',
  'projects.route': 'Read a project’s route',
  'projects.team.get': 'Checked a team',
  'projects.activity': 'Read a project’s activity',
  'steps.get': 'Opened a step',
  'tasks.list': 'Looked at tasks',
  'tasks.get': 'Opened a task',
  'tasks.update': 'Updated your task',
  'users.list': 'Looked up people',
  'users.get': 'Looked up a person',
  'me.get': 'Checked your profile',
  'org.listRoles': 'Looked at the roles',
  'rnd.listProductLines': 'Looked at the product lines',
  'processes.list': 'Looked at the processes',
  'processes.get': 'Read the route definition',
  'processes.getStep': 'Read a step’s definition',
};

const CARD_TITLE = {
  card_title: {
    type: 'string',
    description: 'A short title for the action card, e.g. "Ask Anil to rerun the FEA".',
  },
};

const STEP_KEY = { type: 'string', description: 'The route step, e.g. "1", "2a", "13", "24a".' };

const PrepareGoInput = z.object({
  name: z.string().min(3).max(120),
  concept: z.string().max(2000),
  productLineId: z.uuid(),
  teamUserIds: z.array(z.uuid()).max(30).default([]),
});
const StepInput = z.object({ stepKey: z.string().min(1).max(4) });
const ReadTemplateInput = StepInput.extend({ file: z.string().min(1).max(300) });
const DraftInput = z.object({
  stepKey: z.string().min(1).max(4),
  request: z.string().min(1).max(4000),
  projectId: z.uuid().optional(),
});
const ReadDraftInput = z.object({ draftId: z.uuid() });

let cached: Anthropic.Beta.BetaToolUnion[] | null = null;

/** The tool list. The same for everyone and every turn, so it stays in the prompt cache. */
export function tools(): Anthropic.Beta.BetaToolUnion[] {
  if (cached) return cached;
  const list: Anthropic.Beta.BetaTool[] = [
    ...READ_ENDPOINTS.map((e) => ({
      name: toolName(e.id),
      description: `${e.summary}.${HINTS[e.id] ?? ''}`,
      input_schema: endpointInputSchema(e),
    })),
    ...PROPOSE_ENDPOINTS.map((e) => ({
      name: `propose_${toolName(e.id)}`,
      description: `Make an action card to ${e.summary.charAt(0).toLowerCase()}${e.summary.slice(1)}. Nothing happens until the person confirms the card.${HINTS[e.id] ?? ''}`,
      input_schema: endpointInputSchema(e, CARD_TITLE),
    })),
    {
      name: 'prepare_go',
      description:
        'Prepare Go for a new project from the VP’s idea: previews what Go would do and gives the VP a card that opens the Go form filled in. Only the VP can press Go. Product line ids come from rnd_listProductLines; extra team members from users_list.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A clear project name.' },
          concept: { type: 'string', description: 'The concept in a few lines.' },
          productLineId: { type: 'string' },
          teamUserIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'concept', 'productLineId'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_templates',
      description:
        'List Jayon’s template files for a route step (Word, PDF, Excel), and any notes such as "no document, will have to create". Read fresh every time.',
      input_schema: {
        type: 'object',
        properties: { stepKey: STEP_KEY },
        required: ['stepKey'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_template',
      description: 'Read one template file for a step, to explain it or answer questions about it.',
      input_schema: {
        type: 'object',
        properties: { stepKey: STEP_KEY, file: { type: 'string', description: 'The file name.' } },
        required: ['stepKey', 'file'],
        additionalProperties: false,
      },
    },
    {
      name: 'draft_document',
      description:
        'Draft a document for a route step. It checks Jayon’s templates for the step and follows the right one; if there is none, it writes one in the same style on Jayon’s letterhead. The writing is done by the drafting model; you get back the title, the template used and the gaps to fill.',
      input_schema: {
        type: 'object',
        properties: {
          stepKey: STEP_KEY,
          request: {
            type: 'string',
            description: 'What the person asked for, in their words, plus any details they gave.',
          },
          projectId: { type: 'string', description: 'The project it is for, if any.' },
        },
        required: ['stepKey', 'request'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_draft',
      description: 'Read a draft made earlier in this chat (as PDF), to explain or check it.',
      input_schema: {
        type: 'object',
        properties: { draftId: { type: 'string' } },
        required: ['draftId'],
        additionalProperties: false,
      },
    },
  ];
  // Inputs stream as they're generated; runTool validates every input before using it.
  cached = list.map((t) => ({ ...t, eager_input_streaming: true }));
  return cached;
}

const json = (value: unknown) => JSON.stringify(value);

function asInput(raw: unknown): EndpointInput & { card_title?: string } {
  return raw && typeof raw === 'object' ? raw : {};
}

export async function runTool(name: string, raw: unknown, tc: ToolContext): Promise<ToolOutcome> {
  const readEndpoint = READ_ENDPOINTS.find((e) => toolName(e.id) === name);
  if (readEndpoint) {
    tc.activity(ACTIVITY[readEndpoint.id] ?? readEndpoint.summary);
    const result = await callEndpoint(tc.request, readEndpoint, asInput(raw), { viaAi: true });
    return result.ok
      ? { content: json(result.json) }
      : { content: problemText(result), isError: true };
  }

  const proposeEndpoint = PROPOSE_ENDPOINTS.find((e) => `propose_${toolName(e.id)}` === name);
  if (proposeEndpoint) {
    const input = asInput(raw);
    const title = input.card_title?.trim() || proposeEndpoint.summary;
    const outcome = await proposeAction(tc.request, tc.deps, tc.ctx, tc.chat.id, title, {
      endpointId: proposeEndpoint.id,
      ...(input.params && { params: input.params }),
      ...(input.query && { query: input.query }),
      ...(input.body !== undefined && { body: input.body }),
    });
    if ('error' in outcome) return { content: outcome.error, isError: true };
    tc.activity('Made an action card');
    tc.card(outcome.card);
    return {
      content: json({
        card: 'shown to the person, waiting for them to confirm',
        willDo: outcome.card.lines,
        warnings: outcome.card.warnings,
      }),
    };
  }

  switch (name) {
    case 'prepare_go': {
      const parsed = PrepareGoInput.safeParse(raw);
      if (!parsed.success) return { content: parsed.error.message, isError: true };
      const input = parsed.data;
      tc.activity('Previewed Go');
      const body = {
        name: input.name,
        description: input.concept,
        productLineId: input.productLineId,
        teamUserIds: input.teamUserIds,
      };
      // A preview changes nothing; the VP presses Go on the form themselves.
      const preview = await callEndpoint(
        tc.request,
        endpointById(createProject.id)!,
        { body },
        {
          viaAi: false,
          preview: true,
        },
      );
      if (!preview.ok) return { content: problemText(preview), isError: true };
      const described = describeResult(preview.json);
      const href = `/projects/new?${new URLSearchParams({
        name: input.name,
        concept: input.concept,
        productLine: input.productLineId,
        ...(input.teamUserIds.length && { team: input.teamUserIds.join(',') }),
      }).toString()}`;
      const card = await linkCard(tc.deps, tc.ctx, tc.chat.id, {
        title: `Go: ${input.name}`,
        lines: [input.concept, ...described.lines],
        warnings: described.warnings,
        href,
      });
      tc.card(card);
      return {
        content: json({
          card: 'shown to the VP with a button that opens the Go form filled in',
          wouldDo: described.lines,
          warnings: described.warnings,
        }),
      };
    }
    case 'find_templates': {
      const parsed = StepInput.safeParse(raw);
      if (!parsed.success) return { content: parsed.error.message, isError: true };
      tc.activity(`Checked the templates for step ${parsed.data.stepKey}`);
      return { content: json(await templateList(parsed.data.stepKey)) };
    }
    case 'read_template': {
      const parsed = ReadTemplateInput.safeParse(raw);
      if (!parsed.success) return { content: parsed.error.message, isError: true };
      tc.activity(`Read the template “${parsed.data.file}”`);
      return readTemplate(parsed.data.stepKey, parsed.data.file);
    }
    case 'draft_document': {
      const parsed = DraftInput.safeParse(raw);
      if (!parsed.success) return { content: parsed.error.message, isError: true };
      return draftDocument(tc, parsed.data);
    }
    case 'read_draft': {
      const parsed = ReadDraftInput.safeParse(raw);
      if (!parsed.success) return { content: parsed.error.message, isError: true };
      tc.activity('Read the draft');
      return readDraft(tc, parsed.data.draftId);
    }
    default:
      return { content: `There is no tool called ${name}.`, isError: true };
  }
}
