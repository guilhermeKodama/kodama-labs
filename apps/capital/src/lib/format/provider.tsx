"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { useSession } from "@/lib/api/session";
import { createFormatter, type Formatter } from "./formatter";

const FormatContext = createContext<Formatter>(createFormatter());

/**
 * Formatter for the signed-in user: number and date formats, timezone and
 * base currency from /me, language from the active next-intl locale.
 * Before the session loads (and on login) it uses the signup defaults.
 */
export function FormatProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const me = useSession().data;
  const numberFormat = me?.numberFormat;
  const dateFormat = me?.dateFormat;
  const timezone = me?.timezone;
  const baseCurrency = me?.baseCurrency;
  const formatter = useMemo(
    () => createFormatter({ numberFormat, dateFormat, timezone, baseCurrency, locale }),
    [numberFormat, dateFormat, timezone, baseCurrency, locale],
  );
  return <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>;
}

/** The formatter of the current user (defaults outside <FormatProvider>). */
export function useFmt(): Formatter {
  return useContext(FormatContext);
}
