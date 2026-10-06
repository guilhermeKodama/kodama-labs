import { fromZonedTime } from "date-fns-tz";
import type { AutoFxSource } from "./fx-source";

/** fetch, injectable so tests never reach the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A rate as the Currency table stores it: units of `code` per one unit of the base currency, and when it was published. */
export interface FxQuote {
  code: string;
  manualRate: number;
  quotedAt: Date;
  source: AutoFxSource;
}

const PTAX_API = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";
const FRANKFURTER_API = "https://api.frankfurter.dev/v1/latest";
/** Days of bulletins requested from the BCB: wide enough to reach the last business day across any run of weekends and holidays. */
const PTAX_LOOKBACK_DAYS = 14;
/** The BCB publishes PTAX in Brasília time, which has been UTC-3 all year since 2019. */
const BRASILIA = "America/Sao_Paulo";
/** The ECB publishes its reference rates at around 16:00 CET. */
const ECB_PUBLISH_TIME = "16:00:00";

/** The BCB API's date parameter: MM-DD-YYYY of the Brasília calendar day of `at`. */
export function bcbDate(at: Date): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: BRASILIA, year: "numeric", month: "2-digit", day: "2-digit" }).format(at).split("-");
  return `${m}-${d}-${y}`;
}

/** Bulletins of one currency from `from` to `to` (Brasília days), selling rate and timestamp only. */
export function ptaxPeriodUrl(code: string, from: Date, to: Date): string {
  const params = [
    `@moeda='${code}'`,
    `@dataInicial='${bcbDate(from)}'`,
    `@dataFinalCotacao='${bcbDate(to)}'`,
    "$format=json",
    "$select=cotacaoVenda,dataHoraCotacao,tipoBoletim",
  ].join("&");
  return `${PTAX_API}/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${params}`;
}

/** "2026-09-25 13:10:17.447657", Brasília time, as an instant. */
export function parseBcbTimestamp(value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  if (!m) return null;
  const date = fromZonedTime(`${m[1]}T${m[2]}`, BRASILIA);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface PtaxBulletin {
  cotacaoVenda?: unknown;
  dataHoraCotacao?: unknown;
  tipoBoletim?: unknown;
}

/**
 * The PTAX in force at `now`: the latest closing bulletin ("Fechamento")
 * published up to then, as BRL per unit. Before today's close (about 13:10
 * in Brasília), and on weekends and holidays, that is the last business
 * day's. Opening and intermediate bulletins are previews and are ignored.
 */
export function latestPtaxClose(body: unknown, now: Date): { brlPerUnit: number; quotedAt: Date } | null {
  const bulletins = (body as { value?: PtaxBulletin[] } | null)?.value;
  if (!Array.isArray(bulletins)) return null;
  let best: { brlPerUnit: number; quotedAt: Date } | null = null;
  for (const b of bulletins) {
    if (typeof b.tipoBoletim !== "string" || !/^fechamento/i.test(b.tipoBoletim)) continue;
    if (typeof b.cotacaoVenda !== "number" || !(b.cotacaoVenda > 0) || typeof b.dataHoraCotacao !== "string") continue;
    const quotedAt = parseBcbTimestamp(b.dataHoraCotacao);
    if (!quotedAt || quotedAt.getTime() > now.getTime()) continue;
    if (!best || quotedAt.getTime() > best.quotedAt.getTime()) best = { brlPerUnit: b.cotacaoVenda, quotedAt };
  }
  return best;
}

/** PTAX selling rate of `code` against BRL (BCB Olinda), walking back to the last business day with a closing bulletin. */
export async function fetchPtaxQuote(code: string, now: Date, fetcher: FetchLike): Promise<FxQuote> {
  const from = new Date(now.getTime() - PTAX_LOOKBACK_DAYS * 86_400_000);
  const res = await fetcher(ptaxPeriodUrl(code, from, now), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`PTAX ${code}: HTTP ${res.status}`);
  const close = latestPtaxClose(await res.json(), now);
  if (!close) throw new Error(`PTAX ${code}: no closing bulletin in the last ${PTAX_LOOKBACK_DAYS} days`);
  return { code, manualRate: 1 / close.brlPerUnit, quotedAt: close.quotedAt, source: "ptax" };
}

interface FrankfurterBody {
  base?: unknown;
  date?: unknown;
  rates?: unknown;
}

/** Frankfurter's latest ECB reference rates, as quotes against `base`; codes the ECB does not publish are left out. */
export function parseFrankfurter(body: unknown, codes: readonly string[]): FxQuote[] {
  const { date, rates } = (body ?? {}) as FrankfurterBody;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !rates || typeof rates !== "object") return [];
  const quotedAt = fromZonedTime(`${date}T${ECB_PUBLISH_TIME}`, "Europe/Berlin");
  return codes.flatMap((code) => {
    const rate = (rates as Record<string, unknown>)[code];
    return typeof rate === "number" && rate > 0 ? [{ code, manualRate: rate, quotedAt, source: "ecb" as const }] : [];
  });
}

/** ECB reference rates (Frankfurter) of `codes` in units per one `base`. */
export async function fetchEcbQuotes(base: string, codes: readonly string[], fetcher: FetchLike): Promise<FxQuote[]> {
  const res = await fetcher(`${FRANKFURTER_API}?base=${encodeURIComponent(base)}&symbols=${codes.map(encodeURIComponent).join(",")}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Frankfurter ${base}: HTTP ${res.status}`);
  return parseFrankfurter(await res.json(), codes);
}
