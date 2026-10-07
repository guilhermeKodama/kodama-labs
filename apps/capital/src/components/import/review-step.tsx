"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Combobox, Pill, type ComboboxOption } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { useAccounts, useCategories, useCreateCategory, type CategoryType } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { useFmt } from "@/lib/format/provider";
import { entityLabel } from "@/lib/pickers/options";
import {
  OPTIONAL_STATUSES,
  REVIEW_STATUSES,
  effectiveStatus,
  encodeUse,
  filterRows,
  includedByDefault,
  isCardKind,
  keepsEntry,
  pickUse,
  setIncluded,
  statusCounts,
  type AnalyzedImportRow,
  type Decisions,
  type ImportAnalysis,
  type ReviewFilter,
  type RowDecision,
} from "@/lib/import/review";
import { cn } from "@/lib/utils";
import { NewCategoryDialog } from "./new-category-dialog";

/** Which option list a row's picker shows. */
type Variant = "bankExpense" | "bankIncome" | "cardCharge" | "cardRefund";

const variantOf = (card: boolean, row: AnalyzedImportRow): Variant =>
  card ? (row.type === "income" ? "cardRefund" : "cardCharge") : row.type === "income" ? "bankIncome" : "bankExpense";

/** Category a row creates from "+ Criar “X”": an income category only for bank income. */
const createdType = (variant: Variant): CategoryType => (variant === "bankIncome" ? "income" : "expense");

/** Types "+ Criar categoria…" offers: the ones the row's picker lists (a card refund may go either way). */
const formTypes = (variant: Variant): readonly CategoryType[] =>
  variant === "cardRefund" ? ["expense", "income"] : [createdType(variant)];

/**
 * Revisar (mockup 5715-5753): status pills, then one row per transaction
 * with its checkbox, date, description (and the entry it repeats, what a
 * re-imported bill changed in it, or that it left the bill), what it
 * becomes, the status and the amount. The picker lists the categories of
 * the row's type, and for a bank statement the other entities
 * (transfer), the brokers (aporte/resgate) and the cards (bill payment).
 */
