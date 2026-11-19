import type { Tone } from '@coal/shared';
import { listNotifications } from '../notifications/service';
import { count, row, rowLimit, type WidgetBody, type WidgetContext } from './context';

const TONES: Record<string, Tone> = {
  escalation: 'danger',
  reminder: 'warning',
  alert: 'warning',
  work_message: 'neutral',
};

/** W10: my latest work messages and notifications. */
export async function messages(w: WidgetContext): Promise<WidgetBody> {
  const unreadOnly = w.view === 'expanded' && w.tab === 'unread';
  const page = await listNotifications(w.deps.db, w.ctx.orgId, w.actor.userId, {
    limit: rowLimit(w),
    unreadOnly,
  });
  return {
    counts: [count('unread', page.unread, page.unread > 0 ? 'warning' : 'neutral')],
    tabs:
      w.view === 'expanded'
        ? [
            { key: 'all', count: unreadOnly ? 0 : page.items.length },
            { key: 'unread', count: page.unread },
          ]
        : [],
    tab: w.view === 'expanded' ? (unreadOnly ? 'unread' : 'all') : null,
    total: page.items.length,
    rows: page.items.map((n) =>
      row({
        id: n.id,
        title: n.title,
        subtitle: n.body,
        link: n.link,
        tone: n.readAt ? 'neutral' : (TONES[n.kind] ?? 'neutral'),
        badges: n.readAt ? [] : [{ label: 'New', tone: 'neutral' }],
        cells: { when: n.sentAt, kind: n.kind },
        actions: n.readAt ? ['open'] : ['mark_read', 'open'],
        ref: { notificationId: n.id, ...(n.projectId && { projectId: n.projectId }) },
      }),
    ),
  };
}
