'use client';

import { readable, type DocumentContent } from '@coal/shared';
import { useTranslations } from 'next-intl';

type Rows = Record<string, string>[];

/** Table fields (the team, a record's outputs) are filled by COAL, so they are shown, never edited. */
export function FieldTable({ rows, columns }: { rows: Rows; columns?: readonly string[] }) {
  const t = useTranslations('document');
  const names = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (rows.length === 0) return <p className="text-muted-foreground">{t('emptyTable')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {names.map((name) => (
              <th key={name} scope="col" className="px-2 py-1.5 font-medium">
                {t.has(`column_${name}` as 'column_number')
                  ? t(`column_${name}` as 'column_number')
                  : readable(name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {names.map((name) => (
                <td key={name} className="px-2 py-1.5 align-top">
                  {row[name] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The record also holds each output's full hashes; the short hash column is what people read.
const HIDDEN_COLUMNS = ['content_sha256', 'pdf_sha256'];
// Stored values come back in no set order; the record reads best in this one.
const FIELD_ORDER = [
  'project',
  'step',
  'iteration',
  'number',
  'prepared_by',
  'started_on',
  'submitted_on',
  'deviations',
];
const COLUMN_ORDER = ['number', 'title', 'version', 'status', 'hash', 'name', 'answer'];

const rank = (order: string[], name: string) => {
  const at = order.indexOf(name);
  return at < 0 ? order.length : at;
};

/** A record COAL generated (the step sign-off record): every field and table, read-only. */
export function RecordView({ content }: { content: DocumentContent }) {
  const t = useTranslations('document');
  const entries = Object.entries(content.fields).sort(
    ([a], [b]) => rank(FIELD_ORDER, a) - rank(FIELD_ORDER, b),
  );
  const texts = entries.filter(([, v]) => typeof v === 'string') as [string, string][];
  const tables = entries.filter(([, v]) => Array.isArray(v)) as [string, Rows][];
  const label = (name: string) =>
    t.has(`record_${name}` as 'record_project')
      ? t(`record_${name}` as 'record_project')
      : readable(name);
  return (
    <div className="grid gap-4">
      <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        {texts.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{label(name)}</dt>
            <dd className="whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      {tables.map(([name, rows]) => (
        <div key={name} className="grid gap-1.5">
          <h3 className="text-sm font-medium">{label(name)}</h3>
          <FieldTable
            rows={rows}
            columns={[...new Set(rows.flatMap((row) => Object.keys(row)))]
              .filter((column) => !HIDDEN_COLUMNS.includes(column))
              .sort((a, b) => rank(COLUMN_ORDER, a) - rank(COLUMN_ORDER, b))}
          />
        </div>
      ))}
    </div>
  );
}
