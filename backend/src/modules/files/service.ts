import { checkUpload, type StoredFile } from '@coal/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import { newId } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import { isChangedSinceInspected } from './storage';
import { files } from './tables';

export type FileRow = typeof files.$inferSelect;

export const present = (row: FileRow): StoredFile => ({
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

export async function findFiles(ex: Executor, orgId: string, ids: string[]): Promise<FileRow[]> {
  if (ids.length === 0) return [];
  return ex
    .select()
    .from(files)
    .where(and(eq(files.orgId, orgId), inArray(files.id, [...new Set(ids)])));
}

/** The newest file made from another, such as the sample PDF of a built template's Word file. */
export async function findDerivedFile(
  ex: Executor,
  orgId: string,
  fromId: string,
): Promise<FileRow | null> {
  const [row] = await ex
    .select()
    .from(files)
    .where(and(eq(files.orgId, orgId), eq(files.derivedFrom, fromId)))
    .orderBy(desc(files.createdAt))
    .limit(1);
  return row ?? null;
}

export interface GeneratedFile {
  name: string;
  bytes: Buffer;
  contentType: string;
  /** The person it is made for. Null when no person is behind it. */
  userId: string | null;
  /** The file it was made from, such as the sample a template was built from. */
  derivedFrom?: string;
}

/**
 * Stores a file COAL made itself (a PDF) and records it as uploaded, with its hash. COAL made it,
 * so it needs no virus scan. The bytes are written before the row, so a row never points at nothing.
 */
export async function storeGeneratedFile(
  deps: AppDeps,
  tx: Executor,
  orgId: string,
  input: GeneratedFile,
): Promise<FileRow> {
  const id = newId();
  const storageKey = `${orgId}/${id}`;
  const written = await deps.storage.write(storageKey, input.bytes, input.contentType);
  const [row] = await tx
    .insert(files)
    .values({
      id,
      orgId,
      storageKey,
      name: input.name,
      mimeType: input.contentType,
      size: written.size,
      sha256: written.sha256,
      status: 'uploaded',
      scanStatus: 'clean',
      origin: 'internal',
      uploadedBy: input.userId,
      derivedFrom: input.derivedFrom ?? null,
    })
    .returning();
  return row as FileRow;
}

/** Reads a finished upload's bytes, for COAL's own use. */
export async function readFileBytes(deps: AppDeps, row: FileRow): Promise<Buffer> {
  return deps.storage.read(row.storageKey);
}

/**
 * Scans a finished upload, and records the result. Where there is no scanner it does nothing,
 * and the file stays "not scanned". A scanner that can't be reached leaves the file as it was; the
 * worker's sweep, or a repeated `complete`, tries again.
 */
export async function scanStored(
  deps: AppDeps,
  ctx: RequestContext,
  row: FileRow,
): Promise<FileRow> {
  if (!deps.scanner || row.status !== 'uploaded' || row.scanStatus !== 'not_scanned') return row;
  let verdict;
  try {
    verdict = await deps.scanner.scan(await deps.storage.stream(row.storageKey));
  } catch {
    return row;
  }
  const scanStatus = verdict.clean ? 'clean' : 'infected';
  return change(deps.db, ctx, async (tx, log) => {
    const [updated] = await tx
      .update(files)
      .set({ scanStatus })
      .where(
        and(eq(files.orgId, ctx.orgId), eq(files.id, row.id), eq(files.scanStatus, 'not_scanned')),
      )
      .returning();
    if (!updated) return row;
    log.audit({
      action: 'file.scanned',
      recordType: 'file',
      recordId: row.id,
      before: { scanStatus: row.scanStatus },
      after: { scanStatus, ...(verdict.clean ? {} : { threat: verdict.threat }) },
    });
    return updated;
  });
}

/** The worker's sweep: scans uploads that are still "not scanned". Safe to run twice. */
export async function scanPending(deps: AppDeps, ctx: RequestContext, limit = 25): Promise<number> {
  if (!deps.scanner) return 0;
  const rows = await deps.db
    .select()
    .from(files)
    .where(
      and(
        eq(files.orgId, ctx.orgId),
        eq(files.status, 'uploaded'),
        eq(files.scanStatus, 'not_scanned'),
      ),
    )
    .limit(limit);
  let scanned = 0;
  for (const row of rows) {
    const after = await scanStored(deps, ctx, row);
    if (after.scanStatus !== 'not_scanned') scanned += 1;
  }
  return scanned;
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
  if (row.status === 'uploaded') return present(await scanStored(deps, ctx, row));

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

  const uploaded = await change(deps.db, ctx, async (tx, log) => {
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
    return updated!;
  });
  return present(await scanStored(deps, ctx, uploaded));
}

/**
 * A short-lived link to a file. The uploader may always open it; anyone else needs a record they
 * may see to hold it, which `viaRecord` decides (docs/roles-and-access.md).
 */
export async function fileLink(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  viaRecord: (row: FileRow) => Promise<boolean>,
) {
  const row = await loadFile(deps, ctx, id);
  const asUploader = actor.userId === row.uploadedBy;
  assertCanAccess('files.read', actor, {
    uploadedBy: row.uploadedBy,
    viaRecord: asUploader ? false : await viaRecord(row),
  });
  return linkTo(deps, row);
}

/** Makes the link, once the person is known to be allowed: the file must be finished and not infected. */
export async function linkTo(deps: AppDeps, row: FileRow) {
  if (row.status !== 'uploaded') {
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The file has not been uploaded yet.');
  }
  if (row.scanStatus === 'infected') {
    throw new AppError(403, 'NOT_ALLOWED', 'This file failed the virus scan and cannot be opened.');
  }
  if (deps.scanner && row.scanStatus === 'not_scanned') {
    throw new AppError(
      409,
      'FILE_NOT_SCANNED',
      'This file has not been checked for viruses yet. Try again in a moment.',
    );
  }
  const seconds = deps.config.storage.linkSeconds;
  return {
    url: await deps.storage.downloadUrl(row.storageKey, row.name, seconds),
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}

/**
 * A file attached to a record (evidence, an attachment, an uploaded document, a template) must be
 * a finished upload by the person using it, and one that did not fail the virus scan.
 */
export async function assertUsableEvidence(
  ex: Executor,
  orgId: string,
  actor: Actor,
  id: string,
  path: string,
): Promise<FileRow> {
  const [row] = await ex
    .select()
    .from(files)
    .where(and(eq(files.orgId, orgId), eq(files.id, id)));
  if (!row || row.status !== 'uploaded') {
    throw validationFailed('The file has not been uploaded.', path);
  }
  assertCanAccess('files.read', actor, { uploadedBy: row.uploadedBy });
  if (row.scanStatus === 'infected') {
    throw validationFailed('This file failed the virus scan.', path);
  }
  return row;
}
