import type { AttachmentView, SourceView } from '@coal/shared';
import { and, desc, eq } from 'drizzle-orm';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { validationFailed } from '../../core/http/errors';
import { listProjectDocuments } from '../documents/service';
import { assertUsableEvidence, findFiles, present, type FileRow } from '../files/service';
import { assertMay, canSeeProjectContent, loadEnv } from '../rnd/env';
import type { Env } from '../rnd/actions';
import { findProjectByRun } from '../rnd/projects';
import { findTask } from '../tasks/service';
import { findUsersByIds } from '../users/service';
import { attachments, sources } from './tables';

export interface TargetInput {
  stepKey?: string | undefined;
  documentId?: string | undefined;
  taskId?: string | undefined;
}

interface Target {
  stepKey: string | null;
  documentId: string | null;
  taskId: string | null;
}

/**
 * The people who do or sign a step, and the project team, may add to it (docs/roles-and-access.md).
 * Something for the whole project may be added by the team and by the VP, the R&D Head and the
 * Lead of the line, who work on every project of theirs.
 */
const rolesFor = (env: Env, stepKey: string | null): string[] => {
  const step = env.loaded.route.steps.find((s) => s.key === stepKey);
  return step
    ? [...step.doers, ...(step.signer ? [step.signer] : []), 'team']
    : ['team', 'vp', 'rd_head', 'rd_lead'];
};

/**
 * Which step, document or task a new attachment or source belongs to, checked against the
 * project. A source may name none of them: it belongs to the whole project.
 */
async function resolveTarget(
  deps: AppDeps,
  tx: Executor,
  ctx: RequestContext,
  actor: Actor,
  env: Env,
  input: TargetInput,
): Promise<Target> {
  if (input.stepKey) {
    if (!env.loaded.route.steps.some((s) => s.key === input.stepKey)) {
      throw validationFailed('There is no such step.', 'stepKey');
    }
    return { stepKey: input.stepKey, documentId: null, taskId: null };
  }
  if (input.documentId) {
    const docs = await listProjectDocuments(tx, ctx, actor, env.project.id, undefined);
    const doc = docs.find((d) => d.id === input.documentId && !d.restricted);
    if (!doc) throw validationFailed('There is no such document.', 'documentId');
    return { stepKey: doc.stepKey, documentId: doc.id, taskId: null };
  }
  if (!input.taskId) return { stepKey: null, documentId: null, taskId: null };
  const task = await findTask(tx, ctx.orgId, input.taskId);
  if (!task || task.runId !== env.loaded.run.id) {
    throw validationFailed('There is no such task.', 'taskId');
  }
  return { stepKey: task.stepKey, documentId: null, taskId: task.id };
}

const targetOf = (row: {
  stepKey: string | null;
  documentId: string | null;
  taskId: string | null;
}) => ({
  stepKey: row.stepKey,
  documentId: row.documentId,
  taskId: row.taskId,
});

/** Who may see a step's attachments and sources: people in the project's scope; the Board only at its checkpoints. */
function seesStep(env: Env, stepKey: string | null): boolean {
  if (!canSeeProjectContent(env)) return false;
  if (env.actor.roleKey !== 'board') return true;
  return !!env.loaded.route.steps.find((s) => s.key === stepKey)?.checkpoint;
}

/** Whether the person sees what a row is attached to: the document's content, or the step. */
function visible(
  env: Env,
  readable: Set<string>,
  row: { stepKey: string | null; documentId: string | null },
): boolean {
  return row.documentId ? readable.has(row.documentId) : seesStep(env, row.stepKey);
}

async function readableDocuments(
  ex: Executor,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
): Promise<Set<string>> {
  const docs = await listProjectDocuments(ex, ctx, actor, projectId, undefined);
  return new Set(docs.filter((d) => !d.restricted).map((d) => d.id));
}

async function peopleOf(ex: Executor, orgId: string, ids: string[]) {
  const users = await findUsersByIds(ex, orgId, ids);
  return new Map(users.map((u) => [u.id, u.name]));
}

const personOf = (names: Map<string, string>, id: string) => ({
  id,
  name: names.get(id) ?? 'Unknown',
});

type AttachmentRow = typeof attachments.$inferSelect;
type SourceRow = typeof sources.$inferSelect;

