'use client';

import { ApiError, createDocument, getTemplateLinks } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useOpenLink } from '@/lib/open-link';
import { queryKeys, useDocumentTypes, useMe } from '@/lib/queries';
import { ACCEPT_ALL, uploadFile } from '@/lib/upload';

/** `template`: filled in COAL from a specification (parked). `copy`: a copy of the blank form. `upload`: the filled-in file. */
type Source = 'template' | 'copy' | 'upload';

/**
 * Starts a document on a step. A template is Jayon's Word form: the person downloads the blank
 * form and uploads it filled in, or starts a copy of it here to fill in with the assistant or in
 * Word. A kind without a form takes an upload. The API checks who may.
 */
export function AddDocument({ projectId, stepKey }: { projectId: string; stepKey: string }) {
  const t = useTranslations('documents');
  const router = useRouter();
  const queryClient = useQueryClient();
  const types = useDocumentTypes();
  const me = useMe();
  const link = useOpenLink();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [preferred, setPreferred] = useState<Source | null>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // COAL makes the records itself; the other types are for this step or for any step.
  const options = (types.data ?? []).filter(
    (type) =>
      type.kind !== 'record' && (type.stepKeys.length === 0 || type.stepKeys.includes(stepKey)),
  );
  const type = options.find((o) => o.code === code);
  const active = type?.kind === 'template' ? type.activeTemplate : null;
  // Filling in COAL from a specification is parked: it shows only where it is switched on and the template has one.
  const canFill = !!me.data?.features.templateFilling && !!active?.hasSpec;
  const source: Source = !active
    ? 'upload'
    : preferred && (preferred !== 'template' || canFill)
      ? preferred
      : canFill
        ? 'template'
        : 'copy';

  const create = useMutation({
    mutationFn: async () => {
      const fileId = source === 'upload' && file ? (await uploadFile(file)).id : undefined;
      return api(createDocument, {
        params: { id: projectId },
        body: {
          stepKey,
          documentType: code,
          ...(title.trim() && { title: title.trim() }),
          ...(fileId && { fileId }),
          ...(source === 'copy' && { fromForm: true }),
        },
      });
    },
    onSuccess: async (doc) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      router.push(`/projects/${projectId}/documents/${doc.id}`);
    },
    // The template list was stale: reload it, so the form offers the upload instead.
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'NO_TEMPLATE') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.documentTypes });
      }
    },
  });

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t('add')}
        </Button>
      </div>
    );
  }

  const id = `add-doc-${stepKey}`;
  const ready = code !== '' && (source !== 'upload' || !!file);
  return (
    <form
      className="grid gap-3 rounded-md border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-type`}>{t('type')}</Label>
        <select
          id={`${id}-type`}
          className={selectClass}
          required
          value={code}
          onChange={(e) => {
            create.reset();
            setCode(e.target.value);
          }}
        >
          <option value="" disabled>
            {t('chooseType')}
          </option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
        <ProblemMessage error={types.error} />
        {types.isSuccess && options.length === 0 && (
          <p className="text-muted-foreground">{t('noTypes')}</p>
        )}
      </div>

      {type && type.kind === 'template' && !type.activeTemplate && (
        <p className="rounded-md bg-warning p-3 text-warning-foreground">
          {t('noTemplate', { type: type.name })}
        </p>
      )}
      {active && (
        <div className="grid gap-1.5 rounded-md bg-muted/50 p-3">
          <p>{t('formExplain', { name: type?.name ?? '', n: active.version })}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={link.pending}
              onClick={() =>
                link.open(
                  async () =>
                    (await api(getTemplateLinks, { params: { id: active.id } })).form?.url ?? null,
                )
              }
            >
              {t('downloadForm', { n: active.version })}
            </Button>
          </div>
          <ProblemMessage error={link.error} />
        </div>
      )}
      {active && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">{t('how')}</legend>
          {canFill && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-source`}
                checked={source === 'template'}
                onChange={() => setPreferred('template')}
              />
              {t('fromTemplate', { name: active.name, n: active.version })}
            </label>
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-source`}
              checked={source === 'copy'}
              onChange={() => setPreferred('copy')}
            />
            {t('fromCopy')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-source`}
              checked={source === 'upload'}
              onChange={() => setPreferred('upload')}
            />
            {t('fromUpload')}
          </label>
        </fieldset>
      )}

      {type && source === 'upload' && (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-file`}>{t('file')}</Label>
          <Input
            id={`${id}-file`}
            type="file"
            accept={ACCEPT_ALL}
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${id}-title`}>{t('titleLabel')}</Label>
        <Input
          id={`${id}-title`}
          minLength={3}
          maxLength={160}
          placeholder={type?.name}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <ProblemMessage error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || create.isPending}>
          {create.isPending ? t('creating') : t('create')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
