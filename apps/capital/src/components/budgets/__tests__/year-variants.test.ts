import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  const router = { push: () => undefined, replace: () => undefined, back: () => undefined, refresh: () => undefined, prefetch: () => undefined };
  return {
    Link: ({ href, ...props }: { href: unknown }) => h("a", { ...props, href: String(href) }),
    usePathname: () => "/transactions/budgets",
    useRouter: () => router,
    redirect: () => undefined,
    getPathname: () => "/",
  };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/", useRouter: () => ({}) }));
vi.mock("@/lib/api/session", () => ({
  useSession: () => ({
    data: {
      baseCurrency: "BRL",
      entities: [{ id: "pf", kind: "personal", name: "PF", defaultCurrency: "BRL", color: null }],
    },
  }),
}));

import { YearBody } from "../year-view";
import type { BudgetActions } from "../parts";
import type { YearOverview } from "../use-budgets";
import ptBudgets from "@/messages/pt-BR/budgets.json";
import ptCommon from "@/messages/pt-BR/common.json";

const intl: ComponentProps<typeof NextIntlClientProvider> = {
  locale: "pt-BR",
  messages: { common: ptCommon, budgets: ptBudgets },
  timeZone: "America/Sao_Paulo",
  children: null,
};

const noop = () => undefined;
const actions: BudgetActions = { onEdit: noop, onDelete: noop };

function month(n: number, spent = 0) {
  return { month: n, spent, projected: spent, isProjected: n > 11, isPartial: n === 11, budget: null, budgetId: null, percentUsed: null };
}

function category(name: string, kind: "fixo" | "variavel") {
  return {
    entityId: "pf",
    categoryId: name,
    category: name,
    isBudgeted: true,
    budgetId: name,
    kind,
    budget: 20000,
    excludeEntityIds: [],
    months: Array.from({ length: 12 }, (_, i) => month(i + 1, i === 0 ? 18300 : 0)),
    yearTotal: 18300,
    trend: null,
    overMonths: 0,
    budgetedMonths: 11,
  };
}

const overview = {
  year: 2026,
  currentMonth: 11,
  period: { year: 2026, today: "2026-11-14", nElapsed: 11, completeMonths: 10, isPast: false, yearPace: 0.87, projectionBasis: [3, 10] },
  scope: { entityIds: ["pf"] },
  categories: [category("Transporte", "variavel"), category("Moradia", "fixo")],
  monthTotals: Array(12).fill(0),
  monthProjected: Array(12).fill(0),
  monthBudgets: Array(12).fill(0),
  summary: { spentToDate: 0, budgetToDate: 0, spentInBudgetedMonths: 0, budgetedMonths: [], budgetedSpan: null, projectedYear: 0, budgetYear: 0, overBudgetMonths: 0, budgetedCells: 0 },
  insights: [],
  yearlyBudgets: [],
} as YearOverview;

function render(kind: "fixo" | "variavel" | null): string {
  const client = new QueryClient();
  const element: ReactElement = createElement(YearBody, { data: overview, today: { year: 2026, month: 11 }, kind, onKind: noop, onOpenMonth: noop, actions });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NextIntlClientProvider, intl, element)));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the year on a desktop", () => {
  it("puts the fixo and variável cards above a table grouped by kind, and keeps the single chart", () => {
    const html = render(null);
    expect(html).toContain('data-kind-cards="row"');
    expect(html).toContain('data-kind-card="fixo"');
    expect(html).toContain('data-kind-card="variavel"');
    expect(count(html, "50% do gasto")).toBe(2);
    expect(html).toContain("data-mini-bars");
    expect(html).toContain("var(--cap-chart-1)");
    expect(html).toContain("var(--cap-chart-2)");
    expect(html).not.toContain("data-kind-split-inline");
    expect(html).not.toContain("data-stacked-chart");
    expect(count(html, ">Gasto mensal vs orçado<")).toBe(1);

    expect(html).toContain("data-heat-grouped");
    const fixo = html.indexOf('data-heat-section="fixo"');
    const variavel = html.indexOf('data-heat-section="variavel"');
    const cards = html.indexOf('data-kind-cards="row"');
    expect(cards).toBeGreaterThan(-1);
    expect(cards).toBeLessThan(fixo);
    expect(fixo).toBeLessThan(html.indexOf('data-budget-category="Moradia"'));
    expect(html.indexOf('data-budget-category="Moradia"')).toBeLessThan(variavel);
    expect(variavel).toBeLessThan(html.indexOf('data-budget-category="Transporte"'));
    expect(count(html, "1 categoria<")).toBe(2);
    const head = html.slice(fixo, html.indexOf('data-budget-category="Moradia"'));
    expect(head).toContain("18,3k");
    expect(head).toContain("R$ 18.300");
    // The section names the kind, so the row does not repeat it.
    const row = html.slice(html.indexOf('data-budget-category="Moradia"'), html.indexOf('data-budget-category="Transporte"'));
    expect(row).not.toContain(">Fixo<");
  });

  it("presses the card of the active kind and hides the other section", () => {
    const filtered = render("fixo");
    expect(/data-kind-card="fixo"[^>]*aria-pressed="true"/.test(filtered)).toBe(true);
    expect(/data-kind-card="variavel"[^>]*aria-pressed="false"[^>]*opacity-50/.test(filtered)).toBe(true);
    expect(filtered).toContain('data-heat-section="fixo"');
    expect(filtered).not.toContain('data-heat-section="variavel"');
    expect(filtered).not.toContain('data-budget-category="Transporte"');
  });
});
