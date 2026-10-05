import { describe, expect, it } from "vitest";
import { createFormatter, parseLocaleNumber } from "@/lib/format/formatter";

// The mockup's helpers, verbatim (capital-nova-ui-mockups.canvas.tsx lines 40–44).
const fmt = (n: number) => Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => (n < 0 ? "−" : "") + "R$ " + fmt(n);
const brl0 = (n: number) => (n < 0 ? "−" : "") + "R$ " + Math.round(Math.abs(n)).toLocaleString("pt-BR");
const pct = (n: number, d = 1) => (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";

const pt = createFormatter();
const en = createFormatter({ numberFormat: "en-US", dateFormat: "MM/dd/yyyy", locale: "en", baseCurrency: "USD", timezone: "America/New_York" });
const iso = createFormatter({ dateFormat: "yyyy-MM-dd" });

const SAMPLES = [0, 1, -1, 0.005, -0.004, 86.9, -86.9, 612.4, -1204.3, 3120.55, 15000, -15000, 1234567.891, 999.995, -0.5, 0.49, 1e9];

describe("mockup parity (pt-BR)", () => {
  it("money is brl", () => {
    for (const n of SAMPLES) expect(pt.money(n)).toBe(brl(n));
  });

  it("money0 is brl0", () => {
    for (const n of SAMPLES) expect(pt.money0(n)).toBe(brl0(n));
  });

  it("pct is pct", () => {
    for (const n of [0, 0.123, -0.05, 1, 0.9999, 1.4, -0.00049]) {
      expect(pt.pct(n)).toBe(pct(n));
      expect(pt.pct(n, 0)).toBe(pct(n, 0));
      expect(pt.pct(n, 2)).toBe(pct(n, 2));
    }
  });

  it("k is the chart label of the waterfall and the heatmap", () => {
    for (const v of [0, 950, 1000, 1234, -1234, 15000, 1249.9]) {
      expect(pt.k(v)).toBe(`${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`);
      expect(pt.k(v, { minDigits: 1 })).toBe(`${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}k`);
    }
  });

  it("thousands rounds like the mockup's R$ mil series", () => {
    for (const v of [12480, 1102000, 999, 0, 1250]) expect(pt.thousands(v)).toBe(Math.round(v / 100) / 10);
    expect(pt.kUnit()).toBe("R$ mil");
  });
});

describe("numbers and money", () => {
  it("uses the user's separators and currency symbols", () => {
    expect(pt.money(1234.5)).toBe("R$ 1.234,50");
    expect(pt.money(-86.9)).toBe("−R$ 86,90");
    expect(pt.money(222.6, "USD")).toBe("US$ 222,60");
    expect(pt.money(10, "EUR")).toBe("€ 10,00");
    expect(pt.money(10, "CHF")).toBe("CHF 10,00");
    expect(en.money(1234.5)).toBe("US$ 1,234.50");
    expect(en.money(-1234.5, "BRL")).toBe("−R$ 1,234.50");
    expect(en.money0(15000.4, "BRL")).toBe("R$ 15,000");
    expect(en.pct(0.123)).toBe("12.3%");
    expect(en.k(1234)).toBe("1.2k");
    expect(en.kUnit("BRL")).toBe("R$ k");
  });

  it("formats plain numbers", () => {
    expect(pt.number(5.41)).toBe("5,41");
    expect(pt.number(1234)).toBe("1.234,00");
    expect(pt.number(1234, 0)).toBe("1.234");
    expect(pt.number(0.1234, { min: 0, max: 4 })).toBe("0,1234");
    expect(en.number(1234.5, 1)).toBe("1,234.5");
  });

  it("shows a dash for non-finite values", () => {
    expect(pt.money(Number.NaN)).toBe("—");
    expect(pt.money0(Number.POSITIVE_INFINITY)).toBe("—");
    expect(pt.pct(Number.NaN)).toBe("—");
    expect(pt.k(Number.NaN)).toBe("—");
  });
});

describe("dates", () => {
  it("formats plain dates per the date format, never shifting the day", () => {
    expect(pt.date("2026-09-22")).toBe("22/09");
    expect(pt.dateFull("2026-09-22")).toBe("22/09/2026");
    expect(en.date("2026-09-22")).toBe("09/22");
    expect(en.dateFull("2026-09-22")).toBe("09/22/2026");
    expect(iso.date("2026-09-22")).toBe("09-22");
    expect(iso.dateFull("2026-09-22")).toBe("2026-09-22");
    // @db.Date columns serialized as midnight UTC are still that calendar day in São Paulo.
    expect(pt.dateFull("2026-09-22T00:00:00.000Z")).toBe("22/09/2026");
  });

  it("converts timestamps to the user's timezone", () => {
    // 02:30 UTC on the 23rd is still the 22nd in São Paulo (UTC−3).
    expect(pt.dateFull("2026-09-23T02:30:00.000Z")).toBe("22/09/2026");
    expect(pt.time("2026-09-23T02:30:00.000Z")).toBe("23:30");
    expect(createFormatter({ timezone: "Asia/Tokyo" }).dateFull("2026-09-23T02:30:00.000Z")).toBe("23/09/2026");
    expect(en.time("2026-09-22T17:05:00.000Z")).toBe("1:05 PM");
    expect(en.time("2026-09-22T04:05:00.000Z")).toBe("12:05 AM");
    expect(pt.time(Date.UTC(2026, 8, 22, 16, 0))).toBe("13:00");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(pt.date(null)).toBe("");
    expect(pt.dateFull(undefined)).toBe("");
    expect(pt.date("not a date")).toBe("");
    expect(pt.monthLabel("")).toBe("");
  });

  it("adds the time to dateTime, and the year outside the current one", () => {
    const now = new Date("2026-10-05T15:00:00Z");
    expect(pt.dateTime("2026-09-23T12:12:00Z", now)).toBe("23/09 09:12");
    expect(pt.dateTime("2025-09-23T12:12:00Z", now)).toBe("23/09/2025 09:12");
    expect(pt.dateTime("2026-09-23", now)).toBe("23/09");
  });
});

describe("months and periods", () => {
  it("labels months like the mockup", () => {
    expect(pt.monthLabel("2026-09")).toBe("set/2026");
    expect(pt.monthLabel("2026-09-22")).toBe("set/2026");
    expect(pt.monthLabel({ year: 2027, month: 1 })).toBe("jan/2027");
    expect(en.monthLabel("2026-09")).toBe("Sep 2026");
    expect(pt.monthAbbr(3)).toBe("mar");
    expect(en.monthAbbr(12)).toBe("Dec");
    expect(pt.monthName(9)).toBe("setembro");
    expect(en.monthName(9)).toBe("September");
  });

  it("labels whole-month ranges", () => {
    expect(pt.periodRangeLabel("2026-07-01", "2026-09-30")).toBe("jul/2026 – set/2026");
    expect(pt.periodRangeLabel("2026-09-01", "2026-09-30")).toBe("set/2026");
    expect(pt.periodRangeLabel("2026-07", "2026-09")).toBe("jul/2026 – set/2026");
    expect(pt.periodRangeLabel("2025-10-01", "2026-09-30")).toBe("out/2025 – set/2026");
    expect(pt.periodRangeLabel("2024-02-01", "2024-02-29")).toBe("fev/2024");
    expect(en.periodRangeLabel("2026-07-01", "2026-09-30")).toBe("Jul 2026 – Sep 2026");
  });

  it("labels other ranges with dates", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(pt.periodRangeLabel("2026-09-05", "2026-09-20", now)).toBe("05/09 – 20/09");
    expect(pt.periodRangeLabel("2025-09-05", "2025-09-20", now)).toBe("05/09/2025 – 20/09/2025");
    expect(pt.periodRangeLabel("2026-09-05", "2026-09-05", now)).toBe("05/09");
  });

  it("labels date buckets", () => {
    expect(pt.bucketLabel("monthWeek", "2026-09-W3")).toBe("Sem. 3 · set");
    expect(en.bucketLabel("monthWeek", "2026-09-W3")).toBe("Wk 3 · Sep");
    expect(pt.bucketLabel("quarter", "2026-Q3")).toBe("T3 2026");
    expect(en.bucketLabel("quarter", "2026-Q3")).toBe("Q3 2026");
    expect(pt.bucketLabel("month", "2026-09")).toBe("set/2026");
    expect(pt.bucketLabel("day", "2026-09-22")).toBe("22/09");
    expect(pt.bucketLabel("year", "2026")).toBe("2026");
    expect(pt.bucketLabel("week", "2026-W38")).toBe("Sem. 38 · 2026");
    expect(pt.bucketLabel("week", "2026-09-14")).toBe("Sem. de 14/09");
    expect(en.bucketLabel("week", "2026-09-14")).toBe("Week of 09/14");
    expect(pt.bucketLabel("quarter", "garbage")).toBe("garbage");
  });
});

