"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Choice, Dialog, DialogFooter, DialogHead, Field, Kbd, Segmented, Select, TextInput } from "@/components/cap";
import { CategoryCombobox } from "@/components/pickers";
import { apiDelete, apiPatch, apiPost, withQuery } from "@/lib/api/client";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { compareMonths, monthKey, monthOfDate, monthOptions, type YearMonth } from "@/lib/budgets/period";
import type { BudgetsScope } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import { entityOptions } from "@/lib/pickers/options";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";

export type BudgetPeriod = "monthly" | "yearly";

/** A budget version as the dialogs edit it (a row of the Mensal table or of Orçamentos anuais). */
export interface EditableBudget {
  id: string;
  category: string;
  entityId: string | null;
  amount: number;
  notes: string | null;
  /** YYYY-MM-DD: the month this version starts (January for yearly budgets). */
  effectiveFrom: string;
  period: BudgetPeriod;
}

export type BudgetDialogState =
  | { kind: "create"; month: YearMonth; scope: BudgetsScope }
  | { kind: "edit"; budget: EditableBudget; month: YearMonth }
  | { kind: "delete"; budget: EditableBudget; month: YearMonth };

interface BatchResult {
  batchId: string | null;
  category: string;
}

/** "+ Orçamento", "Editar orçamento…" and "Excluir…": one dialog, mounted while open. */
export function BudgetDialogs({ state, onChange }: { state: BudgetDialogState | null; onChange: (state: BudgetDialogState | null) => void }) {
  const close = () => onChange(null);
  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : close())} width={480}>
      {state?.kind === "create" ? <CreateForm key="create" month={state.month} scope={state.scope} onDone={close} /> : null}
      {state?.kind === "edit" ? (
        <EditForm key={`edit:${state.budget.id}`} budget={state.budget} month={state.month} onDone={close} onDelete={() => onChange({ ...state, kind: "delete" })} />
      ) : null}
      {state?.kind === "delete" ? <DeleteForm key={`delete:${state.budget.id}`} budget={state.budget} month={state.month} onDone={close} /> : null}
    </Dialog>
  );
}

/** The month a change starts from: the month on screen, never before the version starts (yearly: January of a year). */
function startMonth(period: BudgetPeriod, month: YearMonth): YearMonth {
  return period === "yearly" ? { year: month.year, month: 1 } : month;
}

function useFromOptions(period: BudgetPeriod, center: YearMonth, min: YearMonth | null) {
  const fmt = useFmt();
  return useMemo(() => {
    if (period === "yearly") {
      const first = Math.max(center.year - 1, min?.year ?? center.year - 1);
      return Array.from({ length: center.year + 2 - first + 1 }, (_, i) => first + i).map((year) => ({ value: `${year}-01`, label: String(year) }));
    }
    return monthOptions(center, 12, 12, min).map((m) => ({ value: monthKey(m), label: fmt.monthLabel(m) }));
  }, [period, center, min, fmt]);
}

function useEntityChoices() {
  const t = useTranslations("budgets");
  const me = useSession().data;
  return useMemo(
    () => [{ value: "", label: t("dialog.allEntities") }, ...entityOptions(me?.entities ?? [], { kinds: null, baseCurrency: me?.baseCurrency })],
    [me, t],
  );
}

/** Default entity of a new budget: the scope's entity (PF, the only company, an entity link), else PF. */
function defaultEntity(scope: BudgetsScope, entities: readonly { id: string; kind: string }[]): string {
  const personal = entities.find((e) => e.kind === "personal")?.id ?? "";
  const businesses = entities.filter((e) => e.kind === "business");
  if (scope === "pj") return businesses.length === 1 ? businesses[0].id : "";
  if (scope !== "all" && scope !== "pf" && entities.some((e) => e.id === scope)) return scope;
  return personal;
}

