import { describe, expect, it } from "vitest";
import { incomeTypeForPlainProvento, isPlainProventoCategory, planPlainProventoLinks, tickerInDescription, type PlainProventoHolding, type PlainProventoIncome } from "../link-plain-proventos";

const pf = "entity-pf";
const xp = "account-xp";
const other = "account-other";

function income(patch: Partial<PlainProventoIncome> & Pick<PlainProventoIncome, "id" | "description">): PlainProventoIncome {
  return {
    entityId: pf,
    accountId: xp,
    categoryName: "Proventos",
    categorySystemKey: null,
    amount: 100,
    date: "2026-09-15",
    ...patch,
  };
}

function holding(patch: Partial<PlainProventoHolding> & Pick<PlainProventoHolding, "id" | "ticker">): PlainProventoHolding {
  return { entityId: pf, accountId: xp, name: patch.ticker ?? "holding", ...patch };
}

describe("planPlainProventoLinks", () => {
  const holdings = [
    holding({ id: "h-hglg", ticker: "HGLG11" }),
    holding({ id: "h-petr-xp", ticker: "PETR4", accountId: xp }),
    holding({ id: "h-petr-other", ticker: "PETR4", accountId: other }),
    holding({ id: "h-cdb", ticker: null, name: "CDB" }),
  ];

  it("links a FII provento to the holding and leaves the cash row as the leg", () => {
    const plan = planPlainProventoLinks([income({ id: "tx-1", description: "Rendimentos HGLG11" })], holdings);
    expect(plan.skipped).toEqual([]);
    expect(plan.links).toEqual([
      {
        transactionId: "tx-1",
        holdingId: "h-hglg",
        ticker: "HGLG11",
        incomeType: "fii_income",
        date: "2026-09-15",
        amount: 100,
        description: "Rendimentos HGLG11",
      },
    ]);
  });

  it("prefers the holding on the same account when the ticker exists twice", () => {
    const plan = planPlainProventoLinks([income({ id: "tx-2", description: "Dividendo PETR4", accountId: other })], holdings);
    expect(plan.links.map((l) => [l.holdingId, l.incomeType])).toEqual([["h-petr-other", "dividend"]]);
  });

  it("skips a ticker that matches more than one holding and none of them is on the account", () => {
    const plan = planPlainProventoLinks([income({ id: "tx-3", description: "Dividendo PETR4", accountId: "account-bank" })], holdings);
    expect(plan.links).toEqual([]);
    expect(plan.skipped).toEqual([{ transactionId: "tx-3", description: "Dividendo PETR4", reason: "more than one holding PETR4 in this entity" }]);
  });

  it("reads Rendimentos and the interest system key as fixed income", () => {
    const named = planPlainProventoLinks(
      [income({ id: "tx-4", description: "Rendimentos HGLG11", categoryName: "Rendimentos" })],
      holdings,
    );
    const keyed = planPlainProventoLinks(
      [income({ id: "tx-5", description: "Juros CDBA11", categoryName: "Interest", categorySystemKey: "interest" })],
      [holding({ id: "h-cdba", ticker: "CDBA11" })],
    );
    expect(named.links[0].incomeType).toBe("fixed_income_interest");
    expect(keyed.links[0].incomeType).toBe("fixed_income_interest");
  });

  it("skips rows that are not a credit, not Proventos, or have no ticker", () => {
    const plan = planPlainProventoLinks(
      [
        income({ id: "tx-6", description: "Rendimentos HGLG11", amount: -10 }),
        income({ id: "tx-7", description: "Rendimentos HGLG11", categoryName: "Salário" }),
        income({ id: "tx-8", description: "Proventos do mês" }),
        income({ id: "tx-9", description: "Algo HGLG11", categoryName: "Dividendos", categorySystemKey: "dividends" }),
      ],
      holdings,
    );
    expect(plan.links.map((l) => l.transactionId)).toEqual(["tx-9"]);
    expect(plan.links[0].incomeType).toBe("fii_income");
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "amount is not a credit",
      "category is not Proventos or Rendimentos",
      "no ticker in the description",
    ]);
  });
});

