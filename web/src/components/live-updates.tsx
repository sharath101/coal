'use client';

import { API_BASE_PATH, StreamHint } from '@coal/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/queries';

/**
 * Widgets whose change also moves task due dates and what a project page shows. A change to a
 * planned date moves the due dates of tasks, but the API's hint for it names only these.
 */
const SCHEDULE_WIDGETS = [
  'my-projects',
  'pipeline',
  'delays-risks',
  'coming-up',
  'upcoming-checkpoints',
];
const DUE_DATE_WIDGETS = ['my-tasks', 'team-workload'];

/**
 * One live stream for the signed-in app (docs/architecture.md#events-and-live-updates). It sends
 * hints, never content: on a hint, the matching queries are fetched again through the normal,
 * permission-checked API. The browser reconnects by itself; after a gap everything is refreshed,
 * because hints sent meanwhile are lost.
 */
export function LiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = (queryKey: readonly unknown[]) =>
      void queryClient.invalidateQueries({ queryKey });
    const refreshAll = () => {
      refresh(queryKeys.widgets);
      refresh(queryKeys.notifications);
      refresh(queryKeys.tasks);
      refresh(queryKeys.signatureRequests);
    };

    const source = new EventSource(`${API_BASE_PATH}/stream`);
    let dropped = false;
    source.onopen = () => {
      if (dropped) refreshAll();
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
    };
    source.onmessage = (event: MessageEvent<string>) => {
      let hint: StreamHint;
      try {
        hint = StreamHint.parse(JSON.parse(event.data));
      } catch {
        return;
      }
      if (hint.type === 'notification') {
        refresh(queryKeys.notifications);
        refresh(queryKeys.widget('messages'));
        return;
      }
      if (hint.keys.length === 0) return refreshAll();
      for (const key of hint.keys) refresh(queryKeys.widget(key));
      if (hint.keys.includes('my-tasks')) refresh(queryKeys.tasks);
      if (hint.keys.includes('waiting-signature')) {
        refresh(queryKeys.signatureRequests);
        refresh(queryKeys.documents);
      }
      if (hint.keys.some((key) => SCHEDULE_WIDGETS.includes(key))) {
        refresh(queryKeys.projects);
        refresh(['project']);
        refresh(queryKeys.deviations);
        for (const key of DUE_DATE_WIDGETS) refresh(queryKeys.widget(key));
        refresh(queryKeys.tasks);
      }
    };
    return () => source.close();
  }, [queryClient]);

  return null;
}
