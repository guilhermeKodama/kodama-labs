"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@/components/cap";
import { useCategories, useCreateCategory, type CategoryType } from "@/lib/api/catalog";
import { categoryOptions } from "@/lib/pickers/options";

/**
 * Category field: searchable, archived categories hidden (the current
 * value still shows, marked "arquivada"), and typing a new name offers
 * "+ Criar “X”", which creates the category and selects it.
 */
export function CategoryCombobox({
  value,
  onChange,
  type,
  allowCreate = true,
  placeholder,
  disabled,
  invalid,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (categoryId: string) => void;
  /** Only categories of this type (or types). A created category gets the first one; expense when unset. */
  type?: CategoryType | readonly CategoryType[];
  allowCreate?: boolean;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const t = useTranslations("common");
  const categories = useCategories(true);
  const create = useCreateCategory();
  const types: readonly CategoryType[] | null = type === undefined ? null : typeof type === "string" ? [type] : type;
  const typesKey = types?.join(",") ?? "";

  const options = useMemo<ComboboxOption[]>(
    () =>
      categoryOptions(categories.data ?? [], {
        types: typesKey ? (typesKey.split(",") as CategoryType[]) : null,
        value,
        archivedLabel: t("pickers.archived"),
        typeLabel: (categoryType) => t(`pickers.categoryType.${categoryType}`),
      }),
    [categories.data, typesKey, value, t],
  );

  const onCreate = allowCreate
    ? (name: string) => create.mutate({ name, type: types?.[0] ?? "expense" }, { onSuccess: (category) => onChange(category.id) })
    : undefined;

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder ?? t("pickers.categoryPlaceholder")}
      searchPlaceholder={t("pickers.categorySearch")}
      onCreate={onCreate}
      disabled={disabled || create.isPending}
      invalid={invalid}
      id={id}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
