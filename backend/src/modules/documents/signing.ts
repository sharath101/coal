import { revisionLabel, type SignatureMeaning, type SignaturePlan } from '@coal/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { ChangeLog } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import { ROLES } from '../org/catalogue';
import type { DocumentRow, RequestRow, VersionRow } from './store';
import { documentVersions, signatureRequests, signatures } from './tables';

const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name]));
export const roleNameOf = (key: string) => ROLE_NAMES.get(key) ?? key;

/** Who is signing: the person, as they were at the moment (docs/documents-and-signing.md). */
export interface Signer {
  userId: string;
  name: string;
  roleKey: string;
}

export interface RowPlan {
  meaning: SignatureMeaning;
  roleKeys: string[];
  /** When set, one request per person (every Board member signs). */
  assigneeIds: string[];
}

/** The rows a version will be signed in, and who signs each (docs/documents-and-signing.md#signature-rows). */
export function planRows(
  plan: SignaturePlan,
  step: { signer: string | null; boardSigners: string[] },
  preparer: Signer,
): RowPlan[] {
  const rows: RowPlan[] = [
    { meaning: 'prepared', roleKeys: [preparer.roleKey], assigneeIds: [preparer.userId] },
  ];
  if (plan.rows.includes('reviewed') && plan.reviewedBy.length > 0) {
    rows.push({ meaning: 'reviewed', roleKeys: plan.reviewedBy, assigneeIds: [] });
  }
  if (plan.rows.includes('approved')) {
    // Approved by the step's signer, unless the template names others. A step with no signer (2a, 24a)
    // has no Approved row: the author's signature is the last.
    const approvers =
      plan.approvedBy.length > 0 ? plan.approvedBy : step.signer ? [step.signer] : [];
    if (approvers.length > 0) {
      const everyone =
        step.boardSigners.length > 0 && approvers.length === 1 && approvers[0] === step.signer;
      rows.push({
        meaning: 'approved',
        roleKeys: approvers,
        assigneeIds: everyone ? step.boardSigners : [],
      });
    }
  }
  return rows;
}

/** Creates the requests for every row: the first is open, the rest wait for the one before. */
export async function openRows(
  tx: Tx,
  orgId: string,
  versionId: string,
  rows: RowPlan[],
): Promise<RequestRow[]> {
  const values = rows.flatMap((row, index) =>
    (row.assigneeIds.length > 0 ? row.assigneeIds : [null]).map((assigneeId) => ({
      orgId,
      versionId,
      meaning: row.meaning,
      roleKeys: row.roleKeys,
      assigneeId,
      orderIndex: index,
      status: index === 0 ? ('pending' as const) : ('waiting' as const),
    })),
  );
  return tx.insert(signatureRequests).values(values).returning();
}

export interface Subject {
  type: 'document_version' | 'decision';
  id: string;
  contentSha256: string;
  pdfSha256: string | null;
}

/** The one place a signature is written. Insert-only: a trigger refuses any change. */
export async function insertSignature(
  tx: Tx,
  orgId: string,
  input: {
    request: RequestRow | null;
    subject: Subject;
    signer: Signer;
    meaning: SignatureMeaning | 'decision';
    decision?: string | null;
    reason?: string | null;
  },
) {
  const [row] = await tx
    .insert(signatures)
    .values({
      orgId,
      requestId: input.request?.id ?? null,
      subjectType: input.subject.type,
      subjectId: input.subject.id,
      contentSha256: input.subject.contentSha256,
      pdfSha256: input.subject.pdfSha256,
      userId: input.signer.userId,
      printedName: input.signer.name,
      roleKey: input.signer.roleKey,
      roleName: roleNameOf(input.signer.roleKey),
      meaning: input.meaning,
      decision: input.decision ?? null,
      reason: input.reason ?? null,
    })
    .returning();
  return row;
}

/**
 * Signs a request: records the signature, closes the request, and opens the next row once every
 * request of this one is signed. Returns whether the version has now been fully signed.
 */
