import {
  researchTermProblems,
  searchLink,
  siteSearchLink,
  type ResearchRun,
  type ResearchRunSummary,
  type ResearchSource,
  type ResearchSourceSettings,
  type SourceView,
  type StartResearchBody,
} from '@coal/shared';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { keepSources } from '../attachments/service';
import type { AiProvider } from '../ai/provider';
import { AI_UNAVAILABLE } from '../ai/turn';
import { assertWithinBudget } from '../ai/service';
import { assertCanAccess } from '../permissions';
import { allProjects, findProject } from '../rnd/projects';
import { findUsersByIds, listActiveUsers } from '../users/service';
import { DEFAULT_RESEARCH_SOURCES } from './catalogue';
import { cut } from './connectors/client';
import { researchResults, researchRuns, researchSources } from './tables';

export type SourceRow = typeof researchSources.$inferSelect;
export type RunRow = typeof researchRuns.$inferSelect;
export type ResultRow = typeof researchResults.$inferSelect;

/** Loads the default public sources: only the missing ones, so a change to one is never undone. */
export async function loadResearchSources(ex: Executor, orgId: string): Promise<void> {
  await ex
    .insert(researchSources)
    .values(
      DEFAULT_RESEARCH_SOURCES.map((s) => ({
        orgId,
        seedKey: s.key,
        name: s.name,
        kind: s.settings.kind,
        settings: s.settings,
        note: s.note,
      })),
    )
    .onConflictDoNothing();
}

/** COAL can search it here: a link never, a website only where the provider can search the web. */
export const isSearchable = (settings: ResearchSourceSettings, provider: AiProvider | null) =>
  settings.kind === 'link' ? false : settings.kind === 'website' ? !!provider?.searchWeb : true;

async function presentSources(
  deps: AppDeps,
  orgId: string,
  rows: SourceRow[],
): Promise<ResearchSource[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.addedBy ? [r.addedBy] : [])))];
  const names = new Map(
    (await findUsersByIds(deps.db, orgId, ids)).map((u) => [u.id, u.name] as const),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    settings: r.settings,
    note: r.note,
    enabled: r.enabled,
    searchable: isSearchable(r.settings, deps.ai),
    addedBy: r.addedBy ? { id: r.addedBy, name: names.get(r.addedBy) ?? 'Unknown' } : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function sourceRows(ex: Executor, orgId: string, ids?: string[]) {
  if (ids && ids.length === 0) return [];
  return ex
    .select()
    .from(researchSources)
    .where(
      and(eq(researchSources.orgId, orgId), ids ? inArray(researchSources.id, ids) : undefined),
    )
    .orderBy(desc(researchSources.enabled), asc(researchSources.name));
}

export async function listResearchSources(deps: AppDeps, ctx: RequestContext) {
  return presentSources(deps, ctx.orgId, await sourceRows(deps.db, ctx.orgId));
}

async function assertFreeName(ex: Executor, orgId: string, name: string, except?: string) {
  const [taken] = await ex
    .select({ id: researchSources.id })
    .from(researchSources)
    .where(
      and(
        eq(researchSources.orgId, orgId),
        sql`lower(${researchSources.name}) = lower(${name})`,
        except ? sql`${researchSources.id} <> ${except}` : undefined,
      ),
    );
  if (taken) throw validationFailed('The library already has a source with this name.', 'name');
}

export async function addResearchSource(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  body: { name: string; note: string; settings: ResearchSourceSettings },
): Promise<ResearchSource> {
  const row = await change(deps.db, ctx, async (tx, log) => {
    await assertFreeName(tx, ctx.orgId, body.name);
    const [added] = await tx
      .insert(researchSources)
      .values({
        orgId: ctx.orgId,
        name: body.name,
        kind: body.settings.kind,
        settings: body.settings,
        note: body.note,
        addedBy: actor.userId,
      })
      .returning();
    const source = added as SourceRow;
    log.audit({
      action: 'research_source.added',
      recordType: 'research_source',
      recordId: source.id,
      after: { name: source.name, settings: source.settings, note: source.note },
    });
    return source;
  });
  return (await presentSources(deps, ctx.orgId, [row]))[0] as ResearchSource;
}

export async function changeResearchSource(
  deps: AppDeps,
  ctx: RequestContext,
  id: string,
  body: {
    name?: string | undefined;
    note?: string | undefined;
    settings?: ResearchSourceSettings | undefined;
    enabled?: boolean | undefined;
  },
): Promise<ResearchSource> {
  const row = await change(deps.db, ctx, async (tx, log) => {
    const [before] = await tx
      .select()
      .from(researchSources)
      .where(and(eq(researchSources.orgId, ctx.orgId), eq(researchSources.id, id)))
      .for('update');
    if (!before) throw notFound('source');
    if (body.name !== undefined) await assertFreeName(tx, ctx.orgId, body.name, id);
    const [after] = await tx
      .update(researchSources)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.note !== undefined && { note: body.note }),
        ...(body.settings !== undefined && { settings: body.settings, kind: body.settings.kind }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      })
      .where(eq(researchSources.id, id))
      .returning();
    const source = after as SourceRow;
    log.audit({
      action: 'research_source.changed',
      recordType: 'research_source',
      recordId: id,
      before: {
        name: before.name,
        settings: before.settings,
        note: before.note,
        enabled: before.enabled,
      },
      after: {
        name: source.name,
        settings: source.settings,
        note: source.note,
        enabled: source.enabled,
      },
    });
    return source;
  });
  return (await presentSources(deps, ctx.orgId, [row]))[0] as ResearchSource;
}

