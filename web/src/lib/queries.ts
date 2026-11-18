'use client';

import { getMe, listProductLines, listRoles } from '@coal/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const queryKeys = {
  me: ['me'] as const,
  roles: ['roles'] as const,
  productLines: ['product-lines'] as const,
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
