'use client';

import { getVersionLinks, type DraftRef, type IdeaRef } from '@coal/shared';
import { FileText, FolderPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PdfFrame } from '@/components/chat/template-detail';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useProductLines } from '@/lib/queries';

/** The PDF of one version of a document, for the right-hand pane. */
export function DraftPdf({ draft }: { draft: DraftRef }) {
  return (
    <PdfFrame
      cacheKey={`draft:${draft.documentId}:${draft.versionNo}`}
      title={draft.title}
      getUrl={async () =>
        (await api(getVersionLinks, { params: { id: draft.documentId, n: draft.versionNo } })).pdf
          ?.url ?? null
      }
    />
  );
}

/** A draft the assistant saved: what it is, what is still missing, and a way to read and edit it. */
export function DraftCard({ draft, onPreview }: { draft: DraftRef; onPreview: () => void }) {
  const t = useTranslations('workstation.draft');
  return (
    <section
      aria-label={t('label')}
      className="grid gap-2 rounded-xl border bg-card p-4 text-sm shadow-xs"
    >
      <header className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('label')}
          </span>
          <h4 className="font-medium">{draft.title}</h4>
          <span className="text-xs text-muted-foreground">
            {t('version', { no: draft.versionNo })}
          </span>
        </div>
      </header>
      {draft.gaps.length > 0 && (
        <p className="rounded-md bg-warning px-2 py-1 text-warning-foreground">
          {t('gaps', { list: draft.gaps.join(', ') })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      <footer className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onPreview} variant="outline">
          {t('preview')}
        </Button>
        <Button size="sm" asChild>
          <Link href={`/projects/${draft.projectId}/documents/${draft.documentId}`}>
            {t('open')}
          </Link>
        </Button>
      </footer>
    </section>
  );
}

/** The address of the new-project page with this idea filled in. */
export function goHref(idea: IdeaRef): string {
  const params = new URLSearchParams({
    name: idea.name,
    description: idea.description,
    productLineId: idea.productLineId,
  });
  if (idea.teamUserIds.length > 0) params.set('team', idea.teamUserIds.join(','));
  return `/projects/new?${params.toString()}`;
}

/**
 * An idea the assistant worked out as a project: the concept, and one box for each person who would
 * get work. Creating it (Go) is the person's own act on the new-project page, filled in from here.
 */
export function IdeaCard({ idea }: { idea: IdeaRef }) {
  const t = useTranslations('workstation.idea');
  const lines = useProductLines();
  const line = lines.data?.find((l) => l.id === idea.productLineId);

  // One box for each person (or waiting queue) with the work they would get.
  const boxes = new Map<string, { who: string; work: string[] }>();
  for (const task of idea.preview.tasks) {
    const who = task.assignee?.name ?? task.queueRole?.name ?? t('nobody');
    const box = boxes.get(who) ?? { who, work: [] };
    box.work.push(task.stepKey ? `${task.stepKey} · ${task.title}` : task.title);
    boxes.set(who, box);
  }

  return (
    <section
      aria-label={t('label')}
      className="grid gap-3 rounded-xl border bg-card p-4 text-sm shadow-xs"
    >
      <header className="flex items-start gap-2">
        <FolderPlus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('label')}
          </span>
          <h4 className="font-medium">{idea.name}</h4>
          {line && <span className="text-xs text-muted-foreground">{line.name}</span>}
        </div>
      </header>
      {idea.description && <p className="whitespace-pre-line">{idea.description}</p>}
      <div className="grid gap-2">
        <h5 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('whoGetsWhat')}
        </h5>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[...boxes.values()].map((box) => (
            <li key={box.who} className="grid gap-0.5 rounded-lg border bg-muted/40 p-3">
              <span className="font-medium">{box.who}</span>
              <ul className="grid gap-0.5 text-xs text-muted-foreground">
                {box.work.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {idea.preview.warnings.map((w) => (
          <p key={w} className="rounded-md bg-warning px-2 py-1 text-warning-foreground">
            {w}
          </p>
        ))}
      </div>
      <footer className="flex flex-wrap items-center gap-2">
        <Button size="sm" asChild>
          <Link href={goHref(idea)}>{t('review')}</Link>
        </Button>
        <span className="text-xs text-muted-foreground">{t('note')}</span>
      </footer>
    </section>
  );
}
