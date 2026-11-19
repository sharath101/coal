import {
  commentDeviation as commentDeviationEndpoint,
  listDeviations as listDeviationsEndpoint,
  recordDeviation as recordDeviationEndpoint,
  reviewDeviation as reviewDeviationEndpoint,
} from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import * as service from './service';

export const deviationsRoutes = [
  implement(listDeviationsEndpoint, ({ deps, ctx, actor, query }) =>
    service.listDeviations(deps.db, ctx.orgId, actor, query),
  ),

  implement(recordDeviationEndpoint, ({ deps, ctx, actor, body }) =>
    service.recordDeviation(deps, ctx, actor, body),
  ),

  implement(reviewDeviationEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.reviewDeviation(deps, ctx, actor, params.id, body),
  ),

  implement(commentDeviationEndpoint, ({ deps, ctx, actor, params, body }) =>
    service.commentOnDeviation(deps, ctx, actor, params.id, body.body),
  ),
];