// Runs

/** What must never leave COAL in a search: every project's code and name, and every person's name. */
async function privatePhrases(ex: Executor, orgId: string): Promise<string[]> {
  const [projects, people] = await Promise.all([
    allProjects(ex, orgId),
    listActiveUsers(ex, orgId),
  ]);
  return [...projects.flatMap((p) => [p.code, p.name]), ...people.map((u) => u.name)];
}

/** The sources of a run, with whether COAL searches each here and, if not, the search to open. */
export function sourcePlan(rows: SourceRow[], terms: string[], provider: AiProvider | null) {
  return rows.map((row) => {
    const searched = isSearchable(row.settings, provider);
    const link = searched
      ? null
      : row.settings.kind === 'link'
        ? searchLink(row.settings.url, terms)
        : row.settings.kind === 'website'
          ? siteSearchLink(row.settings.domains, terms)
          : null;
    return { row, searched, link };
  });
}

/** Checks a run before it starts, the same way for the card's preview and for confirming. */
export async function checkRun(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  body: StartResearchBody,
) {
  const rows = await sourceRows(deps.db, ctx.orgId, [...new Set(body.sourceIds)]);
  const usable = rows.filter((r) => r.enabled);
  if (usable.length !== new Set(body.sourceIds).size) {
    throw validationFailed(
      'Choose sources from the library that are switched on (list_research_sources).',
      'sourceIds',
    );
  }
  const problems = researchTermProblems(body.terms, {
    private: await privatePhrases(deps.db, ctx.orgId),
  });
  if (problems.length > 0) {
    throw new AppError(400, 'VALIDATION_FAILED', problems.join(' '), {
      errors: problems.map((message) => ({ path: 'terms', message })),
    });
  }
  if (body.stepKey && !body.projectId) {
    throw validationFailed('Choose the project the step belongs to.', 'projectId');
  }
  const project = body.projectId ? await findProject(deps.db, ctx.orgId, body.projectId) : null;
  if (body.projectId && !project) throw validationFailed('There is no such project.', 'projectId');
  const plan = sourcePlan(usable, body.terms, deps.ai);
  if (plan.some((p) => p.searched)) {
    if (!deps.ai) throw AI_UNAVAILABLE();
    await assertWithinBudget(
      deps.db,
      ctx.orgId,
      actor.userId,
      deps.now(),
      deps.config.ai.dailyBudgetUsd,
    );
  }
  return { plan, project };
}

