import { completeUpload, createUpload, getFileLink } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import * as service from './service';

export const filesRoutes = [
  implement(createUpload, ({ deps, ctx, actor, body }) =>
    service.createUpload(deps, ctx, actor, body),
  ),
  implement(completeUpload, ({ deps, ctx, actor, params }) =>
    service.completeUpload(deps, ctx, actor, params.id),
  ),
  implement(getFileLink, ({ deps, ctx, actor, params }) =>
    service.fileLink(deps, ctx, actor, params.id),
  ),
];
