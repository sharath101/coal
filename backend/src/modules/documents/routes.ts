import {
  compareVersions as compareVersionsEndpoint,
  createDocument as createDocumentEndpoint,
  fillForm as fillFormEndpoint,
  getDocument as getDocumentEndpoint,
  getVersionLinks,
  listProjectDocuments as listProjectDocumentsEndpoint,
  listSignatureRequests,
  readForm as readFormEndpoint,
  returnRequest as returnRequestEndpoint,
  saveVersion as saveVersionEndpoint,
  signRequest as signRequestEndpoint,
  submitVersion as submitVersionEndpoint,
  type ActionDetail,
} from '@coal/shared';
import { implement, noEffects } from '../../core/http/endpoint';
import * as service from './service';

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export const documentsRoutes = [
  implement(listProjectDocumentsEndpoint, async ({ deps, ctx, actor, params, query }) => ({
    items: await service.listProjectDocuments(deps.db, ctx, actor, params.id, query.step),
  })),

  implement(createDocumentEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.createDocument(deps, ctx, actor, params.id, body),
  ),

  implement(getDocumentEndpoint, ({ deps, ctx, actor, params, query }) =>
    service.getDocument(deps, ctx, actor, params.id, query.version),
  ),

  implement(saveVersionEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.saveVersion(deps, ctx, actor, params.id, body),
  ),

  implement(readFormEndpoint, ({ deps, ctx, actor, params }) =>
    service.readForm(deps, ctx, actor, params.id),
  ),

  implement(
    fillFormEndpoint,
    ({ deps, ctx, actor, params, body }) => service.fillForm(deps, ctx, actor, params.id, body),
    {
      // The card shows exactly what goes into each part of the form, and what was there before.
      describe: async (doc, { params, body }, deps) => {
        const parts = await service.partsOfVersion(
          deps,
          deps.config.orgId,
          params.id,
          body.versionNo,
        );
        const detail: ActionDetail = {
          kind: 'fill',
          documentId: doc.id,
          projectId: doc.projectId,
          number: doc.number,
          title: doc.title,
          versionNo: body.versionNo,
          fills: body.fills.map((f) => ({
            part: f.part,
            where: parts.get(f.part)?.where ?? '',
            was: cut(parts.get(f.part)?.text ?? '', 300),
            mode: f.mode,
            text: f.text,
          })),
        };
        const count = body.fills.length;
        return {
          summary: `Fill in ${count} part${count === 1 ? '' : 's'} of ${doc.number} · ${doc.title}, saved as a new draft version for you to read`,
          effects: noEffects(),
          notified: [],
          detail,
        };
      },
    },
  ),

  implement(getVersionLinks, ({ deps, ctx, actor, params }) =>
    service.versionLinks(deps, ctx, actor, params.id, params.n),
  ),

  implement(compareVersionsEndpoint, ({ deps, ctx, actor, params, query }) =>
    service.compareVersions(deps, ctx, actor, params.id, query.from, query.to),
  ),

  implement(submitVersionEndpoint, ({ deps, ctx, actor, params, query }) =>
    service.submitVersion(deps, ctx, actor, params.id, params.n, query.preview),
  ),

  implement(signRequestEndpoint, ({ deps, ctx, actor, params, query }) =>
    service.signRequest(deps, ctx, actor, params.id, query.preview),
  ),

  implement(returnRequestEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.returnRequest(deps, ctx, actor, params.id, body.comment),
  ),

  implement(listSignatureRequests, async ({ deps, ctx, actor }) => ({
    items: await service.listWaiting(deps, ctx, actor),
  })),
];