export async function startRun(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  body: StartResearchBody,
): Promise<ResearchRunSummary> {
  const { plan, project } = await checkRun(deps, ctx, actor, body);
  const searching = plan.some((p) => p.searched);
  const row = await change(deps.db, ctx, async (tx, log) => {
    const now = deps.now();
    const [inserted] = await tx
      .insert(researchRuns)
      .values({
        orgId: ctx.orgId,
        userId: actor.userId,
        question: body.question,
        terms: body.terms,
        sourceIds: plan.map((p) => p.row.id),
        since: body.since ?? null,
        projectId: project?.id ?? null,
        stepKey: body.stepKey ?? null,
        // A card's preview runs before the card exists, so it has no id yet.
        proposalId: ctx.proposal && UUID.test(ctx.proposal.id) ? ctx.proposal.id : null,
        chatId: ctx.proposal?.chatId ?? null,
        // Only links: nothing for the research assistant to do.
        ...(!searching && { status: 'done' as const, finishedAt: now }),
      })
      .returning();
    const run = inserted as RunRow;
    log.audit({
      action: 'research.started',
      recordType: 'research_run',
      recordId: run.id,
      // The words that leave COAL, and where they go.
      after: {
        terms: run.terms,
        searched: plan.filter((p) => p.searched).map((p) => p.row.name),
        linksOnly: plan.filter((p) => !p.searched).map((p) => p.row.name),
        since: run.since,
      },
    });
    if (searching) {
      log.event({ type: 'research.requested', payload: { runId: run.id } });
    }
    return run;
  });
  return summaryOf(row, project, 0);
}

type ProjectRef = { id: string; code: string; name: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summaryOf(row: RunRow, project: ProjectRef, resultCount: number): ResearchRunSummary {
  return {
    id: row.id,
    status: row.status,
    question: row.question,
    terms: row.terms,
    project: project ? { id: project.id, code: project.code, name: project.name } : null,
    stepKey: row.stepKey,
    resultCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function findRun(ex: Executor, orgId: string, id: string): Promise<RunRow | null> {
  const [row] = await ex
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.orgId, orgId), eq(researchRuns.id, id)));
  return row ?? null;
}

async function ownRun(deps: AppDeps, ctx: RequestContext, actor: Actor, id: string, write = false) {
  const row = await findRun(deps.db, ctx.orgId, id);
  if (!row) throw notFound('research run');
  assertCanAccess(write ? 'research.write' : 'research.read', actor, row);
  return row;
}

export async function resultsOf(ex: Executor, runId: string): Promise<ResultRow[]> {
  return ex
    .select()
    .from(researchResults)
    .where(eq(researchResults.runId, runId))
    .orderBy(sql`(substring(${researchResults.ref} from 2))::int`);
}

async function projectRefs(deps: AppDeps, orgId: string, rows: RunRow[]) {
  const ids = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
  const found = await Promise.all(ids.map((id) => findProject(deps.db, orgId, id)));
  return new Map(found.flatMap((p) => (p ? [[p.id, p] as const] : [])));
}

const encodeCursor = (row: RunRow) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');

function decodeCursor(cursor: string): [Date, string] {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof at === 'string' && typeof id === 'string') return [new Date(at), id];
  } catch {
    // fall through
  }
  throw validationFailed('The cursor is not valid.', 'cursor');
}

