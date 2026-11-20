import type {
  DocumentDetail,
  DocumentSummary,
  RequestView,
  RouteDefinition,
  RunState,
  SignatureView,
  VersionDetail,
  VersionSummary,
} from '@coal/shared';
import { stepActions } from '@coal/shared';
import type { Executor } from '../../core/db/client';
import type { Actor } from '../../core/http/context';
import { notFound } from '../../core/http/errors';
import { findFiles } from '../files/service';
import { canAccess } from '../permissions';
import { canSeeDrafts } from '../permissions/rules';
import { findTemplatesById, findTypesById, type TypeRow } from '../templates/service';
import { findUsersByIds } from '../users/service';
import { accessOf, documentResource, visibleVersions } from './access';
import { memberIdsOf, type ProjectFacts } from './facts';
import {
  requestsOfVersions,
  signaturesOf,
  versionsOf,
  type DocumentRow,
  type RequestRow,
  type SignatureRow,
  type VersionRow,
} from './store';
import { roleNameOf } from './signing';

/** Who is looking, at which project. The department module builds it; this module never reaches into it. */
export interface Viewer {
  actor: Actor;
  facts: ProjectFacts;
  route: RouteDefinition;
  state: RunState;
  /** May the person do the document action on a step whose doers are these roles? */
  mayWork(doers: string[]): boolean;
}

const stepOpen = (v: Viewer, key: string) => stepActions(v.route, v.state, key).submit;
const doersOf = (v: Viewer, key: string) => v.route.steps.find((s) => s.key === key)?.doers ?? [];

const person = (people: Map<string, string>, id: string) => ({
  id,
  name: people.get(id) ?? 'Unknown',
});

const DOC_STATUS = ['draft', 'in_review', 'returned', 'approved'] as const;

interface Loaded {
  versions: Map<string, VersionRow[]>;
  requests: Map<string, RequestRow[]>;
  types: Map<string, TypeRow>;
  people: Map<string, string>;
}

async function loadAround(ex: Executor, v: Viewer, docs: DocumentRow[]): Promise<Loaded> {
  const versions = await versionsOf(
    ex,
    docs.map((d) => d.id),
  );
  const allVersions = [...versions.values()].flat();
  const requests = await requestsOfVersions(
    ex,
    allVersions.map((x) => x.id),
  );
  const types = await findTypesById(
    ex,
    v.facts.orgId,
    docs.map((d) => d.documentTypeId),
  );
  const users = await findUsersByIds(ex, v.facts.orgId, [
    ...docs.map((d) => d.createdBy),
    ...allVersions.map((x) => x.createdBy),
    ...[...requests.values()]
      .flat()
      .flatMap((r) => [r.assigneeId, r.returnedBy].filter((i): i is string => !!i)),
  ]);
  return { versions, requests, types, people: new Map(users.map((u) => [u.id, u.name])) };
}

const requestsOfDocument = (l: Loaded, doc: DocumentRow) =>
  (l.versions.get(doc.id) ?? []).flatMap((x) => l.requests.get(x.id) ?? []);

/** The summaries of the documents a person may see. Those they may only know the outcome of are marked restricted. */
export async function presentDocuments(
  ex: Executor,
  v: Viewer,
  docs: DocumentRow[],
): Promise<DocumentSummary[]> {
  const l = await loadAround(ex, v, docs);
  const out: DocumentSummary[] = [];
  for (const doc of docs) {
    const summary = summarise(v, l, doc);
    if (summary) out.push(summary);
  }
  return out;
}

function summarise(v: Viewer, l: Loaded, doc: DocumentRow): DocumentSummary | null {
  const type = l.types.get(doc.documentTypeId) as TypeRow;
  const step = v.route.steps.find((s) => s.key === doc.stepKey);
  const access = accessOf(
    v.actor,
    documentResource(v.facts, step, type, requestsOfDocument(l, doc)),
  );
  if (access.level === 'none') return null;
  const all = l.versions.get(doc.id) ?? [];
  const latest = all[0] as VersionRow;
  const seen = visibleVersions(access, all);
  // A document that has only drafts doesn't exist yet for anyone but the people who work on it.
  if (seen.length === 0) return null;
  const shown = seen[0] as VersionRow;
  const full = access.level === 'full';
  const open = stepOpen(v, doc.stepKey) && v.mayWork(doersOf(v, doc.stepKey));
  const editable = full && open && type.kind !== 'record' && latest.status !== 'in_review';
  const approved = all.find((x) => x.status === 'approved');
  return {
    id: doc.id,
    projectId: v.facts.projectId,
    projectCode: v.facts.code,
    number: doc.number,
    title: doc.title,
    type: { code: type.code, name: type.name, kind: type.kind, sensitivity: type.sensitivity },
    stepKey: doc.stepKey,
    status: (DOC_STATUS as readonly string[]).includes(shown.status)
      ? (shown.status as DocumentSummary['status'])
      : 'approved',
    latestVersionNo: shown.versionNo,
    approvedRev: approved?.revLabel ?? null,
    restricted: !full,
    createdBy: person(l.people, doc.createdBy),
    updatedAt: doc.updatedAt.toISOString(),
    can: { edit: editable, submit: editable && latest.status === 'draft' },
  };
}

const presentVersion = (l: Loaded, x: VersionRow): VersionSummary => ({
  id: x.id,
  versionNo: x.versionNo,
  revLabel: x.revLabel,
  status: x.status,
  iteration: x.iteration,
  createdBy: person(l.people, x.createdBy),
  createdAt: x.createdAt.toISOString(),
  note: x.note,
  carried: !!x.carriedFromVersionId,
  viaAi: x.viaAi,
  hasPdf: !!x.pdfFileId,
  contentSha256: x.contentSha256,
  pdfSha256: x.pdfSha256,
});

