'use client';

import {
  getActivity,
  getDocument,
  getMe,
  getProcess,
  getProject,
  getProjectRoute,
  getStep,
  getTimeline,
  getWidget,
  listAttachments,
  listDeviations,
  listDocumentTypes,
  listNotifications,
  listProductLines,
  listProjectDocuments,
  listProjects,
  listRoles,
  listSignatureRequests,
  listSources,
  listTasks,
  listTemplates,
  listUsers,
  listWidgets,
  type DocumentDetail,
  type EndpointOutput,
  type ProjectSummary,
  type WidgetKey,
} from '@coal/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './api';

export const queryKeys = {
  me: ['me'] as const,
  roles: ['roles'] as const,
  productLines: ['product-lines'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  route: (id: string) => ['project', id, 'route'] as const,
  step: (id: string, key: string) => ['project', id, 'step', key] as const,
  activity: (id: string) => ['project', id, 'activity'] as const,
  tasks: ['tasks'] as const,
  people: ['people'] as const,
  // Under the project's key, so refreshing a project also refreshes what hangs on it.
  projectDocuments: (id: string) => ['project', id, 'documents'] as const,
  attachments: (id: string) => ['project', id, 'attachments'] as const,
  sources: (id: string) => ['project', id, 'sources'] as const,
  documents: ['document'] as const,
  document: (id: string, version: number | null) => ['document', id, version ?? 'latest'] as const,
  documentTypes: ['document-types'] as const,
  templates: ['templates'] as const,
  signatureRequests: ['signature-requests'] as const,
  widgets: ['widgets'] as const,
  widget: (key: string) => ['widgets', key] as const,
  deviations: ['deviations'] as const,
  notifications: ['notifications'] as const,
  process: (key: string) => ['process', key] as const,
  projectOptions: ['projects', 'options'] as const,
  // Under the project's key, so refreshing a project also refreshes its dates.
  timeline: (id: string) => ['project', id, 'timeline'] as const,
};

export const useMe = () => useQuery({ queryKey: queryKeys.me, queryFn: () => api(getMe) });

export const useRoles = () =>
  useQuery({ queryKey: queryKeys.roles, queryFn: () => api(listRoles), staleTime: Infinity });

export const useProductLines = () =>
  useQuery({
    queryKey: queryKeys.productLines,
    queryFn: async () => (await api(listProductLines)).items,
    staleTime: Infinity,
  });

/** Everyone in the directory, for pickers (up to 100 people until the directory has search). */
export const usePeople = () =>
  useQuery({
    queryKey: queryKeys.people,
    queryFn: async () => (await api(listUsers, { query: { limit: 100 } })).items,
  });

export function useProjects(status: ProjectSummary['status'] | '') {
  return useInfiniteQuery({
    queryKey: [...queryKeys.projects, status],
    queryFn: ({ pageParam }) =>
      api(listProjects, {
        query: {
          limit: 20,
          ...(pageParam && { cursor: pageParam }),
          ...(status && { 'filter[status]': status }),
        },
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const useProject = (id: string) =>
  useQuery({ queryKey: queryKeys.project(id), queryFn: () => api(getProject, { params: { id } }) });

export const useProjectRoute = (id: string) =>
  useQuery({
    queryKey: queryKeys.route(id),
    queryFn: () => api(getProjectRoute, { params: { id } }),
  });

export const useStepDetail = (id: string, key: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.step(id, key),
    queryFn: () => api(getStep, { params: { id, key } }),
    enabled,
  });

export function useActivity(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.activity(id),
    queryFn: ({ pageParam }) =>
      api(getActivity, {
        params: { id },
        query: { limit: 15, ...(pageParam && { cursor: pageParam }) },
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useTasks(scope: 'mine' | 'queue', status: 'active' | 'closed') {
  return useInfiniteQuery({
    queryKey: [...queryKeys.tasks, scope, status],
    queryFn: ({ pageParam }) =>
      api(listTasks, {
        query: {
          limit: 25,
          scope,
          'filter[status]': status,
          ...(pageParam && { cursor: pageParam }),
        },
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const flatten = <T>(pages: { items: T[] }[] | undefined): T[] =>
  pages?.flatMap((p) => p.items) ?? [];

/** Each kind of document, with its active template. Changes only when a template is activated. */
export const useDocumentTypes = () =>
  useQuery({
    queryKey: queryKeys.documentTypes,
    queryFn: async () => (await api(listDocumentTypes)).items,
  });

/** The template library. The API returns drafts and retired versions only to the VP and the Head. */
export const useTemplates = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.templates,
    queryFn: async () => (await api(listTemplates)).items,
    enabled,
  });

/** One query for all of a project's documents; the step cards group them by step. */
export const useProjectDocuments = (id: string) =>
  useQuery({
    queryKey: queryKeys.projectDocuments(id),
    queryFn: async () => (await api(listProjectDocuments, { params: { id } })).items,
  });

export const useAttachments = (id: string) =>
  useQuery({
    queryKey: queryKeys.attachments(id),
    queryFn: async () => (await api(listAttachments, { params: { id }, query: {} })).items,
  });

export const useSources = (id: string) =>
  useQuery({
    queryKey: queryKeys.sources(id),
    queryFn: async () => (await api(listSources, { params: { id }, query: {} })).items,
  });

/** A document with one version in full: the latest, or `version`. */
export const useDocument = (id: string, version: number | null) =>
  useQuery({
    queryKey: queryKeys.document(id, version),
    queryFn: () => api(getDocument, { params: { id }, query: version ? { version } : {} }),
    // Keeps the page on screen while another version loads.
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useSignatureRequests = () =>
  useQuery({
    queryKey: queryKeys.signatureRequests,
    queryFn: async () => (await api(listSignatureRequests)).items,
  });

/**
 * After a change to a document the API returns the whole document: keep it as the page's data,
 * and refresh everything else that shows it (other versions, lists, the step, the task lists).
 */
export function useAfterDocumentChange(projectId: string) {
  const queryClient = useQueryClient();
  return async (doc: DocumentDetail) => {
    const key = queryKeys.document(doc.id, doc.current?.versionNo ?? null);
    queryClient.setQueryData(key, doc);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.documents, doc.id],
        predicate: (q) => q.queryKey[2] !== key[2],
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.signatureRequests }),
    ]);
  };
}

/** After any workflow action, what the person sees of a project, its tasks and the lists is stale. */
export function useRefreshProject(id: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      // Submitting or approving a step makes and signs its sign-off record.
      queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
      queryClient.invalidateQueries({ queryKey: queryKeys.signatureRequests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.widgets }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deviations }),
    ]);
}

/**
 * After work or dates change anywhere (a task done, a deviation recorded, a signature given),
 * the person's lists, the dates of every project and every widget are stale.
 */
export function useRefreshWork() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        queryKeys.tasks,
        queryKeys.projects,
        // Every project page, with its route, dates and documents.
        ['project'],
        queryKeys.documents,
        queryKeys.signatureRequests,
        queryKeys.widgets,
        queryKeys.deviations,
        queryKeys.notifications,
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/** What picks a widget's data: the card (compact) or the panel (expanded), a tab and filters. */
export type WidgetInfo = EndpointOutput<typeof listWidgets>['widgets'][number];

export interface WidgetParams {
  view: 'compact' | 'expanded';
  tab?: string | null;
  filters?: Partial<Record<WidgetFilter, string>>;
}

export const WIDGET_FILTERS = [
  'project',
  'step',
  'kind',
  'due',
  'line',
  'stage',
  'health',
] as const;
export type WidgetFilter = (typeof WIDGET_FILTERS)[number];

/** The widgets I may use, in my layout's order. Changes only with my role. */
export const useWidgetLayout = () =>
  useQuery({ queryKey: [...queryKeys.widgets, 'layout'], queryFn: () => api(listWidgets) });

export function useWidget(key: WidgetKey, params: WidgetParams, enabled = true) {
  const filters = Object.entries(params.filters ?? {}).filter(([, v]) => v) as [
    WidgetFilter,
    string,
  ][];
  return useQuery({
    queryKey: [...queryKeys.widget(key), params.view, params.tab ?? '', filters],
    queryFn: () =>
      api(getWidget, {
        params: { key },
        query: {
          view: params.view,
          ...(params.tab && { tab: params.tab }),
          ...Object.fromEntries(filters.map(([name, value]) => [`filter[${name}]`, value])),
        },
      }),
    enabled,
    // Keeps the table on screen while another tab or filter loads.
    placeholderData: keepPreviousData,
  });
}

/** Every project, for a project filter. Up to 100 until the list has search. */
export const useProjectOptions = () =>
  useQuery({
    queryKey: queryKeys.projectOptions,
    queryFn: async () => (await api(listProjects, { query: { limit: 100 } })).items,
  });

export const useTimeline = (id: string) =>
  useQuery({
    queryKey: queryKeys.timeline(id),
    queryFn: () => api(getTimeline, { params: { id } }),
  });

export const useDeviations = (projectId: string) =>
  useQuery({
    queryKey: [...queryKeys.deviations, projectId],
    queryFn: async () =>
      (await api(listDeviations, { query: { 'filter[project]': projectId, limit: 100 } })).items,
  });

/** My latest notifications, and how many are unread. */
export const useNotifications = () =>
  useQuery({
    queryKey: [...queryKeys.notifications, 'latest'],
    queryFn: () => api(listNotifications, { query: { limit: 10 } }),
  });

/** A process's definition: who the launch step is, for instance. Changes only with a new version. */
export const useProcess = (key: string) =>
  useQuery({
    queryKey: queryKeys.process(key),
    queryFn: () => api(getProcess, { params: { key } }),
    staleTime: Infinity,
  });
