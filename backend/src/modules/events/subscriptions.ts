import type { Subscription } from './dispatcher';
import { NOTIFICATION_SUBSCRIPTIONS } from '../notifications/subscriptions';

/**
 * Who receives which events: the notification sender and the live updates, so far. The forecast
 * and search subscribe here as they're built (docs/architecture.md#events-and-live-updates).
 */
export const SUBSCRIPTIONS: Subscription[] = [...NOTIFICATION_SUBSCRIPTIONS];
