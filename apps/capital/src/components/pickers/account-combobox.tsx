"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { entityLabel, useAccounts, type AccountType } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { cn } from "@/lib/utils";
import { NewAccountDialog } from "./new-account-dialog";

/**
 * Account field: searchable, archived accounts hidden (except the current
 * value), optionally limited to some entities and account types. With
 * `allowCreate`, "+ Criar conta…" under the list opens the Nova conta
 * form prefilled with what was typed, and selects the new account.
 */
export function AccountCombobox({
  value,
  onChange,
  entityId,
  types,
  allowCreate = false,
  placeholder,
  disabled,
  invalid,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (accountId: string) => void;
  /** Only accounts of this entity (or these entities). */
  entityId?: string | readonly string[] | null;
  /** Only these account types (e.g. brokerage for aportes). */
  types?: readonly AccountType[];
  allowCreate?: boolean;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const t = useTranslations("common");
  const me = useSession().data;
  const accounts = useAccounts(true);
  const [creating, setCreating] = useState<string | null>(null);
  const entityKey = entityId ? (typeof entityId === "string" ? entityId : entityId.join(",")) : "";
  const typesKey = types?.join(",") ?? "";

  const options = useMemo<ComboboxOption[]>(() => {
    const entities = entityKey ? entityKey.split(",") : null;
    const allowedTypes = typesKey ? typesKey.split(",") : null;
    const labels = new Map((me?.entities ?? []).map((entity) => [entity.id, entityLabel(entity)]));
    return (accounts.data ?? [])
      .filter(
        (account) =>
          (!entities || entities.includes(account.entityId)) &&
          (!allowedTypes || allowedTypes.includes(account.type)) &&
          (!account.archivedAt || account.id === value),
      )
      .map((account) => {
        const entity = labels.get(account.entityId) ?? "";
        return {
          value: account.id,
          label: account.name,
          // With one entity the hint would repeat on every row.
          hint: account.archivedAt ? t("pickers.archived") : entities?.length === 1 ? undefined : entity,
          keywords: [entity, account.institution ?? "", t(`pickers.accountType.${account.type}`)],
        };
      });
  }, [accounts.data, me?.entities, entityKey, typesKey, value, t]);

  const singleEntity = entityKey && !entityKey.includes(",") ? entityKey : null;
  return (
    <>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        searchPlaceholder={t("pickers.accountSearch")}
        disabled={disabled}
        invalid={invalid}
        id={id}
        className={className}
        aria-label={ariaLabel}
        footer={
          allowCreate
            ? ({ query, close }) => (
                <button
                  type="button"
                  className={cn(MENU_ROW, "text-fg-2")}
                  onClick={() => {
                    close();
                    setCreating(query);
                  }}
                >
                  {t("pickers.createAccount")}
                </button>
              )
            : undefined
        }
      />
      {allowCreate ? (
        <NewAccountDialog
          open={creating !== null}
          onOpenChange={(open) => !open && setCreating(null)}
          initialName={creating ?? ""}
          entityId={singleEntity}
          types={types}
          onCreated={(account) => onChange(account.id)}
        />
      ) : null}
    </>
  );
}
