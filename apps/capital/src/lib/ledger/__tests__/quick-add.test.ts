import { describe, expect, it } from "vitest";
import { cleanQuickAddDraft, decodeCreateParam, encodeCreateParam, parseQuickAdd, type QuickAddCatalog } from "@/lib/ledger/quick-add";

const catalog: QuickAddCatalog = {
  accounts: [{ id: "nubank", name: "Nubank · cartão", entityId: "pf", type: "credit_card", currency: "BRL" }],
  entities: [{ id: "pf", name: "PF", kind: "personal" }],
  categories: [{ id: "mercado", name: "Mercado", type: "expense" }],
  currencies: ["BRL", "USD"],
};

describe("parseQuickAdd (stub until the CRUD slice)", () => {
  it("returns a description for any text and nothing for blank text", () => {
    expect(parseQuickAdd("  ifood   86,90 ", catalog, "2026-09-22")).toEqual({
      draft: { description: "ifood 86,90" },
      tokens: [{ field: "description", text: "ifood 86,90" }],
    });
    expect(parseQuickAdd("   ", catalog, "2026-09-22")).toEqual({ draft: {}, tokens: [] });
  });
});

describe("create param", () => {
  it("opens a blank form with 1 and a prefilled one with JSON", () => {
    expect(encodeCreateParam()).toBe("1");
    expect(encodeCreateParam({ description: "", amount: undefined })).toBe("1");
    const draft = { description: "iFood", amount: 86.9, kind: "expense" as const, accountId: "nubank", date: "2026-09-21" };
    expect(decodeCreateParam(encodeCreateParam(draft))).toEqual(draft);
  });

  it("is closed without the param and blank for anything unreadable", () => {
    expect(decodeCreateParam(null)).toBeNull();
    expect(decodeCreateParam(undefined)).toBeNull();
    expect(decodeCreateParam("")).toEqual({});
    expect(decodeCreateParam("1")).toEqual({});
    expect(decodeCreateParam("{oops")).toEqual({});
  });

  it("reads the JSON the old ⌘K wrote", () => {
    expect(decodeCreateParam(JSON.stringify({ description: "Uber", amount: 23.4, date: "2026-09-22" }))).toEqual({
      description: "Uber",
      amount: 23.4,
      date: "2026-09-22",
    });
  });

  it("keeps only well-formed fields", () => {
    expect(
      cleanQuickAddDraft({ description: " Uber ", amount: -3, kind: "gift", date: "21/09", currency: "USD", categoryName: "Pets", extra: 1 }),
    ).toEqual({ description: "Uber", currency: "USD", categoryName: "Pets" });
    expect(cleanQuickAddDraft([1])).toEqual({});
    expect(cleanQuickAddDraft({ amount: Number.NaN })).toEqual({});
  });
});
