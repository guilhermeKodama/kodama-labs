"use client";

import { useMemo } from "react";
import { Select, type SelectOption } from "@/components/cap";
import { useSession, type SessionEntity } from "@/lib/api/session";
import { entityOptions } from "@/lib/pickers/options";

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
  const options = useMemo<SelectOption[]>(
    () =>
      entityOptions(me?.entities ?? [], {
        kinds: kindsKey ? (kindsKey.split(",") as SessionEntity["kind"][]) : null,
        baseCurrency: me?.baseCurrency,
      }),
    [me, kindsKey],
  );

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
