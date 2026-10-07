"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Dialog, DialogFooter, DialogHead, Field, Kpi, KpiStrip, Segmented, Select, TextInput } from "@/components/cap";
import { apiPost } from "@/lib/api/client";
import { useAccounts, useNames, type AccountRecord } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { useAssetSearch, useDebounced, useFxRates, useOperations } from "@/lib/invest/api";
import { assetPickerState, clearedPick } from "@/lib/invest/asset-picker";
import { exemptionGroup, irEstimate } from "@/lib/invest/ir-estimate";
import { buyPreview, sellPreview, withheldTax } from "@/lib/invest/op-preview";
import { opsPeriodRange } from "@/lib/invest/ops-view";
import { ASSET_CLASSES, type AssetClass, type AssetSearchItem, type Holding, type IncomeType } from "@/lib/invest/types";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { MONO, todayIn } from "./common";

export const OP_KINDS = ["buy", "sell", "income", "deposit", "withdraw"] as const;
export type OpKind = (typeof OP_KINDS)[number];
const INCOME_TYPES: IncomeType[] = ["dividend", "jcp", "fii_income", "interest"];

/** The asset of a buy/sell/income: one of the user's holdings, a market result or a new asset typed by hand. */
type Picked =
  | { type: "holding"; holding: Holding }
  | { type: "market"; item: AssetSearchItem }
  | { type: "custom"; name: string; assetClass: AssetClass };

/** "+ Operação" (mockup InvestOpFlow): Compra, Venda, Provento, Depósito, Resgate. Mounted while open. */
export function OperationDialog({ holdings, initialHoldingId, onClose }: { holdings: readonly Holding[]; initialHoldingId?: string | null; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={640}>
      <OperationForm holdings={holdings} initialHoldingId={initialHoldingId ?? null} onClose={onClose} />
    </Dialog>
  );
}

