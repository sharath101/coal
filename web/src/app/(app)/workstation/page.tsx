'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useState, type ReactNode } from 'react';
import { ChatList } from '@/components/chat/chat-list';
import { Conversation } from '@/components/chat/conversation';
import { SamplePdf } from '@/components/chat/template-detail';
import { DraftPdf } from '@/components/chat/writing-cards';
import { SourcesPane } from '@/components/chat/sources-pane';
import { useChat } from '@/lib/queries';
import { fromParams, workstationHref } from '@/lib/workstation';
import { cn } from '@/lib/utils';

type Pane = 'chats' | 'chat' | 'sources';
const PANES: Pane[] = ['chats', 'chat', 'sources'];

export default function WorkstationPage() {
  return (
    <Suspense fallback={null}>
      <Workstation />
    </Suspense>
  );
}

/**
 * The Workstation: my tasks and projects with their chats, the conversation, and the sources
 * behind a reply (docs/workstation-and-ai.md#the-workstation). The address says which chat is
 * open (`?chat=`), or what a new chat is about (`?project=&step=&document=&task=&widget=`), so
 * "Ask AI" on other pages is a link. On a narrow screen the three panes are tabs.
 */
function Workstation() {
  const t = useTranslations('workstation');
  const router = useRouter();
  const { chatId, pin, say } = fromParams(useSearchParams());
  const [pane, setPane] = useState<Pane>('chat');
  const [picked, setPicked] = useState<string | null>(null);
  const chat = useChat(chatId);
  const messages = chat.data?.messages ?? [];
  const withSources = messages.filter(
    (m) =>
      m.sender === 'assistant' && m.parts.some((p) => p.type === 'text' && p.citations.length > 0),
  );
  // The reply the person picked, or the latest one that has sources.
  const selected =
    messages.find((m) => m.id === picked) ??
    withSources.at(-1) ??
    [...messages].reverse().find((m) => m.sender === 'assistant');

  // What the right-hand pane previews: the sample PDF of a template card, or a draft the assistant
  // saved. The one asked for, or the latest.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previews: { key: string; title: string; node: ReactNode }[] = [
    ...(chat.data?.proposals ?? [])
      .filter((p) => p.status === 'pending' || p.status === 'confirmed')
      .flatMap((p) =>
        p.preview.actions.flatMap((a) =>
          a.detail?.kind === 'template' && a.detail.sampleFileId
            ? [
                {
                  key: `file:${a.detail.sampleFileId}`,
                  title: a.detail.name,
                  node: <SamplePdf fileId={a.detail.sampleFileId} title={a.detail.name} />,
                },
              ]
            : [],
        ),
      ),
    ...messages.flatMap((m) =>
      m.parts.flatMap((p) =>
        p.type === 'draft'
          ? [
              {
                key: `draft:${p.documentId}:${p.versionNo}`,
                title: p.title,
                node: <DraftPdf draft={p} />,
              },
            ]
          : [],
      ),
    ),
  ];
  const preview = previews.find((p) => p.key === previewKey) ?? previews.at(-1);

  const show = (which: Pane) => cn(pane === which ? 'flex' : 'hidden', 'lg:flex');

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-6rem)]">
      <nav aria-label={t('panes')} className="grid grid-cols-3 gap-1 border-b p-2 lg:hidden">
        {PANES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pane === p}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              pane === p ? 'bg-muted' : 'text-muted-foreground',
            )}
            onClick={() => setPane(p)}
          >
            {t(`tabs.${p}`)}
          </button>
        ))}
      </nav>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_20rem] lg:grid-rows-1">
        <aside className={cn(show('chats'), 'min-h-0 flex-col overflow-y-auto border-r p-4')}>
          <ChatList activeId={chatId} />
        </aside>
        <section className={cn(show('chat'), 'min-h-[28rem] min-w-0 flex-col lg:min-h-0')}>
          <Conversation
            chatId={chatId}
            pin={pin}
            say={say}
            onClearPin={() => router.replace(workstationHref({}))}
            onChatCreated={(id) => router.replace(`/workstation?chat=${id}`)}
            selectedMessageId={selected?.id ?? null}
            onSelectMessage={setPicked}
            onShowSources={() => setPane('sources')}
            onPreview={(key) => {
              setPreviewKey(key);
              setPane('sources');
            }}
          />
        </section>
        <aside className={cn(show('sources'), 'min-h-0 flex-col overflow-y-auto border-l p-4')}>
          <SourcesPane
            message={selected}
            preview={preview && { title: preview.title, node: preview.node }}
          />
        </aside>
      </div>
    </div>
  );
}
