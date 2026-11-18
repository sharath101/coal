import type { EngineError, ErrorCode } from '@coal/shared';

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

const ENGINE_STATUS = {
  STEP_NOT_READY: 409,
  PROJECT_NOT_ACTIVE: 409,
  DECISION_REQUIRED: 409,
  CORRECTIVE_ACTIONS_OPEN: 409,
  ALREADY_DONE: 409,
  NOT_ALLOWED: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
} as const;

/** Turns a refusal from the process engine into the API's problem response. */
export function fromEngineError(error: EngineError): AppError {
  return new AppError(ENGINE_STATUS[error.code], error.code, error.message);
}
