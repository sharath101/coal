import { listProductLines as listProductLinesEndpoint } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { listProductLines } from './service';

export const rndRoutes = [
  implement(listProductLinesEndpoint, async ({ deps, ctx }) => ({
    items: await listProductLines(deps.db, ctx.orgId),
  })),
];
