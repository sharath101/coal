import { listRoles } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { departmentsAndRoles } from './service';

export const orgRoutes = [
  implement(listRoles, ({ deps, ctx }) => departmentsAndRoles(deps.db, ctx.orgId)),
];
