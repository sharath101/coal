import type { ChatContext } from '@coal/shared';

/** What a chat is about. */
export type Pin = ChatContext;

export const isPinned = (pin: Pin): boolean => Object.values(pin).some(Boolean);

/**
 * The Workstation with a new chat about something: "Ask AI" and "Open in Workstation" use it.
 * `say` is typed into the message box for the person to read and send.
 */
export function workstationHref(pin: Pin, say?: string): string {
  const params = new URLSearchParams();
  if (pin.projectId) params.set('project', pin.projectId);
  if (pin.stepKey) params.set('step', pin.stepKey);
  if (pin.documentId) params.set('document', pin.documentId);
  if (pin.taskId) params.set('task', pin.taskId);
  if (pin.widgetKey) params.set('widget', pin.widgetKey);
  if (say) params.set('say', say);
  const query = params.toString();
  return query ? `/workstation?${query}` : '/workstation';
}

/** The chat the address names, or what a new chat is pinned to. */
export function fromParams(params: URLSearchParams): {
  chatId: string | null;
  pin: Pin;
  say: string;
} {
  const pin: Pin = {};
  const project = params.get('project');
  const step = params.get('step');
  const document = params.get('document');
  const task = params.get('task');
  const widget = params.get('widget');
  if (project) pin.projectId = project;
  if (project && step) pin.stepKey = step;
  if (document) pin.documentId = document;
  if (task) pin.taskId = task;
  if (widget) pin.widgetKey = widget as Pin['widgetKey'];
  return { chatId: params.get('chat'), pin, say: params.get('say') ?? '' };
}