export async function listRuns(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  query: { cursor?: string | undefined; limit: number; proposal?: string | undefined },
) {
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await deps.db
    .select()
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.orgId, ctx.orgId),
        eq(researchRuns.userId, actor.userId),
        query.proposal ? eq(researchRuns.proposalId, query.proposal) : undefined,
        after
          ? or(
              lt(researchRuns.createdAt, after[0]),
              and(eq(researchRuns.createdAt, after[0]), lt(researchRuns.id, after[1])),
            )
          : undefined,
      ),
    )
    .orderBy(desc(researchRuns.createdAt), desc(researchRuns.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const counts = new Map(
    page.length === 0
      ? []
      : (
          await deps.db
            .select({ runId: researchResults.runId, n: sql<number>`count(*)::int` })
            .from(researchResults)
            .where(
              inArray(
                researchResults.runId,
                page.map((r) => r.id),
              ),
            )
            .groupBy(researchResults.runId)
        ).map((c) => [c.runId, c.n] as const),
  );
  const projects = await projectRefs(deps, ctx.orgId, page);
  const last = page.at(-1);
  return {
    items: page.map((r) =>
      summaryOf(r, projects.get(r.projectId ?? '') ?? null, counts.get(r.id) ?? 0),
    ),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

export async function presentRun(deps: AppDeps, orgId: string, row: RunRow): Promise<ResearchRun> {
  const [sources, results, projects] = await Promise.all([
    sourceRows(deps.db, orgId, row.sourceIds),
    resultsOf(deps.db, row.id),
    projectRefs(deps, orgId, [row]),
  ]);
  const plan = sourcePlan(sources, row.terms, deps.ai);
  const names = new Map(sources.map((s) => [s.id, s] as const));
  return {
    ...summaryOf(row, projects.get(row.projectId ?? '') ?? null, results.length),
    since: row.since,
    sources: plan.map((p) => ({
      id: p.row.id,
      name: p.row.name,
      kind: p.row.kind,
      searched: p.searched,
    })),
    links: plan.flatMap((p) =>
      p.link ? [{ sourceId: p.row.id, name: p.row.name, url: p.link }] : [],
    ),
    brief: row.brief,
    searches: row.searches,
    results: results.map((r) => {
      const source = names.get(r.sourceId);
      return {
        id: r.id,
        ref: r.ref,
        source: {
          id: r.sourceId,
          name: source?.name ?? 'Unknown',
          kind: source?.kind ?? 'pubmed',
        },
        kind: r.kind,
        externalId: r.externalId,
        title: r.title,
        detail: r.detail,
        year: r.year,
        url: r.url,
        snippet: r.snippet,
        keptAt: r.keptAt?.toISOString() ?? null,
      };
    }),
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
  };
}

export async function getRun(deps: AppDeps, ctx: RequestContext, actor: Actor, id: string) {
  return presentRun(deps, ctx.orgId, await ownRun(deps, ctx, actor, id));
}

/** A queued run stops at once; a running one at its next search. What was found is kept. */
export async function stopRun(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
): Promise<ResearchRunSummary> {
  await ownRun(deps, ctx, actor, id, true);
  const row = await change(deps.db, ctx, async (tx, log) => {
    const [current] = await tx
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, id))
      .for('update');
    const run = current as RunRow;
    if (run.status !== 'queued' && run.status !== 'running') return run;
    const [updated] = await tx
      .update(researchRuns)
      .set(
        run.status === 'queued'
          ? { status: 'stopped', stopAsked: true, finishedAt: deps.now() }
          : { stopAsked: true },
      )
      .where(eq(researchRuns.id, id))
      .returning();
    log.audit({
      action: 'research.stopped',
      recordType: 'research_run',
      recordId: id,
      before: { status: run.status },
    });
    return updated as RunRow;
  });
  const projects = await projectRefs(deps, ctx.orgId, [row]);
  const count = (await resultsOf(deps.db, id)).length;
  return summaryOf(row, projects.get(row.projectId ?? '') ?? null, count);
}

/** The note a kept result starts with: who, when, and the lines the source gave. */
export const keptNote = (r: Pick<ResultRow, 'detail' | 'year' | 'snippet' | 'externalId'>) =>
  cut(
    [[r.detail, r.year].filter(Boolean).join(', '), r.externalId, r.snippet]
      .filter(Boolean)
      .join('. '),
    1000,
  );

export async function keepResults(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  body: {
    projectId: string;
    stepKey?: string | undefined;
    results: { resultId: string; note?: string | undefined }[];
  },
): Promise<SourceView[]> {
  const run = await ownRun(deps, ctx, actor, id, true);
  const ids = [...new Set(body.results.map((r) => r.resultId))];
  const rows = (await resultsOf(deps.db, run.id)).filter((r) => ids.includes(r.id));
  if (rows.length !== ids.length) {
    throw validationFailed('Some of these results are not from this run.', 'results');
  }
  const kept = rows.filter((r) => r.keptAt);
  if (kept.length > 0) {
    throw validationFailed(
      `Already kept: ${kept.map((r) => r.ref).join(', ')}. A result is kept once.`,
      'results',
    );
  }
  const notes = new Map(body.results.map((r) => [r.resultId, r.note] as const));
  return keepSources(
    deps,
    ctx,
    actor,
    body.projectId,
    body.stepKey,
    rows.map((r) => ({
      title: cut(r.title, 300),
      url: r.url,
      note: notes.get(r.id) ?? keptNote(r),
      researchResultId: r.id,
    })),
    async (tx) => {
      await tx
        .update(researchResults)
        .set({ keptAt: deps.now() })
        .where(and(inArray(researchResults.id, ids), sql`${researchResults.keptAt} is null`));
    },
  );
}
