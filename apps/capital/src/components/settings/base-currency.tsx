"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiPatch } from "@/lib/api/client";
import { useSession, type SessionUser } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Changing the base currency (Perfil and Moedas e câmbio). With entries
 * already in the ledger the server refuses (409 user.base_currency_locked);
 * the dialog explains what changes and resends with force.
 */
export function useBaseCurrencyChange() {
  const t = useTranslations("settings.prefs.baseConfirm");
  const me = useSession().data;
  const [pending, setPending] = useState<{ currency: string; count: number } | null>(null);
  const save = useAppMutation({
    event: "settings.write",
    mutationFn: (body: { baseCurrency: string; force?: boolean }) => apiPatch<SessionUser>("/api/v2/me", body),
    onSuccess: () => setPending(null),
    onError: (error, body) => {
      if (error instanceof ApiError && error.code === "user.base_currency_locked" && !body.force) {
        setPending({ currency: body.baseCurrency, count: Number(error.params.count ?? 0) });
        return true;
      }
    },
  });
  const change = (currency: string) => {
    if (currency && currency !== me?.baseCurrency) save.mutate({ baseCurrency: currency });
  };
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={t("title", { currency: pending?.currency ?? "" })}
      desc={t("desc", { count: pending?.count ?? 0, current: me?.baseCurrency ?? "" })}
      confirmLabel={t("confirm")}
      pending={save.isPending}
      onConfirm={() => pending && save.mutate({ baseCurrency: pending.currency, force: true })}
    />
  );
  return { change, dialog, saving: save.isPending };
}
