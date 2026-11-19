'use client';

import { getVersionLinks, type DocumentDetail } from '@coal/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AttachmentsAndSources } from '@/components/attachments-sources';
import { ComparePanel } from '@/components/compare-panel';
import { DocumentForm } from '@/components/document-form';
import { RecordView } from '@/components/document-content';
import { ProblemMessage } from '@/components/problem-message';
import { SignaturePanel } from '@/components/signature-panel';
import { DocumentStatusBadge, Pill } from '@/components/status-badge';
import { SubmitPanel } from '@/components/submit-panel';
import { Button } from '@/components/ui/button';
import { UploadVersion } from '@/components/upload-version';
import { VersionList } from '@/components/version-list';
import { api } from '@/lib/api';
import { formatDateTime, formatSize } from '@/lib/format';
import { useOpenLink } from '@/lib/open-link';
import { useAfterDocumentChange, useDocument, useProjectRoute } from '@/lib/queries';

/**
 * One document: its versions, the form (or the read-only view) of the version you're on, its PDF,
 * the signature rows, a comparison of versions, and what is attached to it.
 */
export default function DocumentPage() {
  const { id: projectId, docId } = useParams<{ id: string; docId: string }>();
  const t = useTranslations('document');
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const document = useDocument(docId, selected);
  const route = useProjectRoute(projectId);
  const afterChange = useAfterDocumentChange(projectId);
  const link = useOpenLink();

  const back = (
    <Link
      href={`/projects/${projectId}`}
      className="text-sm text-muted-foreground underline-offset-2 hover:underline"
    >
      {t('backToProject')}
    </Link>
  );
  if (document.error) {
    return (
      <div className="mx-auto grid w-full max-w-3xl content-start gap-4 p-6">
        {back}
        <ProblemMessage error={document.error} />
      </div>
    );
  }
  const doc = document.data;
  if (!doc) return <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p>;
  const current = doc.current;
  const stepName = route.data?.steps.find((s) => s.key === doc.stepKey)?.name;

  const changed = (updated: DocumentDetail) => {
    const version = updated.current?.versionNo;
    setNotice(
      version && version !== current?.versionNo ? t('savedAsVersion', { n: version }) : null,
    );
    setSelected(version ?? null);
    void afterChange(updated);
  };
  const select = (versionNo: number) => {
    if (dirty && !window.confirm(t('discardChanges'))) return;
    setNotice(null);
    setSelected(versionNo);
  };
  const open = (which: 'pdf' | 'file') =>
    current &&
    link.open(
      async () =>
        (await api(getVersionLinks, { params: { id: doc.id, n: current.versionNo } }))[which]
          ?.url ?? null,
      { pdf: which === 'pdf' },
    );

  const isLatest = !!current && current.versionNo === doc.latestVersionNo;
  const isRecord = doc.type.kind === 'record';

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 p-6">
      <header className="grid gap-2">
        <Link
          href={`/projects/${projectId}#step-${doc.stepKey}`}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('backToStep', { code: doc.projectCode, step: doc.stepKey, name: stepName ?? '' })}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="font-mono text-lg text-muted-foreground">{doc.number}</span> ·{' '}
            {doc.title}
          </h1>
          <DocumentStatusBadge status={doc.status} rev={doc.approvedRev} />
        </div>
        <p className="text-sm text-muted-foreground">
          {isRecord ? t('signoffRecord') : doc.type.name} ·{' '}
          {t('projectLine', { code: doc.projectCode })}
          {' · '}
          {t('createdBy', { name: doc.createdBy.name })}
        </p>
      </header>

      {doc.restricted ? (
        <p className="rounded-lg border border-dashed p-6 text-sm">{t('restricted')}</p>
      ) : !current ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t('noVersion')}
        </p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-4">
            <div className="grid gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{t('version', { n: current.versionNo })}</h2>
                <DocumentStatusBadge status={current.status} rev={current.revLabel} />
                {current.carried && (
                  <Pill tone="neutral">{t('carried', { n: current.iteration - 1 })}</Pill>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  {current.hasPdf && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={link.pending}
                      onClick={() => open('pdf')}
                    >
                      {t('openPdf')}
                    </Button>
                  )}
                  {current.file && !current.hasPdf && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={link.pending}
                      onClick={() => open('file')}
                    >
                      {t('openFile')}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('versionBy', {
                  name: current.createdBy.name,
                  when: formatDateTime(current.createdAt),
                })}
                {current.iteration > 1 && <> · {t('iteration', { n: current.iteration })}</>}
              </p>
              {current.note && <p className="text-sm">{current.note}</p>}
              <ProblemMessage error={link.error} />
            </div>

            {notice && (
              <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                {notice}
              </p>
            )}
            {!isLatest && (
              <div className="flex flex-wrap items-center gap-3 rounded-md bg-warning p-3 text-sm text-warning-foreground">
                <span>{t('earlierVersion', { latest: doc.latestVersionNo })}</span>
                <Button size="xs" variant="outline" onClick={() => select(doc.latestVersionNo)}>
                  {t('goToLatest')}
                </Button>
              </div>
            )}
            {isRecord && <p className="text-sm text-muted-foreground">{t('signoffNote')}</p>}

            {doc.spec ? (
              <DocumentForm
                key={current.id}
                doc={doc}
                spec={doc.spec}
                version={current}
                onChanged={changed}
                onDirtyChange={setDirty}
              />
            ) : current.file ? (
              <div className="grid gap-3">
                <div className="rounded-lg border p-4 text-sm">
                  <p className="font-medium">{current.file.name}</p>
                  <p className="text-muted-foreground">
                    {current.file.mimeType} · {formatSize(current.file.size)}
                  </p>
                </div>
                {doc.can.edit && <UploadVersion doc={doc} onChanged={changed} />}
              </div>
            ) : current.content ? (
              <div className="rounded-lg border p-4 text-sm">
                <RecordView content={current.content} />
              </div>
            ) : null}

            {doc.can.submit && isLatest && current.status === 'draft' && (
              <SubmitPanel
                doc={doc}
                versionNo={current.versionNo}
                dirty={dirty}
                onChanged={changed}
              />
            )}
            <SignaturePanel doc={doc} version={current} onChanged={changed} />
            {doc.spec && (
              <ComparePanel key={doc.versions.length} docId={doc.id} versions={doc.versions} />
            )}
          </div>

          <aside className="grid content-start gap-6">
            <section className="grid gap-2" aria-labelledby="versions-heading">
              <h2
                id="versions-heading"
                className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
              >
                {t('versions')}
              </h2>
              <VersionList versions={doc.versions} selected={current.versionNo} onSelect={select} />
            </section>
            <AttachmentsAndSources
              projectId={projectId}
              target={{ documentId: doc.id }}
              defaultOpen
            />
          </aside>
        </div>
      )}
    </div>
  );
}
