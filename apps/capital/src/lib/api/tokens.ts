"use client";

import { useQuery } from "@tanstack/react-query";
import type { SerializedApiToken } from "@capital/server/modules/api-tokens/services/tokens";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import { keys } from "./keys";
import { useAppMutation } from "./use-app-mutation";

export type ApiTokenRecord = SerializedApiToken;

/** Active API tokens (masked), newest first, with the MCP clients seen on each. */
export function useApiTokens() {
  return useQuery({
    queryKey: keys.apiTokens(),
    queryFn: async () => (await apiGet<{ tokens: ApiTokenRecord[] }>("/api/v2/api-tokens")).tokens,
  });
}

/** The response's `token` is the only time the plaintext exists. */
export function useCreateApiToken() {
  return useAppMutation({
    event: "tokens.write",
    mutationFn: (input: { name?: string | null; readOnly?: boolean }) => apiPost<{ token: string; apiToken: ApiTokenRecord }>("/api/v2/api-tokens", input),
  });
}

export function useUpdateApiToken() {
  return useAppMutation({
    event: "tokens.write",
    mutationFn: ({ id, ...patch }: { id: string; readOnly?: boolean; name?: string }) => apiPatch<ApiTokenRecord>(`/api/v2/api-tokens/${id}`, patch),
  });
}

export function useRevokeApiToken() {
  return useAppMutation({
    event: "tokens.write",
    mutationFn: (id: string) => apiDelete<{ ok: true; id: string }>(`/api/v2/api-tokens/${id}`),
  });
}
