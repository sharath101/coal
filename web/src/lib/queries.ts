'use client';

import {
  getActivity,
  getMe,
  getProject,
  getProjectRoute,
  getStep,
  listProductLines,
  listProjects,
  listRoles,
  listTasks,
  listUsers,
  type ProjectSummary,
} from '@coal/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** After any workflow action, what the person sees of a project, its tasks and the lists is stale. */
export function useRefreshProject(id: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    ]);
}
