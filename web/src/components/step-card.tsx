'use client';

import {
  approveStep,
  createCorrectiveAction,
  decideStep,
  returnStep,
  sendBackStep,
  startStep,
  submitStep,
  type ActionResult,
  type DocumentSummary,
  type RouteView,
  type StepView,
} from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useConditionText } from '@/components/condition-text';
import { RecordDeviationDialog } from '@/components/deviation-dialog';
import { StepHealthBadge } from '@/components/health-badge';
import { PreviewPanel } from '@/components/preview-panel';
import { ProblemMessage } from '@/components/problem-message';
import { StepStatusBadge } from '@/components/status-badge';
import { StepDocuments } from '@/components/step-documents';
import { selectClass } from '@/components/role-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { isDeviationRequired } from '@/lib/deviation';
import { formatDate, formatTime } from '@/lib/format';
import { useMe, useStepDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';

const OPEN = ['ready', 'in_progress', 'in_review', 'returned'];
const OPEN_TASK = ['open', 'in_progress', 'waiting'];

type Panel = 'return' | 'sendBack' | 'corrective' | null;

interface Props {
  projectId: string;
  step: StepView;
  route: RouteView;
  documents: DocumentSummary[];
  /** Opened and scrolled to, when a widget row or a link points at this step. */
  focused?: boolean;
  onChanged: () => void;
}

export function StepCard({ projectId, step, route, documents, focused = false, onChanged }: Props) {
  const t = useTranslations('step');
  const conditionText = useConditionText(route);
  const me = useMe();
  const params = { id: projectId, key: step.key };
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState(step.actions.sendBack[0] ?? '');
  const [preview, setPreview] = useState<ActionResult | null>(null);
  const [deviationFor, setDeviationFor] = useState<'banner' | 'submit' | null>(null);
  const card = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  const done = () => {
    setPanel(null);
    setText('');
    setPreview(null);
    onChanged();
  };
  const start = useMutation({ mutationFn: () => api(startStep, { params }), onSuccess: done });
  const submit = useMutation({
    mutationFn: () => api(submitStep, { params }),
    onSuccess: done,
    // A late step can't go on until someone says why: ask now, then try again.
    onError: (error) => {
      if (isDeviationRequired(error)) setDeviationFor('submit');
    },
  });
  const approve = useMutation({ mutationFn: () => api(approveStep, { params }), onSuccess: done });
  const giveBack = useMutation({
    mutationFn: () => api(returnStep, { params, body: { comment: text } }),
    onSuccess: done,
  });
  const decide = useMutation({
    mutationFn: (input: { decision: string; value: string }) =>
      api(decideStep, { params, body: input }),
    onSuccess: done,
  });
  const sendBackBody = { to: target, reason: text };
  const previewSendBack = useMutation({
    mutationFn: () => api(sendBackStep, { params, query: { preview: 'true' }, body: sendBackBody }),
    onSuccess: setPreview,
  });
  const sendBack = useMutation({
    mutationFn: () => api(sendBackStep, { params, body: sendBackBody }),
    onSuccess: done,
  });
  const corrective = useMutation({
    mutationFn: () =>
      api(createCorrectiveAction, { params: { id: projectId }, body: { title: text, body: '' } }),
    onSuccess: done,
  });

  const mutations = [
    start,
    submit,
    approve,
    giveBack,
    decide,
    previewSendBack,
    sendBack,
    corrective,
  ];
  const error = mutations.map((m) => m.error).find(Boolean);
  const busy = mutations.some((m) => m.isPending);
  const a = step.actions;
  const isOpen = OPEN.includes(step.status);
  const needs = [...(step.status === 'in_review' ? step.approveNeeds : step.submitNeeds)];
  const stepName = (key: string) => route.steps.find((s) => s.key === key)?.name ?? key;
  const hasButtons =
    a.start || a.submit || a.approve || a.return || a.sendBack.length > 0 || a.correctiveActions;

  // Whose reason it is: the step's open work tasks, mine first. The API refuses anyone who may not.
  const openTasks = step.tasks.filter((task) => OPEN_TASK.includes(task.status));
  const workTasks = openTasks.filter((task) => task.kind === 'work');
  const deviationTasks = (workTasks.length > 0 ? workTasks : openTasks)
    .toSorted(
      (x, y) => Number(y.assignee?.id === me.data?.id) - Number(x.assignee?.id === me.data?.id),
    )
    .map((task) => ({ id: task.id, title: task.title }));

  return (
    <li
      ref={card}
      id={`step-${step.key}`}
      className={cn(
        'rounded-lg border bg-card text-sm',
        step.health === 'overdue' && 'border-red-500 ring-2 ring-red-500/60',
        step.health === 'at_risk' && 'border-amber-400 ring-2 ring-amber-400/60',
        focused && step.health !== 'overdue' && step.health !== 'at_risk' && 'ring-2 ring-ring',
      )}
    >
      {step.needsDeviation && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-t-lg border-b border-red-200 bg-red-50 p-3 text-red-950"
        >
          <p className="min-w-0 flex-1">{t('needsDeviation', { count: step.daysLate })}</p>
          <Button size="sm" variant="destructive" onClick={() => setDeviationFor('banner')}>
            {t('recordWhy')}
          </Button>
        </div>
      )}
      <details open={isOpen || focused} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold">
            {step.key}
          </span>
          <span className="font-medium">{step.name}</span>
          {step.checkpoint && (
            <span className="rounded-full border px-2 py-0.5 text-xs">{t('checkpoint')}</span>
          )}
          {step.new && (
            <span className="rounded-full border px-2 py-0.5 text-xs">{t('newStep')}</span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {step.iteration > 1 && (
              <span className="text-xs text-muted-foreground">
                {t('iteration', { n: step.iteration })}
              </span>
            )}
            {step.daysLate > 0 && (
              <span className="text-xs font-medium text-red-700">
                {t('daysLate', { count: step.daysLate })}
              </span>
            )}
            <StepHealthBadge health={step.health} quiet />
            <StepStatusBadge status={step.status} />
          </span>
        </summary>

        <div className="grid gap-4 border-t p-3">
          <dl className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">{t('doers')}</dt>
            <dd>{step.doers.map((d) => d.name).join(', ')}</dd>
            <dt className="text-muted-foreground">{t('signer')}</dt>
            <dd>{step.signer ? step.signer.name : t('noSigner')}</dd>
            {step.plannedEnd && (
              <>
                <dt className="text-muted-foreground">{t('plannedEnd')}</dt>
                <dd>
                  {step.plannedStart
                    ? `${formatDate(step.plannedStart)} → ${formatDate(step.plannedEnd)}`
                    : formatDate(step.plannedEnd)}
                </dd>
              </>
            )}
            {step.forecastEnd && (
              <>
                <dt className="text-muted-foreground">{t('forecastEnd')}</dt>
                <dd>
                  {formatDate(step.forecastEnd)}
                  {step.daysLate > 0 && (
                    <span className="ml-2 font-medium text-red-700">
                      {t('daysLate', { count: step.daysLate })}
                    </span>
                  )}
                </dd>
              </>
            )}
            {step.outside.length > 0 && (
              <>
                <dt className="text-muted-foreground">{t('outside')}</dt>
                <dd>{step.outside.join(', ')}</dd>
              </>
            )}
            {step.outputs.length > 0 && (
              <>
                <dt className="text-muted-foreground">{t('produces')}</dt>
                <dd>{step.outputs.join(' · ')}</dd>
              </>
            )}
            {step.approvedBy.length > 0 && (
              <>
                <dt className="text-muted-foreground">{t('approvedByLabel')}</dt>
                <dd>{step.approvedBy.map((p) => p.name).join(', ')}</dd>
              </>
            )}
          </dl>

          {step.waitsFor.length > 0 && (
            <div className="grid gap-1">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('waitsFor')}
              </h4>
              <ul className="list-disc pl-4">
                {step.waitsFor.map((c) => (
                  <li key={conditionText(c)}>{conditionText(c)}</li>
                ))}
              </ul>
            </div>
          )}

          {isOpen && needs.length > 0 && (
            <div className="grid gap-1 rounded-md bg-warning p-3 text-warning-foreground">
              <h4 className="text-xs font-medium tracking-wide uppercase">{t('needs')}</h4>
              <ul className="list-disc pl-4">
                {needs.map((c) => (
                  <li key={conditionText(c)}>{conditionText(c)}</li>
                ))}
              </ul>
            </div>
          )}

          {step.decisions.length > 0 && (
            <div className="grid gap-3">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('decisions')}
              </h4>
              {step.decisions.map((d) => (
                <div key={d.key} className="grid gap-1.5">
                  <p className="font-medium">
                    {d.name}{' '}
                    <span className="font-normal text-muted-foreground">· {d.by.name}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {d.answer
                      ? t('answeredWith', {
                          answer: d.options.find((o) => o.value === d.answer)?.name ?? d.answer,
                        })
                      : t('notAnswered')}
                  </p>
                  {a.decide.includes(d.key) && (
                    <div className="flex flex-wrap gap-2">
                      {d.options.map((o) => (
                        <Button
                          key={o.value}
                          size="sm"
                          variant={o.value === d.answer ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() => decide.mutate({ decision: d.key, value: o.value })}
                        >
                          {o.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {step.tasks.length > 0 && (
            <div className="grid gap-1">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('tasks')}
              </h4>
              <ul className="grid gap-0.5">
                {step.tasks.map((task) => (
                  <li key={task.id}>
                    {task.title} <span className="text-muted-foreground">→</span>{' '}
                    <span className="font-medium">
                      {task.assignee?.name ??
                        (task.queueRole ? t('queued', { role: task.queueRole.name }) : '')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step.iteration > 1 && <EarlierIterations projectId={projectId} step={step} />}

          <StepDocuments
            projectId={projectId}
            stepKey={step.key}
            documents={documents}
            canAdd={isOpen && step.status !== 'in_review'}
          />

          {hasButtons && (
            <div className="flex flex-wrap gap-2">
              {a.start && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate()}>
                  {t('start')}
                </Button>
              )}
              {a.submit && (
                <Button size="sm" disabled={busy} onClick={() => submit.mutate()}>
                  {step.signer ? t('submit') : t('markDone')}
                </Button>
              )}
              {a.approve && (
                <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
                  {t('approve')}
                </Button>
              )}
              {a.return && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPanel('return')}
                >
                  {t('return')}
                </Button>
              )}
              {a.sendBack.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPanel('sendBack')}
                >
                  {t('sendBack')}
                </Button>
              )}
              {a.correctiveActions && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPanel('corrective')}
                >
                  {t('raiseCorrective')}
                </Button>
              )}
            </div>
          )}

          {panel === 'return' && (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                giveBack.mutate();
              }}
            >
              <Label htmlFor={`return-${step.key}`}>{t('returnComment')}</Label>
              <Textarea
                id={`return-${step.key}`}
                required
                minLength={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>
                  {t('confirmReturn')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          )}

          {panel === 'corrective' && (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                corrective.mutate();
              }}
            >
              <Label htmlFor={`corrective-${step.key}`}>{t('correctiveTitle')}</Label>
              <Input
                id={`corrective-${step.key}`}
                required
                minLength={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>
                  {t('raise')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          )}

          {panel === 'sendBack' && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (preview) sendBack.mutate();
                else previewSendBack.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor={`target-${step.key}`}>{t('sendBackTo')}</Label>
                <select
                  id={`target-${step.key}`}
                  className={selectClass}
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPreview(null);
                  }}
                >
                  {a.sendBack.map((key) => (
                    <option key={key} value={key}>
                      {key} · {stepName(key)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`reason-${step.key}`}>{t('sendBackReason')}</Label>
                <Textarea
                  id={`reason-${step.key}`}
                  required
                  minLength={3}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview(null);
                  }}
                />
              </div>
              {preview && (
                <div className="grid gap-2">
                  <p className="text-muted-foreground">{t('resetPreview')}</p>
                  <PreviewPanel preview={preview.preview} />
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant={preview ? 'destructive' : 'default'}
                  disabled={busy || text.trim().length < 3 || !target}
                >
                  {preview ? t('confirmSendBack') : t('previewSendBack')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </form>
          )}

          <ProblemMessage error={error} />
        </div>
      </details>
      <RecordDeviationDialog
        open={deviationFor !== null}
        onOpenChange={(open) => !open && setDeviationFor(null)}
        tasks={deviationTasks}
        intro={deviationFor === 'submit' ? t('lateBeforeSubmit') : undefined}
        onRecorded={() => {
          onChanged();
          if (deviationFor === 'submit') submit.mutate();
        }}
      />
    </li>
  );
}

/** Earlier iterations are history: never edited, with the reason a send-back closed each. */
function EarlierIterations({ projectId, step }: { projectId: string; step: StepView }) {
  const t = useTranslations('step');
  const tStatus = useTranslations('stepStatus');
  const detail = useStepDetail(projectId, step.key, true);
  const earlier = (detail.data?.iterations ?? []).filter((i) => i.iteration < step.iteration);
  if (earlier.length === 0) return null;
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('iterations')}
      </h4>
      <ul className="grid gap-0.5">
        {earlier.map((i) => (
          <li key={i.iteration}>
            {t('iteration', { n: i.iteration })} · {tStatus(i.status)}
            {i.completedAt && <> · {formatTime(i.completedAt)}</>}
            {i.resetReason && <span className="text-muted-foreground"> · {i.resetReason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
