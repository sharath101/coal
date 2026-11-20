'use client';

import {
  ApiError,
  createChat,
  sendFeedback,
  stopReply,
  type ChatDetail,
  type ChatMessage,
  type Citation,
  type ErrorCode,
  type MessagePart,
} from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ActionCard } from '@/components/chat/action-card';
import { Composer } from '@/components/chat/composer';
import { MessageText } from '@/components/chat/message-text';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { streamReply } from '@/lib/chat-stream';
import { queryKeys, useChat, useProject } from '@/lib/queries';
import { isPinned, type Pin } from '@/lib/workstation';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  label: string;
  state: 'start' | 'done' | 'error';
}

/** A reply being written: what is known so far. */
interface Live {
  text: string;
  /** Once saved, the person's message is in the chat too: shown once, from here. */
  userId?: string;
  reply: string;
  activity: Activity[];
}

const streamError = (code: string, detail: string) =>
  new ApiError({
    type: 'about:blank',
    title: detail,
    status: 502,
    code: code as ErrorCode,
    detail,
  });

function ProjectLabel({ id }: { id: string }) {
  const project = useProject(id);
  return project.data ? (
    <Link href={`/projects/${id}`} className="hover:underline">
      {project.data.code} · {project.data.name}
    </Link>
  ) : null;
}

