import type { StepDefinition } from '@coal/shared';
import {
  canSeeDrafts,
  documentAccess,
  type DocumentAccess,
  type DocumentResource,
} from '../permissions/rules';
import type { Actor } from '../../core/http/context';
import type { TypeRow } from '../templates/service';
import { memberIdsOf, type ProjectFacts } from './facts';
import type { RequestRow, VersionRow } from './store';

/** What decides who may read a document: its project, its step, its type and who was asked to sign it. */
export function documentResource(
  facts: ProjectFacts,
  step: StepDefinition | undefined,
  type: Pick<TypeRow, 'sensitivity'>,
  requests: RequestRow[],
): DocumentResource {
  const asked = requests.filter((r) => r.status !== 'cancelled');
  return {
    productLineId: facts.productLineId,
    memberIds: memberIdsOf(facts),
    sensitivity: type.sensitivity,
    boardPaper: step?.signer === 'board',
    checkpoint: !!step?.checkpoint,
    // The author is named; only the people asked to review or approve are asked by role.
    addressedRoles: [
      ...new Set(asked.filter((r) => r.meaning !== 'prepared').flatMap((r) => r.roleKeys)),
    ],
    addressedUserIds: [...new Set(asked.flatMap((r) => (r.assigneeId ? [r.assigneeId] : [])))],
  };
}

export interface Access {
  level: DocumentAccess;
  /** Whether the person sees drafts and returned versions, or only submitted and approved ones. */
  drafts: boolean;
}

export function accessOf(actor: Actor, resource: DocumentResource): Access {
  return {
    level: documentAccess(actor, resource),
    drafts: canSeeDrafts(actor, resource),
  };
}

const SUBMITTED: VersionRow['status'][] = ['in_review', 'approved', 'superseded'];

/** The versions a person may see: drafts and returned ones only for the people who work on the step. */
export const visibleVersions = <T extends { status: VersionRow['status'] }>(
  access: Access,
  versions: T[],
): T[] => (access.drafts ? versions : versions.filter((v) => SUBMITTED.includes(v.status)));
