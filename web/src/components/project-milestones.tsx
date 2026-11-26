'use client';

import {
  addMilestone,
  reachMilestone,
  removeMilestone,
  updateMilestone,
  type MilestoneInput,
  type ProjectDetail,
  type ProjectMilestone,
} from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClass } from '@/components/ui/select-class';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDate, todayIst } from '@/lib/format';

type Status = ProjectMilestone['status'];

const TONE = {
  reached: 'good',
  late: 'bad',
  at_risk: 'waiting',
  on_track: 'active',
  no_date: 'neutral',
} as const satisfies Record<Status, string>;

/** Reached, late (by how much), at risk, on track, or no date. */
export function MilestoneStatusBadge({ status, daysLate }: { status: Status; daysLate: number }) {
  const t = useTranslations('milestones.status');
  return <Pill tone={TONE[status]}>{t(status, { days: daysLate })}</Pill>;
}

/** A milestone being written: a step of the route, or your own words, and maybe a target date. */
export interface MilestoneDraft {
  kind: 'step' | 'own';
  stepKey: string;
  title: string;
  targetDate: string;
}

export const emptyDraft = (): MilestoneDraft => ({
  kind: 'step',
  stepKey: '',
  title: '',
  targetDate: '',
});

export const draftComplete = (d: MilestoneDraft) =>
  d.kind === 'step' ? d.stepKey !== '' : d.title.trim().length >= 2;

export const toMilestoneInput = (d: MilestoneDraft): MilestoneInput => ({
  ...(d.kind === 'step' ? { stepKey: d.stepKey } : { title: d.title.trim() }),
  ...(d.targetDate && { targetDate: d.targetDate }),
});

export interface StepChoice {
  key: string;
  name: string;
  stage: number;
}

