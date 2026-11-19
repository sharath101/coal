import {
  compareVersions as compareVersionsEndpoint,
  createDocument as createDocumentEndpoint,
  getDocument as getDocumentEndpoint,
  getVersionLinks,
  listProjectDocuments as listProjectDocumentsEndpoint,
  listSignatureRequests,
  returnRequest as returnRequestEndpoint,
  saveVersion as saveVersionEndpoint,
  signRequest as signRequestEndpoint,
  submitVersion as submitVersionEndpoint,
} from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import * as service from './service';

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
