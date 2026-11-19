'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { formatTime } from '@/lib/format';
import { useSignatureRequests } from '@/lib/queries';

/** The documents that wait for my signature. Hidden when there are none. */
export function WaitingSignatures() {
  const t = useTranslations('tasks');
  const tMeaning = useTranslations('meaning');
  const requests = useSignatureRequests();
  const items = requests.data ?? [];

  if (requests.error) return <ProblemMessage error={requests.error} />;
  if (items.length === 0) return null;
  return (
    <section className="grid gap-2" aria-labelledby="waiting-signature-heading">
      <h2
        id="waiting-signature-heading"
        className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
      >
        {t('waitingSignature')}
      </h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="grid gap-0.5 rounded-lg border p-3 text-sm">
            <Link
              href={`/projects/${item.project.id}/documents/${item.documentId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              <span className="font-mono text-xs">{item.number}</span> · {item.title}
            </Link>
            <span className="text-xs text-muted-foreground">
              {t('signatureLine', {
                version: item.versionNo,
                meaning: tMeaning(item.meaning),
                project: item.project.code,
                step: item.stepKey,
                when: formatTime(item.requestedAt),
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