/** What the chat is about, with a way to drop it before the first message. */
function PinChips({ pin, onClear }: { pin: Pin; onClear?: () => void }) {
  const t = useTranslations('workstation.pin');
  if (!isPinned(pin)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
      <span>{t('about')}</span>
      {pin.projectId && <ProjectLabel id={pin.projectId} />}
      {pin.stepKey && <span>{t('step', { key: pin.stepKey })}</span>}
      {pin.documentId && <span>{t('document')}</span>}
      {pin.taskId && <span>{t('task')}</span>}
      {pin.widgetKey && <span>{t('widget', { key: pin.widgetKey })}</span>}
      {onClear && (
        <Button size="icon-xs" variant="ghost" onClick={onClear} aria-label={t('clear')}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** What the assistant looked at, one line, opening to the list. */
function ActivityLines({ items }: { items: { label: string; ok: boolean }[] }) {
  const t = useTranslations('workstation.activity');
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {t('looked', { count: items.length })}
      </summary>
      <ul className="mt-1 grid gap-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i} className={cn(!item.ok && 'text-destructive')}>
            {item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Feedback({ message, chatId }: { message: ChatMessage; chatId: string }) {
  const t = useTranslations('workstation.message');
  const queryClient = useQueryClient();
  const rate = useMutation({
    mutationFn: (rating: 'up' | 'down') =>
      api(sendFeedback, { body: { messageId: message.id, rating } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) }),
  });
  return (
    <span className="flex items-center gap-0.5">
      {(['up', 'down'] as const).map((rating) => {
        const Icon = rating === 'up' ? ThumbsUp : ThumbsDown;
        return (
          <Button
            key={rating}
            size="icon-xs"
            variant="ghost"
            aria-pressed={message.feedback === rating}
            aria-label={t(rating === 'up' ? 'helped' : 'didntHelp')}
            title={t(rating === 'up' ? 'helped' : 'didntHelp')}
            className={cn(message.feedback === rating && 'bg-accent text-foreground')}
            onClick={() => rate.mutate(rating)}
          >
            <Icon aria-hidden />
          </Button>
        );
      })}
    </span>
  );
}

const citationsOf = (message: ChatMessage): Citation[] =>
  message.parts.flatMap((p) => (p.type === 'text' ? p.citations : []));

function AssistantMessage({
  message,
  chat,
  selected,
  onSelect,
  onAskChange,
}: {
  message: ChatMessage;
  chat: ChatDetail;
  selected: boolean;
  onSelect: () => void;
  onAskChange: (title: string) => void;
}) {
  const t = useTranslations('workstation.message');
  const sources = citationsOf(message);
  return (
    <article className="grid gap-2" aria-label={t('assistant')}>
      {message.parts.map((part: MessagePart, i) => {
        if (part.type === 'activity') return <ActivityLines key={i} items={part.items} />;
        if (part.type === 'text') {
          return part.text ? (
            <MessageText key={i} text={part.text} citations={part.citations} onSelect={onSelect} />
          ) : null;
        }
        const proposal = chat.proposals.find((p) => p.id === part.proposalId);
        return proposal ? (
          <ActionCard key={i} proposal={proposal} chatId={chat.id} onAskChange={onAskChange} />
        ) : null;
      })}
      <footer className="flex items-center gap-3 text-xs text-muted-foreground">
        {message.stopped && <span>{t('stopped')}</span>}
        <Feedback message={message} chatId={chat.id} />
        {sources.length > 0 && (
          <button
            type="button"
            className={cn('underline-offset-2 hover:underline', selected && 'text-foreground')}
            onClick={onSelect}
          >
            {t('sources', { count: sources.length })}
          </button>
        )}
      </footer>
    </article>
  );
}

function UserMessage({ text }: { text: string }) {
  const t = useTranslations('workstation.message');
  return (
    <article
      className="ml-auto max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground"
      aria-label={t('you')}
    >
      <p className="whitespace-pre-line">{text}</p>
    </article>
  );
}

const textOfUser = (message: ChatMessage) =>
  message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n');

interface Props {
  chatId: string | null;
  /** What a new chat is about; once there is a chat, its own context is used. */
  pin: Pin;
  onClearPin: () => void;
  onChatCreated: (id: string) => void;
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  /** Show the sources of the reply picked, on a screen where they are a tab of their own. */
  onShowSources: () => void;
}

/** The conversation: messages, the reply as it is written, action cards, and the message box. */
export function Conversation({
  chatId,
  pin,
  onClearPin,
  onChatCreated,
  selectedMessageId,
  onSelectMessage,
  onShowSources,
}: Props) {
  const t = useTranslations('workstation');
  const queryClient = useQueryClient();
  const chat = useChat(chatId);
  const [input, setInput] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef<string | null>(chatId);
  const sending = useRef(false);

  // Another chat was opened: start clean. (A chat made by sending keeps its words.)
  useEffect(() => {
    idRef.current = chatId;
    if (!sending.current) {
      setLive(null);
      setError(null);
      setInput('');
    }
  }, [chatId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.data?.messages.length, live?.reply, live?.activity.length]);

  const send = async (text: string) => {
    setError(null);
    setLive({ text, reply: '', activity: [] });
    const controller = new AbortController();
    abortRef.current = controller;
    sending.current = true;
    let started = false;
    try {
      let id = idRef.current;
      if (!id) {
        const created = await api(createChat, { body: { context: pin } });
        id = created.id;
        idRef.current = id;
        onChatCreated(id);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
      }
      for await (const event of streamReply(id, text, controller.signal)) {
        switch (event.type) {
          case 'start':
            started = true;
            setLive((l) => l && { ...l, userId: event.userMessage.id });
            break;
          case 'text':
            setLive((l) => l && { ...l, reply: l.reply + event.delta });
            break;
          case 'activity':
            setLive(
              (l) =>
                l && {
                  ...l,
                  activity: l.activity.some((a) => a.id === event.id)
                    ? l.activity.map((a) => (a.id === event.id ? { ...a, state: event.state } : a))
                    : [...l.activity, { id: event.id, label: event.label, state: event.state }],
                },
            );
            break;
          case 'card':
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat(id) });
            break;
          case 'done':
            onSelectMessage(event.message.id);
            break;
          case 'title':
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
            break;
          case 'error':
            setError(streamError(event.code, event.detail));
            break;
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      // A message that was refused before it was saved goes back into the box.
      if (!started) setInput((current) => current || text);
      if (idRef.current) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.chat(idRef.current) });
      }
      sending.current = false;
      abortRef.current = null;
      setLive(null);
    }
  };

  const stop = () => {
    const id = idRef.current;
    const controller = abortRef.current;
    if (!id) return;
    // The reply is kept as far as it got; if the server can't be told, closing the stream stops it.
    api(stopReply, { params: { id } }).catch(() => controller?.abort());
  };

  const askToChange = (title: string) => {
    setInput(t('card.changeText', { title }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const messages = (chat.data?.messages ?? []).filter((m) => m.id !== live?.userId);
  const empty = messages.length === 0 && !live;
  const context = chat.data?.context ?? pin;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PinChips pin={context} {...(!chatId && { onClear: onClearPin })} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {empty ? (
          <div className="mx-auto grid max-w-md gap-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('conversationEmpty')}</p>
            <ul className="grid gap-2">
              {(['one', 'two', 'three'] as const).map((key) => (
                <li key={key}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void send(t(`examples.${key}`))}
                  >
                    {t(`examples.${key}`)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl gap-5">
            {chat.data &&
              messages.map((m) =>
                m.sender === 'user' ? (
                  <UserMessage key={m.id} text={textOfUser(m)} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    chat={chat.data}
                    selected={m.id === selectedMessageId}
                    onSelect={() => {
                      onSelectMessage(m.id);
                      onShowSources();
                    }}
                    onAskChange={askToChange}
                  />
                ),
              )}
            {live && (
              <>
                <UserMessage text={live.text} />
                <article className="grid gap-2" aria-label={t('message.assistant')}>
                  {live.activity.length > 0 && (
                    <ul className="grid gap-0.5 text-xs text-muted-foreground">
                      {live.activity.map((a) => (
                        <li key={a.id} className="flex items-center gap-1.5">
                          {a.state === 'start' && (
                            <Loader2 className="size-3 animate-spin" aria-hidden />
                          )}
                          <span className={cn(a.state === 'error' && 'text-destructive')}>
                            {a.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {live.reply ? (
                    <MessageText text={live.reply} streaming />
                  ) : (
                    live.activity.every((a) => a.state !== 'start') && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                        {t('message.working')}
                      </p>
                    )
                  )}
                </article>
              </>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <div className="border-t p-4">
        <div className="mx-auto grid max-w-3xl gap-2">
          <ProblemMessage error={error ?? chat.error} />
          <Composer
            value={input}
            onChange={setInput}
            onSend={(text) => void send(text)}
            onStop={stop}
            replying={!!live}
            inputRef={inputRef}
          />
          <p className="text-xs text-muted-foreground">{t('composer.hint')}</p>
        </div>
      </div>
    </div>
  );
}
