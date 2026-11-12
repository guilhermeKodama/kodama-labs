import { describe, expect, it } from "vitest";
import { proventoFundedPurchases, type AporteCashEvent } from "../provento-funded";

const ev = (over: Partial<AporteCashEvent> & Pick<AporteCashEvent, "id" | "kind" | "amount" | "date">): AporteCashEvent => ({
  accountId: "xp",
  entityId: "pf",
  ...over,
});

const amounts = (events: AporteCashEvent[]) => proventoFundedPurchases(events).map((row) => [row.id, row.period, row.amount, row.entityId]);

describe("proventoFundedPurchases", () => {
  it("counts a provento once, when it is spent on a purchase, not when it arrives", () => {
    const events = [
      ev({ id: "div", kind: "income", amount: 2400, date: "2026-09-05", label: "HGLG11" }),
      ev({ id: "buy", kind: "purchase", amount: 2400, date: "2026-10-27", label: "HGLG11" }),
      ev({ id: "again", kind: "purchase", amount: 2400, date: "2026-10-28", label: "HGLG11" }),
    ];
    expect(amounts(events)).toEqual([["buy", "2026-10", 2400, "pf"]]);
    // The September provento alone is not an aporte.
    expect(proventoFundedPurchases(events.slice(0, 1))).toEqual([]);
  });

  it("does not count a purchase twice when the money already arrived as a transfer", () => {
    // October: R$25.4k new money plus R$2.4k of FII bought with provento cash.
    const events = [
      ev({ id: "div", kind: "income", amount: 2400, date: "2026-10-05" }),
      ev({ id: "in", kind: "deposit", amount: 25400, date: "2026-10-10" }),
      ev({ id: "with-transfer", kind: "purchase", amount: 25400, date: "2026-10-20", funded: 25400, label: "BOVA11" }),
      ev({ id: "with-cash", kind: "purchase", amount: 2400, date: "2026-10-27", label: "HGLG11" }),
    ];
    expect(amounts(events)).toEqual([["with-cash", "2026-10", 2400, "pf"]]);

    // The same transfer, then an unlinked buy of that cash and no provento: still nothing extra.
    expect(
      amounts([
        ev({ id: "in", kind: "deposit", amount: 10000, date: "2026-10-10" }),
        ev({ id: "buy", kind: "purchase", amount: 10000, date: "2026-10-11", label: "PETR4" }),
      ]),
    ).toEqual([]);
  });

  it("keeps a funded buy from consuming proventos that are still sitting as cash", () => {
    const events = [
      ev({ id: "div", kind: "income", amount: 2400, date: "2026-10-01" }),
      ev({ id: "in", kind: "deposit", amount: 1000, date: "2026-10-02" }),
      ev({ id: "funded", kind: "purchase", amount: 1000, date: "2026-10-02", funded: 1000, label: "PETR4" }),
      ev({ id: "fii", kind: "purchase", amount: 2400, date: "2026-10-27", label: "HGLG11" }),
    ];
    expect(amounts(events)).toEqual([["fii", "2026-10", 2400, "pf"]]);
  });

  it("counts only the slice of a buy that the provento cash can pay", () => {
    expect(
      amounts([
        ev({ id: "div", kind: "income", amount: 2400, date: "2026-10-01" }),
        ev({ id: "buy", kind: "purchase", amount: 5000, date: "2026-10-02", label: "HGLG11" }),
      ]),
    ).toEqual([["buy", "2026-10", 2400, "pf"]]);
  });

  it("does not treat sale proceeds as new money", () => {
    expect(
      amounts([
        ev({ id: "sell", kind: "sale", amount: 5000, date: "2026-10-01" }),
        ev({ id: "buy", kind: "purchase", amount: 5000, date: "2026-10-02", label: "PETR4" }),
      ]),
    ).toEqual([]);
  });

  it("lets a withdrawal of the provento cash remove it, and leaves a later buy uncounted", () => {
    expect(
      amounts([
        ev({ id: "div", kind: "income", amount: 2400, date: "2026-10-01" }),
        ev({ id: "out", kind: "withdrawal", amount: 2400, date: "2026-10-02" }),
        ev({ id: "buy", kind: "purchase", amount: 2400, date: "2026-10-03", label: "HGLG11" }),
      ]),
    ).toEqual([]);
  });

  it("withdraws external cash first, so proventos are still there to fund a buy", () => {
    expect(
      amounts([
        ev({ id: "in", kind: "deposit", amount: 10000, date: "2026-10-01" }),
        ev({ id: "div", kind: "income", amount: 2400, date: "2026-10-02" }),
        ev({ id: "out", kind: "withdrawal", amount: 10000, date: "2026-10-03" }),
        ev({ id: "buy", kind: "purchase", amount: 2400, date: "2026-10-27", label: "HGLG11" }),
      ]),
    ).toEqual([["buy", "2026-10", 2400, "pf"]]);
  });

  it("splits PF and PJ by account and adds up to the consolidated total", () => {
    const events = [
      ev({ id: "pf-div", kind: "income", amount: 2400, date: "2026-10-05", accountId: "xp", entityId: "pf" }),
      ev({ id: "pf-buy", kind: "purchase", amount: 2400, date: "2026-10-27", accountId: "xp", entityId: "pf", label: "HGLG11" }),
      ev({ id: "pj-div", kind: "income", amount: 800, date: "2026-10-06", accountId: "btg", entityId: "pj" }),
      ev({ id: "pj-buy", kind: "purchase", amount: 800, date: "2026-10-20", accountId: "btg", entityId: "pj", label: "KNRI11" }),
      // A PF provento cannot fund a purchase at the PJ broker.
      ev({ id: "cross", kind: "purchase", amount: 500, date: "2026-10-21", accountId: "btg", entityId: "pj", label: "X" }),
    ];
    const rows = proventoFundedPurchases(events);
    const of = (entityId: string) => rows.filter((row) => row.entityId === entityId).reduce((sum, row) => sum + row.amount, 0);
    expect(of("pf")).toBe(2400);
    expect(of("pj")).toBe(800);
    expect(of("pf") + of("pj")).toBe(rows.reduce((sum, row) => sum + row.amount, 0));
    expect(rows.map((row) => row.id).sort()).toEqual(["pf-buy", "pj-buy"]);
  });

  it("uses a provento received before the purchase month", () => {
    expect(
      amounts([
        ev({ id: "div", kind: "income", amount: 2400, date: "2026-09-30" }),
        ev({ id: "buy", kind: "purchase", amount: 2400, date: "2026-10-27", label: "HGLG11" }),
      ]),
    ).toEqual([["buy", "2026-10", 2400, "pf"]]);
  });
});

