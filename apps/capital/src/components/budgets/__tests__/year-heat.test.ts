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
  return { month: n, spent, isProjected: n > 11, isPartial: n === 11, budget: null, budgetId: null, percentUsed: null };
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
  monthBudgets: Array(12).fill(0),
  summary: { spentToDate: 0, budgetToDate: 0, projectedYear: 0, budgetYear: 0, overBudgetMonths: 0, budgetedCells: 0 },
  insights: [],
  yearlyBudgets: [],
} as YearOverview;

function render(kind: "fixo" | "variavel" | null): string {
  const client = new QueryClient();
  const element: ReactElement = createElement(YearBody, { data: overview, today: { year: 2026, month: 11 }, kind, onOpenMonth: noop, actions });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NextIntlClientProvider, intl, element)));
}

describe("the year heatmap on a phone", () => {
  it("keeps the category name in a sticky column and still splits fixo from variável", () => {
    const html = render(null);
    expect(html).toContain("minmax(11rem,1.1fr)");
    expect(html).not.toContain("minmax(0,1.1fr)");
    expect(html).toContain("max-md:grid-cols-[11rem_repeat(12,minmax(3rem,1fr))_92px_76px]");
    expect(html).toContain("min-w-[1004px]");
    expect(html).toContain("max-md:min-w-[980px]");
    expect(html).toContain("max-md:sticky");
    expect(html).toContain("max-md:left-0");
    expect(html).toContain("max-md:z-10");
    expect(html).toContain("max-md:bg-panel");
    const cell = /data-budget-category="Transporte"[^>]*>/.exec(html);
    expect(cell).not.toBeNull();
    expect(cell![0]).toContain("max-md:sticky");
    expect(cell![0]).toContain("max-md:flex-col");
    expect(html).toContain(">Transporte<");
    expect(html).toContain(">Variável<");
    expect(html).toContain(">PF<");
    expect(html).toContain("18,3k");

    const fixo = render("fixo");
    expect(fixo).toContain('data-budget-category="Moradia"');
    expect(fixo).not.toContain('data-budget-category="Transporte"');
    const variavel = render("variavel");
    expect(variavel).toContain('data-budget-category="Transporte"');
    expect(variavel).not.toContain('data-budget-category="Moradia"');
  });
});
