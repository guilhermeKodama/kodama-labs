"use client";

import { createContext, useCallback, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";
import type { SessionExpiry } from "./session-expiry";

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
  /** UI text size ("sm" | "md" | "lg"); absent before the user_text_size migration. */
  textSize?: string;
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

/** The QueryClient's session-expiry handler (session-expiry.ts), provided by QueryProvider. */
export const SessionExpiryContext = createContext<SessionExpiry | null>(null);

export function useSessionExpiry(): SessionExpiry | null {
  return useContext(SessionExpiryContext);
}

/** "Sair": ends the session, drops every cached answer and goes to /login. */
export function useSignOut(): () => void {
  const expiry = useSessionExpiry();
  return useCallback(() => expiry?.signOut(), [expiry]);
}
