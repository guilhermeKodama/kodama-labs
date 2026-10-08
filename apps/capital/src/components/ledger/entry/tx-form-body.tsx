"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CategorySuggestion } from "@capital/server/modules/ledger/services/rules";
import { Badge, Callout, Check, Field, Select, TextInput } from "@/components/cap";
import { AccountCombobox, CategoryCombobox, EntitySelect } from "@/components/pickers";
import type { AccountRecord } from "@/lib/api/catalog";
import { entityLabel } from "@/lib/pickers/options";
import { useFmt } from "@/lib/format/provider";
import {
  baseRate,
  buyHolding,
  detectDirection,
  formCurrency,
  effectiveCrossRate,
  investSides,
  investedIn,
  rateDeviates,
  isBroker,
  isCashAccount,
  isCashOrCard,
  mainAccount,
  typedAmount,
  typedRate,
  type EntryFormState,
  type FormContext,
  type FormField,
  type FormKind,
} from "@/lib/ledger/entry-form";
import { cn } from "@/lib/utils";
import { useDatedFxRate } from "@/lib/ledger/use-dated-rate";
import { DateInput } from "./date-input";
import { KindSegmented } from "./kind-segmented";
import { RateInput } from "./rate-input";

export interface TxFormBodyProps {
  form: EntryFormState;
  up: (patch: Partial<EntryFormState>) => void;
  ctx: FormContext;
  /** Account records (balances, limits) for the aporte hints. */
  accounts: readonly AccountRecord[];
  mode: "create" | "edit";
  /** Kinds the segmented control cannot switch to (an existing transfer stays one). */
  lockedKinds?: readonly FormKind[];
  /** The field the last save attempt rejected. */
  invalid: FormField | null;
  suggestion: CategorySuggestion | null;
  /** A category the quick add named that does not exist yet ("#pets"): created on save. */
  newCategoryName?: string | null;
  onDescriptionBlur?: () => void;
  /** The quick-add box (create only), above the kind. */
  quickAdd?: ReactNode;
  /** Receipt dropzone, last. */
  dropzone: ReactNode;
}

const KINDS: FormKind[] = ["expense", "income", "transfer", "invest"];

/**
 * The transaction form shared by "Nova transação" and "Editar transação"
 * (mockup TxFormBody 4740-4966): kind, the transfer's endpoints and
 * detected type, the aporte block, amount / currency / exchange or date,
 * description, entity / account / category with the suggestion, the
 * recurring and installment options and the receipt dropzone.
 */
