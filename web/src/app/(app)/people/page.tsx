'use client';

import type { ChartPosition, MeView, ProductLine } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useSwitchPerson } from '@/components/person-switcher';
import { ProblemMessage } from '@/components/problem-message';
import { useMe, useOrgChart, useProductLines } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface Target {
  id: string;
  name: string;
  title: string;
}

interface Context {
  positions: ChartPosition[];
  lines: ProductLine[];
  me: MeView;
  /** Set in an admin's session: a name can be clicked to become that person. */
  onPick: ((target: Target) => void) | null;
}

/** The people at one box, and the seats still open. A box counted by line shows one line's people. */
function Seats({
  position,
  line,
  ctx,
}: {
  position: ChartPosition;
  line: ProductLine | null;
  ctx: Context;
}) {
  const t = useTranslations('people');
  const holders = position.holders.filter((h) => !line || h.productLine?.id === line.id);
  const open = position.seats === null ? 0 : Math.max(0, position.seats - holders.length);
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {holders.map((h) => {
        const mine = h.id === ctx.me.id;
        const label = (
          <>
            {h.name}
            {mine && <span className="ml-1 text-xs text-muted-foreground">{t('you')}</span>}
          </>
        );
        const pill = cn(
          'rounded-full border px-2.5 py-0.5 text-sm',
          mine ? 'border-primary bg-primary/10' : 'bg-background',
        );
        return (
          <li key={h.id}>
            {ctx.onPick && !mine ? (
              <button
                type="button"
                onClick={() => ctx.onPick?.({ id: h.id, name: h.name, title: position.title })}
                className={cn(pill, 'hover:bg-accent')}
              >
                {label}
              </button>
            ) : (
              <span className={pill}>{label}</span>
            )}
          </li>
        );
      })}
      {Array.from({ length: Math.min(open, 6) }, (_, i) => (
        <li
          key={`open-${i}`}
          className="rounded-full border border-dashed px-2.5 py-0.5 text-sm text-muted-foreground"
        >
          {t('openSeat')}
        </li>
      ))}
      {holders.length === 0 && position.seats === null && (
        <li className="text-sm text-muted-foreground">{t('nobody')}</li>
      )}
    </ul>
  );
}

/** One box of the chart with the boxes that report to it. */
function Box({
  position,
  line,
  ctx,
}: {
  position: ChartPosition;
  line: ProductLine | null;
  ctx: Context;
}) {
  const t = useTranslations('people');
  const taken = position.holders.filter((h) => !line || h.productLine?.id === line.id).length;
  const reports = ctx.positions.filter((p) => p.reportsTo === position.key);
  return (
    <li>
      <div className="rounded-lg border bg-card p-3 text-card-foreground">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">
            {position.title}
            {line && <span className="font-normal text-muted-foreground"> · {line.name}</span>}
          </h3>
          {position.seats !== null && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('seats', { taken, total: position.seats })}
            </span>
          )}
        </div>
        <Seats position={position} line={line} ctx={ctx} />
      </div>
      {reports.length > 0 && (
        <ul className="ml-4 mt-2 grid gap-2 border-l pl-4">
          {reports.flatMap((child) => {
            if (!child.perProductLine) {
              return [<Box key={child.key} position={child} line={null} ctx={ctx} />];
            }
            // A box counted by line sits under its own line's Lead, and once per line under anyone else.
            const lines = line ? [line] : ctx.lines;
            return lines.map((l) => (
              <Box key={`${child.key}-${l.id}`} position={child} line={l} ctx={ctx} />
            ));
          })}
        </ul>
      )}
    </li>
  );
}

/** Jayon's R&D org chart: who reports to whom, who holds each box, and the seats still open. */
export default function PeoplePage() {
  const t = useTranslations('people');
  const me = useMe();
  const chart = useOrgChart();
  const lines = useProductLines();
  const [target, setTarget] = useState<Target | null>(null);
  const switching = useSwitchPerson(me.data as MeView, () => setTarget(null));

  if (!me.data) return null;
  const positions = chart.data ?? [];
  const ctx: Context = {
    positions,
    lines: lines.data ?? [],
    me: me.data,
    onPick: me.data.switcher ? setTarget : null,
  };
  const top = positions.filter((p) => p.reportsTo === null && p.departmentCode === null);
  const outside = positions.filter((p) => p.reportsTo === null && p.departmentCode !== null);

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      {me.data.switcher && (
        <p className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t('switchHint')}
        </p>
      )}
      <ProblemMessage error={chart.error ?? lines.error} />

      <section className="mt-6" aria-labelledby="people-rnd">
        <h2 id="people-rnd" className="mb-3 text-sm font-medium text-muted-foreground">
          {t('rnd')}
        </h2>
        <ul className="grid gap-3 lg:grid-cols-[1fr_16rem] lg:items-start">
          {top.map((p) => (
            <Box key={p.key} position={p} line={null} ctx={ctx} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t('boardNote')}</p>
      </section>

      {outside.length > 0 && (
        <section className="mt-8" aria-labelledby="people-outside">
          <h2 id="people-outside" className="mb-3 text-sm font-medium text-muted-foreground">
            {t('outside')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {outside.map((p) => (
              <Box key={p.key} position={p} line={null} ctx={ctx} />
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('switchTitle', { name: target?.name ?? '' })}
        text={t('switchText', { name: target?.name ?? '', title: target?.title ?? '' })}
        confirmLabel={t('switch')}
        onConfirm={() => target && switching.mutate(target.id)}
        pending={switching.isPending}
        error={switching.error}
      />
    </div>
  );
}
