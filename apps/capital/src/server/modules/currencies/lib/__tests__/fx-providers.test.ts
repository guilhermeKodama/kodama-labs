import { describe, expect, it, vi } from "vitest";
import { bcbDate, fetchEcbQuotes, fetchPtaxQuote, latestPtaxClose, parseBcbTimestamp, parseFrankfurter, ptaxPeriodUrl } from "../fx-providers";
import { autoSourceFor } from "../fx-source";

/** A BCB Olinda CotacaoMoedaPeriodo body (the shape the real API returns, trimmed to the selected fields). */
const ptaxBody = (bulletins: [number, string, string][]) => ({
  "@odata.context": "https://was-p.bcnet.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata$metadata",
  value: bulletins.map(([cotacaoVenda, dataHoraCotacao, tipoBoletim]) => ({ cotacaoVenda, dataHoraCotacao, tipoBoletim })),
});

// Thu 1 Oct and Fri 2 Oct 2026; nothing on the weekend of 3-4 Oct.
const WEEK = ptaxBody([
  [5.2066, "2026-10-01 10:11:15.14", "Abertura"],
  [5.2214, "2026-10-01 13:03:11.25", "Intermediário"],
  [5.2132, "2026-10-01 13:03:11.35", "Fechamento"],
  [5.1986, "2026-10-02 10:09:12.64", "Abertura"],
  [5.1912, "2026-10-02 13:10:17.34", "Intermediário"],
  [5.1991, "2026-10-02 13:10:17.44", "Fechamento"],
  [5.3001, "2026-10-05 10:05:00.00", "Abertura"],
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PTAX", () => {
  it("reads BCB timestamps as Brasília time (UTC-3)", () => {
    expect(parseBcbTimestamp("2026-10-02 13:10:17.447657")?.toISOString()).toBe("2026-10-02T16:10:17.000Z");
    expect(parseBcbTimestamp("not a date")).toBeNull();
  });

  it("formats the API's dates as MM-DD-YYYY of the Brasília day", () => {
    // 01:30 UTC on the 3rd is still the 2nd in Brasília.
    expect(bcbDate(new Date("2026-10-03T01:30:00Z"))).toBe("10-02-2026");
    const url = ptaxPeriodUrl("EUR", new Date("2026-09-21T15:00:00Z"), new Date("2026-10-05T15:00:00Z"));
    expect(url).toContain("CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)");
    expect(url).toContain("@moeda='EUR'&@dataInicial='09-21-2026'&@dataFinalCotacao='10-05-2026'");
  });

  it("walks back over the weekend and today's preview bulletins to the last business day's close", () => {
    // Monday 5 Oct, 11:00 in Brasília: only today's opening bulletin exists.
    const close = latestPtaxClose(WEEK, new Date("2026-10-05T14:00:00Z"));
    expect(close).toEqual({ brlPerUnit: 5.1991, quotedAt: new Date("2026-10-02T16:10:17.000Z") });
    // Friday before the close: Thursday's.
    expect(latestPtaxClose(WEEK, new Date("2026-10-02T15:00:00Z"))?.brlPerUnit).toBe(5.2132);
    expect(latestPtaxClose({ value: [] }, new Date())).toBeNull();
    expect(latestPtaxClose({ error: "x" }, new Date())).toBeNull();
  });

  it("fetches the closing selling rate as units per BRL, over a two-week window", async () => {
    const fetcher = vi.fn(async () => json(WEEK));
    const now = new Date("2026-10-05T14:00:00Z");
    const quote = await fetchPtaxQuote("USD", now, fetcher);
    expect(quote).toEqual({ code: "USD", manualRate: 1 / 5.1991, quotedAt: new Date("2026-10-02T16:10:17.000Z"), source: "ptax" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("@moeda='USD'&@dataInicial='09-21-2026'&@dataFinalCotacao='10-05-2026'");
  });

  it("fails on an HTTP error or a window with no close", async () => {
    await expect(fetchPtaxQuote("USD", new Date(), async () => json({}, 503))).rejects.toThrow(/HTTP 503/);
    await expect(fetchPtaxQuote("USD", new Date(), async () => json({ value: [] }))).rejects.toThrow(/no closing bulletin/);
  });
});

describe("ECB (Frankfurter)", () => {
  it("reads the rates per one base unit, published at 16:00 in Frankfurt", () => {
    const quotes = parseFrankfurter({ amount: 1, base: "USD", date: "2026-10-02", rates: { BRL: 5.2, EUR: 0.85 } }, ["BRL", "EUR", "ARS"]);
    expect(quotes).toEqual([
      { code: "BRL", manualRate: 5.2, quotedAt: new Date("2026-10-02T14:00:00Z"), source: "ecb" },
      { code: "EUR", manualRate: 0.85, quotedAt: new Date("2026-10-02T14:00:00Z"), source: "ecb" },
    ]);
    // Winter time: 16:00 CET is 15:00 UTC.
    expect(parseFrankfurter({ date: "2026-12-01", rates: { BRL: 5 } }, ["BRL"])[0].quotedAt.toISOString()).toBe("2026-12-01T15:00:00.000Z");
    expect(parseFrankfurter({ message: "not found" }, ["BRL"])).toEqual([]);
  });

  it("asks for every code of a base in one call", async () => {
    const fetcher = vi.fn(async () => json({ base: "USD", date: "2026-10-02", rates: { BRL: 5.2 } }));
    expect(await fetchEcbQuotes("USD", ["BRL", "EUR"], fetcher)).toHaveLength(1);
    expect((fetcher.mock.calls[0] as unknown[])[0]).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR");
    await expect(fetchEcbQuotes("XYZ", ["BRL"], async () => json({ message: "not found" }, 404))).rejects.toThrow(/HTTP 404/);
  });
});

describe("autoSourceFor", () => {
  it("uses PTAX for what the BCB quotes against BRL and the ECB for the rest", () => {
    expect(autoSourceFor("BRL", "USD")).toBe("ptax");
    expect(autoSourceFor("BRL", "EUR")).toBe("ptax");
    expect(autoSourceFor("BRL", "ARS")).toBe("ecb");
    expect(autoSourceFor("USD", "EUR")).toBe("ecb");
    expect(autoSourceFor("USD", "BRL")).toBe("ecb");
  });
});