export async function signRow(
  tx: Tx,
  orgId: string,
  version: VersionRow,
  request: RequestRow,
  signer: Signer,
): Promise<{ signedRow: boolean; complete: boolean }> {
  await insertSignature(tx, orgId, {
    request,
    subject: {
      type: 'document_version',
      id: version.id,
      contentSha256: version.contentSha256,
      pdfSha256: version.pdfSha256,
    },
    signer,
    meaning: request.meaning,
  });
  await tx
    .update(signatureRequests)
    .set({
      status: 'signed',
      completedAt: new Date(),
      assigneeId: request.assigneeId ?? signer.userId,
    })
    .where(eq(signatureRequests.id, request.id));

  const all = await tx
    .select()
    .from(signatureRequests)
    .where(
      and(eq(signatureRequests.versionId, version.id), ne(signatureRequests.status, 'cancelled')),
    );
  const sameRow = all.filter((r) => r.orderIndex === request.orderIndex);
  if (!sameRow.every((r) => r.status === 'signed')) return { signedRow: false, complete: false };

  const next = all.filter((r) => r.orderIndex > request.orderIndex);
  if (next.length === 0) return { signedRow: true, complete: true };
  const nextIndex = Math.min(...next.map((r) => r.orderIndex));
  await tx
    .update(signatureRequests)
    .set({ status: 'pending', requestedAt: new Date() })
    .where(
      and(
        eq(signatureRequests.versionId, version.id),
        eq(signatureRequests.orderIndex, nextIndex),
        eq(signatureRequests.status, 'waiting'),
      ),
    );
  return { signedRow: true, complete: false };
}

/** Everything signed: the version is approved and gets its revision letter; earlier approvals are superseded. */
export async function approveVersion(
  tx: Tx,
  log: ChangeLog,
  doc: DocumentRow,
  version: VersionRow,
  stepKey: string,
  projectId: string,
): Promise<VersionRow> {
  const earlier = await tx
    .select({
      id: documentVersions.id,
      rev: documentVersions.revLabel,
      status: documentVersions.status,
    })
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, doc.id), ne(documentVersions.id, version.id)));
  const revLabel = revisionLabel(earlier.filter((v) => v.rev).length);
  const superseded = earlier.filter((v) => v.status === 'approved').map((v) => v.id);
  if (superseded.length > 0) {
    await tx
      .update(documentVersions)
      .set({ status: 'superseded' })
      .where(inArray(documentVersions.id, superseded));
  }
  const [row] = await tx
    .update(documentVersions)
    .set({ status: 'approved', revLabel })
    .where(eq(documentVersions.id, version.id))
    .returning();
  log.audit({
    action: 'document.approved',
    recordType: 'document_version',
    recordId: version.id,
    before: { status: version.status },
    after: { status: 'approved', revLabel, number: doc.number, versionNo: version.versionNo },
  });
  log.event({
    type: 'document.approved',
    projectId,
    stepKey,
    payload: { documentId: doc.id, number: doc.number, versionNo: version.versionNo, revLabel },
  });
  return row as VersionRow;
}

/** Cancels every request still waiting or open on a version. */
export async function cancelOpenRequests(tx: Tx, versionId: string): Promise<void> {
  await tx
    .update(signatureRequests)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(
        eq(signatureRequests.versionId, versionId),
        inArray(signatureRequests.status, ['waiting', 'pending']),
      ),
    );
}

/** Takes a submitted version back to its authors: the request (if any) records the comment, the rest are cancelled. */
export async function returnVersion(
  tx: Tx,
  log: ChangeLog,
  doc: DocumentRow,
  version: VersionRow,
  returned: { request: RequestRow | null; by: Signer | null; comment: string },
  stepKey: string,
  projectId: string,
): Promise<void> {
  if (returned.request) {
    await tx
      .update(signatureRequests)
      .set({
        status: 'returned',
        completedAt: new Date(),
        returnedBy: returned.by?.userId ?? null,
        returnComment: returned.comment,
      })
      .where(eq(signatureRequests.id, returned.request.id));
  }
  await cancelOpenRequests(tx, version.id);
  await tx
    .update(documentVersions)
    .set({ status: 'returned' })
    .where(eq(documentVersions.id, version.id));
  log.audit({
    action: 'document.returned',
    recordType: 'document_version',
    recordId: version.id,
    before: { status: version.status },
    after: { status: 'returned', number: doc.number, versionNo: version.versionNo },
    reason: returned.comment,
  });
  log.event({
    type: 'document.returned',
    projectId,
    stepKey,
    payload: {
      documentId: doc.id,
      number: doc.number,
      versionNo: version.versionNo,
      comment: returned.comment,
    },
  });
}
