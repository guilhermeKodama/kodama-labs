"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Btn,
  Callout,
  Dialog,
  DialogFooter,
  DialogHead,
  Field,
  Select,
  Sheet,
  Table,
  TextInput,
} from "@/components/cap";
import { apiPatch, apiPost, apiPut } from "@/lib/api/client";
import { useAccounts, useNames, type AccountRecord } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { targetsPayload } from "@/lib/invest/allocation";
import { useFxRates, useOperations, useTargets } from "@/lib/invest/api";
import { ordersPayload, type OrderDraft } from "@/lib/invest/rebalance-view";
import {
  ALLOCATION_CLASSES,
  type AllocationClass,
  type FireSummaryResponse,
  type Holding,
  type Operation,
} from "@/lib/invest/types";
import { useShortcut } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { MONO, todayIn } from "./common";

const accountsOf = (
  accounts: readonly AccountRecord[],
  types: readonly AccountRecord["type"][],
) => accounts.filter((a) => types.includes(a.type) && !a.archivedAt);

/** Operation label for toasts and lists: "Dividendo ITUB4", "Compra BOVA11". */
export function useOpLabel() {
  const ti = useTranslations("invest");
  return (op: Pick<Operation, "type" | "incomeType" | "ticker" | "name">) =>
    `${op.incomeType && (op.type === "dividend" || op.type === "yield_payment") ? ti(`incomeType.${op.incomeType}`) : ti(`opType.${op.type}`)} ${op.ticker ?? op.name ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Holding detail
// ---------------------------------------------------------------------------

export function HoldingSheet({
  holding,
  onClose,
  onOperation,
}: {
  holding: Holding;
  onClose: () => void;
  onOperation: () => void;
}) {
  const t = useTranslations("invest.sheet");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const names = useNames();
  const opLabel = useOpLabel();
  const [price, setPrice] = useState(
    holding.currentPrice !== null ? fmt.number(holding.currentPrice, 2) : "",
  );
  const [qty, setQty] = useState(
    fmt.number(holding.currentQuantity, { min: 0, max: 8 }),
  );
  const [avg, setAvg] = useState(fmt.number(holding.averageCost, 2));
  const ops = useOperations({ holdingId: holding.id });
  const display = holding.ticker ?? holding.name;
  const patch = useAppMutation({
    event: "investments.write",
    mutationFn: (body: Record<string, unknown>) =>
      apiPatch<{ batchId?: string }>(`/api/v2/holdings/${holding.id}`, body),
    undo: (_data, body) =>
      "isActive" in body
        ? t("deactivated", { name: display })
        : t("priceSaved", { name: display }),
  });
  const adjust = useAppMutation({
    event: "investments.write",
    mutationFn: () =>
      apiPost<{ batchId?: string }>(`/api/v2/holdings/${holding.id}/adjust`, {
        currentQuantity: fmt.parseNumber(qty),
        averageCost: fmt.parseNumber(avg),
        notes: t("adjustNote"),
      }),
    undo: () => t("adjusted", { name: display }),
  });
  const money = (v: number) => fmt.money(v, holding.currency);
  const details: [string, string][] = [
    [t("class"), ti(`allocationClass.${holding.allocationClass}`)],
    [t("broker"), holding.accountName],
    [t("entity"), names.entity.get(holding.entityId) ?? "—"],
    [t("quantity"), fmt.number(holding.currentQuantity, { min: 0, max: 8 })],
    [t("avgCost"), money(holding.averageCost)],
    [t("invested"), money(holding.totalInvested)],
    [
      t("result"),
      `${money(holding.unrealizedGain)}${holding.unrealizedGainPercent !== null ? ` · ${fmt.pct(holding.unrealizedGainPercent)}` : ""}`,
    ],
    [
      t("priceAt"),
      holding.lastPriceUpdate ? fmt.dateTime(holding.lastPriceUpdate) : "—",
    ],
  ];
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <DialogHead
        title={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn(MONO, "font-semibold")}>
              {holding.ticker ?? "—"}
            </span>
            <span className="truncate font-normal">{holding.name}</span>
          </span>
        }
      />
      <span className={cn(MONO, "text-display font-medium")}>
        {money(holding.marketValue)}
      </span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-body">
        {details.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption text-fg-3">{k}</span>
            <span className="truncate">{v}</span>
          </div>
        ))}
      </div>
      <form
        className="flex items-end gap-1.5 border-t border-stroke-3 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = fmt.parseNumber(price);
          if (Number.isFinite(value) && value >= 0)
            patch.mutate({ currentPrice: value });
        }}
      >
        <Field label={t("price")} className="flex-1">
          <TextInput
            value={price}
            onChange={setPrice}
            mono
            inputMode="decimal"
          />
        </Field>
        <Btn type="submit" disabled={patch.isPending}>
          {t("update")}
        </Btn>
      </form>
      <p className="text-caption text-fg-4">{t("adjustHint")}</p>
      <form
        className="flex items-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            Number.isFinite(fmt.parseNumber(qty)) &&
            Number.isFinite(fmt.parseNumber(avg))
          )
            adjust.mutate();
        }}
      >
        <Field label={t("quantity")} className="flex-1">
          <TextInput value={qty} onChange={setQty} mono inputMode="decimal" />
        </Field>
        <Field label={t("avgCost")} className="flex-1">
          <TextInput value={avg} onChange={setAvg} mono inputMode="decimal" />
        </Field>
        <Btn type="submit" disabled={adjust.isPending}>
          {t("adjust")}
        </Btn>
      </form>
      <div className="flex flex-col border-t border-stroke-3 pt-3">
        <span className="pb-1 text-caption text-fg-3">{t("operations")}</span>
        {(ops.data ?? []).slice(0, 12).map((op) => (
          <span key={op.id} className="flex h-7 items-center gap-2 text-body">
            <span className={cn(MONO, "w-12 text-caption text-fg-3")}>
              {fmt.date(op.date)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {opLabel({ ...op, ticker: null, name: null })}
              {op.quantity
                ? ` · ${fmt.number(op.quantity, { min: 0, max: 8 })}`
                : ""}
            </span>
            <span className={MONO}>{money(op.totalAmount)}</span>
          </span>
        ))}
        {ops.data && !ops.data.length ? (
          <span className="text-body-sm text-fg-3">{t("noOps")}</span>
        ) : null}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-stroke-3 pt-3">
        <Btn primary onClick={onOperation}>
          {t("newOp")}
        </Btn>
        <Btn
          ghost
          danger
          disabled={patch.isPending}
          onClick={() =>
            patch.mutate({ isActive: false }, { onSuccess: onClose })
          }
        >
          {t("deactivate")}
        </Btn>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export function TargetsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={460}>
      <TargetsForm onClose={onClose} />
    </Dialog>
  );
}

function TargetsForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("invest.targets");
  const ti = useTranslations("invest");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const targets = useTargets();
  const [values, setValues] = useState<Partial<
    Record<AllocationClass, string>
  > | null>(null);
  const current = useMemo(
    () =>
      values ??
      Object.fromEntries(
        (targets.data ?? []).map((row) => [
          row.allocationClass,
          fmt.number(row.targetPercent * 100, { min: 0, max: 2 }),
        ]),
      ),
    [values, targets.data, fmt],
  ) as Partial<Record<AllocationClass, string>>;
  const payload = targetsPayload(current, (text) => fmt.parseNumber(text));
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () =>
      apiPut("/api/v2/portfolio/targets", { targets: payload.targets }),
    undo: t("saved"),
    onSuccess: onClose,
  });
  const submit = () => {
    if (payload.valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={t("desc")} />
      <div className="flex flex-col gap-2">
        {ALLOCATION_CLASSES.map((cls) => (
          <label key={cls} className="flex items-center gap-2 text-control">
            <span className="flex-1">{ti(`allocationClass.${cls}`)}</span>
            <TextInput
              value={current[cls] ?? ""}
              onChange={(v) => setValues({ ...current, [cls]: v })}
              mono
              className="w-20 text-right"
              inputMode="decimal"
              placeholder="0"
            />
            <span className="text-fg-3">%</span>
          </label>
        ))}
      </div>
      <DialogFooter justify="between">
        <span
          className={cn(
            MONO,
            "text-body-sm",
            payload.valid ? "text-pos" : "text-warn",
          )}
        >
          {t("sum", { sum: fmt.number(payload.sum, { min: 0, max: 2 }) })}
        </span>
        <span className="flex gap-1.5">
          <Btn ghost onClick={onClose}>
            {tc("cancel")}
          </Btn>
          <Btn
            primary
            type="submit"
            disabled={!payload.valid || save.isPending}
          >
            {tc("save")}
          </Btn>
        </span>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit an operation (Operações tab)
// ---------------------------------------------------------------------------

export function EditOperationDialog({
  operation,
  onClose,
}: {
  operation: Operation;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={560}>
      <EditOperationForm operation={operation} onClose={onClose} />
    </Dialog>
  );
}

function EditOperationForm({
  operation,
  onClose,
}: {
  operation: Operation;
  onClose: () => void;
}) {
  const t = useTranslations("invest.editOp");
  const tc = useTranslations("common");
  const top = useTranslations("invest.op");
  const fmt = useFmt();
  const opLabel = useOpLabel();
  const income =
    operation.type === "dividend" || operation.type === "yield_payment";
  const trade =
    operation.quantity !== null &&
    (operation.type === "buy" || operation.type === "sell");
  const num = (v: number | null, max = 2) =>
    v === null ? "" : fmt.number(v, { min: 0, max });
  const [date, setDate] = useState(operation.date);
  const [qty, setQty] = useState(num(operation.quantity, 8));
  const [price, setPrice] = useState(num(operation.pricePerUnit, 6));
  const [total, setTotal] = useState(num(operation.totalAmount));
  const [fees, setFees] = useState(num(operation.fees));
  const [tax, setTax] = useState(num(operation.taxWithheld));
  const [notes, setNotes] = useState(operation.notes ?? "");
  const parse = (text: string) => (text.trim() ? fmt.parseNumber(text) : 0);
  const quantity = parse(qty);
  const unit = parse(price);
  const totalAmount = trade
    ? Math.round(quantity * unit * 1e4) / 1e4
    : parse(total);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(totalAmount) &&
    totalAmount >= 0 &&
    (!trade || (quantity > 0 && Number.isFinite(unit)));
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () =>
      apiPatch<{ batchId: string }>(
        `/api/v2/investment-operations/${operation.id}`,
        {
          date,
          notes: notes.trim() || null,
          totalAmount,
          ...(trade && { quantity, pricePerUnit: unit, fees: parse(fees) }),
          ...(income && { taxWithheld: parse(tax) }),
        },
      ),
    undo: t("saved"),
    onSuccess: onClose,
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={opLabel(operation)} />
      <div className="grid grid-cols-4 gap-2.5">
        <Field label={top("date")}>
          <TextInput type="date" value={date} onChange={setDate} />
        </Field>
        {trade ? (
          <>
            <Field label={top("quantity")}>
              <TextInput
                value={qty}
                onChange={setQty}
                mono
                inputMode="decimal"
              />
            </Field>
            <Field label={top("price")}>
              <TextInput
                value={price}
                onChange={setPrice}
                mono
                inputMode="decimal"
              />
            </Field>
            <Field label={top("fees")}>
              <TextInput
                value={fees}
                onChange={setFees}
                mono
                inputMode="decimal"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("total")}>
              <TextInput
                value={total}
                onChange={setTotal}
                mono
                inputMode="decimal"
              />
            </Field>
            {income ? (
              <Field label={top("income.tax")}>
                <TextInput
                  value={tax}
                  onChange={setTax}
                  mono
                  inputMode="decimal"
                />
              </Field>
            ) : null}
          </>
        )}
        <Field label={t("notes")} span={4}>
          <TextInput value={notes} onChange={setNotes} />
        </Field>
      </div>
      <DialogFooter>
        <Btn ghost onClick={onClose}>
          {tc("cancel")}
        </Btn>
        <Btn primary type="submit" disabled={!valid || save.isPending}>
          {tc("save")}
        </Btn>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// + Registrar aporte (POST /v2/investments/aporte)
// ---------------------------------------------------------------------------

export function AporteDialog({
  initialAmount,
  onClose,
}: {
  initialAmount?: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={480}>
      <AporteForm initialAmount={initialAmount} onClose={onClose} />
    </Dialog>
  );
}

function AporteForm({
  initialAmount,
  onClose,
}: {
  initialAmount?: number;
  onClose: () => void;
}) {
  const t = useTranslations("invest.aporte");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const me = useSession().data;
  const names = useNames();
  const accounts = useAccounts().data ?? [];
  const sources = accountsOf(accounts, ["checking", "cash"]);
  const brokers = accountsOf(accounts, ["brokerage"]);
  const [fromChoice, setFrom] = useState("");
  const [brokerChoice, setBroker] = useState("");
  // The accounts may arrive after the dialog opens: until chosen, PF's main account and the first broker.
  const from =
    fromChoice ||
    (
      sources.find((a) => a.isDefault && a.entityId === me?.personalEntityId) ??
      sources[0]
    )?.id ||
    "";
  const broker = brokerChoice || brokers[0]?.id || "";
  const [amount, setAmount] = useState(
    initialAmount ? fmt.number(initialAmount, 2) : "",
  );
  const [toAmount, setToAmount] = useState("");
  const [date, setDate] = useState(() =>
    todayIn(me?.timezone ?? "America/Sao_Paulo"),
  );
  const [description, setDescription] = useState("");
  const fromAccount = sources.find((a) => a.id === from);
  const brokerAccount = brokers.find((a) => a.id === broker);
  const crossCurrency =
    !!fromAccount &&
    !!brokerAccount &&
    fromAccount.currency !== brokerAccount.currency;
  const value = fmt.parseNumber(amount);
  const toValue = toAmount.trim() ? fmt.parseNumber(toAmount) : null;
  const valid =
    !!fromAccount &&
    !!brokerAccount &&
    value > 0 &&
    (toValue === null || toValue > 0);
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () =>
      apiPost<{ batchId: string }>("/api/v2/investments/aporte", {
        fromAccountId: from,
        brokerAccountId: broker,
        amount: value,
        toAmount: crossCurrency ? toValue : null,
        date,
        description: description.trim() || null,
      }),
    undo: t("done"),
    onSuccess: onClose,
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  const option = (a: AccountRecord) => ({
    value: a.id,
    label: `${a.name} · ${names.entity.get(a.entityId) ?? ""}`,
    hint: a.currency,
  });
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={t("desc")} />
      <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2">
        <Field label={t("from")}>
          <Select
            value={from}
            onChange={setFrom}
            options={sources.map(option)}
          />
        </Field>
        <span className="pb-1 text-center text-fg-3">→</span>
        <Field label={t("broker")}>
          <Select
            value={broker}
            onChange={setBroker}
            options={brokers.map(option)}
            placeholder={t("noBrokers")}
          />
        </Field>
      </div>
      {fromAccount &&
      brokerAccount &&
      fromAccount.entityId !== brokerAccount.entityId ? (
        <Callout tone="warning">
          {t("crossEntity", {
            from: names.entity.get(fromAccount.entityId) ?? "",
            to: names.entity.get(brokerAccount.entityId) ?? "",
          })}
        </Callout>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field
          label={
            crossCurrency
              ? t("amountIn", { currency: fromAccount!.currency })
              : t("amount")
          }
        >
          <TextInput
            value={amount}
            onChange={setAmount}
            mono
            inputMode="decimal"
            autoFocus
            placeholder={fmt.number(0, 2)}
          />
        </Field>
        {crossCurrency ? (
          <Field
            label={t("toAmount", { currency: brokerAccount!.currency })}
            hint={t("toAmountHint")}
          >
            <TextInput
              value={toAmount}
              onChange={setToAmount}
              mono
              inputMode="decimal"
            />
          </Field>
        ) : null}
        <Field label={t("date")}>
          <TextInput type="date" value={date} onChange={setDate} />
        </Field>
      </div>
      <Field label={t("description")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("descriptionPlaceholder")}
        />
      </Field>
      <DialogFooter>
        <Btn ghost onClick={onClose}>
          {tc("cancel")}
        </Btn>
        <Btn primary type="submit" disabled={!valid || save.isPending}>
          {tc("save")}
        </Btn>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Gerar ordens (POST /v2/investments/orders)
// ---------------------------------------------------------------------------

export function OrdersDialog({
  orders,
  skipped,
  onClose,
}: {
  orders: OrderDraft[];
  skipped: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={640}>
      <OrdersForm orders={orders} skipped={skipped} onClose={onClose} />
    </Dialog>
  );
}

function OrdersForm({
  orders,
  skipped,
  onClose,
}: {
  orders: OrderDraft[];
  skipped: number;
  onClose: () => void;
}) {
  const t = useTranslations("invest.orders");
  const top = useTranslations("invest.op");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const me = useSession().data;
  const names = useNames();
  const fx = useFxRates();
  const accounts = useAccounts().data ?? [];
  const sources = accountsOf(accounts, ["checking", "cash"]);
  const [sourceChoice, setSource] = useState("");
  const source =
    sourceChoice ||
    sources.find((a) => a.isDefault && a.entityId === me?.personalEntityId)
      ?.id ||
    "cash";
  const [date, setDate] = useState(() =>
    todayIn(me?.timezone ?? "America/Sao_Paulo"),
  );
  const total = orders.reduce(
    (s, o) => s + o.amount * fx.rateFor(o.currency),
    0,
  );
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () =>
      apiPost<{ batchId: string }>(
        "/api/v2/investments/orders",
        ordersPayload(orders, date, source === "cash" ? null : source),
      ),
    undo: t("done", { count: orders.length }),
    onSuccess: onClose,
  });
  const submit = () => {
    if (orders.length && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={t("desc")} />
      {orders.length ? (
        <Table
          headers={[
            t("asset"),
            t("broker"),
            t("quantity"),
            t("price"),
            t("amount"),
          ]}
          columnAlign={["left", "left", "right", "right", "right"]}
          rows={orders.map((o) => [
            <span key="a" className="flex min-w-0 items-baseline gap-2">
              <span className={cn(MONO, "font-semibold")}>
                {o.ticker ?? "—"}
              </span>
              <span className="truncate text-fg-3">{o.name}</span>
            </span>,
            o.accountName ?? "—",
            <span key="q" className={MONO}>
              {o.quantity !== null
                ? fmt.number(o.quantity, { min: 0, max: 6 })
                : "—"}
            </span>,
            <span key="p" className={MONO}>
              {o.price !== null ? fmt.money(o.price, o.currency) : "—"}
            </span>,
            <span key="v" className={cn(MONO, "font-semibold")}>
              {fmt.money(o.amount, o.currency)}
            </span>,
          ])}
          footer={[
            t("total"),
            "",
            "",
            "",
            <span key="t" className={MONO}>
              {fmt.money(total, fx.base)}
            </span>,
          ]}
        />
      ) : (
        <Callout tone="neutral">{t("empty")}</Callout>
      )}
      {skipped ? (
        <span className="text-body-sm text-fg-3">
          {t("skipped", { count: skipped })}
        </span>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={top("source")}>
          <Select
            value={source}
            onChange={setSource}
            options={[
              { value: "cash", label: t("sourceCash") },
              ...sources.map((a) => ({
                value: a.id,
                label: top("sourceAccount", {
                  account:
                    `${a.name} ${names.entity.get(a.entityId) ?? ""}`.trim(),
                }),
              })),
            ]}
          />
        </Field>
        <Field label={top("date")}>
          <TextInput type="date" value={date} onChange={setDate} />
        </Field>
      </div>
      <DialogFooter>
        <Btn ghost onClick={onClose}>
          {tc("cancel")}
        </Btn>
        <Btn primary type="submit" disabled={!orders.length || save.isPending}>
          {t("submit", { count: orders.length })}
        </Btn>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// FIRE goal (PUT /v1/fire/goal merges what it is sent)
// ---------------------------------------------------------------------------

export function FireGoalDialog({
  summary,
  onClose,
}: {
  summary: FireSummaryResponse;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={480}>
      <FireGoalForm summary={summary} onClose={onClose} />
    </Dialog>
  );
}

function FireGoalForm({
  summary,
  onClose,
}: {
  summary: FireSummaryResponse;
  onClose: () => void;
}) {
  const t = useTranslations("invest.fireGoal");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const goal = summary.goal;
  const cur = summary.baseCurrency;
  // The monthly contribution is editable only on a single-phase contribution plan; other plans keep their phases.
  const simplePlan =
    !goal ||
    (goal.planningMode === "by_contribution" && goal.phases.length === 1);
  const pctText = (v: number) => fmt.number(v * 100, { min: 0, max: 2 });
  const [income, setIncome] = useState(
    fmt.number(
      goal?.targetMonthlyIncome ??
        Math.round(summary.suggestedDefaults.currentMonthlyExpenses || 10000),
      { min: 0, max: 2 },
    ),
  );
  const [contribution, setContribution] = useState(
    fmt.number(
      goal?.phases[0]?.monthlyContribution ??
        summary.suggestedDefaults.suggestedMonthlyContribution,
      { min: 0, max: 2 },
    ),
  );
  const [ret, setRet] = useState(pctText(goal?.nominalAnnualReturn ?? 0.1));
  const [inflation, setInflation] = useState(
    pctText(goal?.annualInflation ?? 0.045),
  );
  const [swr, setSwr] = useState(pctText(goal?.safeWithdrawalRate ?? 0.035));
  const [monthlyIncome, setMonthlyIncome] = useState(
    goal?.monthlyIncome != null
      ? fmt.number(goal.monthlyIncome, { min: 0, max: 2 })
      : "",
  );
  const [age, setAge] = useState(
    goal?.currentAge ? String(goal.currentAge) : "",
  );
  const fraction = (text: string) => fmt.parseNumber(text) / 100;
  const body = () => {
    const fields: Record<string, unknown> = {
      targetMonthlyIncome: fmt.parseNumber(income),
      nominalAnnualReturn: fraction(ret),
      annualInflation: fraction(inflation),
      safeWithdrawalRate: fraction(swr),
      monthlyIncome: monthlyIncome.trim()
        ? fmt.parseNumber(monthlyIncome)
        : null,
      currentAge: age.trim() ? Number(age) : null,
    };
    if (!goal) {
      return {
        ...fields,
        planningMode: "by_contribution",
        phaseProfile: "constant",
        currency: cur,
        phases: [
          {
            fromMonth: 0,
            toMonth: null,
            monthlyContribution: fmt.parseNumber(contribution),
          },
        ],
      };
    }
    if (simplePlan)
      return {
        ...fields,
        phases: [
          {
            ...goal.phases[0],
            fromMonth: 0,
            toMonth: null,
            monthlyContribution: fmt.parseNumber(contribution),
          },
        ],
      };
    return fields;
  };
  const valid =
    fmt.parseNumber(income) > 0 &&
    fraction(swr) > 0 &&
    fraction(swr) <= 1 &&
    Number.isFinite(fraction(ret)) &&
    Number.isFinite(fraction(inflation)) &&
    (!simplePlan || fmt.parseNumber(contribution) >= 0);
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () => apiPut("/api/v1/fire/goal", body()),
    undo: t("saved"),
    onSuccess: onClose,
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} desc={t("desc")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("income")}>
          <TextInput
            value={income}
            onChange={setIncome}
            mono
            inputMode="decimal"
            autoFocus
          />
        </Field>
        <Field
          label={t("contribution")}
          hint={
            simplePlan
              ? t("contributionHint", {
                  amount: fmt.money0(
                    summary.suggestedDefaults.suggestedMonthlyContribution,
                    cur,
                  ),
                })
              : t("contributionPhased")
          }
        >
          <TextInput
            value={contribution}
            onChange={setContribution}
            mono
            inputMode="decimal"
            disabled={!simplePlan}
          />
        </Field>
        <Field label={t("ret")}>
          <TextInput value={ret} onChange={setRet} mono inputMode="decimal" />
        </Field>
        <Field label={t("inflation")}>
          <TextInput
            value={inflation}
            onChange={setInflation}
            mono
            inputMode="decimal"
          />
        </Field>
        <Field label={t("swr")} hint={t("swrHint")}>
          <TextInput value={swr} onChange={setSwr} mono inputMode="decimal" />
        </Field>
        <Field label={t("monthlyIncome")} hint={t("monthlyIncomeHint")}>
          <TextInput
            value={monthlyIncome}
            onChange={setMonthlyIncome}
            mono
            inputMode="decimal"
          />
        </Field>
        <Field label={t("age")}>
          <TextInput value={age} onChange={setAge} mono inputMode="numeric" />
        </Field>
      </div>
      <DialogFooter>
        <Btn ghost onClick={onClose}>
          {tc("cancel")}
        </Btn>
        <Btn primary type="submit" disabled={!valid || save.isPending}>
          {t("save")}
        </Btn>
      </DialogFooter>
    </form>
  );
}
