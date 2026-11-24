'use client';

import { compareVersions, type CompareResponse, type VersionSummary } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Compare two versions of a template document: fields side by side, written text as a word diff. */
export function ComparePanel({ docId, versions }: { docId: string; versions: VersionSummary[] }) {
  const t = useTranslations('compare');
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const [to, setTo] = useState(ordered[0]?.versionNo ?? 1);
  const [from, setFrom] = useState(ordered[1]?.versionNo ?? 1);
  const [onlyChanged, setOnlyChanged] = useState(true);

  const compare = useMutation({
    mutationFn: () => api(compareVersions, { params: { id: docId }, query: { from, to } }),
  });

  if (versions.length < 2) return null;
  const label = (v: VersionSummary) =>
    v.revLabel
      ? t('versionRev', { n: v.versionNo, rev: v.revLabel })
      : t('version', { n: v.versionNo });
  const result: CompareResponse | undefined = compare.data;

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-labelledby="compare-heading">
      <h3 id="compare-heading" className="text-sm font-medium">
        {t('heading')}
      </h3>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          compare.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="compare-from">{t('from')}</Label>
          <select
            id="compare-from"
            className={cn(selectClass, 'w-auto')}
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {ordered.map((v) => (
              <option key={v.id} value={v.versionNo}>
                {label(v)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="compare-to">{t('to')}</Label>
          <select
            id="compare-to"
            className={cn(selectClass, 'w-auto')}
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
          >
            {ordered.map((v) => (
              <option key={v.id} value={v.versionNo}>
                {label(v)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={compare.isPending || from === to}>
          {t('run')}
        </Button>
      </form>
      <ProblemMessage error={compare.error} />

      {result && (
        <div className="grid gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.target.checked)}
            />
            {t('onlyChanged')}
          </label>

          <div className="grid gap-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('fields')}
            </h4>
            {(() => {
              const rows = result.fields.filter((f) => !onlyChanged || f.changed);
              if (rows.length === 0)
                return <p className="text-muted-foreground">{t('noFieldChanges')}</p>;
              return (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          {t('field')}
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          {t('before', { n: result.from.versionNo })}
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          {t('after', { n: result.to.versionNo })}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((f) => (
                        <tr key={f.key} className={cn('border-t', f.changed && 'bg-amber-50')}>
                          <th scope="row" className="px-2 py-1.5 text-left align-top font-medium">
                            {f.label}
                            {f.changed && <span className="sr-only"> {t('changedHint')}</span>}
                          </th>
                          <td className="px-2 py-1.5 align-top whitespace-pre-wrap">{f.before}</td>
                          <td className="px-2 py-1.5 align-top whitespace-pre-wrap">{f.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>

          <div className="grid gap-3">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('sections')}
            </h4>
            {result.sections
              .filter((s) => !onlyChanged || s.changed)
              .map((s) => (
                <div key={s.id} className="grid gap-1 rounded-md border p-3">
                  <h5 className="font-medium">
                    {s.title}
                    {!s.changed && (
                      <span className="font-normal text-muted-foreground"> · {t('unchanged')}</span>
                    )}
                  </h5>
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {s.parts.map((part, i) =>
                      part.type === 'added' ? (
                        <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">
                          {part.text}
                        </ins>
                      ) : part.type === 'removed' ? (
                        <del key={i} className="bg-red-100 text-red-900">
                          {part.text}
                        </del>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </p>
                </div>
              ))}
            {result.sections.every((s) => !s.changed) && onlyChanged && (
              <p className="text-muted-foreground">{t('noSectionChanges')}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('legend')}</p>
        </div>
      )}
    </section>
  );
}