export function TxFormBody({ form, up, ctx, accounts, mode, lockedKinds = [], invalid, suggestion, newCategoryName, onDescriptionBlur, quickAdd, dropzone }: TxFormBodyProps) {
  const t = useTranslations("entry.form");
  const fmt = useFmt();
  const isTransfer = form.kind === "transfer";
  const isInvest = form.kind === "invest";
  const editing = mode === "edit";
  const entities = ctx.entities;
  const entityName = (id: string) => {
    const entity = entities.find((candidate) => candidate.id === id);
    return entity ? entityLabel({ kind: entity.kind, name: entity.name ?? "" }) : "";
  };
  const currency = formCurrency(form, ctx);
  const amount = typedAmount(form, ctx);
  const foreign = currency !== ctx.baseCurrency;
  const rate = typedRate(form.rate, baseRate(currency, ctx), ctx);
  const currencies = [...new Set([ctx.baseCurrency, ...Object.keys(ctx.rates), currency])];
  const live = (account: { id: string; archivedAt?: string | null }, keep: string) => !account.archivedAt || account.id === keep;

  const endpointOptions = (keep: string) =>
    ctx.accounts
      .filter((account) => isCashOrCard(account) && live(account, keep))
      .map((account) => ({ value: account.id, label: t("endpoint", { entity: entityName(account.entityId), account: account.name }) }));

  const transfer = isTransfer ? (
    <div className="grid grid-cols-[1fr_24px_1fr] items-end gap-2">
      <Field label={t("from")}>
        <Select value={form.fromAccountId} onChange={(fromAccountId) => up({ fromAccountId, currency: "", rate: "" })} options={endpointOptions(form.fromAccountId)} invalid={invalid === "from"} />
      </Field>
      <span className="pb-1.5 text-center text-fg-3">→</span>
      <Field label={t("to")}>
        <Select value={form.toAccountId} onChange={(toAccountId) => up({ toAccountId })} options={endpointOptions(form.toAccountId)} invalid={invalid === "to"} />
      </Field>
      <div className="col-span-full flex items-center gap-2 text-body-sm">
        <span className="text-fg-3">{t("transferType")}</span>
        <Badge>
          {t(`direction.${form.reimbursement ? "reimbursement" : detectDirection(ctx.accounts.find((a) => a.id === form.fromAccountId), ctx.accounts.find((a) => a.id === form.toAccountId), entities)}`)}
        </Badge>
        <span className="text-fg-4">{t("detected")}</span>
        <span className="flex-1" />
        <Check checked={form.reimbursement} onChange={(reimbursement) => up({ reimbursement })} label={t("reimbursement")} />
      </div>
    </div>
  ) : null;

  const amountRow = !isInvest ? (
    <div className="grid grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)] items-end gap-2.5">
      <Field label={t("amount")}>
        <TextInput value={form.amount} onChange={(value) => up({ amount: value })} placeholder="0,00" mono className="text-amount" invalid={invalid === "amount"} />
      </Field>
      <Field label={t("currency")}>
        <Select
          value={currency}
          onChange={(code) => up({ currency: code, rate: "" })}
          options={currencies.map((code) => ({ value: code, label: code }))}
          disabled={editing && isTransfer}
        />
      </Field>
      {foreign ? (
        <Field label={t("rate")} hint={Number.isFinite(amount) && Number.isFinite(rate) ? t("rateHint", { value: fmt.money(amount * rate, ctx.baseCurrency) }) : undefined}>
          <RateInput
            value={form.rate}
            onChange={(value) => up({ rate: value })}
            defaultText={fmt.number(baseRate(currency, ctx), { min: 2, max: 4 })}
            mono
            invalid={invalid === "rate"}
            disabled={editing && isTransfer}
          />
        </Field>
      ) : (
        <Field label={t("date")}>
          <DateInput value={form.date} onChange={(date) => up({ date })} today={ctx.today} invalid={invalid === "date"} />
        </Field>
      )}
      {isTransfer && foreign ? (
        // A transfer has no category row for the date to move to.
        <Field label={t("date")} className="col-start-3">
          <DateInput value={form.date} onChange={(date) => up({ date })} today={ctx.today} invalid={invalid === "date"} />
        </Field>
      ) : null}
    </div>
  ) : null;

  const description = (
    <Field label={isInvest ? t("descriptionOptional") : t("description")}>
      <TextInput
        value={form.description}
        onChange={(value) => up({ description: value })}
        onBlur={onDescriptionBlur}
        placeholder={isInvest ? t("investPlaceholder") : t("descriptionPlaceholder")}
        invalid={invalid === "description"}
      />
    </Field>
  );

  const categoryType = form.kind === "income" ? "income" : "expense";
  const simple =
    !isTransfer && !isInvest ? (
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("entity")}>
          <EntitySelect
            value={form.entityId}
            onChange={(entityId) => {
              const main = mainAccount(ctx.accounts, entityId);
              up({ entityId, accountId: main?.id ?? "", currency: "", rate: "" });
            }}
            className="w-full"
          />
        </Field>
        <Field label={t("account")} hint={t("accountHint")}>
          <AccountCombobox
            value={form.accountId || null}
            onChange={(accountId) => {
              const account = ctx.accounts.find((candidate) => candidate.id === accountId);
              up({ accountId, entityId: account?.entityId ?? form.entityId, currency: "", rate: "" });
            }}
            entityId={form.entityId || null}
            types={["checking", "credit_card", "cash"]}
            allowCreate
            invalid={invalid === "account"}
            className="w-full"
          />
        </Field>
        <Field
          label={t("category")}
          span={foreign ? 1 : 2}
          hint={
            suggestion && !form.categoryId && suggestion.category ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t("suggested")} <span className="font-medium text-fg-1">{suggestion.category.name}</span> ·{" "}
                {suggestion.source === "rule" && suggestion.rule
                  ? t("suggestRule", { pattern: suggestion.rule.pattern, category: suggestion.category.name, count: suggestion.rule.hitCount })
                  : suggestion.source === "history"
                    ? t("suggestHistory", { count: suggestion.count })
                    : t("suggestAi")}
                <button type="button" className="cursor-pointer underline" onClick={() => up({ categoryId: suggestion.category!.id })}>
                  {t("use")}
                </button>
              </span>
            ) : undefined
          }
        >
          <CategoryCombobox
            value={form.categoryId || null}
            onChange={(categoryId) => up({ categoryId })}
            type={categoryType}
            placeholder={newCategoryName && !form.categoryId ? t("chipNewCategory", { name: newCategoryName }) : t("categoryPlaceholder")}
            className="w-full"
          />
        </Field>
        {foreign ? (
          <Field label={t("date")}>
            <DateInput value={form.date} onChange={(date) => up({ date })} today={ctx.today} invalid={invalid === "date"} />
          </Field>
        ) : null}
      </div>
    ) : null;

  const flags = !isTransfer ? (
    <div className="flex flex-col gap-2 border-t border-stroke-3 pt-2.5">
      <div className="flex flex-wrap gap-[18px]">
        <Check
          checked={form.recurring}
          onChange={(recurring) => up({ recurring, installments: recurring ? false : form.installments })}
          label={isInvest ? t("recurringInvest") : t("recurring")}
          disabled={editing}
        />
        {!isInvest ? (
          <Check
            checked={form.installments}
            onChange={(installments) => up({ installments, recurring: installments ? false : form.recurring })}
            label={t("installments")}
            disabled={editing}
          />
        ) : null}
        {!isInvest ? <Check checked={form.deductible} onChange={(deductible) => up({ deductible })} label={t("deductible")} /> : null}
      </div>
      {form.recurring && !editing ? (
        <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
          <Field label={t("frequency")}>
            <Select
              value={form.frequency}
              onChange={(frequency) => up({ frequency: frequency as EntryFormState["frequency"] })}
              options={(["weekly", "monthly", "yearly"] as const).map((value) => ({ value, label: t(`freq.${value}`) }))}
            />
          </Field>
          <Field label={t("mode")}>
            <Select
              value={form.autoGenerate ? "auto" : "remind"}
              onChange={(mode) => up({ autoGenerate: mode === "auto" })}
              options={[
                { value: "auto", label: t("modeAuto") },
                { value: "remind", label: t("modeRemind") },
              ]}
            />
          </Field>
        </div>
      ) : null}
      {form.installments && !editing ? (
        <div className="flex items-end gap-2.5">
          <Field label={t("nInstallments")}>
            <TextInput value={form.nInstallments} onChange={(nInstallments) => up({ nInstallments })} mono className="w-[70px]" invalid={invalid === "installments"} />
          </Field>
          <span className="pb-1.5 text-body-sm text-fg-3">
            {t("installmentsHint", {
              n: form.nInstallments,
              value: fmt.money((Number.isFinite(amount) ? amount : 0) / Math.max(1, Number(form.nInstallments) || 1), currency),
            })}
          </span>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-3.5">
      {quickAdd}
      <KindSegmented
        value={form.kind}
        options={KINDS.map((kind) => ({ v: kind, l: t(`kind.${kind}`), disabled: lockedKinds.includes(kind) }))}
        onChange={(kind) => up({ kind, categoryId: kind === form.kind ? form.categoryId : "", rate: "" })}
      />
      {transfer}
      {isInvest ? <InvestBlock form={form} up={up} ctx={ctx} accounts={accounts} mode={mode} invalid={invalid} entityName={entityName} /> : null}
      {amountRow}
      {description}
      {simple}
      {flags}
      {dropzone}
    </div>
  );
}

function InvestBlock({
  form,
  up,
  ctx,
  accounts,
  mode,
  invalid,
  entityName,
}: {
  form: EntryFormState;
  up: (patch: Partial<EntryFormState>) => void;
  ctx: FormContext;
  accounts: readonly AccountRecord[];
  mode: "create" | "edit";
  invalid: FormField | null;
  entityName: (id: string) => string;
}) {
  const t = useTranslations("entry.form.invest");
  const tForm = useTranslations("entry.form");
  const fmt = useFmt();
  const { cash, broker, deposit, fx, crossEntity, entityFlow, from, to } =
    investSides(form, ctx);
  const foreign = fx.differs
    ? from?.currency === ctx.baseCurrency
      ? to?.currency
      : from?.currency
    : null;
  const dated = useDatedFxRate(foreign, form.date, ctx.baseCurrency);
  const amount = typedAmount(form, ctx);
  const rate = typedRate(form.rate, fx.defaultRate, ctx);
  const arrives = Number.isFinite(amount) && Number.isFinite(rate) ? fx.arrives(amount, rate) : Number.NaN;
  const record = (id: string | undefined) => accounts.find((account) => account.id === id);
  const live = (account: { id: string; archivedAt?: string | null }, keep: string) => !account.archivedAt || account.id === keep;
  const label = (account: { name: string; entityId: string; currency: string }) => `${account.name} · ${entityName(account.entityId)} · ${account.currency}`;
  const cashOptions = ctx.accounts.filter((a) => isCashAccount(a) && live(a, form.cashAccountId)).map((a) => ({ value: a.id, label: label(a) }));
  const brokerOptions = ctx.accounts.filter((a) => isBroker(a) && live(a, form.brokerAccountId)).map((a) => ({ value: a.id, label: label(a) }));
  const cashHint = (() => {
    const balance = record(cash?.id)?.balance;
    return cash && balance != null ? t("balance", { value: fmt.money0(balance, cash.currency) }) : undefined;
  })();
  const brokerHint = (() => {
    if (!broker) return undefined;
    const balance = record(broker.id)?.balance;
    const invested = investedIn(ctx, broker);
    const parts = [
      balance ? t("brokerCash", { value: fmt.money0(balance, broker.currency) }) : null,
      invested ? t("invested", { value: fmt.money0(invested, broker.currency) }) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : balance != null ? t("brokerCash", { value: fmt.money0(balance, broker.currency) }) : undefined;
  })();
  const cashSelect = <Select value={form.cashAccountId} onChange={(cashAccountId) => up({ cashAccountId, rate: "", received: "" })} options={cashOptions} invalid={invalid === "cash"} />;
  const brokerSelect = (
    <Select value={form.brokerAccountId} onChange={(brokerAccountId) => up({ brokerAccountId, rate: "", received: "", buyHoldingId: "" })} options={brokerOptions} invalid={invalid === "broker"} />
  );
  const holdings = (ctx.holdings ?? []).filter((holding) => holding.accountId === form.brokerAccountId && holding.isActive !== false);
  const buy = buyHolding(form, ctx);
  const buyQty = ctx.parseNumber(form.buyQty);
  const buyTotal = buy && Number.isFinite(buyQty) ? buyQty * buy.price : 0;
  const brokerCurrency = broker?.currency ?? ctx.baseCurrency;

  return (
    <div className="flex flex-col gap-3">
      <KindSegmented
        value={form.investDir}
        options={[
          { v: "deposit", l: t("deposit") },
          { v: "withdraw", l: t("withdraw") },
        ]}
        onChange={(investDir) =>
          up({ investDir, rate: "", received: "", buyAlso: false })
        }
      />
      <div className="grid grid-cols-[1fr_24px_1fr] items-start gap-2">
        <Field label={deposit ? t("fromCash") : t("fromBroker")} hint={deposit ? cashHint : brokerHint}>
          {deposit ? cashSelect : brokerSelect}
        </Field>
        <span className="pt-7 text-center text-fg-3">→</span>
        <Field label={deposit ? t("toBroker") : t("toCash")} hint={deposit ? brokerHint : cashHint}>
          {deposit ? brokerSelect : cashSelect}
        </Field>
      </div>
      <div
        className={cn(
          "grid items-start gap-2.5",
          fx.differs ? "grid-cols-2" : "grid-cols-[minmax(0,1.4fr)_1fr]",
        )}
      >
        <Field
          label={t("amount", { currency: from?.currency ?? ctx.baseCurrency })}
        >
          <TextInput
            value={form.amount}
            onChange={(value) => up({ amount: value })}
            placeholder="0,00"
            mono
            className="text-amount"
            invalid={invalid === "amount"}
          />
        </Field>
        {fx.differs ? (
          <Field
            label={t("received", {
              currency: to?.currency ?? ctx.baseCurrency,
            })}
            hint={t("receivedHint")}
          >
            <TextInput
              value={form.received}
              onChange={(received) => up({ received })}
              placeholder={fmt.number(0, 2)}
              mono
              inputMode="decimal"
            />
          </Field>
        ) : null}
        {fx.differs ? (
          <Field
            label={tForm("rate")}
            hint={
              !form.received.trim() && Number.isFinite(arrives)
                ? t("arrives", { value: fmt.money(arrives, to?.currency) })
                : undefined
            }
          >
            <RateInput
              value={form.rate}
              onChange={(value) => up({ rate: value })}
              defaultText={fmt.number(fx.defaultRate, { min: 2, max: 4 })}
              mono
              invalid={invalid === "rate"}
            />
          </Field>
        ) : null}
        <Field label={tForm("date")}>
          <DateInput value={form.date} onChange={(date) => up({ date })} today={ctx.today} invalid={invalid === "date"} />
        </Field>
      </div>
      {fx.differs && form.received.trim() && dated.data && from && to
        ? (() => {
            const receivedValue = ctx.parseNumber(form.received);
            const effective = effectiveCrossRate(
              from.currency,
              to.currency,
              amount,
              receivedValue,
              ctx.baseCurrency,
            );
            if (effective == null || !rateDeviates(effective, dated.data.rate))
              return null;
            return (
              <Callout tone="warning">
                {t("rateWarning", {
                  effective: fmt.number(effective, { min: 2, max: 4 }),
                  ptax: fmt.number(dated.data.rate, { min: 2, max: 4 }),
                })}
              </Callout>
            );
          })()
        : null}
      {/* A recurring aporte books one investment transfer per occurrence (POST /v2/recurring), not the two legs or the buy. */}
      {crossEntity && deposit && mode === "create" && !form.recurring && cash && broker ? (
        <Callout tone="warning" title={t("crossTitle")}>
          {t("crossBody", { cash: entityName(cash.entityId), broker: entityName(broker.entityId), flow: entityFlow ?? "profit_distribution" })}
        </Callout>
      ) : null}
      {deposit && mode === "create" && !form.recurring && holdings.length > 0 && broker ? (
        <div className="flex flex-col gap-2.5 rounded-[8px] border border-stroke-3 p-2.5">
          <Check checked={form.buyAlso} onChange={(buyAlso) => up({ buyAlso })} label={t("buyAlso", { broker: broker.name })} />
          {form.buyAlso && buy ? (
            <div className="grid grid-cols-[minmax(0,1.6fr)_90px_minmax(0,1fr)] items-start gap-2.5">
              <Field label={t("asset")}>
                <Select
                  value={buy.holding.id}
                  onChange={(buyHoldingId) => up({ buyHoldingId })}
                  options={holdings.map((holding) => ({ value: holding.id, label: holding.ticker ? t("assetOption", { ticker: holding.ticker, name: holding.name }) : holding.name }))}
                />
              </Field>
              <Field label={t("qty")}>
                <TextInput value={form.buyQty} onChange={(buyQty) => up({ buyQty })} mono invalid={invalid === "buyQty"} />
              </Field>
              <Field
                label={t("total")}
                hint={
                  Number.isFinite(arrives) && arrives > 0
                    ? t("leftover", { value: fmt.money(arrives - buyTotal, brokerCurrency) })
                    : t("perUnit", { value: fmt.money(buy.price, brokerCurrency) })
                }
              >
                <span className="pt-1.5 font-mono text-body-lg tabular-nums">{fmt.money(buyTotal, brokerCurrency)}</span>
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
