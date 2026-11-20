import {
  API_BASE_PATH,
  ApiError,
  ChatStreamEvent,
  fillPath,
  readProblem,
  sendMessage,
} from '@coal/shared';

/**
 * Sends a message and yields the reply as it is written, from the event stream the API sends when
 * asked for `text/event-stream` (docs/api.md#streaming-a-reply). A refusal before the stream
 * starts (a busy chat, today's budget used) is thrown as an ApiError, like any request.
 */
export async function* streamReply(
  chatId: string,
  text: string,
  signal: AbortSignal,
  fileIds: string[] = [],
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(API_BASE_PATH + fillPath(sendMessage.path, { id: chatId }), {
    method: 'POST',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ text, fileIds }),
    credentials: 'include',
    signal,
  });
  if (!response.ok) throw new ApiError(await readProblem(response));
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const blocks = buffered.split('\n\n');
      buffered = blocks.pop() ?? '';
      for (const block of blocks) {
        const data = block
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice('data: '.length);
        if (!data) continue;
        const event = ChatStreamEvent.safeParse(JSON.parse(data));
        if (event.success) yield event.data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
