import type { ErrorCode } from '@coal/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: { whoCan?: string[]; errors?: { path: string; message: string }[] } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `There is no such ${what}.`);

export const validationFailed = (message: string, path = '') =>
  new AppError(400, 'VALIDATION_FAILED', message, { errors: [{ path, message }] });
