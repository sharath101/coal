import { PROBLEM_CONTENT_TYPE, type ErrorCode, type Problem } from '@coal/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from './errors';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Not signed in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  412: 'Changed by someone else',
  413: 'Too large',
  415: 'Unsupported content type',
  422: 'Unprocessable',
  429: 'Too many requests',
  500: 'Something went wrong',
};

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  problem: Omit<Problem, 'type' | 'title' | 'requestId'>,
) {
  const body: Problem = {
    type: 'about:blank',
    title: TITLES[problem.status] ?? 'Error',
    requestId: request.id,
    ...problem,
  };
  return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Every error leaves as application/problem+json with a code (docs/api.md#conventions). */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return send(reply, request, {
        status: error.status,
        code: error.code,
        detail: error.message,
        ...error.extra,
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(reply, request, {
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'Some of the values sent are not valid.',
        errors: error.validation.map((v) => ({
          path: [error.validationContext, v.instancePath].filter(Boolean).join(''),
          message: v.message ?? 'Invalid value',
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, issues: error.cause.issues },
        'response did not match its schema',
      );
      return send(reply, request, { status: 500, code: 'INTERNAL' });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return send(reply, request, { status: 500, code: 'INTERNAL' });
    }
    const code: ErrorCode = status === 429 ? 'RATE_LIMITED' : 'VALIDATION_FAILED';
    return send(reply, request, { status, code, detail: error.message });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, { status: 404, code: 'NOT_FOUND', detail: 'There is no such endpoint.' }),
  );
}
