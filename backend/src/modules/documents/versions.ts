import type { DocumentContent } from '@coal/shared';
import { eq, max } from 'drizzle-orm';
import type { Tx } from '../../core/db/client';
import type { VersionRow } from './store';
import { documentVersions, documents } from './tables';

export interface NewVersion {
  documentId: string;
  runStepId: string;
  iteration: number;
  content: DocumentContent | null;
  contentSha256: string;
  fileId?: string | null;
  pdf: { fileId: string; sha256: string } | null;
  searchText: string;
  note: string;
  createdBy: string;
  viaAi?: boolean;
  /** The reply of the assistant that wrote it, whose log says the model, the instructions and the sources. */
  aiRequestId?: string | null;
  aiSections?: string[];
  carriedFromVersionId?: string | null;
  status?: VersionRow['status'];
}

/** Saves the next version of a document. Versions are numbered 1, 2, 3 and never overwritten. */
export async function insertVersion(tx: Tx, orgId: string, input: NewVersion): Promise<VersionRow> {
  const [latest] = await tx
    .select({ no: max(documentVersions.versionNo) })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, input.documentId));
  const [row] = await tx
    .insert(documentVersions)
    .values({
      orgId,
      documentId: input.documentId,
      runStepId: input.runStepId,
      iteration: input.iteration,
      versionNo: (latest?.no ?? 0) + 1,
      status: input.status ?? 'draft',
      content: input.content,
      contentSha256: input.contentSha256,
      fileId: input.fileId ?? null,
      pdfFileId: input.pdf?.fileId ?? null,
      pdfSha256: input.pdf?.sha256 ?? null,
      searchText: input.searchText,
      note: input.note,
      createdBy: input.createdBy,
      viaAi: input.viaAi ?? false,
      aiRequestId: input.aiRequestId ?? null,
      aiSections: input.aiSections ?? [],
      carriedFromVersionId: input.carriedFromVersionId ?? null,
    })
    .returning();
  await tx
    .update(documents)
    .set({ updatedAt: new Date() })
    .where(eq(documents.id, input.documentId));
  return row as VersionRow;
}
