'use client';

import {
  createAttachment,
  createSource,
  type AttachmentView,
  type SourceView,
  SOURCE_KINDS,
} from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Link2, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FileLinkButton } from '@/components/file-link-button';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/role-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, formatSize } from '@/lib/format';
import { queryKeys, useAttachments, useSources } from '@/lib/queries';
import { ACCEPT_ALL, ACCEPT_IMAGES, uploadFile } from '@/lib/upload';

/** What the attachments and sources belong to: a step, one document, or (sources only) the whole project. */
export type ItemTarget = { stepKey: string } | { documentId: string };
export type Target = ItemTarget | { project: true };

const belongsTo = (
  row: { target: { stepKey: string | null; documentId: string | null; taskId: string | null } },
  target: Target,
) =>
  'project' in target
    ? !row.target.stepKey && !row.target.documentId && !row.target.taskId
    : 'documentId' in target
      ? row.target.documentId === target.documentId
      : row.target.stepKey === target.stepKey && !row.target.documentId && !row.target.taskId;

const KIND_ICON = { link: Link2, citation: BookOpen, file: Paperclip } as const;

type Mode = 'attach' | 'source' | null;

/**
 * A compact list of what is attached to a step or a document, and how the work is sourced, with
 * ways to add either. The project's attachments and sources are each loaded once and filtered here.
 */
