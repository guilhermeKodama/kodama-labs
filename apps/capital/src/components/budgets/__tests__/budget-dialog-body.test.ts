import { describe, expect, it } from "vitest";
import { editBudgetBody } from "../budget-dialog";

describe("editBudgetBody", () => {
  it("trims the note", () => {
    expect(editBudgetBody(500, "BRL", "  subiu o aluguel \n", "2026-09")).toEqual({ amount: 500, currency: "BRL", notes: "subiu o aluguel", applyFrom: "2026-09" });
  });

  it("sends a blank note as null so it clears the stored one", () => {
    expect(editBudgetBody(0, "USD", "", "2026-01").notes).toBeNull();
    expect(editBudgetBody(0, "USD", "   \t", "2026-01").notes).toBeNull();
  });
});