export function ReviewStep({
  analysis,
  decisions,
  filter,
  currency,
  entityId,
  onFilter,
  onDecisions,
}: {
  analysis: ImportAnalysis;
  decisions: Decisions;
  filter: ReviewFilter;
  currency: string;
  /** The imported entity: transfers go to the others. */
  entityId: string | null;
  onFilter: (filter: ReviewFilter) => void;
  onDecisions: (update: (decisions: Decisions) => Decisions) => void;
}) {
  const t = useTranslations("import.review");
  const tCommon = useTranslations("common");
  const me = useSession().data;
  const categories = useCategories(true).data;
  const accounts = useAccounts(true).data;
  const createCategory = useCreateCategory();
  const card = isCardKind(analysis.kind);

  const counts = useMemo(() => statusCounts(analysis.rows, decisions), [analysis.rows, decisions]);
  const shown = useMemo(() => filterRows(analysis.rows, decisions, filter), [analysis.rows, decisions, filter]);

  // Archived categories stay listed only where a row uses one (a rule may still point at it).
  const archivedInUse = useMemo(() => {
    const archived = new Set((categories ?? []).filter((c) => c.isArchived).map((c) => c.id));
    const ids = Object.values(decisions).flatMap((d) => (d.use.as === "category" && d.use.categoryId && archived.has(d.use.categoryId) ? [d.use.categoryId] : []));
    return [...new Set(ids)].sort().join(",");
  }, [categories, decisions]);

  const options = useMemo(() => {
    const used = new Set(archivedInUse.split(","));
    const categoryOptions = (types: CategoryType[]): ComboboxOption[] =>
      (categories ?? [])
        .filter((c) => types.includes(c.type) && (!c.isArchived || used.has(c.id)))
        .map((c) => ({
          value: encodeUse({ as: "category", categoryId: c.id })!,
          label: c.name,
          hint: c.isArchived ? tCommon("pickers.archived") : types.length > 1 ? tCommon(`pickers.categoryType.${c.type}`) : undefined,
        }));
    const live = (accounts ?? []).filter((a) => !a.archivedAt);
    const transfers: ComboboxOption[] = (me?.entities ?? [])
      .filter((e) => e.id !== entityId)
      .map((e) => ({ value: encodeUse({ as: "transfer", entityId: e.id })!, label: t("use.transfer", { name: entityLabel(e) }), hint: t("hints.transfer") }));
    const brokers = (deposit: boolean): ComboboxOption[] =>
      live
        .filter((a) => a.type === "brokerage")
        .map((a) => ({ value: encodeUse({ as: "invest", accountId: a.id })!, label: t(deposit ? "use.deposit" : "use.withdrawal", { name: a.name }), hint: t("hints.invest") }));
    const cards: ComboboxOption[] = live
      .filter((a) => a.type === "credit_card")
      .map((a) => ({ value: encodeUse({ as: "card_payment", cardAccountId: a.id })!, label: t("use.cardPayment", { name: a.name }), hint: t("hints.card") }));
    return {
      bankExpense: [...categoryOptions(["expense"]), ...transfers, ...brokers(true), ...cards],
      bankIncome: [...categoryOptions(["income"]), ...transfers, ...brokers(false)],
      cardCharge: categoryOptions(["expense"]),
      cardRefund: categoryOptions(["expense", "income"]),
    } satisfies Record<Variant, ComboboxOption[]>;
  }, [categories, accounts, me?.entities, entityId, archivedInUse, t, tCommon]);

  const pick = useCallback((row: AnalyzedImportRow, value: string) => onDecisions((current) => pickUse(current, row, value)), [onDecisions]);
  const include = useCallback((row: AnalyzedImportRow, on: boolean) => onDecisions((current) => setIncluded(current, row, on)), [onDecisions]);
  const { mutate: createMutate } = createCategory;
  const create = useCallback(
    (row: AnalyzedImportRow, name: string) =>
      createMutate({ name, type: createdType(variantOf(card, row)) }, { onSuccess: (category) => pick(row, encodeUse({ as: "category", categoryId: category.id })!) }),
    [createMutate, card, pick],
  );
  // "+ Criar categoria…": the row it was opened from and what had been typed in its picker.
  const [creatingFor, setCreatingFor] = useState<{ row: AnalyzedImportRow; name: string } | null>(null);
  const openCreate = useCallback((row: AnalyzedImportRow, name: string) => setCreatingFor({ row, name }), []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={filter === "all"} onClick={() => onFilter("all")}>
          {t("pill", { label: t("all"), count: counts.all })}
        </Pill>
        {REVIEW_STATUSES.filter((status) => counts[status] > 0 || !OPTIONAL_STATUSES.includes(status) || filter === status).map((status) => (
          <Pill key={status} active={filter === status} onClick={() => onFilter(status)}>
            {t("pill", { label: t(`status.${status}`), count: counts[status] })}
          </Pill>
        ))}
      </div>
      <div className="max-h-[330px] overflow-hidden overflow-y-auto rounded-[8px] border border-stroke-3">
        {shown.map((row) => (
          <ReviewRow
            key={row.id}
            row={row}
            decision={decisions[row.id]}
            options={options[variantOf(card, row)]}
            currency={currency}
            creating={createCategory.isPending}
            onPick={pick}
            onInclude={include}
            onCreate={create}
            onCreateForm={openCreate}
          />
        ))}
        {shown.length === 0 ? <div className="px-2.5 py-6 text-center text-[12px] text-fg-3">{t("empty")}</div> : null}
      </div>
      <span className="text-[11.5px] text-fg-3">{t("footer", { shown: shown.length, total: analysis.rows.length })}</span>
      <NewCategoryDialog
        open={creatingFor !== null}
        onOpenChange={(open) => !open && setCreatingFor(null)}
        initialName={creatingFor?.name ?? ""}
        types={creatingFor ? formTypes(variantOf(card, creatingFor.row)) : ["expense"]}
        onCreated={(category) => creatingFor && pick(creatingFor.row, encodeUse({ as: "category", categoryId: category.id })!)}
      />
    </>
  );
}

