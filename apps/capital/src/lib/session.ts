"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiPost, ApiError } from "@/lib/api";

export interface SessionEntity {
  id: string;
  kind: "personal" | "business";
  name: string;
  defaultCurrency: string;
  color: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  baseCurrency: string;
  theme: string;
  dateFormat: string;
  numberFormat: string;
  timezone: string;
  personalEntityId: string;
  entities: SessionEntity[];
}

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<SessionUser>("/api/v2/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<unknown>("/api/v2/auth/logout", {}),
    onSettled: async () => {
      queryClient.clear();
    },
  });
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
