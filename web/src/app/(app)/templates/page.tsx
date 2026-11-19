'use client';

import type { DocumentTypeView, TemplateSummary } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { TemplateUpload } from '@/components/template-upload';
import { TemplateVersionRow } from '@/components/template-version-row';
import { canManageTemplates } from '@/lib/roles';
import { useDocumentTypes, useMe, useTemplates } from '@/lib/queries';

/** The template library, for the VP and the R&D Head: every version of each document's Word template. */
export default function TemplatesPage() {
  const t = useTranslations('templates');
  const me = useMe();
  const allowed = !!me.data && canManageTemplates(me.data.role.key);
  const types = useDocumentTypes();
  const templates = useTemplates(allowed);

  if (!me.data) return null;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t('onlyManagers')}
        </p>
      </div>
    );
  }

  const all = templates.data ?? [];
  const versionsOf = (code: string): TemplateSummary[] =>
    all.filter((x) => x.documentType.code === code).sort((a, b) => b.version - a.version);
  const items = types.data ?? [];
  const templated = items.filter((x: DocumentTypeView) => x.kind === 'template');
  const others = items.filter((x: DocumentTypeView) => x.kind !== 'template');
  const stepsOf = (type: DocumentTypeView) =>
    type.stepKeys.length === 0
      ? t('anyStep')
      : t('stepsOf', { count: type.stepKeys.length, steps: type.stepKeys.join(', ') });

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <section className="grid gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
        <h2 className="font-medium">{t('checksTitle')}</h2>
        <ul className="list-disc pl-5">
          {(['checkWord', 'checkVirus', 'checkPlaceholders', 'checkSample'] as const).map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t('reuseSpec')}</p>
        <p className="text-muted-foreground">{t('keepsVersion')}</p>
      </section>

      <ProblemMessage error={types.error ?? templates.error} />
      {(types.isPending || templates.isPending) && (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      )}
      {types.isSuccess && templated.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('none')}
        </p>
      )}

      {templates.isSuccess &&
        templated.map((type) => {
          const versions = versionsOf(type.code);
          return (
            <section
              key={type.code}
              aria-labelledby={`type-${type.code}`}
              className="grid gap-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id={`type-${type.code}`} className="text-lg font-semibold">
                  {type.name}
                </h2>
                <span className="font-mono text-xs text-muted-foreground">{type.code}</span>
                <span className="text-sm text-muted-foreground">{stepsOf(type)}</span>
                {type.sensitivity === 'budget' && (
                  <span className="rounded-full border px-2 py-0.5 text-xs">{t('budget')}</span>
                )}
              </div>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noVersions')}</p>
              ) : (
                <>
                  <ul className="grid gap-2">
                    {versions.map((template) => (
                      <TemplateVersionRow key={template.id} template={template} />
                    ))}
                  </ul>
                  <TemplateUpload type={type} />
                </>
              )}
            </section>
          );
        })}

      {others.length > 0 && (
        <section className="grid gap-1 text-sm">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {t('othersTitle')}
          </h2>
          <p className="text-muted-foreground">{t('othersNote')}</p>
          <ul className="list-disc pl-5">
            {others.map((type) => (
              <li key={type.code}>
                {type.name}{' '}
                <span className="text-muted-foreground">
                  · {t(type.kind === 'record' ? 'kindRecord' : 'kindUpload')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
