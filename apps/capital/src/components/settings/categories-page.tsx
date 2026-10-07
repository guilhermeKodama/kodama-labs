"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { Badge, Btn, Field, Segmented, TextInput } from "@/components/cap";
import type { CategoryRecord } from "@/lib/api/catalog";
import { apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { swatchColor } from "@/lib/settings/palette";
import { AddRow, Dot, GroupLabel, ListDetail, ListItem, Swatches } from "./master";
import { useRules, type RuleRow } from "./rules-data";

/** GET /v2/categories?withCounts=true rows. */
type CategoryRow = CategoryRecord & { systemKey: string | null; counts: { entries: number; budgets: number } };

const GROUPS = ["expense", "income"] as const;

function useCategoriesWithCounts() {
  const params = { includeArchived: true, withCounts: true } as const;
  return useQuery({
    queryKey: keys.categories(params),
    queryFn: async () => (await apiGet<{ categories: CategoryRow[] }>("/api/v2/categories", params)).categories,
  });
}

/**
 * Categorias (categoryDelete=archive): Despesas and Receitas with their
 * usage counts; the form saves each change as it is made (no Salvar), and
 * archiving takes a category out of the pickers with an undo.
 */
export function CategoriesPage() {
  const t = useTranslations("settings.cat");
  const categories = useCategoriesWithCounts();
  const [selected, setSelected] = useQueryState("id", parseAsString);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const list = (categories.data ?? []).filter((c) => c.type === "expense" || c.type === "income");
  const current = list.find((c) => c.id === selected) ?? list.find((c) => c.type === "expense" && !c.isArchived) ?? list[0] ?? null;

  const create = useAppMutation({
    event: "catalog.write",
    mutationFn: (name: string) => apiPost<CategoryRow>("/api/v2/categories", { name, type: "expense" }),
    undo: (created) => t("toastCreated", { name: created.name }),
    onSuccess: (created) => {
      setAdding(false);
      setNewName("");
      void setSelected(created.id);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <span className="text-body-sm text-fg-3">{t("hint")}</span>
      <ListDetail
        list={
          <>
            {GROUPS.map((type) => (
              <div key={type} className="flex flex-col gap-0.5">
                <GroupLabel>{t(`groups.${type}`)}</GroupLabel>
                {list
                  .filter((c) => c.type === type)
                  .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name))
                  .map((category) => (
                    <ListItem
                      key={category.id}
                      on={current?.id === category.id}
                      faded={category.isArchived}
                      onClick={() => void setSelected(category.id)}
                      left={
                        <>
                          <Dot color={swatchColor(category.color)} />
                          <span className="truncate">{category.name}</span>
                          {category.isArchived ? <Badge>{t("archivedBadge")}</Badge> : null}
                        </>
                      }
                      right={<span className="shrink-0 font-mono text-caption text-fg-3 tabular-nums">{category.counts.entries}</span>}
                    />
                  ))}
              </div>
            ))}
            {adding ? (
              <form
                className="px-1.5 py-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newName.trim()) create.mutate(newName.trim());
                }}
              >
                <TextInput
                  autoFocus
                  aria-label={t("newPlaceholder")}
                  placeholder={t("newPlaceholder")}
                  value={newName}
                  onChange={setNewName}
                  disabled={create.isPending}
                  onBlur={() => !newName.trim() && setAdding(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setAdding(false);
                      setNewName("");
                    }
                  }}
                  className="w-full"
                />
              </form>
            ) : (
              <AddRow onClick={() => setAdding(true)}>{t("new")}</AddRow>
            )}
          </>
        }
        detail={current ? <CategoryDetail key={current.id} category={current} /> : categories.isSuccess ? <span className="text-body-sm text-fg-3">{t("empty")}</span> : null}
      />
    </div>
  );
}

