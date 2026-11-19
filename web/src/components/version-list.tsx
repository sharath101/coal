'use client';

import type { VersionSummary } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { DocumentStatusBadge, Pill } from '@/components/status-badge';
import { formatDateTime, shortHash } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Every version, newest first. Pick one to read it; nothing is ever overwritten. */
export function VersionList({
  versions,
  selected,
  onSelect,
}: {
  versions: VersionSummary[];
  selected: number | undefined;
  onSelect: (versionNo: number) => void;
}) {
  const t = useTranslations('document');
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  return (
    <ul className="grid gap-2">
      {ordered.map((v) => (
        <li
          key={v.id}
          className={cn(
            'grid gap-1 rounded-lg border p-2 text-sm',
            v.versionNo === selected && 'border-primary',
          )}
        >
          <button
            type="button"
            aria-current={v.versionNo === selected ? 'true' : undefined}
            className="grid gap-1 text-left"
            onClick={() => onSelect(v.versionNo)}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('version', { n: v.versionNo })}</span>
              <DocumentStatusBadge status={v.status} rev={v.revLabel} />
              {v.carried && <Pill tone="neutral">{t('carried', { n: v.iteration - 1 })}</Pill>}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('versionBy', { name: v.createdBy.name, when: formatDateTime(v.createdAt) })}
              {v.iteration > 1 && <> · {t('iteration', { n: v.iteration })}</>}
            </span>
            {v.note && <span>{v.note}</span>}
          </button>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('hashes')}</summary>
            <dl className="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5">
              <dt>{t('contentHash')}</dt>
              <dd className="font-mono" title={v.contentSha256}>
                {shortHash(v.contentSha256)}
              </dd>
              {v.pdfSha256 && (
                <>
                  <dt>{t('pdfHash')}</dt>
                  <dd className="font-mono" title={v.pdfSha256}>
                    {shortHash(v.pdfSha256)}
                  </dd>
                </>
              )}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
