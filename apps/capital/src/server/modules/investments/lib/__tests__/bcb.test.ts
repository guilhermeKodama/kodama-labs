import { describe, expect, it, vi } from "vitest";
import { fetchSgs, parseSgs, sgsUrl, type FetchLike } from "../bcb";

describe("parseSgs", () => {
  it("skips rows that are not objects or lack a usable date or value, and reads a decimal comma", () => {
    const body = [null, "text", 7, {}, { data: "02/01/2026" }, { valor: "1" }, { data: "03/01/2026", valor: "0,05" }, { data: "04/01/2026", valor: " 0.5 " }, { data: "05/01/2026", valor: "abc" }];
    expect(parseSgs(body)).toEqual([
      { date: new Date(Date.UTC(2026, 0, 3)), value: 0.05 },
      { date: new Date(Date.UTC(2026, 0, 4)), value: 0.5 },
    ]);
  });

  it("refuses a body that is not a list", () => {
    expect(() => parseSgs(null)).toThrow("SGS: unexpected response");
    expect(() => parseSgs("[]")).toThrow("SGS: unexpected response");
  });
});

describe("fetchSgs", () => {
  const from = new Date(Date.UTC(2026, 0, 2));
  const to = new Date(Date.UTC(2026, 0, 30));
  const ok = (body: unknown): Awaited<ReturnType<FetchLike>> => ({ ok: true, status: 200, json: async () => body });

  it("asks for the window in dd/MM/yyyy and returns the parsed values", async () => {
    const fetcher = vi.fn<FetchLike>(async () => ok([{ data: "02/01/2026", valor: "0.055131" }]));
    expect(await fetchSgs(12, from, to, fetcher)).toEqual([{ date: new Date(Date.UTC(2026, 0, 2)), value: 0.055131 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(sgsUrl(12, from, to));
    expect(sgsUrl(12, from, to)).toBe("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2026&dataFinal=30/01/2026");
  });

  it("retries once when the first attempt fails, and gives up when the retry fails too", async () => {
    const flaky = vi.fn<FetchLike>().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(ok([{ data: "02/01/2026", valor: "1" }]));
    expect(await fetchSgs(433, from, to, flaky)).toHaveLength(1);
    expect(flaky).toHaveBeenCalledTimes(2);

    const down = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    await expect(fetchSgs(433, from, to, down)).rejects.toThrow("network down");
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("answers an empty list for a 404 and throws for any other failure", async () => {
    expect(await fetchSgs(12, from, to, async () => ({ ok: false, status: 404, json: async () => ({}) }))).toEqual([]);
    await expect(fetchSgs(12, from, to, async () => ({ ok: false, status: 503, json: async () => ({}) }))).rejects.toThrow("SGS 12: HTTP 503");
  });
});
