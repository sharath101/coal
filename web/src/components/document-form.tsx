'use client';

import {
  FIELD_SOURCES,
  TABLE_COLUMNS,
  fieldLabel,
  saveVersion,
  specTitle,
  type DocumentDetail,
  type SpecField,
  type TemplateSpec,
  type VersionDetail,
} from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FieldTable } from '@/components/document-content';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Typed {
  fields: Record<string, string>;
  sections: Record<string, string>;
}

/** What the person types, taken from a version: the `person` fields and the written sections. */
function typedFrom(spec: TemplateSpec, version: VersionDetail): Typed {
  const typed: Typed = { fields: {}, sections: {} };
  for (const section of spec.sections) {
    if (section.kind === 'written') {
      typed.sections[section.id] = version.content?.sections[section.id] ?? '';
      continue;
    }
    for (const [name, field] of Object.entries(section.fields)) {
      if (field.from !== 'person') continue;
      const value = version.content?.fields[name];
      typed.fields[name] = typeof value === 'string' ? value : '';
    }
  }
  return typed;
}

const same = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).every((key) => a[key] === b[key]);

/**
 * The document's form, built from its template's specification and one version's content. Only
 * the person's own fields and the written sections can be typed; the rest is filled by COAL from
 * its records and shown read-only. Saving makes a new version, and nothing is overwritten. The
 * parent keys this by version, so typed text survives a refetch and resets only on a new version.
 */
export function DocumentForm({
  doc,
  spec,
  version,
  onChanged,
  onDirtyChange,
}: {
  doc: DocumentDetail;
  spec: TemplateSpec;
  version: VersionDetail;
  onChanged: (doc: DocumentDetail) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations('document');
  const [initial] = useState(() => typedFrom(spec, version));
  const [typed, setTyped] = useState<Typed>(initial);
  const [note, setNote] = useState('');
  const editable = doc.can.edit;
  const dirty = !same(typed.fields, initial.fields) || !same(typed.sections, initial.sections);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: () =>
      api(saveVersion, {
        params: { id: doc.id },
        body: { fields: typed.fields, sections: typed.sections, note },
      }),
    onSuccess: onChanged,
  });

  const setField = (name: string, value: string) =>
    setTyped((s) => ({ ...s, fields: { ...s.fields, [name]: value } }));
  const setSection = (id: string, value: string) =>
    setTyped((s) => ({ ...s, sections: { ...s.sections, [id]: value } }));

  const required = (flag: boolean) =>
    flag && <span className="font-normal text-muted-foreground">· {t('required')}</span>;

  function renderField(name: string, field: SpecField) {
    const id = `field-${version.id}-${name}`;
    const label = fieldLabel(name, field);
    const value = typed.fields[name] ?? '';
    if (field.from === 'person') {
      if (!editable) {
        return (
          <dl key={name} className={cn('grid gap-1', field.multiline && 'sm:col-span-2')}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap">{value || t('notFilled')}</dd>
          </dl>
        );
      }
      return (
        <div key={name} className={cn('grid gap-1.5', field.multiline && 'sm:col-span-2')}>
          <Label htmlFor={id}>
            {label}
            {required(field.required)}
          </Label>
          {field.multiline ? (
            <Textarea
              id={id}
              value={value}
              maxLength={5000}
              onChange={(e) => setField(name, e.target.value)}
            />
          ) : (
            <Input
              id={id}
              value={value}
              maxLength={5000}
              onChange={(e) => setField(name, e.target.value)}
            />
          )}
        </div>
      );
    }
    const filled = version.content?.fields[name];
    if (FIELD_SOURCES[field.from] === 'table') {
      return (
        <dl key={name} className="grid gap-1.5 sm:col-span-2">
          <dt className="text-muted-foreground">
            {label} <span className="text-xs">· {t('filledByCoal')}</span>
          </dt>
          <dd>
            <FieldTable
              rows={Array.isArray(filled) ? filled : []}
              columns={TABLE_COLUMNS[field.from]}
            />
          </dd>
        </dl>
      );
    }
    return (
      <dl key={name} className="grid gap-1">
        <dt className="text-muted-foreground">
          {label} <span className="text-xs">· {t('filledByCoal')}</span>
        </dt>
        <dd className="whitespace-pre-wrap">{typeof filled === 'string' ? filled : ''}</dd>
      </dl>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (editable && dirty) save.mutate();
      }}
    >
      {spec.sections.map((section) => {
        if (section.kind === 'written') {
          const id = `section-${version.id}-${section.id}`;
          const value = typed.sections[section.id] ?? '';
          return (
            <section key={section.id} className="grid gap-2 rounded-lg border p-4">
              <h3 className="text-sm font-medium">
                {specTitle(section)} {required(section.required)}
              </h3>
              {editable ? (
                <>
                  <Label htmlFor={id} className="font-normal text-muted-foreground">
                    {section.instructions}
                  </Label>
                  <Textarea
                    id={id}
                    className="min-h-40"
                    value={value}
                    maxLength={30000}
                    onChange={(e) => setSection(section.id, e.target.value)}
                  />
                </>
              ) : (
                <p className="whitespace-pre-wrap">{value || t('notFilled')}</p>
              )}
            </section>
          );
        }
        return (
          <section key={section.id} className="grid gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-medium">{specTitle(section)}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(section.fields).map(([name, field]) => renderField(name, field))}
            </div>
          </section>
        );
      })}

      {editable && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`note-${version.id}`}>{t('note')}</Label>
            <Input
              id={`note-${version.id}`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-muted-foreground">{t('savingMakesNew')}</p>
          <ProblemMessage error={save.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              {save.isPending ? t('saving') : t('save')}
            </Button>
            {!dirty && <span className="text-muted-foreground">{t('nothingChanged')}</span>}
          </div>
        </div>
      )}
    </form>
  );
}
