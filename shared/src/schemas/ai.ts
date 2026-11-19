import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, Timestamp } from './common';

/**
 * The Workstation's AI assistant (docs/workstation-and-ai.md). The chat is channel-neutral: a
 * channel sends a person's message and gets back text, activity, action cards and drafts.
 */

/** What a message asks for. The router picks one, and the purpose (and so the model) follows. */
export const AI_INTENTS = [
  'chat',
  'lookup',
  'analysis',
  'idea',
  'assign',
  'draft',
  'explain',
] as const;
export type AiIntent = (typeof AI_INTENTS)[number];

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** One row of the model table: which model each kind of AI work uses, and why. */
export const AiPurpose = z.object({
  key: z.string(),
  label: z.string(),
  model: z.string(),
  modelName: z.string(),
  effort: z.enum(AI_EFFORTS),
  why: z.string(),
  /** US dollars per million tokens. */
  inputPerMTok: z.number(),
  outputPerMTok: z.number(),
});
export type AiPurpose = z.infer<typeof AiPurpose>;

export const AiModels = z.object({
  /** False until ANTHROPIC_API_KEY is set on the server. */
  configured: z.boolean(),
  purposes: z.array(AiPurpose),
  /** What I've spent today, in US dollars. */
  spentTodayUsd: z.number(),
  dailyBudgetUsd: z.number(),
});
export type AiModels = z.infer<typeof AiModels>;

export const AiCall = z.object({
  purpose: z.string(),
  model: z.string(),
  modelName: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  costUsd: z.number(),
  ms: z.number().int(),
});
export type AiCall = z.infer<typeof AiCall>;

export const AiUsage = z.object({ calls: z.array(AiCall), costUsd: z.number() });
export type AiUsage = z.infer<typeof AiUsage>;

/** How the router read a message, and the model it chose. */
export const AiRoute = z.object({
  intent: z.enum(AI_INTENTS),
  purpose: z.string(),
  model: z.string(),
  modelName: z.string(),
  effort: z.enum(AI_EFFORTS),
  reason: z.string(),
});
export type AiRoute = z.infer<typeof AiRoute>;

export const CARD_STATUSES = ['pending', 'confirmed', 'rejected', 'failed'] as const;

/**
 * An action card. `proposal`: something only the person may confirm (docs/api.md#proposals-and-action-cards).
 * `link`: a never-tier action the AI prepared; the button opens the screen where the person does it.
 */
export const ActionCard = z.object({
  id: Id,
  kind: z.enum(['proposal', 'link']),
  title: z.string(),
  lines: z.array(z.string()),
  warnings: z.array(z.string()),
  status: z.enum(CARD_STATUSES),
  href: z.string().nullable(),
  /** What happened on confirm, in plain words. */
  result: z.string().nullable(),
});
export type ActionCard = z.infer<typeof ActionCard>;

/** A document the AI drafted, on the template or on Jayon's letterhead. */
export const DraftRef = z.object({
  id: Id,
  title: z.string(),
  stepKey: z.string().nullable(),
  /** The template file it followed, or null when it used the letterhead only. */
  template: z.string().nullable(),
  gaps: z.array(z.string()),
  modelName: z.string(),
  createdAt: Timestamp,
});
export type DraftRef = z.infer<typeof DraftRef>;

export const UserItem = z.object({
  role: z.literal('user'),
  id: Id,
  text: z.string(),
  at: Timestamp,
});

export const AssistantItem = z.object({
  role: z.literal('assistant'),
  id: Id,
  text: z.string(),
  at: Timestamp,
  route: AiRoute,
  activity: z.array(z.string()),
  cards: z.array(ActionCard),
  drafts: z.array(DraftRef),
  usage: AiUsage,
});
export type AssistantItem = z.infer<typeof AssistantItem>;

export const ChatItem = z.discriminatedUnion('role', [UserItem, AssistantItem]);
export type ChatItem = z.infer<typeof ChatItem>;