describe("planPlainProventoLinks matching", () => {
  it("links to the only holding of the ticker in the entity even when it sits on another account", () => {
    const plan = planPlainProventoLinks(
      [income({ id: "tx-1", description: "Dividendo VALE3", accountId: "account-bank" })],
      [holding({ id: "h-vale", ticker: "VALE3", accountId: xp }), holding({ id: "h-vale-pj", ticker: "VALE3", entityId: "entity-pj" })],
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.links.map((l) => [l.holdingId, l.incomeType])).toEqual([["h-vale", "dividend"]]);
  });

  it("skips a ticker the entity does not hold, saying so", () => {
    const plan = planPlainProventoLinks([income({ id: "tx-2", description: "Dividendo ITUB4" })], [holding({ id: "h", ticker: "VALE3" })]);
    expect(plan.links).toEqual([]);
    expect(plan.skipped).toEqual([{ transactionId: "tx-2", description: "Dividendo ITUB4", reason: "no holding ITUB4 in this entity" }]);
  });

  it("matches the ticker ignoring case, taking it from the description's upper-cased form", () => {
    const plan = planPlainProventoLinks([income({ id: "tx-3", description: "rendimento hglg11 setembro" })], [holding({ id: "h", ticker: "hglg11" })]);
    expect(plan.links).toEqual([expect.objectContaining({ holdingId: "h", ticker: "HGLG11", incomeType: "fii_income" })]);
  });

  it("takes a row with no category as outside the Proventos bucket, unless a system key says otherwise", () => {
    const plan = planPlainProventoLinks(
      [
        income({ id: "tx-4", description: "Dividendo PETR4", categoryName: null }),
        income({ id: "tx-5", description: "Dividendo PETR4", categoryName: null, categorySystemKey: "dividends" }),
      ],
      [holding({ id: "h", ticker: "PETR4" })],
    );
    expect(plan.skipped.map((s) => s.transactionId)).toEqual(["tx-4"]);
    expect(plan.links.map((l) => [l.transactionId, l.incomeType])).toEqual([["tx-5", "dividend"]]);
  });
});

describe("tickerInDescription and incomeTypeForPlainProvento", () => {
  it("finds the first four-letters-and-digits code, upper-cased, or null", () => {
    expect(tickerInDescription("JCP petr4 setembro")).toBe("PETR4");
    expect(tickerInDescription("HGLG11 e KNRI11")).toBe("HGLG11");
    expect(tickerInDescription("Proventos de setembro")).toBeNull();
  });

  it("types interest by the category name or key, FIIs by the 11 suffix and everything else as a dividend", () => {
    expect(incomeTypeForPlainProvento({ categoryName: " RENDIMENTOS ", categorySystemKey: null }, "PETR4")).toBe("fixed_income_interest");
    expect(incomeTypeForPlainProvento({ categoryName: null, categorySystemKey: "interest" }, "PETR4")).toBe("fixed_income_interest");
    expect(incomeTypeForPlainProvento({ categoryName: null, categorySystemKey: null }, "KNRI11")).toBe("fii_income");
    expect(incomeTypeForPlainProvento({ categoryName: "Proventos", categorySystemKey: null }, "PETR4")).toBe("dividend");
  });

  it("recognises the plain-provento categories by name or system key", () => {
    expect(isPlainProventoCategory({ categoryName: " proventos ", categorySystemKey: null })).toBe(true);
    expect(isPlainProventoCategory({ categoryName: null, categorySystemKey: "dividends" })).toBe(true);
    expect(isPlainProventoCategory({ categoryName: null, categorySystemKey: null })).toBe(false);
    expect(isPlainProventoCategory({ categoryName: "Salário", categorySystemKey: "salary" })).toBe(false);
  });
});
