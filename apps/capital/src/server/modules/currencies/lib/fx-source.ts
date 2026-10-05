/**
 * Where a currency's rate comes from. `ptax` and `ecb` are refreshed by the
 * update-rates cron while the user's fxAutoUpdate is on; `manual` is a rate
 * the user typed, which the cron never overwrites.
 *
 * Dependency-free: client code may import it.
 */
export const FX_SOURCES = ["ptax", "ecb", "manual"] as const;
export type FxSource = (typeof FX_SOURCES)[number];
export type AutoFxSource = Exclude<FxSource, "manual">;

/** Currencies the Banco Central publishes a PTAX rate for (BCB Olinda `Moedas`), all quoted in BRL. */
export const PTAX_CURRENCIES = ["AUD", "CAD", "CHF", "DKK", "EUR", "GBP", "JPY", "NOK", "SEK", "USD"] as const;

/** The automatic source of a currency's rate on a base: PTAX for what the BCB quotes against BRL, the ECB (Frankfurter) for the rest. */
export function autoSourceFor(baseCurrency: string, code: string): AutoFxSource {
  return baseCurrency === "BRL" && (PTAX_CURRENCIES as readonly string[]).includes(code) ? "ptax" : "ecb";
}