export const ChatSummary = z.object({
  id: Id,
  title: z.string(),
  projectId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ChatSummary = z.infer<typeof ChatSummary>;

export const ChatDetail = z.object({ chat: ChatSummary, items: z.array(ChatItem) });
export type ChatDetail = z.infer<typeof ChatDetail>;

/** Server-Sent Events from `POST /ai/chats/{id}/messages`, one JSON object per `data:` line. */
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), item: UserItem }),
  z.object({ type: z.literal('route'), route: AiRoute }),
  z.object({ type: z.literal('activity'), text: z.string() }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('card'), card: ActionCard }),
  z.object({ type: z.literal('draft'), draft: DraftRef }),
  z.object({ type: z.literal('done'), item: AssistantItem }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

export const SendMessageBody = z.object({
  text: z.string().trim().min(1).max(8000),
  /** Use this model table row instead of the router's choice (for trying models side by side). */
  purpose: z.string().max(40).optional(),
});

export const getAiModels = defineEndpoint({
  id: 'ai.models',
  method: 'GET',
  path: '/ai/models',
  summary: 'Which model each kind of AI work uses, and what I have spent today',
  auth: 'session',
  permission: 'ai.models.read',
  aiTier: 'none',
  response: AiModels,
});

export const listChats = defineEndpoint({
  id: 'ai.chats.list',
  method: 'GET',
  path: '/ai/chats',
  summary: 'My chats with the assistant, newest first',
  auth: 'session',
  permission: 'ai.chats.read',
  aiTier: 'none',
  response: z.object({ items: z.array(ChatSummary) }),
});

export const createChat = defineEndpoint({
  id: 'ai.chats.create',
  method: 'POST',
  path: '/ai/chats',
  summary: 'Start a chat, optionally pinned to a project',
  auth: 'session',
  permission: 'ai.chats.write',
  aiTier: 'none',
  body: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    projectId: Id.optional(),
  }),
  response: ChatSummary,
  status: 201,
});

export const getChat = defineEndpoint({
  id: 'ai.chats.get',
  method: 'GET',
  path: '/ai/chats/{id}',
  summary: 'One of my chats, with its messages',
  auth: 'session',
  permission: 'ai.chats.read',
  aiTier: 'none',
  params: IdParams,
  response: ChatDetail,
});

/** Streams ChatEvents as Server-Sent Events, so it has no JSON response. */
export const sendChatMessage = defineEndpoint({
  id: 'ai.chats.send',
  method: 'POST',
  path: '/ai/chats/{id}/messages',
  summary: 'Send a message to the assistant. The reply streams back as Server-Sent Events',
  auth: 'session',
  permission: 'ai.chats.write',
  aiTier: 'none',
  params: IdParams,
  body: SendMessageBody,
});

export const confirmProposal = defineEndpoint({
  id: 'ai.proposals.confirm',
  method: 'POST',
  path: '/ai/proposals/{id}/confirm',
  summary: 'Carry out an action card. Only its person may, and never through the AI',
  auth: 'session',
  permission: 'ai.proposals.decide',
  aiTier: 'never',
  params: IdParams,
  response: ActionCard,
});

export const rejectProposal = defineEndpoint({
  id: 'ai.proposals.reject',
  method: 'POST',
  path: '/ai/proposals/{id}/reject',
  summary: 'Discard an action card',
  auth: 'session',
  permission: 'ai.proposals.decide',
  aiTier: 'never',
  params: IdParams,
  response: ActionCard,
});

/** Sends the file itself (PDF or Word), so it has no JSON response. */
export const getDraftFile = defineEndpoint({
  id: 'ai.drafts.file',
  method: 'GET',
  path: '/ai/drafts/{id}/file',
  summary: 'A draft the assistant made for me, as PDF or Word',
  auth: 'session',
  permission: 'ai.drafts.read',
  aiTier: 'none',
  params: IdParams,
  query: z.object({ format: z.enum(['pdf', 'docx']).default('pdf') }),
});
