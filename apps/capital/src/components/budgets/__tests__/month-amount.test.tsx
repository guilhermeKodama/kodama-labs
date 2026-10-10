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
    usePathname: () => "/transactions",
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

import { editBudgetBody, EditForm, type EditableBudget } from "../budget-dialog";
import { MonthBody } from "../month-view";
import type { BudgetActions } from "../parts";
import type { MonthOverview } from "../use-budgets";
import enBudgets from "@/messages/en/budgets.json";
import enCommon from "@/messages/en/common.json";
import ptBudgets from "@/messages/pt-BR/budgets.json";
import ptCommon from "@/messages/pt-BR/common.json";

type Locale = "pt-BR" | "en";
const MESSAGES = {
  "pt-BR": { common: ptCommon, budgets: ptBudgets },
  en: { common: enCommon, budgets: enBudgets },
};

function render(locale: Locale, element: ReactElement): string {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MESSAGES[locale], timeZone: "America/Sao_Paulo", children: null };
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(NextIntlClientProvider, intl, element))).replace(/&#x27;/g, "'");
}

const noop = () => undefined;
const actions: BudgetActions = { onEdit: noop, onDelete: noop };

const overview = {
  period: { year: 2026, month: 10, daysElapsed: 10, daysInMonth: 31, today: "2026-10-10", isCurrent: true, isPast: false },
  scope: { entityIds: ["pf"] },
  summary: { totalBudget: 1800, totalSpent: 400, totalCommitted: 400, totalRoom: 1400, projectedTotal: 900 },
  budgets: [
    {
      id: "b1",
      entityId: "pf",
      categoryId: "mercado",
      category: "Mercado",
      amount: 1800,
      budgetAmount: 1800,
      currency: "BRL",
      effectiveFrom: "2026-01-01",
      rollover: false,
      notes: null,
      excludeEntityIds: [],
      carry: 0,
      available: 1800,
      spent: 400,
      committed: 400,
      remaining: 1400,
      percentUsed: 22,
      isOverBudget: false,
      status: "on_track",
      pace: { dailySpendRate: 40, allowedDailyRate: 60, projectedTotal: 900, isOverPace: false, daysElapsed: 10, daysRemaining: 21, daysInPeriod: 31 },
    },
  ],
  yearlyBudgets: [],
  insights: [],
  unbudgeted: [],
  monthOverMonth: [],
  series: [],
  upcoming: [],
} as MonthOverview;

const budget: EditableBudget = {
  id: "b1",
  category: "Mercado",
  entityId: "pf",
  amount: 1800,
  notes: null,
  effectiveFrom: "2026-01-01",
  period: "monthly",
};

describe("the Orçado column", () => {
  it("shows the monthly amount as a button named with the category, and keeps the row menu visible", () => {
    const html = render("pt-BR", createElement(MonthBody, { data: overview, actions, onOpenRule: noop, onAllRules: noop }));
    expect(html).toContain("Orçado");
    expect(html).toContain('aria-label="Orçado de Mercado, R$ 1.800. Editar"');
    expect(html).toContain(">R$ 1.800<");
    const menu = /<button[^>]*aria-label="Ações de Mercado"[^>]*>/.exec(html);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain("opacity-40");
    expect(menu![0]).toContain("group-hover:opacity-100");
    expect(menu![0]).toContain("pointer-coarse:opacity-100");
    expect(menu![0]).toContain("focus-visible:opacity-100");
    expect(menu![0]).toContain("data-[state=open]:opacity-100");
    expect(menu![0]).not.toMatch(/(^|["\s])opacity-0(["\s]|$)/);
  });
});

describe("the edit form", () => {
  it("sends the amount in the base currency from the month on screen, and focuses the amount", () => {
    expect(editBudgetBody(2000, "BRL", "  feira ", "2026-10")).toEqual({ amount: 2000, currency: "BRL", notes: "feira", applyFrom: "2026-10" });
    expect(editBudgetBody(2000, "BRL", "   ", "2026-10").notes).toBeNull();

    const html = render("pt-BR", createElement(EditForm, { budget, month: { year: 2026, month: 10 }, onDone: noop, onDelete: noop }));
    expect(html).toContain('value="1.800"');
    expect(html).toMatch(/<input[^>]*autoFocus|autofocus/);
    expect(html).toContain("A partir de");
  });
});
