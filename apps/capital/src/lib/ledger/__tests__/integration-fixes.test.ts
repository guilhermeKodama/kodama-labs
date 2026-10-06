import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import enEntry from "@/messages/en/entry.json";
import enErrors from "@/messages/en/errors.json";
import enLedger from "@/messages/en/ledger.json";
import ptEntry from "@/messages/pt-BR/entry.json";
import ptErrors from "@/messages/pt-BR/errors.json";
import ptLedger from "@/messages/pt-BR/ledger.json";
import { bulkCategoryGroups } from "@/lib/ledger/bulk-edit";
import { dateInputValue } from "@/lib/ledger/entry-form";
import { hasImportFilter, importFileLabel, importLabels } from "@/lib/ledger/filters";

const ledgerT = (locale: "pt-BR" | "en") => createTranslator({ locale, messages: { ledger: locale === "en" ? enLedger : ptLedger }, namespace: "ledger" });

describe("entityKind chip", () => {
  it("reads 'Entidade é PJ' (mockup vocabulary) and 'Entity is Business'", () => {
    for (const [locale, text] of [
      ["pt-BR", "Entidade é PJ"],
      ["en", "Entity is Business"],
    ] as const) {
      const t = ledgerT(locale);
      expect(t("filters.values", { prop: t("filters.fields.entityKind"), values: t("entityKind.business") })).toBe(text);
    }
    expect(ledgerT("pt-BR")("entityKind.personal")).toBe("PF");
  });
});

describe("import chip", () => {
  it("names the import by its file, as its view is named", () => {
    expect(importFileLabel({ id: "i", fileName: "nubank-fatura-2026-09.ofx", bankName: "Nubank" })).toBe("nubank-fatura-2026-09");
    expect(importFileLabel({ id: "i", fileName: null, bankName: "Nubank" })).toBe("Nubank");
    expect(importFileLabel({ id: "i", fileName: null, bankName: null, account: { name: "Itaú" } })).toBe("Itaú");
    expect(importFileLabel({ id: "i", fileName: null, bankName: null })).toBeNull();
    expect([...importLabels([{ id: "a", fileName: "extrato.ofx", bankName: null }, { id: "b", fileName: null, bankName: null }])]).toEqual([["a", "extrato"]]);
    expect(ledgerT("pt-BR")("filters.import", { file: "extrato-setembro" })).toBe("Importação · extrato-setembro");
    expect(ledgerT("en")("filters.import", { file: "extrato-setembro" })).toBe("Import · extrato-setembro");
  });

  it("only reads the imports when a filter selects by import", () => {
    expect(hasImportFilter([{ field: "importId", op: "in", values: ["i"] }])).toBe(true);
    expect(hasImportFilter([{ field: "flowKind", op: "in", values: ["out"] }])).toBe(false);
  });
});

describe("bulk Categoria ▾", () => {
  it("groups Despesas then Receitas, by name, without archived or investment categories", () => {
    const groups = bulkCategoryGroups([
      { id: "1", name: "Salário", type: "income", isArchived: false },
      { id: "2", name: "Mercado", type: "expense", isArchived: false },
      { id: "3", name: "Aluguel", type: "expense", isArchived: false },
      { id: "4", name: "Velha", type: "expense", isArchived: true },
      { id: "5", name: "Ações", type: "investment", isArchived: false },
    ]);
    expect(groups.map((g) => [g.type, g.categories.map((c) => c.name)])).toEqual([
      ["expense", ["Aluguel", "Mercado"]],
      ["income", ["Salário"]],
    ]);
    expect(bulkCategoryGroups([{ id: "1", name: "Salário", type: "income", isArchived: false }]).map((g) => g.type)).toEqual(["income"]);
    for (const [locale, messages, labels] of [
      ["pt-BR", ptEntry, ["Despesas", "Receitas"]],
      ["en", enEntry, ["Expenses", "Income"]],
    ] as const) {
      const t = createTranslator({ locale, messages: { entry: messages }, namespace: "entry" });
      expect([t("bulk.categoryGroup.expense"), t("bulk.categoryGroup.income")]).toEqual(labels);
    }
  });

  it("explains category.type_mismatch for an entry and for a merge", () => {
    const pt = createTranslator({ locale: "pt-BR", messages: { errors: ptErrors }, namespace: "errors" });
    const en = createTranslator({ locale: "en", messages: { errors: enErrors }, namespace: "errors" });
    expect(pt("category.type_mismatch", { from: "income", to: "expense" })).toBe("Uma categoria de receitas não combina com despesas.");
    expect(en("category.type_mismatch", { from: "income", to: "expense" })).toBe("Income categories don't go with expenses.");
  });
});

describe("DateInput value", () => {
  it("is the date while the text reads as one, else empty so Salvar stops at the field", () => {
    expect(dateInputValue("22/09/2026", "dd/MM/yyyy", "2026-10-06")).toBe("2026-09-22");
    expect(dateInputValue("22/09", "dd/MM/yyyy", "2026-10-06")).toBe("2026-09-22");
    expect(dateInputValue("", "dd/MM/yyyy", "2026-10-06")).toBe("");
    expect(dateInputValue("31/02/2026", "dd/MM/yyyy", "2026-10-06")).toBe("");
    expect(dateInputValue("ontem", "dd/MM/yyyy", "2026-10-06")).toBe("");
  });
});
