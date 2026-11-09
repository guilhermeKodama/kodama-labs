import { describe, expect, it } from "vitest";
import { incomeCashBucket } from "../income-cash-category";

describe("incomeCashBucket", () => {
  it("files FII, dividend and JCP as Proventos, including a dividend with no income type", () => {
    expect(incomeCashBucket("fii_income", "dividend")).toBe("proventos");
    expect(incomeCashBucket("dividend", "dividend")).toBe("proventos");
    expect(incomeCashBucket("jcp", "dividend")).toBe("proventos");
    expect(incomeCashBucket(null, "dividend")).toBe("proventos");
    expect(incomeCashBucket(undefined, "dividend")).toBe("proventos");
  });

  it("files fixed income and a yield with no income type as Rendimentos", () => {
    expect(incomeCashBucket("fixed_income_interest", "yield_payment")).toBe("rendimentos");
    expect(incomeCashBucket("interest", "yield_payment")).toBe("rendimentos");
    expect(incomeCashBucket(null, "yield_payment")).toBe("rendimentos");
  });

  it("ignores buys, sales and other operations", () => {
    expect(incomeCashBucket(null, "buy")).toBeNull();
    expect(incomeCashBucket("dividend", "sell")).toBeNull();
    expect(incomeCashBucket(null, "deposit")).toBeNull();
  });
});
