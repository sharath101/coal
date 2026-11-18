'use client';

import { ApiError } from '@coal/shared';
import { useTranslations } from 'next-intl';

type ProblemKey = Parameters<ReturnType<typeof useTranslations<'problems'>>>[0];

/** Shows a refusal or error in the user's language, by its problem code. */
export function ProblemMessage({ error }: { error: unknown }) {
  const t = useTranslations('problems');
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : null;
  const key: ProblemKey = code && t.has(code as ProblemKey) ? (code as ProblemKey) : 'generic';
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(key)}
    </p>
  );
}