describe("relative", () => {
  const now = new Date("2026-10-05T16:00:00Z"); // 13:00 in São Paulo

  it("says agora, hoje HH:mm, ontem, then a date", () => {
    expect(pt.relative("2026-10-05T15:59:30Z", now)).toBe("agora");
    expect(pt.relative("2026-10-05T11:12:00Z", now)).toBe("hoje 08:12");
    expect(pt.relative("2026-10-04T20:40:00Z", now)).toBe("ontem");
    expect(pt.relative("2026-09-15T12:00:00Z", now)).toBe("15/09");
    expect(pt.relative("2025-09-15T12:00:00Z", now)).toBe("15/09/2025");
    expect(en.relative("2026-10-05T15:59:30Z", now)).toBe("now");
    expect(en.relative("2026-10-05T13:00:00Z", now)).toBe("today 9:00 AM");
    expect(en.relative("2026-10-04T13:00:00Z", now)).toBe("yesterday");
  });

  it("uses the user's day boundaries", () => {
    // 02:00 UTC on the 5th is 23:00 on the 4th in São Paulo.
    expect(pt.relative("2026-10-05T02:00:00Z", now)).toBe("ontem");
  });

  it("handles plain dates without a time", () => {
    expect(pt.relative("2026-10-05", now)).toBe("hoje");
    expect(pt.relative("2026-10-04", now)).toBe("ontem");
  });
});