async function presentAttachments(
  ex: Executor,
  orgId: string,
  rows: AttachmentRow[],
): Promise<AttachmentView[]> {
  const files = new Map(
    (
      await findFiles(
        ex,
        orgId,
        rows.map((r) => r.fileId),
      )
    ).map((f) => [f.id, f]),
  );
  const names = await peopleOf(
    ex,
    orgId,
    rows.map((r) => r.addedBy),
  );
  return rows.flatMap((r) => {
    const file = files.get(r.fileId);
    return file
      ? [
          {
            id: r.id,
            file: present(file),
            caption: r.caption,
            target: targetOf(r),
            addedBy: personOf(names, r.addedBy),
            addedAt: r.createdAt.toISOString(),
          },
        ]
      : [];
  });
}

async function presentSources(
  ex: Executor,
  orgId: string,
  rows: SourceRow[],
): Promise<SourceView[]> {
  const files = new Map(
    (
      await findFiles(
        ex,
        orgId,
        rows.flatMap((r) => (r.fileId ? [r.fileId] : [])),
      )
    ).map((f) => [f.id, f]),
  );
  const names = await peopleOf(
    ex,
    orgId,
    rows.map((r) => r.addedBy),
  );
  return rows.map((r) => {
    const file = r.fileId ? files.get(r.fileId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      url: r.url,
      file: file ? present(file) : null,
      note: r.note,
      target: targetOf(r),
      researchResultId: r.researchResultId,
      addedBy: personOf(names, r.addedBy),
      addedAt: r.createdAt.toISOString(),
    };
  });
}

export async function createAttachment(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  input: TargetInput & { fileId: string; caption: string },
): Promise<AttachmentView> {
  return change(deps.db, ctx, async (tx, log) => {
    const env = await loadEnv(tx, ctx.orgId, actor, projectId);
    const target = await resolveTarget(deps, tx, ctx, actor, env, input);
    assertMay(env, 'attachments.write', rolesFor(env, target.stepKey));
    await assertUsableEvidence(tx, ctx.orgId, actor, input.fileId, 'fileId');
    const [row] = await tx
      .insert(attachments)
      .values({
        orgId: ctx.orgId,
        runId: env.loaded.run.id,
        ...target,
        fileId: input.fileId,
        caption: input.caption,
        addedBy: actor.userId,
      })
      .returning();
    log.audit({
      action: 'attachment.added',
      recordType: 'attachment',
      recordId: (row as AttachmentRow).id,
      after: { ...target, fileId: input.fileId, caption: input.caption },
    });
    log.event({
      type: 'attachment.added',
      projectId,
      stepKey: target.stepKey,
      payload: { attachmentId: (row as AttachmentRow).id, ...target },
    });
    return (await presentAttachments(tx, ctx.orgId, [row as AttachmentRow]))[0] as AttachmentView;
  });
}

const targetFilter = (
  table: typeof attachments | typeof sources,
  query: { step?: string | undefined; document?: string | undefined; task?: string | undefined },
) => [
  query.step ? eq(table.stepKey, query.step) : undefined,
  query.document ? eq(table.documentId, query.document) : undefined,
  query.task ? eq(table.taskId, query.task) : undefined,
];

export async function listAttachments(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  query: { step?: string | undefined; document?: string | undefined; task?: string | undefined },
): Promise<AttachmentView[]> {
  const env = await loadEnv(deps.db, ctx.orgId, actor, projectId);
  const readable = await readableDocuments(deps.db, ctx, actor, projectId);
  const rows = await deps.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.runId, env.loaded.run.id), ...targetFilter(attachments, query)))
    .orderBy(desc(attachments.createdAt), desc(attachments.id));
  return presentAttachments(
    deps.db,
    ctx.orgId,
    rows.filter((r) => visible(env, readable, r)),
  );
}

