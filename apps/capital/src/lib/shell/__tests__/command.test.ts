import { describe, expect, it } from "vitest";
import { decodeCreateParam } from "@/lib/ledger/quick-add";
import { commandItems, commandScore, filterCommands, normalizeSearch, type CommandItem, type Translate } from "@/lib/shell/command-items";
import { isQuickAdd, ledgerHref, quickAddCatalog, quickAddChipFields, SETTINGS_PAGES, settingsHref, todayIn, transactionSearchQuery } from "@/lib/shell/command-targets";

/** Echoes the key and its values, so labels are predictable. */
const t: Translate = (key, values) => (values ? `${key}(${Object.values(values).join(",")})` : key);

const source = {
  t,
  views: [
    { id: "v1", name: "Todas", isFavorite: true, config: { layout: "table" } },
    { id: "v2", name: "Calendário de gastos", isFavorite: false, config: { layout: "calendar" } },
  ],
  theme: "light" as const,
  themeLabels: { system: "Sistema", light: "Claro", dark: "Escuro" },
  locale: "pt-BR",
  locales: [
    { locale: "pt-BR" as const, label: "Português" },
    { locale: "en" as const, label: "English" },
  ],
};

describe("commandItems", () => {
  const items = commandItems(source);
  const byId = (id: string) => items.find((item) => item.id === id) as CommandItem;

  it("goes to every screen, the trash and every page of Ajustes", () => {
    expect(byId("go:budgets").action).toEqual({ type: "navigate", href: "/transactions/budgets" });
    expect(byId("go:trash").action).toEqual({ type: "navigate", href: "/transactions?trash=1" });
    expect(byId("go:settings")).toMatchObject({ shortcut: "mod+,", action: { type: "settings" } });
    for (const page of SETTINGS_PAGES) expect(byId(`go:settings:${page}`)).toMatchObject({ label: `goTo.settingsPage(settingsPages.${page})`, action: { type: "settings", page } });
  });

  it("lists the views with their glyph, opening them on Transações", () => {
    expect(byId("view:v2")).toMatchObject({ group: "views", label: "Calendário de gastos", glyph: "▤", hint: undefined, action: { type: "navigate", href: "/transactions?view=v2" } });
    expect(byId("view:v1")).toMatchObject({ glyph: "▦", hint: "views.favorite" });
  });

  it("creates, and marks the current theme and language", () => {
    expect(byId("create:entry")).toMatchObject({ shortcut: "n", action: { type: "create" } });
    expect(byId("create:import").action).toEqual({ type: "import" });
    expect(byId("create:view").action).toEqual({ type: "newView" });
    expect(items.filter((item) => item.checked).map((item) => item.id)).toEqual(["theme:light", "locale:pt-BR"]);
    expect(byId("theme:dark").label).toBe("account.theme(Escuro)");
    expect(byId("account:signOut").action).toEqual({ type: "signOut" });
  });

  it("has unique ids", () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe("search", () => {
  it("ignores case and accents", () => {
    expect(normalizeSearch("  Orçamentos  DE  Mês ")).toBe("orcamentos de mes");
    expect(commandScore("Orçamentos", "orcam")).toBeGreaterThan(0);
  });

  it("ranks exact, prefix, word start, words, substring", () => {
    const scores = [
      commandScore("Aportes", "aportes"),
      commandScore("Aportes", "apo"),
      commandScore("Ajustes › Categorias", "categ"),
      commandScore("Ajustes › Regras de categorização", "regras cat"),
      commandScore("Carteira", "artei"),
    ];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
    expect(commandScore("Carteira", "xyz")).toBe(0);
  });

  it("filters by group order, best matches first", () => {
    const labels: Record<string, string> = { "settingsPages.imports": "Importações", "create.import": "Importar extrato" };
    const real: Translate = (key, values) => (key === "goTo.settingsPage" ? `Ajustes › ${values?.page}` : (labels[key] ?? key));
    const sections = filterCommands(commandItems({ ...source, t: real }), "import");
    expect(sections.map((section) => section.group)).toEqual(["goTo", "create"]);
    expect(sections[0].items.map((item) => item.id)).toEqual(["go:settings:imports"]);
    expect(sections[1].items.map((item) => item.id)).toEqual(["create:import"]);
    // "Importar extrato" starts with the text; "Ajustes › Importações" only has a word that does.
    expect(commandScore("Importar extrato", "import")).toBeGreaterThan(commandScore("Ajustes › Importações", "import"));
  });

  it("keeps everything but the search-only items, in order, with no query", () => {
    const items = commandItems(source);
    const sections = filterCommands(items, "  ");
    const shown = sections.flatMap((section) => section.items);
    expect(shown).toEqual(items.filter((item) => !item.searchOnly));
    expect(shown.map((item) => item.id)).toContain("go:settings");
    expect(shown.map((item) => item.id)).not.toContain("go:settings:bank");
    expect(shown.filter((item) => item.group === "account").map((item) => item.id)).toEqual(["account:signOut"]);
    expect(sections.map((section) => section.group)).toEqual(["goTo", "views", "create", "account"]);
  });

  it("finds the search-only items once something is typed", () => {
    const ids = filterCommands(commandItems(source), "escuro").flatMap((section) => section.items.map((item) => item.id));
    expect(ids).toEqual(["theme:dark"]);
  });
});

describe("ledgerHref", () => {
  it("from another screen opens Transações' default view", () => {
    expect(ledgerHref({ pathname: "/investments", search: "?scope=pj" }, { entry: "e1" })).toBe("/transactions?entry=e1");
    expect(ledgerHref({ pathname: "/settings", search: "" }, { import: true })).toBe("/transactions?import=1");
  });

  it("on Transações keeps the view and its draft and swaps the overlay", () => {
    const href = ledgerHref({ pathname: "/transactions", search: "?view=v2&draft=abc&entry=old&display=1" }, { create: { description: "Ifood", amount: 86.9, date: "2026-09-21" } });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("view")).toBe("v2");
    expect(url.searchParams.get("draft")).toBe("abc");
    expect(url.searchParams.has("entry")).toBe(false);
    expect(url.searchParams.has("display")).toBe(false);
    expect(decodeCreateParam(url.searchParams.get("create"))).toEqual({ description: "Ifood", amount: 86.9, date: "2026-09-21" });
  });

  it("a blank create and a search", () => {
    expect(ledgerHref({ pathname: "/transactions", search: "" }, { create: {} })).toBe("/transactions?create=1");
    expect(ledgerHref({ pathname: "/transactions", search: "view=v1" }, { q: "uber" })).toBe("/transactions?view=v1&q=uber");
  });
});

describe("settingsHref", () => {
  it("opens a page of Ajustes", () => {
    expect(settingsHref()).toBe("/settings");
    expect(settingsHref("cat")).toBe("/settings?page=cat");
  });
});

describe("transactionSearchQuery", () => {
  it("is the cheap display search over every date (C5)", () => {
    expect(transactionSearchQuery("  ifood ")).toEqual({
      semantics: "display",
      skipTotals: true,
      search: "ifood",
      period: { preset: "all" },
      includeRows: true,
      page: { limit: 8 },
    });
  });
});

describe("quick add in ⌘K", () => {
  it("is offered when the text has an amount", () => {
    expect(isQuickAdd({ draft: { description: "Ifood", amount: 86.9 }, tokens: [] })).toBe(true);
    expect(isQuickAdd({ draft: { description: "ifood nubank" }, tokens: [] })).toBe(false);
    expect(isQuickAdd({ draft: { amount: 0 }, tokens: [] })).toBe(false);
  });

  it("shows the fields found, Saída only when it is not the default", () => {
    expect(quickAddChipFields({ description: "Ifood", amount: 86.9, kind: "expense", accountId: "a", date: "2026-09-21" })).toEqual(["description", "amount", "account", "date"]);
    expect(quickAddChipFields({ amount: 5000, kind: "income", entityId: "e", categoryName: "Mercado", currency: "USD" })).toEqual(["amount", "kind", "entity", "category", "currency"]);
  });
});

describe("todayIn", () => {
  it("is the calendar day in the user's timezone", () => {
    const now = new Date("2026-09-22T01:30:00Z");
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-09-21");
    expect(todayIn("Europe/Berlin", now)).toBe("2026-09-22");
    expect(todayIn("Not/AZone", now)).toBe("2026-09-22");
  });
});

describe("quickAddCatalog", () => {
  it("leaves archived items out and keeps the base currency", () => {
    const catalog = quickAddCatalog({
      accounts: [
        { id: "a1", name: "Nubank", entityId: "e1", type: "checking", currency: "BRL", archivedAt: null },
        { id: "a2", name: "Antiga", entityId: "e1", type: "checking", currency: "BRL", archivedAt: "2026-01-01" },
      ],
      entities: [
        { id: "e1", name: "Pessoal", kind: "personal" },
        { id: "e2", name: "Acme LLC", kind: "business", archivedAt: "2026-01-01" },
      ],
      categories: [
        { id: "c1", name: "Mercado", type: "expense", isArchived: false },
        { id: "c2", name: "Velha", type: "expense", isArchived: true },
      ],
      currencies: ["usd"],
      baseCurrency: "BRL",
    });
    expect(catalog.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(catalog.entities).toEqual([{ id: "e1", name: "Pessoal", kind: "personal" }]);
    expect(catalog.categories.map((c) => c.id)).toEqual(["c1"]);
    expect([...catalog.currencies].sort()).toEqual(["BRL", "USD"]);
  });
});
