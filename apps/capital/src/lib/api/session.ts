"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiPost } from "./client";
import { keys } from "./keys";

export { isUnauthenticated } from "./client";

export interface SessionEntity {
  id: string;
  kind: "personal" | "business";
  name: string;
  defaultCurrency: string;
  color: string | null;
}

/** GET /v2/me: the user, display preferences and the entities the UI scopes by. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  baseCurrency: string;
  theme: string;
  dateFormat: string;
  numberFormat: string;
  timezone: string;
  /** UI language ("pt-BR" | "en"); absent before the new_ui migration. */
  locale?: string;
  fxAutoUpdate?: boolean;
  personalEntityId: string;
  entities: SessionEntity[];
}

export function useSession() {
  return useQuery({
    queryKey: keys.me(),
    queryFn: () => api<SessionUser>("/api/v2/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<unknown>("/api/v2/auth/logout"),
    onSettled: async () => {
      queryClient.clear();
    },
  });
}
