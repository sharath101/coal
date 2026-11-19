import {
  listNotifications as listNotificationsEndpoint,
  markAllNotificationsRead,
  markNotificationRead,
} from '@coal/shared';
import { change } from '../../core/db/change';
import { implement } from '../../core/http/endpoint';
import { notFound } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import * as service from './service';

export const notificationsRoutes = [
  implement(listNotificationsEndpoint, ({ deps, ctx, actor, query }) =>
    service.listNotifications(deps.db, ctx.orgId, actor.userId, {
      cursor: query.cursor,
      limit: query.limit,
      unreadOnly: query['filter[unread]'],
    }),
  ),

  implement(markNotificationRead, ({ deps, ctx, actor, params }) =>
    change(deps.db, ctx, async (tx) => {
      const row = await service.findNotification(tx, ctx.orgId, params.id);
      if (!row) throw notFound('notification');
      assertCanAccess('notifications.markRead', actor, row);
      return service.markRead(tx, ctx.orgId, row.id);
    }),
  ),

  implement(markAllNotificationsRead, ({ deps, ctx, actor }) =>
    change(deps.db, ctx, async (tx) => ({
      marked: await service.markAllRead(tx, ctx.orgId, actor.userId),
    })),
  ),
];
