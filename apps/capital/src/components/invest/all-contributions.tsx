"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { LedgerDisplayQueryResult } from "@capital/server/modules/ledger/contracts";
import { Btn, Check, EmptyRow, Popover, PopoverClose, TextInput } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { EntrySheet } from "@/components/ledger/entry-sheet";
import { useLedgerOverlays } from "@/components/ledger/overlay-state";
import { api, apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { useDebounced } from "@/lib/invest/api";
import {
  CONTRIBUTION_DIRECTIONS,
  CONTRIBUTION_PERIODS,
  contributionRow,
  contributionsQuery,
  contributionTotals,
  EMPTY_CONTRIBUTION_FILTERS,
  type ContributionFilters,
  type ContributionPeriod,
} from "@/lib/invest/contributions-ledger";
import { cn } from "@/lib/utils";
import { MONO } from "./common";

type Option = { value: string; label: string; hint?: string };

/** A filter chip: "Prop" when empty, "Prop: a, b" when set; the popover checks values (or picks one). */
function Chip({
  label,
  options,
  values,
  onChange,
  single,
  clearable = true,
}: {
  label: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  clearable?: boolean;
}) {
  const t = useTranslations("invest.contrib.all");
  const on = values.length > 0;
  const shown = values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center overflow-hidden rounded-[6px] border text-[12px]", on ? "border-stroke-2 bg-fill-3" : "border-dashed border-stroke-1")}>
      <Popover
        width={260}
        trigger={
          <button type="button" className="h-full max-w-[280px] truncate px-2 text-left whitespace-nowrap">
            {on ? t("chip", { prop: label, values: shown }) : label}
          </button>
        }
      >
        <span className="text-[11px] text-fg-3">{label}</span>
        <div className="-mx-1 flex max-h-[280px] flex-col gap-1.5 overflow-auto px-1">
          {options.map((o) =>
            single ? (
              <PopoverClose key={o.value}>
                <button type="button" className={cn(MENU_ROW, "hover:bg-fill-3", values.includes(o.value) && "font-medium text-fg-1")} onClick={() => onChange([o.value])}>
                  {o.label}
                </button>
              </PopoverClose>
            ) : (
              <Check
                key={o.value}
                checked={values.includes(o.value)}
                onChange={(checked) => onChange(checked ? [...values, o.value] : values.filter((v) => v !== o.value))}
                label={
                  <span className="inline-flex min-w-0 gap-1.5">
                    <span className="truncate">{o.label}</span>
                    {o.hint ? <span className="truncate text-fg-3">{o.hint}</span> : null}
                  </span>
                }
              />
            ),
          )}
          {!options.length ? <span className="text-[12px] text-fg-3">{t("noOptions")}</span> : null}
        </div>
        {single ? null : (
          <PopoverClose>
            <Btn primary>{t("done")}</Btn>
          </PopoverClose>
        )}
      </Popover>
      {on && clearable ? (
        <button type="button" title={t("remove")} aria-label={t("remove")} className="h-full border-l border-stroke-3 px-[7px] text-fg-3 hover:text-fg-strong" onClick={() => onChange([])}>
          ✕
        </button>
      ) : null}
    </span>
  );
}

/**
 * Aportes › "Todos os aportes" (lib/invest/contributions-ledger.ts): every
 * aporte and resgate, newest first, paged with "Carregar mais"; each row
 * opens the entry's sheet (?entry=<id>, the same EntrySheet as Transações).
 */
