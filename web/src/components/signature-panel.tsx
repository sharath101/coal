'use client';

import {
  returnRequest,
  signRequest,
  type DocumentDetail,
  type RequestView,
  type SigningPreview,
  type VersionDetail,
} from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { SigningNotice, SigningPreviewPanel } from '@/components/signing-preview';
import { RequestStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, shortHash } from '@/lib/format';

type Active = { id: string; kind: 'sign' | 'return' } | null;

/** The signature rows of one version: who signs, who has, and sign or return when it's your turn. */
export function SignaturePanel({
  doc,
  version,
  onChanged,
}: {
  doc: DocumentDetail;
  version: VersionDetail;
  onChanged: (doc: DocumentDetail) => void;
}) {
  const t = useTranslations('signing');
  const tMeaning = useTranslations('meaning');
  const [active, setActive] = useState<Active>(null);
  const [preview, setPreview] = useState<SigningPreview | null>(null);
  const [comment, setComment] = useState('');

  const close = () => {
    setActive(null);
    setPreview(null);
    setComment('');
  };
  const done = (result: { document: DocumentDetail | null }) => {
    close();
    if (result.document) onChanged(result.document);
  };

  const previewSign = useMutation({
    mutationFn: (id: string) => api(signRequest, { params: { id }, query: { preview: 'true' } }),
    onSuccess: (result) => setPreview(result.preview),
  });
  const sign = useMutation({
    mutationFn: (id: string) => api(signRequest, { params: { id } }),
    onSuccess: done,
  });
  const giveBack = useMutation({
    mutationFn: (id: string) => api(returnRequest, { params: { id }, body: { comment } }),
    onSuccess: done,
  });
  const busy = previewSign.isPending || sign.isPending || giveBack.isPending;
  const error = previewSign.error ?? sign.error ?? giveBack.error;

  const requests = [...version.requests].sort((a, b) => a.order - b.order);
  const canSignHere = requests.some((r) => r.can.sign);

  const start = (id: string, kind: 'sign' | 'return') => {
    previewSign.reset();
    sign.reset();
    giveBack.reset();
    setPreview(null);
    setComment('');
    setActive({ id, kind });
    if (kind === 'sign') previewSign.mutate(id);
  };

  const rowLine = (r: RequestView) => {
    const parts = [r.role.name];
    if (r.assignee) parts.push(t('assignedTo', { name: r.assignee.name }));
    return parts.join(' · ');
  };

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-labelledby="signature-heading">
      <h3 id="signature-heading" className="text-sm font-medium">
        {t('heading')}
      </h3>
      {canSignHere && <SigningNotice />}

      {requests.length === 0 ? (
        <div className="grid gap-1 text-muted-foreground">
          <p>{t('notSubmitted')}</p>
          <ul className="list-disc pl-5">
            {doc.signatureRows.map((row) => (
              <li key={row.meaning}>
                <span className="font-medium text-foreground">{tMeaning(row.meaning)}</span>
                {row.roles.length > 0 && <> · {row.roles.map((r) => r.name).join(', ')}</>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="grid gap-2">
          {requests.map((r) => {
            const open = active?.id === r.id ? active : null;
            return (
              <li key={r.id} className="grid gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tMeaning(r.meaning)}</span>
                  <span className="text-muted-foreground">· {rowLine(r)}</span>
                  <span className="ml-auto">
                    <RequestStatusBadge status={r.status} />
                  </span>
                </div>
                {r.status === 'returned' && (
                  <p className="rounded-md bg-red-50 p-2 text-red-950">
                    {r.returnedBy
                      ? t(r.returnComment ? 'returnedByWith' : 'returnedBy', {
                          name: r.returnedBy.name,
                          comment: r.returnComment ?? '',
                        })
                      : t(r.returnComment ? 'returnedWith' : 'returned', {
                          comment: r.returnComment ?? '',
                        })}
                  </p>
                )}
                {(r.can.sign || r.can.return) && !open && (
                  <div className="flex flex-wrap gap-2">
                    {r.can.sign && (
                      <Button size="sm" disabled={busy} onClick={() => start(r.id, 'sign')}>
                        {t('sign', { meaning: tMeaning(r.meaning) })}
                      </Button>
                    )}
                    {r.can.return && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => start(r.id, 'return')}
                      >
                        {t('return')}
                      </Button>
                    )}
                  </div>
                )}

                {open?.kind === 'sign' && (
                  <div className="grid gap-3">
                    {preview ? (
                      <>
                        <p>{t('confirmSignText', { meaning: tMeaning(r.meaning) })}</p>
                        <SigningPreviewPanel preview={preview} />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy} onClick={() => sign.mutate(r.id)}>
                            {t('confirmSign', { meaning: tMeaning(r.meaning) })}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={close}>
                            {t('cancel')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {previewSign.isPending ? t('checking') : ''}
                        </span>
                        <Button size="sm" variant="ghost" onClick={close}>
                          {t('cancel')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {open?.kind === 'return' && (
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      giveBack.mutate(r.id);
                    }}
                  >
                    <Label htmlFor={`return-${r.id}`}>{t('returnComment')}</Label>
                    <Textarea
                      id={`return-${r.id}`}
                      required
                      minLength={3}
                      maxLength={2000}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={busy || comment.trim().length < 3}>
                        {t('confirmReturn')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={close}>
                        {t('cancel')}
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <ProblemMessage error={error} />

      {version.signatures.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('signed')}
          </h4>
          <ul className="grid gap-1.5">
            {version.signatures.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.by.name}</span>
                <span className="text-muted-foreground"> · {s.by.role}</span>
                <span> · {tMeaning(s.meaning)}</span>
                <span className="text-muted-foreground"> · {formatDateTime(s.signedAt)}</span>
              </li>
            ))}
          </ul>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('details')}</summary>
            <dl className="mt-1 grid gap-1 sm:grid-cols-[7rem_1fr]">
              <dt>{t('contentHash')}</dt>
              <dd className="font-mono" title={version.contentSha256}>
                {shortHash(version.contentSha256)}
              </dd>
              {version.pdfSha256 && (
                <>
                  <dt>{t('pdfHash')}</dt>
                  <dd className="font-mono" title={version.pdfSha256}>
                    {shortHash(version.pdfSha256)}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-1">{t('hashNote')}</p>
          </details>
        </div>
      )}
    </section>
  );
}
