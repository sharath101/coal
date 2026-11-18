'use client';

import { dropProject, holdProject, resumeProject, type ProjectDetail } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

type Kind = 'hold' | 'resume' | 'drop';
const ENDPOINT = { hold: holdProject, resume: resumeProject, drop: dropProject } as const;

/** Hold, resume and drop, each with a reason (docs/workflow.md#hold-and-drop). */
export function ProjectActions({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: () => void;
}) {
  const t = useTranslations('project');
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: (k: Kind) => api(ENDPOINT[k], { params: { id: project.id }, body: { reason } }),
    onSuccess: () => {
      setKind(null);
      setReason('');
      onChanged();
    },
  });

  const kinds = (['hold', 'resume', 'drop'] as const).filter((k) => project.can[k]);
  if (kinds.length === 0) return null;
  const confirmLabel = {
    hold: 'confirmHold',
    resume: 'confirmResume',
    drop: 'confirmDrop',
  } as const;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={k === 'drop' ? 'destructive' : 'outline'}
            onClick={() => {
              mutation.reset();
              setKind(k);
            }}
          >
            {t(k)}
          </Button>
        ))}
      </div>
      {kind && (
        <form
          className="grid max-w-xl gap-2 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(kind);
          }}
        >
          {kind === 'drop' && <p className="text-sm text-muted-foreground">{t('dropWarning')}</p>}
          <Label htmlFor="run-reason">{t('reason')}</Label>
          <Textarea
            id="run-reason"
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <ProblemMessage error={mutation.error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={kind === 'drop' ? 'destructive' : 'default'}
              disabled={mutation.isPending || reason.trim().length < 3}
            >
              {t(confirmLabel[kind])}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setKind(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
