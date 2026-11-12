import { describe, expect, it } from "vitest";
import { closeReadyAt, expectedLatestSession, isSession, marketDate, marketFor, quoteKind, sessionsBehind } from "../calendar";

describe("isSession", () => {
  it("skips weekends on B3 and US, never for crypto", () => {
    expect(isSession("B3", "2026-11-14")).toBe(false); // Saturday
    expect(isSession("US", "2026-11-15")).toBe(false); // Sunday
    expect(isSession("CRYPTO", "2026-11-14")).toBe(true);
  });

  it("knows B3 holidays, including the Easter-based ones", () => {
    expect(isSession("B3", "2026-02-16")).toBe(false); // Carnaval (segunda), Easter 2026-04-05
    expect(isSession("B3", "2026-02-17")).toBe(false); // Carnaval (terça)
    expect(isSession("B3", "2026-02-18")).toBe(true); // Quarta de cinzas trades
    expect(isSession("B3", "2026-04-03")).toBe(false); // Sexta-feira Santa
    expect(isSession("B3", "2026-06-04")).toBe(false); // Corpus Christi
    expect(isSession("B3", "2026-11-20")).toBe(false); // Consciência Negra
    expect(isSession("B3", "2026-12-24")).toBe(false);
    expect(isSession("B3", "2026-12-31")).toBe(false);
  });

  it("knows NYSE holidays with weekend observance", () => {
    expect(isSession("US", "2026-11-26")).toBe(false); // Thanksgiving
    expect(isSession("US", "2026-07-03")).toBe(false); // July 4th on a Saturday, observed Friday
    expect(isSession("US", "2026-01-19")).toBe(false); // MLK Day
    expect(isSession("US", "2026-05-25")).toBe(false); // Memorial Day
    expect(isSession("US", "2027-12-31")).toBe(true); // New Year's Day 2028 is a Saturday: not observed the Friday before
    expect(isSession("US", "2026-11-11")).toBe(true); // Veterans Day trades
  });
});

describe("isSession across years", () => {
  it("only closes B3 on Consciência Negra from 2024", () => {
    expect(isSession("B3", "2023-11-20")).toBe(true); // Monday, not yet a national holiday
    expect(isSession("B3", "2024-11-20")).toBe(false);
  });

  it("only closes NYSE on Juneteenth from 2022", () => {
    expect(isSession("US", "2021-06-18")).toBe(true); // Friday before the 19th, which fell on a Saturday
    expect(isSession("US", "2022-06-20")).toBe(false); // the 19th was a Sunday: observed Monday
    expect(isSession("US", "2024-06-19")).toBe(false);
  });

  it("observes a Sunday holiday on Monday and keeps the Monday after a Saturday New Year's Day open", () => {
    expect(isSession("US", "2023-01-02")).toBe(false); // New Year's Day on a Sunday
    expect(isSession("US", "2022-01-03")).toBe(true); // New Year's Day on a Saturday is not observed
    expect(isSession("US", "2022-12-26")).toBe(false); // Christmas on a Sunday
  });

  it("finds the last Monday of May and the fourth Thursday of November in other years", () => {
    expect(isSession("US", "2027-05-31")).toBe(false); // Memorial Day
    expect(isSession("US", "2027-05-24")).toBe(true);
    expect(isSession("US", "2027-11-25")).toBe(false); // Thanksgiving
  });
});

describe("expectedLatestSession", () => {
  it("is the previous session until today's close is ready, then today (B3)", () => {
    // Tuesday 2026-11-10: 13:00 in São Paulo is 16:00Z; 19:00 there is 22:00Z.
    expect(expectedLatestSession("B3", new Date("2026-11-10T16:00:00Z"))).toBe("2026-11-09");
    expect(expectedLatestSession("B3", new Date("2026-11-10T21:59:00Z"))).toBe("2026-11-09");
    expect(expectedLatestSession("B3", new Date("2026-11-10T22:30:00Z"))).toBe("2026-11-10");
  });

  it("stays on Friday all weekend and through a Monday holiday", () => {
    expect(expectedLatestSession("B3", new Date("2026-11-15T15:00:00Z"))).toBe("2026-11-13");
    // Carnaval: Friday 2026-02-13 is still the latest close on Ash Wednesday morning.
    expect(expectedLatestSession("B3", new Date("2026-02-18T13:00:00Z"))).toBe("2026-02-13");
  });

  it("follows New York's clock and DST for the US market", () => {
    // 17:00 New York is 22:00Z in winter (EST) and 21:00Z in summer (EDT).
    expect(expectedLatestSession("US", new Date("2026-11-10T21:30:00Z"))).toBe("2026-11-09");
    expect(expectedLatestSession("US", new Date("2026-11-10T22:30:00Z"))).toBe("2026-11-10");
    expect(expectedLatestSession("US", new Date("2026-07-14T21:30:00Z"))).toBe("2026-07-14");
  });

  it("is yesterday (UTC) for crypto", () => {
    expect(expectedLatestSession("CRYPTO", new Date("2026-11-10T03:00:00Z"))).toBe("2026-11-09");
  });
});

describe("sessionsBehind", () => {
  it("counts only trading days after the price's date", () => {
    expect(sessionsBehind("B3", "2026-11-09", "2026-11-09")).toBe(0);
    expect(sessionsBehind("B3", "2026-11-09", "2026-11-10")).toBe(1);
    expect(sessionsBehind("B3", "2026-11-13", "2026-11-16")).toBe(1); // a weekend is not a gap
    expect(sessionsBehind("B3", "2026-02-13", "2026-02-18")).toBe(1); // nor is Carnaval
    expect(sessionsBehind("B3", "2026-11-10", "2026-11-09")).toBe(0); // an intraday price newer than the expected close
  });
});

describe("marketDate and closeReadyAt", () => {
  it("dates a quote by the market's own time zone", () => {
    // 01:30Z on the 11th is still the 10th in São Paulo.
    expect(marketDate("B3", new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-10");
    expect(marketDate("CRYPTO", new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-11");
  });

  it("puts the close at local wall-clock time", () => {
    expect(closeReadyAt("B3", "2026-11-10").toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(closeReadyAt("US", "2026-11-10").toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(closeReadyAt("US", "2026-07-14").toISOString()).toBe("2026-07-14T21:00:00.000Z");
  });
});

describe("quoteKind", () => {
  it("is intraday before the close is ready and close after", () => {
    expect(quoteKind("B3", "2026-11-10", new Date("2026-11-10T17:00:00Z"))).toBe("intraday");
    expect(quoteKind("B3", "2026-11-10", new Date("2026-11-10T22:30:00Z"))).toBe("close");
    // Before the open, the quote is yesterday's close.
    expect(quoteKind("B3", "2026-11-09", new Date("2026-11-10T12:00:00Z"))).toBe("close");
  });
});

describe("marketFor", () => {
  it("routes by class, and a plain etf by its ticker", () => {
    expect(marketFor("fii", "HGLG11")).toBe("B3");
    expect(marketFor("etf", "BOVA11")).toBe("B3");
    expect(marketFor("etf", "VOO")).toBe("US");
    expect(marketFor("international_stocks", "AAPL")).toBe("US");
    expect(marketFor("crypto", "BTC")).toBe("CRYPTO");
    expect(marketFor("fixed_income", "CDB")).toBeNull();
  });
});
