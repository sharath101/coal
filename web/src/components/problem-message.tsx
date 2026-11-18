'use client';

import { ApiError, type ErrorCode } from '@coal/shared';
import { useTranslations } from 'next-intl';

type ProblemKey = Parameters<ReturnType<typeof useTranslations<'problems'>>>[0];

/**
 * Shows a refusal or error in the user's language, by its problem code. `overrides` gives one
 * page its own wording for a code, such as sign-in's "no such account".
 */
export function ProblemMessage({
  error,
  overrides = {},
}: {
  error: unknown;
  overrides?: Partial<Record<ErrorCode, string>>;
}) {
  const t = useTranslations('problems');
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : null;
  const override = code ? overrides[code] : undefined;
  let text: string;
  if (override) text = override;
  else if (code === 'NOT_ALLOWED' && error instanceof ApiError) {
    text = t('NOT_ALLOWED', { who: (error.problem.whoCan ?? []).join(', ') });
  } else {
    text = t(code && t.has(code as ProblemKey) ? (code as ProblemKey) : 'generic', { who: '' });
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  );
}
