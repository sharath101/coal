'use client';

import { commentDeviation, reviewDeviation, type Deviation } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  DeviationFields,
  draftBody,
  draftComplete,
  type DeviationDraft,
} from '@/components/deviation-fields';
import { ProblemMessage } from '@/components/problem-message';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useDeviations, useRefreshProject } from '@/lib/queries';

/** The cause as the viewer may see it: the name only when allowed, otherwise the role. */
export function useCauseText() {
  const t = useTranslations('deviation');
  return (cause: Deviation['cause']): string => {
    if (cause.named && cause.name) return cause.name;
    if (cause.role) return cause.role.name;
    return t('outsideParty');
  };
}

function draftOf(d: Deviation): DeviationDraft {
  return {
    reasonCode: d.reasonCode,
    reasonText: d.reasonText ?? '',
    causeType: d.cause.type,
    causeUserId: '',
    causeRole: d.cause.type === 'role' ? (d.cause.role?.key ?? '') : '',
    causeParty: d.cause.type === 'outside' && d.cause.named ? (d.cause.name ?? '') : '',
    newDate: d.newDate ?? '',
  };
}

function DeviationItem({ deviation: d, projectId }: { deviation: Deviation; projectId: string }) {
  const t = useTranslations('deviation');
  const causeText = useCauseText();
  const id = useId();
  const refresh = useRefreshProject(projectId);
  const [mode, setMode] = useState<'confirm' | 'correct' | null>(null);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(() => draftOf(d));
  const [comment, setComment] = useState('');

  const closeForm = () => {
    setMode(null);
    setNote('');
  };
  const review = useMutation({
    mutationFn: () =>
      api(reviewDeviation, {
        params: { id: d.id },
        body:
          mode === 'correct'
            ? { outcome: 'corrected', note: note.trim(), ...draftBody(draft) }
            : { outcome: 'confirmed', note: note.trim() },
      }),
    onSuccess: () => {
      closeForm();
      void refresh();
    },
  });
  const addComment = useMutation({
    mutationFn: () =>
      api(commentDeviation, { params: { id: d.id }, body: { body: comment.trim() } }),
    onSuccess: () => {
      setComment('');
      void refresh();
    },
  });

  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {d.stepKey ? t('stepTitle', { step: d.stepKey }) : t('noStep')}
        </span>
        {d.taskTitle && <span className="text-muted-foreground">· {d.taskTitle}</span>}
        <Pill tone="waiting">{t(`reasons.${d.reasonCode}`)}</Pill>
        <span className="ml-auto flex gap-1">
          {d.correctedBy && <Pill tone="neutral">{t('replaced')}</Pill>}
          {d.corrects && <Pill tone="neutral">{t('correction')}</Pill>}
          {d.review ? (
            <Pill tone="good">{t(`outcome.${d.review.outcome}`)}</Pill>
          ) : (
            <Pill tone="waiting">{t('waitingReview')}</Pill>
          )}
        </span>
      </div>
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">{t('dates')}</dt>
        <dd>
          {d.plannedDate ? formatDate(d.plannedDate) : t('noDate')} →{' '}
          {d.newDate ? formatDate(d.newDate) : t('noDate')}
        </dd>
        <dt className="text-muted-foreground">{t('cause')}</dt>
        <dd>
          {causeText(d.cause)}
          <span className="text-muted-foreground"> · {t(`causeTypes.${d.cause.type}`)}</span>
        </dd>
        {d.reasonText && (
          <>
            <dt className="text-muted-foreground">{t('explanationShort')}</dt>
            <dd>{d.reasonText}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('recordedBy')}</dt>
        <dd>{t('recordedLine', { name: d.recordedBy.name, when: formatDateTime(d.createdAt) })}</dd>
        {d.review && (
          <>
            <dt className="text-muted-foreground">{t('reviewedBy')}</dt>
            <dd>
              {t('recordedLine', {
                name: d.review.reviewer.name,
                when: formatDateTime(d.review.at),
              })}
              {d.review.note && (
                <span className="text-muted-foreground">
                  {' '}
                  · {t('quoted', { text: d.review.note })}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>

      {d.comments.length > 0 && (
        <ul className="grid gap-1 border-t pt-2">
          {d.comments.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.user.name}</span>
              <span className="text-muted-foreground"> · {formatDateTime(c.at)}</span>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {d.can.comment && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addComment.mutate();
          }}
        >
          <div className="grid min-w-48 flex-1 gap-1">
            <Label htmlFor={`${id}-comment`} className="text-xs text-muted-foreground">
              {t('comment')}
            </Label>
            <Input
              id={`${id}-comment`}
              required
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={addComment.isPending || !comment.trim()}
          >
            {t('addComment')}
          </Button>
        </form>
      )}
      <ProblemMessage error={addComment.error} />

      {d.can.review && !mode && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode('confirm')}>
            {t('confirm')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('correct')}>
            {t('correct')}
          </Button>
        </div>
      )}
      {d.can.review && mode && (
        <form
          className="grid gap-3 rounded-md border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            review.mutate();
          }}
        >
          {mode === 'correct' && (
            <DeviationFields idPrefix={`${id}-fix`} draft={draft} onChange={setDraft} />
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-note`}>{t('note')}</Label>
            <Textarea
              id={`${id}-note`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ProblemMessage error={review.error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={review.isPending || (mode === 'correct' && !draftComplete(draft))}
            >
              {mode === 'correct' ? t('saveCorrection') : t('confirm')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeForm}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/** A project's deviations: why work was late, who caused it, and whether the next role up has confirmed. */
export function DeviationsPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('deviation');
  const list = useDeviations(projectId);
  return (
    <section className="grid gap-3" aria-labelledby="deviations-heading">
      <h3
        id="deviations-heading"
        className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
      >
        {t('heading')}
      </h3>
      <ProblemMessage error={list.error} />
      {list.isSuccess && list.data.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('none')}
        </p>
      )}
      <ul className="grid gap-2">
        {(list.data ?? []).map((d) => (
          <DeviationItem key={d.id} deviation={d} projectId={projectId} />
        ))}
      </ul>
    </section>
  );
}
