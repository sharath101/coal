import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Person, Preview } from './projects';

/**
 * One action in a proposal: a call to an endpoint, made as the user when they confirm
 * (docs/api.md#proposals-and-action-cards). Only endpoints of the `auto` or `confirm` tier
 * that know how to describe themselves on a card can be proposed.
 */
export const ProposalAction = z.object({
  /** The endpoint's id, such as `tasks.create`. */
  endpoint: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).default({}),
  query: z.record(z.string(), z.unknown()).default({}),
  body: z.unknown().optional(),
  /** For edits: the version the person saw. */
  ifMatch: z.string().max(200).optional(),
});
export type ProposalAction = z.infer<typeof ProposalAction>;

/** What one action would do, in plain words, with who gets what and who is told. */
export const ActionPreview = z.object({
  endpoint: z.string(),
  summary: z.string(),
  effects: Preview,
  notified: z.array(Person),
});
export type ActionPreview = z.infer<typeof ActionPreview>;

export const PROPOSAL_STATUSES = ['pending', 'confirmed', 'rejected', 'expired', 'failed'] as const;

export const Proposal = z.object({
  id: Id,
  /** Goes up with every edit; confirming needs the version the person saw. */
  version: z.number().int(),
  status: z.enum(PROPOSAL_STATUSES),
  title: z.string(),
  /** Prepared by the AI in this chat; empty for a bulk action from a screen. */
  chatId: Id.nullable(),
  preparedByAi: z.boolean(),
  actions: z.array(ProposalAction),
  preview: z.object({ actions: z.array(ActionPreview) }),
  expiresAt: Timestamp,
  confirmedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Proposal = z.infer<typeof Proposal>;

const ProposalBody = z.object({
  title: z.string().trim().min(3).max(200),
  actions: z.array(ProposalAction).min(1).max(20),
});

export const createProposal = defineEndpoint({
  id: 'proposals.create',
  method: 'POST',
  path: '/proposals',
  summary:
    'Prepare one or more actions for me to confirm. The server previews them together and keeps the preview as version 1',
  auth: 'session',
  permission: 'proposals.create',
  aiTier: 'auto',
  body: ProposalBody,
  response: Proposal,
  status: 201,
});

export const listProposals = defineEndpoint({
  id: 'proposals.list',
  method: 'GET',
  path: '/proposals',
  summary: 'My proposals, newest first',
  auth: 'session',
  permission: 'proposals.list',
  aiTier: 'read',
  query: PageQuery.extend({ status: z.enum(PROPOSAL_STATUSES).optional() }),
  response: pageOf(Proposal),
});

export const getProposal = defineEndpoint({
  id: 'proposals.get',
  method: 'GET',
  path: '/proposals/{id}',
  summary: 'One of my proposals',
  auth: 'session',
  permission: 'proposals.read',
  aiTier: 'read',
  params: IdParams,
  response: Proposal,
});

export const updateProposal = defineEndpoint({
  id: 'proposals.update',
  method: 'PATCH',
  path: '/proposals/{id}',
  summary:
    'Change a pending proposal (who, dates, wording). Previews it again as a new version. Needs If-Match with the version seen',
  auth: 'session',
  permission: 'proposals.write',
  aiTier: 'auto',
  params: IdParams,
  body: ProposalBody.partial({ title: true }),
  response: Proposal,
});

export const confirmProposal = defineEndpoint({
  id: 'proposals.confirm',
  method: 'POST',
  path: '/proposals/{id}/confirm',
  summary:
    'Carry out every action of a proposal together, once. Needs If-Match with the version seen; if the effect has changed, nothing happens and the new preview is saved',
  auth: 'session',
  permission: 'proposals.write',
  // Only the person, from their own session: never the AI.
  aiTier: 'never',
  params: IdParams,
  response: Proposal,
});

export const rejectProposal = defineEndpoint({
  id: 'proposals.reject',
  method: 'POST',
  path: '/proposals/{id}/reject',
  summary: 'Discard a pending proposal',
  auth: 'session',
  permission: 'proposals.write',
  aiTier: 'never',
  params: IdParams,
  response: Proposal,
});
