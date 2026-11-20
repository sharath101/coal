'use client';

import {
  confirmProposal,
  rejectProposal,
  updateProposal,
  type Proposal,
  type ProposalAction,
} from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { PreviewPanel } from '@/components/preview-panel';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/role-fields';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatDate, todayIst } from '@/lib/format';
import { queryKeys, useMe, usePeople, useRefreshWork } from '@/lib/queries';

const TONE = {
  pending: 'waiting',
  confirmed: 'good',
  rejected: 'neutral',
  expired: 'neutral',
  failed: 'bad',
} as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** A card can be edited on screen when every action is a task: who, what and when. */
const editableOnScreen = (actions: ProposalAction[]) =>
  actions.every((a) => a.endpoint === 'tasks.create');

/**
 * An action card (docs/workstation-and-ai.md#action-cards): what will happen, in plain words, with
 * who is told, and Confirm, Edit and Cancel. Nothing happens until the person confirms. The server
 * checks again when they do, and if what it would do has changed, shows the card again.
 */
export function ActionCard({
  proposal,
  chatId,
  onAskChange,
}: {
  proposal: Proposal;
  chatId: string;
  /** For a card that can't be edited on screen: the assistant changes it when asked. */
  onAskChange: (title: string) => void;
}) {
  const t = useTranslations('workstation.card');
  const queryClient = useQueryClient();
  const refreshWork = useRefreshWork();
  const [editing, setEditing] = useState(false);
  const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
  const confirm = useMutation({
    mutationFn: () =>
      api(confirmProposal, { params: { id: proposal.id }, ifMatch: String(proposal.version) }),
    onSuccess: () => {
      void refreshWork();
      void reload();
    },
    // If it changed, the card is shown again as it stands now.
    onError: () => void reload(),
  });
  const reject = useMutation({
    mutationFn: () => api(rejectProposal, { params: { id: proposal.id } }),
    onSuccess: () => void reload(),
  });
  const pending = proposal.status === 'pending';
  const busy = confirm.isPending || reject.isPending;

  return (
    <section
      aria-label={t('label')}
      className="grid gap-3 rounded-xl border bg-card p-4 text-sm shadow-xs"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('label')}
          </span>
          <h4 className="font-medium">{proposal.title}</h4>
        </div>
        <Pill tone={TONE[proposal.status]}>{t(`status.${proposal.status}`)}</Pill>
      </header>

      <ol className="grid gap-3">
        {proposal.preview.actions.map((action, i) => (
          <li key={i} className="grid gap-1">
            <p>{action.summary}</p>
            {action.effects.warnings.map((warning) => (
              <p key={warning} className="rounded-md bg-warning px-2 py-1 text-warning-foreground">
                {warning}
              </p>
            ))}
            {action.effects.steps.length > 0 && <PreviewPanel preview={action.effects} />}
            {action.notified.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('told', { names: action.notified.map((p) => p.name).join(', ') })}
              </p>
            )}
          </li>
        ))}
      </ol>

      <ProblemMessage error={confirm.error ?? reject.error} />

      {pending ? (
        <footer className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => confirm.mutate()} disabled={busy}>
            {confirm.isPending ? t('confirming') : t('confirm')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              editableOnScreen(proposal.actions) ? setEditing(true) : onAskChange(proposal.title)
            }
          >
            {t('edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => reject.mutate()} disabled={busy}>
            {t('cancel')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('expires', { date: formatDate(proposal.expiresAt.slice(0, 10)) })}
          </span>
        </footer>
      ) : proposal.status === 'confirmed' ? (
        <p className="text-xs text-muted-foreground">{t('confirmedNote')}</p>
      ) : null}

      {editing && (
        <EditCardDialog
          proposal={proposal}
          onOpenChange={setEditing}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </section>
  );
}

/** Changing who, what or when previews the card again, as a new version. */
function EditCardDialog({
  proposal,
  onOpenChange,
  onSaved,
}: {
  proposal: Proposal;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workstation.card');
  const id = useId();
  const me = useMe();
  const people = usePeople();
  const [drafts, setDrafts] = useState(() =>
    proposal.actions.map((a) => {
      const body = asRecord(a.body);
      return {
        title: typeof body.title === 'string' ? body.title : '',
        assigneeId: typeof body.assigneeId === 'string' ? body.assigneeId : '',
        dueOn: typeof body.dueOn === 'string' ? body.dueOn : '',
      };
    }),
  );
  const change = (i: number, patch: Partial<(typeof drafts)[number]>) =>
    setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const save = useMutation({
    mutationFn: () =>
      api(updateProposal, {
        params: { id: proposal.id },
        ifMatch: String(proposal.version),
        body: {
          actions: proposal.actions.map((a, i) => {
            const { assigneeId: _a, dueOn: _d, ...rest } = asRecord(a.body);
            const d = drafts[i] as (typeof drafts)[number];
            return {
              ...a,
              body: {
                ...rest,
                title: d.title,
                ...(d.assigneeId && { assigneeId: d.assigneeId }),
                ...(d.dueOn && { dueOn: d.dueOn }),
              },
            };
          }),
        },
      }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('editTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('editIntro')}
        </DialogDescription>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {drafts.map((d, i) => (
            <div key={i} className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-${i}-title`}>{t('fieldTitle')}</Label>
                <Input
                  id={`${id}-${i}-title`}
                  value={d.title}
                  maxLength={200}
                  onChange={(e) => change(i, { title: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-${i}-person`}>{t('fieldPerson')}</Label>
                  <select
                    id={`${id}-${i}-person`}
                    className={selectClass}
                    value={d.assigneeId}
                    onChange={(e) => change(i, { assigneeId: e.target.value })}
                  >
                    <option value="">{t('me')}</option>
                    {(people.data ?? [])
                      .filter((p) => p.id !== me.data?.id && p.status === 'active')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.role.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-${i}-due`}>{t('fieldDue')}</Label>
                  <Input
                    id={`${id}-${i}-due`}
                    type="date"
                    min={todayIst()}
                    value={d.dueOn}
                    onChange={(e) => change(i, { dueOn: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
          <ProblemMessage error={save.error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={save.isPending || drafts.some((d) => d.title.trim().length < 3)}
            >
              {t('save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancelEdit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
