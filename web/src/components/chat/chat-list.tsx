'use client';

import type { Chat } from '@coal/shared';
import { MessageSquarePlus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { flatten, useChats, useProjects, useTasks } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { workstationHref, type Pin } from '@/lib/workstation';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function ChatLink({ chat, active }: { chat: Chat; active: boolean }) {
  const t = useTranslations('workstation');
  return (
    <li>
      <Link
        href={`/workstation?chat=${chat.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block truncate rounded-md px-2 py-1 text-sm hover:bg-accent',
          active && 'bg-accent font-medium',
        )}
      >
        {chat.title || t('untitled')}
      </Link>
    </li>
  );
}

/**
 * The left-hand pane: my tasks (each opens a chat about it), a space for each project with its
 * chats, and general chats (docs/workstation-and-ai.md#the-workstation).
 */
export function ChatList({ activeId }: { activeId: string | null }) {
  const t = useTranslations('workstation');
  const chats = useChats().data ?? [];
  const tasks = flatten(useTasks('mine', 'active').data?.pages).slice(0, 6);
  const projects = flatten(useProjects('').data?.pages);
  const known = new Set(projects.map((p) => p.id));
  const byProject = new Map<string, Chat[]>();
  const general: Chat[] = [];
  for (const chat of chats) {
    const id = chat.context.projectId;
    // A project that isn't among those listed here keeps its chats with the general ones.
    if (id && known.has(id)) byProject.set(id, [...(byProject.get(id) ?? []), chat]);
    else general.push(chat);
  }
  // Projects with chats first, then the rest, a few of them.
  const shown = [
    ...projects.filter((p) => byProject.has(p.id)),
    ...projects.filter((p) => !byProject.has(p.id)).slice(0, 4),
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-6">
      <Button asChild variant="outline" size="sm" className="justify-self-start">
        <Link href="/workstation">
          <MessageSquarePlus aria-hidden />
          {t('newChat')}
        </Link>
      </Button>

      <Section title={t('myTasks')}>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTasks')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-0.5">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={workstationHref({
                    taskId: task.id,
                    ...(task.subject?.type === 'project' && { projectId: task.subject.id }),
                  } satisfies Pin)}
                  title={t('askAboutTask')}
                  className="block truncate rounded-md px-2 py-1 text-sm hover:bg-accent"
                >
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/tasks" className="text-xs text-muted-foreground hover:underline">
          {t('allTasks')}
        </Link>
      </Section>

      <Section title={t('projects')}>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3">
            {shown.map((p) => (
              <li key={p.id} className="grid min-w-0 grid-cols-1 gap-0.5">
                <div className="flex items-center justify-between gap-1 px-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                    title={`${p.code} · ${p.name}`}
                  >
                    {p.code} · {p.name}
                  </Link>
                  <Button asChild size="icon-xs" variant="ghost" className="shrink-0">
                    <Link
                      href={workstationHref({ projectId: p.id })}
                      aria-label={t('newChatAbout', { code: p.code })}
                      title={t('newChatAbout', { code: p.code })}
                    >
                      <Plus aria-hidden />
                    </Link>
                  </Button>
                </div>
                <ul className="grid grid-cols-1 gap-0.5">
                  {(byProject.get(p.id) ?? []).map((c) => (
                    <ChatLink key={c.id} chat={c} active={c.id === activeId} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <Link href="/projects" className="text-xs text-muted-foreground hover:underline">
          {t('allProjects')}
        </Link>
      </Section>

      <Section title={t('generalChats')}>
        {general.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noChats')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-0.5">
            {general.map((c) => (
              <ChatLink key={c.id} chat={c} active={c.id === activeId} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
