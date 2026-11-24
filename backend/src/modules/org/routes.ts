import { listRoles } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { openPositions } from '../users/service';
import { listDepartments, listRoles as listRoleRows } from './service';

export const orgRoutes = [
  implement(listRoles, async ({ deps, ctx }) => {
    const [departments, roles, positions] = await Promise.all([
      listDepartments(deps.db, ctx.orgId),
      listRoleRows(deps.db, ctx.orgId),
      openPositions(deps.db, ctx.orgId),
    ]);
    // The admin is for the demo only, so it isn't a role anyone signs up as.
    return { departments, roles: roles.filter((r) => r.key !== 'admin'), positions };
  }),
];