describe("proventoFundedPurchases ordering and labels", () => {
  it("skips events of zero or negative amount", () => {
    const events = [
      ev({ id: "div", kind: "income", amount: 100, date: "2026-10-01" }),
      ev({ id: "dust", kind: "purchase", amount: 0, date: "2026-10-02", label: "ZERO" }),
      ev({ id: "refund", kind: "purchase", amount: -50, date: "2026-10-03", label: "NEG" }),
      ev({ id: "buy", kind: "purchase", amount: 60, date: "2026-10-04", label: "REAL" }),
    ];
    expect(amounts(events)).toEqual([["buy", "2026-10", 60, "pf"]]);
  });

  it("orders same-day events of the same kind by id, so the cash is spent the same way whatever the input order", () => {
    const income = ev({ id: "div", kind: "income", amount: 100, date: "2026-10-01" });
    const a = ev({ id: "a-buy", kind: "purchase", amount: 100, date: "2026-10-05", label: "A" });
    const b = ev({ id: "b-buy", kind: "purchase", amount: 100, date: "2026-10-05", label: "B" });
    expect(proventoFundedPurchases([b, a, income]).map((row) => row.id)).toEqual(["a-buy"]);
    expect(proventoFundedPurchases([income, a, b]).map((row) => row.id)).toEqual(["a-buy"]);
  });

  it("falls back to the account id for a purchase with no label, and to a null entity", () => {
    const events: AporteCashEvent[] = [
      { id: "div", accountId: "xp", date: "2026-10-01", amount: 100, kind: "income" },
      { id: "buy", accountId: "xp", date: "2026-10-02", amount: 100, kind: "purchase", label: "   " },
    ];
    expect(proventoFundedPurchases(events)).toEqual([
      { id: "buy", accountId: "xp", entityId: null, date: "2026-10-02", period: "2026-10", amount: 100, label: "xp" },
    ]);
  });

  it("takes a withdrawal out of external cash first and provento cash after, and never mixes brokers", () => {
    const events = [
      ev({ id: "div", kind: "income", amount: 100, date: "2026-10-01" }),
      ev({ id: "in", kind: "deposit", amount: 100, date: "2026-10-01" }),
      ev({ id: "out", kind: "withdrawal", amount: 150, date: "2026-10-02" }),
      // 50 of provento cash is left on xp.
      ev({ id: "buy", kind: "purchase", amount: 80, date: "2026-10-03", label: "PETR4" }),
      // Another broker holds no provento: its purchase is not funded by xp's.
      ev({ id: "other", kind: "purchase", amount: 80, date: "2026-10-03", accountId: "btg", label: "VALE3" }),
    ];
    expect(amounts(events)).toEqual([["buy", "2026-10", 50, "pf"]]);
  });
});
