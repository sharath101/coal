interface PgError {
  code?: string;
  constraint?: string;
}

/** The PostgreSQL error behind a failed query, unwrapping Drizzle's wrapper. */
export function pgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code))
      return candidate;
    current = candidate.cause;
  }
  return null;
}

export const isUniqueViolation = (error: unknown, constraint?: string) => {
  const pg = pgError(error);
  return pg?.code === '23505' && (!constraint || pg.constraint === constraint);
};
