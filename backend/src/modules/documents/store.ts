import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../core/db/client';
import { documents, documentVersions, signatureRequests, signatures } from './tables';

export type DocumentRow = typeof documents.$inferSelect;
export type VersionRow = typeof documentVersions.$inferSelect;
export type RequestRow = typeof signatureRequests.$inferSelect;
export type SignatureRow = typeof signatures.$inferSelect;

export async function findDocument(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<DocumentRow | null> {
  const query = ex
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function documentsOfRun(
  ex: Executor,
  orgId: string,
  runId: string,
  stepKey?: string,
): Promise<DocumentRow[]> {
  return ex
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.runId, runId),
        stepKey ? eq(documents.stepKey, stepKey) : undefined,
      ),
    )
    .orderBy(asc(documents.stepKey), asc(documents.createdAt), asc(documents.id));
}

/** Every version of each document, newest first. */
export async function versionsOf(
  ex: Executor,
  documentIds: string[],
): Promise<Map<string, VersionRow[]>> {
  const byDocument = new Map<string, VersionRow[]>();
  if (documentIds.length === 0) return byDocument;
  const rows = await ex
    .select()
    .from(documentVersions)
    .where(inArray(documentVersions.documentId, documentIds))
    .orderBy(desc(documentVersions.versionNo));
  for (const row of rows) {
    byDocument.set(row.documentId, [...(byDocument.get(row.documentId) ?? []), row]);
  }
  return byDocument;
}

export async function latestVersionOf(
  ex: Executor,
  documentId: string,
): Promise<VersionRow | null> {
  const [row] = await ex
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  return row ?? null;
}

export async function findVersion(
  ex: Executor,
  documentId: string,
  versionNo: number,
  options: { forUpdate?: boolean } = {},
): Promise<VersionRow | null> {
  const query = ex
    .select()
    .from(documentVersions)
    .where(
      and(eq(documentVersions.documentId, documentId), eq(documentVersions.versionNo, versionNo)),
    );
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function findVersionById(ex: Executor, id: string): Promise<VersionRow | null> {
  const [row] = await ex.select().from(documentVersions).where(eq(documentVersions.id, id));
  return row ?? null;
}

export async function requestsOfVersions(
  ex: Executor,
  versionIds: string[],
): Promise<Map<string, RequestRow[]>> {
  const byVersion = new Map<string, RequestRow[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await ex
    .select()
    .from(signatureRequests)
    .where(inArray(signatureRequests.versionId, versionIds))
    .orderBy(
      asc(signatureRequests.orderIndex),
      asc(signatureRequests.createdAt),
      asc(signatureRequests.id),
    );
  for (const row of rows) {
    byVersion.set(row.versionId, [...(byVersion.get(row.versionId) ?? []), row]);
  }
  return byVersion;
}

export async function signaturesOf(
  ex: Executor,
  subjectType: SignatureRow['subjectType'],
  subjectIds: string[],
): Promise<Map<string, SignatureRow[]>> {
  const bySubject = new Map<string, SignatureRow[]>();
  if (subjectIds.length === 0) return bySubject;
  const rows = await ex
    .select()
    .from(signatures)
    .where(and(eq(signatures.subjectType, subjectType), inArray(signatures.subjectId, subjectIds)))
    .orderBy(asc(signatures.signedAt), asc(signatures.id));
  for (const row of rows) {
    bySubject.set(row.subjectId, [...(bySubject.get(row.subjectId) ?? []), row]);
  }
  return bySubject;
}

export async function findRequest(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<RequestRow | null> {
  const query = ex
    .select()
    .from(signatureRequests)
    .where(and(eq(signatureRequests.orgId, orgId), eq(signatureRequests.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** How many documents of a type a run already has, to number the next one. */
export async function countDocumentsOfType(
  ex: Executor,
  orgId: string,
  runId: string,
  typeId: string,
): Promise<number> {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.runId, runId),
        eq(documents.documentTypeId, typeId),
      ),
    );
  return row?.n ?? 0;
}

/** Waiting signature requests that a person may be asked for, newest first. */
export async function pendingRequests(ex: Executor, orgId: string): Promise<RequestRow[]> {
  return ex
    .select()
    .from(signatureRequests)
    .where(and(eq(signatureRequests.orgId, orgId), eq(signatureRequests.status, 'pending')))
    .orderBy(desc(signatureRequests.requestedAt));
}

/** The versions that hold a file, as the uploaded file or as the PDF. */
export async function versionsHoldingFile(
  ex: Executor,
  orgId: string,
  fileId: string,
): Promise<VersionRow[]> {
  return ex
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.orgId, orgId),
        sql`${documentVersions.fileId} = ${fileId} or ${documentVersions.pdfFileId} = ${fileId}`,
      ),
    );
}

export async function documentsById(
  ex: Executor,
  orgId: string,
  ids: string[],
): Promise<Map<string, DocumentRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function versionsById(ex: Executor, ids: string[]): Promise<Map<string, VersionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(documentVersions)
    .where(inArray(documentVersions.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}
