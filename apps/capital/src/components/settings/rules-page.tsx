"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Btn, Dialog, DialogFooter, DialogHead, Field, Segmented, Select, Table, TextInput } from "@/components/cap";
import { CategoryCombobox } from "@/components/pickers";
import { useCategories, useEntities } from "@/lib/api/catalog";
import { apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import { invalidFields } from "@/lib/api/errors";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { useShortcut } from "@/lib/shortcuts/provider";
import { useRules, type RuleRow } from "./rules-data";

type MatchType = RuleRow["matchType"];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Regras de categorização: a live test of a description, the rule table, and a dialog to create or edit one. */
export function RulesPage() {
  const t = useTranslations("settings.rules");
  const fmt = useFmt();
  const rules = useRules();
  const categories = useCategories(true);
  // Loaded before the dialog opens: its Entidade select needs its options when it gets a rule's value.
  useEntities();
  const [test, setTest] = useState(() => t("testSample"));
  const description = useDebounced(test.trim(), 250);
  const result = useQuery({
    queryKey: keys.ruleTest(description),
    enabled: description.length > 0,
    queryFn: () => apiPost<{ rule: { pattern: string } | null; category: { name: string } | null }>("/api/v2/rules/test", { description }),
  });
  const [dialog, setDialog] = useState<{ rule: RuleRow | null; pattern?: string } | null>(null);

  const match = result.data?.rule && result.data.category ? t("match", { category: result.data.category.name, pattern: result.data.rule.pattern }) : null;
  const archived = new Set((categories.data ?? []).filter((c) => c.isArchived).map((c) => c.id));
  const rows = rules.data ?? [];
  const patternText = (rule: RuleRow) => (rule.matchType === "equals" ? `= ${rule.pattern}` : rule.matchType === "regex" ? `/${rule.pattern}/` : rule.pattern);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="rules-test" className="text-body-sm text-fg-3">
          {t("test")}
        </label>
        <TextInput id="rules-test" value={test} onChange={setTest} className="w-[260px]" />
        {description ? <span className={match ? "text-body text-fg-1" : "text-body text-fg-3"}>{result.isSuccess ? match ?? t("noMatch") : "…"}</span> : null}
        <span className="flex-1" />
        <Btn primary onClick={() => setDialog({ rule: null, pattern: match ? "" : test.trim().toLowerCase() })}>
          {t("new")}
        </Btn>
      </div>
      <Table
        headers={[t("headers.pattern"), t("headers.category"), t("headers.source"), t("headers.hits"), t("headers.lastHit")]}
        columnAlign={["left", "left", "left", "right", "left"]}
        rowKey={(i) => rows[i].id}
        onRowClick={(i) => setDialog({ rule: rows[i] })}
        emptyMessage={rules.isSuccess ? t("empty") : undefined}
        rows={rows.map((rule) => [
          <span key="p" className="font-mono">
            {patternText(rule)}
          </span>,
          <span key="c" className="inline-flex items-center gap-1.5">
            {rule.category?.name ?? "—"}
            {archived.has(rule.categoryId) ? <Badge>{t("archivedCategory")}</Badge> : null}
          </span>,
          t(`source.${rule.source}`),
          <span key="h" className="font-mono tabular-nums">
            {t("hits", { count: rule.hitCount })}
          </span>,
          <span key="l" className="text-fg-2">
            {rule.lastHitAt ? fmt.date(rule.lastHitAt) : "—"}
          </span>,
        ])}
      />
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} width={480}>
        {dialog ? <RuleForm rule={dialog.rule} initialPattern={dialog.pattern ?? ""} onDone={() => setDialog(null)} /> : null}
      </Dialog>
    </div>
  );
}

function RuleForm({ rule, initialPattern, onDone }: { rule: RuleRow | null; initialPattern: string; onDone: () => void }) {
  const t = useTranslations("settings.rules");
  const tc = useTranslations("common");
  const entities = useEntities();
  const [matchType, setMatchType] = useState<MatchType>(rule?.matchType ?? "contains");
  const [pattern, setPattern] = useState(rule?.pattern ?? initialPattern);
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [entityId, setEntityId] = useState(rule?.entityId ?? "");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const onError = (error: unknown) => {
    const fields = invalidFields(error);
    if (fields.size) {
      setInvalid(fields);
      return true;
    }
  };
  const save = useAppMutation({
    event: "catalog.write",
    mutationFn: (body: { matchType: MatchType; pattern: string; categoryId: string; entityId: string | null }) =>
      rule ? apiPatch<RuleRow & { batchId: string | null }>(`/api/v2/rules/${rule.id}`, body) : apiPost<RuleRow & { batchId: string | null }>("/api/v2/rules", body),
    undo: (saved) => t(rule ? "toastSaved" : "toastCreated", { pattern: saved.pattern }),
    onSuccess: onDone,
    onError,
  });
  const remove = useAppMutation({
    event: "catalog.write",
    mutationFn: () => apiDelete<{ ok: true; batchId: string | null }>(`/api/v2/rules/${rule!.id}`),
    undo: () => t("toastDeleted", { pattern: rule!.pattern }),
    onSuccess: onDone,
  });

  const submit = () => {
    const bad = new Set<string>();
    if (!pattern.trim()) bad.add("pattern");
    if (!categoryId) bad.add("categoryId");
    setInvalid(bad);
    if (bad.size || save.isPending) return;
    save.mutate({ matchType, pattern: pattern.trim(), categoryId: categoryId!, entityId: entityId || null });
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
      <DialogHead title={rule ? t("dialog.editTitle") : t("dialog.newTitle")} desc={t("dialog.desc")} />
      <Field label={t("dialog.matchType")}>
        <Segmented<MatchType>
          aria-label={t("dialog.matchType")}
          value={matchType}
          onChange={setMatchType}
          options={(["contains", "equals", "regex"] as const).map((v) => ({ v, l: t(`dialog.matchTypes.${v}`) }))}
        />
      </Field>
      <Field label={t("dialog.pattern")} htmlFor="rule-pattern">
        <TextInput id="rule-pattern" autoFocus value={pattern} onChange={setPattern} mono invalid={invalid.has("pattern")} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("dialog.category")}>
          <CategoryCombobox aria-label={t("dialog.category")} value={categoryId} onChange={setCategoryId} type={["expense", "income"]} invalid={invalid.has("categoryId")} />
        </Field>
        <Field label={t("dialog.entity")}>
          <Select
            aria-label={t("dialog.entity")}
            value={entityId}
            onChange={setEntityId}
            options={[{ value: "", label: t("dialog.allEntities") }, ...(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
          />
        </Field>
      </div>
      <DialogFooter justify="between">
        <span>
          {rule ? (
            <Btn ghost danger disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t("dialog.delete")}
            </Btn>
          ) : null}
        </span>
        <span className="flex gap-1.5">
          <Btn ghost onClick={onDone}>
            {tc("cancel")}
          </Btn>
          <Btn primary type="submit" disabled={save.isPending}>
            {rule ? tc("save") : t("dialog.create")}
          </Btn>
        </span>
      </DialogFooter>
    </form>
  );
}
