import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import { RESEARCH_LIMITS } from '../rules/research';
import { SourceView } from './attachments';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';
import { Person } from './projects';

/**
 * The source library and research runs (docs/workstation-and-ai.md#researching-what-already-exists).
 * The library lists the places COAL may search; each place is of a kind COAL's code knows how to
 * search, or a link a person opens themselves.
 */
export const RESEARCH_SOURCE_KINDS = [
  'pubmed',
  'europepmc',
  'clinicaltrials',
  'openfda',
  'journal',
  'website',
  'link',
] as const;
export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];

/** The parts of openFDA a source searches. 510(k) and GUDID records are the products that exist. */
export const OPENFDA_DATASETS = ['510k', 'classification', 'event', 'recall', 'udi'] as const;
export type OpenFdaDataset = (typeof OPENFDA_DATASETS)[number];

const Domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'A website such as odtmag.com, without https://',
  );

const Issn = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{4}-\d{3}[\dX]$/, 'An ISSN such as 2508-2043');

/** How a source is searched. Its `kind` is the kind of the source. */
export const ResearchSourceSettings = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pubmed') }),
  z.object({ kind: z.literal('europepmc') }),
  z.object({ kind: z.literal('clinicaltrials') }),
  z.object({
    kind: z.literal('openfda'),
    datasets: z
      .array(z.enum(OPENFDA_DATASETS))
      .min(1)
      .refine((d) => new Set(d).size === d.length, { error: 'Name each part once.' }),
  }),
  z.object({
    kind: z.literal('journal'),
    issn: Issn,
    /** The journal's PubMed abbreviation (J Spine Surg): searched through PubMed. Left out: through Crossref, by ISSN. */
    pubmedTitle: z.string().trim().min(2).max(120).optional(),
  }),
  z.object({ kind: z.literal('website'), domains: z.array(Domain).min(1).max(10) }),
  z.object({
    kind: z.literal('link'),
    /** Where the person searches; `{q}` in it becomes the search terms. */
    url: z.url({ protocol: /^https$/ }).max(500),
  }),
]);
export type ResearchSourceSettings = z.infer<typeof ResearchSourceSettings>;

export const ResearchSource = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(RESEARCH_SOURCE_KINDS),
  settings: ResearchSourceSettings,
  /** When to use it, in the words of whoever added it. The research assistant reads it. */
  note: z.string(),
  enabled: z.boolean(),
  /** COAL can search it here; otherwise a research run gives the person a link to open. */
  searchable: z.boolean(),
  addedBy: Person.nullable(),
  updatedAt: Timestamp,
});
export type ResearchSource = z.infer<typeof ResearchSource>;

const SourceName = z.string().trim().min(2).max(80);
const SourceNote = z.string().trim().max(500);

export const CreateResearchSourceBody = z.object({
  name: SourceName,
  note: SourceNote.default(''),
  settings: ResearchSourceSettings,
});

