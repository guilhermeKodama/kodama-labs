/**
 * Banco Central do Brasil SGS time series (api.bcb.gov.br), the only
 * network access of the benchmarks. Tests pass their own `fetchImpl`.
 *
 * - 12: CDI, daily rate in % per day (one value per business day);
 * - 433: IPCA, monthly change in % (dated the 1st of the month).
 */

export const SGS_SERIES = { cdi: 12, ipca: 433 } as const;
export type BenchmarkSeries = keyof typeof SGS_SERIES;

export interface SgsValue {
  /** UTC midnight of the day the value refers to. */
  date: Date;
  /** As published: percent (0.040168 = 0.040168%). */
  value: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function sgsUrl(code: number, from: Date, to: Date): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${ddmmyyyy(from)}&dataFinal=${ddmmyyyy(to)}`;
}

/** Parses the SGS JSON ([{data: "dd/MM/yyyy", valor: "0.040168"}]); rows that do not parse are skipped. */
export function parseSgs(body: unknown): SgsValue[] {
  if (!Array.isArray(body)) throw new Error("SGS: unexpected response");
  const out: SgsValue[] = [];
  for (const row of body) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String((row as { data?: unknown })?.data ?? ""));
    const raw = String((row as { valor?: unknown })?.valor ?? "").trim().replace(",", ".");
    const value = Number(raw);
    if (!m || raw === "" || !Number.isFinite(value)) continue;
    out.push({ date: new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))), value });
  }
  return out;
}

/**
 * Values of an SGS series between two dates (both included). The API
 * answers 404 when the window has no values (a weekend, or an IPCA not
 * published yet), which is an empty list here.
 */
export async function fetchSgs(code: number, from: Date, to: Date, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<SgsValue[]> {
  // The API now and then hangs on a request: one retry after a timeout or a network error.
  const request = () => fetchImpl(sgsUrl(code, from, to), { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  const res = await request().catch(() => request());
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`SGS ${code}: HTTP ${res.status}`);
  return parseSgs(await res.json());
}
