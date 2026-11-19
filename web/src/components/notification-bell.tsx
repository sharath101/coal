'use client';

import { markAllNotificationsRead, markNotificationRead, type Notification } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { queryKeys, useNotifications } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** The bell in the top bar: how many notifications are unread, and the latest ten. */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useNotifications();
  const unread = list.data?.unread ?? 0;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
      queryClient.invalidateQueries({ queryKey: queryKeys.widget('messages') }),
    ]);
  const markRead = useMutation({
    mutationFn: (id: string) => api(markNotificationRead, { params: { id } }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api(markAllNotificationsRead),
    onSuccess: refresh,
  });

  const openOne = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title={t('title')}
          aria-label={t('bell', { count: unread })}
        >
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white"
            >
              {unread > 99 ? t('many') : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="grid max-h-[80vh] grid-rows-[auto_1fr_auto]">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <Button
            size="xs"
            variant="ghost"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t('markAll')}
          </Button>
        </div>
        <div className="overflow-y-auto">
          <ProblemMessage error={list.error ?? markRead.error ?? markAll.error} />
          {list.isSuccess && list.data.items.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('none')}</p>
          )}
          <ul className="divide-y">
            {(list.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent',
                    !n.readAt && 'bg-accent/40',
                  )}
                  onClick={() => openOne(n)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-blue-600',
                    )}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn(!n.readAt && 'font-semibold')}>
                      {!n.readAt && <span className="sr-only">{t('unread')} </span>}
                      {n.title}
                    </span>
                    <span className="line-clamp-2 text-muted-foreground">{n.body}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(n.sentAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t px-3 py-2 text-sm">
          <PopoverClose asChild>
            <Link href="/dashboard?w=messages" className="underline-offset-2 hover:underline">
              {t('seeAll')}
            </Link>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