function OperationForm({ holdings, initialHoldingId, onClose }: { holdings: readonly Holding[]; initialHoldingId: string | null; onClose: () => void }) {
  const t = useTranslations("invest.op");
  const tc = useTranslations("common");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const me = useSession().data;
  const names = useNames();
  const accounts = useAccounts().data ?? [];
  const fx = useFxRates();
  const submitHint = useShortcutLabel("mod+enter");
  const timezone = me?.timezone ?? "America/Sao_Paulo";

  const brokers = accounts.filter((a) => a.type === "brokerage" && !a.archivedAt);
  const cashAccounts = accounts.filter((a) => (a.type === "checking" || a.type === "cash") && !a.archivedAt);
  const active = holdings.filter((h) => h.isActive);
  const initial = initialHoldingId ? (holdings.find((h) => h.id === initialHoldingId) ?? null) : null;

  const [kind, setKind] = useState<OpKind>("buy");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(initial ? { type: "holding", holding: initial } : null);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(initial?.currentPrice ? fmt.number(initial.currentPrice, 2) : "");
  const [priceAsOf, setPriceAsOf] = useState<string | null>(initial?.lastPriceUpdate ?? null);
  const [fees, setFees] = useState(fmt.number(0, 2));
  const [date, setDate] = useState(() => todayIn(timezone));
  const [brokerChoice, setBrokerId] = useState(initial?.accountId ?? "");
  const [source, setSource] = useState<string | null>(null);
  const [incomeType, setIncomeType] = useState<IncomeType>("dividend");
  const [gross, setGross] = useState("");
  const [taxText, setTaxText] = useState<string | null>(null);
  const [creditTo, setCreditTo] = useState("cash");
  const [cashAmount, setCashAmount] = useState("");
  const [cashChoice, setCashAccountId] = useState("");
  const cashAccountId = cashChoice || (cashAccounts.find((a) => a.isDefault && a.entityId === me?.personalEntityId) ?? cashAccounts[0])?.id || "";

  // The accounts may load after the dialog opens: until a broker is chosen, the first one.
  const brokerId = brokerChoice || brokers[0]?.id || "";
  const broker = brokers.find((b) => b.id === brokerId) ?? null;
  const accountLabel = (a: AccountRecord) => `${a.name} ${names.entity.get(a.entityId) ?? ""}`.trim();

  // The holding a trade or income goes to: the picked holding on the chosen broker, or the same ticker held there.
  const target: Holding | null = (() => {
    if (!picked || picked.type === "custom") return null;
    const ticker = picked.type === "holding" ? picked.holding.ticker : picked.item.ticker;
    if (picked.type === "holding" && picked.holding.accountId === brokerId) return picked.holding;
    const sameTicker = (h: Holding) => h.accountId === brokerId && !!ticker && h.ticker?.toUpperCase() === ticker.toUpperCase();
    return holdings.find((h) => sameTicker(h) && h.isActive) ?? holdings.find(sameTicker) ?? null;
  })();
  const assetCurrency = target?.currency ?? (picked?.type === "market" ? picked.item.currency : broker?.currency) ?? fx.base;
  const assetClass: AssetClass | null = target?.assetClass ?? (picked?.type === "market" ? picked.item.assetClass : picked?.type === "custom" ? picked.assetClass : picked?.holding.assetClass) ?? null;

  // Default funding source: the main checking of the broker's entity (the aporte is a transfer).
  const ownAccounts = broker ? cashAccounts.filter((a) => a.entityId === broker.entityId) : [];
  const defaultSource = (ownAccounts.find((a) => a.isDefault) ?? ownAccounts[0])?.id ?? "cash";
  const fundFrom = source ?? defaultSource;

  // Asset picker (lib/invest/asset-picker.ts): once an asset is picked, a compact row replaces the box and the list,
  // and the search is off; otherwise the user's holdings while the box is empty, search results while typing
  // (market results only for a buy).
  const picker = assetPickerState(picked, query);
  const debounced = useDebounced(query, 250);
  const search = useAssetSearch(debounced, kind === "buy", picker.searchEnabled);
  const results: { key: string; ticker: string | null; name: string; price: number | null; currency: string; pick: Picked }[] = (() => {
    if (picker.mode === "selected") return [];
    if (!query.trim()) {
      return [...active]
        .sort((a, b) => b.marketValueBase - a.marketValueBase)
        .slice(0, 4)
        .map((h) => ({ key: h.id, ticker: h.ticker, name: h.name, price: h.currentPrice, currency: h.currency, pick: { type: "holding", holding: h } }));
    }
    return (search.data?.results ?? []).slice(0, 4).map((item) => {
      const held = item.holdingId ? holdings.find((h) => h.id === item.holdingId) : null;
      return {
        key: item.holdingId ?? `${item.source}:${item.ticker}`,
        ticker: item.ticker,
        name: item.name,
        price: item.price,
        currency: item.currency,
        pick: held ? { type: "holding", holding: held } : { type: "market", item },
      };
    });
  })();

  const pick = (p: Picked) => {
    setPicked(p);
    if (p.type === "holding") {
      setBrokerId(p.holding.accountId);
      if (p.holding.currentPrice) setPrice(fmt.number(p.holding.currentPrice, 2));
      setPriceAsOf(p.holding.lastPriceUpdate);
    } else if (p.type === "market") {
      if (p.item.price) setPrice(fmt.number(p.item.price, 2));
      setPriceAsOf(p.item.priceAsOf ?? new Date().toISOString());
    }
  };
  const unpick = () => {
    const cleared = clearedPick();
    setPicked(cleared.picked);
    setQuery(cleared.query);
  };

  // Numbers
  const n = fmt.parseNumber(qty);
  const pr = fmt.parseNumber(price);
  const fe = fees.trim() ? fmt.parseNumber(fees) : 0;
  const trade = { quantity: Number.isFinite(n) ? n : 0, price: Number.isFinite(pr) ? pr : 0, fees: Number.isFinite(fe) ? fe : 0 };
  const position = target ? { quantity: target.currentQuantity, averageCost: target.averageCost } : null;
  const buy = buyPreview(position, trade);
  const sell = sellPreview(position, trade);
  const rate = fx.rateFor(assetCurrency);

  const month = opsPeriodRange({ preset: "this_month" }, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIn(timezone));
  const monthSales = useOperations({ type: "sell", from: month?.from, to: month?.to }, kind === "sell");
  const group = assetClass ? exemptionGroup(assetClass) : null;
  const salesInMonth = (monthSales.data ?? []).filter((op) => group && op.assetClass && exemptionGroup(op.assetClass) === group).reduce((s, op) => s + op.totalAmount * fx.rateFor(op.currency), 0);
  const ir = assetClass ? irEstimate({ assetClass, currency: assetCurrency, gain: sell.gain * rate, saleAmount: trade.quantity * trade.price * rate, monthSales: salesInMonth }) : null;

  const grossValue = fmt.parseNumber(gross);
  const autoTax = withheldTax(incomeType, Number.isFinite(grossValue) ? grossValue : 0);
  const taxValue = taxText === null ? autoTax : fmt.parseNumber(taxText);
  const cashValue = fmt.parseNumber(cashAmount);

  const valid = (() => {
    if (kind === "deposit" || kind === "withdraw") return !!broker && !!cashAccountId && cashValue > 0;
    if (!broker || !picked) return false;
    if (kind === "income") return !!target && grossValue > 0 && Number.isFinite(taxValue) && taxValue >= 0 && taxValue <= grossValue;
    if (!(trade.quantity > 0) || !(trade.price >= 0) || !Number.isFinite(n) || !Number.isFinite(pr)) return false;
    if (kind === "sell") return !!target && !sell.oversell;
    return picked.type !== "custom" || picked.name.trim().length > 0;
  })();

  const save = useAppMutation({
    event: "investments.write",
    mutationFn: async (): Promise<{ batchId?: string | null; funded: boolean }> => {
      if (kind === "deposit") {
        const r = await apiPost<{ batchId: string }>("/api/v2/investments/aporte", { fromAccountId: cashAccountId, brokerAccountId: brokerId, amount: cashValue, date });
        return { ...r, funded: false };
      }
      if (kind === "withdraw") {
        const r = await apiPost<{ batchId: string | null }>("/api/v2/brokerage-cash", { accountId: brokerId, direction: "withdraw", amount: cashValue, date, counterpartAccountId: cashAccountId });
        return { ...r, funded: false };
      }
      if (kind === "buy") {
        const order = target
          ? { holdingId: target.id }
          : {
              newHolding:
                picked?.type === "custom"
                  ? { name: picked.name.trim(), ticker: null, assetClass: picked.assetClass, currency: broker?.currency, accountId: brokerId }
                  : picked?.type === "market"
                    ? { name: picked.item.name, ticker: picked.item.ticker, assetClass: picked.item.assetClass, currency: picked.item.currency, accountId: brokerId }
                    : { name: picked!.type === "holding" ? picked!.holding.name : "", ticker: picked!.type === "holding" ? picked!.holding.ticker : null, assetClass: assetClass!, currency: assetCurrency, accountId: brokerId },
            };
        const funded = fundFrom !== "cash";
        const r = await apiPost<{ batchId: string }>("/api/v2/investments/orders", {
          date,
          fundFromAccountId: funded ? fundFrom : null,
          orders: [{ ...order, quantity: trade.quantity, price: trade.price, fees: trade.fees }],
        });
        return { ...r, funded };
      }
      if (kind === "sell") {
        const r = await apiPost<{ batchId: string }>("/api/v2/investment-operations", {
          holdingId: target!.id,
          type: "sell",
          quantity: trade.quantity,
          pricePerUnit: trade.price,
          totalAmount: Math.round(trade.quantity * trade.price * 1e4) / 1e4,
          fees: trade.fees,
          date,
        });
        return { ...r, funded: false };
      }
      const r = await apiPost<{ batchId: string }>("/api/v2/investment-operations", {
        holdingId: target!.id,
        type: incomeType === "interest" ? "yield_payment" : "dividend",
        incomeType,
        totalAmount: grossValue,
        taxWithheld: taxValue,
        creditToAccountId: creditTo === "cash" ? null : creditTo,
        date,
      });
      return { ...r, funded: false };
    },
    undo: (data) => (data.funded ? t("doneFunded", { label: t(`done.${kind}`) }) : t(`done.${kind}`)),
    onSuccess: onClose,
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  const isTrade = kind === "buy" || kind === "sell";
  const brokerOptions = brokers.map((b) => ({ value: b.id, label: b.name, hint: names.entity.get(b.entityId) }));
  const cashLabel = broker && broker.balance !== null ? fmt.money0(broker.balance, broker.currency) : "—";
  const money = (v: number) => fmt.money(v, assetCurrency);
  const qtyText = (v: number) => fmt.number(v, { min: 0, max: 8 });
  // Across currencies the amount is the bank's on a deposit (the aporte debit) and the broker's on a redemption.
  const cashAccount = cashAccounts.find((a) => a.id === cashAccountId);
  const cashCurrencyLabel = cashAccount && broker && cashAccount.currency !== broker.currency ? (kind === "deposit" ? cashAccount.currency : broker.currency) : null;

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={t("desc")} />
      <Segmented value={kind} options={OP_KINDS.map((k) => ({ v: k, l: t(`kind.${k}`) }))} onChange={setKind} aria-label={t("title")} />

      {kind === "buy" || kind === "sell" || kind === "income" ? (
        <Field label={t("asset")}>
          {picker.selected ? (
            <div className="flex h-8 items-center gap-2 rounded-[8px] border border-stroke-3 bg-fill-4 px-2.5 text-[12.5px]">
              {picker.selected.ticker ? <span className={cn(MONO, "font-semibold")}>{picker.selected.ticker}</span> : null}
              <span className="min-w-0 truncate text-fg-3">{picker.selected.isNew ? t("newAssetSelected", { name: picker.selected.name }) : picker.selected.name}</span>
              <span className={cn(MONO, "ml-auto text-[11.5px]")}>{picker.selected.price !== null ? fmt.money(picker.selected.price, picker.selected.currency) : ""}</span>
              <button type="button" onClick={unpick} className="shrink-0 text-[12px] text-fg-2 underline underline-offset-[3px] hover:text-fg-1">
                {t("changeAsset")}
              </button>
            </div>
          ) : (
            <>
              <TextInput value={query} onChange={setQuery} placeholder={t("assetPlaceholder")} autoFocus />
              <div className="overflow-hidden rounded-[8px] border border-stroke-3">
                {results.map((r) => (
                  <button key={r.key} type="button" onClick={() => pick(r.pick)} className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12.5px] hover:bg-fill-3">
                    <span className={cn(MONO, "font-semibold")}>{r.ticker ?? "—"}</span>
                    <span className="min-w-0 truncate text-fg-3">{r.name}</span>
                    <span className={cn(MONO, "ml-auto text-[11.5px]")}>{r.price !== null ? fmt.money(r.price, r.currency) : ""}</span>
                  </button>
                ))}
                {kind === "buy" && query.trim() ? (
                  <button
                    type="button"
                    onClick={() => setPicked({ type: "custom", name: query.trim(), assetClass: "fixed_income" })}
                    className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-[12.5px] text-fg-2 hover:bg-fill-3"
                  >
                    {t("newAsset", { name: query.trim() })}
                  </button>
                ) : null}
                {!results.length && !(kind === "buy" && query.trim()) ? <div className="flex h-8 items-center px-2.5 text-[12px] text-fg-3">{search.isFetching ? t("searching") : t("noAssets")}</div> : null}
              </div>
            </>
          )}
          {picked?.type === "custom" ? (
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <Field label={t("newAssetClass")}>
                <Select
                  value={picked.assetClass}
                  onChange={(v) => setPicked({ ...picked, assetClass: v as AssetClass })}
                  options={ASSET_CLASSES.map((c) => ({ value: c, label: ti(`assetClass.${c}`) }))}
                />
              </Field>
            </div>
          ) : null}
        </Field>
      ) : null}

      {isTrade ? (
        <>
          <div className="grid grid-cols-4 gap-2.5">
            <Field label={t("quantity")}>
              <TextInput value={qty} onChange={setQty} mono inputMode="decimal" />
            </Field>
            <Field label={t("price")} hint={priceAsOf ? t("priceHint", { time: fmt.time(priceAsOf) }) : undefined}>
              <TextInput value={price} onChange={setPrice} mono inputMode="decimal" />
            </Field>
            <Field label={t("fees")}>
              <TextInput value={fees} onChange={setFees} mono inputMode="decimal" />
            </Field>
            <Field label={t("date")}>
              <TextInput type="date" value={date} onChange={setDate} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t("broker")}>
              <Select value={brokerId} onChange={setBrokerId} options={brokerOptions} placeholder={t("noBrokers")} />
            </Field>
            {kind === "buy" ? (
              <Field label={t("source")}>
                <Select
                  value={fundFrom}
                  onChange={setSource}
                  options={[
                    { value: "cash", label: t("sourceCash", { amount: cashLabel }) },
                    ...cashAccounts.map((a) => ({ value: a.id, label: t("sourceAccount", { account: accountLabel(a) }) })),
                  ]}
                />
              </Field>
            ) : null}
          </div>
          <KpiStrip>
            <Kpi label={kind === "buy" ? t("kpi.buyTotal") : t("kpi.sellTotal")} value={money(kind === "buy" ? buy.total : sell.total)} />
            {kind === "buy" ? (
              <>
                <Kpi label={t("kpi.position")} value={`${qtyText(buy.quantityBefore)} → ${qtyText(buy.quantityAfter)}`} sub={t("kpi.units")} />
                <Kpi label={t("kpi.avg")} value={`${fmt.number(buy.averageBefore, 2)} → ${fmt.number(buy.averageAfter, 2)}`} />
              </>
            ) : (
              <>
                <Kpi
                  label={t("kpi.gain")}
                  value={money(sell.gain)}
                  tone={sell.oversell ? "warn" : sell.gain >= 0 ? "pos" : "neg"}
                  sub={sell.oversell ? t("oversell", { quantity: qtyText(position?.quantity ?? 0) }) : t("kpi.avgSub", { avg: fmt.number(sell.averageCost, 2) })}
                />
                <Kpi
                  label={t("kpi.ir")}
                  value={!ir || ir.tax === null ? "—" : ir.exempt ? t("kpi.irExempt") : fmt.money(ir.tax, fx.base)}
                  sub={ir ? t(`ir.${ir.reason}`) : undefined}
                />
              </>
            )}
          </KpiStrip>
        </>
      ) : null}

      {kind === "income" ? (
        <div className="grid grid-cols-3 gap-2.5">
          <Field label={t("income.type")}>
            <Select value={incomeType} onChange={(v) => setIncomeType(v as IncomeType)} options={INCOME_TYPES.map((v) => ({ value: v, label: ti(`incomeType.${v}`) }))} />
          </Field>
          <Field label={t("income.gross")}>
            <TextInput value={gross} onChange={setGross} mono inputMode="decimal" />
          </Field>
          <Field label={t("income.tax")} hint={incomeType === "jcp" ? t("income.taxJcp") : t("income.taxExempt")}>
            <TextInput value={taxText ?? fmt.number(autoTax, 2)} onChange={setTaxText} mono inputMode="decimal" />
          </Field>
          <Field label={t("income.creditTo")} span={2}>
            <Select
              value={creditTo}
              onChange={setCreditTo}
              options={[{ value: "cash", label: t("income.creditCash") }, ...cashAccounts.map((a) => ({ value: a.id, label: t("income.creditAccount", { account: accountLabel(a) }) }))]}
            />
          </Field>
          <Field label={t("date")}>
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
          {picked && !target ? <span className="col-span-3 text-[12px] text-warn">{t("notHeld")}</span> : null}
        </div>
      ) : null}

      {kind === "deposit" || kind === "withdraw" ? (
        <div className="grid grid-cols-3 gap-2.5">
          <Field label={cashCurrencyLabel ? t("cash.amountIn", { currency: cashCurrencyLabel }) : t("cash.amount")}>
            <TextInput value={cashAmount} onChange={setCashAmount} mono inputMode="decimal" autoFocus />
          </Field>
          <Field label={kind === "deposit" ? t("cash.from") : t("cash.to")}>
            <Select value={cashAccountId} onChange={setCashAccountId} options={cashAccounts.map((a) => ({ value: a.id, label: `${names.entity.get(a.entityId) ?? ""} · ${a.name}` }))} />
          </Field>
          <Field label={t("broker")}>
            <Select value={brokerId} onChange={setBrokerId} options={brokerOptions} placeholder={t("noBrokers")} />
          </Field>
          <Field label={t("date")}>
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
          <span className="col-span-3 text-[12px] text-fg-3">{kind === "deposit" ? t("cash.depositNote") : t("cash.withdrawNote")}</span>
        </div>
      ) : null}

      <DialogFooter>
        <Btn ghost onClick={onClose}>
          {tc("cancel")}
        </Btn>
        <Btn primary type="submit" disabled={!valid || save.isPending} title={submitHint}>
          {t(`submit.${kind}`)}
        </Btn>
      </DialogFooter>
    </form>
  );
}
