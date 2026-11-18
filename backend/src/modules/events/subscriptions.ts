import type { Subscription } from './dispatcher';

/**
 * Who receives which events. The notification sender, live updates, the forecast and search
 * subscribe here as they're built (docs/architecture.md#events-and-live-updates).
 */
export const SUBSCRIPTIONS: Subscription[] = [];
