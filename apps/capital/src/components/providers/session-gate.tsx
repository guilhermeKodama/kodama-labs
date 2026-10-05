"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Btn } from "@/components/cap";
import { useSession, useSessionExpiry } from "@/lib/api/session";
import { isSessionExpired } from "@/lib/api/session-expiry";
import { useErrorMessage } from "@/lib/api/use-app-mutation";

/**
 * Renders the signed-in app once /me answers. A 401 is handled by the
 * QueryClient (logout and /login?redirect=…, see query-provider.tsx), so
 * here it only keeps the app hidden while that happens. Any other failure
 * shows a localized message with a retry.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const expiry = useSessionExpiry();
  const t = useTranslations("shell.session");
  const common = useTranslations("common");
  const errorText = useErrorMessage();

  // Signed in (again): a later expiry is handled anew.
  useEffect(() => {
    if (session.data) expiry?.reset();
  }, [session.data, expiry]);

  if (session.data) return children;
  if (session.isError && !isSessionExpired(session.error)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-editor px-4 text-center text-fg-1">
        <span className="text-[13px] font-medium">{t("loadFailed")}</span>
        <span className="text-[12.5px] text-fg-3">{errorText(session.error)}</span>
        <Btn className="mt-1" disabled={session.isFetching} onClick={() => void session.refetch()}>
          {common("retry")}
        </Btn>
      </div>
    );
  }
  return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">…</div>;
}