export const UpdateResearchSourceBody = z
  .object({
    name: SourceName,
    note: SourceNote,
    settings: ResearchSourceSettings,
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Change at least one thing.' });

export const listResearchSources = defineEndpoint({
  id: 'research.sources.list',
  method: 'GET',
  path: '/research-sources',
  summary: 'The source library: the places COAL may search, and when to use each',
  auth: 'session',
  permission: 'research.sources.read',
  aiTier: 'read',
  response: z.object({ items: z.array(ResearchSource) }),
});

export const createResearchSource = defineEndpoint({
  id: 'research.sources.create',
  method: 'POST',
  path: '/research-sources',
  summary: 'Add a place to the source library',
  auth: 'session',
  permission: 'research.sources.write',
  aiTier: 'never',
  body: CreateResearchSourceBody,
  response: ResearchSource,
  status: 201,
});

export const updateResearchSource = defineEndpoint({
  id: 'research.sources.update',
  method: 'PATCH',
  path: '/research-sources/{id}',
  summary: 'Change a place in the source library, or switch it off',
  auth: 'session',
  permission: 'research.sources.write',
  aiTier: 'never',
  params: IdParams,
  body: UpdateResearchSourceBody,
  response: ResearchSource,
});

// Research runs

export const RESEARCH_STATUSES = ['queued', 'running', 'done', 'failed', 'stopped'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/** What a result is: a paper, a trial, an FDA record or a web page. */
export const RESEARCH_RESULT_KINDS = [
  'article',
  'trial',
  'clearance',
  'classification',
  'adverse_event',
  'recall',
  'device',
  'web',
] as const;
export type ResearchResultKind = (typeof RESEARCH_RESULT_KINDS)[number];

export const StartResearchBody = z.object({
  /** What the person wants to know, in their words. Stays in COAL: only the terms are searched. */
  question: z.string().trim().min(10).max(500),
  /** General search terms: the only words that leave COAL. */
  terms: z.array(z.string().trim().min(2).max(60)).min(1).max(RESEARCH_LIMITS.terms),
  sourceIds: z.array(Id).min(1).max(12),
  /** Only results from this year on. */
  since: z.number().int().min(1950).max(2100).optional(),
  /** Where the results will most likely be kept; the person can choose again. */
  projectId: Id.optional(),
  stepKey: StepKey.optional(),
});
export type StartResearchBody = z.infer<typeof StartResearchBody>;

const SourceRef = z.object({ id: Id, name: z.string(), kind: z.enum(RESEARCH_SOURCE_KINDS) });

export const ResearchResult = z.object({
  id: Id,
  /** How the brief cites it: `[R3]`. */
  ref: z.string(),
  source: SourceRef,
  kind: z.enum(RESEARCH_RESULT_KINDS),
  /** The source's own id: a PubMed id, an NCT number, a 510(k) number, a DOI, an address. */
  externalId: z.string(),
  title: z.string(),
  /** Who and where: the authors and journal, the sponsor, the maker. */
  detail: z.string(),
  year: z.string().nullable(),
  /** Built by COAL from the source's id, never taken from what a source or the model wrote. */
  url: z.string(),
  /** A few lines from the source, or the research assistant's summary of a web page. */
  snippet: z.string(),
  /** When the person kept it as a project source. */
  keptAt: Timestamp.nullable(),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

/** One query sent outside COAL, as it was sent. */
export const ResearchSearch = z.object({
  source: z.string(),
  query: z.string(),
  found: z.number().int(),
  at: Timestamp,
});

const ProjectRef = z.object({ id: Id, code: z.string(), name: z.string() });

export const ResearchRunSummary = z.object({
  id: Id,
  status: z.enum(RESEARCH_STATUSES),
  question: z.string(),
  terms: z.array(z.string()),
  project: ProjectRef.nullable(),
  stepKey: z.string().nullable(),
  resultCount: z.number().int(),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export type ResearchRunSummary = z.infer<typeof ResearchRunSummary>;

export const ResearchRun = ResearchRunSummary.extend({
  since: z.number().int().nullable(),
  sources: z.array(SourceRef.extend({ searched: z.boolean() })),
  /** Places COAL can't search, with the search ready for the person to open. */
  links: z.array(z.object({ sourceId: Id, name: z.string(), url: z.string() })),
  /** The research assistant's brief, citing results as `[R1]`. Outside material until a person keeps a result. */
  brief: z.string().nullable(),
  searches: z.array(ResearchSearch),
  results: z.array(ResearchResult),
  error: z.string().nullable(),
  startedAt: Timestamp.nullable(),
});
export type ResearchRun = z.infer<typeof ResearchRun>;

export const startResearch = defineEndpoint({
  id: 'research.start',
  method: 'POST',
  path: '/research',
  summary:
    'Search the source library for what already exists. Only the terms leave COAL; the research assistant runs in the background and writes a brief',
  auth: 'session',
  permission: 'research.run',
  aiTier: 'confirm',
  body: StartResearchBody,
  response: ResearchRunSummary,
  status: 201,
});

export const listResearch = defineEndpoint({
  id: 'research.list',
  method: 'GET',
  path: '/research',
  summary: 'My research runs, newest first',
  auth: 'session',
  permission: 'research.read',
  aiTier: 'never',
  query: PageQuery.extend({
    /** The run an action card started. */
    proposal: Id.optional(),
  }),
  response: pageOf(ResearchRunSummary),
});

export const getResearch = defineEndpoint({
  id: 'research.get',
  method: 'GET',
  path: '/research/{id}',
  summary: 'One of my research runs, with its brief, results and what was searched',
  auth: 'session',
  permission: 'research.read',
  aiTier: 'never',
  params: IdParams,
  response: ResearchRun,
});

export const stopResearch = defineEndpoint({
  id: 'research.stop',
  method: 'POST',
  path: '/research/{id}/stop',
  summary: 'Stop a research run. What was found so far is kept',
  auth: 'session',
  permission: 'research.write',
  aiTier: 'never',
  params: IdParams,
  response: ResearchRunSummary,
});

export const KeepResearchBody = z.object({
  projectId: Id,
  /** Left out: the sources belong to the whole project, for everyone working on it. */
  stepKey: StepKey.optional(),
  results: z
    .array(z.object({ resultId: Id, note: z.string().trim().max(1000).optional() }))
    .min(1)
    .max(50),
});

export const keepResearch = defineEndpoint({
  id: 'research.keep',
  method: 'POST',
  path: '/research/{id}/keep',
  summary:
    'Keep results as sources of a project (or one of its steps), with a note each. Only kept results become records the assistant may read',
  auth: 'session',
  permission: 'research.write',
  aiTier: 'never',
  params: IdParams,
  body: KeepResearchBody,
  response: z.object({ items: z.array(SourceView) }),
  status: 201,
});