export function AllContributions() {
  const t = useTranslations("invest.contrib.all");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const names = useNames();
  const overlays = useLedgerOverlays();
  const errorText = useErrorMessage();
  const [filters, setFilters] = useState<ContributionFilters>(EMPTY_CONTRIBUTION_FILTERS);
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText, 250);
  const query = useMemo(() => contributionsQuery({ ...filters, search }), [filters, search]);
  const set = (patch: Partial<ContributionFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const pages = useInfiniteQuery({
    queryKey: keys.ledgerQuery({ ...query.body, paged: true }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiPost<LedgerDisplayQueryResult>("/api/v2/ledger/query", { ...query.body, page: { ...query.body.page, cursor: pageParam } }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => {
    const all = (pages.data?.pages ?? []).flatMap((page) => page.rows);
    return (query.clientFilter ? all.filter(query.clientFilter) : all).map(contributionRow);
  }, [pages.data, query]);
  const totals = contributionTotals(rows);
  const serverCount = pages.data?.pages[0]?.totals?.count ?? null;

  const exportCsv = useAppMutation({
    event: null,
    mutationFn: async () => {
      const csv = await api<string>("/api/v2/ledger/export", { method: "POST", body: JSON.stringify({ query: query.selection }) });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "capital-aportes.csv";
      link.click();
      URL.revokeObjectURL(url);
    },
    undo: () => t("exported"),
  });

  const accounts = names.accounts.filter((a) => !a.archivedAt || filters.accountIds.includes(a.id) || filters.brokerIds.includes(a.id));
  const accountOptions = accounts.filter((a) => a.type === "checking" || a.type === "cash").map((a) => ({ value: a.id, label: a.name, hint: names.entity.get(a.entityId) }));
  const brokerOptions = accounts.filter((a) => a.type === "brokerage").map((a) => ({ value: a.id, label: a.name, hint: names.entity.get(a.entityId) }));
  const entityOptions = names.entities.map((e) => ({ value: e.id, label: names.entity.get(e.id) ?? e.id }));
  const periodOptions = CONTRIBUTION_PERIODS.map((p) => ({ value: p, label: ti(`portfolio.display.periods.${p}`) }));
  const typeOptions = CONTRIBUTION_DIRECTIONS.map((d) => ({ value: d, label: t(`type.${d}`) }));
  const account = (id: string | null) => (id ? (names.account.get(id) ?? "—") : "—");
  const grid = "76px 70px minmax(0,1.6fr) minmax(0,1fr) 92px 112px";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip label={t("filters.period")} options={periodOptions} values={[filters.period]} single clearable={filters.period !== "all"} onChange={(v) => set({ period: (v[0] as ContributionPeriod | undefined) ?? "all" })} />
        <Chip label={t("filters.type")} options={typeOptions} values={filters.directions} onChange={(v) => set({ directions: v as ContributionFilters["directions"] })} />
        <Chip label={t("filters.account")} options={accountOptions} values={filters.accountIds} onChange={(v) => set({ accountIds: v })} />
        <Chip label={t("filters.broker")} options={brokerOptions} values={filters.brokerIds} onChange={(v) => set({ brokerIds: v })} />
        <Chip label={t("filters.entity")} options={entityOptions} values={filters.entityIds} onChange={(v) => set({ entityIds: v })} />
        <span className="flex-1" />
        <TextInput value={searchText} onChange={setSearchText} placeholder={t("search")} aria-label={t("search")} className="w-[170px]" />
        <Btn disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
          {t("export")}
        </Btn>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
        <span>{t("loaded", { count: rows.length, total: query.clientFilter ? rows.length : (serverCount ?? rows.length) })}</span>
        <span className={MONO}>{t("totals", { deposits: fmt.money0(totals.deposits, names.currency), withdrawals: fmt.money0(totals.withdrawals, names.currency), net: fmt.money0(totals.net, names.currency) })}</span>
      </div>
      {pages.isError ? <p className="text-[12.5px] text-neg">{errorText(pages.error)}</p> : null}
      <div className="overflow-hidden rounded-[8px] border border-stroke-3">
        <div className="grid h-[34px] items-center gap-2.5 px-3 text-[11.5px] text-fg-3" style={{ gridTemplateColumns: grid }}>
          <span>{t("columns.date")}</span>
          <span>{t("columns.type")}</span>
          <span>{t("columns.route")}</span>
          <span>{t("columns.description")}</span>
          <span>{t("columns.entity")}</span>
          <span className="text-right">{t("columns.amount")}</span>
        </div>
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => overlays.openEntry(r.id)}
            className="grid h-9 w-full items-center gap-2.5 border-t border-stroke-3 px-3 text-left text-[12.5px] hover:bg-fill-4"
            style={{ gridTemplateColumns: grid }}
          >
            <span className={cn(MONO, "text-[11.5px] text-fg-3")}>{fmt.date(r.date)}</span>
            <span className={r.direction === "investment_withdrawal" ? "text-fg-2" : undefined}>{t(`type.${r.direction}`)}</span>
            <span className="truncate">
              {r.direction === "investment_withdrawal"
                ? t("route", { from: account(r.brokerAccountId), to: account(r.otherAccountId) })
                : t("route", { from: account(r.otherAccountId), to: account(r.brokerAccountId) })}
            </span>
            <span className="truncate text-fg-3">{r.description}</span>
            <span className="truncate text-fg-2">{names.entity.get(r.entityId) ?? "—"}</span>
            <span className={cn(MONO, "text-right", r.amount < 0 ? "text-neg" : "text-fg-1")}>
              {r.amount < 0 ? "−" : "+"}
              {fmt.money0(Math.abs(r.amount), names.currency)}
            </span>
          </button>
        ))}
        {!rows.length ? <EmptyRow>{pages.isLoading ? ti("loading") : t("empty")}</EmptyRow> : null}
      </div>
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Btn disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {pages.isFetchingNextPage ? ti("loading") : t("loadMore")}
          </Btn>
        </div>
      ) : null}
      {overlays.entryId ? (
        <EntrySheet
          key={overlays.entryId}
          entryId={overlays.entryId}
          row={rows.find((r) => r.id === overlays.entryId || r.row.legIds.includes(overlays.entryId!))?.row ?? null}
          names={names}
          onClose={() => overlays.close("entry")}
        />
      ) : null}
    </div>
  );
}
