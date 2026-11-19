import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, PageQuery, Timestamp, pageOf } from './common';

export const Notification = z.object({
  id: Id,
  kind: z.enum(['work_message', 'reminder', 'escalation', 'alert']),
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  /** A path on the website. */
  link: z.string().nullable(),
  projectId: Id.nullable(),
  stepKey: z.string().nullable(),
  sentAt: Timestamp,
  readAt: Timestamp.nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationsQuery = PageQuery.extend({
  'filter[unread]': z.stringbool().default(false),
});

export const listNotifications = defineEndpoint({
  id: 'notifications.list',
  method: 'GET',
  path: '/notifications',
  summary: 'My notifications and work messages, newest first',
  auth: 'session',
  permission: 'notifications.read',
  aiTier: 'read',
  query: NotificationsQuery,
  response: pageOf(Notification).extend({ unread: z.number().int() }),
});

export const markNotificationRead = defineEndpoint({
  id: 'notifications.markRead',
  method: 'POST',
  path: '/notifications/{id}/read',
  summary: 'Mark one of my notifications as read',
  auth: 'session',
  permission: 'notifications.markRead',
  aiTier: 'auto',
  params: IdParams,
  response: Notification,
});

export const markAllNotificationsRead = defineEndpoint({
  id: 'notifications.markAllRead',
  method: 'POST',
  path: '/notifications/read-all',
  summary: 'Mark all my notifications as read',
  auth: 'session',
  permission: 'notifications.markAllRead',
  aiTier: 'auto',
  response: z.object({ marked: z.number().int() }),
});

/** What the live stream (`GET /api/v1/stream`) sends: a hint, never content. */
export const StreamHint = z.discriminatedUnion('type', [
  /** These widgets have changed: fetch them again. */
  z.object({ type: z.literal('widgets'), keys: z.array(z.string()) }),
  /** A new notification: fetch the list again. */
  z.object({ type: z.literal('notification') }),
]);
export type StreamHint = z.infer<typeof StreamHint>;