export async function createSource(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  input: TargetInput & {
    kind: 'link' | 'file' | 'citation';
    title: string;
    url?: string | undefined;
    fileId?: string | undefined;
    note: string;
  },
): Promise<SourceView> {
  return change(deps.db, ctx, async (tx, log) => {
    const env = await loadEnv(tx, ctx.orgId, actor, projectId);
    const target = await resolveTarget(deps, tx, ctx, actor, env, input);
    assertMay(env, 'sources.write', rolesFor(env, target.stepKey));
    if (input.kind === 'file' && input.fileId) {
      await assertUsableEvidence(tx, ctx.orgId, actor, input.fileId, 'fileId');
    }
    const [row] = await tx
      .insert(sources)
      .values({
        orgId: ctx.orgId,
        runId: env.loaded.run.id,
        ...target,
        kind: input.kind,
        title: input.title,
        url: input.kind === 'link' ? (input.url ?? null) : null,
        fileId: input.kind === 'file' ? (input.fileId ?? null) : null,
        note: input.note,
        addedBy: actor.userId,
      })
      .returning();
    const added = row as SourceRow;
    log.audit({
      action: 'source.added',
      recordType: 'source',
      recordId: added.id,
      after: { ...target, kind: added.kind, title: added.title, url: added.url },
    });
    log.event({
      type: 'source.added',
      projectId,
      stepKey: target.stepKey,
      payload: { sourceId: added.id, ...target },
    });
    return (await presentSources(tx, ctx.orgId, [added]))[0] as SourceView;
  });
}

/** A result of a research run, kept as a link on a project step. */
export interface KeptResult {
  title: string;
  url: string;
  note: string;
  researchResultId: string;
}

/**
 * Keeps research results as sources on a step, in one transaction, under the same rule as adding
 * a source by hand: the people who do or sign the step, and the project team. `then` runs in the
 * same transaction, so the run marks its results kept only if the sources were added.
 */
export async function keepSources(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  /** Left out: the whole project. */
  stepKey: string | undefined,
  items: KeptResult[],
  then: (tx: Executor) => Promise<void>,
): Promise<SourceView[]> {
  return change(deps.db, ctx, async (tx, log) => {
    const env = await loadEnv(tx, ctx.orgId, actor, projectId);
    const target = await resolveTarget(deps, tx, ctx, actor, env, { stepKey });
    assertMay(env, 'sources.write', rolesFor(env, target.stepKey));
    const rows: SourceRow[] = await tx
      .insert(sources)
      .values(
        items.map((item) => ({
          orgId: ctx.orgId,
          runId: env.loaded.run.id,
          ...target,
          kind: 'link' as const,
          title: item.title,
          url: item.url,
          note: item.note,
          researchResultId: item.researchResultId,
          addedBy: actor.userId,
        })),
      )
      .returning();
    for (const added of rows) {
      log.audit({
        action: 'source.added',
        recordType: 'source',
        recordId: added.id,
        after: {
          ...target,
          kind: added.kind,
          title: added.title,
          url: added.url,
          researchResultId: added.researchResultId,
        },
      });
      log.event({
        type: 'source.added',
        projectId,
        stepKey: target.stepKey,
        payload: { sourceId: added.id, ...target },
      });
    }
    await then(tx);
    return presentSources(tx, ctx.orgId, rows);
  });
}

export async function listSources(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  query: { step?: string | undefined; document?: string | undefined; task?: string | undefined },
): Promise<SourceView[]> {
  const env = await loadEnv(deps.db, ctx.orgId, actor, projectId);
  const readable = await readableDocuments(deps.db, ctx, actor, projectId);
  const rows = await deps.db
    .select()
    .from(sources)
    .where(and(eq(sources.runId, env.loaded.run.id), ...targetFilter(sources, query)))
    .orderBy(desc(sources.createdAt), desc(sources.id));
  return presentSources(
    deps.db,
    ctx.orgId,
    rows.filter((r) => visible(env, readable, r)),
  );
}

/** Whether a record the person may see holds this file: an attachment, or a source that is a file. */
export async function fileViaAttachments(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  file: FileRow,
): Promise<boolean> {
  const [held, cited] = await Promise.all([
    deps.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.fileId, file.id))),
    deps.db
      .select()
      .from(sources)
      .where(and(eq(sources.orgId, ctx.orgId), eq(sources.fileId, file.id))),
  ]);
  const rows = [...held, ...cited];
  for (const row of rows) {
    const project = await findProjectByRun(deps.db, ctx.orgId, row.runId);
    if (!project) continue;
    try {
      const env = await loadEnv(deps.db, ctx.orgId, actor, project.id);
      const readable = await readableDocuments(deps.db, ctx, actor, project.id);
      if (visible(env, readable, row)) return true;
    } catch {
      // A project the person can't open grants nothing.
    }
  }
  return false;
}
