import { describe, it, expect } from "vitest";
import {
  flowForRowType,
  flowForInvestmentDirection,
  resolveTransferSides,
  checkTransferDirection,
  allowedDirectionsForFlow,
  suggestDirectionForFlow,
} from "../transfer-flow";

const BIZ = "biz-1";
const PERSONAL = "pa-1";

describe("flowForRowType", () => {
  it("maps an expense row to an outflow and an income row to an inflow", () => {
    expect(flowForRowType("expense")).toBe("outflow");
    expect(flowForRowType("income")).toBe("inflow");
  });
});

describe("flowForInvestmentDirection", () => {
  it("treats a deposit as leaving the entity and a withdrawal as arriving", () => {
    expect(flowForInvestmentDirection("investment_deposit")).toBe("outflow");
    expect(flowForInvestmentDirection("investment_withdrawal")).toBe("inflow");
  });
});

describe("resolveTransferSides", () => {
  it("makes the imported entity the payer on an outflow", () => {
    expect(
      resolveTransferSides({
        flow: "outflow",
        entityType: "business",
        entityId: BIZ,
        counterpartyEntityType: "personal",
        counterpartyEntityId: PERSONAL,
      })
    ).toEqual({
      fromEntityType: "business",
      fromEntityId: BIZ,
      toEntityType: "personal",
      toEntityId: PERSONAL,
    });
  });

  it("makes the imported entity the payee on an inflow", () => {
    expect(
      resolveTransferSides({
        flow: "inflow",
        entityType: "business",
        entityId: BIZ,
        counterpartyEntityType: "personal",
        counterpartyEntityId: PERSONAL,
      })
    ).toEqual({
      fromEntityType: "personal",
      fromEntityId: PERSONAL,
      toEntityType: "business",
      toEntityId: BIZ,
    });
  });

  // The regression this whole module exists for: the same label on the
  // two sides of the same movement must produce opposite sides.
  it("does not let the direction label decide the sides", () => {
    const onBusinessStatement = resolveTransferSides({
      flow: "outflow",
      entityType: "business",
      entityId: BIZ,
      counterpartyEntityType: "personal",
      counterpartyEntityId: PERSONAL,
    });
    const onPersonalStatement = resolveTransferSides({
      flow: "inflow",
      entityType: "personal",
      entityId: PERSONAL,
      counterpartyEntityType: "business",
      counterpartyEntityId: BIZ,
    });
    expect(onBusinessStatement).toEqual(onPersonalStatement);
  });
});

describe("checkTransferDirection", () => {
  it("accepts a profit distribution paid by the business", () => {
    expect(
      checkTransferDirection("profit_distribution", {
        fromEntityType: "business",
        toEntityType: "personal",
      })
    ).toEqual({ status: "ok" });
  });

  it("accepts a reimbursement paid by the business", () => {
    expect(
      checkTransferDirection("reimbursement", {
        fromEntityType: "business",
        toEntityType: "personal",
      }).status
    ).toBe("ok");
  });

  it("accepts a capital injection paid by the person", () => {
    expect(
      checkTransferDirection("capital_injection", {
        fromEntityType: "personal",
        toEntityType: "business",
      }).status
    ).toBe("ok");
  });

  it("rejects a capital injection whose payer is the business", () => {
    const result = checkTransferDirection("capital_injection", {
      fromEntityType: "business",
      toEntityType: "personal",
    });
    expect(result.status).toBe("violation");
    expect(result.status === "violation" && result.message).toContain("capital_injection");
  });

  it("rejects a profit distribution whose payer is the person", () => {
    expect(
      checkTransferDirection("profit_distribution", {
        fromEntityType: "personal",
        toEntityType: "business",
      }).status
    ).toBe("violation");
  });

  it("cannot verify a business-to-business movement", () => {
    expect(
      checkTransferDirection("capital_injection", {
        fromEntityType: "business",
        toEntityType: "business",
      })
    ).toEqual({ status: "unverifiable" });
  });
});

describe("allowedDirectionsForFlow", () => {
  it("allows only capital_injection when money leaves the personal account", () => {
    expect(allowedDirectionsForFlow("outflow", "personal", "business")).toEqual([
      "capital_injection",
    ]);
  });

  it("allows the business-paid labels when money leaves the business", () => {
    expect(allowedDirectionsForFlow("outflow", "business", "personal").sort()).toEqual([
      "profit_distribution",
      "reimbursement",
    ]);
  });

  it("allows the business-paid labels when money arrives in the personal account", () => {
    expect(allowedDirectionsForFlow("inflow", "personal", "business").sort()).toEqual([
      "profit_distribution",
      "reimbursement",
    ]);
  });

  it("allows only capital_injection when money arrives in the business", () => {
    expect(allowedDirectionsForFlow("inflow", "business", "personal")).toEqual([
      "capital_injection",
    ]);
  });

  it("allows every label between two businesses", () => {
    expect(allowedDirectionsForFlow("outflow", "business", "business")).toHaveLength(3);
  });
});

describe("suggestDirectionForFlow", () => {
  it("suggests capital_injection for money leaving the personal account", () => {
    expect(suggestDirectionForFlow("outflow", "personal", "business")).toBe("capital_injection");
  });

  it("suggests profit_distribution for money arriving in the personal account", () => {
    expect(suggestDirectionForFlow("inflow", "personal", "business")).toBe("profit_distribution");
  });

  // The old entity-blind heuristic suggested capital_injection here,
  // which execute-import then read back as money coming IN.
  it("suggests profit_distribution for money leaving the business", () => {
    expect(suggestDirectionForFlow("outflow", "business", "personal")).toBe("profit_distribution");
  });

  it("suggests capital_injection for money arriving in the business", () => {
    expect(suggestDirectionForFlow("inflow", "business", "personal")).toBe("capital_injection");
  });
});