function CreateForm({ month, scope, onDone }: { month: YearMonth; scope: BudgetsScope; onDone: () => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const ids = useId();
  const me = useSession().data;
  const entityChoices = useEntityChoices();
  const submitHint = useShortcutLabel("mod+enter");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [entityId, setEntityId] = useState(() => defaultEntity(scope, me?.entities ?? []));
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [from, setFrom] = useState(monthKey(month));
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const fromOptions = useFromOptions(period, month, null);
  const value = fmt.parseNumber(amount);
  const invalidAmount = !(value > 0);

  const create = useAppMutation({
    event: "budgets.write",
    mutationFn: (body: object) => apiPost<BatchResult>("/api/v2/budgets", body),
    undo: (result) => t("dialog.created", { category: result.category }),
    onSuccess: onDone,
  });

  const submit = () => {
    if (!categoryId || invalidAmount) {
      setShowErrors(true);
      return;
    }
    if (create.isPending) return;
    create.mutate({
      categoryId,
      entityId: entityId || null,
      amount: value,
      period,
      effectiveFrom: period === "yearly" ? `${from.slice(0, 4)}-01` : from,
      notes: notes.trim() || null,
    });
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
      <DialogHead title={t("dialog.createTitle")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("dialog.category")} htmlFor={`${ids}-category`} span={2}>
          <CategoryCombobox id={`${ids}-category`} value={categoryId} onChange={setCategoryId} type="expense" invalid={showErrors && !categoryId} />
        </Field>
        <Field label={t("dialog.entity")} htmlFor={`${ids}-entity`} hint={entityId ? undefined : t("dialog.allEntitiesHint")} span={2}>
          <Select id={`${ids}-entity`} value={entityId} onChange={setEntityId} options={entityChoices} />
        </Field>
        <Field label={t("dialog.amount")} htmlFor={`${ids}-amount`}>
          <TextInput id={`${ids}-amount`} value={amount} onChange={setAmount} mono inputMode="decimal" placeholder="0" invalid={showErrors && invalidAmount} />
        </Field>
        <Field label={t("dialog.period")}>
          <Segmented
            aria-label={t("dialog.period")}
            value={period}
            options={[
              { v: "monthly", l: t("dialog.monthly") },
              { v: "yearly", l: t("dialog.yearly") },
            ]}
            onChange={(next) => {
              setPeriod(next);
              setFrom(next === "yearly" ? `${from.slice(0, 4)}-01` : monthKey(month));
            }}
            className="self-start"
          />
        </Field>
        <Field label={t("dialog.from")} htmlFor={`${ids}-from`}>
          <Select id={`${ids}-from`} value={period === "yearly" ? `${from.slice(0, 4)}-01` : from} onChange={setFrom} options={fromOptions} />
        </Field>
        <Field label={t("dialog.note")} htmlFor={`${ids}-note`}>
          <TextInput id={`${ids}-note`} value={notes} onChange={setNotes} placeholder={t("dialog.notePlaceholder")} maxLength={200} />
        </Field>
      </div>
      <DialogFooter>
        <Btn ghost onClick={onDone}>
          {tc("cancel")}
        </Btn>
        <Kbd>{submitHint}</Kbd>
        <Btn primary type="submit" disabled={create.isPending}>
          {t("dialog.submitCreate")}
        </Btn>
      </DialogFooter>
    </form>
  );
}

function EditForm({ budget, month, onDone, onDelete }: { budget: EditableBudget; month: YearMonth; onDone: () => void; onDelete: () => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const ids = useId();
  const submitHint = useShortcutLabel("mod+enter");
  const names = useEntityChoices();
  const versionStart = monthOfDate(budget.effectiveFrom) ?? month;
  const center = startMonth(budget.period, compareMonths(month, versionStart) < 0 ? versionStart : month);
  const fromOptions = useFromOptions(budget.period, center, versionStart);
  const [amount, setAmount] = useState(() => fmt.number(budget.amount, { min: 0, max: 2 }));
  const [from, setFrom] = useState(monthKey(center));
  const [notes, setNotes] = useState(budget.notes ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const value = fmt.parseNumber(amount);
  const invalidAmount = !(value > 0);
  const fromLabel = fromOptions.find((option) => option.value === from)?.label ?? from;

  const update = useAppMutation({
    event: "budgets.write",
    mutationFn: (body: object) => apiPatch<BatchResult>(`/api/v2/budgets/${budget.id}`, body),
    undo: (result) => t("dialog.updated", { category: result.category, month: fromLabel }),
    onSuccess: onDone,
  });

  const submit = () => {
    if (invalidAmount) {
      setShowErrors(true);
      return;
    }
    // The amount shown and typed is in the base currency (the overview converts a budget in another currency), so it is saved in base.
    if (!update.isPending) update.mutate({ amount: value, currency: fmt.prefs.baseCurrency, notes: notes.trim() || null, applyFrom: from });
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  const entity = budget.entityId ? (names.find((option) => option.value === budget.entityId)?.label ?? "—") : t("dialog.allEntities");
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead
        title={t("dialog.editTitle")}
        desc={t("dialog.editDesc", { category: budget.category, entity, period: t(budget.period === "yearly" ? "dialog.yearly" : "dialog.monthly") })}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("dialog.amount")} htmlFor={`${ids}-amount`}>
          <TextInput id={`${ids}-amount`} value={amount} onChange={setAmount} mono inputMode="decimal" autoFocus invalid={showErrors && invalidAmount} />
        </Field>
        <Field label={t("dialog.from")} htmlFor={`${ids}-from`} hint={t("dialog.fromHint")}>
          <Select id={`${ids}-from`} value={from} onChange={setFrom} options={fromOptions} />
        </Field>
        <Field label={t("dialog.note")} htmlFor={`${ids}-note`} span={2}>
          <TextInput id={`${ids}-note`} value={notes} onChange={setNotes} placeholder={t("dialog.notePlaceholder")} maxLength={200} />
        </Field>
      </div>
      <DialogFooter justify="between">
        <Btn ghost danger onClick={onDelete}>
          {t("dialog.delete")}
        </Btn>
        <span className="flex items-center gap-1.5">
          <Btn ghost onClick={onDone}>
            {tc("cancel")}
          </Btn>
          <Kbd>{submitHint}</Kbd>
          <Btn primary type="submit" disabled={update.isPending}>
            {tc("save")}
          </Btn>
        </span>
      </DialogFooter>
    </form>
  );
}

function DeleteForm({ budget, month, onDone }: { budget: EditableBudget; month: YearMonth; onDone: () => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const versionStart = monthOfDate(budget.effectiveFrom) ?? month;
  const from = startMonth(budget.period, compareMonths(month, versionStart) < 0 ? versionStart : month);
  const fromLabel = budget.period === "yearly" ? String(from.year) : fmt.monthLabel(from);
  const [scope, setScope] = useState<"from" | "all">("from");

  const remove = useAppMutation({
    event: "budgets.write",
    mutationFn: (choice: "from" | "all") =>
      apiDelete<BatchResult>(withQuery(`/api/v2/budgets/${budget.id}`, choice === "all" ? { all: true } : { from: monthKey(from) })),
    undo: () => t("delete.done", { category: budget.category }),
    onSuccess: onDone,
  });
  const submit = () => {
    if (!remove.isPending) remove.mutate(scope);
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  return (
    <>
      <DialogHead title={t("delete.title", { category: budget.category })} desc={t("delete.desc", { amount: fmt.money0(budget.amount), period: budget.period })} />
      <Choice
        value={scope}
        onChange={setScope}
        options={[
          { v: "from", l: t("delete.fromLabel", { from: fromLabel }), d: t("delete.fromDesc") },
          { v: "all", l: t("delete.allLabel"), d: t("delete.allDesc") },
        ]}
      />
      <DialogFooter>
        <Btn ghost onClick={onDone}>
          {tc("cancel")}
        </Btn>
        <Btn primary onClick={submit} disabled={remove.isPending}>
          {tc("delete")}
        </Btn>
      </DialogFooter>
    </>
  );
}
