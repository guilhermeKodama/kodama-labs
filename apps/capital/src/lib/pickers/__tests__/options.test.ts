import { describe, expect, it } from "vitest";
import type { AccountRecord, CategoryRecord } from "@/lib/api/catalog";
import type { SessionEntity } from "@/lib/api/session";
import { filterOptions } from "@/lib/combobox";
import { accountOptions, categoryOptions, entityLabel, entityOptions } from "@/lib/pickers/options";

const category = (id: string, name: string, type: CategoryRecord["type"], isArchived = false): CategoryRecord => ({ id, name, type, color: null, isArchived });

const CATEGORIES = [
  category("food", "Alimentação", "expense"),
  category("old", "Assinaturas antigas", "expense", true),
  category("salary", "Salário", "income"),
  category("stocks", "Ações", "investment"),
];

const categoryLabels = { archivedLabel: "arquivada", typeLabel: (type: string) => `tipo:${type}` };

describe("categoryOptions", () => {
  it("lists only the requested types, without a type hint for one type", () => {
    expect(categoryOptions(CATEGORIES, { types: ["expense"], value: null, ...categoryLabels })).toEqual([{ value: "food", label: "Alimentação", hint: undefined }]);
  });

  it("shows the type as the hint when several types are listed", () => {
    expect(categoryOptions(CATEGORIES, { types: null, value: null, ...categoryLabels }).map((option) => [option.value, option.hint])).toEqual([
      ["food", "tipo:expense"],
      ["salary", "tipo:income"],
      ["stocks", "tipo:investment"],
    ]);
    expect(categoryOptions(CATEGORIES, { types: ["income", "investment"], value: null, ...categoryLabels }).map((option) => option.value)).toEqual(["salary", "stocks"]);
  });

  it("hides archived categories except the current value, marked archived", () => {
    const options = categoryOptions(CATEGORIES, { types: ["expense"], value: "old", ...categoryLabels });
    expect(options.map((option) => [option.value, option.hint])).toEqual([
      ["food", undefined],
      ["old", "arquivada"],
    ]);
  });
});

const account = (id: string, name: string, entityId: string, type: AccountRecord["type"], extra: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  name,
  type,
  entityId,
  currency: "BRL",
  institution: null,
  externalId: null,
  balance: null,
  isDefault: false,
  creditLimit: null,
  closingDay: null,
  dueDay: null,
  payFromAccountId: null,
  archivedAt: null,
  ...extra,
});

const ENTITIES: SessionEntity[] = [
  { id: "pf", kind: "personal", name: "Guilherme", defaultCurrency: "BRL", color: null },
  { id: "ltda", kind: "business", name: "Kodama LTDA", defaultCurrency: "BRL", color: null },
  { id: "llc", kind: "business", name: "Kodama LLC", defaultCurrency: "USD", color: null },
];

const ACCOUNTS = [
  account("nubank", "Conta principal", "pf", "checking", { institution: "Nubank" }),
  account("card", "Cartão Nubank", "pf", "credit_card", { institution: "Nubank" }),
  account("xp", "XP", "pf", "brokerage"),
  account("inter", "Inter PJ", "ltda", "checking", { institution: "Inter" }),
  account("closed", "Conta antiga", "ltda", "checking", { archivedAt: "2026-01-31T00:00:00.000Z" }),
  account("mercury", "Mercury", "llc", "checking"),
];

const accountLabels = { entities: ENTITIES, archivedLabel: "arquivada", typeLabel: (type: string) => `tipo:${type}` };

describe("accountOptions", () => {
  it("lists every open account with its entity as the hint", () => {
    expect(accountOptions(ACCOUNTS, { entityIds: null, types: null, value: null, ...accountLabels }).map((option) => [option.value, option.hint])).toEqual([
      ["nubank", "PF"],
      ["card", "PF"],
      ["xp", "PF"],
      ["inter", "Kodama LTDA"],
      ["mercury", "Kodama LLC"],
    ]);
  });

  it("limits to entities and types, dropping the hint for a single entity", () => {
    expect(accountOptions(ACCOUNTS, { entityIds: ["pf"], types: ["checking", "credit_card"], value: null, ...accountLabels })).toEqual([
      { value: "nubank", label: "Conta principal", hint: undefined, keywords: ["PF", "Nubank", "tipo:checking"] },
      { value: "card", label: "Cartão Nubank", hint: undefined, keywords: ["PF", "Nubank", "tipo:credit_card"] },
    ]);
    expect(accountOptions(ACCOUNTS, { entityIds: ["ltda", "llc"], types: ["checking"], value: null, ...accountLabels }).map((option) => option.hint)).toEqual([
      "Kodama LTDA",
      "Kodama LLC",
    ]);
  });

  it("keeps an archived account only when it is the current value", () => {
    const options = accountOptions(ACCOUNTS, { entityIds: ["ltda"], types: null, value: "closed", ...accountLabels });
    expect(options.map((option) => [option.value, option.hint])).toEqual([
      ["inter", undefined],
      ["closed", "arquivada"],
    ]);
  });

  it("finds accounts by entity, institution and type, not only by name", () => {
    const options = accountOptions(ACCOUNTS, { entityIds: null, types: null, value: null, ...accountLabels });
    expect(filterOptions(options, "nubank").map((option) => option.value)).toEqual(["card", "nubank"]);
    expect(filterOptions(options, "kodama llc").map((option) => option.value)).toEqual(["mercury"]);
    expect(filterOptions(options, "tipo:brokerage").map((option) => option.value)).toEqual(["xp"]);
  });

  it("leaves the hint empty for an entity the session does not know", () => {
    const [option] = accountOptions([account("x", "X", "gone", "cash")], { entityIds: null, types: null, value: null, ...accountLabels });
    expect(option.hint).toBe("");
  });
});

describe("entityOptions", () => {
  it("labels the personal entity PF and hints a currency other than the base one", () => {
    expect(entityOptions(ENTITIES, { kinds: null, baseCurrency: "BRL" })).toEqual([
      { value: "pf", label: "PF", hint: undefined },
      { value: "ltda", label: "Kodama LTDA", hint: undefined },
      { value: "llc", label: "Kodama LLC", hint: "USD" },
    ]);
  });

  it("limits to the requested kinds", () => {
    expect(entityOptions(ENTITIES, { kinds: ["business"], baseCurrency: "BRL" }).map((option) => option.value)).toEqual(["ltda", "llc"]);
  });

  it("entityLabel is PF for the personal entity, the name otherwise", () => {
    expect(entityLabel({ kind: "personal", name: "Guilherme" })).toBe("PF");
    expect(entityLabel({ kind: "business", name: "Kodama LTDA" })).toBe("Kodama LTDA");
  });
});
