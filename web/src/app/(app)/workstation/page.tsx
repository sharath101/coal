'use client';

import type { ActionCard, AiRoute, ChatEvent, DraftRef } from '@coal/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, SendHorizontal, Square } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AssistantMessage,
  DraftPreview,
  ModelTable,
  UserMessage,
  usePurposeLabel,
} from '@/components/assistant/chat-parts';
import { ProjectStatusBadge } from '@/components/status-badge';
import { selectClass } from '@/components/role-fields';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  assistantKeys,
  streamMessage,
  useAiModels,
  useCardDecision,
  useChat,
  useChats,
  useCreateChat,
} from '@/lib/assistant';
import { flatten, useProjects, useTasks } from '@/lib/queries';
import { cn } from '@/lib/utils';

function Pane({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

interface Live {
  text: string;
  route: AiRoute | null;
  activity: string[];
  cards: ActionCard[];
  drafts: DraftRef[];
  error: string | null;
}

const emptyLive = (): Live => ({
  text: '',
  route: null,
  activity: [],
  cards: [],
  drafts: [],
  error: null,
});

/**
 * The Workstation: tasks, projects and chats; the conversation with the assistant; and the
 * preview, which shows a draft or the model table (docs/workstation-and-ai.md#the-workstation).
 */
export default function WorkstationPage() {
  const t = useTranslations('workstation');
  const ta = useTranslations('assistant');
  const purposeLabel = usePurposeLabel();
  const queryClient = useQueryClient();
  const myTasks = flatten(useTasks('mine', 'active').data?.pages).slice(0, 6);
  const projects = flatten(useProjects('').data?.pages).slice(0, 8);
  const models = useAiModels();
  const chats = useChats();
  const createChat = useCreateChat();
  const [chatId, setChatId] = useState<string | null>(null);
  const chat = useChat(chatId);
  const decide = useCardDecision(chatId);
  const [text, setText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState<DraftRef | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const items = useMemo(() => chat.data?.items ?? [], [chat.data]);
  const configured = models.data?.configured ?? false;
  const busy = live !== null && pending !== null;

  // Keep the newest message in view, scrolling only the conversation, never the page.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items.length, live?.text, live?.activity.length, live?.cards.length, pending]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    let id = chatId;
    if (!id) {
      id = (await createChat.mutateAsync({})).id;
      setChatId(id);
    }
    setText('');
    setPending(trimmed);
    setLive(emptyLive());
    const controller = new AbortController();
    abort.current = controller;
    const onEvent = (event: ChatEvent) => {
      setLive((l) => {
        const s = l ?? emptyLive();
        switch (event.type) {
          case 'route':
            return { ...s, route: event.route };
          case 'activity':
            return { ...s, activity: [...s.activity, event.text] };
          case 'text':
            return { ...s, text: s.text + event.delta };
          case 'card':
            return { ...s, cards: [...s.cards, event.card] };
          case 'draft':
            setDraft(event.draft);
            return { ...s, drafts: [...s.drafts, event.draft] };
          case 'error':
            return { ...s, error: event.message };
          default:
            return s;
        }
      });
    };
    try {
      await streamMessage(
        id,
        { text: trimmed, ...(purpose && { purpose }) },
        onEvent,
        controller.signal,
      );
    } catch {
      // Stopped by the person, or the connection dropped; what was saved shows below.
    } finally {
      abort.current = null;
      await queryClient.invalidateQueries({ queryKey: assistantKeys.chat(id) });
      await queryClient.invalidateQueries({ queryKey: assistantKeys.chats });
      await queryClient.invalidateQueries({ queryKey: assistantKeys.models });
      setPending(null);
      setLive((l) => (l?.error ? l : null));
    }
  }

  const onDecide = (card: ActionCard, confirm: boolean) => decide.mutate({ id: card.id, confirm });
  const examples = ['example1', 'example2', 'example3', 'example4'] as const;

  return (
    // On wider screens the three panes fill the window below the top bar and scroll on their own.
    <div className="grid flex-1 grid-cols-1 md:h-[calc(100dvh-5.25rem)] md:flex-none md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_24rem]">
      <aside className="grid content-start gap-6 border-b p-4 md:overflow-y-auto md:border-r md:border-b-0">
        <Pane title={ta('chats')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChatId(null);
              setDraft(null);
              setLive(null);
            }}
          >
            <Plus aria-hidden />
            {t('newChat')}
          </Button>
          <ul className="mt-2 grid gap-0.5 text-sm">
            {(chats.data ?? []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChatId(c.id);
                    setDraft(null);
                    setLive(null);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted',
                    c.id === chatId && 'bg-muted font-medium',
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Pane>
        <Pane title={t('myTasks')}>
          {myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noTasks')}</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {myTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={task.subject ? `/projects/${task.subject.id}` : '/tasks'}
                    className="hover:underline"
                  >
                    {task.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/tasks"
            className="mt-2 inline-block text-xs text-muted-foreground hover:underline"
          >
            {t('allTasks')}
          </Link>
        </Pane>
        <Pane title={t('projects')}>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${p.id}`} className="min-w-0 truncate hover:underline">
                    {p.code} · {p.name}
                  </Link>
                  <ProjectStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Pane>
      </aside>

      <div className="flex min-h-[32rem] min-w-0 flex-col md:min-h-0">
        <div ref={scroller} className="flex-1 overflow-y-auto p-4">
          {items.length === 0 && !pending ? (
            <div className="mx-auto grid max-w-lg gap-4 pt-10 text-center">
              <p className="text-sm text-muted-foreground">{t('conversationEmpty')}</p>
              {configured ? (
                <div className="grid gap-2">
                  {examples.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void send(ta(key))}
                      className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      {ta(key)}
                    </button>
                  ))}
                </div>
              ) : (
                models.data && (
                  <p className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
                    {ta('off')}
                  </p>
                )
              )}
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-5">
              {items.map((item) =>
                item.role === 'user' ? (
                  <UserMessage key={item.id} item={item} />
                ) : (
                  <AssistantMessage
                    key={item.id}
                    item={item}
                    onDecide={onDecide}
                    deciding={decide.isPending ? (decide.variables?.id ?? null) : null}
                    onOpenDraft={setDraft}
                  />
                ),
              )}
              {pending && (
                <UserMessage
                  item={{
                    role: 'user',
                    id: 'pending',
                    text: pending,
                    at: new Date().toISOString(),
                  }}
                />
              )}
              {live && (pending || live.error) && (
                <>
                  {pending && (
                    <AssistantMessage
                      live
                      item={{ ...live, usage: null }}
                      onDecide={onDecide}
                      deciding={null}
                      onOpenDraft={setDraft}
                    />
                  )}
                  {live.error && (
                    <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {live.error}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <form
          className="grid gap-2 border-t p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <div className="flex gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder={t('inputPlaceholder')}
              disabled={!configured}
              rows={2}
              className="min-h-0 resize-none"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                title={ta('stop')}
                onClick={() => abort.current?.abort()}
              >
                <Square aria-hidden />
                <span className="sr-only">{ta('stop')}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!configured || !text.trim()}
                title={t('send')}
              >
                <SendHorizontal aria-hidden />
                <span className="sr-only">{t('send')}</span>
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {ta('modelChoice')}
            <select
              className={cn(selectClass, 'h-7 w-auto py-0 text-xs')}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="">{ta('auto')}</option>
              {(models.data?.purposes ?? [])
                .filter((p) => !['route', 'template_pick', 'draft_write'].includes(p.key))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {ta('forceModel', { model: p.modelName, purpose: purposeLabel(p.key) })}
                  </option>
                ))}
            </select>
          </label>
        </form>
      </div>

      <aside className="hidden min-w-0 overflow-y-auto border-l p-4 lg:block">
        {draft ? (
          <DraftPreview draft={draft} onClose={() => setDraft(null)} />
        ) : (
          <Pane title={ta('modelsTitle')}>
            {models.data ? (
              <ModelTable models={models.data} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>
            )}
          </Pane>
        )}
      </aside>
    </div>
  );
}
