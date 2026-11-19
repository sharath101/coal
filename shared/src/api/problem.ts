import { z } from 'zod';

/** Error codes in problem responses (docs/api.md#conventions). */
export const ERROR_CODES = [
  'NOT_SIGNED_IN',
  'NOT_ALLOWED',
  'AI_NOT_ALLOWED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'NAME_TAKEN',
  'PRODUCT_LINE_REQUIRED',
  'UPLOAD_NOT_ALLOWED',
  'UPLOAD_INCOMPLETE',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'STEP_NOT_READY',
  'PROJECT_NOT_ACTIVE',
  'DECISION_REQUIRED',
  'CORRECTIVE_ACTIONS_OPEN',
  'ALREADY_DONE',
  'SIGNATURE_REQUIRED',
  'NO_TEMPLATE',
  'DOCUMENT_LOCKED',
  'SEPARATION_OF_DUTIES',
  'PDF_UNAVAILABLE',
  'FILE_NOT_SCANNED',
  'DEVIATION_REQUIRED',
  'PREVIEW_CHANGED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 problem details, with COAL's code. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  /** For NOT_ALLOWED: who can do it. Never reveals content. */
  whoCan: z.array(z.string()).optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;