const presentSignature = (s: SignatureRow): SignatureView => ({
  id: s.id,
  meaning: s.meaning,
  signedAt: s.signedAt.toISOString(),
  by: { id: s.userId, name: s.printedName, role: s.roleName },
  decision: s.decision,
  reason: s.reason,
});

/** A document with one version in full. Null content and no versions when the person may only know its outcome. */
export async function presentDocument(
  ex: Executor,
  v: Viewer,
  doc: DocumentRow,
  versionNo?: number,
): Promise<DocumentDetail> {
  const l = await loadAround(ex, v, [doc]);
  const summary = summarise(v, l, doc);
  if (!summary) throw notFound('document');
  const type = l.types.get(doc.documentTypeId) as TypeRow;
  const step = v.route.steps.find((s) => s.key === doc.stepKey);
  const access = accessOf(
    v.actor,
    documentResource(v.facts, step, type, requestsOfDocument(l, doc)),
  );
  const template = doc.templateId
    ? ((await findTemplatesById(ex, v.facts.orgId, [doc.templateId])).get(doc.templateId) ?? null)
    : null;

  const visible = summary.restricted ? [] : visibleVersions(access, l.versions.get(doc.id) ?? []);
  const wanted = visible.find((x) => x.versionNo === versionNo) ?? visible[0] ?? null;
  const current = wanted ? await presentVersionDetail(ex, v, l, doc, wanted) : null;

  const plan = doc.signaturePlan;
  const approvers =
    plan.approvedBy.length > 0 ? plan.approvedBy : step?.signer ? [step.signer] : [];
  return {
    ...summary,
    template: template ? { id: template.id, name: template.name, version: template.version } : null,
    spec: summary.restricted ? null : (template?.spec ?? null),
    signatureRows: plan.rows
      .map((meaning) => ({
        meaning,
        roles:
          meaning === 'prepared'
            ? (step?.doers ?? []).map((key) => ({ key, name: roleNameOf(key) }))
            : (meaning === 'reviewed' ? plan.reviewedBy : approvers).map((key) => ({
                key,
                name: roleNameOf(key),
              })),
      }))
      // A row nobody signs (an Approved row on a step with no signer) isn't shown.
      .filter((r) => r.meaning === 'prepared' || r.roles.length > 0),
    versions: visible.map((x) => presentVersion(l, x)),
    current,
  };
}

async function presentVersionDetail(
  ex: Executor,
  v: Viewer,
  l: Loaded,
  doc: DocumentRow,
  x: VersionRow,
): Promise<VersionDetail> {
  const sigs = (await signaturesOf(ex, 'document_version', [x.id])).get(x.id) ?? [];
  const requests = l.requests.get(x.id) ?? [];
  const preparer = sigs.find((s) => s.meaning === 'prepared')?.userId;
  const [file] = x.fileId ? await findFiles(ex, v.facts.orgId, [x.fileId]) : [];
  return {
    ...presentVersion(l, x),
    content: x.content,
    aiSections: x.aiSections,
    file: file ? { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size } : null,
    // A step sign-off record is signed by signing off the step, never on its own.
    requests: requests.map((r) =>
      presentRequest(
        v,
        l,
        r,
        preparer,
        (l.types.get(doc.documentTypeId) as TypeRow).kind === 'record',
      ),
    ),
    signatures: sigs.map(presentSignature),
  };
}

/** May this person sign the request now? A person never signs Approved on a version they prepared. */
export function canSignRequest(v: Viewer, r: RequestRow, preparerId: string | undefined): boolean {
  if (r.status !== 'pending') return false;
  if (r.meaning === 'approved' && preparerId === v.actor.userId) return false;
  return canAccess('signatures.sign', v.actor, {
    productLineId: v.facts.productLineId,
    memberIds: memberIdsOf(v.facts),
    roleKeys: r.roleKeys,
    assigneeId: r.assigneeId,
  }).allowed;
}

function presentRequest(
  v: Viewer,
  l: Loaded,
  r: RequestRow,
  preparerId: string | undefined,
  isRecord: boolean,
): RequestView {
  const can = !isRecord && canSignRequest(v, r, preparerId);
  return {
    id: r.id,
    meaning: r.meaning,
    role: { key: r.roleKeys[0] as string, name: r.roleKeys.map(roleNameOf).join(' or ') },
    assignee: r.assigneeId ? person(l.people, r.assigneeId) : null,
    status: r.status,
    order: r.orderIndex,
    returnComment: r.returnComment,
    returnedBy: r.returnedBy ? person(l.people, r.returnedBy) : null,
    completedAt: r.completedAt?.toISOString() ?? null,
    can: { sign: can, return: can },
  };
}

/**
 * Which of a project's documents the person may read, and whether they see drafts. The activity
 * feed uses it so events about a document are shown only to people who may see the document
 * (a team member never learns that a budget annex exists, nor reads a Board paper's return comment).
 */
export async function documentVisibility(
  ex: Executor,
  v: Viewer,
  docs: DocumentRow[],
): Promise<{ readable: Set<string>; drafts: boolean }> {
  const summaries = await presentDocuments(ex, v, docs);
  return {
    readable: new Set(summaries.filter((s) => !s.restricted).map((s) => s.id)),
    drafts: canSeeDrafts(v.actor, {
      productLineId: v.facts.productLineId,
      memberIds: memberIdsOf(v.facts),
    }),
  };
}