export function AttachmentsAndSources({
  projectId,
  target,
  defaultOpen = false,
}: {
  projectId: string;
  target: ItemTarget;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('attachments');
  const attachments = useAttachments(projectId);
  const sources = useSources(projectId);
  const [mode, setMode] = useState<Mode>(null);

  const attached = (attachments.data ?? []).filter((a) => belongsTo(a, target));
  const sourced = (sources.data ?? []).filter((s) => belongsTo(s, target));
  const count = attached.length + sourced.length;

  return (
    <details open={defaultOpen} className="rounded-md border bg-muted/20 text-sm">
      <summary className="cursor-pointer list-none p-2 font-medium">
        {t('title')}
        <span className="font-normal text-muted-foreground"> · {t('count', { count })}</span>
      </summary>
      <div className="grid gap-3 border-t p-3">
        <ProblemMessage error={attachments.error ?? sources.error} />
        {attachments.isSuccess && sources.isSuccess && count === 0 && (
          <p className="text-muted-foreground">{t('none')}</p>
        )}
        {attached.length > 0 && (
          <ul className="grid gap-1.5">
            {attached.map((a) => (
              <AttachmentItem key={a.id} attachment={a} />
            ))}
          </ul>
        )}
        {sourced.length > 0 && (
          <ul className="grid gap-1.5">
            {sourced.map((s) => (
              <SourceItem key={s.id} source={s} />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={mode === 'attach'}
            onClick={() => setMode(mode === 'attach' ? null : 'attach')}
          >
            {t('attach')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-expanded={mode === 'source'}
            onClick={() => setMode(mode === 'source' ? null : 'source')}
          >
            {t('addSource')}
          </Button>
        </div>
        {mode === 'attach' && (
          <AttachForm projectId={projectId} target={target} onDone={() => setMode(null)} />
        )}
        {mode === 'source' && (
          <SourceForm projectId={projectId} target={target} onDone={() => setMode(null)} />
        )}
      </div>
    </details>
  );
}

/**
 * The sources of the whole project (docs/documents-and-signing.md#files-pictures-and-sources): what
 * research and people found about it, kept where everyone working on it can read them, and where the
 * assistant looks at any point. Sources of a step or a document are on that step or document.
 */
export function ProjectSources({ projectId }: { projectId: string }) {
  const t = useTranslations('attachments');
  const sources = useSources(projectId);
  const [adding, setAdding] = useState(false);
  const target: Target = { project: true };
  const whole = (sources.data ?? []).filter((s) => belongsTo(s, target));
  const onSteps = (sources.data ?? []).length - whole.length;

  return (
    <section className="grid gap-3" aria-labelledby="project-sources">
      <h2
        id="project-sources"
        className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
      >
        {t('projectTitle')}
      </h2>
      <ProblemMessage error={sources.error} />
      {sources.isSuccess && whole.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('projectNone')}</p>
      )}
      {whole.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {whole.map((s) => (
            <SourceItem key={s.id} source={s} />
          ))}
        </ul>
      )}
      {onSteps > 0 && (
        <p className="text-xs text-muted-foreground">{t('projectOnSteps', { count: onSteps })}</p>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          {t('addSource')}
        </Button>
      </div>
      {adding && (
        <SourceForm projectId={projectId} target={target} onDone={() => setAdding(false)} />
      )}
    </section>
  );
}

function AttachmentItem({ attachment }: { attachment: AttachmentView }) {
  const t = useTranslations('attachments');
  return (
    <li className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <FileLinkButton fileId={attachment.file.id} name={attachment.file.name} />
        <span className="text-xs text-muted-foreground">{formatSize(attachment.file.size)}</span>
      </span>
      {attachment.caption && <span className="pl-5.5">{attachment.caption}</span>}
      <span className="pl-5.5 text-xs text-muted-foreground">
        {t('by', { name: attachment.addedBy.name, when: formatDateTime(attachment.addedAt) })}
      </span>
    </li>
  );
}

function SourceItem({ source }: { source: SourceView }) {
  const t = useTranslations('attachments');
  const Icon = KIND_ICON[source.kind];
  return (
    <li className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Icon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label={t(`kind_${source.kind}`)}
        />
        {source.kind === 'link' && source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 hover:underline"
          >
            {source.title}
          </a>
        ) : source.kind === 'file' && source.file ? (
          <FileLinkButton fileId={source.file.id} name={source.title} />
        ) : (
          <span className="font-medium">{source.title}</span>
        )}
      </span>
      {source.note && <span className="pl-5.5">{source.note}</span>}
      <span className="pl-5.5 text-xs text-muted-foreground">
        {t(source.researchResultId ? 'keptBy' : 'by', {
          name: source.addedBy.name,
          when: formatDateTime(source.addedAt),
        })}
      </span>
    </li>
  );
}

const targetBody = (target: Target) =>
  'project' in target
    ? {}
    : 'documentId' in target
      ? { documentId: target.documentId }
      : { stepKey: target.stepKey };

const targetKey = (target: Target) =>
  'project' in target ? 'project' : 'documentId' in target ? target.documentId : target.stepKey;

function AttachForm({
  projectId,
  target,
  onDone,
}: {
  projectId: string;
  target: ItemTarget;
  onDone: () => void;
}) {
  const t = useTranslations('attachments');
  const queryClient = useQueryClient();
  const camera = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const key = 'documentId' in target ? target.documentId : target.stepKey;

  const mutation = useMutation({
    mutationFn: async (chosen: File) => {
      const stored = await uploadFile(chosen);
      return api(createAttachment, {
        params: { id: projectId },
        body: { ...targetBody(target), fileId: stored.id, caption },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.attachments(projectId) });
      onDone();
    },
  });

  return (
    <form
      className="grid gap-3 rounded-md border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) mutation.mutate(file);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`attach-file-${key}`}>{t('file')}</Label>
        <Input
          id={`attach-file-${key}`}
          type="file"
          accept={ACCEPT_ALL}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={camera}
          type="file"
          accept={ACCEPT_IMAGES}
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('takePhoto')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div>
          <Button type="button" size="xs" variant="outline" onClick={() => camera.current?.click()}>
            {t('takePhoto')}
          </Button>
        </div>
        {file && (
          <p className="text-muted-foreground">
            {t('chosen', { name: file.name, size: formatSize(file.size) })}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`attach-caption-${key}`}>{t('caption')}</Label>
        <Input
          id={`attach-caption-${key}`}
          maxLength={300}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>
      <ProblemMessage error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!file || mutation.isPending}>
          {mutation.isPending ? t('attaching') : t('attachSubmit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function SourceForm({
  projectId,
  target,
  onDone,
}: {
  projectId: string;
  target: Target;
  onDone: () => void;
}) {
  const t = useTranslations('attachments');
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<(typeof SOURCE_KINDS)[number]>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const key = targetKey(target);

  const mutation = useMutation({
    mutationFn: async () => {
      const fileId = kind === 'file' && file ? (await uploadFile(file)).id : undefined;
      return api(createSource, {
        params: { id: projectId },
        body: {
          ...targetBody(target),
          kind,
          title,
          note,
          ...(kind === 'link' && { url }),
          ...(fileId && { fileId }),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sources(projectId) });
      onDone();
    },
  });
  const ready =
    title.trim().length >= 2 &&
    (kind !== 'link' || url.trim() !== '') &&
    (kind !== 'file' || !!file);

  return (
    <form
      className="grid gap-3 rounded-md border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`source-kind-${key}`}>{t('sourceKind')}</Label>
        <select
          id={`source-kind-${key}`}
          className={selectClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind_${k}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`source-title-${key}`}>{t('sourceTitle')}</Label>
        <Input
          id={`source-title-${key}`}
          required
          minLength={2}
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {kind === 'link' && (
        <div className="grid gap-2">
          <Label htmlFor={`source-url-${key}`}>{t('sourceUrl')}</Label>
          <Input
            id={`source-url-${key}`}
            type="url"
            required
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      )}
      {kind === 'file' && (
        <div className="grid gap-2">
          <Label htmlFor={`source-file-${key}`}>{t('file')}</Label>
          <Input
            id={`source-file-${key}`}
            type="file"
            accept={ACCEPT_ALL}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor={`source-note-${key}`}>{t('sourceNote')}</Label>
        <Textarea
          id={`source-note-${key}`}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <ProblemMessage error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || mutation.isPending}>
          {mutation.isPending ? t('attaching') : t('sourceSubmit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
