'use client';

import { signOut, type Me } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The two pages per person, with the toggle between them (docs/dashboard.md). */
function PageToggle() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const pages = [
    { href: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { href: '/workstation', label: t('workstation'), icon: MessagesSquare },
  ];
  return (
    <nav aria-label={t('pages')} className="flex rounded-lg bg-muted p-1">
      {pages.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Where the work is: every project, and the tasks that are mine. */
function MainLinks() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const links = [
    { href: '/projects', label: t('projects'), icon: FolderKanban },
    { href: '/tasks', label: t('tasks'), icon: ListChecks },
  ];
  return (
    <nav aria-label={t('main')} className="flex gap-1">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname.startsWith(href) ? 'page' : undefined}
          className={cn(
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
            pathname.startsWith(href) && 'bg-accent text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="hidden md:inline">{label}</span>
          <span className="sr-only md:hidden">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function TopBar({ me }: { me: Me }) {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutMutation = useMutation({
    mutationFn: () => api(signOut),
    onSettled: () => {
      queryClient.clear();
      router.replace('/sign-in');
    },
  });

  return (
    <header className="flex h-14 items-center gap-4 border-b px-4">
      <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
        {tApp('name')}
      </Link>
      <MainLinks />
      <div className="flex flex-1 justify-center">
        <PageToggle />
      </div>
      <div className="flex items-center gap-1" aria-label={t('account')}>
        <Link
          href="/profile"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <UserRound className="size-4" aria-hidden />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="font-medium">{me.name}</span>
            <span className="text-xs text-muted-foreground">{me.role.name}</span>
          </span>
          <span className="sr-only">{t('profile')}</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          title={t('signOut')}
          onClick={() => signOutMutation.mutate()}
          disabled={signOutMutation.isPending}
        >
          <LogOut className="size-4" aria-hidden />
          <span className="sr-only">{t('signOut')}</span>
        </Button>
      </div>
    </header>
  );
}
