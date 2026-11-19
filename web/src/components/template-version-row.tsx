'use client';

import { activateTemplate, getTemplateLinks, type TemplateSummary } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { TemplateStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useOpenLink } from '@/lib/open-link';
import { queryKeys } from '@/lib/queries';

/** One version of a template: its state, who added and activated it, its files, and Make active. */
export function TemplateVersionRow({ template }: { template: TemplateSummary }) {
  const t = useTranslations('templates');
  const queryClient = useQueryClient();
  const link = useOpenLink();
  const [confirming, setConfirming] = useState(false);
  const params = { id: template.id };

  const activate = useMutation({
    mutationFn: () => api(activateTemplate, { params }),
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.documentTypes }),
      ]);
    },
  });

  const open = (which: 'sample' | 'docx') =>
    link.open(async () => (await api(getTemplateLinks, { params }))[which]?.url ?? null, {
      pdf: which === 'sample',
    });

  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <TemplateStatusBadge status={template.status} />
            <span className="font-medium">{t('version', { n: template.version })}</span>
            <span className="text-muted-foreground">· {template.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('stepsOf', { count: template.steps.length, steps: template.steps.join(', ') })}
            {' · '}
            {t('addedBy', { name: template.addedBy.name, when: formatDateTime(template.addedAt) })}
            {template.activatedBy && template.activatedAt && (
              <>
                {' · '}
                {t('activatedBy', {
                  name: template.activatedBy.name,
                  when: formatDateTime(template.activatedAt),
                })}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.hasSample && (
            <Button
              size="sm"
              variant="outline"
              disabled={link.pending}
              onClick={() => open('sample')}
            >
              {t('samplePdf')}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={link.pending} onClick={() => open('docx')}>
            {t('wordFile')}
          </Button>
          {template.status !== 'active' && !confirming && (
            <Button
              size="sm"
              onClick={() => {
                activate.reset();
                setConfirming(true);
              }}
            >
              {template.status === 'retired' ? t('makeActiveAgain') : t('makeActive')}
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          <p>{t('activateExplain', { n: template.version, type: template.documentType.name })}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={activate.isPending} onClick={() => activate.mutate()}>
              {t('confirmActivate', { n: template.version })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
      <ProblemMessage error={activate.error ?? link.error} />
    </li>
  );
}
