'use client';

import type { SigningPreview } from '@coal/shared';
import { useTranslations } from 'next-intl';

/** Until passkeys exist, a signature is a confirmed click. Shown wherever someone signs or submits. */
export function SigningNotice() {
  const t = useTranslations('signing');
  return (
    <p
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
    >
      {t('notice')}
    </p>
  );
}

/** What a submit or a signature would do: who signs each row, and anything worth knowing first. */
export function SigningPreviewPanel({ preview }: { preview: SigningPreview }) {
  const t = useTranslations('signing');
  const tMeaning = useTranslations('meaning');
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
      {preview.warnings.length > 0 && (
        <section className="grid gap-1 rounded-md bg-warning p-3 text-warning-foreground">
          <h4 className="text-xs font-medium tracking-wide uppercase">{t('warnings')}</h4>
          <ul className="list-disc pl-4">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="grid gap-1">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('rows')}
        </h4>
        <ul className="grid gap-0.5">
          {preview.rows.map((row) => (
            <li key={row.meaning}>
              <span className="font-medium">{tMeaning(row.meaning)}</span>
              <span className="text-muted-foreground"> → </span>
              {row.byYou ? t('byYou') : row.who}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
