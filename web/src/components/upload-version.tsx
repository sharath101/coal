'use client';

import { saveVersion, type DocumentDetail } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { ACCEPT_ALL, uploadFile } from '@/lib/upload';

/** An uploaded document has no form: a new version is a new file. */
export function UploadVersion({
  doc,
  onChanged,
}: {
  doc: DocumentDetail;
  onChanged: (doc: DocumentDetail) => void;
}) {
  const t = useTranslations('document');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const upload = useMutation({
    mutationFn: async (chosen: File) => {
      const stored = await uploadFile(chosen);
      return api(saveVersion, { params: { id: doc.id }, body: { fileId: stored.id, note } });
    },
    onSuccess: (updated) => {
      setFile(null);
      setNote('');
      setInputKey((k) => k + 1);
      onChanged(updated);
    },
  });

  return (
    <form
      className="grid gap-3 rounded-lg border bg-muted/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) upload.mutate(file);
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="new-version-file">{t('uploadNewVersion')}</Label>
        <Input
          key={inputKey}
          id="new-version-file"
          type="file"
          accept={ACCEPT_ALL}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-version-note">{t('note')}</Label>
        <Input
          id="new-version-note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <p className="text-muted-foreground">{t('savingMakesNew')}</p>
      <ProblemMessage error={upload.error} />
      <div>
        <Button type="submit" size="sm" disabled={!file || upload.isPending}>
          {upload.isPending ? t('saving') : t('uploadSave')}
        </Button>
      </div>
    </form>
  );
}
