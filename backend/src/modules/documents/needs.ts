import { missingRequired } from '@coal/shared';
import type { Executor } from '../../core/db/client';
import { AppError } from '../../core/http/errors';
import {
  blankFormHashes,
  findTemplatesById,
  findTypesById,
  listDocumentTypes,
} from '../templates/service';
import { documentsOfRun, versionsOf } from './store';

/**
 * What a step still lacks before it can be submitted: each of its documents (a template type that
 * belongs to the step) made or uploaded, and filled in: a document filled in COAL has its required
 * parts, and a Word form is not still the blank form, so an empty template is never what goes to
 * the signer. A document needn't be signed (S7). Need-to-know
 * documents (the budget annex) are not asked for: the whole team sees this list, and the annex's
 * existence is not for them (docs/roles-and-access.md#content-is-need-to-know).
 */
export async function documentNeedsOfSteps(
  ex: Executor,
  orgId: string,
  runId: string,
  stepKeys: string[],
): Promise<Map<string, string[]>> {
  const needs = new Map<string, string[]>();
  const types = (await listDocumentTypes(ex, orgId)).filter(
    (t) => t.kind === 'template' && t.sensitivity === 'normal',
  );
  const asked = new Map(
    stepKeys.map((key) => [key, types.filter((t) => t.stepKeys.includes(key))] as const),
  );
  if ([...asked.values()].every((list) => list.length === 0)) return needs;

  const docs = (await documentsOfRun(ex, orgId, runId)).filter((d) => asked.has(d.stepKey));
  const typeOf = await findTypesById(
    ex,
    orgId,
    docs.map((d) => d.documentTypeId),
  );
  const versions = await versionsOf(
    ex,
    docs.map((d) => d.id),
  );
  const templates = await findTemplatesById(
    ex,
    orgId,
    docs.flatMap((d) => (d.templateId ? [d.templateId] : [])),
  );

  const blank = await blankFormHashes(
    ex,
    orgId,
    [...asked.values()].flatMap((list) => list.map((t) => t.code)),
  );

  /** What is empty in a document that is still a template: nothing for an upload. */
  const emptyIn = (doc: (typeof docs)[number]): string[] => {
    const content = versions.get(doc.id)?.[0]?.content;
    const template = doc.templateId ? templates.get(doc.templateId) : undefined;
    return content && template?.spec ? missingRequired(template.spec, content) : [];
  };
  /** A Word file that is still the blank form: nobody has filled it in. */
  const stillBlank = (doc: (typeof docs)[number]): boolean => {
    const latest = versions.get(doc.id)?.[0];
    const code = typeOf.get(doc.documentTypeId)?.code;
    return !!latest?.fileId && !!code && !!blank.get(code)?.has(latest.contentSha256);
  };

  for (const [key, required] of asked) {
    const lacking: string[] = [];
    for (const type of required) {
      const made = docs.filter(
        (d) => d.stepKey === key && typeOf.get(d.documentTypeId)?.code === type.code,
      );
      if (made.length === 0) {
        lacking.push(`${type.name}: not made or uploaded yet.`);
      } else if (made.every((d) => emptyIn(d).length > 0 || stillBlank(d))) {
        const first = made[0] as (typeof made)[number];
        lacking.push(
          stillBlank(first)
            ? `${first.number} (${type.name}): still the blank form. Ask the assistant to fill it in, or fill it in Word and upload it as a new version.`
            : `${first.number} (${type.name}): fill in ${emptyIn(first).join(', ')}.`,
        );
      }
    }
    if (lacking.length > 0) needs.set(key, lacking);
  }
  return needs;
}

/** Refuses to submit a step whose documents are missing or still blank templates. */
export async function assertStepDocuments(
  ex: Executor,
  orgId: string,
  runId: string,
  stepKey: string,
): Promise<void> {
  const lacking = (await documentNeedsOfSteps(ex, orgId, runId, [stepKey])).get(stepKey) ?? [];
  if (lacking.length === 0) return;
  throw new AppError(
    409,
    'DOCUMENTS_NEEDED',
    `Step ${stepKey} can't be submitted yet. ${lacking.join(' ')}`,
    { errors: lacking.map((message) => ({ path: 'documents', message })) },
  );
}
