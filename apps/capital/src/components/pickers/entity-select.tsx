"use client";

import { useMemo } from "react";
import { Select, type SelectOption } from "@/components/cap";
import { entityLabel } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";

/**
 * Entity field ("PF", "Kodama LTDA", "Kodama LLC"), from the session's
 * entities. Entities outside the base currency show it as a hint.
 */
export function EntitySelect({
  value,
  onChange,
  kinds,
  placeholder,
  disabled,
  invalid,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (entityId: string) => void;
  /** Only personal or only business entities. */
  kinds?: readonly ("personal" | "business")[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const me = useSession().data;
  const kindsKey = kinds?.join(",") ?? "";
  const options = useMemo<SelectOption[]>(() => {
    const allowed = kindsKey ? kindsKey.split(",") : null;
    return (me?.entities ?? [])
      .filter((entity) => !allowed || allowed.includes(entity.kind))
      .map((entity) => ({
        value: entity.id,
        label: entityLabel(entity),
        hint: entity.defaultCurrency !== me?.baseCurrency ? entity.defaultCurrency : undefined,
      }));
  }, [me, kindsKey]);

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      id={id}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
