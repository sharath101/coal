'use client';

import { submitVersion, type DocumentDetail, type SigningPreview } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { SigningNotice, SigningPreviewPanel } from '@/components/signing-preview';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * Submit the latest draft for signing: the author signs Prepared and the next row opens. A preview
 * shows who signs what, and warnings such as a role nobody holds yet, before anything is saved.
 */
export function SubmitPanel({
  doc,
  versionNo,
  dirty,
  onChanged,
}: {
  doc: DocumentDetail;
  versionNo: number;
  dirty: boolean;
  onChanged: (doc: DocumentDetail) => void;
}) {
  const t = useTranslations('signing');
  const [preview, setPreview] = useState<SigningPreview | null>(null);
  const params = { id: doc.id, n: versionNo };

  const previewSubmit = useMutation({
    mutationFn: () => api(submitVersion, { params, query: { preview: 'true' } }),
    onSuccess: (result) => setPreview(result.preview),
  });
  const submit = useMutation({
    mutationFn: () => api(submitVersion, { params }),
    onSuccess: (result) => {
      setPreview(null);
      if (result.document) onChanged(result.document);
    },
  });
  const busy = previewSubmit.isPending || submit.isPending;

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label={t('submitHeading')}>
      <h3 className="text-sm font-medium">{t('submitHeading')}</h3>
      <p className="text-muted-foreground">{t('submitExplain', { n: versionNo })}</p>
      {dirty && (
        <p className="rounded-md bg-warning p-3 text-warning-foreground">{t('saveFirst')}</p>
      )}
      {preview ? (
        <>
          <SigningNotice />
          <SigningPreviewPanel preview={preview} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => submit.mutate()}>
              {t('confirmSubmit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button size="sm" disabled={busy || dirty} onClick={() => previewSubmit.mutate()}>
            {t('submit')}
          </Button>
        </div>
      )}
      <ProblemMessage error={previewSubmit.error ?? submit.error} />
    </section>
  );
}