function CategoryDetail({ category }: { category: CategoryRow }) {
  const t = useTranslations("settings.cat");
  const rules = useRules();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<string | null>(null);

  // Name, type and color: each change is its own undo batch, stacked silently (⌘Z).
  const patch = useAppMutation({
    event: "catalog.write",
    mutationFn: (body: { name?: string; type?: "expense" | "income"; color?: string | null }) => apiPatch<CategoryRow & { batchId: string | null }>(`/api/v2/categories/${category.id}`, body),
  });
  const archive = useAppMutation({
    event: "catalog.write",
    mutationFn: (isArchived: boolean) => apiPatch<CategoryRow & { batchId: string | null }>(`/api/v2/categories/${category.id}`, { isArchived }),
    undo: (saved, isArchived) => (isArchived ? t("toastArchived", { name: saved.name, count: category.counts.entries }) : t("toastUnarchived", { name: saved.name })),
  });
  const addRule = useAppMutation({
    event: "catalog.write",
    mutationFn: (pattern: string) => apiPost<RuleRow & { batchId: string | null }>("/api/v2/rules", { matchType: "contains", pattern, categoryId: category.id }),
    undo: (rule) => t("toastRule", { pattern: rule.pattern }),
    onSuccess: () => setRuleDraft(null),
  });

  const commitName = () => {
    const name = nameDraft?.trim();
    setNameDraft(null);
    if (name && name !== category.name) patch.mutate({ name });
  };
  const typeLocked = category.counts.entries > 0 || !!category.systemKey;
  const categoryRules = (rules.data ?? []).filter((r) => r.categoryId === category.id);

  return (
    <>
      <Field label={t("name")} htmlFor="cat-name">
        <TextInput
          id="cat-name"
          value={nameDraft ?? category.name}
          onChange={setNameDraft}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </Field>
      <Field label={t("type")}>
        <span title={typeLocked ? t("typeLocked") : undefined} className="inline-flex">
          <Segmented
            aria-label={t("type")}
            value={category.type === "income" ? "income" : "expense"}
            options={[
              { v: "expense", l: t("types.expense") },
              { v: "income", l: t("types.income") },
            ]}
            disabled={typeLocked || patch.isPending}
            onChange={(type) => type !== category.type && patch.mutate({ type })}
          />
        </span>
      </Field>
      <Field label={t("color")}>
        <Swatches value={category.color} onChange={(color) => color !== category.color && patch.mutate({ color })} disabled={patch.isPending} />
      </Field>
      <Field label={t("rules")} hint={t("rulesHint")}>
        <span className="flex flex-wrap items-center gap-1">
          {categoryRules.map((rule) => (
            <Badge key={rule.id} mono>
              {rule.pattern}
            </Badge>
          ))}
          {ruleDraft === null ? (
            <button type="button" className="text-label text-fg-3 outline-none hover:text-fg-strong focus-visible:underline" onClick={() => setRuleDraft("")}>
              {t("addRule")}
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (ruleDraft.trim()) addRule.mutate(ruleDraft.trim());
              }}
            >
              <TextInput
                autoFocus
                aria-label={t("rulePlaceholder")}
                placeholder={t("rulePlaceholder")}
                value={ruleDraft}
                onChange={setRuleDraft}
                disabled={addRule.isPending}
                onBlur={() => !ruleDraft.trim() && setRuleDraft(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setRuleDraft(null);
                  }
                }}
                className="h-[22px] w-36 font-mono text-label"
              />
            </form>
          )}
        </span>
      </Field>
      <span className="text-body-sm text-fg-3">{t("usage", { entries: category.counts.entries, budgets: category.counts.budgets })}</span>
      <div className="flex items-center gap-2 border-t border-stroke-3 pt-2.5">
        <Btn disabled={archive.isPending} onClick={() => archive.mutate(!category.isArchived)}>
          {category.isArchived ? t("unarchive") : t("archive")}
        </Btn>
        <span className="text-label text-fg-3">{t("archiveHint")}</span>
      </div>
    </>
  );
}
