import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { LedgerGroup } from "@capital/server/modules/ledger/contracts";
import { useLedgerLabels } from "@/components/ledger/fields";
import type { Names } from "@/lib/api/catalog";
import { viewConfig } from "@/lib/ledger/__tests__/fixtures";
import ptLedger from "@/messages/pt-BR/ledger.json";
import ptCommon from "@/messages/pt-BR/common.json";
import { LedgerTable } from "../ledger-table";
import type { DisplayRow } from "../../rows";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number; getItemKey?: (index: number) => string | number }) => {
    const items = Array.from({ length: options.count }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: 0,
      size: options.estimateSize(index),
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => items.reduce((sum, item) => sum + item.size, 0),
      measure: () => undefined,
      scrollToIndex: () => undefined,
    };
  },
}));

vi.mock("../../row-actions", async () => {
  const { createElement: h } = await import("react");
  return {
    useRowActions: () => ({ open: () => undefined, remove: () => undefined, duplicate: () => undefined, dialogs: null }),
    RowActionsMenu: ({ row }: { row: { description: string } }) => h("button", { type: "button", "aria-label": `Ações de ${row.description}` }, "⋯"),
  };
});

const intl: ComponentProps<typeof NextIntlClientProvider> = {
  locale: "pt-BR",
  messages: { ledger: ptLedger, common: ptCommon },
  timeZone: "America/Sao_Paulo",
  children: null,
};

const names = {
  entities: [],
  accounts: [],
  categories: [],
  entity: new Map([["pf", "PF"]]),
  account: new Map([["nubank", "Nubank"]]),
  category: new Map([["transporte", "Transporte"]]),
  currency: "BRL",
} as Names;

const row = {
  id: "e1",
  date: "2026-11-01",
  effectiveDate: "2026-11-01",
  description: "Uber para o aeroporto",
  notes: null,
  kind: "expense",
  amount: -4.6,
  currency: "BRL",
  exchangeRate: 1,
  amountBase: -4.6,
  entityId: "pf",
  accountId: "nubank",
  accountType: "checking",
  categoryId: "transporte",
  reimbursesCategoryId: null,
  isTaxDeductible: false,
  isRecurring: false,
  transferGroupId: null,
  transferDirection: null,
  counterpartAccountId: null,
  cardStatementId: null,
  installmentPlanId: null,
  installmentNumber: null,
  recurringRuleId: null,
  importId: null,
  deletedAt: null,
  legIds: ["e1"],
  flowKind: "out",
  counts: true,
  displayAmount: -4.6,
  neutral: false,
  counterpartEntityId: null,
  installmentTotal: null,
  linkedOperationId: null,
  operationType: null,
  attachmentCount: 0,
  groupKeys: ["transporte"],
} as DisplayRow;

const groups: LedgerGroup[] = [{ key: "transporte", count: 6, values: { "sum:amountBase": -27.6, "count:amountBase": 6 } }];

function Probe({ narrow }: { narrow?: boolean }) {
  const labels = useLedgerLabels(names);
  return createElement(LedgerTable, {
    rows: [row],
    groups,
    config: viewConfig({ groupBy: [{ field: "categoryId" }], calcs: { amountBase: "sum" } }),
    totals: { "sum:amountBase": -27.6 },
    totalCount: 1,
    names,
    labels,
    periodLabel: "nov/2026",
    loading: false,
    hasMore: false,
    onLoadMore: () => undefined,
    selected: new Set<string>(),
    onSelected: () => undefined,
    allInView: false,
    onAllInView: () => undefined,
    onConfig: () => undefined,
    narrow,
  });
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, element));
}

describe("the transactions table on a phone", () => {
  it("draws the description, the date, the category and the account, and writes the footer labels in full", () => {
    const html = render(createElement(Probe, { narrow: true }));
    expect(html).toContain('data-ledger-layout="compact"');
    expect(html).toContain("Uber para o aeroporto");
    expect(html).toContain("font-semibold");
    const meta = /data-ledger-meta=""[^>]*>([^<]*)</.exec(html);
    expect(meta?.[1]).toContain("01/11");
    expect(meta?.[1]).toContain("PF");
    expect(meta?.[1]).toContain("Nubank");
    expect(meta?.[1]).toContain("Transporte");
    expect(html).toContain("−R$ 4,60");
    expect(html).toContain('aria-label="Selecionar linha"');
    expect(html).toContain('aria-label="Ações de Uber para o aeroporto"');
    expect(html).toContain(">Transporte<");
    expect(html).toContain(">6<");

    const footer = html.slice(html.indexOf('data-ledger-footer=""'));
    expect(footer).toContain("flex-wrap");
    expect(footer).toContain("Descrição");
    expect(footer).toContain("Calcular");
    expect(footer).toContain("Valor");
    expect(footer).toContain("Soma");
    expect(footer).not.toContain("grid-template-columns");
    expect(footer).not.toContain("overflow-hidden");
  });

  it("keeps the column grid, and the description column, on a wide window", () => {
    const html = render(createElement(Probe, { narrow: false }));
    expect(html).toContain('data-ledger-layout="grid"');
    expect(html).not.toContain("data-ledger-meta");
    expect(html).toContain("minmax(0, 2.2fr)");
    expect(html).toContain("Descrição");
    expect(html).toContain("Uber para o aeroporto");
    const footer = html.slice(html.indexOf('data-ledger-footer=""'));
    expect(footer).toContain("grid-template-columns");
    expect(footer).not.toContain(">Descrição<");
  });
});
