import {
  createAttachment as createAttachmentEndpoint,
  createSource as createSourceEndpoint,
  listAttachments as listAttachmentsEndpoint,
  listSources as listSourcesEndpoint,
} from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import * as service from './service';

export const attachmentsRoutes = [
  implement(createAttachmentEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.createAttachment(deps, ctx, actor, params.id, body),
  ),
  implement(listAttachmentsEndpoint, async ({ deps, ctx, actor, params, query }) => ({
    items: await service.listAttachments(deps, ctx, actor, params.id, query),
  })),
  implement(createSourceEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.createSource(deps, ctx, actor, params.id, body),
  ),
  implement(listSourcesEndpoint, async ({ deps, ctx, actor, params, query }) => ({
    items: await service.listSources(deps, ctx, actor, params.id, query),
  })),
];
