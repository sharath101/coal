'use client';

import { switchPerson, type ChartPosition, type MeView } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Input } from '@/components/ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { useOrgChart } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * The demo's way of moving between people without signing out (docs/roles-and-access.md#switching-people-for-the-demo).
 * It is temporary: it only exists while the backend's `ADMIN_SWITCHING` is on, and only in a session an admin started.
 */
export function useSwitchPerson(me: MeView, onSwitched?: () => void) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (userId: string) => api(switchPerson, { body: { userId } }),
    onSuccess: async ({ user }) => {
      // Nothing cached belongs to the next person: everything is emptied and fetched again, in place.
      await queryClient.resetQueries();
      onSwitched?.();
      if (user.id === me.switcher?.id) router.push('/people');
    },
  });
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();

/** A person's mark: their initials in a circle. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

interface Entry {
  id: string;
  name: string;
  title: string;
  line: string | null;
}

const entriesOf = (positions: ChartPosition[]): Entry[] =>
  positions.flatMap((p) =>
    p.holders.map((h) => ({
      id: h.id,
      name: h.name,
      title: p.title,
      line: h.productLine?.name ?? null,
    })),
  );

/** The circle at the top of an admin's session: who I am now, and everyone I can become in one click. */
export function PersonSwitcher({ me }: { me: MeView }) {
  const t = useTranslations('switcher');
  const tNav = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chart = useOrgChart();
  const switching = useSwitchPerson(me, () => {
    setOpen(false);
    setQuery('');
  });
  const admin = me.switcher;
  const asAdmin = !admin || me.id === admin.id;
  const words = query.trim().toLowerCase();
  const people = entriesOf(chart.data ?? []).filter(
    (e) => !words || `${e.name} ${e.title} ${e.line ?? ''}`.toLowerCase().includes(words),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('open')}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <Avatar name={me.name} />
          <span className="hidden min-w-0 max-w-[11rem] flex-col text-left leading-tight sm:flex">
            <span className="truncate font-medium">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.position.title}</span>
          </span>
          <span className="sr-only">{t('open')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="border-b p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('demoOnly')}
          </p>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="pl-8"
            />
          </div>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5" aria-label={t('people')}>
          {!asAdmin && admin && (
            <li>
              <button
                type="button"
                disabled={switching.isPending}
                onClick={() => switching.mutate(admin.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-accent"
              >
                <Avatar name={admin.name} className="bg-muted text-foreground" />
                {t('backTo', { name: admin.name })}
              </button>
            </li>
          )}
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={switching.isPending}
                onClick={() => switching.mutate(p.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Avatar name={p.name} className="size-7 text-[10px]" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.line ? `${p.title} · ${p.line}` : p.title}
                  </span>
                </span>
                {p.id === me.id && (
                  <Check className="size-4 text-muted-foreground" aria-label={t('current')} />
                )}
              </button>
            </li>
          ))}
          {chart.data && people.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">{t('nobody')}</li>
          )}
        </ul>
        <ProblemMessage error={switching.error ?? chart.error} />
        <div className="flex items-center justify-between border-t p-2 text-sm">
          <PopoverClose asChild>
            <Link
              href="/people"
              className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t('chart')}
            </Link>
          </PopoverClose>
          <PopoverClose asChild>
            <Link
              href="/profile"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <UserRound className="size-4" aria-hidden />
              {tNav('profile')}
            </Link>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