const ReviewRow = memo(function ReviewRow({
  row,
  decision,
  options,
  currency,
  creating,
  onPick,
  onInclude,
  onCreate,
  onCreateForm,
}: {
  row: AnalyzedImportRow;
  decision: RowDecision | undefined;
  options: ComboboxOption[];
  currency: string;
  creating: boolean;
  onPick: (row: AnalyzedImportRow, value: string) => void;
  onInclude: (row: AnalyzedImportRow, include: boolean) => void;
  onCreate: (row: AnalyzedImportRow, name: string) => void;
  /** Pinned "+ Criar categoria…": opens the form, prefilled with the query. */
  onCreateForm: (row: AnalyzedImportRow, name: string) => void;
}) {
  const t = useTranslations("import.review");
  const fmt = useFmt();
  const included = decision?.include ?? includedByDefault(row);
  const status = effectiveStatus(row, decision);
  const existing = row.duplicateOf;
  // What the second line says: the entry a duplicate repeats, what a changed row changes, or that a row left the bill.
  let note: string | null = null;
  if (row.status === "removed") note = t("removedNote");
  else if (row.status === "changed" && row.diffs?.length) {
    note = t("changedNote", {
      changes: row.diffs
        .map((d) =>
          d.field === "amount"
            ? t("changes.amount", { from: fmt.money(Number(d.existingValue), currency), to: fmt.money(Number(d.ofxValue), currency) })
            : d.field === "date"
              ? t("changes.date", { from: fmt.date(d.existingValue), to: fmt.date(d.ofxValue) })
              : t("changes.description", { from: d.existingValue }),
        )
        .join(" · "),
    });
  } else if (existing) note = t("duplicateOf", { description: existing.description, date: fmt.date(existing.date) });
  return (
    <div
      className={cn(
        "grid min-h-[38px] grid-cols-[24px_44px_minmax(0,1.6fr)_minmax(0,1.3fr)_110px_96px] items-center gap-2 border-t border-stroke-3 px-2.5 text-[12px] first:border-t-0",
        !included && "opacity-45",
      )}
    >
      <Check checked={included} onChange={(on) => onInclude(row, on)} aria-label={t(row.status === "removed" ? "remove" : "include", { description: row.description })} />
      <span className="font-mono text-[11px] text-fg-3">{fmt.date(row.date)}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-[11.5px]" title={row.fullDescription ?? row.description}>
          {row.description}
        </span>
        {note ? (
          <span className="truncate text-[10.5px] text-fg-4" title={note}>
            {note}
          </span>
        ) : null}
      </span>
      <Combobox
        value={decision ? encodeUse(decision.use) : null}
        onChange={(value) => onPick(row, value)}
        options={options}
        placeholder={t("placeholder")}
        searchPlaceholder={t("search")}
        onCreate={(name) => onCreate(row, name)}
        footer={({ query, close }) => (
          <button
            type="button"
            className={cn(MENU_ROW, "text-fg-2")}
            onClick={() => {
              close();
              onCreateForm(row, query);
            }}
          >
            {t("createCategory")}
          </button>
        )}
        disabled={creating || keepsEntry(row)}
        aria-label={t("placeholder")}
        className="w-full"
        contentClassName="min-w-[260px]"
      />
      <span className={cn("text-[11px]", status === "need" ? "text-cat-yellow" : status === "changed" ? "text-cat-blue" : status === "removed" ? "text-neg" : "text-fg-3")}>
        {t(`status.${status}`)}
      </span>
      <span className="text-right font-mono tabular-nums">{fmt.money(row.amount, currency)}</span>
    </div>
  );
});
