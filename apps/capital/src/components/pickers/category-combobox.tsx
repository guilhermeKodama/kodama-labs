"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@/components/cap";
import { useCategories, useCreateCategory, type CategoryType } from "@/lib/api/catalog";

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

  const options = useMemo<ComboboxOption[]>(() => {
    const allowed = typesKey ? typesKey.split(",") : null;
    return (categories.data ?? [])
      .filter((category) => (!allowed || allowed.includes(category.type)) && (!category.isArchived || category.id === value))
      .map((category) => ({
        value: category.id,
        label: category.name,
        hint: category.isArchived
          ? t("pickers.archived")
          : !allowed || allowed.length > 1
            ? t(`pickers.categoryType.${category.type}`)
            : undefined,
      }));
  }, [categories.data, typesKey, value, t]);

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