/** The fields of one new milestone. Steps are grouped by stage; steps already chosen are left out. */
export function MilestoneFields({
  idPrefix,
  draft,
  onChange,
  stages,
  steps,
}: {
  idPrefix: string;
  draft: MilestoneDraft;
  onChange: (draft: MilestoneDraft) => void;
  stages: readonly { no: number; name: string }[];
  steps: readonly StepChoice[];
}) {
  const t = useTranslations('milestones');
  const set = <K extends keyof MilestoneDraft>(key: K, value: MilestoneDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
      <div className="grid gap-2">
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="sr-only">{t('kind')}</legend>
          {(['step', 'own'] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${idPrefix}-kind`}
                checked={draft.kind === kind}
                onChange={() => set('kind', kind)}
              />
              {kind === 'step' ? t('kindStep') : t('kindOwn')}
            </label>
          ))}
        </fieldset>
        {draft.kind === 'step' ? (
          <select
            id={`${idPrefix}-step`}
            aria-label={t('step')}
            className={selectClass}
            value={draft.stepKey}
            onChange={(e) => set('stepKey', e.target.value)}
          >
            <option value="" disabled>
              {t('chooseStep')}
            </option>
            {stages.map((stage) => {
              const inStage = steps.filter((s) => s.stage === stage.no);
              if (inStage.length === 0) return null;
              return (
                <optgroup key={stage.no} label={t('stage', { no: stage.no, name: stage.name })}>
                  {inStage.map((s) => (
                    <option key={s.key} value={s.key}>
                      {t('stepOption', { key: s.key, name: s.name })}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        ) : (
          <Input
            id={`${idPrefix}-title`}
            aria-label={t('ownTitle')}
            placeholder={t('ownPlaceholder')}
            minLength={2}
            maxLength={120}
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
          />
        )}
      </div>
      <div className="grid content-end gap-2">
        <Label htmlFor={`${idPrefix}-date`}>{t('target')}</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          min={todayIst()}
          value={draft.targetDate}
          onChange={(e) => set('targetDate', e.target.value)}
        />
      </div>
    </div>
  );
}

type Ask = { kind: 'remove' | 'reach' | 'unreach'; milestone: ProjectMilestone };

/**
 * The project's milestones: the targets the VP set for it (docs/dashboard.md#milestones). The VP and
 * the R&D Head add, change and remove them, and tick off those in their own words; a step's
 * milestone is reached when the step is signed off.
 */
export function ProjectMilestones({
  project,
  stages,
  steps,
  onChanged,
}: {
  project: ProjectDetail;
  stages: readonly { no: number; name: string }[];
  /** The steps that can still be a milestone: not finished, and not one already. */
  steps: readonly StepChoice[];
  onChanged: () => void;
}) {
  const t = useTranslations('milestones');
  const tConfirm = useTranslations('milestones.confirm');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<MilestoneDraft>(emptyDraft);
  const [editing, setEditing] = useState<{ id: string; title: string; targetDate: string } | null>(
    null,
  );
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState('');
  const id = project.id;
  const taken = new Set(project.milestones.flatMap((m) => (m.stepKey ? [m.stepKey] : [])));
  const choices = steps.filter((s) => !taken.has(s.key));

  const done = () => {
    setAdding(false);
    setDraft(emptyDraft());
    setEditing(null);
    setAsk(null);
    setNote('');
    onChanged();
  };
  const add = useMutation({
    mutationFn: () => api(addMilestone, { params: { id }, body: toMilestoneInput(draft) }),
    onSuccess: done,
  });
  const save = useMutation({
    mutationFn: (e: { id: string; title?: string; targetDate: string | null }) =>
      api(updateMilestone, {
        params: { id, milestoneId: e.id },
        body: {
          ...(e.title !== undefined && { title: e.title }),
          targetDate: e.targetDate,
        },
      }),
    onSuccess: done,
  });
  const confirm = useMutation({
    mutationFn: (a: Ask) =>
      a.kind === 'remove'
        ? api(removeMilestone, { params: { id, milestoneId: a.milestone.id } })
        : api(reachMilestone, {
            params: { id, milestoneId: a.milestone.id },
            body: {
              reached: a.kind === 'reach',
              ...(a.kind === 'reach' && note.trim() && { note: note.trim() }),
            },
          }),
    onSuccess: done,
  });

  const can = project.can;
  return (
    <section className="grid gap-3" aria-labelledby="milestones-heading">
      <div className="flex items-center justify-between">
        <h2
          id="milestones-heading"
          className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
        >
          {t('title')}
        </h2>
        {can.editMilestones && !adding && (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        )}
      </div>

      {project.milestones.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          {can.editMilestones ? t('noneEditor') : t('none')}
        </p>
      )}

      {project.milestones.length > 0 && (
        <ul className="grid gap-2">
          {project.milestones.map((m) => (
            <li key={m.id} className="grid gap-1.5 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.stepKey ? t('followsStep', { key: m.stepKey }) : t('ownWords')}
                  </span>
                </div>
                <MilestoneStatusBadge status={m.status} daysLate={m.daysLate} />
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">{t('targetLabel')}</dt>
                  <dd>{m.targetDate ? formatDate(m.targetDate) : t('noTarget')}</dd>
                </div>
                {m.forecastDate && (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('forecastLabel')}</dt>
                    <dd>{formatDate(m.forecastDate)}</dd>
                  </div>
                )}
                {m.reachedOn && (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('reachedLabel')}</dt>
                    <dd>
                      {m.reachedBy
                        ? t('reachedBy', { date: formatDate(m.reachedOn), name: m.reachedBy.name })
                        : formatDate(m.reachedOn)}
                    </dd>
                  </div>
                )}
              </dl>
              {m.note && <p className="text-xs">{m.note}</p>}

              {editing?.id === m.id ? (
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate({
                      id: m.id,
                      ...(m.kind === 'own' && { title: editing.title.trim() }),
                      targetDate: editing.targetDate || null,
                    });
                  }}
                >
                  {m.kind === 'own' && (
                    <Input
                      aria-label={t('ownTitle')}
                      minLength={2}
                      maxLength={120}
                      required
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                  )}
                  <div className="grid gap-1">
                    <Label htmlFor={`milestone-${m.id}-date`}>{t('target')}</Label>
                    <Input
                      id={`milestone-${m.id}-date`}
                      type="date"
                      min={todayIst()}
                      value={editing.targetDate}
                      onChange={(e) => setEditing({ ...editing, targetDate: e.target.value })}
                    />
                  </div>
                  <ProblemMessage error={save.error} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={save.isPending}>
                      {t('save')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </form>
              ) : (
                (can.editMilestones || (can.reachMilestones && m.kind === 'own')) && (
                  <div className="flex flex-wrap gap-2">
                    {can.reachMilestones && m.kind === 'own' && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          setAsk({
                            kind: m.status === 'reached' ? 'unreach' : 'reach',
                            milestone: m,
                          })
                        }
                      >
                        {m.status === 'reached' ? t('markNotReached') : t('markReached')}
                      </Button>
                    )}
                    {can.editMilestones && m.status !== 'reached' && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          setEditing({ id: m.id, title: m.title, targetDate: m.targetDate ?? '' })
                        }
                      >
                        {t('edit')}
                      </Button>
                    )}
                    {can.editMilestones && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setAsk({ kind: 'remove', milestone: m })}
                      >
                        {t('remove')}
                      </Button>
                    )}
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          className="grid gap-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <MilestoneFields
            idPrefix="new-milestone"
            draft={draft}
            onChange={setDraft}
            stages={stages}
            steps={choices}
          />
          <ProblemMessage error={add.error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={add.isPending || !draftComplete(draft)}>
              {t('addSubmit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraft(emptyDraft());
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {ask && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAsk(null);
              setNote('');
            }
          }}
          title={tConfirm(`${ask.kind}Title`, { title: ask.milestone.title })}
          text={tConfirm(`${ask.kind}Text`)}
          confirmLabel={tConfirm(`${ask.kind}Yes`)}
          destructive={ask.kind === 'remove'}
          pending={confirm.isPending}
          error={confirm.error}
          onConfirm={() => confirm.mutate(ask)}
        >
          {ask.kind === 'reach' && (
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-note">{tConfirm('note')}</Label>
              <Textarea
                id="milestone-note"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
