"use client";

import { useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, apiPost } from "@/lib/api/client";
import { SessionExpiryContext } from "@/lib/api/session";
import { createSessionExpiry } from "@/lib/api/session-expiry";

/**
 * The app's QueryClient. Any query or mutation answering 401 means the
 * session is gone: the session-expiry handler logs out, clears the cache
 * and goes to /login?redirect=… once (session-expiry.ts). Leaving is a
 * full page load, so nothing of the old session stays in memory.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [{ client, expiry }] = useState(() => {
    const expiry = createSessionExpiry({
      logout: () => apiPost<unknown>("/api/v2/auth/logout"),
      clear: () => client.clear(),
      navigate: (href) => window.location.replace(href),
      currentUrl: () => `${window.location.pathname}${window.location.search}`,
    });
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: (error) => void expiry.handle(error) }),
      mutationCache: new MutationCache({ onError: (error) => void expiry.handle(error) }),
      defaultOptions: {
        queries: {
          staleTime: 15_000,
          // One retry for server and network errors; a 4xx will not change on its own.
          retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        },
      },
    });
    return { client, expiry };
  });
  return (
    <SessionExpiryContext.Provider value={expiry}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionExpiryContext.Provider>
  );
}
