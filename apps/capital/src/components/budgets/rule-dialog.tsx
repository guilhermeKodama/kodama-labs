"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Dialog, DialogFooter, DialogHead, EmptyRow, Field, Kbd, Select, Sheet, TextInput, Toggle } from "@/components/cap";
import { apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { ruleEntriesDraft } from "@/lib/budgets/drill";
import { frequencyOptions, groupRules, ruleForm, rulePatch, type RuleField, type RuleFormState, type RuleFrequency, type RulePatch } from "@/lib/budgets/rule-form";
import type { BudgetsScope } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { DrillLink, EntityBadge, useEntityNames } from "./parts";
import { useRecurringRules, type RecurringRule } from "./use-budgets";

interface RuleWrite {
  batchId: string | null;
  booked?: { count: number };
}

/** Editor of one conta fixa (a recurring rule), opened from Contas fixas or "Ver todas". */
export function RuleDialog({ ruleId, scope, onClose }: { ruleId: string | null; scope: BudgetsScope; onClose: () => void }) {
  return (
    <Dialog open={ruleId !== null} onOpenChange={(open) => (open ? undefined : onClose())} width={480}>
      {ruleId ? <RuleLoader key={ruleId} ruleId={ruleId} scope={scope} onDone={onClose} /> : null}
    </Dialog>
  );
}

function RuleLoader({ ruleId, scope, onDone }: { ruleId: string; scope: BudgetsScope; onDone: () => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const rules = useRecurringRules(scope);
  const rule = rules.data?.find((r) => r.id === ruleId);
  if (rule) return <RuleForm rule={rule} onDone={onDone} />;
  return (
    <>
      <DialogHead title={t("rule.fallbackTitle")} />
      <p className="text-[12.5px] text-fg-3">{rules.isPending ? tc("loading") : t("rule.notFound")}</p>
    </>
  );
}

function RuleForm({ rule, onDone }: { rule: RecurringRule; onDone: () => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const ids = useId();
  const submitHint = useShortcutLabel("mod+enter");
  const { names } = useEntityNames();
  const formatAmount = (value: number) => fmt.number(value, { min: 0, max: 2 });
  const [form, setForm] = useState<RuleFormState>(() => ruleForm(rule, formatAmount));
  const [errors, setErrors] = useState<ReadonlySet<RuleField>>(new Set());
  const update = (patch: Partial<RuleFormState>) => setForm((current) => ({ ...current, ...patch }));
  const description = rule.description;
  const dueLabel = fmt.date(rule.nextDueDate);

  const save = useAppMutation({
    event: "recurring.write",
    mutationFn: (patch: RulePatch) => apiPatch<RuleWrite>(`/api/v2/recurring/${rule.id}`, patch),
    undo: (result) => (result.booked?.count ? t("rule.savedBooked", { description, count: result.booked.count }) : t("rule.saved", { description })),
    onSuccess: onDone,
  });
  const pay = useAppMutation({
    event: "recurring.write",
    mutationFn: () => apiPost<RuleWrite>(`/api/v2/recurring/${rule.id}/pay`, {}),
    undo: () => t("rule.paid", { description, date: dueLabel }),
    onSuccess: onDone,
  });
  const skip = useAppMutation({
    event: "recurring.write",
    mutationFn: () => apiPost<RuleWrite>(`/api/v2/recurring/${rule.id}/skip`, {}),
    undo: () => t("rule.skipped", { description, date: dueLabel }),
    onSuccess: onDone,
  });
  const remove = useAppMutation({
    event: "recurring.write",
    mutationFn: () => apiDelete<RuleWrite>(`/api/v2/recurring/${rule.id}`),
    undo: () => t("rule.deleted", { description }),
    onSuccess: onDone,
  });
  const busy = save.isPending || pay.isPending || skip.isPending || remove.isPending;

  const submit = () => {
    const { patch, errors: invalid } = rulePatch(form, rule, fmt.parseNumber);
    setErrors(invalid);
    if (invalid.size || busy) return;
    if (!Object.keys(patch).length) return onDone();
    save.mutate(patch);
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  const account = rule.account?.name ?? "";
  const entity = rule.entityId ? (names.get(rule.entityId) ?? "") : "";
  const kind = t(`rule.kind.${rule.kind === "income" || rule.kind === "transfer" || rule.kind === "investment" ? rule.kind : "expense"}`);
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={description} desc={[kind, account, entity, rule.isActive ? null : t("rule.pausedTag")].filter(Boolean).join(" · ")} />
      {rule.isActive ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-stroke-3 px-2.5 py-2 text-[12.5px]">
          <span className="text-fg-2">{t("rule.next", { date: dueLabel, amount: fmt.money(rule.amount, rule.currency) })}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <Btn ghost disabled={busy} onClick={() => skip.mutate()}>
              {t("rule.skip")}
            </Btn>
            <Btn disabled={busy} onClick={() => pay.mutate()}>
              {t("rule.pay")}
            </Btn>
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("rule.amount")} htmlFor={`${ids}-amount`} hint={rule.currency !== fmt.prefs.baseCurrency ? rule.currency : undefined}>
          <TextInput id={`${ids}-amount`} value={form.amount} onChange={(amount) => update({ amount })} mono inputMode="decimal" invalid={errors.has("amount")} />
        </Field>
        <Field label={t("rule.frequency")} htmlFor={`${ids}-frequency`}>
          <Select
            id={`${ids}-frequency`}
            value={form.frequency}
            onChange={(frequency) => update({ frequency: frequency as RuleFrequency })}
            options={frequencyOptions(rule.frequency).map((f) => ({ value: f, label: t(`rule.freq.${f}`) }))}
          />
        </Field>
        <Field label={t("rule.mode")} htmlFor={`${ids}-mode`} span={2}>
          <Select
            id={`${ids}-mode`}
            value={form.autoGenerate ? "auto" : "remind"}
            onChange={(mode) => update({ autoGenerate: mode === "auto" })}
            options={[
              { value: "auto", label: t("rule.modeAuto") },
              { value: "remind", label: t("rule.modeReminder") },
            ]}
          />
        </Field>
        <Field label={t("rule.nextDue")} htmlFor={`${ids}-next`}>
          <TextInput id={`${ids}-next`} type="date" value={form.nextDueDate} onChange={(nextDueDate) => update({ nextDueDate })} mono invalid={errors.has("nextDueDate")} />
        </Field>
        <Field label={t("rule.endDate")} htmlFor={`${ids}-end`} hint={t("rule.endDateHint")}>
          <TextInput id={`${ids}-end`} type="date" value={form.endDate} onChange={(endDate) => update({ endDate })} mono invalid={errors.has("endDate")} />
        </Field>
        <label htmlFor={`${ids}-active`} className="col-span-2 flex items-center gap-2 text-[12.5px]">
          <Toggle id={`${ids}-active`} checked={form.isActive} onChange={(isActive) => update({ isActive })} />
          <span className="font-medium">{t("rule.active")}</span>
          <span className="text-[11.5px] text-fg-3">{form.isActive ? t("rule.activeHint") : t("rule.pausedHint")}</span>
        </label>
      </div>
      <DialogFooter justify="between">
        <span className="flex items-center gap-3">
          <Btn ghost danger disabled={busy} onClick={() => remove.mutate()}>
            {tc("delete")}
          </Btn>
          <DrillLink draft={ruleEntriesDraft(rule)} className="text-[12px] text-fg-3">
            {t("rule.entries")}
          </DrillLink>
        </span>
        <span className="flex items-center gap-1.5">
          <Btn ghost onClick={onDone}>
            {tc("cancel")}
          </Btn>
          <Kbd>{submitHint}</Kbd>
          <Btn primary type="submit" disabled={busy}>
            {tc("save")}
          </Btn>
        </span>
      </DialogFooter>
    </form>
  );
}

/** "Ver todas": every recurring rule of the scope, paused ones too, beyond the 14 days of Contas fixas. */
export function RulesSheet({ open, onOpenChange, scope, onOpenRule }: { open: boolean; onOpenChange: (open: boolean) => void; scope: BudgetsScope; onOpenRule: (id: string) => void }) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const rules = useRecurringRules(scope, open);
  const grouped = groupRules(rules.data ?? []);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <DialogHead title={t("rules.title")} desc={t("rules.desc")} />
      {rules.data ? (
        <>
          <RuleGroup title={t("rules.active")} rules={grouped.active} onOpenRule={onOpenRule} />
          {grouped.paused.length ? <RuleGroup title={t("rules.paused")} rules={grouped.paused} onOpenRule={onOpenRule} /> : null}
        </>
      ) : (
        <p className="text-[12.5px] text-fg-3">{rules.isError ? t("loadError") : tc("loading")}</p>
      )}
    </Sheet>
  );
}

function RuleGroup({ title, rules, onOpenRule }: { title: string; rules: RecurringRule[]; onOpenRule: (id: string) => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { names } = useEntityNames();
  return (
    <section className="flex flex-col">
      <h3 className="pb-1.5 text-[11.5px] font-medium text-fg-3">{title}</h3>
      <div className="overflow-hidden rounded-[8px] border border-stroke-3">
        {rules.map((rule) => (
          <button
            key={rule.id}
            type="button"
            onClick={() => onOpenRule(rule.id)}
            className="flex h-8 w-full items-center gap-2 border-t border-stroke-3 px-3 text-left text-[12.5px] outline-none first:border-t-0 hover:bg-fill-4 focus-visible:bg-fill-4"
          >
            <span className="w-[38px] shrink-0 font-mono text-[11.5px] text-fg-3">{fmt.date(rule.nextDueDate)}</span>
            <span className="min-w-0 truncate">{rule.description}</span>
            <EntityBadge entityId={rule.entityId} names={names} />
            <span className="ml-auto shrink-0 text-[11px] text-fg-4">{rule.isActive ? t(rule.autoGenerate ? "month.upcoming.mode.auto" : "month.upcoming.mode.reminder") : t("rule.pausedTag")}</span>
            <span className={cn("w-[74px] shrink-0 text-right font-mono tabular-nums", rule.kind === "income" && "text-pos")}>{fmt.money0(rule.amount, rule.currency)}</span>
          </button>
        ))}
        {!rules.length ? <EmptyRow>{t("rules.empty")}</EmptyRow> : null}
      </div>
    </section>
  );
}
