import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id } from './common';

export const SEARCH_TYPES = ['project', 'document', 'task', 'person'] as const;

/** One thing found. Only what the person may see is ever returned (docs/roles-and-access.md#how-access-is-enforced). */
export const SearchHit = z.object({
  type: z.enum(SEARCH_TYPES),
  id: Id,
  title: z.string(),
  subtitle: z.string(),
  /** A few words around the match, from text the person may read. */
  snippet: z.string().nullable(),
  /** The project it belongs to, if any. */
  projectId: Id.nullable(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  /** Comma-separated: `project,document`. Left out: everything. */
  types: z
    .string()
    .regex(/^(project|document|task|person)(,(project|document|task|person))*$/)
    .optional(),
  /** At most this many of each type. */
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const search = defineEndpoint({
  id: 'search',
  method: 'GET',
  path: '/search',
  summary: 'Projects, documents, tasks and people matching some words, filtered by what I may see',
  auth: 'session',
  permission: 'search.read',
  aiTier: 'read',
  query: SearchQuery,
  response: z.object({ items: z.array(SearchHit) }),
});
