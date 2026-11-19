'use client';

import { createTemplate, type DocumentTypeView, type TemplateDetail } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { uploadFile } from '@/lib/upload';

/**
 * Uploads a new Word file for a document type. COAL checks it and saves it as a draft; if a check
 * fails, every message is shown so the Word file can be fixed in one go.
 */
export function TemplateUpload({ type }: { type: DocumentTypeView }) {
  const t = useTranslations('templates');
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [saved, setSaved] = useState<TemplateDetail | null>(null);
  const id = `template-file-${type.code}`;
  const notDocx = file !== null && !file.name.toLowerCase().endsWith('.docx');

  const mutation = useMutation({
    mutationFn: async (chosen: File) => {
      const stored = await uploadFile(chosen);
      return api(createTemplate, {
        body: { documentType: type.code, docxFileId: stored.id, notes },
      });
    },
    onSuccess: async (template) => {
      setSaved(template);
      setFile(null);
      setNotes('');
      setInputKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });

  return (
    <form
      className="grid gap-3 rounded-lg border border-dashed p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) mutation.mutate(file);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('uploadLabel')}</Label>
        <Input
          key={inputKey}
          id={id}
          type="file"
          accept=".docx"
          onChange={(e) => {
            mutation.reset();
            setSaved(null);
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        {notDocx && <p className="text-destructive">{t('onlyDocx')}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-notes`}>{t('notes')}</Label>
        <Textarea
          id={`${id}-notes`}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={!file || notDocx || mutation.isPending}>
          {mutation.isPending ? t('checking') : t('uploadAndCheck')}
        </Button>
      </div>
      <ProblemMessage error={mutation.error} overrides={{ VALIDATION_FAILED: t('checksFailed') }} />
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-900">
          {t('savedAsDraft', { n: saved.version })}
        </p>
      )}
    </form>
  );
}
