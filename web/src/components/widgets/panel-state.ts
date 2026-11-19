import { WIDGET_KEYS, type WidgetKey } from '@coal/shared';
import { WIDGET_FILTERS, type WidgetFilter } from '@/lib/queries';

/** The three questions the Dashboard answers, in this order (docs/dashboard.md), and their texts. */
export const QUESTIONS = ['needs_me', 'coming', 'how'] as const;
export const QUESTION_TITLE = {
  needs_me: 'needsMe',
  coming: 'coming',
  how: 'howWeAreDoing',
} as const;

/** What the open panel shows. It lives in the URL, so a panel can be linked to and Back closes it. */
export interface PanelState {
  key: WidgetKey;
  tab: string | null;
  filters: Partial<Record<WidgetFilter, string>>;
}

/** The panel in `/dashboard?w=my-tasks&tab=done&project=SPN-26-002`, or null when none is open. */
export function readPanel(
  params: URLSearchParams,
  available: readonly WidgetKey[],
): PanelState | null {
  const key = WIDGET_KEYS.find((k) => k === params.get('w'));
  if (!key || !available.includes(key)) return null;
  const filters: PanelState['filters'] = {};
  for (const name of WIDGET_FILTERS) {
    const value = params.get(name);
    if (value) filters[name] = value;
  }
  return { key, tab: params.get('tab'), filters };
}

export function panelHref(state: PanelState): string {
  const params = new URLSearchParams({ w: state.key });
  if (state.tab) params.set('tab', state.tab);
  for (const name of WIDGET_FILTERS) {
    const value = state.filters[name];
    if (value) params.set(name, value);
  }
  return `/dashboard?${params.toString()}`;
}
