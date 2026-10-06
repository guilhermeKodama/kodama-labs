"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { useAccounts, useCurrencies, type AccountRecord } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useSession } from "@/lib/api/session";
import { useFmt } from "@/lib/format/provider";
import { todayIn, type FormContext, type FormHolding } from "@/lib/ledger/entry-form";

interface HoldingRow extends FormHolding {
  currency: string;
}

/**
 * Everything the entry form reads from the catalog: accounts (archived
 * ones too, for entries that still use them), entities, base-currency
 * rates, the user's today and number parsing. `holdings` loads the broker
 * positions for "Já registrar a compra". `ready` once the catalog arrived.
 */
export function useFormContext({ holdings = false }: { holdings?: boolean } = {}): { ctx: FormContext; ready: boolean; accounts: AccountRecord[] } {
  const fmt = useFmt();
  const me = useSession().data;
  const accounts = useAccounts(true);
  const currencies = useCurrencies();
  const positions = useQuery({
    queryKey: keys.holdings("all"),
    queryFn: async () => (await apiGet<{ holdings: HoldingRow[] }>("/api/v2/holdings")).holdings,
    enabled: holdings,
  });

  const ctx = useMemo<FormContext>(() => {
    const baseCurrency = me?.baseCurrency ?? currencies.data?.baseCurrency ?? "BRL";
    const rates: Record<string, number> = {};
    for (const currency of currencies.data?.currencies ?? []) {
      // manualRate is units of the currency per one unit of the base.
      if (currency.manualRate > 0) rates[currency.code] = currency.code === baseCurrency ? 1 : 1 / currency.manualRate;
    }
    return {
      accounts: accounts.data ?? [],
      entities: me?.entities ?? [],
      baseCurrency,
      rates,
      today: todayIn(me?.timezone ?? fmt.prefs.timezone),
      parseNumber: (text: string) => fmt.parseNumber(text),
      holdings: positions.data ?? [],
    };
  }, [me, accounts.data, currencies.data, positions.data, fmt]);

  return { ctx, ready: !!me && !!accounts.data, accounts: accounts.data ?? [] };
}
