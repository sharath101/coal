import type { ResearchSourceSettings } from '@coal/shared';
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';

/**
 * The source library: the places COAL may search (docs/data-model.md#research). A default place
 * has a seed key, so loading the reference data again never adds it twice, or undoes a change.
 */
export const researchSources = pgTable(
  'research_sources',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    seedKey: text('seed_key'),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['pubmed', 'europepmc', 'clinicaltrials', 'openfda', 'journal', 'website', 'link'],
    }).notNull(),
    settings: jsonb('settings').$type<ResearchSourceSettings>().notNull(),
    note: text('note').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    /** Empty for the defaults COAL loads. */
    addedBy: uuid('added_by'),
    ...timestamps(),
  },
  (t) => [
    unique('research_sources_org_name').on(t.orgId, t.name),
    unique('research_sources_org_seed').on(t.orgId, t.seedKey),
  ],
);

/** One research run: the question, the confirmed terms, and what the research assistant found. Its owner only. */
export const researchRuns = pgTable(
  'research_runs',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id').notNull(),
    question: text('question').notNull(),
    terms: jsonb('terms').$type<string[]>().notNull(),
    sourceIds: jsonb('source_ids').$type<string[]>().notNull(),
    since: integer('since'),
    projectId: uuid('project_id'),
    stepKey: text('step_key'),
    /** The action card that started it, and the chat that card was prepared in. */
    proposalId: uuid('proposal_id'),
    chatId: uuid('chat_id'),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'stopped'] })
      .notNull()
      .default('queued'),
    /** Set by the person; the research assistant stops at its next search. */
    stopAsked: boolean('stop_asked').notNull().default(false),
    brief: text('brief'),
    /** Each query sent outside COAL, as it was sent. */
    searches: jsonb('searches')
      .$type<{ source: string; query: string; found: number; at: string }[]>()
      .notNull()
      .default([]),
    error: text('error'),
    /** The model request that wrote the brief (ai_requests). */
    requestId: uuid('request_id'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    ...timestamps(),
  },
  (t) => [
    index('research_runs_user').on(t.orgId, t.userId, t.createdAt),
    index('research_runs_status').on(t.status, t.createdAt),
  ],
);

/** What a run found: one row for each result, by the source's own id. */
export const researchResults = pgTable(
  'research_results',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id),
    ref: text('ref').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => researchSources.id),
    kind: text('kind', {
      enum: [
        'article',
        'trial',
        'clearance',
        'classification',
        'adverse_event',
        'recall',
        'device',
        'web',
      ],
    }).notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    year: text('year'),
    url: text('url').notNull(),
    snippet: text('snippet').notNull().default(''),
    keptAt: timestamptz('kept_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('research_results_run_ref').on(t.runId, t.ref),
    unique('research_results_run_item').on(t.runId, t.sourceId, t.externalId),
  ],
);
