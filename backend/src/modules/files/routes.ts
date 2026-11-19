import { completeUpload, createUpload, getFileLink } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { fileViaAttachments } from '../attachments/service';
import { fileViaDocuments } from '../documents/service';
import { templateFileAccess } from '../templates/service';
import * as service from './service';

export const filesRoutes = [
  implement(createUpload, ({ deps, ctx, actor, body }) =>
    service.createUpload(deps, ctx, actor, body),
  ),
  implement(completeUpload, ({ deps, ctx, actor, params }) =>
    service.completeUpload(deps, ctx, actor, params.id),
  ),
  // A file opens for its uploader, and for anyone who may see a record that holds it.
  implement(getFileLink, ({ deps, ctx, actor, params }) =>
    service.fileLink(
      deps,
      ctx,
      actor,
      params.id,
      async (row) =>
        (await fileViaDocuments(deps, ctx, actor, row)) ||
        (await fileViaAttachments(deps, ctx, actor, row)) ||
        (await templateFileAccess(deps.db, ctx.orgId, actor, row.id)),
    ),
  ),
];
