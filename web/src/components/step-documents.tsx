'use client';

import type { DocumentSummary } from '@coal/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AddDocument } from '@/components/add-document';
import { AttachmentsAndSources } from '@/components/attachments-sources';
import { DocumentStatusBadge } from '@/components/status-badge';

/** One document in a list: its number and title as a link, its type, versions and state. */
export function DocumentListItem({ doc }: { doc: DocumentSummary }) {
  const t = useTranslations('documents');
  return (
    <li className="grid gap-1 rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/projects/${doc.projectId}/documents/${doc.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          <span className="font-mono text-xs">{doc.number}</span> · {doc.title}
        </Link>
        <span className="ml-auto">
          <DocumentStatusBadge status={doc.status} rev={doc.approvedRev} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {doc.type.kind === 'record' ? t('signoffRecord') : doc.type.name} ·{' '}
        {t('versions', { count: doc.latestVersionNo })}
        {doc.restricted && <> · {t('restrictedShort')}</>}
      </p>
    </li>
  );
}

/** A step's documents, a way to add one while the step is open, and its attachments and sources. */
export function StepDocuments({
  projectId,
  stepKey,
  documents,
  canAdd,
}: {
  projectId: string;
  stepKey: string;
  documents: DocumentSummary[];
  canAdd: boolean;
}) {
  const t = useTranslations('documents');
  return (
    <div className="grid gap-2">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('heading')}
      </h4>
      {documents.length === 0 ? (
        <p className="text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {documents.map((doc) => (
            <DocumentListItem key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
      {documents.some((d) => d.type.kind === 'record') && (
        <p className="text-xs text-muted-foreground">{t('signoffNote')}</p>
      )}
      {canAdd && <AddDocument projectId={projectId} stepKey={stepKey} />}
      <AttachmentsAndSources projectId={projectId} target={{ stepKey }} />
    </div>
  );
}
