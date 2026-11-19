'use client';

import { ApiError, MAX_UPLOAD_BYTES, type ErrorCode } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { formatSize } from '@/lib/format';
import { ALLOWED_EXTENSIONS, UploadCheckError, UploadTransferError } from '@/lib/upload';

type ProblemKey = Parameters<ReturnType<typeof useTranslations<'problems'>>>[0];

/**
 * Shows a refusal or error in the user's language, by its problem code. `overrides` gives one
 * page its own wording for a code, such as sign-in's "no such account". When the API lists what
 * failed a check (VALIDATION_FAILED with `errors`), every message is shown, so the person can fix
 * all of it at once. Also covers the browser's own upload refusals.
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
  else if (error instanceof UploadCheckError) {
    text = t(`upload_${error.reason}`, {
      types: ALLOWED_EXTENSIONS,
      limit: formatSize(MAX_UPLOAD_BYTES),
    });
  } else if (error instanceof UploadTransferError) text = t('upload_transfer');
  else if (code === 'NOT_ALLOWED' && error instanceof ApiError) {
    text = t('NOT_ALLOWED', { who: (error.problem.whoCan ?? []).join(', ') });
  } else {
    text = t(code && t.has(code as ProblemKey) ? (code as ProblemKey) : 'generic', { who: '' });
  }
  const details =
    code === 'VALIDATION_FAILED' && error instanceof ApiError
      ? [...new Set((error.problem.errors ?? []).map((e) => e.message))]
      : [];
  return (
    <div role="alert" className="grid gap-1 text-sm text-destructive">
      <p>{text}</p>
      {details.length > 0 && (
        <ul className="list-disc pl-5">
          {details.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
