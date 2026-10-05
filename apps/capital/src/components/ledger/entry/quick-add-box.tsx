"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, TextInput } from "@/components/cap";
import type { CategoryRecord } from "@/lib/api/catalog";
import { useFmt } from "@/lib/format/provider";
import type { FormContext } from "@/lib/ledger/entry-form";
import { parseQuickAdd, type QuickAddCatalog, type QuickAddDraft, type QuickAddResult } from "@/lib/ledger/quick-add";
import { entityLabel } from "@/lib/pickers/options";

/** The quick-add catalog from the form's context: live accounts, entities, categories and currencies. */
export function quickAddCatalog(ctx: FormContext, categories: readonly CategoryRecord[]): QuickAddCatalog {
  return {
    accounts: ctx.accounts.filter((account) => !account.archivedAt),
    entities: ctx.entities.map((entity) => ({ id: entity.id, name: entity.name ?? "", kind: entity.kind })),
    categories: categories.filter((category) => !category.isArchived),
    currencies: [ctx.baseCurrency, ...Object.keys(ctx.rates)],
  };
}

/**
 * The quick-add box at the top of "Nova transação" (mockup 4825-4842): one
 * line of text, "Preencher ↵" (or ↵) puts what it understood in the form,
 * and the chips under it show that as it is typed ("Valor: 86,90",
 * "Conta: Nubank · cartão", "Data: 21/09/2026").
 */
export function QuickAddBox({ ctx, categories, onFill }: { ctx: FormContext; categories: readonly CategoryRecord[]; onFill: (draft: QuickAddDraft) => void }) {
  const t = useTranslations("entry.form");
  const fmt = useFmt();
  const [text, setText] = useState("");
  const catalog = useMemo(() => quickAddCatalog(ctx, categories), [ctx, categories]);
  const parsed: QuickAddResult = useMemo(() => parseQuickAdd(text, catalog, ctx.today), [text, catalog, ctx.today]);
  const { draft } = parsed;

  const value = (field: QuickAddResult["tokens"][number]["field"]): string => {
    switch (field) {
      case "amount":
        return fmt.number(draft.amount ?? 0);
      case "kind":
        return t(`kind.${draft.kind ?? "expense"}`);
      case "account":
        return ctx.accounts.find((account) => account.id === draft.accountId)?.name ?? "";
      case "entity": {
        const entity = ctx.entities.find((candidate) => candidate.id === draft.entityId);
        return entity ? entityLabel({ kind: entity.kind, name: entity.name ?? "" }) : "";
      }
      case "date":
        return fmt.dateFull(draft.date);
      case "category":
        return draft.categoryId ? (categories.find((category) => category.id === draft.categoryId)?.name ?? "") : t("chipNewCategory", { name: draft.categoryName ?? "" });
      case "currency":
        return draft.currency ?? ctx.accounts.find((account) => account.id === draft.accountId)?.currency ?? "";
      case "description":
        return draft.description ?? "";
    }
  };

  const fill = () => {
    if (!text.trim()) return;
    onFill(draft);
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-stroke-3 bg-fill-4 p-2.5">
      <div className="flex items-center gap-2">
        <TextInput
          value={text}
          onChange={setText}
          placeholder={t("quickPlaceholder")}
          className="flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              fill();
            }
          }}
        />
        <Btn primary onClick={fill} disabled={!text.trim()}>
          {t("quickFill")}
        </Btn>
      </div>
      {parsed.tokens.length ? (
        <div className="flex flex-wrap gap-1">
          {parsed.tokens.map((token) => (
            <span key={token.field} className="rounded-[4px] border border-stroke-2 px-1.5 py-px text-[11px]">
              <span className="text-fg-3">{t(`chip.${token.field}`)}: </span>
              {value(token.field)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
