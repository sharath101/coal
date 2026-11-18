import { getMe, getUser, listUsers as listUsersEndpoint, updateMe } from '@coal/shared';
import { change } from '../../core/db/change';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound } from '../../core/http/errors';
import { findUser, listUsers, present, presentMe, updateUser, userSnapshot } from './service';

export const usersRoutes = [
  implement(getMe, async ({ deps, ctx, actor }) => {
    const row = await findUser(deps.db, ctx.orgId, actor.userId);
    if (!row) throw notFound('person');
    return presentMe(deps.db, ctx.orgId, row);
  }),

  implement(updateMe, ({ deps, ctx, actor, body, ifMatch }) =>
    change(deps.db, ctx, async (tx, log) => {
      const current = await findUser(tx, ctx.orgId, actor.userId, { forUpdate: true });
      if (!current) throw notFound('person');
      if (ifMatch && ifMatch !== current.updatedAt.toISOString()) {
        throw new AppError(
          412,
          'VERSION_CONFLICT',
          'Your profile changed since you opened it. Reload and try again.',
        );
      }
      const updated = await updateUser(tx, ctx.orgId, current, body);
      log.audit({
        action: 'user.updated',
        recordType: 'user',
        recordId: updated.id,
        before: userSnapshot(current),
        after: userSnapshot(updated),
      });
      return presentMe(tx, ctx.orgId, updated);
    }),
  ),

  implement(listUsersEndpoint, ({ deps, ctx, query }) => listUsers(deps.db, ctx.orgId, query)),

  implement(getUser, async ({ deps, ctx, params }) => {
    const row = await findUser(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('person');
    const [user] = await present(deps.db, ctx.orgId, [row]);
    return user!;
  }),
];
