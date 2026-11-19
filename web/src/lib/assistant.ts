'use client';

import {
  API_BASE_PATH,
  ChatEvent,
  confirmProposal,
  createChat,
  getAiModels,
  getChat,
  listChats,
  rejectProposal,
} from '@coal/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The Workstation's assistant: chats, the model table, streaming replies and action cards. */

export const assistantKeys = {
  models: ['ai', 'models'] as const,
  chats: ['ai', 'chats'] as const,
  chat: (id: string) => ['ai', 'chat', id] as const,
};

export const useAiModels = () =>
  useQuery({ queryKey: assistantKeys.models, queryFn: () => api(getAiModels) });

export const useChats = () =>
  useQuery({ queryKey: assistantKeys.chats, queryFn: async () => (await api(listChats)).items });

export const useChat = (id: string | null) =>
  useQuery({
    queryKey: assistantKeys.chat(id ?? ''),
    queryFn: () => api(getChat, { params: { id: id! } }),
    enabled: !!id,
  });

export function useCreateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId?: string }) => api(createChat, { body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.chats }),
  });
}

export function useCardDecision(chatId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) =>
      api(confirm ? confirmProposal : rejectProposal, { params: { id } }),
    onSuccess: async () => {
      if (chatId) await queryClient.invalidateQueries({ queryKey: assistantKeys.chat(chatId) });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export const draftFileUrl = (id: string, format: 'pdf' | 'docx') =>
  `${API_BASE_PATH}/ai/drafts/${id}/file?format=${format}`;

/**
 * Sends a message and reads the reply as Server-Sent Events, calling `onEvent` for each one.
 * Resolves when the stream ends.
 */
export async function streamMessage(
  chatId: string,
  body: { text: string; purpose?: string },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_PATH}/ai/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `The assistant couldn't start (${response.status}).`;
    try {
      const problem = (await response.json()) as { detail?: string; title?: string };
      message = problem.detail ?? problem.title ?? message;
    } catch {
      // Not a problem response; keep the generic message.
    }
    onEvent({ type: 'error', code: 'AI_FAILED', message });
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        const parsed = ChatEvent.safeParse(JSON.parse(data));
        if (parsed.success) onEvent(parsed.data);
      }
      end = buffer.indexOf('\n\n');
    }
  }
}
