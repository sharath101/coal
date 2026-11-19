'use client';

import { getFileLink } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { api } from '@/lib/api';
import { useOpenLink } from '@/lib/open-link';

/** A file's name as a button that opens its short-lived link in a new tab. */
export function FileLinkButton({ fileId, name }: { fileId: string; name: string }) {
  const t = useTranslations('files');
  const link = useOpenLink();
  return (
    <span className="inline-grid gap-0.5">
      <button
        type="button"
        className="text-left font-medium underline-offset-2 hover:underline disabled:opacity-50"
        disabled={link.pending}
        title={t('open')}
        onClick={() =>
          link.open(async () => (await api(getFileLink, { params: { id: fileId } })).url)
        }
      >
        {name}
      </button>
      <ProblemMessage error={link.error} />
    </span>
  );
}
