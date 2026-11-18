import { checkUpload, type StoredFile } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { change } from '../../core/db/change';
import { newId } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import { isChangedSinceInspected } from './storage';
import { files } from './tables';

type FileRow = typeof files.$inferSelect;

const present = (row: FileRow): StoredFile => ({
  id: row.id,
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  sha256: row.sha256,
  status: row.status,
  scanStatus: row.scanStatus,
  origin: row.origin,
  createdAt: row.createdAt.toISOString(),
});

const snapshot = (row: FileRow) => ({
  name: row.name,
  mimeType: row.mimeType,
  size: row.size,
  sha256: row.sha256,
  status: row.status,
  origin: row.origin,
});

const UPLOAD_REFUSALS = {
  type: 'COAL does not accept this kind of file.',
  size: 'The file is too large.',
  empty: 'The file is empty.',
} as const;

/** Where the client uploads to. Only COAL writes the final key (`storage_key`). */
const stagingKey = (row: FileRow) => `staging/${row.storageKey}`;

async function loadFile(deps: AppDeps, ctx: RequestContext, id: string): Promise<FileRow> {
  const [row] = await deps.db
    .select()
    .from(files)
    .where(and(eq(files.orgId, ctx.orgId), eq(files.id, id)));
  if (!row) throw notFound('file');
  return row;
}

export async function createUpload(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  input: { name: string; size: number; origin: 'internal' | 'outside' },
) {
  const check = checkUpload(input);
  if (!check.ok) throw new AppError(400, 'UPLOAD_NOT_ALLOWED', UPLOAD_REFUSALS[check.reason]);

  const id = newId();
  const row = await change(deps.db, ctx, async (tx, log) => {
    const [inserted] = await tx
      .insert(files)
      .values({
        id,
        orgId: ctx.orgId,
        storageKey: `${ctx.orgId}/${id}`,
        name: input.name,
        mimeType: check.contentType,
        size: input.size,
        origin: input.origin,
        uploadedBy: actor.userId,
      })
      .returning();
    log.audit({
      action: 'file.upload_started',
      recordType: 'file',
      recordId: id,
      after: snapshot(inserted!),
    });
    return inserted!;
  });

  const seconds = deps.config.storage.linkSeconds;
  const upload = await deps.storage.uploadUrl(stagingKey(row), {
    contentType: row.mimeType,
    size: row.size,
    seconds,
  });
  return {
    file: present(row),
    upload: {
      url: upload.url,
      method: 'PUT' as const,
      headers: upload.headers,
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    },
  };
}

/**
 * Checks the staged upload against what was declared, records its hash, and moves exactly those
 * bytes to the final key, so the recorded size and hash always match what is served. Safe to repeat.
 */
export async function completeUpload(deps: AppDeps, ctx: RequestContext, actor: Actor, id: string) {
  const row = await loadFile(deps, ctx, id);
  assertCanAccess('files.upload', actor, { uploadedBy: row.uploadedBy });
  if (row.status === 'uploaded') return present(row);

  const staged = await deps.storage.inspect(stagingKey(row), row.size);
  if (staged === 'missing') {
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The file has not been uploaded yet.');
  }
  if (staged === 'too_large' || staged.size !== row.size) {
    throw new AppError(
      409,
      'UPLOAD_INCOMPLETE',
      'The uploaded file is not the size that was declared.',
    );
  }
  try {
    await deps.storage.promote(stagingKey(row), row.storageKey, staged.etag, row.mimeType);
  } catch (error) {
    const latest = await loadFile(deps, ctx, id);
    if (latest.status === 'uploaded') return present(latest);
    if (isChangedSinceInspected(error)) {
      throw new AppError(
        409,
        'UPLOAD_INCOMPLETE',
        'The file changed while it was being checked. Upload it again.',
      );
    }
    throw error;
  }
  const sha256 = staged.sha256;

  return change(deps.db, ctx, async (tx, log) => {
    const [updated] = await tx
      .update(files)
      .set({ status: 'uploaded', sha256 })
      .where(and(eq(files.orgId, ctx.orgId), eq(files.id, id)))
      .returning();
    log.audit({
      action: 'file.uploaded',
      recordType: 'file',
      recordId: id,
      before: snapshot(row),
      after: snapshot(updated!),
    });
    return present(updated!);
  });
}

export async function fileLink(deps: AppDeps, ctx: RequestContext, actor: Actor, id: string) {
  const row = await loadFile(deps, ctx, id);
  assertCanAccess('files.read', actor, { uploadedBy: row.uploadedBy });
  if (row.status !== 'uploaded') {
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The file has not been uploaded yet.');
  }
  if (row.scanStatus === 'infected') {
    throw new AppError(403, 'NOT_ALLOWED', 'This file failed the virus scan and cannot be opened.');
  }
  const seconds = deps.config.storage.linkSeconds;
  return {
    url: await deps.storage.downloadUrl(row.storageKey, row.name, seconds),
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}
