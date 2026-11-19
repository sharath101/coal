import { ApiError } from '@coal/shared';

/**
 * A late step can't be submitted, and a late task can't be closed, until someone records why it
 * is late (docs/dashboard.md#deadlines-alerts-and-deviations). Where this happens, the website
 * offers the "Record why it is late" dialog and then tries again.
 */
export const isDeviationRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'DEVIATION_REQUIRED';
