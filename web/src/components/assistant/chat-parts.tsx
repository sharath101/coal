'use client';

import type { ActionCard, AiModels, AiRoute, AiUsage, ChatItem, DraftRef } from '@coal/shared';
import { Bot, Check, ExternalLink, FileDown, FileText, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { draftFileUrl } from '@/lib/assistant';
import { cn } from '@/lib/utils';
import { RichText } from './rich-text';

type PurposeKey =
  | 'route'
  | 'chat'
  | 'lookup'
  | 'analysis'
  | 'idea'
  | 'assign'
  | 'draft'
  | 'draft_write'
  | 'template_pick'
  | 'explain'
  | 'deep';

/** A row of the model table in words; an unknown row (a newer server) shows its key. */
export function usePurposeLabel() {
  const t = useTranslations('assistant.purpose');
  return (key: string) => (t.has(key as PurposeKey) ? t(key as PurposeKey) : key);
}

const dollars = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

const MODEL_TONE: Record<string, string> = {
  'Haiku 5.5': 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  'Sonnet 5.5': 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  'Opus 5.5': 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
};

export function ModelBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
        MODEL_TONE[name] ?? 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {name}
    </span>
  );
}

export function RouteLine({ route }: { route: AiRoute }) {
  const t = useTranslations('assistant');
  const purposeLabel = usePurposeLabel();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <ModelBadge name={route.modelName} />
      <span>{purposeLabel(route.purpose)}</span>
      <span>·</span>
      <span>{t('effort', { effort: route.effort })}</span>
      <span className="hidden sm:inline">·</span>
      <span className="hidden italic sm:inline">{route.reason}</span>
    </div>
  );
}

export function UsageLine({ usage }: { usage: AiUsage }) {
  const t = useTranslations('assistant');
  const purposeLabel = usePurposeLabel();
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {t('usage', { calls: usage.calls.length, cost: dollars(usage.costUsd) })}
      </summary>
      <ul className="mt-1 grid gap-0.5 pl-3">
        {usage.calls.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <ModelBadge name={c.modelName} />
            <span>
              {t('call', {
                purpose: purposeLabel(c.purpose),
                input: c.inputTokens,
                output: c.outputTokens,
                cost: dollars(c.costUsd),
                seconds: (c.ms / 1000).toFixed(1),
              })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ActivityLines({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-0.5 text-xs text-muted-foreground">
      {items.map((a, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <Check className="size-3" aria-hidden />
          {a}
        </li>
      ))}
    </ul>
  );
}

export function CardView({
  card,
  onDecide,
  busy,
}: {
  card: ActionCard;
  onDecide: (confirm: boolean) => void;
  busy: boolean;
}) {
  const t = useTranslations('assistant');
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {card.kind === 'link' ? t('cardLink') : t('cardAction')}
        </p>
        <span className="text-xs text-muted-foreground">{t(`cardStatus.${card.status}`)}</span>
      </div>
      <p className="font-medium">{card.title}</p>
      {card.lines.length > 0 && (
        <ul className="grid gap-0.5 text-sm">
          {card.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {card.warnings.length > 0 && (
        <ul className="grid gap-0.5 rounded-md bg-warning p-2 text-xs text-warning-foreground">
          {card.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {card.result && <p className="text-xs text-muted-foreground">{card.result}</p>}
      {card.kind === 'link' && card.href && (
        <Button asChild size="sm" className="justify-self-start">
          <Link href={card.href}>
            <ExternalLink aria-hidden />
            {t('openGoForm')}
          </Link>
        </Button>
      )}
      {card.kind === 'proposal' && card.status === 'pending' && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onDecide(true)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {t('confirm')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(false)} disabled={busy}>
            <X aria-hidden />
            {t('discard')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DraftChip({ draft, onOpen }: { draft: DraftRef; onOpen: () => void }) {
  const t = useTranslations('assistant');
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 rounded-lg border bg-background p-2 text-left text-sm hover:bg-muted"
    >
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="grid">
        <span className="font-medium">{draft.title}</span>
        <span className="text-xs text-muted-foreground">
          {draft.template ? t('fromTemplate') : t('noTemplate')}
          {' · '}
          {t('gapCount', { count: draft.gaps.length })}
        </span>
      </span>
    </button>
  );
}

export function AssistantMessage({
  item,
  live,
  onDecide,
  deciding,
  onOpenDraft,
}: {
  item: {
    text: string;
    route: AiRoute | null;
    activity: string[];
    cards: ActionCard[];
    drafts: DraftRef[];
    usage: AiUsage | null;
  };
  live?: boolean;
  onDecide: (card: ActionCard, confirm: boolean) => void;
  deciding: string | null;
  onOpenDraft: (draft: DraftRef) => void;
}) {
  const t = useTranslations('assistant');
  return (
    <div className="flex gap-3">
      <Bot className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-2">
        {item.route ? (
          <RouteLine route={item.route} />
        ) : (
          live && <p className="text-xs text-muted-foreground">{t('routing')}</p>
        )}
        <ActivityLines items={item.activity} />
        {item.text ? (
          <RichText text={item.text} />
        ) : (
          live && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('thinking')}
            </p>
          )
        )}
        {item.drafts.map((d) => (
          <DraftChip key={d.id} draft={d} onOpen={() => onOpenDraft(d)} />
        ))}
        {item.cards.map((c) => (
          <CardView
            key={c.id}
            card={c}
            busy={deciding === c.id}
            onDecide={(confirm) => onDecide(c, confirm)}
          />
        ))}
        {item.usage && <UsageLine usage={item.usage} />}
      </div>
    </div>
  );
}

export function UserMessage({ item }: { item: Extract<ChatItem, { role: 'user' }> }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {item.text}
      </p>
    </div>
  );
}

export function DraftPreview({ draft, onClose }: { draft: DraftRef; onClose: () => void }) {
  const t = useTranslations('assistant');
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] gap-3">
      <div className="grid gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{draft.title}</p>
          <Button variant="ghost" size="icon-xs" onClick={onClose} title={t('closePreview')}>
            <X aria-hidden />
            <span className="sr-only">{t('closePreview')}</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {draft.template ? t('templateFile', { file: draft.template }) : t('noTemplate')}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('writtenBy')}
          <ModelBadge name={draft.modelName} />
        </p>
      </div>
      <iframe
        title={draft.title}
        src={draftFileUrl(draft.id, 'pdf')}
        className="min-h-[28rem] w-full rounded-md border bg-white"
      />
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={draftFileUrl(draft.id, 'docx')}>
              <FileDown aria-hidden />
              {t('downloadWord')}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={draftFileUrl(draft.id, 'pdf')} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              {t('openPdf')}
            </a>
          </Button>
        </div>
        <div className="grid gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('gaps')}
          </p>
          {draft.gaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noGaps')}</p>
          ) : (
            <ul className="list-disc pl-4 text-xs">
              {draft.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModelTable({ models }: { models: AiModels }) {
  const t = useTranslations('assistant');
  const purposeLabel = usePurposeLabel();
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {t('spent', {
          spent: dollars(models.spentTodayUsd),
          budget: `$${models.dailyBudgetUsd}`,
        })}
      </p>
      <ul className="grid gap-2">
        {models.purposes.map((p) => (
          <li key={p.key} className="grid gap-0.5 rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{purposeLabel(p.key)}</span>
              <ModelBadge name={p.modelName} />
            </div>
            <p className="text-xs text-muted-foreground">{p.why}</p>
            <p className="text-[11px] text-muted-foreground">
              {t('price', {
                effort: p.effort,
                input: `$${p.inputPerMTok}`,
                output: `$${p.outputPerMTok}`,
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