describe("parseLocaleNumber", () => {
  it("reads pt-BR input", () => {
    expect(parseLocaleNumber("1.234,56", "pt-BR")).toBe(1234.56);
    expect(parseLocaleNumber("86,90", "pt-BR")).toBe(86.9);
    expect(parseLocaleNumber("86.90", "pt-BR")).toBe(86.9);
    expect(parseLocaleNumber("1.234", "pt-BR")).toBe(1234);
    expect(parseLocaleNumber("1.234.567", "pt-BR")).toBe(1234567);
    expect(parseLocaleNumber("R$ 1.234,56", "pt-BR")).toBe(1234.56);
    expect(parseLocaleNumber("−12,3", "pt-BR")).toBe(-12.3);
    expect(parseLocaleNumber("-1.234,5", "pt-BR")).toBe(-1234.5);
    expect(parseLocaleNumber("(50,00)", "pt-BR")).toBe(-50);
    expect(parseLocaleNumber(" 5000 ", "pt-BR")).toBe(5000);
  });

  it("reads en-US input", () => {
    expect(parseLocaleNumber("1,234.56", "en-US")).toBe(1234.56);
    expect(parseLocaleNumber("86.90", "en-US")).toBe(86.9);
    expect(parseLocaleNumber("86,90", "en-US")).toBe(86.9);
    expect(parseLocaleNumber("1,234", "en-US")).toBe(1234);
    expect(parseLocaleNumber("US$ 222.60", "en-US")).toBe(222.6);
  });

  it("rejects what it cannot read", () => {
    for (const input of ["", "abc", "1,2,3", "1,2,3,4", "R$"]) expect(parseLocaleNumber(input, "pt-BR")).toBeNaN();
    expect(parseLocaleNumber("1.2.3", "en-US")).toBeNaN();
  });

  it("is what Formatter.parseNumber uses", () => {
    expect(pt.parseNumber("1.234,56")).toBe(1234.56);
    expect(en.parseNumber("1,234.56")).toBe(1234.56);
  });
});
