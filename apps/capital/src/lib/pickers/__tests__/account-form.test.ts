import { describe, expect, it } from "vitest";
import { accountFormErrors, parseDayOfMonth, toAccountInput, type AccountFormState } from "@/lib/pickers/account-form";

const checking: AccountFormState = { name: " Nubank ", type: "checking", entityId: "pf", currency: "BRL", closingDay: "", dueDay: "" };
const card: AccountFormState = { ...checking, name: "Nubank · cartão", type: "credit_card", closingDay: "5", dueDay: "12" };

describe("parseDayOfMonth", () => {
  it("accepts whole days 1–31", () => {
    expect(parseDayOfMonth("5")).toBe(5);
    expect(parseDayOfMonth(" 31 ")).toBe(31);
    for (const text of ["", "0", "32", "5.5", "-1", "abc", "123"]) expect(parseDayOfMonth(text)).toBeNull();
  });
});

describe("accountFormErrors", () => {
  it("passes a complete form", () => {
    expect(accountFormErrors(checking).size).toBe(0);
    expect(accountFormErrors(card).size).toBe(0);
  });

  it("flags the missing fields", () => {
    expect([...accountFormErrors({ ...checking, name: "  ", entityId: null, currency: "" })].sort()).toEqual(["currency", "entityId", "name"]);
  });

  it("requires both days on a card only", () => {
    expect([...accountFormErrors({ ...card, closingDay: "", dueDay: "40" })].sort()).toEqual(["closingDay", "dueDay"]);
    expect(accountFormErrors({ ...checking, closingDay: "40" }).size).toBe(0);
  });
});

describe("toAccountInput", () => {
  it("builds the POST /v2/accounts body", () => {
    expect(toAccountInput(checking)).toEqual({ entityId: "pf", type: "checking", name: "Nubank", currency: "BRL" });
    expect(toAccountInput(card)).toEqual({ entityId: "pf", type: "credit_card", name: "Nubank · cartão", currency: "BRL", closingDay: 5, dueDay: 12 });
  });

  it("is null while the form has errors", () => {
    expect(toAccountInput({ ...card, dueDay: "" })).toBeNull();
  });
});
