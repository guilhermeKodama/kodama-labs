"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";

/** The rate the ledger would use on `date`: prior-day PTAX when the base is BRL. */
export function useDatedFxRate(
  currency: string | null | undefined,
  date: string,
  baseCurrency: string,
) {
  const code = currency && currency !== baseCurrency ? currency : null;
  return useQuery({
    queryKey: ["fx-dated", code, date],
    enabled: !!code && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 5 * 60_000,
    queryFn: () =>
      apiGet<{ code: string; date: string; rate: number }>(
        `/api/v2/currencies/${code}/rate`,
        { date },
      ),
  });
}
